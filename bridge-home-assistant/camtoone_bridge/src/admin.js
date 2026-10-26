"use strict";
let key = "";
let libraryState = null;
let candidateRows = [];
let cameraFilter = "all",
  removeTarget = null,
  interfaceCount = 0;
let searchGeneration = 0,
  pendingSearches = 0,
  saving = false;
const I = window.CamtooneI18n;
const t = I.t;
const $ = (id) => document.getElementById(id);
async function api(path, method = "GET", body) {
  const response = await fetch("./admin/" + path, {
    method,
    cache: "no-store",
    headers: {
      ...(key ? { authorization: "Bearer " + key } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }).catch(() => {
    throw I.error("ui0");
  });
  if (response.status === 401) {
    $("login").hidden = false;
    $("content").hidden = true;
    throw I.error("ui1");
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const errors = {
      revision_conflict: "ui2",
      candidate_expired: "ui3",
      ha_not_configured: "ui4",
      discovery_busy: "ui5",
      ha_unavailable: "ui6",
      camera_limit: "ui7",
    };
    const error = I.error(errors[data.error] || "ui8");
    error.code = data.error;
    throw error;
  }
  return response.json().catch(() => {
    throw I.error("ui8");
  });
}
function notice(render) {
  I.text($("notice"), render);
}
async function refresh() {
  try {
    const state = await api("status");
    I.text($("bridge-version"), () => state.version || "");
    $("login").hidden = true;
    $("content").hidden = false;
    $("connection").parentElement.dataset.connected = String(state.connected);
    I.text($("connection"), () => t("directReady"));
    I.text($("connection-detail"), () => t("directDetail"));
    if (!libraryState) await loadCameras();
    notice(() => "");
  } catch (e) {
    notice(() => e.message);
  }
}
$("login").onsubmit = (event) => {
  event.preventDefault();
  key = $("key").value;
  $("key").value = "";
  void refresh();
};
setInterval(() => {
  if (!$("content").hidden && !document.hidden) void refresh();
}, 5000);

const sourceName = (camera) =>
  camera.source === "ha"
    ? "Home Assistant"
    : camera.source === "onvif"
      ? "ONVIF"
      : t("configuration");
function applyLibrary(state) {
  if (libraryState && state.revision < libraryState.revision) return;
  libraryState = { ...libraryState, ...state };
  renderCameras();
}
function renderCameras() {
  if (!libraryState) return;
  const query = $("camera-search").value.trim().toLocaleLowerCase();
  const visible = libraryState.cameras.filter(
    (c) =>
      (cameraFilter === "all" || (cameraFilter === "shared") === c.exposed) &&
      (c.name + " " + sourceName(c)).toLocaleLowerCase().includes(query),
  );
  $("cameras").replaceChildren();
  for (const camera of visible) {
    const row = document.createElement("tr");
    const nameCell = document.createElement("td"),
      sourceCell = document.createElement("td"),
      shareCell = document.createElement("td"),
      removeCell = document.createElement("td");
    const identity = document.createElement("div"),
      icon = document.createElement("span"),
      name = document.createElement("strong"),
      subtitle = document.createElement("small"),
      text = document.createElement("div");
    identity.className = "table-camera-name";
    icon.className = "table-camera-icon";
    icon.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="12" height="12" rx="3"/><path d="m15 9 5-3v12l-5-3"/></svg>';
    I.text(name, () => camera.name);
    I.text(subtitle, () => sourceName(camera));
    subtitle.className = "mobile-source";
    text.append(name, subtitle);
    identity.append(icon, text);
    nameCell.append(identity);
    I.text(sourceCell, () => sourceName(camera));
    sourceCell.className = "source-column";
    const label = document.createElement("label"),
      check = document.createElement("input"),
      hint = document.createElement("span");
    label.className = "share-switch";
    check.type = "checkbox";
    check.checked = camera.exposed;
    check.dataset.cameraId = camera.id;
    I.attribute(check, "aria-label", () =>
      t("shareCamera", { name: camera.name }),
    );
    hint.className = "sr-only";
    I.text(hint, () => t("ui25"));
    label.append(check, hint);
    shareCell.append(label);
    check.onchange = () => void changeShare(camera.id, check.checked);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "remove-camera-button";
    button.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/></svg><span></span>';
    I.text(button.querySelector("span"), () => t("ui86"));
    I.attribute(button, "aria-label", () =>
      t("removeCamera", { name: camera.name }),
    );
    button.onclick = () => openRemoval(camera);
    removeCell.append(button);
    removeCell.className = "remove-column";
    row.append(nameCell, sourceCell, shareCell, removeCell);
    $("cameras").append(row);
  }
  if (!visible.length) {
    const row = document.createElement("tr"),
      cell = document.createElement("td");
    cell.colSpan = 4;
    cell.className = "empty-cameras";
    I.text(cell, () => (libraryState.cameras.length ? t("ui26") : t("ui27")));
    row.append(cell);
    $("cameras").append(row);
  }
  const count = libraryState.cameras.length,
    shared = libraryState.cameras.filter((c) => c.exposed).length;
  I.text(
    $("camera-count"),
    () => I.count("cameras", count) + " · " + I.count("shared", shared),
  );
  $("open-configured").hidden = !libraryState.hiddenConfiguredCameras?.length;
  document
    .querySelectorAll("[data-filter]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.filter === cameraFilter)),
    );
  updateSelection();
}
async function loadCameras() {
  applyLibrary(await api("cameras"));
  if (!libraryState.haAvailable) I.text($("ha-status"), () => t("ui28"));
  const networks = await api("sources/interfaces");
  interfaceCount = networks.interfaces.length;
  $("network").replaceChildren();
  for (const network of networks.interfaces) {
    const option = document.createElement("option");
    option.value = network.address;
    I.text(option, () => network.name + " · " + network.address);
    $("network").append(option);
  }
  if (!interfaceCount) I.text($("onvif-status"), () => t("ui29"));
  updateSelection();
}
async function mutationError(error) {
  try {
    await loadCameras();
  } catch {
    renderCameras();
  }
  I.text($("camera-notice"), () => error.message);
}
async function changeShare(id, exposed) {
  if (saving || pendingSearches) {
    renderCameras();
    return;
  }
  saving = true;
  updateSelection();
  I.text($("camera-notice"), () => t("ui30"));
  try {
    const selected = libraryState.cameras
      .filter((c) => (c.id === id ? exposed : c.exposed))
      .map((c) => c.id);
    applyLibrary(
      await api("cameras", "PUT", {
        revision: libraryState.revision,
        selected,
        imports: [],
      }),
    );
    I.text($("camera-notice"), () => (exposed ? t("ui31") : t("ui32")));
  } catch (error) {
    await mutationError(error);
  } finally {
    saving = false;
    renderCameras();
    const check = Array.from($("cameras").querySelectorAll("input")).find(
      (c) => c.dataset.cameraId === id,
    );
    (check || $("camera-search")).focus();
  }
}
function openRemoval(camera) {
  if (saving || pendingSearches) return;
  removeTarget = {
    id: camera.id,
    name: camera.name,
    revision: libraryState.revision,
  };
  I.text($("remove-name"), () => camera.name);
  I.text($("remove-description"), () =>
    camera.source === "ha"
      ? t("ui33")
      : camera.source === "manual"
        ? t("ui34")
        : t("ui35"),
  );
  updateSelection();
  $("remove-camera").showModal();
  $("cancel-remove").focus();
}
$("confirm-remove").onclick = async () => {
  if (!removeTarget || saving) return;
  saving = true;
  updateSelection();
  try {
    applyLibrary(
      await api("cameras/" + encodeURIComponent(removeTarget.id), "DELETE", {
        revision: removeTarget.revision,
      }),
    );
    $("remove-camera").close();
    I.text($("camera-notice"), () => t("ui36"));
  } catch (error) {
    await mutationError(error);
    $("remove-camera").close();
  } finally {
    saving = false;
    removeTarget = null;
    renderCameras();
    $("open-source-picker").focus();
  }
};
$("cancel-remove").onclick = () => $("remove-camera").close();
$("remove-camera").addEventListener("cancel", (event) => {
  if (saving) event.preventDefault();
});
$("remove-camera").addEventListener("close", () => {
  removeTarget = null;
});
$("camera-search").oninput = renderCameras;
for (const b of document.querySelectorAll("[data-filter]"))
  b.onclick = () => {
    cameraFilter = b.dataset.filter;
    renderCameras();
  };
$("open-source-picker").onclick = () => $("source-picker").showModal();
$("close-source-picker").onclick = () => $("source-picker").close();
function renderCandidates(kind, candidates) {
  candidateRows = candidateRows.filter((r) => r.kind !== kind);
  const ul = $(kind + "-candidates");
  ul.replaceChildren();
  if (!candidates.length) {
    I.text($(kind + "-status"), () => (kind === "ha" ? t("ui37") : t("ui38")));
    return;
  }
  I.text($(kind + "-status"), () => I.count("found", candidates.length));
  for (const candidate of candidates) {
    const li = document.createElement("li"),
      label = document.createElement("label"),
      check = document.createElement("input"),
      name = document.createElement("span");
    li.className = "candidate";
    check.type = "checkbox";
    check.disabled = Boolean(candidate.existingId) || !candidate.available;
    I.text(
      name,
      () =>
        candidate.name +
        (candidate.existingId
          ? t("ui40")
          : !candidate.available
            ? " · " + I.reason(candidate.reason)
            : ""),
    );
    label.className = "camera-choice";
    label.append(check, name);
    li.append(label);
    const row = { kind, candidateId: candidate.candidateId, check };
    if (kind === "onvif" && !candidate.existingId) {
      const fields = document.createElement("div");
      fields.hidden = true;
      fields.className = "credentials";
      for (const [key, text, type] of [
        ["username", "ui41", "text"],
        ["password", "ui42", "password"],
      ]) {
        const field = document.createElement("label"),
          input = document.createElement("input");
        const caption = document.createElement("span");
        I.text(caption, () => t(text));
        field.append(caption);
        input.type = type;
        input.autocomplete = "off";
        input.maxLength = key === "username" ? 128 : 256;
        field.append(input);
        fields.append(field);
        row[key] = input;
      }
      check.onchange = () => {
        fields.hidden = !check.checked;
        updateSelection();
      };
      li.append(fields);
    }
    if (!check.onchange) check.onchange = updateSelection;
    candidateRows.push(row);
    ul.append(li);
  }
}

function updateSelection() {
  const count = candidateRows.filter(
    (r) => r.check.checked && !r.check.disabled,
  ).length;
  I.text($("selection-count"), () =>
    count ? I.count("selected", count) : t("ui43"),
  );
  I.text($("add-selected"), () => (count ? I.count("add", count) : t("ui44")));
  $("add-selected").disabled = !count || pendingSearches > 0 || saving;
  $("reload-cameras").disabled = pendingSearches > 0 || saving;
  $("close-add").disabled = saving;
  $("open-source-picker").disabled = pendingSearches > 0 || saving;
  $("import-ha").disabled = saving || !libraryState?.haAvailable;
  $("open-onvif").disabled = saving || !interfaceCount;
  $("discover-onvif").disabled =
    saving || pendingSearches > 0 || !interfaceCount;
  $("confirm-remove").disabled = saving || !removeTarget;
  $("cancel-remove").disabled = saving;
  for (const c of $("cameras").querySelectorAll("input,button"))
    c.disabled = saving || pendingSearches > 0;
}
function openAdd(kind) {
  searchGeneration++;
  candidateRows = [];
  $("ha-candidates").replaceChildren();
  $("onvif-candidates").replaceChildren();
  $("source-picker").close();
  $("configured-panel").hidden = kind !== "configured";
  $("configured-candidates").replaceChildren();
  $("ha-panel").hidden = kind !== "ha";
  $("onvif-panel").hidden = kind !== "onvif";
  I.text($("add-title"), () =>
    kind === "ha" ? t("ui79") : kind === "configured" ? t("ui45") : t("ui80"),
  );
  I.text($("add-description"), () => (kind === "ha" ? t("ui46") : t("ui47")));
  I.text($("onvif-status"), () => t("ui48"));
  $("retry-ha").hidden = true;
  updateSelection();
  $("add-camera").showModal();
}
$("close-add").onclick = () => $("add-camera").close();
$("add-camera").addEventListener("cancel", (event) => {
  if (saving) event.preventDefault();
});
$("add-camera").addEventListener("close", () => {
  searchGeneration++;
  candidateRows = [];
  $("ha-candidates").replaceChildren();
  $("onvif-candidates").replaceChildren();
  $("configured-candidates").replaceChildren();
  updateSelection();
});
async function findCameras(kind) {
  const button = $(kind === "ha" ? "import-ha" : "discover-onvif");
  const generation = searchGeneration;
  if (kind === "ha") $("retry-ha").hidden = true;
  button.disabled = true;
  pendingSearches++;
  updateSelection();
  I.text($(kind + "-status"), () =>
    kind === "ha" ? t("ui49") : t("searchingOnvif"),
  );
  try {
    const data = await api(
      "sources/" + kind,
      "POST",
      kind === "onvif" ? { address: $("network").value } : {},
    );
    if (generation === searchGeneration)
      renderCandidates(kind, data.candidates);
  } catch (e) {
    if (generation === searchGeneration) {
      I.text($(kind + "-status"), () => e.message);
      if (kind === "ha") $("retry-ha").hidden = false;
    }
  } finally {
    button.disabled = false;
    pendingSearches--;
    updateSelection();
  }
}
$("import-ha").onclick = () => {
  openAdd("ha");
  void findCameras("ha");
};
$("retry-ha").onclick = () => void findCameras("ha");
$("open-onvif").onclick = () => openAdd("onvif");
$("discover-onvif").onclick = () => void findCameras("onvif");
$("open-configured").onclick = () => {
  openAdd("configured");
  I.text($("add-description"), () => t("ui50"));
  for (const camera of libraryState.hiddenConfiguredCameras || []) {
    const li = document.createElement("li"),
      label = document.createElement("label"),
      check = document.createElement("input"),
      name = document.createElement("span");
    check.type = "checkbox";
    check.onchange = updateSelection;
    I.text(name, () => camera.name);
    label.className = "camera-choice";
    label.append(check, name);
    li.append(label);
    $("configured-candidates").append(li);
    candidateRows.push({ kind: "configured", cameraId: camera.id, check });
  }
  updateSelection();
};
async function saveCameras() {
  if (saving || pendingSearches) return;
  saving = true;
  updateSelection();
  const oldLabel = $("add-selected").textContent;
  I.text($("add-selected"), () => t("ui51"));
  try {
    const selected = libraryState.cameras
      .filter((c) => c.exposed)
      .map((c) => c.id);
    const rows = candidateRows.filter(
      (r) => r.check.checked && !r.check.disabled,
    );
    const imports = rows
      .filter((r) => r.kind !== "configured")
      .map((r) => ({
        candidateId: r.candidateId,
        ...(r.kind === "onvif"
          ? { username: r.username.value, password: r.password.value }
          : {}),
      }));
    const restore = rows
      .filter((r) => r.kind === "configured")
      .map((r) => r.cameraId);
    applyLibrary(
      await api("cameras", "PUT", {
        revision: libraryState.revision,
        selected,
        imports,
        restore,
      }),
    );
    $("add-camera").close();
    I.text($("camera-notice"), () => t("ui52"));
  } catch (error) {
    await mutationError(error);
    I.text($("add-description"), () => error.message);
  } finally {
    saving = false;
    I.text($("add-selected"), () => oldLabel);
    updateSelection();
  }
}
$("add-selected").onclick = () => void saveCameras();
$("reload-cameras").onclick = async () => {
  try {
    await loadCameras();
    I.text($("camera-notice"), () => t("ui53"));
  } catch (e) {
    I.text($("camera-notice"), () => e.message);
  }
};
void refresh();

// Ingress is same-origin, but CSS custom properties do not cross iframe documents.
// Read only resolved presentation roles, never HA state, preferences or credentials.
(() => {
  const root = document.documentElement;
  const logo = $("brand-logo");
  const darkLogo = logo.src,
    lightLogo = logo.dataset.lightSrc || darkLogo;
  const media = matchMedia("(prefers-color-scheme: dark)");
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  let fingerprint = "",
    scheduled = false;
  const rgb = (color) => {
    if (!context) return [0, 0, 0];
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = "#fff";
    context.fillRect(0, 0, 1, 1);
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
  };
  const luminance = (color) =>
    rgb(color)
      .map((v) => v / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const color = (styles, ...names) => {
    for (const name of names) {
      const value = styles.getPropertyValue(name).trim();
      if (
        value.length <= 160 &&
        CSS.supports("color", value) &&
        !/[;{}]/.test(value)
      )
        return value;
    }
    return null;
  };
  function syncTheme() {
    const dark = media.matches;
    let palette = dark
      ? {
          bg: "#000",
          surface: "#080808",
          ink: "#f5f5f7",
          muted: "#929297",
          line: "#343438",
          accent: "#ff002c",
        }
      : {
          bg: "#fafafa",
          surface: "#fff",
          ink: "#212121",
          muted: "#6f6f6f",
          line: "#dedede",
          accent: "#ff002c",
        };
    let source = "system";
    try {
      if (window.parent !== window && window.frameElement) {
        const styles = window.parent.getComputedStyle(window.frameElement);
        const bg = color(
          styles,
          "--primary-background-color",
          "--ha-color-background-base",
        );
        const ink = color(
          styles,
          "--primary-text-color",
          "--ha-color-text-primary",
        );
        if (bg && ink) {
          palette = {
            bg,
            ink,
            surface:
              color(
                styles,
                "--card-background-color",
                "--ha-card-background",
              ) || bg,
            muted:
              color(
                styles,
                "--secondary-text-color",
                "--ha-color-text-secondary",
              ) || ink,
            line:
              color(styles, "--divider-color", "--ha-card-border-color") ||
              palette.line,
            accent:
              color(styles, "--primary-color", "--accent-color") ||
              palette.accent,
          };
          source = "home-assistant";
        }
      }
    } catch {} // Standalone or cross-origin embedding follows the system instead.
    const next = JSON.stringify([source, palette]);
    if (next === fingerprint) return;
    fingerprint = next;
    for (const [role, value] of Object.entries(palette))
      root.style.setProperty("--" + role, value);
    const isDark = luminance(palette.bg) < 0.35;
    root.style.colorScheme = isDark ? "dark" : "light";
    root.dataset.theme = isDark ? "dark" : "light";
    root.dataset.themeSource = source;
    const l = luminance(palette.accent);
    root.style.setProperty(
      "--button-ink",
      (l + 0.05) / 0.05 > 1.05 / (l + 0.05) ? "#000" : "#fff",
    );
    const src = isDark ? darkLogo : lightLogo;
    if (logo.src !== src) logo.src = src;
  }
  function syncViewport() {
    const v = window.visualViewport;
    let width = v?.width || innerWidth,
      height = v?.height || innerHeight,
      left = v?.offsetLeft || 0,
      top = v?.offsetTop || 0;
    try {
      const frame = window.frameElement,
        p = window.parent.visualViewport;
      if (frame && p) {
        const r = frame.getBoundingClientRect();
        const x = Math.max(r.left, p.offsetLeft),
          y = Math.max(r.top, p.offsetTop);
        const w = Math.min(r.right, p.offsetLeft + p.width) - x,
          h = Math.min(r.bottom, p.offsetTop + p.height) - y;
        if (w > 0 && h > 0) {
          width = Math.min(width, w);
          height = Math.min(height, h);
          left = Math.max(left, x - r.left);
          top = Math.max(top, y - r.top);
        }
      }
    } catch {}
    root.dataset.compactDialog = String(height < 380);
    for (const [key, value] of Object.entries({ width, height, left, top }))
      if (Number.isFinite(value) && value >= 0)
        root.style.setProperty("--viewport-" + key, value + "px");
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      syncTheme();
      syncViewport();
    });
  }
  const observer = new MutationObserver(schedule);
  let timer, parentViewport;
  function connect() {
    try {
      let node = window.frameElement;
      while (node) {
        observer.observe(node, {
          attributes: true,
          attributeFilter: ["style", "class"],
        });
        node = node.parentElement || node.getRootNode()?.host || null;
      }
      if (window.parent !== window) {
        window.parent.addEventListener("resize", schedule);
        parentViewport = window.parent.visualViewport;
        parentViewport?.addEventListener("resize", schedule);
        parentViewport?.addEventListener("scroll", schedule);
      }
    } catch {}
    clearInterval(timer);
    timer = setInterval(() => {
      if (!document.hidden) schedule();
    }, 1000);
    schedule();
  }
  function disconnect() {
    clearInterval(timer);
    observer.disconnect();
    try {
      window.parent.removeEventListener("resize", schedule);
      parentViewport?.removeEventListener("resize", schedule);
      parentViewport?.removeEventListener("scroll", schedule);
    } catch {}
  }
  window.addEventListener("resize", schedule);
  window.visualViewport?.addEventListener("resize", schedule);
  window.visualViewport?.addEventListener("scroll", schedule);
  document.addEventListener("visibilitychange", schedule);
  media.addEventListener("change", schedule);
  window.addEventListener("pagehide", disconnect);
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) connect();
  });
  connect();
  syncTheme();
  syncViewport();
})();
