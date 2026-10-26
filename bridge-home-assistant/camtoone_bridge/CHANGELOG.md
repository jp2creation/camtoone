# 0.3.16

- Report the actual package version in runtime status.
- Public module-specific source distributions and installation guides. No data migration.

# 0.3.15

- Save edited direct Home Assistant URLs per HA user, encrypted and restored after reload.
- Show whether the automatic token is already saved; saving addresses never creates or replaces a token.
- Preserve manual override, QR format, camera settings and existing connections.

# 0.3.14

- Simplify the interface to direct Home Assistant QR setup and camera sharing.
- Automatically fill the local and configured or cloud HTTPS address when available, without network scanning or changing settings.
- Create one named long-lived HA credential per installation and current user on the first explicit Show QR action, store encrypted and reuse.
- Keep manual overrides, clear status when external access is missing, six languages and the selected HA theme.
- Preserve saved accounts, camera settings, options and existing transport contracts.
