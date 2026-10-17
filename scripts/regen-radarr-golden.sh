#!/usr/bin/env bash
# Dev-only: regenerate internal/release/testdata/golden/radarr-parse.json from
# the pinned Radarr container. Needs Docker and network; CI never runs this,
# it replays the committed file.
#
#   scripts/regen-radarr-golden.sh
#
# The image is pinned by tag and digest below. Bump both together with
# release.UpstreamRadarr / UpstreamRadarrVersion when the port is re-synced.
set -euo pipefail

cd "$(dirname "$0")/.."

IMAGE="ghcr.io/hotio/radarr:release-5.28.0.10274"
DIGEST="sha256:42ca21d9bab4df84af1898e7256256b85a04b207e72c620ac382ac4151d65dd0"
NAME="kestrel-radarr-golden"
PORT="${RADARR_GOLDEN_PORT:-17878}"
KEY="0123456789abcdef0123456789abcdef" # throwaway key for a throwaway container

docker rm -f "$NAME" >/dev/null 2>&1 || true
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT

docker run -d --name "$NAME" -p "$PORT:7878" \
  -e RADARR__AUTH__APIKEY="$KEY" \
  -e RADARR__AUTH__METHOD=External \
  -e RADARR__AUTH__REQUIRED=DisabledForLocalAddresses \
  "$IMAGE@$DIGEST" >/dev/null

echo "waiting for Radarr on :$PORT"
for _ in $(seq 1 60); do
  if curl -sf -H "X-Api-Key: $KEY" "http://localhost:$PORT/api/v3/system/status" >/dev/null; then
    break
  fi
  sleep 3
done

go run ./scripts/radarrgolden \
  -url "http://localhost:$PORT" -key "$KEY" \
  -image "$IMAGE" -digest "$DIGEST"
