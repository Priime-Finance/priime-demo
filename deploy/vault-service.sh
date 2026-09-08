#!/usr/bin/env bash
# M3-4: the vault WAVS service on the pinned Base fork.
#
# One service, one manager, one operator set (the production topology): a
# single POA service manager backs the whole service, and the vault NAV
# workflow (cron -> vault-nav component -> aggregator -> PriimeVault) runs
# under it. Attestations are scoped to the vault by payload binding: the
# component signs (handler, nav, inputsBlock) and the vault rejects payloads
# not bound to its own address.
#
#   1. deploys the POA service manager (quorum 1/1 today; Phase 2 raises it
#      to 2-of-3 on this same topology),
#   2. deploys PriimeVault against it and asserts the wiring,
#   3. builds + pins the vault-nav and aggregator components to IPFS,
#   4. assembles service.json: cron trigger -> vault-nav (market/pool/vault
#      config from fork.config.json) -> aggregator submit -> PriimeVault,
#   5. registers an operator with EPHEMERAL per-run keys (on a Base fork the
#      well-known anvil addresses carry EIP-7702 delegations and cannot be
#      ECDSA signers; fresh random keys are code-free),
#   6. ensures the Aerodrome pool's observation cardinality covers the TWAP
#      window across the loop-entry swaps (permissionless, standard call),
#   7. starts the WAVS node against the fork, deploys the service, and waits
#      for the first cron strike to land in the vault (updateCount >= 1).
#
# Writes $STATE_DIR/vault-service.json for enter-loop.sh (vault, manager,
# strategist). Strategy numbers stay in fork.config.json (LOOP-03), which is
# shared by every target because the fork IS Base at a pinned block.
#
# Target-aware: TARGET=fork (default) is the pinned anvil fork and behaves
# exactly as it always has; TARGET=mainnet is Base itself, where the operator
# is funded by a real transfer instead of anvil_setBalance and a block is
# waited for instead of mined. See deploy/target.sh.
#
# Prereqs:
#   deploy/fork.sh                                   # TARGET=fork only: pinned Base fork on :8545
#   ipfs daemon                                      # api on :5001
#   docker images: ghcr.io/lay3rlabs/wavs:2.0.0-vault-rc.15, poa-middleware:1.0.1
#   TARGET=mainnet: PRIIME_RPC_URL + the four role keys named in
#                   deploy/targets/mainnet.json, and a treasury holding ETH.
#
# Re-runnable: fresh manager + vault + node each run (restart fork.sh for a
# pristine chain).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"          # priime-demo
DEPLOY="$ROOT/deploy"
source "$DEPLOY/target.sh"                        # TARGET, RPC, CHAIN, STATE_DIR, CRON_SCHEDULE, helpers
FORKDIR="$STATE_DIR"
HOME_DIR="$FORKDIR/wavs-vault"                    # node home (wavs.toml, service.json)
WAVS_IMG="ghcr.io/lay3rlabs/wavs:2.0.0-vault-rc.15"
POA_IMG="ghcr.io/lay3rlabs/poa-middleware:1.0.1"
NODE="wavs-vault"
GATEWAY="http://127.0.0.1:8080/ipfs/"

# --- 0. config + keys -------------------------------------------------------
FORK_PORT="$RPC_PORT"
FORK_CHAIN_ID="$CHAIN_ID"

USDC=$(cfg .tokens.usdc.address)
USDE=$(cfg .tokens.usde.address)
MORPHO=$(cfg .morpho.blue)
MKT=$(cfg .morpho.market.id)
ORACLE=$(cfg .morpho.market.params.oracle)
IRM=$(cfg .morpho.market.params.irm)
LLTV=$(cfg .morpho.market.params.lltv)
POOL=$(cfg .swap_route.pool)
CRON="$CRON_SCHEDULE"                             # per target: 10s on the fork, hourly on Base
TWAP_WINDOW=$(cfg .service.twap_window_secs)
BLOCK_LAG=$(cfg .service.inputs_block_lag)
OBS_CARD=$(cfg .service.observation_cardinality)
OPERATOR_GAS=$(tcfg_req .funding.operator_gas_wei)

# Role keys come from the target: the anvil mnemonic on the fork (where
# accounts originate transactions only, 7702 delegation code being inert for
# origination), named env vars on a live chain. owner funds and owns,
# strategist is the only account vault.execute() accepts.
K0=$(role_key owner)
STRATEGIST=$(role_addr strategist)
# Ephemeral per-run node mnemonic: operator = index 0, signing key = index 1
# (same layout deploy.sh uses on plain anvil). Both fresh, so code-free EOAs.
# Target-independent: fresh keys are correct on Base too, they just have to be
# funded for real (see fund_account below) instead of conjured.
NODE_MNEMONIC=$(cast wallet new-mnemonic | sed -n '/Phrase:/{n;p;}' | xargs)
[ "$(echo "$NODE_MNEMONIC" | wc -w | xargs)" = "12" ] || { echo "FATAL: could not generate node mnemonic"; exit 1; }
OPERATOR=$(cast wallet address --mnemonic "$NODE_MNEMONIC" --mnemonic-index 0)
K_OP=$(cast wallet private-key --mnemonic "$NODE_MNEMONIC" --mnemonic-index 0)
SIGNING=$(cast wallet address --mnemonic "$NODE_MNEMONIC" --mnemonic-index 1)

# --- 1. preconditions -------------------------------------------------------
say "preconditions (TARGET=$TARGET, chain $CHAIN_ID)"
require_chain_up            # fork: anvil pidfile + chain id; live: chain id
require_gas owner "$(role_addr owner)"     # no-op on the fork; anvil pre-funds
[ "$(cast code "$MORPHO" --rpc-url "$RPC")" != "0x" ] \
  || { echo "FATAL: Morpho Blue has no code at $RPC; this is not Base (nor a fork of it)"; exit 1; }
curl -sf -X POST "http://127.0.0.1:5001/api/v0/id" >/dev/null 2>&1 \
  || { echo "FATAL: IPFS api not reachable on :5001 (run: ipfs daemon)"; exit 1; }
docker info >/dev/null 2>&1 || { echo "FATAL: docker daemon not running"; exit 1; }

# RPC as seen from inside containers.
if [ "$IS_FORK" = "1" ]; then
  # A port on this machine: Docker Desktop needs host.docker.internal, Linux
  # with --network host is happy with localhost. Probe both.
  DOCKER_RPC=""
  for cand in "http://localhost:$FORK_PORT" "http://host.docker.internal:$FORK_PORT"; do
    if docker run --rm --network host --entrypoint cast "$POA_IMG" chain-id --rpc-url "$cand" >/dev/null 2>&1; then
      DOCKER_RPC="$cand"; break
    fi
  done
  [ -n "$DOCKER_RPC" ] || { echo "FATAL: fork not reachable from inside docker"; exit 1; }
  DOCKER_WS="${DOCKER_RPC/http/ws}"
else
  # A remote URL resolves the same inside the container as outside.
  DOCKER_RPC="$RPC"
  docker run --rm --network host --entrypoint cast "$POA_IMG" chain-id --rpc-url "$DOCKER_RPC" >/dev/null 2>&1 \
    || { echo "FATAL: $RPC not reachable from inside docker"; exit 1; }
  # https -> wss by the same substitution. Providers that serve websockets on
  # a different host need PRIIME_WS_URL set explicitly.
  DOCKER_WS="${PRIIME_WS_URL:-${DOCKER_RPC/http/ws}}"
fi
# host[:port] the components actually dial (wavs.toml http_endpoint below);
# scopes component --http-hosts instead of the chain being wide open.
DOCKER_RPC_HOST="${DOCKER_RPC#http://}"; DOCKER_RPC_HOST="${DOCKER_RPC_HOST#https://}"
DOCKER_RPC_HOST="${DOCKER_RPC_HOST%%/*}"
# The IPFS gateway is always local, whatever the chain is. On the fork the
# host that reached the chain also reaches kubo (which listens on 0.0.0.0), so
# reuse it. On a live target the chain is a remote URL and says nothing about
# the container's view of this machine, so assume the --network host case and
# let IPFS_DOCKER_HOST override it (Docker Desktop: host.docker.internal).
if [ "$IS_FORK" = "1" ]; then
  DOCKER_HOST_NAME="${DOCKER_RPC#http://}"; DOCKER_HOST_NAME="${DOCKER_HOST_NAME%:*}"
else
  DOCKER_HOST_NAME="${IPFS_DOCKER_HOST:-localhost}"
fi
GATEWAY="http://$DOCKER_HOST_NAME:8080/ipfs/"
curl -sf "http://127.0.0.1:8080/ipfs/" -o /dev/null -w '' 2>/dev/null || true
echo "chain ok: block $(cast block-number --rpc-url "$RPC"); container RPC $DOCKER_RPC; gateway $GATEWAY"

# --- 2. build components + contracts ----------------------------------------
say "build components (wasm32-wasip2) + contracts"
( cd "$ROOT/components/vault-nav"        && cargo build --release --target wasm32-wasip2 >/dev/null )
( cd "$ROOT/components/hello-aggregator" && cargo build --release --target wasm32-wasip2 >/dev/null )
( cd "$ROOT/contracts" && forge build >/dev/null )
mkdir -p "$HOME_DIR" "$FORKDIR/nodes-vault" "$FORKDIR/.docker"
cp "$ROOT/components/vault-nav/target/wasm32-wasip2/release/priime_vault_nav.wasm"               "$FORKDIR/vault_nav.wasm"
cp "$ROOT/components/hello-aggregator/target/wasm32-wasip2/release/priime_hello_aggregator.wasm" "$FORKDIR/aggregator.wasm"

# Node + CLI config up front: wavs-cli reads wavs.toml from its home dir for
# every subcommand, so it must exist before service.json assembly. The empty
# .env keeps the CLI's dotenv autoload from choking.
cat > "$HOME_DIR/wavs.toml" <<EOF
[default]
[default.chains.evm.$FORK_CHAIN_ID]
ws_endpoints = ["$DOCKER_WS"]
http_endpoint = "$DOCKER_RPC"

[wavs]
ipfs_gateway = "$GATEWAY"
port = 8041
host = "0.0.0.0"
dev_endpoints_enabled = true
signing_mnemonic = "$NODE_MNEMONIC"
mcp_chain_credential = "$K0"
aggregator_evm_credential = "$K0"

[cli]
evm_credential = "$K0"
EOF
: > "$HOME_DIR/.env"

# --- 3. POA service manager (THE service manager: one per service) ----------
say "deploy POA service manager"
cat > "$FORKDIR/poa-vault.env" <<EOF
RPC_URL=$DOCKER_RPC
FUNDED_KEY=$K0
DEPLOY_ENV=LOCAL
EOF
POA=(docker run --rm --network host -v "$FORKDIR/nodes-vault:/root/.nodes" --env-file "$FORKDIR/poa-vault.env" "$POA_IMG")
"${POA[@]}" deploy >/dev/null
SM=$(jq -r '.addresses.POAStakeRegistry' "$FORKDIR/nodes-vault/poa_deploy.json")
# The deploy container has returned but its last transaction may not be in a
# block the next reader sees. On the fork we mine one; on a live chain we wait.
mine_or_wait
"${POA[@]}" owner_operation updateStakeThreshold 1 >/dev/null
"${POA[@]}" owner_operation updateQuorum 1 1 >/dev/null
echo "service manager: $SM"

# --- 4. deploy PriimeVault --------------------------------------------------
say "deploy PriimeVault"
VAULT=$( cd "$ROOT/contracts" && forge create src/PriimeVault.sol:PriimeVault \
  --rpc-url "$RPC" --private-key "$K0" --broadcast \
  --constructor-args "$SM" "$USDC" "$STRATEGIST" \
  | awk '/Deployed to/{print $NF}' )
echo "vault: $VAULT (strategist $STRATEGIST)"
GOT_SM=$(cast call "$VAULT" 'getServiceManager()(address)' --rpc-url "$RPC")
[ "$(echo "$GOT_SM" | tr 'A-F' 'a-f')" = "$(echo "$SM" | tr 'A-F' 'a-f')" ] \
  || { echo "FATAL: vault.getServiceManager()=$GOT_SM != $SM"; exit 1; }

# --- 5. TWAP observability: grow the pool's observation ring ----------------
# Cardinality is 1 at the pinned block; without growth our own entry swaps
# would leave the TWAP window unanswerable for its full length. Permissionless.
say "ensure pool observation cardinality >= $OBS_CARD"
cast send "$POOL" "increaseObservationCardinalityNext(uint16)" "$OBS_CARD" --private-key "$K0" --rpc-url "$RPC" >/dev/null
echo "observation cardinality next: $OBS_CARD"

# --- 6. pin components, assemble service.json -------------------------------
say "pin components to IPFS + assemble service.json"
NAV_CID=$(ipfs add -Q --pin=true "$FORKDIR/vault_nav.wasm")
AGG_CID=$(ipfs add -Q --pin=true "$FORKDIR/aggregator.wasm")
echo "vault-nav=$NAV_CID aggregator=$AGG_CID"

CLI=(docker run --rm --network host -w /data -v "$HOME_DIR:/data" "$WAVS_IMG" wavs-cli service \
  --json true --home /data --file /data/service.json --ipfs-gateway "$GATEWAY")
rm -f "$HOME_DIR/service.json"
START=$(date +%s%N); END=$(( START + 3600000000000 ))
"${CLI[@]}" init --name priime-vault >/dev/null
WID=$("${CLI[@]}" workflow add | jq -r '.workflow_id')
"${CLI[@]}" workflow trigger  --id "$WID" set-cron --schedule "$CRON" --start-time "$START" --end-time "$END" >/dev/null
"${CLI[@]}" workflow component --id "$WID" set-source-uri --uri "ipfs://$NAV_CID" >/dev/null
"${CLI[@]}" workflow component --id "$WID" permissions --http-hosts "$DOCKER_RPC_HOST" --file-system false >/dev/null
"${CLI[@]}" workflow component --id "$WID" fuel-limit --fuel 1000000000000 >/dev/null
"${CLI[@]}" workflow component --id "$WID" time-limit --seconds 30 >/dev/null
jq -n \
  --arg chain_id "$CHAIN" --arg vault_address "$VAULT" \
  --arg usdc_address "$USDC" --arg usde_address "$USDE" \
  --arg oracle_address "$ORACLE" --arg irm_address "$IRM" \
  --arg morpho_address "$MORPHO" --arg market_id "$MKT" --arg lltv "$LLTV" \
  --arg pool_address "$POOL" --arg twap_window_secs "$TWAP_WINDOW" \
  --arg inputs_block_lag "$BLOCK_LAG" \
  '$ARGS.named' > "$HOME_DIR/component-config.json"
"${CLI[@]}" workflow component --id "$WID" config --config-file /data/component-config.json >/dev/null
"${CLI[@]}" workflow submit    --id "$WID" set-aggregator >/dev/null
"${CLI[@]}" workflow submit    --id "$WID" component set-source-uri --uri "ipfs://$AGG_CID" >/dev/null
"${CLI[@]}" workflow submit    --id "$WID" component permissions --http-hosts "$DOCKER_RPC_HOST" --file-system false >/dev/null
"${CLI[@]}" workflow submit    --id "$WID" component config --values "$CHAIN=$VAULT" >/dev/null
"${CLI[@]}" manager set-evm --chain "$CHAIN" --address "$SM" >/dev/null
"${CLI[@]}" validate >/dev/null || true   # warns on registry availability; IPFS-sourced, safe
SVC_CID=$(ipfs add -Q --pin=true "$HOME_DIR/service.json")
echo "service cid: $SVC_CID"

# --- 7. register the operator (ephemeral keys) ------------------------------
say "register operator + signing key"
[ "$(cast code "$SIGNING" --rpc-url "$RPC")" = "0x" ] \
  || { echo "FATAL: signing key $SIGNING has code on chain $CHAIN_ID"; exit 1; }
# The operator pays for its own updateOperatorSigningKey below, so it needs
# gas. On the fork that is anvil_setBalance; on a live chain it is a real
# transfer from the treasury key. funding.operator_gas_wei is per target.
fund_account gas "$OPERATOR" "$OPERATOR_GAS"
cast send "$SM" "registerOperator(address,uint256)" "$OPERATOR" 1000 --private-key "$K0" --rpc-url "$RPC" >/dev/null
# Signing-key registration signs the raw keccak (no EIP-191 prefix) -> --no-hash.
ENC=$(cast abi-encode "f(address)" "$OPERATOR"); MSG=$(cast keccak "$ENC")
SIG=$(cast wallet sign --no-hash --mnemonic "$NODE_MNEMONIC" --mnemonic-index 1 "$MSG")
cast send "$SM" "updateOperatorSigningKey(address,bytes)" "$SIGNING" "$SIG" --private-key "$K_OP" --rpc-url "$RPC" >/dev/null
cast send "$SM" "setServiceURI(string)" "ipfs://$SVC_CID" --private-key "$K0" --rpc-url "$RPC" >/dev/null
echo "operator $OPERATOR registered, signing key $SIGNING"

# --- 8. start the node ------------------------------------------------------
say "start WAVS node"
docker rm -f "$NODE" >/dev/null 2>&1 || true
docker run -d --name "$NODE" --network host -v "$HOME_DIR:/root/wavs" "$WAVS_IMG" \
  wavs --home /root/wavs --ipfs-gateway "$GATEWAY" --host 0.0.0.0 --log-level info >/dev/null
for i in $(seq 1 30); do curl -sf http://localhost:8041/services >/dev/null 2>&1 && break; sleep 1; done

say "deploy service to node"
docker run --rm --network host -v "$HOME_DIR:/data" "$WAVS_IMG" wavs-cli deploy-service \
  --service-uri "ipfs://$SVC_CID" --log-level=info --data /data/.docker --home /data \
  --wavs-endpoint http://localhost:8041 --ipfs-gateway "$GATEWAY"

# --- 9. wait for the first cron strike --------------------------------------
# The budget is per target because the cadence is: 90s covers the fork's
# 10-second cron several times over, while an hourly mainnet cron needs more
# than an hour of patience. Both come from targets/<target>.json.
STRIKE_TRIES=$(( $(tcfg_req .service.first_strike_timeout_secs) / 5 ))
say "await first attested NAV strike (pre-position NAV: 0; cron $CRON, up to $((STRIKE_TRIES * 5))s)"
for i in $(seq 1 "$STRIKE_TRIES"); do
  sleep 5
  UPDATES=$(cast call "$VAULT" 'updateCount()(uint256)' --rpc-url "$RPC" | awk '{print $1}')
  if [ "$UPDATES" != "0" ]; then
    NAV=$(cast call "$VAULT" 'nav()(uint256)' --rpc-url "$RPC" | awk '{print $1}')
    IB=$(cast call "$VAULT" 'lastInputsBlock()(uint256)' --rpc-url "$RPC" | awk '{print $1}')
    jq -n --arg vault "$VAULT" --arg sm "$SM" --arg strategist "$STRATEGIST" --arg node "$NODE" --arg template_workflow_id "$WID" \
      --arg target "$TARGET" --arg chain_id "$CHAIN_ID" \
      '{vault: $vault, service_manager: $sm, strategist: $strategist, node: $node, template_workflow_id: $template_workflow_id, target: $target, chain_id: $chain_id}' \
      > "$FORKDIR/vault-service.json"
    echo "SUCCESS: updateCount=$UPDATES nav=$NAV inputsBlock=$IB"
    echo "vault=$VAULT  serviceManager=$SM  node=$NODE (docker logs $NODE)"
    exit 0
  fi
  echo "  t+$((i*5))s: no strike yet"
done
echo "FAILED: no strike landed; inspect: docker logs $NODE"; exit 1
