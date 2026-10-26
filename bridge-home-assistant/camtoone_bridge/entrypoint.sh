#!/bin/sh
set -eu
umask 077
# Supervisor creates /data/options.json; keep the same runtime for Docker and HA.
if [ -f /data/options.json ]; then
  export HA_INGRESS=1
fi
# Drop privileges after volume initialization, also with a read-only root filesystem.
if [ "$(id -u)" = 0 ]; then
  chown -R node:node /data
  exec su-exec node "$@"
fi
exec "$@"
