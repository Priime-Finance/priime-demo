#!/usr/bin/env bash
# M3-4: the vault Priime service on the pinned Base fork.
#
# THREE operators, 2-of-3 quorum: three independent Priime nodes each register
# their own operator on the shared POA service manager, each with its own
# signing key. Every strike the vault sees carries the multi-sig from the
# quorum Priime's aggregator collected across nodes (SignatureData.signers /
# .signatures arrays; see IWavsServiceHandler.sol). The nodes discover each
# other via hyperswarm (Priime's built-in Hypercore peer transport) so no
# extra topology config is needed for the local case: three containers on
# --network host see each other and gossip signatures until the aggregator
# role sees threshold and submits ONE tx.
#
#   1. deploys the POA service manager (quorum 2/3, threshold-weight 2000
#      over three 1000-weight operators),
#   2. deploys PriimeVault against it and asserts the wiring,
#   3. builds + pins the vault-nav and aggregator components to IPFS,
#   4. assembles service.json: cron trigger -> vault-nav (market/pool/vault
#      config from fork.config.json) -> aggregator submit -> PriimeVault,
#   5. registers three operators with EPHEMERAL per-run keys (on a Base fork
#      the well-known anvil addresses carry EIP-7702 delegations and cannot
#      be ECDSA signers; fresh random keys are code-free),
#   6. ensures the Uniswap V3 pool's observation cardinality covers the TWAP
#      window across the loop-entry swaps (permissionless, standard call),
#   7. starts THREE Priime nodes against the fork, deploys the service to
#      each, and waits for the first cron strike to land in the vault
#      (updateCount >= 1).
#
# Writes $STATE_DIR/vault-service.json for enter-loop.sh (vault, manager,
# strategist). Strategy numbers stay in fork.config.json (LOOP-03), which is
# shared by every target because the fork IS Base at a pinned block.
#
# Target-aware: TARGET=fork (default) is the pinned anvil fork and behaves
# exactly as it always has apart from the three-operator topology;
# TARGET=mainnet is Base itself, where operators are funded by real
# transfers instead of anvil_setBalance and blocks are waited for instead
# of mined. See deploy/target.sh.
#
# Prereqs:
#   deploy/fork.sh                                   # TARGET=fork only: pinned Base fork on :8545
#   ipfs daemon                                      # api on :5001
#   docker images: ghcr.io/priime-finance/priime:3.0.1, poa-middleware:1.0.1
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
HOME_BASE="$FORKDIR/priime-vault"                   # per-node home dirs: priime-vault-1, -2, -3
PRIIME_IMG="ghcr.io/priime-finance/priime:3.0.1"
POA_IMG="ghcr.io/lay3rlabs/poa-middleware:1.0.1"
NODE_BASE="priime-vault"                            # per-node containers
NODE_COUNT=3
# Each node exposes its own admin/HTTP port on the host (--network host); the
# three ports are consecutive from NODE_PORT_BASE. libp2p peer listens on
# NODE_P2P_PORT_BASE + i (also on the host loopback via --network host).
NODE_PORT_BASE=8041
NODE_P2P_PORT_BASE=9000
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
ROUTER=$(cfg .swap_route.router)
FEE=$(cfg .swap_route.fee)
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
# One mnemonic PER NODE. HD indices:
#   0: operator EOA (registered on the service manager, pays for its own
#      updateOperatorSigningKey tx)
#   1: signing key (Priime signs envelopes with this; verified on-chain)
#   2: aggregator submitter (sends handleSignedEnvelope; per-node so the
#      three aggregators do not race a shared nonce for K0)
# Three fresh, code-free EOAs per node; on a live chain they still have to be
# funded (see fund_account below). Arrays are 0-indexed but node ids are
# 1-indexed in filenames and container names.
#
# PERSISTED PER STATE DIR: the mnemonics live in $STATE_DIR/node-mnemonics.env
# so redeploys reuse the same EOAs and only top up what actual gas usage
# drained. On the fork this is cosmetic (anvil_setBalance is free); on a live
# testnet it is the difference between burning $OPERATOR_GAS x 6 per redeploy
# and topping up cents worth of drained gas.
MNEMONIC_FILE="$STATE_DIR/node-mnemonics.env"
declare -a NODE_MNEMONICS OPERATORS K_OPS SIGNINGS AGG_ADDRS K_AGGS
if [ -f "$MNEMONIC_FILE" ]; then
  # shellcheck disable=SC1090
  source "$MNEMONIC_FILE"
fi
for i in $(seq 0 $((NODE_COUNT - 1))); do
  var="NODE_MNEMONIC_$((i+1))"
  m="${!var:-}"
  if [ -z "$m" ]; then
    m=$(cast wallet new-mnemonic | sed -n '/Phrase:/{n;p;}' | xargs)
    [ "$(echo "$m" | wc -w | xargs)" = "12" ] || { echo "FATAL: could not generate node mnemonic #$((i+1))"; exit 1; }
  fi
  NODE_MNEMONICS[$i]="$m"
  OPERATORS[$i]=$(cast wallet address --mnemonic "$m" --mnemonic-index 0)
  K_OPS[$i]=$(cast wallet private-key --mnemonic "$m" --mnemonic-index 0)
  SIGNINGS[$i]=$(cast wallet address --mnemonic "$m" --mnemonic-index 1)
  AGG_ADDRS[$i]=$(cast wallet address --mnemonic "$m" --mnemonic-index 2)
  K_AGGS[$i]=$(cast wallet private-key --mnemonic "$m" --mnemonic-index 2)
done
# Write back so the next run picks up exactly these mnemonics.
mkdir -p "$STATE_DIR"
{
  echo "# Node mnemonics for TARGET=$TARGET, one line per node. Read at the top"
  echo "# of deploy/vault-service.sh so redeploys reuse the same operator +"
  echo "# aggregator EOAs and the treasury only tops up drained gas."
  for i in $(seq 0 $((NODE_COUNT - 1))); do
    printf 'NODE_MNEMONIC_%d="%s"\n' "$((i+1))" "${NODE_MNEMONICS[$i]}"
  done
} > "$MNEMONIC_FILE"
chmod 600 "$MNEMONIC_FILE"

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
# host[:port] the components actually dial (priime.toml http_endpoint below);
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
# Per-node home dirs (each holds priime.toml, service.json, .env). Node 1's
# home doubles as the priime-cli home for service.json assembly; the assembled
# service.json is copied into the other node homes before start.
declare -a HOME_DIRS NODE_NAMES NODE_PORTS
for i in $(seq 0 $((NODE_COUNT - 1))); do
  HOME_DIRS[$i]="$HOME_BASE-$((i+1))"
  NODE_NAMES[$i]="$NODE_BASE-$((i+1))"
  NODE_PORTS[$i]=$(( NODE_PORT_BASE + i ))
  mkdir -p "${HOME_DIRS[$i]}"
done
CLI_HOME="${HOME_DIRS[0]}"                # service.json assembly runs here
mkdir -p "$FORKDIR/nodes-vault" "$FORKDIR/.docker"
cp "$ROOT/components/vault-nav/target/wasm32-wasip2/release/priime_vault_nav.wasm"               "$FORKDIR/vault_nav.wasm"
cp "$ROOT/components/hello-aggregator/target/wasm32-wasip2/release/priime_hello_aggregator.wasm" "$FORKDIR/aggregator.wasm"
# ------------------------------------------------------------------------
# priime.toml is written in TWO PHASES:
#   phase A: node 1 gets an EMPTY bootstrap_nodes list so it starts as the
#   libp2p bootstrap. We start it, scrape its deterministic peer_id from
#   the startup log ("Using P2P identity derived from signing_mnemonic
#   (peer_id: 12D3KooW...)"), then in phase B write nodes 2 and 3 with
#   bootstrap_nodes pointing at node 1's multiaddr and boot them. Same
#   topology `hodlers-app/DEPLOY.md` §3-4 documents, adapted for three
#   nodes on one host (all peers reach each other via 127.0.0.1).
# ------------------------------------------------------------------------

# One tiny helper so both phases emit identical config apart from
# listen_port and bootstrap_nodes.
write_priime_toml() {  # $1=index (0-based), $2=bootstrap_nodes TOML expression
  local i="$1" nodes="$2"
  local port="${NODE_PORTS[$i]}" p2p="${NODE_P2P_PORTS[$i]}"
  cat > "${HOME_DIRS[$i]}/priime.toml" <<EOF
[default]
[default.chains.evm.$FORK_CHAIN_ID]
ws_endpoints = ["$DOCKER_WS"]
http_endpoint = "$DOCKER_RPC"

[priime]
ipfs_gateway = "$GATEWAY"
port = $port
host = "127.0.0.1"
dev_endpoints_enabled = false
signing_mnemonic = "${NODE_MNEMONICS[$i]}"
mcp_chain_credential = "$K0"
aggregator_evm_credential = "${K_AGGS[$i]}"

# libp2p peer discovery over the loopback: node 1 is the bootstrap
# (bootstrap_nodes=[]) and nodes 2/3 dial its multiaddr. Every Priime node
# derives a stable peer_id from signing_mnemonic (m/44'/60'/0'/0/0) so the
# multiaddrs are known once node 1 has started once. Without this section
# Priime logs "P2P networking is disabled" and every node submits its own
# single signature; the service manager reverts with 0xe121632f
# (insufficient stake) because a 1000-weight sig can't clear the
# 2000-weight 2-of-3 threshold.
[priime.p2p.remote]
listen_port = $p2p
bootstrap_nodes = $nodes

[cli]
evm_credential = "$K0"
EOF
  : > "${HOME_DIRS[$i]}/.env"
}

# Small helper: start one node in the background and wait for its HTTP admin.
start_node() {  # $1=index (0-based)
  local i="$1"
  local name="${NODE_NAMES[$i]}"
  local port="${NODE_PORTS[$i]}"
  local home="${HOME_DIRS[$i]}"
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker run -d --name "$name" --network host -v "$home:/root/priime" "$PRIIME_IMG" \
    priime --home /root/priime --ipfs-gateway "$GATEWAY" --host 127.0.0.1 --log-level info >/dev/null
  local ready=0
  for _ in $(seq 1 30); do
    curl -sf "http://localhost:$port/services" >/dev/null 2>&1 && { ready=1; break; }
    sleep 1
  done
  [ "$ready" = "1" ] || { echo "FATAL: $name never became ready on :$port (docker logs $name)"; exit 1; }
  echo "  $name ready on :$port"
}

# Populate ports arrays used by both phases.
declare -a NODE_P2P_PORTS
for i in $(seq 0 $((NODE_COUNT - 1))); do
  NODE_P2P_PORTS[$i]=$(( NODE_P2P_PORT_BASE + i ))
done

# Write node 1's config now (empty bootstrap) so service.json assembly can
# still run out of CLI_HOME which is HOME_DIRS[0]. Nodes 2/3 get their
# priime.toml after we know node 1's peer_id.
write_priime_toml 0 "[]"

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
# Base's load-balanced RPC pool can serve a stale block.number for several
# seconds after a deploy, and the manager's first mutating call pushes a
# Checkpoint keyed on block.number - a stale number that is <= the deploy
# block trips OpenZeppelin's CheckpointUnorderedInsertion revert. Wait for
# three blocks (~6s on Base) so every RPC endpoint has caught up.
mine_or_wait
mine_or_wait
mine_or_wait
# Quorum: three operators each register with weight 1000 (total 3000); the
# stake threshold requires 2000 (2-of-3) and the quorum fraction (2/3)
# codifies the same rule as a percentage. Either bound alone would suffice
# for equal weights; both track the demo's spec ("2-of-3 quorum") verbatim.
"${POA[@]}" owner_operation updateStakeThreshold 2000 >/dev/null
"${POA[@]}" owner_operation updateQuorum 2 3 >/dev/null
echo "service manager: $SM"

# --- 4. deploy PriimeVaultFactory (once per state dir) + vault via factory ---
# The factory address is the single "point at me" pin for the subgraph. It is
# persisted in $FACTORY_JSON so subsequent vault-service.sh runs on the same
# state dir re-use it: every subsequent vault deployment emits a VaultCreated
# event the subgraph's data-source template picks up automatically.
FACTORY_JSON="$FORKDIR/factory.json"
say "deploy PriimeVaultFactory (or reuse persisted address)"
mine_or_wait
if [ -f "$FACTORY_JSON" ] && [ "$(cast code "$(jq -r .factory "$FACTORY_JSON")" --rpc-url "$RPC")" != "0x" ]; then
  FACTORY=$(jq -r .factory "$FACTORY_JSON")
  echo "factory (reused): $FACTORY"
else
  DEPLOY_BLOCK=$(cast block-number --rpc-url "$RPC")
  FACTORY=$( cd "$ROOT/contracts" && forge create src/PriimeVaultFactory.sol:PriimeVaultFactory \
    --rpc-url "$RPC" --private-key "$K0" --broadcast \
    | awk '/Deployed to/{print $NF}' )
  echo "factory (new):    $FACTORY (block $DEPLOY_BLOCK)"
  jq -n --arg factory "$FACTORY" --arg chain_id "$CHAIN_ID" --argjson start_block "$DEPLOY_BLOCK" \
    '{factory: $factory, chain_id: $chain_id, start_block: $start_block}' > "$FACTORY_JSON"
fi
mine_or_wait
for _ in $(seq 1 30); do
  if [ "$(cast code "$FACTORY" --rpc-url "$RPC")" != "0x" ]; then break; fi
  sleep 2
done
[ "$(cast code "$FACTORY" --rpc-url "$RPC")" != "0x" ] \
  || { echo "FATAL: factory $FACTORY still has no code after 60s"; exit 1; }

say "deploy PriimeVault via factory"
cast send "$FACTORY" \
  'deployVault(address,address,address,(address,address,address,address,uint256,address,uint24))' \
  "$SM" "$USDC" "$STRATEGIST" "($USDE,$MORPHO,$ORACLE,$IRM,$LLTV,$ROUTER,$FEE)" \
  --rpc-url "$RPC" --private-key "$K0" >/dev/null
# Deterministic: the vault we just deployed is factory.vaults(vaultCount()-1).
# Cheaper than parsing VaultCreated out of the receipt, and stable across
# cast-send output-shape drift between foundry versions. Retry the read
# because Alchemy's load-balanced pool may not have propagated the send tx
# to the read node yet.
mine_or_wait
COUNT=""
for _ in $(seq 1 30); do
  COUNT=$(cast call "$FACTORY" 'vaultCount()(uint256)' --rpc-url "$RPC" 2>/dev/null | awk '{print $1}')
  [ -n "$COUNT" ] && [ "$COUNT" != "0" ] && break
  sleep 2
done
[ -n "$COUNT" ] && [ "$COUNT" != "0" ] \
  || { echo "FATAL: factory.vaultCount() stayed 0 after send"; exit 1; }
VAULT=$(cast call "$FACTORY" 'vaults(uint256)(address)' "$((COUNT - 1))" --rpc-url "$RPC" | awk '{print $1}')
echo "vault: $VAULT (strategist $STRATEGIST)"
for _ in $(seq 1 30); do
  if [ "$(cast code "$VAULT" --rpc-url "$RPC")" != "0x" ]; then break; fi
  sleep 2
done
[ "$(cast code "$VAULT" --rpc-url "$RPC")" != "0x" ] \
  || { echo "FATAL: vault $VAULT still has no code after 60s"; exit 1; }
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

CLI=(docker run --rm --network host -w /data -v "$CLI_HOME:/data" "$PRIIME_IMG" priime-cli service \
  --json true --home /data --file /data/service.json --ipfs-gateway "$GATEWAY")
rm -f "$CLI_HOME/service.json"
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
  --arg swap_router "$ROUTER" --arg pool_fee "$FEE" \
  '$ARGS.named' > "$CLI_HOME/component-config.json"
"${CLI[@]}" workflow component --id "$WID" config --config-file /data/component-config.json >/dev/null
"${CLI[@]}" workflow submit    --id "$WID" set-aggregator >/dev/null
"${CLI[@]}" workflow submit    --id "$WID" component set-source-uri --uri "ipfs://$AGG_CID" >/dev/null
"${CLI[@]}" workflow submit    --id "$WID" component permissions --http-hosts "$DOCKER_RPC_HOST" --file-system false >/dev/null
"${CLI[@]}" workflow submit    --id "$WID" component config --values "$CHAIN=$VAULT" >/dev/null
"${CLI[@]}" manager set-evm --chain "$CHAIN" --address "$SM" >/dev/null
"${CLI[@]}" validate >/dev/null || true   # warns on registry availability; IPFS-sourced, safe
SVC_CID=$(ipfs add -Q --pin=true "$CLI_HOME/service.json")
# Every node reads the SAME service.json from IPFS on start, but priime-cli's
# init also writes a local copy into whichever home it ran from. Copy that
# assembled document to the other node homes so their CLI/deploy-service
# invocations see the same fixture.
for i in $(seq 1 $((NODE_COUNT - 1))); do
  cp "$CLI_HOME/service.json" "${HOME_DIRS[$i]}/service.json"
  cp "$CLI_HOME/component-config.json" "${HOME_DIRS[$i]}/component-config.json"
done
echo "service cid: $SVC_CID"

# --- 7. register the three operators (ephemeral keys, one per node) ---------
say "register $NODE_COUNT operators + signing keys"
for i in $(seq 0 $((NODE_COUNT - 1))); do
  op="${OPERATORS[$i]}"; kop="${K_OPS[$i]}"; sign="${SIGNINGS[$i]}"; m="${NODE_MNEMONICS[$i]}"
  [ "$(cast code "$sign" --rpc-url "$RPC")" = "0x" ] \
    || { echo "FATAL: signing key $sign for node $((i+1)) has code on chain $CHAIN_ID"; exit 1; }
  agg="${AGG_ADDRS[$i]}"
  # Each operator pays for its own updateOperatorSigningKey below, so it needs
  # gas. Same funding for the aggregator submitter, which pays for every
  # handleSignedEnvelope tx over the loop's lifetime. On the fork that is
  # anvil_setBalance; on a live chain it is a real transfer from the treasury
  # key. funding.operator_gas_wei is per target and applies per key.
  fund_account gas "$op"  "$OPERATOR_GAS"
  fund_account gas "$agg" "$OPERATOR_GAS"
  cast send "$SM" "registerOperator(address,uint256)" "$op" 1000 --private-key "$K0" --rpc-url "$RPC" >/dev/null
  mine_or_wait   # let the pool see this K0 nonce before the next K0 send in this loop
  # Signing-key registration signs the raw keccak (no EIP-191 prefix) -> --no-hash.
  ENC=$(cast abi-encode "f(address)" "$op"); MSG=$(cast keccak "$ENC")
  SIG=$(cast wallet sign --no-hash --mnemonic "$m" --mnemonic-index 1 "$MSG")
  cast send "$SM" "updateOperatorSigningKey(address,bytes)" "$sign" "$SIG" --private-key "$kop" --rpc-url "$RPC" >/dev/null
  echo "  operator $((i+1))/$NODE_COUNT: op=$op signing=$sign agg=$agg"
done
cast send "$SM" "setServiceURI(string)" "ipfs://$SVC_CID" --private-key "$K0" --rpc-url "$RPC" >/dev/null
mine_or_wait

# --- 8. start the three Priime nodes (libp2p bootstrap topology) --------------
# Node 1 is the libp2p bootstrap (`bootstrap_nodes = []`). We start it, wait
# for the "Using P2P identity derived from signing_mnemonic (peer_id: ...)"
# line, and use that PeerId to write nodes 2 and 3's priime.toml with a
# multiaddr pointing at node 1. Same procedure hodlers-app/DEPLOY.md §3-4
# uses on Hetzner, collapsed here to one host via 127.0.0.1.
say "start bootstrap node (${NODE_NAMES[0]})"
start_node 0

# libp2p emits its identity once, near the top of the log. Poll until it
# lands or give up (peer-id derivation is fast, so 20s is generous).
PEER_ID=""
for _ in $(seq 1 40); do
  # Priime peer_ids use secp256k1 keys (prefix "16Uiu2HAm"); regex accepts any
  # multibase-encoded PeerId of the length libp2p emits (~52 chars).
  line=$(docker logs "${NODE_NAMES[0]}" 2>&1 | grep -oE 'peer_id: [A-Za-z0-9]{40,64}' | head -1)
  if [ -n "$line" ]; then
    PEER_ID="${line#peer_id: }"
    break
  fi
  sleep 0.5
done
[ -n "$PEER_ID" ] || { echo "FATAL: could not read peer_id from ${NODE_NAMES[0]} logs (check: docker logs ${NODE_NAMES[0]})"; exit 1; }
BOOTSTRAP_ADDR="/ip4/127.0.0.1/tcp/${NODE_P2P_PORTS[0]}/p2p/$PEER_ID"
echo "  bootstrap: $BOOTSTRAP_ADDR"

say "start follower nodes (${NODE_NAMES[1]}, ${NODE_NAMES[2]})"
for i in $(seq 1 $((NODE_COUNT - 1))); do
  write_priime_toml "$i" "[\"$BOOTSTRAP_ADDR\"]"
  start_node "$i"
done

say "deploy service to each node"
for i in $(seq 0 $((NODE_COUNT - 1))); do
  name="${NODE_NAMES[$i]}"; port="${NODE_PORTS[$i]}"; home="${HOME_DIRS[$i]}"
  docker run --rm --network host -v "$home:/data" "$PRIIME_IMG" priime-cli deploy-service \
    --service-uri "ipfs://$SVC_CID" --log-level=info --data /data/.docker --home /data \
    --priime-endpoint "http://localhost:$port" --ipfs-gateway "$GATEWAY" >/dev/null
  echo "  $name: service deployed"
done

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
    # Emit the whole node list in vault-service.json so downstream scripts
    # (loop-server, enter-loop.sh) can address any of them; keep the "node"
    # field for compatibility with the single-node consumers.
    NODE_LIST=$(printf '%s\n' "${NODE_NAMES[@]}" | jq -R . | jq -s .)
    jq -n --arg vault "$VAULT" --arg sm "$SM" --arg strategist "$STRATEGIST" \
      --arg factory "$FACTORY" \
      --arg node "${NODE_NAMES[0]}" --argjson nodes "$NODE_LIST" \
      --arg template_workflow_id "$WID" \
      --arg target "$TARGET" --arg chain_id "$CHAIN_ID" \
      --arg quorum_threshold 2 --arg quorum_total 3 \
      '{vault: $vault, factory: $factory, service_manager: $sm, strategist: $strategist, node: $node, nodes: $nodes, template_workflow_id: $template_workflow_id, target: $target, chain_id: $chain_id, quorum_threshold: ($quorum_threshold|tonumber), quorum_total: ($quorum_total|tonumber)}' \
      > "$FORKDIR/vault-service.json"
    echo "SUCCESS: updateCount=$UPDATES nav=$NAV inputsBlock=$IB"
    echo "vault=$VAULT  serviceManager=$SM  nodes=${NODE_NAMES[*]} (docker logs ${NODE_NAMES[0]})"
    exit 0
  fi
  echo "  t+$((i*5))s: no strike yet"
done
echo "FAILED: no strike landed; inspect: docker logs ${NODE_NAMES[0]} (or ${NODE_NAMES[1]}, ${NODE_NAMES[2]})"; exit 1
