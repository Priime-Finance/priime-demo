#!/usr/bin/env bash
# M3-5: determinism check for the vault-nav component.
#
# Two independent executions of the component against the same chain state
# must produce byte-identical result payloads (identical result hashes are
# what lets independent operators reach quorum, NAV-04). The check pauses the
# WAVS node so no strike advances the fork head between runs, executes the
# component twice via `wavs-cli exec` (same engine the node runs), and
# compares the raw payload bytes. The full 3-node quorum proof arrives with
# Phase 2; this retires the single-component half of the risk.
#
# Prereqs: deploy/fork.sh + deploy/vault-service.sh (running node).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"          # priime-demo
DEPLOY="$ROOT/deploy"
CFG="$DEPLOY/fork.config.json"
FORKDIR="$DEPLOY/.fork"
HOME_DIR="$FORKDIR/wavs-vault"
WAVS_IMG="ghcr.io/lay3rlabs/wavs:2.0.0-vault-rc.15"
NODE="wavs-vault"

say() { echo; echo "== $* =="; }
cfg() { jq -r "$1" "$CFG"; }
FORK_PORT="${FORK_PORT:-$(cfg .fork.fork_port)}"
RPC="http://localhost:$FORK_PORT"

# --- preconditions -----------------------------------------------------------
say "preconditions"
[ -f "$FORKDIR/anvil.pid" ] && kill -0 "$(cat "$FORKDIR/anvil.pid")" 2>/dev/null \
  || { echo "FATAL: no running fork; start it with: deploy/fork.sh"; exit 1; }
[ -f "$HOME_DIR/component-config.json" ] \
  || { echo "FATAL: no component config; run deploy/vault-service.sh first"; exit 1; }
docker inspect "$NODE" >/dev/null 2>&1 \
  || { echo "FATAL: node container $NODE not found; run deploy/vault-service.sh"; exit 1; }

# --- pause strikes so the head stays fixed between the two runs --------------
say "pause node (freeze chain head)"
NODE_WAS_RUNNING=$(docker inspect -f '{{.State.Running}}' "$NODE")
docker stop "$NODE" >/dev/null
trap '[ "$NODE_WAS_RUNNING" = "true" ] && docker start "$NODE" >/dev/null 2>&1 || true' EXIT
sleep 2
HEAD0=$(cast block-number --rpc-url "$RPC")
echo "head frozen at $HEAD0"

# --- run the component twice against the same state --------------------------
CONFIG_ARGS=()
while IFS= read -r kv; do CONFIG_ARGS+=(--config "$kv"); done \
  < <(jq -r 'to_entries[] | "\(.key)=\(.value)"' "$HOME_DIR/component-config.json")

run_exec() { # run_exec <n>
  docker run --rm --network host -v "$HOME_DIR:/data" -v "$FORKDIR:/fork" "$WAVS_IMG" \
    wavs-cli exec --home /data --data /data/.docker --component /fork/vault_nav.wasm \
    --input "cron" --json true --quiet-results true --save-deployment false \
    -o "/fork/exec-$1.json" "${CONFIG_ARGS[@]}" >/dev/null 2>&1
  jq -r '.[0].payload // empty' "$FORKDIR/exec-$1.json"
}

say "execute component twice at head $HEAD0"
P1=$(run_exec 1)
P2=$(run_exec 2)
HEAD1=$(cast block-number --rpc-url "$RPC")
[ "$HEAD0" = "$HEAD1" ] || { echo "FATAL: head moved ($HEAD0 -> $HEAD1); rerun"; exit 1; }
[ -n "$P1" ] && [ -n "$P2" ] || { echo "FATAL: empty payload from exec (see $FORKDIR/exec-*.json)"; exit 1; }

H1=$(echo -n "$P1" | shasum -a 256 | awk '{print $1}')
H2=$(echo -n "$P2" | shasum -a 256 | awk '{print $1}')
echo "run 1: sha256(payload) = $H1"
echo "run 2: sha256(payload) = $H2"
[ "$P1" = "$P2" ] || { echo "FAILED: payloads differ at identical inputs_block"; exit 1; }

say "resume node"
docker start "$NODE" >/dev/null
trap - EXIT
echo "SUCCESS: identical result bytes across independent executions at head $HEAD0 (payload $((${#P1}/2-1)) bytes, hash $H1)"
