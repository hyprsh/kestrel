#!/usr/bin/env bash
# Regenerates the screenshots of docs/guide in light and dark: builds the working tree, shoots the
# setup wizard on an unseeded demo and the Library on a seeded one (docs-shots.mjs), and replaces
# the PNGs in the output directory that changed.
#
#   docs-shots.sh [out dir]      default: docs/guide/images
#
# Uses the demo's environment (DEMO_PORT, DEMO_FAKE_PORT; see demo.sh) and its tooling:
# go, node, npm, python3, curl and Google Chrome ($DEMO_CHROME) or Playwright's Chromium.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd "$here/../.." && pwd)
out=${1:-$repo/docs/guide/images}
# A fixed demo directory, so the paths in the shots (the Health screen shows them) are the same on
# every run and an unchanged UI gives the same pixels. It is not the directory of the demo you have
# running here, which keeps its data; the ports are still this worktree's, so stop that demo first
# or give DEMO_PORT another value. A lock keeps two runs from sharing the directory.
export DEMO_DIR=${DEMO_DIR:-/tmp/kd-shots}
lock=$DEMO_DIR.lock
mkdir "$lock" 2>/dev/null || { echo "docs-shots: $lock exists, so another run is using $DEMO_DIR (remove it if none is)" >&2; exit 1; }
work=$(mktemp -d "${TMPDIR:-/tmp}/kestrel-docs-shots.XXXXXX")
trap '"$here/demo.sh" stop >/dev/null 2>&1 || true; rm -rf "$work" "$DEMO_DIR" "$lock"' EXIT

[ -d "$here/node_modules/playwright-core" ] || npm ci --prefix "$here" --no-audit --no-fund --loglevel=error

"$here/demo.sh" build . "$work/kestrel"

DEMO_SEED=0 "$here/demo.sh" start "$work/kestrel"
node "$here/docs-shots.mjs" setup "$work/shots"

"$here/demo.sh" start "$work/kestrel"
node "$here/docs-shots.mjs" app "$work/shots"

# Write a PNG only when its pixels differ from the committed one, so a run on an unchanged UI leaves
# the tree clean. PNGs with no new shot of that name are removed.
mkdir -p "$out"
for old in "$out"/*.png; do
  if [ -e "$old" ] && [ ! -e "$work/shots/$(basename "$old")" ]; then rm -f "$old"; fi
done
node "$here/png-sync.mjs" "$work/shots" "$out"
large=$(find "$out" -name '*.png' -size +200k)
[ -z "$large" ] || { echo "docs-shots: over 200 KB, shrink the viewport or the page:" >&2; echo "$large" >&2; exit 1; }
echo "docs-shots: $(ls "$out"/*.png | wc -l | tr -d " ") images in $out"
