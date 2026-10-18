#!/usr/bin/env bash
# Regenerate internal/notices/THIRD_PARTY_NOTICES.md: Go module licences via
# go-licenses, npm production dependencies via npm, plus the ported Radarr/Sonarr
# code and the bundled TRaSH data. Needs network for the first run and
# `npm --prefix web ci`. CI checks the file against its inputs (see notices_test.go).
#
#   scripts/gen-notices.sh
set -euo pipefail

cd "$(dirname "$0")/.."
GO_LICENSES="github.com/google/go-licenses/v2@v2.0.1"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

go run "$GO_LICENSES" save ./cmd/... --ignore github.com/hyprsh/kestrel --save_path "$tmp/go" --force 2>/dev/null
npm --prefix web ls --omit=dev --all --parseable 2>/dev/null | grep node_modules > "$tmp/npm.txt" || true
go run ./scripts/gen-notices -go-licenses "$tmp/go" -npm-paths "$tmp/npm.txt" -out internal/notices/THIRD_PARTY_NOTICES.md
echo "wrote internal/notices/THIRD_PARTY_NOTICES.md"
