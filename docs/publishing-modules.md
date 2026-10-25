# Publishing Camtoone modules

Each module has its own directory, documentation and release versions. The main catalog links to the page for each module.

## Release identifiers

| Module | Tag prefix | Example package name |
| --- | --- | --- |
| Home Assistant Bridge | `bridge-home-assistant-v` | `camtoone-bridge-home-assistant-X.Y.Z.tar.gz` |
| Docker Bridge | `bridge-docker-v` | `camtoone-bridge-docker-X.Y.Z.tar.gz` |
| Scrypted Bridge | `bridge-scrypted-v` | `camtoone-bridge-scrypted-X.Y.Z.zip` |

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
