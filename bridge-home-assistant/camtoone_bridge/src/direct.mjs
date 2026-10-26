import { createServer } from "node:https";
import { createHash, createPrivateKey, X509Certificate } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  renameSync,
  chmodSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { networkInterfaces } from "node:os";
import {
  bearer,
  failure,
  jsonBody,
  publicPath,
  reply,
  requireThat,
} from "./common.mjs";
import { privateIp } from "./config.mjs";

function certificate(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const keyPath = join(directory, "local-identity.key"),
    certPath = join(directory, "local-identity.pem");
  if (!existsSync(keyPath) && !existsSync(certPath)) {
    const result = spawnSync(
      "openssl",
      [
        "req",
        "-new",
        "-x509",
        "-newkey",
        "ec",
        "-pkeyopt",
        "ec_paramgen_curve:P-256",
        "-nodes",
        "-keyout",
        keyPath + ".new",
        "-out",
        certPath + ".new",
        "-days",
        "3650",
        "-subj",
        "/CN=camtoone-bridge.local",
        "-addext",
        "subjectAltName=DNS:camtoone-bridge.local",
      ],
      { stdio: "ignore", timeout: 10000 },
    );
    requireThat(result.status === 0, 500, "local_identity_unavailable");
    chmodSync(keyPath + ".new", 0o600);
    chmodSync(certPath + ".new", 0o600);
    renameSync(keyPath + ".new", keyPath);
    renameSync(certPath + ".new", certPath);
  }
  // Fail closed on incomplete/corrupt identities rather than silently replacing a cached pin.
  const key = readFileSync(keyPath),
    cert = readFileSync(certPath),
    x509 = new X509Certificate(cert);
  requireThat(
    x509.checkPrivateKey(createPrivateKey(key)),
    500,
    "local_identity_invalid",
  );
  return {
    key,
    cert,
    der: x509.raw,
    sha256: createHash("sha256").update(x509.raw).digest("hex"),
  };
}
export function lanAddresses() {
  return [
    ...new Set(
      Object.entries(networkInterfaces())
        .filter(([name]) => !/^(docker|br-|veth|hassio)/.test(name))
        .flatMap(([, values]) => values || [])
        .filter(
          (v) => v.family === "IPv4" && !v.internal && privateIp(v.address),
        )
        .map((v) => v.address),
    ),
  ].slice(0, 8);
}
export async function createLocal({
  directory,
  bridgeId,
  handle,
  host = "0.0.0.0",
  port = 8098,
  addresses = lanAddresses(),
  allowClaim = false,
}) {
  requireThat(Number.isInteger(port) && port >= 0 && port <= 65535);
  requireThat(addresses.length <= 8 && addresses.every(privateIp));
  const identity = certificate(directory),
    prefix = "/v1/bridges/" + bridgeId;
  let active = 0,
    claims = 0,
    claimWindow = Date.now();
  const server = createServer(
    { key: identity.key, cert: identity.cert, minVersion: "TLSv1.2" },
    async (req, res) => {
      try {
        requireThat(active < 8, 503, "bridge_busy");
        requireThat(
          typeof req.url === "string" && req.url.startsWith(prefix + "/"),
          404,
          "not_found",
        );
        const path = req.url.slice(prefix.length),
          power =
            path === "/v1/ha/power" && req.method === "POST" && allowClaim,
          offer =
            path === "/v1/p2p/offer" && req.method === "POST" && !allowClaim,
          claim =
            allowClaim && path === "/pairing/claim" && req.method === "POST";
        requireThat(
          (req.method === "GET" && publicPath(path)) || offer || claim || power,
          404,
          "not_found",
        );
        requireThat(req.headers.origin === undefined, 403, "origin_denied");
        if (claim) {
          if (Date.now() - claimWindow >= 60000) {
            claims = 0;
            claimWindow = Date.now();
          }
          requireThat(++claims <= 20, 429, "claim_rate_limited");
        }
        active++;
        try {
          let timer;
          const payload =
            offer || claim || power
              ? await Promise.race([
                  jsonBody(req, power ? 1024 : claim ? 1024 : 16384),
                  new Promise((_, reject) => {
                    timer = setTimeout(() => {
                      req.destroy();
                      reject(new Error("body_deadline"));
                    }, 5000);
                  }),
                ]).finally(() => clearTimeout(timer))
              : null;
          if (claim)
            requireThat(
              payload &&
                typeof payload === "object" &&
                !Array.isArray(payload) &&
                Object.keys(payload).sort().join(",") === "code,name",
            );
          const result = await handle(
            { path, method: req.method, token: bearer(req), payload },
            "local",
          );
          reply(res, result.status, result.body, result.type);
        } finally {
          active--;
        }
      } catch (error) {
        failure(res, error);
      }
    },
  );
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.maxHeadersCount = 32;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const boundPort = server.address().port;
  return {
    server,
    metadata: {
      origins: addresses.map((ip) => `https://${ip}:${boundPort}`),
      certificate: identity.der.toString("base64"),
      sha256: identity.sha256,
    },
    async close() {
      server.closeAllConnections();
      if (server.listening) await new Promise((r) => server.close(r));
    },
  };
}
