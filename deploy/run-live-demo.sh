#!/usr/bin/env bash
# One-shot local demo: brings up the chain (the pinned fork by default), the
# WAVS service, the loop server and the replay UI dev server, then opens Brave
# on /vault so the Live loops section (with a Deploy loop form) is visible.
#
# Target-aware like the rest of deploy/: TARGET=fork (the default) is the
# pinned anvil fork and behaves exactly as it always has. TARGET=mainnet skips
# the fork step (the chain is already up) and refuses to default the loop
# server's auth token or the browser-facing RPC URL. See deploy/target.sh.
#
# Idempotent-ish: rerunning re-executes fork.sh + vault-service.sh (fresh
# manager + vault each time) and restarts the two node servers; IPFS is left
# alone if it was already up. Logs land in deploy/.<target>/live-demo/*.log.
#
# Cleanup: `bash deploy/run-live-demo.sh stop` shuts down the two servers,
# the wavs-vault-N containers and anvil (IPFS stays running).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY="$ROOT/deploy"
source "$DEPLOY/target.sh"                        # TARGET, RPC, CHAIN_ID, STATE_DIR, helpers
FORKDIR="$STATE_DIR"
LOGDIR="$FORKDIR/live-demo"
mkdir -p "$LOGDIR"
PIDFILE_LS="$LOGDIR/loop-server.pid"
PIDFILE_UI="$LOGDIR/replay-ui.pid"
PIDFILE_IPFS="$LOGDIR/ipfs.pid"

# The demo token is a fine default for a throwaway fork and is not one for a
# live chain: the loop server holds the vault owner key behind it.
if [ "$IS_FORK" = "1" ]; then
  TOKEN="${LOOP_SERVER_TOKEN:-demo-token-0123456789abcdef}"
else
  TOKEN=$(required_env LOOP_SERVER_TOKEN)
fi
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
  docker rm -f wavs-vault wavs-vault-1 wavs-vault-2 wavs-vault-3 >/dev/null 2>&1 || true
  # There is only an anvil to stop when we started one.
  if [ "$IS_FORK" = "1" ] && [ -f "$FORKDIR/anvil.pid" ]; then
    pid="$(cat "$FORKDIR/anvil.pid")"
    kill "$pid" 2>/dev/null || true
    rm -f "$FORKDIR/anvil.pid"
    echo "stopping anvil (pid $pid)"
  fi
  echo "IPFS left running; kill it with: kill \$(cat $PIDFILE_IPFS) 2>/dev/null"
  exit 0
fi

# --- prereqs ---------------------------------------------------------------
say "prereqs (TARGET=$TARGET, chain $CHAIN_ID)"
PREREQS=(ipfs docker forge pnpm cast jq curl "$BROWSER")
if [ "$IS_FORK" = "1" ]; then PREREQS+=(anvil); fi   # only a fork needs anvil on PATH
for cmd in "${PREREQS[@]}"; do
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

# --- chain + service -------------------------------------------------------
# fork.sh starts the pinned anvil. On a live target there is nothing to start:
# the chain is already there, which is the whole point of the distinction.
if [ "$IS_FORK" = "1" ]; then
  say "fork + service (deploy/fork.sh + deploy/vault-service.sh)"
  bash "$ROOT/deploy/fork.sh"
else
  say "service (deploy/vault-service.sh); chain $CHAIN_ID is already up"
fi
bash "$ROOT/deploy/vault-service.sh"

# --- loop-server -----------------------------------------------------------
say "loop-server"
stop_pidfile "$PIDFILE_LS" "loop-server"
SVC_JSON="$FORKDIR/vault-service.json"
SM="$(jq -r .service_manager "$SVC_JSON")"
DIG="$(jq -r '.workflows | to_entries[0].value.component.source.download.digest' "$FORKDIR/wavs-vault-1/service.json")"

# Node reaches a local anvil most reliably over the literal loopback address
# (localhost can resolve to ::1, which anvil is not listening on), so keep the
# fork on 127.0.0.1 and hand a live target its own URL.
if [ "$IS_FORK" = "1" ]; then
  SERVER_RPC="http://127.0.0.1:$RPC_PORT"
  PUBLIC_RPC="${NEXT_PUBLIC_RPC_URL:-$SERVER_RPC}"
  DB_FILE="${DB_PATH:-/tmp/loop-demo.db}"
else
  SERVER_RPC="$RPC"
  # The browser-facing URL is separate and required: $RPC usually carries a
  # provider API key in its path and must not be shipped to the client.
  PUBLIC_RPC=$(required_env PRIIME_PUBLIC_RPC_URL)
  DB_FILE="${DB_PATH:-$FORKDIR/loops.db}"
fi

pushd "$ROOT/apps/loop-server" >/dev/null
LOOP_SERVER_TOKEN="$TOKEN" \
RPC_URL="$SERVER_RPC" \
CHAIN_ID="$CHAIN_ID" \
MANAGER_ADDRESS="$SM" \
OWNER_PRIVATE_KEY="$(role_key owner)" \
USDC_ADDRESS="$(cfg .tokens.usdc.address)" \
VAULT_SERVICE_JSON="$SVC_JSON" \
PORT="$LS_PORT" \
DB_PATH="$DB_FILE" \
COMPONENT_DIGEST="sha256:$DIG" \
QUORUM_THRESHOLD="2" QUORUM_TOTAL="3" \
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
NEXT_PUBLIC_RPC_URL="$PUBLIC_RPC" \
NEXT_PUBLIC_CHAIN_ID="$CHAIN_ID" \
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
Target        : $TARGET (chain $CHAIN_ID, cron $CRON_SCHEDULE)
Loop server   : http://127.0.0.1:$LS_PORT
Replay UI     : http://127.0.0.1:$UI_PORT

Composer      : http://127.0.0.1:$UI_PORT/build   ← pick USDe/USDC, Install defaults, Review & publish
Directory     : http://127.0.0.1:$UI_PORT/vault
Raw journals  : http://127.0.0.1:$UI_PORT/api/loops/<id>/journals?limit=5
EOF

if [ "$IS_FORK" = "1" ]; then
  # The anvil junk mnemonic's account #1. Public, worthless, and only ever
  # funded on a local fork.
  cat <<EOF

Wallet (one-time in MetaMask/Brave Wallet):
  Network     : Custom RPC $SERVER_RPC, chain id $CHAIN_ID
  Import key  : $(cast wallet private-key --mnemonic "$TARGET_MNEMONIC" --mnemonic-index 1)
                ($(cast wallet address --mnemonic "$TARGET_MNEMONIC" --mnemonic-index 1), 10000 ETH on the fork)
EOF
else
  cat <<EOF

Wallet        : connect the account you intend to deposit from. Nothing on a
                live target is pre-funded and no key is printed here.
EOF
fi

cat <<EOF

Logs          : $LOGDIR/{loop-server,replay-ui,ipfs}.log
Stop it all   : TARGET=$TARGET bash $0 stop
EOF

if [ "${OPEN_BROWSER:-1}" = "1" ]; then
  say "opening $BROWSER on /build"
  setsid "$BROWSER" --new-window "http://127.0.0.1:$UI_PORT/build" >/dev/null 2>&1 < /dev/null &
  disown || true
else
  echo "skipping browser (OPEN_BROWSER=0); open http://127.0.0.1:$UI_PORT/build yourself"
fi
