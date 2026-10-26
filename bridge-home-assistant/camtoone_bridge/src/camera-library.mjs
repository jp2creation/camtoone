import { digest, secret, requireThat, validId } from "./common.mjs";
import { loadState, saveState, validateCamera } from "./config.mjs";
const identity = (c) =>
  c.ha
    ? `ha:${c.ha.entityId}`
    : c.onvif
      ? `onvif:${c.onvif.host}:${c.onvif.port}:${c.onvif.path || "/onvif/device_service"}`
      : `rtsp:${c.rtsp}`;
export class CameraLibrary {
  constructor({ directory, cameras, now = Date.now }) {
    this.directory = directory;
    this.manual = structuredClone(cameras);
    this.now = now;
    this.candidates = new Map();
    const stored = loadState(directory, "cameras.enc");
    this.state =
      Array.isArray(stored) && stored.length === 0
        ? { version: 1, revision: 0, imports: [], selection: {} }
        : stored;
    const s = this.state;
    requireThat(
      s.version === 1 &&
        Number.isSafeInteger(s.revision) &&
        s.revision >= 0 &&
        Array.isArray(s.imports) &&
        s.imports.length <= 32 &&
        s.selection &&
        typeof s.selection === "object",
      500,
      "camera_state_invalid",
    );
    s.imports.forEach(validateCamera);
    s.hiddenConfigured ??= [];
    requireThat(
      Array.isArray(s.hiddenConfigured) &&
        s.hiddenConfigured.length <= 32 &&
        new Set(s.hiddenConfigured).size === s.hiddenConfigured.length &&
        s.hiddenConfigured.every(validId),
      500,
      "camera_state_invalid",
    );
    this.cameras = [];
    this.rebuild();
  }
  rebuild() {
    const all = [
      ...this.manual.filter((c) => !this.state.hiddenConfigured.includes(c.id)),
      ...this.state.imports.filter(
        (c) => !this.manual.some((m) => m.id === c.id),
      ),
    ];
    requireThat(
      all.length <= 32 && new Set(all.map((c) => c.id)).size === all.length,
      409,
      "camera_limit",
    );
    this.cameras.splice(
      0,
      this.cameras.length,
      ...all.map((c) => ({
        ...c,
        exposed:
          typeof this.state.selection[c.id] === "boolean"
            ? this.state.selection[c.id]
            : c.exposed,
      })),
    );
  }
  snapshot() {
    return {
      revision: this.state.revision,
      hiddenConfiguredCameras: this.manual
        .filter((c) => this.state.hiddenConfigured.includes(c.id))
        .map((c) => ({ id: c.id, name: c.name })),
      cameras: this.cameras.map((c) => ({
        id: c.id,
        name: c.name,
        exposed: c.exposed,
        source: c.ha ? "ha" : c.onvif ? "onvif" : "manual",
      })),
    };
  }
  offer(cameras, sourceKind) {
    for (const [id, c] of this.candidates)
      if (c.expires <= this.now()) this.candidates.delete(id);
    // Replace only candidates from the same source; no unbounded scan history.
    const kind = sourceKind || (cameras[0]?.ha ? "ha" : "onvif");
    for (const [id, c] of this.candidates)
      if (c.kind === kind) this.candidates.delete(id);
    return cameras.slice(0, 64).map((c) => {
      validateCamera({ ...c, id: "candidate", exposed: false });
      const existing = this.cameras.find((x) => identity(x) === identity(c));
      const candidateId = secret();
      this.candidates.set(candidateId, {
        camera: structuredClone(c),
        kind,
        expires: this.now() + 300000,
      });
      return {
        candidateId,
        name: c.name,
        existingId: existing?.id || null,
        available: c.available !== false,
        reason: c.reason || null,
      };
    });
  }
  update(input) {
    requireThat(
      input && input.revision === this.state.revision,
      409,
      "revision_conflict",
    );
    const { selected, imports, restore = [] } = input;
    requireThat(
      Array.isArray(selected) &&
        selected.length <= 32 &&
        new Set(selected).size === selected.length &&
        Array.isArray(imports) &&
        imports.length <= 32 &&
        Array.isArray(restore) &&
        restore.length <= 32 &&
        new Set(restore).size === restore.length,
    );
    requireThat(
      selected.every((id) => this.cameras.some((c) => c.id === id)),
      400,
      "unknown_camera",
    );
    const state = structuredClone(this.state);
    state.selection = Object.fromEntries([
      ...this.cameras.map((c) => [c.id, selected.includes(c.id)]),
      ...state.hiddenConfigured.map((id) => [id, false]),
    ]);
    // Older builds ignore hiddenConfigured: keep removed configured sources unshared there too.
    for (const id of restore) {
      requireThat(
        this.manual.some((c) => c.id === id) &&
          state.hiddenConfigured.includes(id),
        400,
        "unknown_camera",
      );
      state.hiddenConfigured = state.hiddenConfigured.filter((x) => x !== id);
      state.selection[id] = true;
    }
    for (const item of imports) {
      const candidate = this.candidates.get(item?.candidateId);
      requireThat(
        candidate && candidate.expires > this.now(),
        409,
        "candidate_expired",
      );
      requireThat(
        candidate.camera.available !== false,
        400,
        "camera_not_streamable",
      );
      const c = structuredClone(candidate.camera);
      delete c.available;
      delete c.reason;
      if (c.onvif) {
        c.onvif.username = item.username ?? "";
        c.onvif.password = item.password ?? "";
      }
      c.id = (c.ha ? "ha_" : "onvif_") + digest(identity(c)).slice(0, 24);
      c.exposed = true;
      const existing = [...this.cameras, ...this.manual].find(
        (x) => identity(x) === identity(c),
      );
      if (existing) {
        state.hiddenConfigured = state.hiddenConfigured.filter(
          (id) => id !== existing.id,
        );
        state.selection[existing.id] = true;
        continue;
      }
      validateCamera(c);
      if (!state.imports.some((x) => x.id === c.id)) state.imports.push(c);
      state.selection[c.id] = true;
    }
    requireThat(
      this.manual.length + state.imports.length <= 32,
      409,
      "camera_limit",
    );
    state.revision++;
    saveState(this.directory, state, "cameras.enc");
    this.state = state;
    this.rebuild();
    return this.snapshot();
  }
  remove(id, revision) {
    requireThat(revision === this.state.revision, 409, "revision_conflict");
    const camera = this.cameras.find((c) => c.id === id);
    requireThat(camera, 404, "unknown_camera");
    const state = structuredClone(this.state);
    state.imports = state.imports.filter((c) => c.id !== id);
    delete state.selection[id];
    if (this.manual.some((c) => c.id === id)) {
      state.hiddenConfigured.push(id);
      state.selection = { ...state.selection, [id]: false };
    }
    state.revision++;
    saveState(this.directory, state, "cameras.enc");
    this.state = state;
    this.rebuild();
    for (const [key, candidate] of this.candidates)
      if (identity(candidate.camera) === identity(camera))
        this.candidates.delete(key);
    return this.snapshot();
  }
}
