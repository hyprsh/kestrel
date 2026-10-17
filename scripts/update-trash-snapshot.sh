#!/usr/bin/env bash
# Dev-only: refresh the embedded TRaSH snapshot in internal/scoring/trash from
# a checkout of TRaSH-Guides/Guides.
#
#   git clone --depth 1 https://github.com/TRaSH-Guides/Guides.git /tmp/trash-guides
#   scripts/update-trash-snapshot.sh /tmp/trash-guides
#
# The snapshot is docs/json/{radarr,sonarr}/{cf,cf-groups,quality-profiles}
# plus TRaSH's MIT LICENSE and the commit it was taken from (PRD Settled 6).
# After updating, regenerate the parity goldens (scripts/regen-cf-golden.sh)
# and run `go test ./internal/scoring/`.
set -euo pipefail

src="${1:?usage: update-trash-snapshot.sh <TRaSH Guides checkout>}"
dest="$(cd "$(dirname "$0")/.." && pwd)/internal/scoring/trash"

rm -rf "$dest"
for app in radarr sonarr; do
  mkdir -p "$dest/$app"
  for dir in cf cf-groups quality-profiles; do
    cp -R "$src/docs/json/$app/$dir" "$dest/$app/$dir"
  done
done
cp "$src/LICENSE" "$dest/LICENSE"
git -C "$src" rev-parse HEAD > "$dest/COMMIT"
echo "snapshot at $(cat "$dest/COMMIT")"
