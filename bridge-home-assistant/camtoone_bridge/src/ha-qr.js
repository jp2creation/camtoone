"use strict";
(() => {
  const I = window.CamtooneI18n;
  const panel = document.getElementById("ha-direct-panel");
  const form = document.getElementById("ha-direct-form");
  const internal = document.getElementById("ha-direct-internal");
  const external = document.getElementById("ha-direct-external");
  const token = document.getElementById("ha-direct-token");
  const canvas = document.getElementById("ha-direct-qr");
  const status = document.getElementById("ha-direct-status");
  token.maxLength = 8192;
  function clearQr() {
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    canvas.width = canvas.height = 0;
    canvas.hidden = true;
    I.text(status, () => "");
  }
  function clear() {
    generation++;
    token.value = "";
    clearQr();
    if (cleanupWarning && panel.open && !document.hidden)
      I.text(status, () => I.t("haDirectCleanupNeeded"));
  }
  function safeUrl(raw, kind) {
    if (raw.length > 2048) throw Error();
    const value = raw.trim();
    if (!value) return "";
    if (value.length > 2048 || /[\s\\\u0000-\u001f\u007f]/.test(value))
      throw Error();
    if (value.includes("?") || value.includes("#")) throw Error();
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !["http:", "https:"].includes(url.protocol)
    )
      throw Error();
    const host = url.hostname.toLowerCase();
    const rawHost = value.match(/^https?:\/\/([^/:?#]+)/i)?.[1]?.toLowerCase();
    const ipv4 = host.split(".").map(Number);
    const privateIp =
      rawHost === host &&
      /^(?:\d{1,3}\.){3}\d{1,3}$/.test(rawHost) &&
      ipv4.length === 4 &&
      ipv4.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) &&
      (ipv4[0] === 10 ||
        ipv4[0] === 127 ||
        (ipv4[0] === 192 && ipv4[1] === 168) ||
        (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31));
    const local = privateIp || host === "localhost" || host.endsWith(".local");
    if (kind === "internal" && !local) throw Error();
    if (kind === "external" && url.protocol !== "https:") throw Error();
    return value;
  }
  let generation = 0,
    generating = false,
    cleanupWarning = false;
  const generate = document.getElementById("ha-direct-generate");
  const addressStatus = document.getElementById("ha-direct-address-status");
  const save = document.getElementById("ha-direct-save");
  const credentialStatus = document.getElementById(
    "ha-direct-credential-status",
  );
  let saving = false;
  function credentialNotice(present) {
    I.text(credentialStatus, () =>
      I.t(
        present === true
          ? "haDirectCredentialSaved"
          : present === false
            ? "haDirectCredentialPending"
            : "haDirectCredentialUnknown",
      ),
    );
  }
  const dirty = { internal: false, external: false };
  function parentContext() {
    try {
      if (
        window.parent === window ||
        window.parent.location.origin !== window.location.origin
      )
        return null;
      const hass = window.parent.document.querySelector("home-assistant")?.hass;
      if (!hass || typeof hass.user?.id !== "string") return null;
      const connection = hass.connection;
      const send =
        connection?.sendMessagePromise?.bind(connection) ||
        hass.callWS?.bind(hass);
      if (!send) return null;
      return {
        userId: hass.user.id,
        identity: connection || hass,
        send,
        config: hass.config || {},
      };
    } catch {
      return null;
    }
  }
  function sameUser(context) {
    const now = parentContext();
    return (
      now && now.userId === context.userId && now.identity === context.identity
    );
  }
  function active(context, current) {
    if (
      current !== generation ||
      document.hidden ||
      !panel.open ||
      (context && !sameUser(context))
    )
      throw Error();
  }
  async function connectionApi(path, body) {
    const response = await fetch("./admin/ha/connection" + path, {
      method: body === undefined ? "GET" : "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: body === undefined ? {} : { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw Error();
    return response.json();
  }
  function addressNotice(key) {
    I.text(addressStatus, () => I.t(key));
  }
  let defaultsPending = Promise.resolve();
  async function cloudStatus(context) {
    let timer;
    try {
      return await Promise.race([
        context.send({ type: "cloud/status" }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error()), 3000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  function refreshDefaults() {
    defaultsPending = defaults();
  }
  async function defaults() {
    const context = parentContext();
    credentialNotice(null);
    if (!context) {
      addressNotice("haDirectManualNotice");
      return;
    }
    try {
      const info = await connectionApi("");
      if (
        !sameUser(context) ||
        info.userId !== context.userId ||
        info.version !== 1
      )
        throw Error();
      credentialNotice(info.credentialPresent === true);
      if (info.settings) {
        const local = safeUrl(info.settings.internalUrl, "internal"),
          remote = safeUrl(info.settings.externalUrl, "external");
        if (!local && !remote) throw Error();
        if (!dirty.internal) internal.value = local;
        if (!dirty.external) external.value = remote;
        addressNotice(
          dirty.internal || dirty.external
            ? "haDirectUnsaved"
            : "haDirectAddressesSaved",
        );
        return;
      }
    } catch {
      if (!sameUser(context)) return;
      credentialNotice(null);
    }
    if (!dirty.internal) {
      try {
        internal.value = safeUrl(context.config.internal_url || "", "internal");
      } catch {}
      if (!internal.value)
        try {
          internal.value = safeUrl(window.parent.location.origin, "internal");
        } catch {}
    }
    if (!dirty.external)
      try {
        external.value = safeUrl(context.config.external_url || "", "external");
      } catch {}
    if (external.value) {
      addressNotice("haDirectAddressReady");
      return;
    }
    addressNotice("haDirectLocalOnly");
    try {
      const cloud = await cloudStatus(context);
      if (!sameUser(context) || dirty.external || external.value) return;
      if (
        typeof cloud?.remote_domain !== "string" ||
        !cloud.remote_domain ||
        cloud.logged_in !== true ||
        cloud.active_subscription !== true
      )
        return;
      const value = cloud.remote_domain.includes("://")
        ? cloud.remote_domain
        : "https://" + cloud.remote_domain;
      const candidate = safeUrl(value, "external");
      if (cloud.remote_connected !== true) {
        addressNotice("haDirectCloudOffline");
        return;
      }
      external.value = candidate;
      addressNotice("haDirectAddressReady");
    } catch {
      /* Optional read-only cloud discovery: no activation or reachability probe. */
    }
  }
  async function cleanup(context, clientName) {
    if (!sameUser(context)) return false;
    try {
      const response = await context.send({ type: "auth/refresh_tokens" });
      if (!sameUser(context)) return false;
      const tokens = Array.isArray(response) ? response : response?.tokens;
      if (!Array.isArray(tokens)) return false;
      const matches = tokens.filter(
        (row) => row.client_name === clientName && typeof row.id === "string",
      );
      if (matches.length !== 1) return false;
      await context.send({
        type: "auth/delete_refresh_token",
        refresh_token_id: matches[0].id,
      });
      return true;
    } catch {
      return false;
    }
  }
  function render(secret, internalUrl, externalUrl) {
    const bytes = new TextEncoder().encode(
      JSON.stringify({ internalUrl, externalUrl, token: secret }),
    );
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const value =
      "CAMTOONE-HA-CONNECTION:1:" +
      btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
    if (new TextEncoder().encode(value).length > 2048) {
      I.text(status, () => I.t("haDirectTooLarge"));
      return;
    }
    const qr = window.CamtooneQrMatrix.create(value, {
      errorCorrectionLevel: "M",
    });
    const margin = 4,
      scale = 6,
      size = (qr.modules.size + margin * 2) * scale;
    canvas.width = canvas.height = size;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size, size);
    context.fillStyle = "#000000";
    for (let y = 0; y < qr.modules.size; y++)
      for (let x = 0; x < qr.modules.size; x++)
        if (qr.modules.get(y, x))
          context.fillRect(
            (x + margin) * scale,
            (y + margin) * scale,
            scale,
            scale,
          );
    canvas.hidden = false;
    token.value = "";
    I.text(status, () => I.t("haDirectReady"));
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (generating || saving) return;
    generating = true;
    generate.disabled = true;
    save.disabled = true;
    clearQr();
    const current = ++generation;
    const context = parentContext();
    let lease,
      clientName,
      created = false,
      stored = false;
    try {
      await defaultsPending;
      active(context, current);
      const internalUrl = safeUrl(internal.value, "internal");
      const externalUrl = safeUrl(external.value, "external");
      if (!internalUrl && !externalUrl) throw Error();
      let secret = token.value;
      if (!secret) {
        if (!context) throw Error();
        active(context, current);
        const info = await connectionApi("");
        active(context, current);
        if (
          info.version !== 1 ||
          info.userId !== context.userId ||
          typeof info.installationId !== "string"
        )
          throw Error();
        const cached = await connectionApi("/credential/get", {});
        active(context, current);
        secret = cached.token;
        credentialNotice(secret !== null);
        if (secret === null) {
          const reserved = await connectionApi("/credential/reserve", {});
          lease = reserved.lease;
          clientName = reserved.clientName;
          if (
            typeof lease !== "string" ||
            typeof clientName !== "string" ||
            !clientName
          )
            throw Error();
          active(context, current);
          created = true; // Creation may succeed even if its reply is lost; cleanup only this fresh lease name.
          secret = await context.send({
            type: "auth/long_lived_access_token",
            client_name: clientName,
            lifespan: 3650,
          });
          active(context, current);
          if (!/^[\x21-\x7e]{1,8192}$/.test(secret)) throw Error();
          const result = await connectionApi("/credential/store", {
            lease,
            token: secret,
          });
          if (result.saved !== true) throw Error();
          stored = true;
          credentialNotice(true);
        }
      }
      active(context, current);
      if (typeof secret !== "string" || !/^[\x21-\x7e]{1,8192}$/.test(secret))
        throw Error();
      render(secret, internalUrl, externalUrl);
    } catch {
      clearQr();
      let cleanupNeeded = false;
      if (created && !stored)
        cleanupNeeded = !(await cleanup(context, clientName));
      if (cleanupNeeded) cleanupWarning = true;
      if (lease && !stored)
        try {
          await connectionApi("/credential/release", { lease });
        } catch {}
      if (current === generation && !document.hidden && panel.open)
        I.text(status, () =>
          I.t(cleanupNeeded ? "haDirectCleanupNeeded" : "haDirectAutoFailed"),
        );
    } finally {
      token.value = "";
      generating = false;
      generate.disabled = false;
      save.disabled = false;
    }
  });
  save.addEventListener("click", async () => {
    if (saving || generating) return;
    saving = true;
    save.disabled = true;
    generate.disabled = true;
    clearQr();
    const current = ++generation,
      context = parentContext();
    try {
      await defaultsPending;
      if (!context) throw Error();
      active(context, current);
      const urls = {
        internalUrl: safeUrl(internal.value, "internal"),
        externalUrl: safeUrl(external.value, "external"),
      };
      if (!urls.internalUrl && !urls.externalUrl) throw Error();
      const result = await connectionApi("/settings", urls);
      active(context, current);
      if (result.saved !== true) throw Error();
      internal.value = urls.internalUrl;
      external.value = urls.externalUrl;
      addressNotice("haDirectAddressesSaved");
    } catch {
      if (current === generation && (!context || sameUser(context)))
        addressNotice("haDirectSaveFailed");
    } finally {
      saving = false;
      save.disabled = false;
      generate.disabled = false;
    }
  });
  document.getElementById("ha-direct-clear").addEventListener("click", clear);
  panel.addEventListener("toggle", () => {
    if (!panel.open) clear();
    else if (cleanupWarning) I.text(status, () => I.t("haDirectCleanupNeeded"));
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clear();
  });
  window.addEventListener("pagehide", clear);
  window.addEventListener("pageshow", () => {
    clear();
    if (cleanupWarning) I.text(status, () => I.t("haDirectCleanupNeeded"));
  });
  internal.addEventListener("input", () => {
    dirty.internal = true;
    addressNotice("haDirectUnsaved");
    generation++;
    clearQr();
  });
  external.addEventListener("input", () => {
    dirty.external = true;
    addressNotice("haDirectUnsaved");
    generation++;
    clearQr();
  });
  token.addEventListener("input", () => {
    generation++;
    clearQr();
  });
  let identity = parentContext();
  const watchUser = () => {
    const now = parentContext();
    if (
      (now?.userId || "") !== (identity?.userId || "") ||
      now?.identity !== identity?.identity
    ) {
      clear();
      identity = now;
      dirty.internal = dirty.external = false;
      internal.value = external.value = "";
      credentialNotice(null);
      refreshDefaults();
    }
  };
  let watch;
  const watchStart = () => {
    clearInterval(watch);
    watch = setInterval(watchUser, 500);
  };
  window.addEventListener("pagehide", () => clearInterval(watch));
  window.addEventListener("pageshow", watchStart);
  watchStart();
  refreshDefaults();
})();
