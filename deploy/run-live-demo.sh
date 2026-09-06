#!/usr/bin/env bash
# One-shot local demo: brings up the pinned fork, the WAVS service, the loop
# server and the replay UI dev server, then opens Brave on /vault so the
# Live loops section (with a Deploy loop form) is visible.
#
# Idempotent-ish: rerunning re-executes fork.sh + vault-service.sh (fresh
# manager + vault each time) and restarts the two node servers; IPFS is left
# alone if it was already up. Logs land in deploy/.fork/live-demo/*.log.
#
# Cleanup: `bash deploy/run-live-demo.sh stop` shuts down the two servers,
# the wavs-vault container and anvil (IPFS stays running).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FORKDIR="$ROOT/deploy/.fork"
LOGDIR="$FORKDIR/live-demo"
mkdir -p "$LOGDIR"
PIDFILE_LS="$LOGDIR/loop-server.pid"
PIDFILE_UI="$LOGDIR/replay-ui.pid"
PIDFILE_IPFS="$LOGDIR/ipfs.pid"

TOKEN="${LOOP_SERVER_TOKEN:-demo-token-0123456789abcdef}"
UI_PORT="${UI_PORT:-3000}"
LS_PORT="${LS_PORT:-8090}"
BROWSER="${BROWSER:-brave}"

say() { printf '\n== %s ==\n' "$*"; }
warn() { printf '!! %s\n' "$*" >&2; }

stop_pidfile() {
  local path="$1" label="$2"
  [ -f "$path" ] || return 0
  local pid
  pid="$(cat "$path")"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    echo "stopping $label (pid $pid)"
    kill "$pid" 2>/dev/null || true
    sleep 1
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$path"
}

if [ "${1:-}" = "stop" ]; then
  say "stopping live-demo servers"
  stop_pidfile "$PIDFILE_LS" "loop-server"
  stop_pidfile "$PIDFILE_UI" "replay-ui"
  docker rm -f wavs-vault >/dev/null 2>&1 || true
  if [ -f "$FORKDIR/anvil.pid" ]; then
    pid="$(cat "$FORKDIR/anvil.pid")"
    kill "$pid" 2>/dev/null || true
    rm -f "$FORKDIR/anvil.pid"
    echo "stopping anvil (pid $pid)"
  fi
  echo "IPFS left running; kill it with: kill \$(cat $PIDFILE_IPFS) 2>/dev/null"
  exit 0
fi

# --- prereqs ---------------------------------------------------------------
say "prereqs"
for cmd in anvil ipfs docker forge pnpm cast jq curl "$BROWSER"; do
  command -v "$cmd" >/dev/null 2>&1 || { warn "missing: $cmd"; exit 1; }
done
docker info >/dev/null 2>&1 || { warn "docker daemon not running (sudo rc-service docker start)"; exit 1; }

# --- IPFS ------------------------------------------------------------------
say "IPFS"
if curl -sf -X POST http://127.0.0.1:5001/api/v0/id >/dev/null 2>&1; then
  echo "IPFS already up on :5001"
else
  echo "starting IPFS daemon"
  nohup ipfs daemon > "$LOGDIR/ipfs.log" 2>&1 &
  echo $! > "$PIDFILE_IPFS"
  for _ in $(seq 1 30); do
    curl -sf -X POST http://127.0.0.1:5001/api/v0/id >/dev/null 2>&1 && break
    sleep 1
  done
  curl -sf -X POST http://127.0.0.1:5001/api/v0/id >/dev/null 2>&1 || { warn "IPFS never became ready (see $LOGDIR/ipfs.log)"; exit 1; }
fi

# --- fork + service --------------------------------------------------------
say "fork + service (deploy/fork.sh + deploy/vault-service.sh)"
bash "$ROOT/deploy/fork.sh"
bash "$ROOT/deploy/vault-service.sh"

# --- loop-server -----------------------------------------------------------
say "loop-server"
stop_pidfile "$PIDFILE_LS" "loop-server"
SVC_JSON="$FORKDIR/vault-service.json"
SM="$(jq -r .service_manager "$SVC_JSON")"
DIG="$(jq -r '.workflows | to_entries[0].value.component.source.download.digest' "$FORKDIR/wavs-vault/service.json")"

pushd "$ROOT/apps/loop-server" >/dev/null
LOOP_SERVER_TOKEN="$TOKEN" \
RPC_URL="http://127.0.0.1:8545" \
CHAIN_ID="31337" \
MANAGER_ADDRESS="$SM" \
OWNER_PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" \
USDC_ADDRESS="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" \
PORT="$LS_PORT" \
DB_PATH="/tmp/loop-demo.db" \
COMPONENT_DIGEST="sha256:$DIG" \
QUORUM_THRESHOLD="1" QUORUM_TOTAL="1" \
  nohup node src/main.ts > "$LOGDIR/loop-server.log" 2>&1 &
echo $! > "$PIDFILE_LS"
popd >/dev/null

for _ in $(seq 1 40); do
  curl -sf "http://127.0.0.1:$LS_PORT/healthz" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -sf "http://127.0.0.1:$LS_PORT/healthz" >/dev/null 2>&1 || { warn "loop-server never became ready (see $LOGDIR/loop-server.log)"; exit 1; }
echo "loop-server ready on :$LS_PORT"

# --- replay-ui -------------------------------------------------------------
say "replay-ui"
stop_pidfile "$PIDFILE_UI" "replay-ui"

pushd "$ROOT/apps/replay-ui" >/dev/null
[ -d node_modules ] || pnpm install >/dev/null 2>&1
LOOP_SERVER_URL="http://127.0.0.1:$LS_PORT" \
LOOP_SERVER_TOKEN="$TOKEN" \
  nohup pnpm dev -- -p "$UI_PORT" > "$LOGDIR/replay-ui.log" 2>&1 &
echo $! > "$PIDFILE_UI"
popd >/dev/null

for _ in $(seq 1 60); do
  curl -sf "http://127.0.0.1:$UI_PORT" >/dev/null 2>&1 && break
  sleep 1
done
curl -sf "http://127.0.0.1:$UI_PORT" >/dev/null 2>&1 || { warn "replay-ui never became ready (see $LOGDIR/replay-ui.log)"; exit 1; }
echo "replay-ui ready on :$UI_PORT"

# --- summary ---------------------------------------------------------------
say "ready"
cat <<EOF
Loop server   : http://127.0.0.1:$LS_PORT
Replay UI     : http://127.0.0.1:$UI_PORT

Directory     : http://127.0.0.1:$UI_PORT/vault  (scroll to Live loops, use the form)
Raw journals  : http://127.0.0.1:$UI_PORT/api/loops/<id>/journals?limit=5

Logs          : $LOGDIR/{loop-server,replay-ui,ipfs}.log
Stop it all   : bash $0 stop
EOF

say "opening $BROWSER"
setsid "$BROWSER" --new-window "http://127.0.0.1:$UI_PORT/vault" >/dev/null 2>&1 < /dev/null &
disown || true
