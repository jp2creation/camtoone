import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import {
  validId,
  bearer,
  equal,
  secret,
  requireThat,
  Fault,
  reply,
  failure,
  jsonBody,
  publicPath,
} from "./common.mjs";
const MAX_FRAME = 64 * 1024;
export function createRelay({ registry, timeoutMs = 20000 }) {
  requireThat(
    registry &&
      Object.keys(registry).length <= 1000 &&
      Object.entries(registry).every(
        ([id, key]) => validId(id) && /^[A-Za-z0-9_-]{43}$/.test(key),
      ),
    500,
    "invalid_registry",
  );
  const peers = new Map(),
    limits = new Map();
  let closing = false;
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_FRAME,
    perMessageDeflate: false,
  });
  function limit(id, claim) {
    const now = Date.now(),
      key = id + (claim ? ":claim" : ":read");
    let slot = limits.get(key);
    if (!slot || now - slot.at >= 60000) {
      slot = { at: now, count: 0 };
      limits.set(key, slot);
    }
    requireThat(++slot.count <= (claim ? 12 : 600), 429, "rate_limited");
  }
  const server = createServer(async (req, res) => {
    try {
      if (req.url === "/health" && req.method === "GET") {
        reply(res, 200, { status: "ok" });
        return;
      }
      const match = /^\/v1\/bridges\/([A-Za-z0-9_-]{1,64})(\/.*)$/.exec(
        req.url || "",
      );
      requireThat(match && Object.hasOwn(registry, match[1]), 404, "not_found");
      const [, id, path] = match;
      const claim = path === "/pairing/claim";
      const offer = path === "/v1/p2p/offer";
      requireThat(
        ((claim || offer) && req.method === "POST") ||
          (!claim && req.method === "GET" && publicPath(path)),
        404,
        "not_found",
      );
      requireThat(path !== "/v1/ha/states", 403, "direct_required");
      // The VPS carries pairing/catalogue/signaling only, never HLS media.
      requireThat(!path.includes("/hls/"), 403, "relay_video_disabled");
      limit(id, claim);
      const peer = peers.get(id);
      requireThat(
        peer && peer.ws.readyState === WebSocket.OPEN,
        503,
        "bridge_offline",
      );
      requireThat(
        peer.pending.size < 8 && peer.ws.bufferedAmount < MAX_FRAME,
        503,
        "bridge_busy",
      );
      const payload =
        claim || offer ? await jsonBody(req, claim ? 2048 : 16384) : null;
      requireThat(
        peer.pending.size < 8 && peer.ws.readyState === WebSocket.OPEN,
        503,
        "bridge_busy",
      );
      const requestId = secret().slice(0, 22);
      await new Promise((resolve) => {
        const finish = (status, body, type) => {
          clearTimeout(timer);
          peer.pending.delete(requestId);
          if (!res.destroyed) reply(res, status, body, type);
          resolve();
        };
        const timer = setTimeout(
          () => finish(504, { error: "bridge_timeout" }),
          timeoutMs,
        );
        peer.pending.set(requestId, { finish });
        res.once("close", () => {
          if (peer.pending.has(requestId)) {
            clearTimeout(timer);
            peer.pending.delete(requestId);
            resolve();
          }
        });
        peer.ws.send(
          JSON.stringify({
            v: 1,
            id: requestId,
            path,
            method: req.method,
            token: bearer(req),
            payload,
          }),
          (error) => {
            if (error) finish(503, { error: "bridge_offline" });
          },
        );
      });
    } catch (error) {
      if (!res.headersSent) failure(res, error);
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.maxHeadersCount = 32;
  server.on("upgrade", (req, socket, head) => {
    const match = /^\/connect\/([A-Za-z0-9_-]{1,64})$/.exec(req.url || "");
    const id = match?.[1];
    let code = 401;
    if (
      !closing &&
      id &&
      Object.hasOwn(registry, id) &&
      equal(bearer(req), registry[id])
    ) {
      code = 409;
      if (!peers.has(id)) {
        wss.handleUpgrade(req, socket, head, (ws) => {
          const peer = { ws, pending: new Map(), alive: true };
          peers.set(id, peer);
          ws.on("pong", () => {
            peer.alive = true;
          });
          ws.on("error", () => {});
          ws.on("message", (data) => {
            try {
              const m = JSON.parse(data);
              const pending = peer.pending.get(m.id);
              if (!pending) return;
              requireThat(
                m.v === 1 &&
                  Number.isInteger(m.status) &&
                  m.status >= 200 &&
                  m.status <= 599 &&
                  typeof m.body === "string" &&
                  m.body.length <= MAX_FRAME &&
                  m.type === "application/json",
                502,
                "bad_bridge_response",
              );
              const body = Buffer.from(m.body, "base64");
              requireThat(body.length <= 48 * 1024, 502, "control_too_large");
              pending.finish(m.status, body, m.type);
            } catch {
              ws.close(1008, "Invalid response");
            }
          });
          ws.on("close", () => {
            if (peers.get(id) === peer) peers.delete(id);
            for (const { finish } of [...peer.pending.values()])
              finish(503, { error: "bridge_offline" });
          });
        });
        return;
      }
    }
    socket.end(
      `HTTP/1.1 ${code} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    );
  });
  const heartbeat = setInterval(() => {
    for (const peer of peers.values()) {
      if (!peer.alive) {
        peer.ws.terminate();
        continue;
      }
      peer.alive = false;
      peer.ws.ping();
    }
  }, 20000);
  heartbeat.unref();
  return {
    server,
    peers,
    async close() {
      closing = true;
      clearInterval(heartbeat);
      for (const p of peers.values()) p.ws.terminate();
      wss.close();
      server.closeAllConnections();
      if (server.listening) await new Promise((r) => server.close(r));
    },
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const registry = JSON.parse(
      readFileSync(process.env.REGISTRY_FILE || "/data/registry.json", "utf8"),
    );
    const relay = createRelay({ registry });
    relay.server.listen(
      Number(process.env.PORT || 8080),
      process.env.HOST || "127.0.0.1",
      () => console.log("Camtoone relay listening"),
    );
    const stop = async () => {
      await relay.close();
      process.exit(0);
    };
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
  } catch {
    console.error("Relay configuration invalid or unavailable");
    process.exit(1);
  }
}
