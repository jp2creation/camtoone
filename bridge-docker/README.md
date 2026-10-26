<p align="center">
  <a href="https://camtoone.app">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="../assets/branding/camtoone-logo-dark.svg">
      <img src="../assets/branding/camtoone-logo-light.svg" alt="Camtoone — All cams to one view" width="300">
    </picture>
  </a>
</p>

# Camtoone Bridge for Docker — 0.3.16 preview

[Source package](https://github.com/jp2creation/camtoone/releases/download/bridge-docker-v0.3.16/camtoone-bridge-docker-0.3.16.tar.gz) · [SHA-256](https://github.com/jp2creation/camtoone/releases/download/bridge-docker-v0.3.16/SHA256SUMS)

Requires a Linux host with Docker Engine and Compose, plus an existing camera/HA setup. This is a buildable source distribution, not a prebuilt registry image. The runtime is based on HA 0.3.15 with only the version marker corrected to read its package version. No camera firmware, vendor account, relay service or Android APK is included.

## Build and initialize

Verify the archive against SHA256SUMS, then:

```sh
tar -xzf camtoone-bridge-docker-0.3.16.tar.gz
cd camtoone-bridge
mkdir -p bridge-data
chmod 700 bridge-data
export CAMTOONE_DATA_DIR="$PWD/bridge-data"
docker compose build
docker compose run --rm --no-deps --entrypoint node bridge -e 'const fs=require("fs"),crypto=require("crypto");fs.writeFileSync("/data/config.json",JSON.stringify({bridgeId:"home",connectionMode:"direct",directEnabled:true,p2pEnabled:false,externalOrigin:"",adminKey:crypto.randomBytes(32).toString("base64url"),cameras:[]},null,2),{mode:0o600,flag:"wx"});console.log("Private configuration created; no key printed")'
docker compose up -d
```

Initialization refuses to overwrite an existing configuration. The entrypoint drops container privileges after initializing the persistent volume. Data stays in `bridge-data`; never publish that directory.

The administration interface is intentionally bound to **127.0.0.1:8099** on the Linux host. Open `http://127.0.0.1:8099` there, or use a trusted SSH loopback tunnel for a remote Linux host. Read `adminKey` privately from `bridge-data/config.json` and use it to unlock the interface. Do not expose the administration port on the Internet.

## Capabilities and limits

The web interface can manage explicitly configured/imported camera sources. A standalone Docker deployment has no HA Ingress identity: automatic HA URL/token discovery, saving HA URLs per HA user and automatic HA token creation are available only inside the HA app. The direct HA QR form remains available with manually provided HA addresses and token. It connects Android to HA, independently of Bridge camera sharing.

This preview's old standalone camera invitation panel is hidden; downloading the Docker package does **not** establish a supported one-click standalone ONVIF-to-Android pairing flow. Use the HA app for the automatic HA onboarding described in its guide. Keep existing standalone associations if already configured. New standalone camera pairing needs an operator-supported flow and is not claimed by this release.

No outgoing VPS video relay is enabled by the example configuration. Remote use still needs a reachable HA endpoint or a separately established suitable network path; the package does not configure a router, Cloudflare, DNS, firewall or VPN. Linux host networking is needed for the provided Compose file; Docker Desktop behavior is not validated.

## Updates

Back up `bridge-data` before replacing the source. Rebuild the new version, then restart the service while keeping the same private volume. Never replace `state.key`, encrypted credentials or TLS identity with example files. Keep a copy of the previous source/image for rollback.


[All modules](../README.md) · [Website](https://camtoone.app) · [Publishing guide](../docs/publishing-modules.md)
