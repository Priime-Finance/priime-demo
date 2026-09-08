#!/usr/bin/env bash
# M3-5: determinism check for the vault-nav component.
#
# Two independent executions of the component against the same chain state
# must produce byte-identical result payloads (identical result hashes are
# what lets independent operators reach quorum, NAV-04). The component derives
# inputs_block from the cron trigger_time (wall clock), not the chain head, so
# determinism here means: same trigger_time -> same resolved inputs_block ->
# same payload, regardless of how far the fork's clock (fork.sh runs it on
# --block-time now) has ticked on between the two runs. The check pauses the
# WAVS node so it can't submit a strike against the vault mid-check, executes
# the component twice via `wavs-cli exec --simulates-trigger` at one fixed
# trigger_time (same engine the node runs), and compares the raw payload
# bytes. The full 3-node quorum proof arrives with Phase 2; this retires the
# single-component half of the risk.
#
# Prereqs: deploy/fork.sh + deploy/vault-service.sh (running node).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"          # priime-demo
DEPLOY="$ROOT/deploy"
source "$DEPLOY/target.sh"                        # TARGET, RPC, STATE_DIR, say(), cfg()
FORKDIR="$STATE_DIR"
HOME_DIR="$FORKDIR/wavs-vault"
WAVS_IMG="ghcr.io/lay3rlabs/wavs:2.0.0-vault-rc.15"
NODE="wavs-vault"

# --- preconditions -----------------------------------------------------------
say "preconditions (TARGET=$TARGET, chain $CHAIN_ID)"
require_chain_up            # fork: anvil pidfile + chain id; live: chain id
[ -f "$HOME_DIR/component-config.json" ] \
  || { echo "FATAL: no component config; run deploy/vault-service.sh first"; exit 1; }
docker inspect "$NODE" >/dev/null 2>&1 \
  || { echo "FATAL: node container $NODE not found; run deploy/vault-service.sh"; exit 1; }

# --- pause the node so it can't strike the vault mid-check -------------------
say "pause node"
NODE_WAS_RUNNING=$(docker inspect -f '{{.State.Running}}' "$NODE")
docker stop "$NODE" >/dev/null
trap '[ "$NODE_WAS_RUNNING" = "true" ] && docker start "$NODE" >/dev/null 2>&1 || true' EXIT
sleep 2
HEAD0=$(cast block-number --rpc-url "$RPC")
echo "head at $HEAD0 (fork.sh's --block-time keeps mining regardless of the node; expected)"

# --- run the component twice at ONE fixed trigger_time -----------------------
# `--input` produces TriggerData::Raw, which the component now rejects
# outright (it requires a Cron trigger for trigger_time). --simulates-trigger
# feeds it a real Cron TriggerData instead; --input is still required by
# wavs-cli's arg parser but its value is discarded once --simulates-trigger is
# set. Both runs get the SAME literal nanos, computed once: that's what makes
# this a determinism check now that inputs_block tracks wall-clock
# trigger_time rather than the chain head.
NANOS=$(( $(cast block latest -f timestamp --rpc-url "$RPC") * 1000000000 ))
SIM_TRIGGER="{\"Cron\":{\"trigger_time\":$NANOS}}"

CONFIG_ARGS=()
while IFS= read -r kv; do CONFIG_ARGS+=(--config "$kv"); done \
  < <(jq -r 'to_entries[] | "\(.key)=\(.value)"' "$HOME_DIR/component-config.json")

run_exec() { # run_exec <n>
  docker run --rm --network host -v "$HOME_DIR:/data" -v "$FORKDIR:/fork" "$WAVS_IMG" \
    wavs-cli exec --home /data --data /data/.docker --component /fork/vault_nav.wasm \
    --input "unused" --simulates-trigger "$SIM_TRIGGER" \
    --json true --quiet-results true --save-deployment false \
    -o "/fork/exec-$1.json" "${CONFIG_ARGS[@]}" >/dev/null 2>&1
  jq -r '.[0].payload // empty' "$FORKDIR/exec-$1.json"
}

say "execute component twice at trigger_time $NANOS"
P1=$(run_exec 1)
P2=$(run_exec 2)
HEAD1=$(cast block-number --rpc-url "$RPC")
echo "head $HEAD0 -> $HEAD1 during the two runs (fine: inputs_block is pinned by trigger_time, not head)"
[ -n "$P1" ] && [ -n "$P2" ] || { echo "FATAL: empty payload from exec (see $FORKDIR/exec-*.json)"; exit 1; }

H1=$(echo -n "$P1" | shasum -a 256 | awk '{print $1}')
H2=$(echo -n "$P2" | shasum -a 256 | awk '{print $1}')
echo "run 1: sha256(payload) = $H1"
echo "run 2: sha256(payload) = $H2"
[ "$P1" = "$P2" ] || { echo "FAILED: payloads differ at identical inputs_block"; exit 1; }

say "resume node"
docker start "$NODE" >/dev/null
trap - EXIT
echo "SUCCESS: identical result bytes across independent executions at trigger_time $NANOS (payload $((${#P1}/2-1)) bytes, hash $H1)"
