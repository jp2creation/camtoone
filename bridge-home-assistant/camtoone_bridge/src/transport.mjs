import WebSocket from "ws";
import { Fault } from "./common.mjs";
export class Tunnel {
  constructor({ config, handle }) {
    this.config = config;
    this.handle = handle;
    this.connected = false;
    this.closed = false;
    this.attempt = 0;
    this.timer = null;
    this.ws = null;
    this.connect();
  }
  connect() {
    if (this.closed) return;
    const u = new URL(this.config.relay);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    u.pathname = "/connect/" + this.config.bridgeId;
    const ws = new WebSocket(u, {
      headers: { authorization: "Bearer " + this.config.relayKey },
      maxPayload: 32768,
      perMessageDeflate: false,
      handshakeTimeout: 10000,
    });
    this.ws = ws;
    let active = 0;
    ws.on("open", () => {
      this.connected = true;
      this.attempt = 0;
    });
    ws.on("error", () => {});
    ws.on("close", () => {
      this.connected = false;
      if (!this.closed) {
        const delay = Math.min(30000, 1000 * 2 ** Math.min(this.attempt++, 5));
        this.timer = setTimeout(
          () => this.connect(),
          delay + Math.random() * 300,
        );
        this.timer.unref();
      }
    });
    ws.on("message", async (data) => {
      let m;
      try {
        m = JSON.parse(data);
        if (
          m.v !== 1 ||
          typeof m.id !== "string" ||
          !/^[A-Za-z0-9_-]{22}$/.test(m.id) ||
          typeof m.path !== "string"
        )
          throw new Error();
      } catch {
        ws.close(1008, "Invalid request");
        return;
      }
      let result;
      try {
        if (active >= 8) throw new Fault(503, "bridge_busy");
        active++;
        try {
          result = await this.handle(m);
        } finally {
          active--;
        }
      } catch (e) {
        result = {
          status: e instanceof Fault ? e.status : 502,
          type: "application/json",
          body: Buffer.from(
            JSON.stringify({
              error: e instanceof Fault ? e.code : "operation_unavailable",
            }),
          ),
        };
      }
      if (ws.readyState === WebSocket.OPEN) {
        if (ws.bufferedAmount > 12 * 1024 * 1024) {
          ws.close(1013, "Busy");
          return;
        }
        ws.send(
          JSON.stringify({
            v: 1,
            id: m.id,
            status: result.status,
            type: result.type,
            body: result.body.toString("base64"),
          }),
        );
      }
    });
  }
  close() {
    this.closed = true;
    this.connected = false;
    clearTimeout(this.timer);
    this.ws?.terminate();
  }
}
