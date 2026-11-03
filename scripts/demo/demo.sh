#!/usr/bin/env bash
# Runs Kestrel with seeded demo data against the fake providers (fake.py).
#
#   demo.sh build <git ref | .> <out binary>   build Kestrel with the SPA at a ref (. = the working tree as it is)
#   demo.sh start <binary>                     (re)start the fake and Kestrel on a freshly seeded DEMO_DIR
#   demo.sh releases on|off                    let the fake indexer offer releases, or none (the default)
#   demo.sh unlisted on|off                    with releases on, also offer ones for episodes and seasons TheTVDB doesn't list (off by default)
#   demo.sh stop                               stop both (this worktree's demo only)
#   demo.sh status                             say whether this worktree's demo is running, and where
#   demo.sh port                               print the Kestrel port of this worktree's demo
#
# Environment: every worktree gets its own demo, so several run side by side. The defaults come from a
# hash of the repo's path: DEMO_DIR /tmp/kd-<8 hex digits> (wiped by start), DEMO_PORT (Kestrel) 20000
# + an even offset below 2000, DEMO_FAKE_PORT (fake.py) the port after it. stop, status and a second
# start in the same worktree find the same run; stop only stops that one. Set any of the three to
# override; `demo.sh port` prints the Kestrel port the other commands would use. DEMO_SEED=0 starts
# without the seed, on a fresh instance that shows the setup wizard. DEMO_TITLES=4000 grows the seeded
# Library to that many Titles (seed_big.py: a realistic mix, written straight into SQLite, for
# measuring). Logs are in $DEMO_DIR/logs. Needs go, node, npm, python3 and curl, and `npm ci --prefix
# scripts/demo` once for the posters.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd "$here/../.." && pwd)
# The defaults derive from the repo path, so each worktree has its own demo.
sum=$(printf '%s' "$repo" | cksum | cut -d' ' -f1)
slot=$((sum % 1000))
dir=${DEMO_DIR:-$(printf '/tmp/kd-%08x' "$sum")}
port=${DEMO_PORT:-$((20000 + slot * 2))}
fport=${DEMO_FAKE_PORT:-$((port + 1))}
fake=http://127.0.0.1:$fport

die() { echo "demo: $*" >&2; exit 1; }

wait_for() { # url what
  for _ in $(seq 1 100); do
    curl -sf -o /dev/null "$1" && return 0
    sleep 0.2
  done
  die "$2 did not answer on $1; see $dir/logs"
}

stop() {
  for name in kestrel fake; do
    pidfile=$dir/$name.pid
    [ -f "$pidfile" ] || continue
    pid=$(cat "$pidfile")
    if kill "$pid" 2>/dev/null; then
      for _ in $(seq 1 50); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
      kill -9 "$pid" 2>/dev/null || true
      echo "stopped $name ($pid)"
    fi
    rm -f "$pidfile"
  done
}

status() {
  local running=0 name
  for name in kestrel fake; do
    if [ -f "$dir/$name.pid" ] && kill -0 "$(cat "$dir/$name.pid")" 2>/dev/null; then running=$((running + 1)); fi
  done
  if [ "$running" = 2 ]; then
    echo "running: Kestrel on http://127.0.0.1:$port, fake on $fake, dir $dir"
  else
    echo "not running (dir $dir, Kestrel port $port, fake port $fport)"
    return 1
  fi
}

build() {
  local ref=${1:?usage: demo.sh build <git ref | .> <out binary>} out=${2:?usage: demo.sh build <git ref | .> <out binary>}
  mkdir -p "$(dirname "$out")"
  out=$(cd "$(dirname "$out")" && pwd)/$(basename "$out")
  local src=$repo tmp=
  if [ "$ref" != . ]; then
    tmp=${TMPDIR:-/tmp}
    tmp=$(mktemp -d "${tmp%/}/kestrel-demo-build.XXXXXX")
    trap "rm -rf '$tmp'" EXIT
    git -C "$repo" archive "$ref" | tar -x -C "$tmp"
    src=$tmp
  fi
  echo "building $ref into $out"
  # Install only when web/node_modules is missing or older than the lockfile: npm ci deletes node_modules
  # first, which breaks a dev server or test run that is using the shared one.
  local web=$src/web
  if [ ! -d "$web/node_modules" ] || [ "$web/package-lock.json" -nt "$web/node_modules/.package-lock.json" ]; then
    (cd "$web" && npm ci --no-audit --no-fund --loglevel=error >/dev/null)
  fi
  (cd "$web" && npm run build --loglevel=error >/dev/null)
  (cd "$src" && CGO_ENABLED=0 go build -o "$out" ./cmd/kestrel)
  echo "built $out"
}

start() {
  local bin=${1:?usage: demo.sh start <binary>}
  [ -x "$bin" ] || die "$bin is not an executable; build one with demo.sh build"
  bin=$(cd "$(dirname "$bin")" && pwd)/$(basename "$bin")
  [ -d "$here/node_modules/playwright-core" ] || die "run npm ci --prefix scripts/demo first"
  if [ -e "$dir" ] && [ ! -f "$dir/.kestrel-demo" ] && [ -n "$(ls -A "$dir")" ]; then
    die "$dir exists and is not a demo dir; set DEMO_DIR to another path"
  fi
  stop
  for p in "$port" "$fport"; do
    ! curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$p/" || die "port $p is taken; stop what holds it or set DEMO_PORT / DEMO_FAKE_PORT"
  done
  rm -rf "$dir"
  mkdir -p "$dir/config" "$dir/data/media" "$dir/posters" "$dir/logs" "$dir/bin"
  touch "$dir/.kestrel-demo"

  python3 -I "$here/fake.py" --titles | node "$here/posters.mjs" "$dir/posters"
  (cd "$repo" && go build -o "$dir/bin/parse" ./scripts/demo/parse)

  nohup python3 -I "$here/fake.py" --port "$fport" --posters "$dir/posters" \
    </dev/null >"$dir/logs/fake.log" 2>&1 &
  echo $! >"$dir/fake.pid"
  wait_for "$fake/_ctl" "fake.py"

  KESTREL_PORT=$port KESTREL_CONFIG_DIR=$dir/config KESTREL_DATA_DIR=$dir/data \
    KESTREL_TMDB_API_KEY=demo KESTREL_TVDB_API_KEY=demo \
    KESTREL_TMDB_API_URL=$fake/3 KESTREL_TMDB_IMAGE_URL=$fake/t/p KESTREL_TVDB_API_URL=$fake/v4 \
    KESTREL_PLEX_TV_URL=$fake/plextv KESTREL_PLEX_APP_URL=$fake/plextv/auth \
    nohup "$bin" </dev/null >"$dir/logs/kestrel.log" 2>&1 &
  echo $! >"$dir/kestrel.pid"
  wait_for "http://127.0.0.1:$port/ping" "Kestrel"

  if [ "${DEMO_SEED:-1}" = 0 ]; then
    echo "Kestrel on http://127.0.0.1:$port, not seeded (setup wizard), fake on $fake, logs in $dir/logs"
    return
  fi
  python3 -I "$here/seed.py" --kestrel "http://127.0.0.1:$port" --db "$dir/config/kestrel.db" \
    --media "$dir/data/media" --fake "$fake" --parse "$dir/bin/parse"
  if [ -n "${DEMO_TITLES:-}" ]; then
    python3 -I "$here/seed_big.py" --db "$dir/config/kestrel.db" --media "$dir/data/media" --titles "$DEMO_TITLES"
  fi
  echo "Kestrel on http://127.0.0.1:$port (demo / demo-password-123), fake on $fake, logs in $dir/logs"
}

releases() {
  case ${1:-} in
    on) curl -sf "$fake/_ctl?releases=1" ;;
    off) curl -sf "$fake/_ctl?releases=0" ;;
    *) die "usage: demo.sh releases on|off" ;;
  esac
  echo
}

unlisted() {
  case ${1:-} in
    on) curl -sf "$fake/_ctl?unlisted=1" ;;
    off) curl -sf "$fake/_ctl?unlisted=0" ;;
    *) die "usage: demo.sh unlisted on|off" ;;
  esac
  echo
}

cmd=${1:-}
shift || true
case $cmd in
  build) build "$@" ;;
  start) start "$@" ;;
  stop) stop ;;
  releases) releases "$@" ;;
  unlisted) unlisted "$@" ;;
  status) status ;;
  port) echo "$port" ;;
  *) sed -n '2,19s/^# \{0,1\}//p' "$0"; exit 2 ;;
esac
