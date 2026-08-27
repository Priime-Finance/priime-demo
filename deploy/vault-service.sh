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
# Writes $FORKDIR/vault-service.json for enter-loop.sh (vault, manager,
# strategist). Strategy numbers stay in fork.config.json (LOOP-03).
#
# Prereqs:
#   deploy/fork.sh                                   # pinned Base fork on :8545
#   ipfs daemon                                      # api on :5001
#   docker images: ghcr.io/lay3rlabs/wavs:2.0.0-vault-rc.15, poa-middleware:1.0.1
#
# Re-runnable: fresh manager + vault + node each run (restart fork.sh for a
# pristine chain).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"          # priime-demo
DEPLOY="$ROOT/deploy"
CFG="$DEPLOY/fork.config.json"
FORKDIR="$DEPLOY/.fork"
HOME_DIR="$FORKDIR/wavs-vault"                    # node home (wavs.toml, service.json)
WAVS_IMG="ghcr.io/lay3rlabs/wavs:2.0.0-vault-rc.15"
POA_IMG="ghcr.io/lay3rlabs/poa-middleware:1.0.1"
NODE="wavs-vault"
GATEWAY="http://127.0.0.1:8080/ipfs/"
MNEMONIC="test test test test test test test test test test test junk"   # anvil default

say() { echo; echo "== $* =="; }
cfg() { jq -r "$1" "$CFG"; }

# --- 0. config + keys -------------------------------------------------------
FORK_PORT="${FORK_PORT:-$(cfg .fork.fork_port)}"
FORK_CHAIN_ID=$(cfg .fork.fork_chain_id)
RPC="http://localhost:$FORK_PORT"
CHAIN="evm:$FORK_CHAIN_ID"

USDC=$(cfg .tokens.usdc.address)
USDE=$(cfg .tokens.usde.address)
MORPHO=$(cfg .morpho.blue)
MKT=$(cfg .morpho.market.id)
ORACLE=$(cfg .morpho.market.params.oracle)
IRM=$(cfg .morpho.market.params.irm)
LLTV=$(cfg .morpho.market.params.lltv)
POOL=$(cfg .swap_route.pool)
CRON=$(cfg .service.cron_schedule)
TWAP_WINDOW=$(cfg .service.twap_window_secs)
BLOCK_LAG=$(cfg .service.inputs_block_lag)
OBS_CARD=$(cfg .service.observation_cardinality)

# Mnemonic accounts originate transactions only (7702 delegation code is
# inert for origination): index 0 funds/owns, index 4 is the strategist.
key()  { cast wallet private-key --mnemonic "$MNEMONIC" --mnemonic-index "$1"; }
addr() { cast wallet address     --mnemonic "$MNEMONIC" --mnemonic-index "$1"; }
K0=$(key 0)
STRATEGIST=$(addr 4)
# Ephemeral per-run node mnemonic: operator = index 0, signing key = index 1
# (same layout deploy.sh uses on plain anvil). Both fresh, so code-free EOAs.
NODE_MNEMONIC=$(cast wallet new-mnemonic | sed -n '/Phrase:/{n;p;}' | xargs)
[ "$(echo "$NODE_MNEMONIC" | wc -w | xargs)" = "12" ] || { echo "FATAL: could not generate node mnemonic"; exit 1; }
OPERATOR=$(cast wallet address --mnemonic "$NODE_MNEMONIC" --mnemonic-index 0)
K_OP=$(cast wallet private-key --mnemonic "$NODE_MNEMONIC" --mnemonic-index 0)
SIGNING=$(cast wallet address --mnemonic "$NODE_MNEMONIC" --mnemonic-index 1)

# --- 1. preconditions -------------------------------------------------------
say "preconditions"
[ -f "$FORKDIR/anvil.pid" ] && kill -0 "$(cat "$FORKDIR/anvil.pid")" 2>/dev/null \
  || { echo "FATAL: no running fork (pidfile $FORKDIR/anvil.pid); start it with: deploy/fork.sh"; exit 1; }
[ "$(cast chain-id --rpc-url "$RPC")" = "$FORK_CHAIN_ID" ] \
  || { echo "FATAL: chainId mismatch on :$FORK_PORT; is this the fork.sh anvil?"; exit 1; }
[ "$(cast code "$MORPHO" --rpc-url "$RPC")" != "0x" ] \
  || { echo "FATAL: Morpho Blue has no code; :$FORK_PORT is not a Base fork. Run deploy/fork.sh"; exit 1; }
curl -sf -X POST "http://127.0.0.1:5001/api/v0/id" >/dev/null 2>&1 \
  || { echo "FATAL: IPFS api not reachable on :5001 (run: ipfs daemon)"; exit 1; }
docker info >/dev/null 2>&1 || { echo "FATAL: docker daemon not running"; exit 1; }

# RPC as seen from inside containers (Docker Desktop needs host.docker.internal).
DOCKER_RPC=""
for cand in "http://localhost:$FORK_PORT" "http://host.docker.internal:$FORK_PORT"; do
  if docker run --rm --network host --entrypoint cast "$POA_IMG" chain-id --rpc-url "$cand" >/dev/null 2>&1; then
    DOCKER_RPC="$cand"; break
  fi
done
[ -n "$DOCKER_RPC" ] || { echo "FATAL: fork not reachable from inside docker"; exit 1; }
DOCKER_WS="${DOCKER_RPC/http/ws}"
# host[:port] the components actually dial (wavs.toml http_endpoint below);
# scopes component --http-hosts instead of the chain being wide open.
DOCKER_RPC_HOST="${DOCKER_RPC#http://}"
# The IPFS gateway must be reachable from the same container vantage point;
# reuse the host that worked for the RPC (kubo's gateway listens on 0.0.0.0).
DOCKER_HOST_NAME="${DOCKER_RPC#http://}"; DOCKER_HOST_NAME="${DOCKER_HOST_NAME%:*}"
GATEWAY="http://$DOCKER_HOST_NAME:8080/ipfs/"
curl -sf "http://127.0.0.1:8080/ipfs/" -o /dev/null -w '' 2>/dev/null || true
echo "fork ok: block $(cast block-number --rpc-url "$RPC"); container RPC $DOCKER_RPC; gateway $GATEWAY"

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
cast rpc anvil_mine --rpc-url "$RPC" >/dev/null 2>&1 || true
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
  || { echo "FATAL: signing key $SIGNING has code on the fork"; exit 1; }
cast rpc anvil_setBalance "$OPERATOR" 0xde0b6b3a7640000 --rpc-url "$RPC" >/dev/null
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
say "await first attested NAV strike (pre-position NAV: 0)"
for i in $(seq 1 18); do
  sleep 5
  UPDATES=$(cast call "$VAULT" 'updateCount()(uint256)' --rpc-url "$RPC" | awk '{print $1}')
  if [ "$UPDATES" != "0" ]; then
    NAV=$(cast call "$VAULT" 'nav()(uint256)' --rpc-url "$RPC" | awk '{print $1}')
    IB=$(cast call "$VAULT" 'lastInputsBlock()(uint256)' --rpc-url "$RPC" | awk '{print $1}')
    jq -n --arg vault "$VAULT" --arg sm "$SM" --arg strategist "$STRATEGIST" --arg node "$NODE" --arg template_workflow_id "$WID" \
      '{vault: $vault, service_manager: $sm, strategist: $strategist, node: $node, template_workflow_id: $template_workflow_id}' \
      > "$FORKDIR/vault-service.json"
    echo "SUCCESS: updateCount=$UPDATES nav=$NAV inputsBlock=$IB"
    echo "vault=$VAULT  serviceManager=$SM  node=$NODE (docker logs $NODE)"
    exit 0
  fi
  echo "  t+$((i*5))s: no strike yet"
done
echo "FAILED: no strike landed; inspect: docker logs $NODE"; exit 1
