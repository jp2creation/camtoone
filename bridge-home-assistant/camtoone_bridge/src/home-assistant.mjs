import { controlEntity } from "./pairing.mjs";
import { createServer } from "node:http";
import { once } from "node:events";
import WebSocket from "ws";
import { privateIp } from "./config.mjs";
import {
  Fault,
  requireThat,
  digest,
  secret,
  reply,
  failure,
} from "./common.mjs";
const entity = (value) =>
  typeof value === "string" && /^camera\.[a-z0-9_]{1,200}$/.test(value);
async function limited(response, max) {
  requireThat(response.ok, 502, "ha_unavailable");
  const chunks = [];
  let length = 0;
  try {
    for await (const c of response.body) {
      length += c.length;
      requireThat(length <= max, 502, "ha_response_too_large");
      chunks.push(c);
    }
  } catch (e) {
    await response.body?.cancel().catch(() => {});
    throw e;
  }
  return Buffer.concat(chunks);
}
export class HomeAssistant {
  constructor({ base = "http://supervisor", token, development = false } = {}) {
    const u = new URL(base);
    requireThat(
      ["http:", "https:"].includes(u.protocol) &&
        !u.username &&
        !u.password &&
        !u.search &&
        !u.hash &&
        u.pathname === "/" &&
        (["supervisor", "homeassistant"].includes(u.hostname) ||
          privateIp(u.hostname) ||
          (development && u.hostname === "127.0.0.1")),
      400,
      "ha_origin_invalid",
    );
    this.base = u.origin;
    this.supervisor = u.hostname === "supervisor";
    this.token = token;
    this.sessions = new Map();
    this.server = null;
    this.starting = null;
    this.sockets = new Set();
    this.abort = new AbortController();
    this.timer = setInterval(() => {
      for (const [id, s] of this.sessions)
        if (Date.now() - s.last > 60000) this.sessions.delete(id);
    }, 10000);
    this.timer.unref();
  }
  get available() {
    return typeof this.token === "string" && this.token.length > 0;
  }
  async request(path, max = 4 * 1024 * 1024) {
    requireThat(this.available, 503, "ha_not_configured");
    const response = await fetch(
      this.base + (this.supervisor ? "/core" : "") + path,
      {
        method: "GET",
        headers: { authorization: `Bearer ${this.token}` },
        redirect: "error",
        signal: AbortSignal.any([
          this.abort.signal,
          AbortSignal.timeout(10000),
        ]),
      },
    );
    return limited(response, max);
  }
  async credentialUser(token) {
    requireThat(
      typeof token === "string" &&
        token.length >= 1 &&
        token.length <= 8192 &&
        /^[\x21-\x7e]+$/.test(token) &&
        token !== this.token,
      403,
      "credential_invalid",
    );
    const origin = this.supervisor ? "http://homeassistant:8123" : this.base;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(
        origin.replace(/^http/, "ws") + "/api/websocket",
        { maxPayload: 65536, handshakeTimeout: 8000, followRedirects: false },
      );
      this.sockets.add(ws);
      let done = false,
        stage = "auth";
      const finish = (error, id) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.sockets.delete(ws);
        ws.terminate();
        error ? reject(error) : resolve(id);
      };
      const timer = setTimeout(
        () => finish(new Fault(502, "credential_unavailable")),
        8000,
      );
      ws.on("error", () => finish(new Fault(502, "credential_unavailable")));
      ws.on("close", () => finish(new Fault(502, "credential_unavailable")));
      ws.on("message", (raw) => {
        try {
          const m = JSON.parse(raw);
          if (stage === "auth" && m.type === "auth_required") {
            stage = "auth_sent";
            ws.send(JSON.stringify({ type: "auth", access_token: token }));
          } else if (stage === "auth_sent" && m.type === "auth_invalid")
            finish(new Fault(403, "credential_invalid"));
          else if (stage === "auth_sent" && m.type === "auth_ok") {
            stage = "current_user";
            ws.send(JSON.stringify({ id: 1, type: "auth/current_user" }));
          } else if (
            stage === "current_user" &&
            m.type === "result" &&
            m.id === 1
          ) {
            requireThat(
              m.success &&
                typeof m.result?.id === "string" &&
                /^[A-Za-z0-9_-]{1,128}$/.test(m.result.id),
              403,
              "credential_invalid",
            );
            finish(null, m.result.id);
          } else finish(new Fault(403, "credential_invalid"));
        } catch {
          finish(new Fault(403, "credential_invalid"));
        }
      });
    });
  }
  async dashboardStates() {
    requireThat(this.available, 503, "ha_not_configured");
    let states;
    try {
      const body = await this.request("/api/states", 4 * 1024 * 1024);
      try {
        states = JSON.parse(body.toString("utf8"));
      } catch {
        throw new Fault(502, "ha_invalid_dashboard");
      }
    } catch (error) {
      if (
        error instanceof Fault &&
        ["ha_invalid_dashboard", "ha_response_too_large"].includes(error.code)
      )
        throw error;
      throw new Fault(502, "ha_unavailable");
    }
    requireThat(Array.isArray(states), 502, "ha_invalid_dashboard");
    const text = (value, limit) => {
      if (
        !(
          typeof value === "string" ||
          typeof value === "boolean" ||
          (typeof value === "number" && Number.isFinite(value))
        )
      )
        return "";
      const clean = String(value).replace(/[\p{Cc}\p{Cf}]/gu, "");
      // Only projected display text crosses the boundary, never resource URLs or the HA credential.
      if (
        clean.includes(this.token) ||
        /[a-z][a-z0-9+.-]*:\/\/|\b(?:data|file|javascript):|\bbearer\s/i.test(
          clean,
        )
      )
        return "";
      return clean.slice(0, limit);
    };
    const entities = [],
      seen = new Set();
    for (const state of states) {
      const id = state?.entity_id;
      if (
        typeof id !== "string" ||
        id.length > 255 ||
        !/^(light|switch|sensor|binary_sensor|climate|cover|scene|camera)\.[a-z0-9_]+$/.test(
          id,
        ) ||
        seen.has(id)
      )
        continue;
      const attrs =
        state.attributes &&
        typeof state.attributes === "object" &&
        !Array.isArray(state.attributes)
          ? state.attributes
          : {};
      const displayState = text(state.state, 128);
      entities.push({
        entityId: id,
        name: text(attrs.friendly_name, 100) || id.slice(0, 100),
        state: displayState,
        value:
          id.startsWith("climate.") &&
          typeof attrs.current_temperature === "number" &&
          Number.isFinite(attrs.current_temperature)
            ? text(attrs.current_temperature, 128)
            : displayState,
        unit: text(attrs.unit_of_measurement, 16),
        deviceClass: text(attrs.device_class, 64),
      });
      seen.add(id);
      if (entities.length === 128) break;
    }
    const result = { version: 1, entities };
    requireThat(
      Buffer.byteLength(JSON.stringify(result), "utf8") <= 256 * 1024,
      502,
      "ha_response_too_large",
    );
    return result;
  }
  async setPower(entityId, enabled, authorized) {
    requireThat(
      controlEntity(entityId) && typeof enabled === "boolean",
      400,
      "invalid_power_target",
    );
    requireThat(
      typeof authorized === "function" && authorized(),
      403,
      "control_forbidden",
    );
    const current = JSON.parse(
      (await this.request("/api/states/" + entityId, 65536)).toString("utf8"),
    );
    requireThat(
      current.entity_id === entityId && ["on", "off"].includes(current.state),
      409,
      "entity_unavailable",
    );
    requireThat(authorized(), 403, "control_forbidden");
    const domain = entityId.split(".")[0];
    // One fixed service action, never retry an ambiguous write or expose the upstream body.
    const response = await fetch(
      this.base +
        (this.supervisor ? "/core" : "") +
        "/api/services/" +
        domain +
        "/" +
        (enabled ? "turn_on" : "turn_off"),
      {
        method: "POST",
        redirect: "error",
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ entity_id: entityId }),
        signal: AbortSignal.any([
          this.abort.signal,
          AbortSignal.timeout(10000),
        ]),
      },
    );
    await limited(response, 256 * 1024);
    requireThat(authorized(), 403, "control_forbidden");
    return { accepted: true };
  }
  async cameras() {
    const states = JSON.parse((await this.request("/api/states")).toString());
    requireThat(Array.isArray(states), 502, "ha_invalid_catalogue");
    return states
      .filter((s) => entity(s.entity_id))
      .slice(0, 64)
      .map((s) => {
        const available =
          Boolean((s.attributes?.supported_features || 0) & 2) &&
          !["unavailable", "unknown"].includes(s.state);
        return {
          name:
            String(s.attributes?.friendly_name || s.entity_id)
              .replace(/[\x00-\x1f\x7f]/g, "")
              .slice(0, 100) || s.entity_id,
          ha: { entityId: s.entity_id },
          available,
          reason: available ? null : "Flux HLS indisponible",
        };
      });
  }
  async streamPath(entityId) {
    requireThat(this.available, 503, "ha_not_configured");
    requireThat(entity(entityId));
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(
        this.base.replace(/^http/, "ws") +
          (this.supervisor ? "/core/websocket" : "/api/websocket"),
        { maxPayload: 65536, handshakeTimeout: 8000 },
      );
      this.sockets.add(ws);
      let done = false;
      const finish = (error, path) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.sockets.delete(ws);
        ws.terminate();
        error ? reject(error) : resolve(path);
      };
      const timer = setTimeout(
        () => finish(new Fault(504, "ha_stream_timeout")),
        10000,
      );
      ws.on("error", () => finish(new Fault(502, "ha_unavailable")));
      ws.on("close", () => finish(new Fault(502, "ha_unavailable")));
      ws.on("message", (raw) => {
        try {
          const m = JSON.parse(raw);
          if (m.type === "auth_required")
            ws.send(JSON.stringify({ type: "auth", access_token: this.token }));
          else if (m.type === "auth_ok")
            ws.send(
              JSON.stringify({
                id: 1,
                type: "camera/stream",
                entity_id: entityId,
                format: "hls",
              }),
            );
          else if (m.type === "auth_invalid")
            finish(new Fault(502, "ha_access_denied"));
          else if (m.type === "result" && m.id === 1) {
            requireThat(
              m.success && typeof m.result?.url === "string",
              502,
              "ha_stream_unavailable",
            );
            const u = this.resource(m.result.url);
            requireThat(
              u.pathname.endsWith(".m3u8"),
              502,
              "ha_invalid_playlist",
            );
            finish(null, u.pathname);
          }
        } catch {
          finish(new Fault(502, "ha_stream_unavailable"));
        }
      });
    });
  }
  resource(value, base = "/", root = null) {
    requireThat(
      typeof value === "string" &&
        value.length <= 1024 &&
        !value.includes("..") &&
        !/[\s\\%\x00-\x1f]/.test(value),
      502,
      "ha_unsafe_resource",
    );
    const u = new URL(value, this.base + base);
    requireThat(
      u.origin === this.base &&
        !u.username &&
        !u.password &&
        !u.search &&
        !u.hash &&
        /^\/api\/hls\/[A-Za-z0-9_-]+\/[A-Za-z0-9_./-]+$/.test(u.pathname) &&
        !u.pathname.includes("..") &&
        (!root || u.pathname.startsWith(root)),
      502,
      "ha_unsafe_resource",
    );
    return u;
  }
  register(s, path) {
    const extension = /\.(m3u8|m4s|mp4|ts)$/.exec(path)?.[1];
    requireThat(extension, 502, "ha_unsupported_resource");
    const key = digest(path).slice(0, 32) + "." + extension;
    for (const [k, v] of s.resources)
      if (Date.now() - v.last > 120000) s.resources.delete(k);
    requireThat(
      s.resources.size < 1024 || s.resources.has(key),
      503,
      "ha_resource_limit",
    );
    s.resources.set(key, { path, last: Date.now() });
    return key;
  }
  playlist(s, body, path) {
    const text = body.toString();
    requireThat(
      text.startsWith("#EXTM3U") && text.length <= 128 * 1024,
      502,
      "ha_invalid_playlist",
    );
    return text
      .split(/\r?\n/)
      .map((line) => {
        if (!line) return line;
        if (
          /^#EXT-X-(PART:|PART-INF:|PRELOAD-HINT:|RENDITION-REPORT:|SERVER-CONTROL:)/.test(
            line,
          )
        )
          return "";
        // No encryption keys, alternate sources, steering, or arbitrary URI-bearing tags.
        requireThat(
          !/^#EXT-X-(KEY|SESSION-KEY|MEDIA:|SESSION-DATA|CONTENT-STEERING|I-FRAME-STREAM-INF)/.test(
            line,
          ),
          502,
          "ha_unsupported_playlist",
        );
        const map = (value) =>
          this.register(s, this.resource(value, path, s.root).pathname);
        if (!line.startsWith("#")) return map(line);
        if (/URI=/.test(line)) {
          requireThat(
            line.startsWith("#EXT-X-MAP:") && /URI="[^"]+"/.test(line),
            502,
            "ha_unsupported_playlist",
          );
          return line.replace(
            /URI="([^"]+)"/,
            (_m, value) => `URI="${map(value)}"`,
          );
        }
        return line;
      })
      .join("\n");
  }
  async streamSource(entityId) {
    let s = [...this.sessions.values()].find((s) => s.entityId === entityId);
    if (!s) {
      requireThat(this.sessions.size < 4, 503, "ha_stream_limit");
      const path = await this.streamPath(entityId);
      s = {
        entityId,
        last: Date.now(),
        resources: new Map(),
        root: path.split("/").slice(0, 4).join("/") + "/",
      };
      const id = secret();
      this.sessions.set(id, s);
      s.id = id;
      s.initial = this.register(s, path);
    }
    s.last = Date.now();
    if (!this.starting) {
      this.starting = (async () => {
        this.server = createServer(async (req, res) => {
          try {
            const m =
              /^\/([A-Za-z0-9_-]{43})\/([a-f0-9]{32}\.(?:m3u8|m4s|mp4|ts))$/.exec(
                req.url || "",
              );
            requireThat(req.method === "GET" && m, 404, "not_found");
            const session = this.sessions.get(m[1]),
              r = session?.resources.get(m[2]);
            requireThat(r, 404, "not_found");
            session.last = r.last = Date.now();
            const playlist = r.path.endsWith(".m3u8");
            const body = await this.request(
              r.path,
              playlist ? 128 * 1024 : 8 * 1024 * 1024,
            );
            reply(
              res,
              200,
              playlist
                ? Buffer.from(this.playlist(session, body, r.path))
                : body,
              playlist
                ? "application/vnd.apple.mpegurl"
                : "application/octet-stream",
            );
          } catch (error) {
            failure(res, error);
          }
        });
        this.server.requestTimeout = 12000;
        this.server.headersTimeout = 10000;
        this.server.listen(0, "127.0.0.1");
        await once(this.server, "listening");
      })();
    }
    await this.starting;
    return `http://127.0.0.1:${this.server.address().port}/${s.id}/${s.initial}`;
  }
  stop(entityId) {
    for (const [id, s] of this.sessions)
      if (s.entityId === entityId) this.sessions.delete(id);
  }
  async close() {
    clearInterval(this.timer);
    this.abort.abort();
    for (const s of this.sockets) s.terminate();
    this.sessions.clear();
    if (this.server) {
      this.server.closeAllConnections();
      if (this.server.listening) await new Promise((r) => this.server.close(r));
    }
  }
}
