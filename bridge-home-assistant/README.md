<p align="center">
  <a href="https://camtoone.app">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="../assets/branding/camtoone-logo-dark.svg">
      <img src="../assets/branding/camtoone-logo-light.svg" alt="Camtoone — All cams to one view" width="300">
    </picture>
  </a>
</p>

# Camtoone Bridge for Home Assistant — 0.3.16 preview

## Download

[Installation archive](https://github.com/jp2creation/camtoone/releases/download/bridge-home-assistant-v0.3.16/camtoone-bridge-home-assistant-0.3.16.tar.gz) · [SHA-256](https://github.com/jp2creation/camtoone/releases/download/bridge-home-assistant-v0.3.16/SHA256SUMS)

This is the source package for the Home Assistant app/add-on. Home Assistant builds its container locally; it is not an Android APK or an HA integration/HACS component. Supported build targets: amd64 and aarch64. The 0.3.15 runtime was verified in the existing HA pilot; 0.3.16 only corrects the version marker to read the package version; a fresh repository-based installation has not been exercised on a second physical HA system. Keep this preview distinction when deploying.

## First installation

1. In **Settings → Apps/Add-ons → App store → Repositories**, add `https://github.com/jp2creation/camtoone`.
2. Open **Camtoone Bridge** and install it. Building requires Internet access to fetch the pinned Node base and npm dependencies.
3. Before starting, set `adminKey` in the app configuration to a new private 43-character base64url key. This version requires that initial administrator key, even with Ingress. Generate it on a trusted computer, for example with `openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n'`. Do not post it in issues or screenshots. Keep `connectionMode: direct`, `directEnabled: true`; leave `externalOrigin` empty unless you already operate a suitable bridge HTTPS endpoint. The legacy relay settings are not used in direct mode.
4. Start the app and open its web interface. Under **Direct Home Assistant connection**, the internal and available Home Assistant Cloud/external addresses are detected. Edit them if needed and click **Save**. The automatically created token has a separate saved-status indication.
5. Click **Show QR**. HA creates one personal token on the first explicit display and the Bridge keeps it encrypted. In Camtoone Android, select **NVR → Gateway → Home Assistant**, scan the QR, connect and choose cameras. The direct HA connection QR needs Android 0.4.09 or later. Camera/dashboard features depend on the Android version and actual HA entities.

The QR contains a durable credential: keep it private. No camera is selected automatically in Android. Import/discovery in the Bridge is an explicit separate action. Showing a QR or saving addresses does not operate devices.

## Existing local installations

**Do not install a duplicate over an existing local pilot.** A Git repository app has a different Supervisor repository ID and therefore different storage from `local_camtoone_bridge`. Adding this repository does not migrate existing cameras, credentials or data. Preserve the existing app and its backups; use an operator-reviewed migration before replacing it. This download publication does not update the user's running HA system.

Advanced local installation: unpack the archive into a local app directory named `camtoone_bridge`, then reload the local app store. Preserve `/data`, `state.key`, encrypted state and the TLS identity during updates. Do not overwrite runtime data with the source archive.

## Networking and limits

HA Cloud supplies an external HA address when configured; this does not make arbitrary camera/bridge ports accessible. No router, DNS or firewall changes are performed. HTTPS direct access depends on existing network reachability. There is no VPS video relay in direct mode. Real phone optical scanning, cellular access and each camera model still need installation-specific checks.

The source package includes the app's own light/dark-aware web UI. It does not install custom global HA frontend modules or alter the rest of the HA interface.


[All modules](../README.md) · [Website](https://camtoone.app) · [Publishing guide](../docs/publishing-modules.md)
