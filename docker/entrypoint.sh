#!/bin/sh
# Starts as root: makes the config dir writable for PUID:PGID, then drops to that user.
# Started non-root (compose `user:`), it skips all of that and just runs.
# The data dir is never chowned. UMASK is applied by the kestrel binary itself.
set -e

if [ "$(id -u)" = "0" ]; then
  puid="${PUID:-1000}"
  pgid="${PGID:-1000}"
  config="${KESTREL_CONFIG_DIR:-/config}"
  mkdir -p "$config"
  chown -R "$puid:$pgid" "$config"
  exec su-exec "$puid:$pgid" "$@"
fi

exec "$@"
