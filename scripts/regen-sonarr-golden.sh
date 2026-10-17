#!/usr/bin/env bash
# Dev-only: regenerate internal/release/testdata/golden/sonarr-parse.json from
# the pinned Sonarr container. Needs Docker and network; CI never runs this,
# it replays the committed file.
#
#   scripts/regen-sonarr-golden.sh
#
# The image is pinned by tag and digest below. Bump both together with
# release.UpstreamSonarr / UpstreamSonarrVersion when the port is re-synced.
set -euo pipefail

cd "$(dirname "$0")/.."

IMAGE="ghcr.io/hotio/sonarr:release-4.0.20.3014"
DIGEST="sha256:afc94d6134d3e21162bc86b82afee332c7555bedf4a29b710edcd794c9c38e1d"
NAME="kestrel-sonarr-golden"
PORT="${SONARR_GOLDEN_PORT:-18989}"
KEY="0123456789abcdef0123456789abcdef" # throwaway key for a throwaway container

docker rm -f "$NAME" >/dev/null 2>&1 || true
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT

docker run -d --name "$NAME" -p "$PORT:8989" \
  -e SONARR__AUTH__APIKEY="$KEY" \
  -e SONARR__AUTH__METHOD=External \
  -e SONARR__AUTH__REQUIRED=DisabledForLocalAddresses \
  "$IMAGE@$DIGEST" >/dev/null

echo "waiting for Sonarr on :$PORT"
for _ in $(seq 1 60); do
  if curl -sf -H "X-Api-Key: $KEY" "http://localhost:$PORT/api/v3/system/status" >/dev/null; then
    break
  fi
  sleep 3
done

go run ./scripts/sonarrgolden \
  -url "http://localhost:$PORT" -key "$KEY" \
  -image "$IMAGE" -digest "$DIGEST"
