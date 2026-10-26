import { createHash, X509Certificate } from "node:crypto";
import { haOrigin } from "./config.mjs";
import { requireThat, validId, Fault } from "./common.mjs";
const prefix = "CAMTOONE-HA:1:";
export function parseHaTicket(raw) {
  requireThat(
    typeof raw === "string" && raw.length <= 8192 && raw.startsWith(prefix),
    400,
    "invalid_ticket",
  );
  let data;
  try {
    const encoded = raw.slice(prefix.length);
    requireThat(/^[A-Za-z0-9_-]+$/.test(encoded));
    const bytes = Buffer.from(encoded, "base64url");
    requireThat(bytes.toString("base64url") === encoded);
    data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    requireThat(
      data &&
        Object.keys(data).sort().join(",") ===
          "bridgeId,certificate,code,externalOrigin,localOrigin,sha256,version",
    );
    requireThat(
      data.version === 1 &&
        validId(data.bridgeId) &&
        typeof data.code === "string" &&
        /^[A-Za-z0-9_-]{43}$/.test(data.code),
    );
    haOrigin(data.localOrigin, true);
    requireThat(typeof data.externalOrigin === "string");
    if (data.externalOrigin !== "") haOrigin(data.externalOrigin);
    requireThat(
      typeof data.certificate === "string" &&
        data.certificate.length >= 128 &&
        data.certificate.length <= 4096 &&
        /^[A-Za-z0-9+/]+={0,2}$/.test(data.certificate),
    );
    const der = Buffer.from(data.certificate, "base64");
    requireThat(
      der.toString("base64") === data.certificate &&
        new X509Certificate(der).raw.equals(der),
    );
    requireThat(
      typeof data.sha256 === "string" &&
        /^[a-f0-9]{64}$/.test(data.sha256) &&
        createHash("sha256").update(der).digest("hex") === data.sha256,
    );
    return data;
  } catch {
    throw new Fault(400, "invalid_ticket");
  }
}
export function haTicket({
  bridgeId,
  code,
  localOrigin,
  externalOrigin = "",
  certificate,
  sha256,
}) {
  const raw =
    prefix +
    Buffer.from(
      JSON.stringify({
        version: 1,
        bridgeId,
        code,
        localOrigin,
        externalOrigin,
        certificate,
        sha256,
      }),
    ).toString("base64url");
  parseHaTicket(raw);
  return raw;
}
