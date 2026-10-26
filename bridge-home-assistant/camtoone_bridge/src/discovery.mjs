import { createSocket } from "node:dgram";
import { networkInterfaces } from "node:os";
import { randomUUID } from "node:crypto";
import xml2js from "xml2js";
import { privateIp } from "./config.mjs";
import { Fault, requireThat } from "./common.mjs";
export function interfaces() {
  return Object.entries(networkInterfaces()).flatMap(([name, addresses]) =>
    addresses
      .filter((a) => a.family === "IPv4" && !a.internal && privateIp(a.address))
      .map((a) => ({ name, address: a.address })),
  );
}
export async function discoveryMatch(message, address, messageId) {
  if (
    !privateIp(address) ||
    message.length > 32768 ||
    /<!DOCTYPE|<!ENTITY/i.test(message.toString())
  )
    return [];
  try {
    const doc = await xml2js.parseStringPromise(message.toString(), {
      explicitArray: false,
      tagNameProcessors: [xml2js.processors.stripPrefix],
    });
    const e = doc.Envelope;
    if (e?.Header?.RelatesTo !== messageId) return [];
    const match = e?.Body?.ProbeMatches?.ProbeMatch;
    return (Array.isArray(match) ? match : [match])
      .slice(0, 32)
      .flatMap((m) => {
        if (typeof m?.XAddrs !== "string") return [];
        for (const value of m.XAddrs.split(/\s+/).slice(0, 8)) {
          try {
            const u = new URL(value);
            if (
              !["http:", "https:"].includes(u.protocol) ||
              u.hostname !== address ||
              u.username ||
              u.password ||
              u.search ||
              u.hash ||
              !/^\/[a-zA-Z0-9_./-]{1,180}$/.test(u.pathname) ||
              u.pathname.includes("..")
            )
              continue;
            let name = "Caméra ONVIF · " + address;
            if (typeof m.Scopes === "string") {
              const scope = m.Scopes.split(/\s+/).find((s) =>
                s.startsWith("onvif://www.onvif.org/name/"),
              );
              if (scope)
                name =
                  decodeURIComponent(
                    scope.slice("onvif://www.onvif.org/name/".length),
                  )
                    .replace(/[\x00-\x1f\x7f]/g, "")
                    .trim()
                    .slice(0, 100) || name;
            }
            return [
              {
                name,
                onvif: {
                  host: address,
                  port: Number(u.port || (u.protocol === "https:" ? 443 : 80)),
                  path: u.pathname,
                  secure: u.protocol === "https:",
                  username: "",
                  password: "",
                },
              },
            ];
          } catch {}
        }
        return [];
      });
  } catch {
    return [];
  }
}
export class Discovery {
  constructor({
    socket = createSocket,
    addresses = interfaces,
    timeout = 4500,
    now = Date.now,
  } = {}) {
    this.socket = socket;
    this.addresses = addresses;
    this.timeout = timeout;
    this.now = now;
    this.last = -Infinity;
    this.busy = false;
    this.cancel = null;
  }
  async scan(address) {
    requireThat(
      !this.busy && this.now() - this.last >= 15000,
      429,
      "discovery_busy",
    );
    requireThat(
      this.addresses().some((a) => a.address === address),
      400,
      "interface_unavailable",
    );
    this.busy = true;
    this.last = this.now();
    try {
      return await new Promise((resolve, reject) => {
        const socket = this.socket("udp4"),
          id = "urn:uuid:" + randomUUID(),
          found = new Map();
        let count = 0,
          done = false;
        const finish = (error) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          try {
            socket.close();
          } catch {}
          this.cancel = null;
          error ? reject(error) : resolve([...found.values()]);
        };
        const timer = setTimeout(() => finish(), this.timeout);
        this.cancel = () => finish(new Fault(503, "discovery_stopped"));
        socket.on("error", () =>
          finish(new Fault(502, "discovery_unavailable")),
        );
        socket.on("message", async (msg, peer) => {
          if (done || ++count > 256) return;
          for (const camera of await discoveryMatch(msg, peer.address, id))
            if (!done && found.size < 64)
              found.set(
                `${camera.onvif.host}:${camera.onvif.port}:${camera.onvif.path}`,
                camera,
              );
        });
        socket.bind(0, address, () => {
          if (done) return;
          socket.setMulticastTTL(1);
          socket.setMulticastInterface(address);
          const request = Buffer.from(
            `<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:n="http://www.onvif.org/ver10/network/wsdl"><e:Header><a:MessageID>${id}</a:MessageID><a:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</a:To><a:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</a:Action></e:Header><e:Body><d:Probe><d:Types>n:NetworkVideoTransmitter</d:Types></d:Probe></e:Body></e:Envelope>`,
          );
          socket.send(request, 3702, "239.255.255.250", (error) => {
            if (error) finish(new Fault(502, "discovery_unavailable"));
          });
        });
      });
    } finally {
      this.busy = false;
    }
  }
  close() {
    this.cancel?.();
  }
}
