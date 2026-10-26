import { isIP } from "node:net";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { validId, requireThat, publicOrigin } from "./common.mjs";
export function privateIp(host) {
  if (isIP(host) !== 4) return false;
  const a = host.split(".").map(Number);
  return (
    a[0] === 10 ||
    (a[0] === 172 && a[1] >= 16 && a[1] <= 31) ||
    (a[0] === 192 && a[1] === 168)
  );
}
export function haOrigin(value, local = false) {
  requireThat(
    typeof value === "string" &&
      value.length > 0 &&
      value.length <= 512 &&
      !/[\s\x00-\x1f\\]/.test(value),
  );
  const u = new URL(value);
  requireThat(
    u.protocol === "https:" &&
      value === u.origin &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash,
  );
  if (local) requireThat(privateIp(u.hostname));
  else {
    const ip = isIP(u.hostname);
    if (ip === 4) {
      const a = u.hostname.split(".").map(Number);
      requireThat(
        !privateIp(u.hostname) &&
          a[0] > 0 &&
          a[0] !== 127 &&
          a[0] < 224 &&
          !(a[0] === 169 && a[1] === 254) &&
          !(a[0] === 100 && a[1] >= 64 && a[1] <= 127) &&
          !(a[0] === 198 && [18, 19].includes(a[1])),
      );
    } else
      requireThat(
        ip === 0 &&
          u.hostname.length <= 253 &&
          u.hostname.includes(".") &&
          !/\.(local|localhost|internal|invalid|test)$/.test(u.hostname) &&
          u.hostname
            .split(".")
            .every((label) =>
              /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
            ),
      );
  }
  return u.origin;
}
export function rtspUrl(value) {
  requireThat(
    typeof value === "string" &&
      value.length <= 4096 &&
      !/[\s\x00-\x1f\\]/.test(value),
  );
  const u = new URL(value);
  requireThat(
    u.protocol === "rtsp:" &&
      privateIp(u.hostname) &&
      !u.hash &&
      u.pathname !== "/",
  );
  return u;
}
export function validateCamera(c) {
  requireThat(
    c &&
      validId(c.id) &&
      typeof c.name === "string" &&
      c.name.trim().length > 0 &&
      c.name.length <= 100 &&
      !/[\x00-\x1f\x7f]/.test(c.name) &&
      typeof c.exposed === "boolean",
  );
  requireThat([c.rtsp, c.onvif, c.ha].filter(Boolean).length === 1);
  if (c.rtsp) rtspUrl(c.rtsp);
  else if (c.ha) {
    requireThat(
      typeof c.ha.entityId === "string" &&
        /^camera\.[a-z0-9_]{1,200}$/.test(c.ha.entityId),
    );
  } else {
    const o = c.onvif;
    requireThat(
      privateIp(o.host) &&
        Number.isInteger(o.port) &&
        o.port > 0 &&
        o.port <= 65535 &&
        typeof o.username === "string" &&
        o.username.length <= 128 &&
        typeof o.password === "string" &&
        o.password.length <= 256 &&
        (o.path === undefined ||
          (typeof o.path === "string" &&
            /^\/[a-zA-Z0-9_./-]{1,180}$/.test(o.path) &&
            !o.path.includes(".."))) &&
        (o.secure === undefined || typeof o.secure === "boolean") &&
        (!o.profileToken ||
          (typeof o.profileToken === "string" &&
            /^[a-zA-Z0-9_.:-]{1,160}$/.test(o.profileToken))),
    );
  }
  return c;
}
export function publicCamera(c) {
  return {
    id: c.id,
    name: c.name,
    canStream: true,
    transport: "hls",
    stream: `v1/cameras/${c.id}/hls/index.m3u8`,
  };
}
export function validateConfig(c, development = false) {
  requireThat(
    c && validId(c.bridgeId) && /^[A-Za-z0-9_-]{43}$/.test(c.adminKey),
  );
  if (c.connectionMode === undefined) c.connectionMode = "legacy";
  requireThat(["direct", "legacy"].includes(c.connectionMode));
  if (c.connectionMode === "legacy") {
    requireThat(/^[A-Za-z0-9_-]{43}$/.test(c.relayKey));
    c.relay = publicOrigin(c.relay, development);
  } else requireThat(c.directEnabled !== false);
  c.externalOrigin ??= "";
  if (c.externalOrigin !== "") haOrigin(c.externalOrigin);
  for (const flag of ["directEnabled", "p2pEnabled"])
    requireThat(c[flag] === undefined || typeof c[flag] === "boolean");
  requireThat(
    c.localPort === undefined ||
      (Number.isInteger(c.localPort) &&
        c.localPort >= 1024 &&
        c.localPort <= 65535),
  );
  requireThat(Array.isArray(c.cameras) && c.cameras.length <= 32);
  c.cameras.forEach(validateCamera);
  requireThat(new Set(c.cameras.map((c) => c.id)).size === c.cameras.length);
  return c;
}
function stateKey(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, "state.key");
  if (!existsSync(file)) {
    requireThat(
      !existsSync(join(dir, "state.enc")) &&
        !existsSync(join(dir, "cameras.enc")),
      500,
      "state_key_missing",
    );
    writeFileSync(file, randomBytes(32), { mode: 0o600, flag: "wx" });
  }
  const key = readFileSync(file);
  requireThat(key.length === 32, 500, "invalid_state_key");
  return key;
}
export function saveState(dir, state, name = "state.enc") {
  const key = stateKey(dir),
    iv = randomBytes(12),
    c = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([c.update(JSON.stringify(state)), c.final()]);
  writeFileSync(
    join(dir, name + ".new"),
    Buffer.concat([iv, c.getAuthTag(), encrypted]),
    { mode: 0o600 },
  );
  renameSync(join(dir, name + ".new"), join(dir, name));
}
export function loadState(dir, name = "state.enc") {
  if (!existsSync(join(dir, name))) return [];
  const key = stateKey(dir),
    blob = readFileSync(join(dir, name));
  const d = createDecipheriv("aes-256-gcm", key, blob.subarray(0, 12));
  d.setAuthTag(blob.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([d.update(blob.subarray(28)), d.final()]).toString(),
  );
}
export function readConfig(file, development = false) {
  const c = JSON.parse(readFileSync(file, "utf8"));
  if (Array.isArray(c.cameras))
    c.cameras = c.cameras.map((camera) =>
      camera.onvifHost
        ? {
            ...camera,
            onvif: {
              host: camera.onvifHost,
              port: camera.onvifPort || 80,
              username: camera.onvifUsername || "",
              password: camera.onvifPassword || "",
              profileToken: camera.onvifProfileToken,
            },
          }
        : camera,
    );
  return validateConfig(c, development);
}
