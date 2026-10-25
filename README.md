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
| [Home Assistant Bridge](bridge-home-assistant/) | Run Camtoone Bridge as a Home Assistant app/add-on. | In preparation |
| [Docker Bridge](bridge-docker/) | Host Camtoone Bridge with Docker, outside Home Assistant. | In preparation |
| [Scrypted Bridge](bridge-scrypted/) | Connect Scrypted to Camtoone with the dedicated plugin. | In preparation |

Each module has its own requirements, installation guide and release history. Download links will appear on its page when its first package is published and verified in this repository.

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
