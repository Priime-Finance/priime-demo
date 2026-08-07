#!/usr/bin/env bash
# M1: hello-world WAVS component through the full pipeline on anvil.
#
# Scaffold -> build -> deploy -> cron fires -> result lands in a handler on-chain.
# Demo-owned: uses the upstream WAVS + POA docker images directly, no priime-pools
# coupling. Single operator, single node, local anvil + IPFS.
#
# Prereqs (start these first):
#   anvil --host 0.0.0.0 --block-time 1          # chainId 31337 on :8545
#   ipfs daemon                                  # gateway on :8080, api on :5001
#   docker images: ghcr.io/lay3rlabs/wavs:2.0.0-vault-rc.15, poa-middleware:1.0.1
#
# Re-runnable: redeploys a fresh service manager + handler each run.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"          # priime-demo
DEPLOY="$ROOT/deploy"
RPC="http://localhost:8545"
CHAIN="evm:31337"
GATEWAY="http://127.0.0.1:8080/ipfs/"
WAVS_IMG="ghcr.io/lay3rlabs/wavs:2.0.0-vault-rc.15"
POA_IMG="ghcr.io/lay3rlabs/poa-middleware:1.0.1"
NODE="wavs-m1"
MNEMONIC="test test test test test test test test test test test junk"   # anvil default

K0=$(cast wallet private-key --mnemonic "$MNEMONIC" --mnemonic-index 0)   # deployer + operator
OPERATOR=$(cast wallet address --mnemonic "$MNEMONIC" --mnemonic-index 0)
SIGNING_KEY=$(cast wallet address --mnemonic "$MNEMONIC" --mnemonic-index 1)

say() { echo; echo "== $* =="; }

# --- 0. preconditions -------------------------------------------------------
cast block-number --rpc-url "$RPC" >/dev/null 2>&1 \
  || { echo "FATAL: anvil not reachable on :8545 (run: anvil --host 0.0.0.0 --block-time 1)"; exit 1; }
curl -sf -X POST "http://127.0.0.1:5001/api/v0/id" >/dev/null 2>&1 \
  || { echo "FATAL: IPFS api not reachable on :5001 (run: ipfs daemon)"; exit 1; }

# --- 1. build components + contracts ---------------------------------------
say "build components (wasm32-wasip2)"
( cd "$ROOT/components/hello-nav"        && cargo build --release --target wasm32-wasip2 >/dev/null )
( cd "$ROOT/components/hello-aggregator" && cargo build --release --target wasm32-wasip2 >/dev/null )
mkdir -p "$DEPLOY/components" "$DEPLOY/.docker" "$DEPLOY/.nodes"
cp "$ROOT/components/hello-nav/target/wasm32-wasip2/release/priime_hello_nav.wasm"               "$DEPLOY/components/hello_nav.wasm"
cp "$ROOT/components/hello-aggregator/target/wasm32-wasip2/release/priime_hello_aggregator.wasm" "$DEPLOY/components/hello_aggregator.wasm"
say "build contracts"
( cd "$ROOT/contracts" && forge build >/dev/null )

# --- 2. config files --------------------------------------------------------
# wavs.toml carries all node config (mnemonic + credentials) so no env file with
# spaces is needed. poa.env is unquoted (docker --env-file is literal). .env is
# empty so wavs-cli's dotenv autoload has nothing to choke on.
cat > "$DEPLOY/wavs.toml" <<EOF
[default]
[default.chains.evm.31337]
ws_endpoints = ["ws://localhost:8545"]
http_endpoint = "http://localhost:8545"

[wavs]
ipfs_gateway = "$GATEWAY"
port = 8041
host = "0.0.0.0"
dev_endpoints_enabled = true
signing_mnemonic = "$MNEMONIC"
mcp_chain_credential = "$K0"
aggregator_evm_credential = "$K0"

[cli]
evm_credential = "$K0"
EOF
: > "$DEPLOY/.env"
cat > "$DEPLOY/poa.env" <<EOF
RPC_URL=$RPC
FUNDED_KEY=$K0
DEPLOY_ENV=LOCAL
EOF

cd "$DEPLOY"
POA=(docker run --rm --network host -v "$DEPLOY/.nodes:/root/.nodes" --env-file "$DEPLOY/poa.env" "$POA_IMG")

# --- 3. POA service manager -------------------------------------------------
say "deploy POA service manager"
"${POA[@]}" deploy >/dev/null
SM=$(jq -r '.addresses.POAStakeRegistry' "$DEPLOY/.nodes/poa_deploy.json")
cast rpc anvil_mine --rpc-url "$RPC" >/dev/null 2>&1 || true
"${POA[@]}" owner_operation updateStakeThreshold 1 >/dev/null
"${POA[@]}" owner_operation updateQuorum 1 1 >/dev/null
echo "service manager: $SM"

# --- 4. handler contract ----------------------------------------------------
say "deploy HelloNavHandler"
HANDLER=$( cd "$ROOT/contracts" && forge create src/HelloNavHandler.sol:HelloNavHandler \
  --rpc-url "$RPC" --private-key "$K0" --broadcast --constructor-args "$SM" \
  | awk '/Deployed to/{print $NF}' )
echo "handler: $HANDLER"

# --- 5. publish components to IPFS -----------------------------------------
say "pin components to IPFS"
NAV_CID=$(ipfs add -Q --pin=true "$DEPLOY/components/hello_nav.wasm")
AGG_CID=$(ipfs add -Q --pin=true "$DEPLOY/components/hello_aggregator.wasm")
echo "nav=$NAV_CID agg=$AGG_CID"

# --- 6. assemble service.json (cron trigger -> nav -> aggregator -> handler) -
say "assemble service.json"
CLI=(docker run --rm --network host -w /data -v "$DEPLOY:/data" "$WAVS_IMG" wavs-cli service \
  --json true --home /data --file /data/service.json --ipfs-gateway "$GATEWAY")
rm -f "$DEPLOY/service.json"
START=$(date +%s%N); END=$(( START + 3600000000000 ))
"${CLI[@]}" init --name hello-nav >/dev/null
WID=$("${CLI[@]}" workflow add | jq -r '.workflow_id')
"${CLI[@]}" workflow trigger  --id "$WID" set-cron --schedule "*/10 * * * * *" --start-time "$START" --end-time "$END" >/dev/null
"${CLI[@]}" workflow component --id "$WID" set-source-uri --uri "ipfs://$NAV_CID" >/dev/null
"${CLI[@]}" workflow component --id "$WID" permissions --http-hosts '*' --file-system true >/dev/null
"${CLI[@]}" workflow component --id "$WID" fuel-limit --fuel 1000000000000 >/dev/null
"${CLI[@]}" workflow component --id "$WID" time-limit --seconds 30 >/dev/null
"${CLI[@]}" workflow component --id "$WID" config --values label=hello >/dev/null
"${CLI[@]}" workflow submit    --id "$WID" set-aggregator >/dev/null
"${CLI[@]}" workflow submit    --id "$WID" component set-source-uri --uri "ipfs://$AGG_CID" >/dev/null
"${CLI[@]}" workflow submit    --id "$WID" component permissions --http-hosts '*' --file-system true >/dev/null
"${CLI[@]}" workflow submit    --id "$WID" component config --values "$CHAIN=$HANDLER" >/dev/null
"${CLI[@]}" manager set-evm --chain "$CHAIN" --address "$SM" >/dev/null
"${CLI[@]}" validate >/dev/null || true   # warns on registry availability; IPFS-sourced, safe
SVC_CID=$(ipfs add -Q --pin=true "$DEPLOY/service.json")
echo "service cid: $SVC_CID"

# --- 7. register the single operator on the service manager ----------------
say "register operator (weight 1000) + signing key"
cast send "$SM" "registerOperator(address,uint256)" "$OPERATOR" 1000 --private-key "$K0" --rpc-url "$RPC" >/dev/null
ENC=$(cast abi-encode "f(address)" "$OPERATOR"); MSG=$(cast keccak "$ENC")
SIG=$(cast wallet sign --no-hash --mnemonic "$MNEMONIC" --mnemonic-index 1 "$MSG")
cast send "$SM" "updateOperatorSigningKey(address,bytes)" "$SIGNING_KEY" "$SIG" --private-key "$K0" --rpc-url "$RPC" >/dev/null
# node reads the service from on-chain serviceURI; must be set before deploy-service
cast send "$SM" "setServiceURI(string)" "ipfs://$SVC_CID" --private-key "$K0" --rpc-url "$RPC" >/dev/null

# --- 8. run the node --------------------------------------------------------
say "start WAVS operator node"
docker rm -f "$NODE" >/dev/null 2>&1 || true
docker run -d --name "$NODE" --network host -v "$DEPLOY:/root/wavs" "$WAVS_IMG" \
  wavs --home /root/wavs --ipfs-gateway "$GATEWAY" --host 0.0.0.0 --log-level info >/dev/null
for i in $(seq 1 30); do curl -sf http://localhost:8041/services >/dev/null 2>&1 && break; sleep 1; done

# --- 9. deploy the service to the node -------------------------------------
say "deploy service to node"
docker run --rm --network host -v "$DEPLOY:/data" "$WAVS_IMG" wavs-cli deploy-service \
  --service-uri "ipfs://$SVC_CID" --log-level=info --data /data/.docker --home /data \
  --wavs-endpoint http://localhost:8041 --ipfs-gateway "$GATEWAY"

# --- 10. wait for the cron-driven strike to land on-chain ------------------
say "await first attested NAV strike"
for i in $(seq 1 12); do
  sleep 5
  SC=$(cast call "$HANDLER" 'strikeCount()(uint256)' --rpc-url "$RPC")
  if [ "$SC" != "0" ]; then
    echo "SUCCESS: strikeCount=$SC latestNav=$(cast call "$HANDLER" 'latestNav()(uint256)' --rpc-url "$RPC")"
    echo "handler=$HANDLER  serviceManager=$SM  node=$NODE (docker logs $NODE)"
    exit 0
  fi
  echo "  t+$((i*5))s: no strike yet"
done
echo "FAILED: no strike landed; inspect: docker logs $NODE"; exit 1
