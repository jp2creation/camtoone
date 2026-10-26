import { HaCredentials, credentialUser } from "./ha-credentials.mjs";
import { createServer } from "node:http";
import { readFile, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import QRCode from "qrcode";
import { Pairing, invitationGrant, controlEntity } from "./pairing.mjs";
import {
  validateConfig,
  readConfig,
  loadState,
  saveState,
  publicCamera,
} from "./config.mjs";
import { CameraLibrary } from "./camera-library.mjs";
import { HomeAssistant } from "./home-assistant.mjs";
import { Discovery, interfaces } from "./discovery.mjs";
import { Media, resolveSource } from "./media.mjs";
import { Tunnel } from "./transport.mjs";
import { createLocal } from "./direct.mjs";
import { haTicket } from "./ha-direct.mjs";
import { Peers } from "./peer.mjs";
import {
  digest,
  bearer,
  equal,
  requireThat,
  Fault,
  reply,
  failure,
  publicPath,
  jsonBody,
} from "./common.mjs";
const json = (value) => ({
  status: 200,
  type: "application/json",
  body: Buffer.from(JSON.stringify(value)),
});
export async function createBridge({
  config,
  dataDir,
  development = false,
  media,
  ingress = false,
  ffmpeg = "ffmpeg",
  direct = false,
  homeAssistant,
  discovery,
  tunnelFactory = (options) => new Tunnel(options),
}) {
  validateConfig(config, development);
  const haDirect = config.connectionMode === "direct";
  requireThat(!haDirect || direct, 400, "local_https_required");
  const library = new CameraLibrary({
    directory: dataDir,
    cameras: config.cameras,
  });
  const cameras = library.cameras;
  const ha =
    homeAssistant ||
    new HomeAssistant({
      token: process.env.SUPERVISOR_TOKEN || process.env.HA_TOKEN,
      base: process.env.HA_URL || "http://supervisor",
    });
  const search = discovery || new Discovery();
  const pairing = new Pairing({
    bridgeId: config.bridgeId,
    relay: haDirect ? "https://camtoone-bridge.local" : config.relay,
    development,
    state: loadState(dataDir),
    persist: (state) => saveState(dataDir, state),
  });
  if (!media)
    await rm(join(dataDir, "runtime"), { recursive: true, force: true });
  const video =
    media ||
    new Media({
      cameras,
      resolve: (camera) =>
        camera.ha ? ha.streamSource(camera.ha.entityId) : resolveSource(camera),
      directory: join(dataDir, "runtime"),
      ffmpeg,
      onStop: (camera) => {
        if (camera?.ha) ha.stop(camera.ha.entityId);
      },
    });
  const stats = {
    relayMediaBytes: 0,
    localMediaBytes: 0,
    p2pMediaBytes: 0,
    relayRequests: 0,
    localRequests: 0,
    p2pRequests: 0,
  };
  let local = null,
    peers = null;
  const stun =
    direct && !haDirect
      ? (direct.stun ?? [`stun:${new URL(config.relay).hostname}:3478`])
      : [];
  const connectivity = () =>
    local
      ? {
          version: 1,
          relayVideo: false,
          local: haDirect
            ? { ...local.metadata, origins: [local.metadata.origins[0]] }
            : local.metadata,
          p2p: { enabled: Boolean(peers), stun },
        }
      : null;
  const powerInFlight = new Set();
  const powerWindows = new Map();
  const dashboardCapability = (token) =>
    ha.available && pairing.dashboardGranted(token)
      ? { haDashboard: { version: 1, readOnly: true } }
      : {};
  const dashboardAuthorized = (token) => {
    requireThat(pairing.authorized(token), 401, "unauthorized");
    requireThat(pairing.dashboardGranted(token), 403, "dashboard_forbidden");
  };
  const handle = async (m, route = "relay") => {
    requireThat(!haDirect || route === "local", 403, "direct_required");
    if (m.path === "/pairing/claim" && m.method === "POST") {
      const device = pairing.claim(m.payload?.code, m.payload?.name);
      return json({
        ...device,
        ...(haDirect
          ? {
              mode: "ha-direct",
              endpoint: `${local.metadata.origins[0]}/v1/bridges/${config.bridgeId}`,
              externalEndpoint: config.externalOrigin
                ? `${config.externalOrigin}/v1/bridges/${config.bridgeId}`
                : "",
            }
          : {}),
        ...(local ? { connectivity: connectivity() } : {}),
        ...dashboardCapability(device.token),
      });
    }
    const power = m.path === "/v1/ha/power" && m.method === "POST";
    if (power) {
      requireThat(haDirect && route === "local", 403, "direct_required");
      dashboardAuthorized(m.token);
      const input = m.payload;
      requireThat(
        input &&
          typeof input === "object" &&
          !Array.isArray(input) &&
          Object.keys(input).sort().join(",") === "enabled,entityId" &&
          controlEntity(input.entityId) &&
          typeof input.enabled === "boolean",
        400,
        "invalid_power_target",
      );
      const epoch = pairing.controlEpoch(m.token);
      const authorized = () =>
        pairing.controlEpoch(m.token) === epoch &&
        pairing.canControl(m.token, input.entityId);
      requireThat(authorized(), 403, "control_forbidden");
      requireThat(ha.available, 503, "ha_not_configured");
      requireThat(!powerInFlight.has(input.entityId), 409, "power_busy");
      const now = Date.now();
      // The device limit bounds this map; do not retain raw bearer tokens as keys.
      const deviceId = pairing.device(m.token).id;
      for (const id of powerWindows.keys())
        if (!pairing.state.some((d) => d.id === id)) powerWindows.delete(id);
      const deviceRecent = (powerWindows.get(deviceId) || []).filter(
        (at) => now - at < 60000,
      );
      requireThat(deviceRecent.length < 20, 429, "power_rate_limited");
      powerWindows.set(deviceId, [...deviceRecent, now]);
      powerInFlight.add(input.entityId);
      try {
        await ha.setPower(input.entityId, input.enabled, authorized);
        requireThat(authorized(), 403, "control_forbidden");
      } finally {
        powerInFlight.delete(input.entityId);
      }
      stats.localRequests++;
      return json({ accepted: true });
    }
    const offer = m.path === "/v1/p2p/offer" && m.method === "POST";
    requireThat(
      offer || (m.method === "GET" && publicPath(m.path)),
      404,
      "not_found",
    );
    if (m.path === "/v1/ha/states" || m.path === "/v2/ha/states") {
      requireThat(route === "local" || route === "p2p", 403, "direct_required");
      dashboardAuthorized(m.token);
      requireThat(ha.available, 503, "ha_not_configured");
      let result;
      try {
        result = await ha.dashboardStates();
      } finally {
        // Revocation wins even if the in-flight upstream request failed.
        dashboardAuthorized(m.token);
      }
      requireThat(ha.available, 503, "ha_not_configured");
      stats[route + "Requests"]++;
      if (m.path === "/v2/ha/states") {
        const present = new Set(result.entities.map((row) => row.entityId));
        return json({
          version: 2,
          entities: result.entities,
          haControl: {
            version: 1,
            actions: ["power"],
            entityIds: haDirect
              ? pairing.controlEntities(m.token).filter((id) => present.has(id))
              : [],
          },
        });
      }
      return json(result);
    }
    requireThat(pairing.authorized(m.token), 401, "unauthorized");
    stats[route + "Requests"]++;
    if (offer) {
      requireThat(peers, 404, "p2p_unavailable");
      return json(await peers.offer(m.payload, m.token));
    }
    if (m.path === "/v1/connectivity") {
      requireThat(local, 404, "direct_unavailable");
      return json(connectivity());
    }
    if (m.path === "/v1/cameras")
      return json({
        version: 1,
        cameras: cameras.filter((c) => c.exposed).map(publicCamera),
        ...dashboardCapability(m.token),
      });
    requireThat(route !== "relay", 403, "relay_video_disabled");
    const match = /^\/v1\/cameras\/([A-Za-z0-9_-]+)\/hls\/(.+)$/.exec(m.path);
    requireThat(
      cameras.some((c) => c.id === match[1] && c.exposed),
      404,
      "camera_not_found",
    );
    const result = await video.read(match[1], match[2]);
    requireThat(pairing.authorized(m.token), 401, "unauthorized");
    requireThat(
      cameras.some((c) => c.id === match[1] && c.exposed),
      404,
      "camera_not_found",
    );
    if (result.status === 200 && result.type === "video/mp2t")
      stats[route + "MediaBytes"] += result.body.length;
    return result;
  };
  if (direct) {
    try {
      local = await createLocal({
        directory: dataDir,
        bridgeId: config.bridgeId,
        handle,
        ...direct,
        allowClaim: haDirect,
      });
      requireThat(
        !haDirect || local.metadata.origins.length > 0,
        400,
        "local_address_unavailable",
      );
      if (!haDirect && config.p2pEnabled !== false)
        peers = new Peers({
          authorized: (token) => pairing.authorized(token),
          handle,
          stun,
        });
    } catch (error) {
      await local?.close();
      await video.close();
      throw error;
    }
  }
  const transport = haDirect
    ? { connected: true, close() {} }
    : tunnelFactory({ config, handle });
  const credentials = new HaCredentials({
    directory: dataDir,
    installationId: digest(
      JSON.stringify([config.bridgeId, local?.metadata.sha256 ?? ""]),
    ),
    verify: (token) => ha.credentialUser(token),
  });
  const server = createServer(async (req, res) => {
    try {
      // Ingress identity comes from the actual TCP peer, never X-Forwarded-For.
      if (ingress)
        requireThat(
          ["172.30.32.2", "::ffff:172.30.32.2"].includes(
            req.socket.remoteAddress,
          ),
          403,
          "ingress_only",
        );
      if (req.url === "/" && req.method === "GET") {
        const html = await readFile(new URL("./admin.html", import.meta.url));
        res.setHeader(
          "Content-Security-Policy",
          "default-src 'none'; script-src 'self'; style-src 'self'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'self'",
        );
        reply(res, 200, html, "text/html; charset=utf-8");
        return;
      }
      if (
        [
          "/admin.js",
          "/i18n.js",
          "/admin.css",
          "/ha-qr.js",
          "/qrcode-browser.js",
        ].includes(req.url) &&
        req.method === "GET"
      ) {
        reply(
          res,
          200,
          await readFile(new URL("." + req.url, import.meta.url)),
          req.url.endsWith(".js") ? "text/javascript" : "text/css",
        );
        return;
      }
      const credentialRoutes = [
        "/admin/ha/connection",
        "/admin/ha/connection/settings",
        "/admin/ha/connection/credential/get",
        "/admin/ha/connection/credential/reserve",
        "/admin/ha/connection/credential/store",
        "/admin/ha/connection/credential/release",
      ];
      if (credentialRoutes.includes(req.url)) {
        const uid = credentialUser(req, ingress);
        requireThat(haDirect && local, 403, "direct_required");
        if (req.url === "/admin/ha/connection") {
          requireThat(req.method === "GET", 405, "method_not_allowed");
          reply(res, 200, credentials.connection(uid));
          return;
        }
        requireThat(req.method === "POST", 405, "method_not_allowed");
        const body = await jsonBody(req, 16384);
        requireThat(
          body && typeof body === "object" && !Array.isArray(body),
          400,
          "invalid_request",
        );
        const action = req.url.split("/").at(-1),
          keys = Object.keys(body).sort().join(",");
        requireThat(
          keys ===
            (action === "settings"
              ? "externalUrl,internalUrl"
              : action === "store"
                ? "lease,token"
                : action === "release"
                  ? "lease"
                  : ""),
          400,
          "invalid_request",
        );
        const result =
          action === "settings"
            ? credentials.saveUrls(uid, body)
            : action === "get"
              ? { token: await credentials.get(uid) }
              : action === "reserve"
                ? credentials.reserve(uid)
                : action === "store"
                  ? await credentials.store(uid, body.lease, body.token)
                  : credentials.release(uid, body.lease);
        reply(res, 200, result);
        return;
      }
      requireThat(
        ingress || equal(bearer(req), config.adminKey),
        401,
        "unauthorized",
      );
      // No CORS, and reject cross-site mutation even if a caller somehow supplies a key.
      requireThat(
        !req.headers.origin ||
          req.headers.origin === `http://${req.headers.host}` ||
          (ingress && req.headers["sec-fetch-site"] === "same-origin"),
        403,
        "origin_denied",
      );
      if (req.url === "/admin/status" && req.method === "GET") {
        reply(res, 200, {
          version: JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version,
          connectionMode: config.connectionMode,
          haAvailable: ha.available,
          bridgeId: config.bridgeId,
          connected: transport.connected,
          cameras: cameras.filter((c) => c.exposed).map(publicCamera),
          devices: pairing.devices(),
          invitationActive: pairing.active(),
          connectivity: connectivity(),
          connectivityStats: { ...stats, peers: peers?.peers.size || 0 },
        });
        return;
      }
      if (req.url === "/admin/ha/control-entities" && req.method === "GET") {
        requireThat(haDirect, 403, "direct_required");
        const states = await ha.dashboardStates();
        reply(res, 200, {
          entities: states.entities.filter((row) =>
            controlEntity(row.entityId),
          ),
        });
        return;
      }
      const powerGrant =
        /^\/admin\/devices\/([A-Za-z0-9_-]{1,64})\/ha-control$/.exec(
          req.url || "",
        );
      if (powerGrant && req.method === "POST") {
        requireThat(haDirect, 403, "direct_required");
        const input = await jsonBody(req, 32768);
        requireThat(
          input &&
            Object.keys(input).join(",") === "entities" &&
            Array.isArray(input.entities) &&
            input.entities.length <= 32 &&
            input.entities.every(controlEntity) &&
            new Set(input.entities).size === input.entities.length,
        );
        const current = pairing.state.find((d) => d.id === powerGrant[1]);
        requireThat(current, 404, "device_not_found");
        requireThat(
          current.dashboardRead === true || input.entities.length === 0,
          403,
          "dashboard_forbidden",
        );
        const epoch = pairing.beginControlEdit(powerGrant[1]);
        const previous = new Set(
          current.control === true ? current.powerEntities || [] : [],
        );
        const additions = input.entities.filter((id) => !previous.has(id));
        // Reducing or revoking an existing grant must work even when HA is offline.
        if (additions.length) {
          const states = await ha.dashboardStates();
          const present = new Set(states.entities.map((row) => row.entityId));
          requireThat(
            additions.every((id) => present.has(id)),
            400,
            "unknown_control_entity",
          );
        }
        pairing.setControlEntities(powerGrant[1], input.entities, epoch);
        reply(res, 200, { saved: true });
        return;
      }
      if (req.url === "/admin/cameras" && req.method === "GET") {
        reply(res, 200, { ...library.snapshot(), haAvailable: ha.available });
        return;
      }
      if (req.url === "/admin/sources/ha" && req.method === "POST") {
        reply(res, 200, {
          candidates: library.offer(await ha.cameras(), "ha"),
        });
        return;
      }
      if (req.url === "/admin/sources/interfaces" && req.method === "GET") {
        reply(res, 200, { interfaces: interfaces() });
        return;
      }
      if (req.url === "/admin/sources/onvif" && req.method === "POST") {
        const input = await jsonBody(req);
        reply(res, 200, {
          candidates: library.offer(await search.scan(input?.address), "onvif"),
        });
        return;
      }
      if (req.url === "/admin/cameras" && req.method === "PUT") {
        const previous = cameras.filter((c) => c.exposed);
        const result = library.update(await jsonBody(req, 32768));
        for (const camera of previous)
          if (!cameras.some((c) => c.id === camera.id && c.exposed)) {
            await video.stop?.(camera.id);
            if (camera.ha) ha.stop(camera.ha.entityId);
          }
        reply(res, 200, result);
        return;
      }
      const cameraRemoval = /^\/admin\/cameras\/([A-Za-z0-9_-]{1,64})$/.exec(
        req.url || "",
      );
      if (cameraRemoval && req.method === "DELETE") {
        const camera = cameras.find((c) => c.id === cameraRemoval[1]);
        const input = await jsonBody(req);
        const result = library.remove(cameraRemoval[1], input?.revision);
        if (camera) {
          await video.stop?.(camera.id);
          if (camera.ha) ha.stop(camera.ha.entityId);
        }
        reply(res, 200, result);
        return;
      }
      if (req.url === "/admin/invitations" && req.method === "POST") {
        const input = await jsonBody(req, 1024, true);
        const explicitGrant = invitationGrant(input);
        const dashboardRead = Object.hasOwn(input, "dashboardRead")
          ? explicitGrant
          : ha.available;
        requireThat(!dashboardRead || ha.available, 503, "ha_not_configured");
        const invitation = pairing.invite({ dashboardRead });
        if (haDirect)
          invitation.ticket = haTicket({
            bridgeId: config.bridgeId,
            code: invitation.code,
            localOrigin: local.metadata.origins[0],
            externalOrigin: config.externalOrigin,
            certificate: local.metadata.certificate,
            sha256: local.metadata.sha256,
          });
        reply(res, 200, {
          ...invitation,
          dashboardRead,
          qr: await QRCode.toDataURL(invitation.ticket, {
            errorCorrectionLevel: "M",
            margin: 4,
            ...(haDirect ? { scale: 6 } : { width: 360 }),
          }),
        });
        return;
      }
      const del = /^\/admin\/devices\/([A-Za-z0-9_-]{22})$/.exec(req.url || "");
      if (del && req.method === "DELETE") {
        pairing.revoke(del[1]);
        peers?.revokeUnauthorized();
        reply(res, 200, { revoked: true });
        return;
      }
      throw new Fault(404, "not_found");
    } catch (e) {
      failure(res, e);
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  return {
    server,
    transport,
    pairing,
    library,
    local,
    peers,
    stats,
    async close() {
      transport.close();
      await peers?.close();
      await local?.close();
      await video.close();
      search.close();
      await ha.close();
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
    const dataDir = process.env.DATA_DIR || "/data";
    const ha = process.env.HA_INGRESS === "1";
    const config = readConfig(
      process.env.CONFIG_FILE ||
        join(dataDir, ha ? "options.json" : "config.json"),
    );
    const bridge = await createBridge({
      config,
      dataDir,
      ingress: ha,
      ffmpeg: process.env.FFMPEG_PATH || "ffmpeg",
      direct:
        config.directEnabled === false
          ? false
          : { port: config.localPort || 8098 },
    });
    bridge.server.listen(
      Number(process.env.PORT || 8099),
      process.env.HOST || (ha ? "0.0.0.0" : "127.0.0.1"),
      () => console.log("Camtoone Bridge listening"),
    );
    const stop = async () => {
      await bridge.close();
      process.exit(0);
    };
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
  } catch {
    console.error(
      "Bridge configuration invalid or unavailable; check private configuration",
    );
    process.exit(1);
  }
}
