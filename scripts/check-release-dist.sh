#!/usr/bin/env bash
# Checks that a GoReleaser run left everything a release carries: the three Silo
# plugin binaries (named in dist/artifacts.json, uploaded under those names) with
# checksums.txt covering them, and silo-repository.json naming them.
#
#   scripts/check-release-dist.sh dist release-assets
set -euo pipefail

dist="${1:?usage: check-release-dist.sh <dist dir> <release-assets dir>}"
assets="${2:?usage: check-release-dist.sh <dist dir> <release-assets dir>}"
fail=0
need() { [ -s "$1" ] || { echo "missing: $1"; fail=1; }; }

need "$dist/checksums.txt"
need "$dist/artifacts.json"
need "$assets/silo-repository.json"
[ "$fail" = 0 ] || exit 1

for f in kestrel-silo-linux-amd64 kestrel-silo-linux-arm64 kestrel-silo-darwin-arm64; do
  grep -q "\"name\": *\"$f\"" "$dist/artifacts.json" || { echo "no $f binary in artifacts.json"; fail=1; }
  grep -q " $f\$" "$dist/checksums.txt" || { echo "checksums.txt does not list $f"; fail=1; }
  grep -q "/$f\"" "$assets/silo-repository.json" || { echo "silo-repository.json does not name $f"; fail=1; }
done
[ "$fail" = 0 ] && echo "release dry run: ok"
exit "$fail"
