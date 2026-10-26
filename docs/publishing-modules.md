# Publishing Camtoone modules

Each module has its own directory, documentation and release versions. The main catalog links to the page for each module.

## Release identifiers

| Module | Tag prefix | Example package name |
| --- | --- | --- |
| Home Assistant Bridge | `bridge-home-assistant-v` | `camtoone-bridge-home-assistant-X.Y.Z.tar.gz` |
| Docker Bridge | `bridge-docker-v` | `camtoone-bridge-docker-X.Y.Z.tar.gz` |
| Scrypted Bridge | `bridge-scrypted-v` | `camtoone-bridge-scrypted-X.Y.Z.tgz` |

`X.Y.Z` is an example version number. Verify the package format with the target installer before the first release.

## Release contents

A downloadable release includes:

- The module name and version.
- Requirements and verified compatibility with Camtoone and the target environment.
- The installation package, any architecture-specific variants and SHA-256 checksums.
- Installation and update instructions, together with the release notes.
- Known limitations and the results of checks performed on the distributed package.

After verifying the download, update the module page with the exact release link.

## Selecting updates

Several modules share this repository. An update client must select releases for the correct module using its tag prefix, then apply the appropriate stability and compatibility policy.

The global `releases/latest` URL may refer to a different module. Installation links should point to the exact release of the intended module.

Changing update URLs for existing installations requires a compatible, verified migration. Creating the module catalog does not change their configuration.

## Distribution contents

Prepare public packages from the files required by the module. Keep credentials, tokens, private keys, installation data and personal captures out of published packages.

Mark a module as available once the published package and its installation have been verified.

## Brand assets

Use the existing [Camtoone logo and icon files](../assets/branding/) and check their appearance on light and dark backgrounds.

[All modules](../README.md) · [Website](https://camtoone.app)


## Initial downloads (2026-10-26)

Home Assistant and Docker use version 0.3.16 source packages; Scrypted uses the existing 0.2.0 compiled npm tarball, repackaged without source maps. These releases are explicitly previews. Scrypted's executable JavaScript and SDK metadata are unchanged from the previous package; private:true and UNLICENSED remain. It is not published to npm.

Only bridge-home-assistant/camtoone_bridge contains a config.yaml. The repository has one discoverable HA app, while Docker builds the same runtime. A new HA app requires a private adminKey before starting this version. The existing local pilot is a different Supervisor app identity: adding the public repository is not a data migration. No running installation is modified by publishing downloads.

Download packages must be verified anonymously against their SHA256SUMS before updating the catalog to available. Use module-specific exact tag links, not releases/latest. Keep the release and downloads.json hashes immutable; a changed runtime needs a new version. Packaging-only changes must document preserved executable hashes.
