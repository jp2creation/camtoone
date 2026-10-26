import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { validId, secret, publicOrigin, requireThat } from "./common.mjs";
import { parseTicket } from "./pairing.mjs";
const [command, ...args] = process.argv.slice(2);
function writePrivate(file, value) {
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
}
try {
  if (command === "init") {
    const [directory, origin, id = "home"] = args;
    requireThat(directory && validId(id));
    const relay = publicOrigin(origin);
    const root = resolve(directory),
      bridgeDir = join(root, "bridge-data"),
      relayDir = join(root, "relay-data");
    mkdirSync(bridgeDir, { recursive: true, mode: 0o700 });
    mkdirSync(relayDir, { recursive: true, mode: 0o700 });
    requireThat(
      !existsSync(join(bridgeDir, "config.json")),
      409,
      "configuration_exists",
    );
    const registryFile = join(relayDir, "registry.json");
    const registry = existsSync(registryFile)
      ? JSON.parse(readFileSync(registryFile, "utf8"))
      : {};
    requireThat(!Object.hasOwn(registry, id), 409, "bridge_already_registered");
    const relayKey = secret();
    Object.defineProperty(registry, id, { value: relayKey, enumerable: true });
    writePrivate(join(bridgeDir, "config.json"), {
      bridgeId: id,
      relay,
      relayKey,
      adminKey: secret(),
      cameras: [],
    });
    writeFileSync(registryFile, JSON.stringify(registry, null, 2) + "\n", {
      mode: 0o600,
    });
    console.log(
      "Private bridge and relay configurations created. No credentials printed.",
    );
  } else if (command === "claim") {
    const [ticketFile, output] = args;
    requireThat(ticketFile && output);
    const ticket = parseTicket(readFileSync(ticketFile, "utf8").trim());
    const res = await fetch(
      `${ticket.relay}/v1/bridges/${ticket.bridgeId}/pairing/claim`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(25000),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: ticket.code,
          name: "Camtoone reference client",
        }),
      },
    );
    requireThat(res.ok, res.status, "pairing_failed");
    writePrivate(output, await res.json());
    console.log("Device paired; credential saved privately.");
  } else if (command === "probe") {
    const [deviceFile] = args;
    requireThat(deviceFile);
    const device = JSON.parse(readFileSync(deviceFile, "utf8"));
    const endpoint = new URL(device.endpoint);
    requireThat(
      endpoint.protocol === "https:" &&
        !endpoint.username &&
        !endpoint.password &&
        !endpoint.search &&
        !endpoint.hash,
    );
    const get = async (path) => {
      const res = await fetch(device.endpoint + "/" + path, {
        redirect: "error",
        signal: AbortSignal.timeout(25000),
        headers: { authorization: "Bearer " + device.token },
      });
      requireThat(res.ok, res.status, "probe_failed");
      return res;
    };
    const catalog = await (await get("v1/cameras")).json();
    console.log(`Authorized cameras: ${catalog.cameras.length}`);
    const camera = catalog.cameras[0];
    requireThat(camera, 409, "no_exposed_camera");
    const playlist = await (
      await get(`v1/cameras/${camera.id}/hls/index.m3u8`)
    ).text();
    const segment = playlist
      .split("\n")
      .find((line) => /^segment-[0-9]{1,20}\.ts$/.test(line));
    requireThat(segment, 502, "invalid_playlist");
    const bytes = (
      await (await get(`v1/cameras/${camera.id}/hls/${segment}`)).arrayBuffer()
    ).byteLength;
    console.log(
      `HLS playlist and media segment received (${bytes} bytes). Decoder/player proof still required.`,
    );
  } else {
    console.error(
      "Usage: node src/cli.mjs init DIRECTORY https://relay.example.com BRIDGE_ID | claim TICKET_FILE DEVICE_FILE | probe DEVICE_FILE",
    );
    process.exitCode = 1;
  }
} catch {
  console.error(
    "Action failed. Check arguments, private files and connectivity. No credentials logged.",
  );
  process.exitCode = 1;
}
