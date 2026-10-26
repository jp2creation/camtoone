<p align="center">
  <a href="https://camtoone.app">
    <img src="assets/branding/camtoone-icon.png" alt="Camtoone camera icon" width="80" height="80">
  </a>
</p>

<p align="center">
  <a href="https://camtoone.app">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="assets/branding/camtoone-logo-dark.svg">
      <img src="assets/branding/camtoone-logo-light.svg" alt="Camtoone — All cams to one view" width="420">
    </picture>
  </a>
</p>

<h1 align="center">Camtoone modules</h1>

<p align="center">Official bridges, plugins and updates for Camtoone.</p>

<p align="center">
  <a href="https://camtoone.app"><strong>camtoone.app</strong></a>
  &nbsp;·&nbsp;
  <a href="#choose-a-module">Browse modules</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/jp2creation/camtoone/releases">Releases</a>
</p>

Bring your camera setup into Camtoone with the companion module that fits your installation. This repository is the home for module documentation, installation packages and updates.

## Choose a module

| Module | Purpose | Availability |
| --- | --- | --- |
| [Home Assistant Bridge](bridge-home-assistant/) | Run Camtoone Bridge as a Home Assistant app/add-on. | Preview download |
| [Docker Bridge](bridge-docker/) | Host Camtoone Bridge with Docker, outside Home Assistant. | Preview download |
| [Scrypted Bridge](bridge-scrypted/) | Connect Scrypted to Camtoone with the dedicated plugin. | Preview download |

Each module page links to a versioned package, SHA-256 checksums and installation instructions. These are preview distributions; check the installation route and limitations before using them.

## Downloads / Téléchargements

| Bridge | Version | Download | Installation |
| --- | --- | --- | --- |
| Home Assistant | 0.3.16 preview | [Download](https://github.com/jp2creation/camtoone/releases/download/bridge-home-assistant-v0.3.16/camtoone-bridge-home-assistant-0.3.16.tar.gz) | [Guide](bridge-home-assistant/) |
| Docker | 0.3.16 preview | [Download](https://github.com/jp2creation/camtoone/releases/download/bridge-docker-v0.3.16/camtoone-bridge-docker-0.3.16.tar.gz) | [Guide](bridge-docker/) |
| Scrypted | 0.2.0 preview | [Download](https://github.com/jp2creation/camtoone/releases/download/bridge-scrypted-v0.2.0/camtoone-bridge-scrypted-0.2.0.tgz) | [Guide](bridge-scrypted/) |

**Home Assistant:** [Add this app repository](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fjp2creation%2Fcamtoone). Read the first-install admin-key step and the local-pilot migration note in the guide before starting a new app.

**Docker:** source package to build on Linux; no prebuilt image is published. **Scrypted:** operator/developer package; public npm installation is not available. Downloading a file does not install it or alter your devices. Existing local installations keep their data and do not migrate automatically.

The versioned download index is [downloads.json](downloads.json). Each release includes a separate `SHA256SUMS` and installation guide. No phone APK is included in these Bridge releases.

## Download and update

1. Open the page for your module.
2. Check its requirements and compatibility with your Camtoone version.
3. Follow the link to the module's published release.
4. Install the package using the instructions on that page.

Installation packages and their SHA-256 checksums will be attached to [module releases](https://github.com/jp2creation/camtoone/releases). Version numbers are independent for each module.

## About Camtoone

**All cams to one view.** Visit [camtoone.app](https://camtoone.app) to discover the application.

## For maintainers

Read the [module publishing guide](docs/publishing-modules.md). Existing logo and icon files are available in [brand assets](assets/branding/).
