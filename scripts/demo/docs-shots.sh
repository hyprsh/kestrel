#!/usr/bin/env bash
# Regenerates the screenshots of docs/guide in light and dark: builds the working tree, shoots the
# setup wizard on an unseeded demo and the Library on a seeded one (docs-shots.mjs), and replaces
# every PNG in the output directory.
#
#   docs-shots.sh [out dir]      default: docs/guide/images
#
# Uses the demo's environment (DEMO_PORT, DEMO_FAKE_PORT; see demo.sh) and its tooling:
# go, node, npm, python3, curl and Google Chrome ($DEMO_CHROME) or Playwright's Chromium.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd "$here/../.." && pwd)
out=${1:-$repo/docs/guide/images}
work=$(mktemp -d "${TMPDIR:-/tmp}/kestrel-docs-shots.XXXXXX")
# A demo directory of its own, so a demo you have running is left alone (give DEMO_PORT and
# DEMO_FAKE_PORT other values if its ports are taken).
export DEMO_DIR=${DEMO_DIR:-$(mktemp -d /tmp/kd.XXXXXX)}
trap '"$here/demo.sh" stop >/dev/null 2>&1 || true; rm -rf "$work"' EXIT

[ -d "$here/node_modules/playwright-core" ] || npm ci --prefix "$here" --no-audit --no-fund --loglevel=error

"$here/demo.sh" build . "$work/kestrel"

DEMO_SEED=0 "$here/demo.sh" start "$work/kestrel"
node "$here/docs-shots.mjs" setup "$work/shots"

"$here/demo.sh" start "$work/kestrel"
node "$here/docs-shots.mjs" app "$work/shots"

mkdir -p "$out"
rm -f "$out"/*.png
cp "$work"/shots/*.png "$out"/
large=$(find "$out" -name '*.png' -size +200k)
[ -z "$large" ] || { echo "docs-shots: over 200 KB, shrink the viewport or the page:" >&2; echo "$large" >&2; exit 1; }
echo "docs-shots: wrote $(ls "$out"/*.png | wc -l | tr -d ' ') images to $out"
