#!/usr/bin/env bash
# Dev-only: regenerate internal/scoring/testdata/golden/{radarr,sonarr}-cf.json
# from pinned Radarr and Sonarr containers loaded with the embedded TRaSH
# Custom Formats. Needs Docker and network (title lookups go through the
# *arr metadata servers); CI never runs this, it replays the committed files.
#
#   scripts/regen-cf-golden.sh
#
# The images are pinned by tag and digest below. Bump them together with
# release.UpstreamRadarr / the Sonarr pin when the parsers are re-synced, and
# rerun whenever the embedded TRaSH snapshot changes.
set -euo pipefail

cd "$(dirname "$0")/.."

RADARR_IMAGE="ghcr.io/hotio/radarr:release-5.28.0.10274"
RADARR_DIGEST="sha256:42ca21d9bab4df84af1898e7256256b85a04b207e72c620ac382ac4151d65dd0"
RADARR_VERSION="5.28.0.10274"
SONARR_IMAGE="ghcr.io/hotio/sonarr:release-4.0.20.3014"
SONARR_DIGEST="sha256:afc94d6134d3e21162bc86b82afee332c7555bedf4a29b710edcd794c9c38e1d"
SONARR_VERSION="4.0.20.3014"
KEY="0123456789abcdef0123456789abcdef" # throwaway key for throwaway containers
RADARR_PORT="${CF_GOLDEN_RADARR_PORT:-17979}"
SONARR_PORT="${CF_GOLDEN_SONARR_PORT:-17980}"

cleanup() { docker rm -f kestrel-cf-radarr kestrel-cf-sonarr >/dev/null 2>&1 || true; }
cleanup
trap cleanup EXIT

docker run -d --name kestrel-cf-radarr -p "$RADARR_PORT:7878" \
  -e RADARR__AUTH__APIKEY="$KEY" -e RADARR__AUTH__METHOD=External \
  -e RADARR__AUTH__REQUIRED=DisabledForLocalAddresses \
  "$RADARR_IMAGE@$RADARR_DIGEST" >/dev/null
docker run -d --name kestrel-cf-sonarr -p "$SONARR_PORT:8989" \
  -e SONARR__AUTH__APIKEY="$KEY" -e SONARR__AUTH__METHOD=External \
  -e SONARR__AUTH__REQUIRED=DisabledForLocalAddresses \
  "$SONARR_IMAGE@$SONARR_DIGEST" >/dev/null

wait_for() {
  for _ in $(seq 1 60); do
    curl -sf -H "X-Api-Key: $KEY" "http://localhost:$1/api/v3/system/status" >/dev/null && return 0
    sleep 3
  done
  echo "timed out waiting for :$1" >&2
  exit 1
}
wait_for "$RADARR_PORT"
wait_for "$SONARR_PORT"

docker exec kestrel-cf-radarr sh -c 'mkdir -p /media/radarr && chown -R hotio:hotio /media'
docker exec kestrel-cf-sonarr sh -c 'mkdir -p /media/sonarr && chown -R hotio:hotio /media'

go run ./scripts/cfgolden -app radarr -url "http://localhost:$RADARR_PORT" -key "$KEY" \
  -image "$RADARR_IMAGE" -digest "$RADARR_DIGEST" -version "$RADARR_VERSION" \
  -out internal/scoring/testdata/golden/radarr-cf.json
go run ./scripts/cfgolden -app sonarr -url "http://localhost:$SONARR_PORT" -key "$KEY" \
  -image "$SONARR_IMAGE" -digest "$SONARR_DIGEST" -version "$SONARR_VERSION" \
  -out internal/scoring/testdata/golden/sonarr-cf.json
