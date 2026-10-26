import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, stat, rm, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import onvif from "onvif";
import { rtspUrl } from "./config.mjs";
import { Fault, requireThat } from "./common.mjs";
export const MAX_MEDIA = 8 * 1024 * 1024;
export async function resolveSource(camera, Cam = onvif.Cam) {
  if (camera.rtsp) return rtspUrl(camera.rtsp).toString();
  const o = camera.onvif;
  const cam = await new Promise((resolve, reject) => {
    const c = new Cam(
      {
        hostname: o.host,
        port: o.port,
        path: o.path,
        useSecure: o.secure,
        username: o.username,
        password: o.password,
        timeout: 5000,
        preserveAddress: true,
      },
      (error) =>
        error ? reject(new Fault(502, "onvif_unavailable")) : resolve(c),
    );
  });
  const data = await new Promise((resolve, reject) =>
    cam.getStreamUri(
      { protocol: "RTSP", profileToken: o.profileToken },
      (error, data) =>
        error
          ? reject(new Fault(502, "onvif_stream_unavailable"))
          : resolve(data),
    ),
  );
  const u = rtspUrl(data.uri);
  requireThat(u.hostname === o.host, 502, "onvif_stream_host_mismatch");
  u.username = o.username;
  u.password = o.password;
  return u.toString();
}
export function ffmpegArgs(source, directory) {
  const http = source.startsWith("http://127.0.0.1:");
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    ...(http
      ? ["-rw_timeout", "10000000"]
      : ["-rtsp_transport", "tcp", "-timeout", "10000000"]),
    "-protocol_whitelist",
    http ? "http,tcp" : "tcp,udp,rtp,rtsp,crypto",
    "-i",
    source,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    "-f",
    "hls",
    "-hls_time",
    "2",
    "-hls_list_size",
    "5",
    "-hls_delete_threshold",
    "2",
    "-hls_flags",
    "delete_segments+temp_file",
    "-hls_start_number_source",
    "epoch_us",
    "-hls_segment_filename",
    join(directory, "segment-%d.ts"),
    join(directory, "index.m3u8"),
  ];
}
export class Media {
  constructor({
    cameras,
    directory,
    ffmpeg = "ffmpeg",
    spawnProcess = spawn,
    resolve = resolveSource,
    idleMs = 45000,
    onStop = () => {},
  }) {
    this.cameras = cameras;
    this.directory = directory;
    this.ffmpeg = ffmpeg;
    this.spawn = spawnProcess;
    this.resolve = resolve;
    this.sessions = new Map();
    this.idleMs = idleMs;
    this.onStop = onStop;
    this.closed = false;
    this.timer = setInterval(() => void this.sweep().catch(() => {}), 5000);
    this.timer.unref();
  }
  async start(camera) {
    const old = this.sessions.get(camera.id);
    if (old) return old.ready;
    requireThat(!this.closed && this.sessions.size < 4, 503, "stream_limit");
    const s = {
      last: Date.now(),
      directory: null,
      child: null,
      failed: false,
      stopping: false,
    };
    this.sessions.set(camera.id, s);
    s.ready = (async () => {
      try {
        const source = await this.resolve(camera);
        requireThat(!this.closed && !s.stopping, 503, "stream_stopped");
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        s.directory = await mkdtemp(join(this.directory, `${camera.id}-`));
        if (this.closed || s.stopping) {
          await rm(s.directory, { recursive: true, force: true });
          throw new Fault(503, "stream_stopped");
        }
        s.child = this.spawn(this.ffmpeg, ffmpegArgs(source, s.directory), {
          stdio: "ignore",
          shell: false,
        });
        s.child.on("error", () => {
          s.failed = true;
        });
        s.child.on("exit", () => {
          s.failed = true;
        });
        return s;
      } catch {
        if (this.sessions.get(camera.id) === s) await this.stop(camera.id);
        else if (s.directory)
          await rm(s.directory, { recursive: true, force: true });
        throw new Fault(502, "camera_unavailable");
      }
    })();
    return s.ready;
  }
  async read(id, file) {
    requireThat(
      file === "index.m3u8" || /^segment-[0-9]{1,20}\.ts$/.test(file),
      404,
      "media_not_found",
    );
    const camera = this.cameras.find((c) => c.id === id && c.exposed);
    requireThat(camera, 404, "camera_not_found");
    const s = await this.start(camera);
    s.last = Date.now();
    for (let i = 0; i < 100; i++) {
      if (s.failed || s.stopping) {
        await this.stop(id);
        throw new Fault(502, "camera_unavailable");
      }
      try {
        const target = join(s.directory, file),
          info = await stat(target);
        requireThat(
          info.isFile() && info.size <= MAX_MEDIA,
          502,
          "media_too_large",
        );
        const body = await readFile(target);
        requireThat(body.length <= MAX_MEDIA, 502, "media_too_large");
        return {
          status: 200,
          type: file.endsWith(".ts")
            ? "video/mp2t"
            : "application/vnd.apple.mpegurl",
          body,
        };
      } catch (e) {
        if (e instanceof Fault) throw e;
        if (e.code !== "ENOENT") throw new Fault(502, "media_unavailable");
      }
      if (file !== "index.m3u8") throw new Fault(404, "media_not_found");
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Fault(503, "stream_starting");
  }
  async stop(id) {
    const s = this.sessions.get(id);
    if (!s) return;
    if (s.dispose) return s.dispose;
    s.stopping = true;
    s.dispose = (async () => {
      const child = s.child;
      if (child && child.exitCode === null && child.signalCode === null) {
        await new Promise((resolve) => {
          let killTimer, deadline;
          const done = () => {
            clearTimeout(killTimer);
            clearTimeout(deadline);
            resolve();
          };
          child.once("close", done);
          killTimer = setTimeout(() => child.kill("SIGKILL"), 2000);
          deadline = setTimeout(done, 4000);
          child.kill("SIGTERM");
        });
      }
      if (s.directory) await rm(s.directory, { recursive: true, force: true });
      if (this.sessions.get(id) === s) this.sessions.delete(id);
      this.onStop(this.cameras.find((c) => c.id === id));
    })();
    return s.dispose;
  }
  async sweep() {
    for (const [id, s] of this.sessions) {
      let over = false;
      if (s.directory) {
        try {
          const files = await readdir(s.directory);
          let bytes = 0;
          for (const f of files)
            bytes += (await stat(join(s.directory, f))).size;
          over = bytes > 64 * 1024 * 1024;
        } catch {}
      }
      if (s.failed || over || Date.now() - s.last > this.idleMs)
        await this.stop(id);
    }
  }
  async close() {
    this.closed = true;
    clearInterval(this.timer);
    for (const id of [...this.sessions.keys()]) await this.stop(id);
  }
}
