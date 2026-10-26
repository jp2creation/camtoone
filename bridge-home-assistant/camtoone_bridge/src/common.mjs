import { createHash, timingSafeEqual, randomBytes } from "node:crypto";
export const validId = (value) =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
export const secret = () => randomBytes(32).toString("base64url");
export const digest = (value) =>
  createHash("sha256").update(String(value)).digest("hex");
export const equal = (a, b) =>
  timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b)));
export class Fault extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
export function requireThat(ok, status = 400, code = "invalid_request") {
  if (!ok) throw new Fault(status, code);
}
export function publicOrigin(value, development = false) {
  const u = new URL(value);
  requireThat(
    !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      u.pathname === "/" &&
      (u.protocol === "https:" ||
        (development &&
          u.protocol === "http:" &&
          ["127.0.0.1", "localhost"].includes(u.hostname))),
  );
  return u.origin;
}
export function bearer(req) {
  const h = req.headers.authorization;
  return typeof h === "string" && /^Bearer [A-Za-z0-9_-]{43}$/.test(h)
    ? h.slice(7)
    : "";
}
export async function jsonBody(req, limit = 16384, allowEmpty = false) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    requireThat(size <= limit, 413, "body_too_large");
    chunks.push(chunk);
  }
  if (allowEmpty && size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new Fault(400, "invalid_json");
  }
}
export function reply(res, status, body, type = "application/json") {
  const data = Buffer.isBuffer(body)
    ? body
    : Buffer.from(type === "application/json" ? JSON.stringify(body) : body);
  res.writeHead(status, {
    "Content-Type": type,
    "Content-Length": data.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  res.end(data);
}
export const failure = (res, error) =>
  reply(res, error instanceof Fault ? error.status : 502, {
    error: error instanceof Fault ? error.code : "operation_unavailable",
  });
export function publicPath(path) {
  return (
    path === "/v1/cameras" ||
    path === "/v1/ha/states" ||
    path === "/v2/ha/states" ||
    path === "/v1/connectivity" ||
    /^\/v1\/cameras\/[a-zA-Z0-9_-]{1,64}\/hls\/(index\.m3u8|segment-[0-9]{1,20}\.ts)$/.test(
      path,
    )
  );
}
