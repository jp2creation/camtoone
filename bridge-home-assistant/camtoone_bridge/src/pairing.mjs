import {
  digest,
  equal,
  secret,
  publicOrigin,
  validId,
  requireThat,
  Fault,
} from "./common.mjs";
export function controlEntity(value) {
  return (
    typeof value === "string" &&
    /^(light|switch)\.[a-z0-9_]{1,200}$/.test(value) &&
    !/\.(all|none)$/.test(value)
  );
}
function controlList(value) {
  requireThat(
    Array.isArray(value) &&
      value.length <= 32 &&
      value.every(controlEntity) &&
      new Set(value).size === value.length,
  );
  return [...value];
}
export function invitationGrant(input = {}) {
  requireThat(
    input !== null &&
      typeof input === "object" &&
      !Array.isArray(input) &&
      Object.keys(input).every((key) => key === "dashboardRead") &&
      (!Object.hasOwn(input, "dashboardRead") ||
        typeof input.dashboardRead === "boolean"),
  );
  return input.dashboardRead === true;
}
export function parseTicket(raw, development = false) {
  requireThat(
    typeof raw === "string" &&
      raw.length < 2048 &&
      raw.startsWith("CAMTOONE-BRIDGE:1:"),
  );
  let data;
  try {
    data = JSON.parse(Buffer.from(raw.slice(18), "base64url").toString());
  } catch {
    throw new Fault(400, "invalid_ticket");
  }
  requireThat(
    data &&
      Object.keys(data).sort().join(",") === "bridgeId,code,relay" &&
      validId(data.bridgeId) &&
      /^[A-Za-z0-9_-]{43}$/.test(data.code),
  );
  data.relay = publicOrigin(data.relay, development);
  return data;
}
export class Pairing {
  constructor({
    bridgeId,
    relay,
    state = [],
    now = Date.now,
    persist = () => {},
    development = false,
  }) {
    requireThat(validId(bridgeId));
    this.bridgeId = bridgeId;
    this.relay = publicOrigin(relay, development);
    this.now = now;
    this.persist = persist;
    this.state = state;
    this.offer = null;
    this.controlRevisions = new Map();
    requireThat(
      Array.isArray(state) &&
        state.length <= 32 &&
        state.every(
          (d) =>
            validId(d.id) &&
            /^[a-f0-9]{64}$/.test(d.hash) &&
            typeof d.name === "string" &&
            (d.dashboardRead === undefined ||
              typeof d.dashboardRead === "boolean"),
        ),
    );
    this.state = state.map((d) => ({
      ...d,
      dashboardRead: d.dashboardRead === true,
      ...(d.powerEntities !== undefined
        ? { powerEntities: controlList(d.powerEntities) }
        : {}),
      ...(d.control !== undefined ? { control: d.control === true } : {}),
    }));
  }
  active() {
    return Boolean(
      this.offer &&
        this.offer.expiresAt > this.now() &&
        this.offer.attempts < 6,
    );
  }
  invite(input = {}) {
    const dashboardRead = invitationGrant(input);
    requireThat(this.state.length < 32, 409, "device_limit");
    const code = secret();
    this.offer = {
      hash: digest(code),
      expiresAt: this.now() + 180000,
      attempts: 0,
      dashboardRead,
    };
    return {
      ticket:
        "CAMTOONE-BRIDGE:1:" +
        Buffer.from(
          JSON.stringify({ relay: this.relay, bridgeId: this.bridgeId, code }),
        ).toString("base64url"),
      code,
      expiresAt: this.offer.expiresAt,
    };
  }
  claim(code, name) {
    requireThat(
      typeof name === "string" &&
        name.trim().length >= 1 &&
        name.length <= 80 &&
        !/[\x00-\x1f\x7f]/.test(name),
    );
    const o = this.offer;
    if (!o || o.expiresAt <= this.now() || o.attempts >= 6)
      throw new Fault(403, "invitation_unavailable");
    o.attempts++;
    requireThat(
      typeof code === "string" &&
        code.length === 43 &&
        equal(digest(code), o.hash),
      403,
      "invitation_unavailable",
    );
    requireThat(this.state.length < 32, 409, "device_limit");
    const token = secret(),
      deviceId = secret().slice(0, 22);
    this.offer = null;
    this.state.push({
      id: deviceId,
      hash: digest(token),
      name: name.trim(),
      createdAt: this.now(),
      dashboardRead: o.dashboardRead === true,
    });
    this.persist(this.export());
    return {
      version: 1,
      deviceId,
      token,
      endpoint: `${this.relay}/v1/bridges/${this.bridgeId}`,
    };
  }
  authorized(token) {
    return Boolean(this.device(token));
  }
  device(token) {
    return (
      typeof token === "string" &&
      token.length === 43 &&
      this.state.find((d) => equal(d.hash, digest(token)))
    );
  }
  dashboardGranted(token) {
    return this.device(token)?.dashboardRead === true;
  }
  controlEntities(token) {
    const d = this.device(token);
    return d?.dashboardRead === true && d.control === true
      ? [...(d.powerEntities ?? [])]
      : [];
  }
  controlEpoch(token) {
    const device = this.device(token);
    return device ? this.controlRevisions.get(device.id) || 0 : -1;
  }
  canControl(token, entityId) {
    return (
      controlEntity(entityId) && this.controlEntities(token).includes(entityId)
    );
  }
  beginControlEdit(id) {
    requireThat(
      this.state.some((d) => d.id === id),
      404,
      "device_not_found",
    );
    const epoch = (this.controlRevisions.get(id) || 0) + 1;
    this.controlRevisions.set(id, epoch);
    return epoch;
  }
  setControlEntities(id, entities, expectedEpoch) {
    const next = controlList(entities);
    if (expectedEpoch !== undefined)
      requireThat(
        this.controlRevisions.get(id) === expectedEpoch,
        409,
        "control_changed",
      );
    const device = this.state.find((d) => d.id === id);
    requireThat(device, 404, "device_not_found");
    requireThat(
      device.dashboardRead === true || next.length === 0,
      403,
      "dashboard_forbidden",
    );
    this.beginControlEdit(id);
    device.powerEntities = next;
    device.control = next.length > 0;
    this.persist(this.export());
  }
  devices() {
    return this.state.map(({ hash, ...d }) => d);
  }
  revoke(id) {
    this.controlRevisions.delete(id);
    this.state = this.state.filter((d) => d.id !== id);
    this.persist(this.export());
  }
  export() {
    return structuredClone(this.state);
  }
}
