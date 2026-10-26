import { RTCPeerConnection } from "werift";
import { Fault, digest, requireThat, secret, publicPath } from "./common.mjs";

const FRAME = 32768,
  CHUNK = 16384,
  MAX_BODY = 8 * 1024 * 1024;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
export class Peers {
  constructor({ authorized, handle, stun = [], maxPeers = 8 }) {
    this.authorized = authorized;
    this.handle = handle;
    this.stun = stun;
    this.maxPeers = maxPeers;
    this.peers = new Map();
    this.closed = false;
    this.sweep = setInterval(() => {
      for (const [id, p] of this.peers)
        if (
          !authorized(p.token) ||
          Date.now() - p.last > 60000 ||
          (p.channel?.readyState !== "open" && Date.now() - p.created > 20000)
        )
          void this.drop(id);
    }, 1000);
    this.sweep.unref();
  }
  async drop(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    peer.closed = true;
    peer.channel?.close();
    await peer.pc.close().catch(() => {});
  }
  revokeUnauthorized() {
    for (const [id, p] of this.peers)
      if (!this.authorized(p.token)) void this.drop(id);
  }
  async offer(payload, token) {
    requireThat(this.authorized(token), 401, "unauthorized");
    requireThat(
      !this.closed &&
        this.peers.size < this.maxPeers &&
        [...this.peers.values()].filter(
          (p) => digest(p.token) === digest(token),
        ).length < 2,
      503,
      "bridge_busy",
    );
    requireThat(
      payload?.type === "offer" &&
        typeof payload.sdp === "string" &&
        Buffer.byteLength(payload.sdp) <= 16384 &&
        payload.sdp.startsWith("v=0") &&
        !/[\x00]/.test(payload.sdp) &&
        (payload.sdp.match(/^m=/gm) || []).length === 1 &&
        /^m=application /m.test(payload.sdp),
      400,
      "invalid_offer",
    );
    const pc = new RTCPeerConnection({
      iceServers: this.stun.map((url) => ({ urls: url })),
      iceStunGatherTimeout: 3,
      iceUseTcp: false,
      iceUseIpv6: false,
      maxMessageSize: FRAME,
    });
    const id = secret().slice(0, 22),
      now = Date.now();
    const peer = {
      pc,
      token,
      created: now,
      last: now,
      active: new Set(),
      channel: null,
      closed: false,
    };
    this.peers.set(id, peer);
    pc.onconnectionstatechange = () => {
      if (["failed", "closed"].includes(pc.connectionState)) void this.drop(id);
    };
    pc.ondatachannel = ({ channel }) => {
      if (
        peer.channel ||
        channel.label !== "camtoone-v1" ||
        !channel.ordered ||
        channel.maxRetransmits != null ||
        channel.maxPacketLifeTime != null
      ) {
        channel.close();
        void this.drop(id);
        return;
      }
      peer.channel = channel;
      channel.onclose = () => void this.drop(id);
      channel.onmessage = ({ data }) => {
        void this.receive(id, peer, data).catch(() => this.drop(id));
      };
    };
    try {
      await pc.setRemoteDescription({ type: "offer", sdp: payload.sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      requireThat(!peer.closed && this.peers.has(id), 503, "peer_unavailable");
      const answer = { type: "answer", sdp: pc.localDescription.sdp };
      requireThat(
        Buffer.byteLength(JSON.stringify(answer)) <= 16384,
        502,
        "answer_too_large",
      );
      return answer;
    } catch (error) {
      await this.drop(id);
      throw error instanceof Fault ? error : new Fault(400, "invalid_offer");
    }
  }
  async receive(id, peer, data) {
    requireThat(
      !peer.closed && Buffer.byteLength(data) <= FRAME,
      400,
      "invalid_peer_frame",
    );
    let m;
    try {
      m = JSON.parse(data.toString());
    } catch {
      throw new Fault(400, "invalid_peer_frame");
    }
    requireThat(
      m?.v === 1 &&
        typeof m.id === "string" &&
        /^[A-Za-z0-9_-]{22}$/.test(m.id) &&
        m.method === "GET" &&
        typeof m.path === "string" &&
        publicPath(m.path) &&
        m.path !== "/v1/connectivity" &&
        !peer.active.has(m.id) &&
        peer.active.size < 4,
      400,
      "invalid_peer_request",
    );
    peer.active.add(m.id);
    peer.last = Date.now();
    try {
      let response;
      try {
        requireThat(this.authorized(peer.token), 401, "unauthorized");
        response = await this.handle({ ...m, token: peer.token }, "p2p");
      } catch (error) {
        response = {
          status: error instanceof Fault ? error.status : 502,
          type: "application/json",
          body: Buffer.from(
            JSON.stringify({
              error:
                error instanceof Fault ? error.code : "operation_unavailable",
            }),
          ),
        };
      }
      const body = response.body;
      requireThat(
        Buffer.isBuffer(body) && body.length <= MAX_BODY,
        502,
        "media_too_large",
      );
      let seq = 0;
      for (
        let offset = 0;
        offset < body.length || offset === 0;
        offset += CHUNK
      ) {
        const deadline = Date.now() + 15000;
        while (
          peer.channel?.readyState === "open" &&
          peer.channel.bufferedAmount > 262144 &&
          Date.now() < deadline
        )
          await pause(10);
        requireThat(
          !peer.closed &&
            peer.channel?.readyState === "open" &&
            peer.channel.bufferedAmount <= 262144,
          503,
          "peer_busy",
        );
        // Authorization remains mandatory while a large response is being sent.
        if (response.status === 200)
          requireThat(this.authorized(peer.token), 401, "unauthorized");
        peer.channel.send(
          JSON.stringify({
            v: 1,
            id: m.id,
            status: response.status,
            type: response.type,
            seq: seq++,
            final: offset + CHUNK >= body.length,
            body: body.subarray(offset, offset + CHUNK).toString("base64"),
          }),
        );
      }
    } finally {
      peer.active.delete(m.id);
    }
  }
  async close() {
    this.closed = true;
    clearInterval(this.sweep);
    await Promise.all([...this.peers.keys()].map((id) => this.drop(id)));
  }
}
