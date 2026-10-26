<p align="center">
  <a href="https://camtoone.app">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="../assets/branding/camtoone-logo-dark.svg">
      <img src="../assets/branding/camtoone-logo-light.svg" alt="Camtoone — All cams to one view" width="300">
    </picture>
  </a>
</p>

# Camtoone Bridge for Scrypted — 0.2.0 preview

[Download the plugin package](https://github.com/jp2creation/camtoone/releases/download/bridge-scrypted-v0.2.0/camtoone-bridge-scrypted-0.2.0.tgz) · [SHA-256](https://github.com/jp2creation/camtoone/releases/download/bridge-scrypted-v0.2.0/SHA256SUMS)

This is the existing 0.2.0 companion, repackaged for GitHub download. Executable JavaScript and SDK metadata are unchanged. Source maps are omitted; installation instructions and third-party notices accompany the plugin. The package name remains `@camtoone/scrypted-bridge` and `private:true` prevents accidental npm publication. This release does not publish that name to npm or install anything in your Scrypted server.

Requires an existing Scrypted server and camera plugins, with working camera/rebroadcast configuration. This version supports explicitly selected cameras, snapshots/live URL retrieval, and a local single-use QR or temporary code. It does not claim recording history, PTZ, lights, sirens or alarm controls. Android QR/code support begins at 0.3.34; current app compatibility still depends on network and camera/provider capabilities.

## Operator/developer installation

**This is not a one-click public npm installation.** Do not enter an unpublished package name in the public plugin catalog and do not assume every Scrypted console accepts a tarball upload.

1. Verify SHA256SUMS and unpack the `.tgz`. It contains `package/package.json` and the real SDK-generated `package/dist/plugin.zip`.
2. Use Scrypted's official SDK deployment workflow from that package directory. The SDK version that built this package is **0.5.59**; it provides the `scrypted-deploy` executable. Installation is an explicit Scrypted administrator step and requires an authenticated deployment session.
3. Use a trusted loopback path for the SDK uploader, which does not verify its own TLS requests. If Scrypted is remote, first establish a verified SSH tunnel, for example `ssh -N -L 127.0.0.1:11443:127.0.0.1:10443 operator@scrypted-server`, then deploy to `127.0.0.1:11443` through the official SDK workflow. Authenticate privately using the matching official Scrypted tooling; never put administrator credentials in a shared command or issue. The exact auth/setup workflow depends on the installed server version.
4. Deployment changes the server's installed plugin. This publication has **not** run that action on the user's server. Ask an operator if the SDK deployment process is unfamiliar.

A locally installed SDK can deploy the prepared package with `NODE_ENV=production scrypted-deploy 127.0.0.1:11443` from `package/`, after authentication and tunnel setup. Merely running `npm install` on this archive does not register a Scrypted plugin.

## Connect to Camtoone

1. In the plugin settings (older builds display “CamToOne Bridge”), select only the **Exposed cameras** you intend to share. None are exposed by default.
2. Set **Advertised RTSP hostname** to the reachable LAN address/hostname of Scrypted, without scheme or port, matching the endpoint host.
3. Choose **Generate invitation**. The local QR/code is single-use, expires after three minutes and replaces the prior invitation.
4. In Camtoone, choose Scrypted, scan the QR or enter the code, then review and save the cameras.

The phone must reach Scrypted through LAN or a suitable private VPN. This code is not an Internet relay. Do not expose Scrypted HTTP/RTSP ports on your router. **Rotate access key** revokes the Bridge API key; previously returned real RTSP credentials have a separate lifecycle in Scrypted.

## Verification and license

The exact public package is checked for structure, unchanged executable hash, missing source maps and private-data exclusion. Its compiled bundle is initialized against isolated SDK fixtures; this is not proof of a real Scrypted installation or camera playback. Camtoone retains its existing UNLICENSED designation; no open-source license is granted. Third-party notices are included.


[All modules](../README.md) · [Website](https://camtoone.app) · [Publishing guide](../docs/publishing-modules.md)
