import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadState, saveState } from "./config.mjs";
import { requireThat, secret, digest, Fault } from "./common.mjs";
const userId = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const tokenValid = (v) =>
  typeof v === "string" &&
  v.length >= 1 &&
  v.length <= 8192 &&
  /^[\x21-\x7e]+$/.test(v);
function connectionUrls(value) {
  requireThat(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).sort().join(",") === "externalUrl,internalUrl",
    400,
    "connection_urls_invalid",
  );
  const result = {};
  for (const kind of ["internal", "external"]) {
    const raw = value[kind + "Url"];
    requireThat(
      typeof raw === "string" &&
        raw.length <= 2048 &&
        !/[\\\x00-\x1f\x7f]/.test(raw),
      400,
      "connection_urls_invalid",
    );
    const v = raw.trim();
    result[kind + "Url"] = v;
    if (!v) continue;
    requireThat(!/[\s?#]/.test(v), 400, "connection_urls_invalid");
    let u;
    try {
      u = new URL(v);
    } catch {
      throw new Fault(400, "connection_urls_invalid");
    }
    requireThat(
      ["http:", "https:"].includes(u.protocol) &&
        !u.username &&
        !u.password &&
        !u.search &&
        !u.hash,
      400,
      "connection_urls_invalid",
    );
    if (kind === "external")
      requireThat(u.protocol === "https:", 400, "connection_urls_invalid");
    else {
      const h = u.hostname.toLowerCase(),
        rawHost = v.match(/^https?:\/\/([^/:?#]+)/i)?.[1]?.toLowerCase(),
        a = h.split(".").map(Number);
      const privateIp =
        rawHost === h &&
        /^(?:\d{1,3}\.){3}\d{1,3}$/.test(rawHost) &&
        a.length === 4 &&
        a.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) &&
        (a[0] === 10 ||
          a[0] === 127 ||
          (a[0] === 192 && a[1] === 168) ||
          (a[0] === 172 && a[1] >= 16 && a[1] <= 31));
      requireThat(
        privateIp || h === "localhost" || h.endsWith(".local"),
        400,
        "connection_urls_invalid",
      );
    }
  }
  requireThat(
    result.internalUrl || result.externalUrl,
    400,
    "connection_urls_invalid",
  );
  return result;
}
export function credentialUser(req, ingress) {
  requireThat(
    ingress &&
      ["172.30.32.2", "::ffff:172.30.32.2"].includes(req.socket.remoteAddress),
    403,
    "credential_forbidden",
  );
  const uid = req.headers["x-remote-user-id"];
  requireThat(userId(uid), 403, "credential_forbidden");
  requireThat(
    req.headers["sec-fetch-site"] !== "cross-site",
    403,
    "origin_denied",
  );
  if (req.headers.origin !== undefined) {
    const proto = req.headers["x-forwarded-proto"],
      host = req.headers["x-forwarded-host"];
    requireThat(
      typeof proto === "string" &&
        ["http", "https"].includes(proto) &&
        typeof host === "string" &&
        !/[\s,/@\\?#]/.test(host),
      403,
      "origin_denied",
    );
    let expected;
    try {
      expected = new URL(proto + "://" + host).origin;
    } catch {
      throw new Fault(403, "origin_denied");
    }
    requireThat(
      typeof req.headers.origin === "string" && req.headers.origin === expected,
      403,
      "origin_denied",
    );
  }
  return uid;
}
export class HaCredentials {
  constructor({ directory, installationId, verify, now = Date.now }) {
    this.directory = directory;
    this.installationId = installationId;
    this.verify = verify;
    this.now = now;
    this.leases = new Map();
    requireThat(
      (!existsSync(join(directory, "ha-credentials.enc")) &&
        !existsSync(join(directory, "ha-connection-settings.enc"))) ||
        existsSync(join(directory, "state.key")),
      500,
      "state_key_missing",
    );
    this.records = loadState(directory, "ha-credentials.enc");
    this.settingsRecords = loadState(directory, "ha-connection-settings.enc");
    requireThat(
      Array.isArray(this.settingsRecords) &&
        this.settingsRecords.length <= 256 &&
        new Set(this.settingsRecords.map((r) => r?.userId)).size ===
          this.settingsRecords.length,
      500,
      "connection_settings_invalid",
    );
    for (const r of this.settingsRecords) {
      requireThat(r && userId(r.userId), 500, "connection_settings_invalid");
      connectionUrls(r.urls);
    }
    requireThat(
      Array.isArray(this.records) &&
        this.records.length <= 256 &&
        this.records.every(
          (r) => r && userId(r.userId) && tokenValid(r.token),
        ) &&
        new Set(this.records.map((r) => r.userId)).size === this.records.length,
      500,
      "credential_state_invalid",
    );
  }
  saveUrls(uid, value) {
    requireThat(userId(uid), 403, "credential_forbidden");
    const urls = connectionUrls(value),
      records = this.settingsRecords.filter((r) => r.userId !== uid);
    requireThat(records.length < 256, 409, "connection_settings_full");
    records.push({ userId: uid, urls });
    saveState(this.directory, records, "ha-connection-settings.enc");
    this.settingsRecords = records;
    return { saved: true };
  }
  connection(uid) {
    const saved = this.settingsRecords.find((r) => r.userId === uid);
    return {
      version: 1,
      installationId: this.installationId,
      userId: uid,
      credentialPresent: this.records.some((r) => r.userId === uid),
      ...(saved ? { settings: { ...saved.urls } } : {}),
    };
  }
  async get(uid) {
    const record = this.records.find((r) => r.userId === uid);
    if (!record) return null;
    let owner;
    try {
      owner = await this.verify(record.token);
    } catch (error) {
      if (!(error instanceof Fault && error.code === "credential_invalid"))
        throw new Fault(502, "credential_unavailable");
    }
    if (owner !== uid) {
      if (this.records.includes(record)) {
        const records = this.records.filter((r) => r !== record);
        saveState(this.directory, records, "ha-credentials.enc");
        this.records = records;
      }
      return null;
    }
    requireThat(this.records.includes(record), 409, "credential_changed");
    return record.token;
  }
  reserve(uid) {
    for (const [id, l] of this.leases)
      if (l.expiresAt <= this.now()) this.leases.delete(id);
    requireThat(
      !this.records.some((r) => r.userId === uid) && !this.leases.has(uid),
      409,
      "credential_busy",
    );
    requireThat(this.leases.size < 256, 409, "credential_busy");
    const lease = secret(),
      clientName = `Camtoone ${this.installationId.slice(0, 16)} ${digest(uid).slice(0, 16)} ${lease}`;
    this.leases.set(uid, {
      lease,
      expiresAt: this.now() + 60000,
      verifying: false,
    });
    return { lease, clientName };
  }
  lease(uid, value) {
    const l = this.leases.get(uid);
    requireThat(
      l &&
        typeof value === "string" &&
        l.lease === value &&
        l.expiresAt > this.now(),
      409,
      "credential_lease_invalid",
    );
    return l;
  }
  async store(uid, value, token) {
    requireThat(tokenValid(token), 400, "credential_invalid");
    const l = this.lease(uid, value);
    requireThat(
      !l.verifying && !this.records.some((r) => r.userId === uid),
      409,
      "credential_busy",
    );
    l.verifying = true;
    try {
      const owner = await this.verify(token);
      requireThat(owner === uid, 403, "credential_invalid");
      requireThat(
        this.lease(uid, value) === l &&
          !this.records.some((r) => r.userId === uid),
        409,
        "credential_lease_invalid",
      );
      requireThat(this.records.length < 256, 409, "credential_busy");
      const records = [...this.records, { userId: uid, token }];
      saveState(this.directory, records, "ha-credentials.enc");
      this.records = records;
      this.leases.delete(uid);
      return { saved: true };
    } finally {
      l.verifying = false;
    }
  }
  release(uid, value) {
    this.lease(uid, value);
    this.leases.delete(uid);
    return { released: true };
  }
}
