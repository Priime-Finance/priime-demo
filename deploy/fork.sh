#!/usr/bin/env bash
# M3: anvil fork of Base mainnet, pinned, with a smoke check of the real
# USDe/USDC Morpho Blue market the loop position will live in.
#
# Starts anvil forking Base at the block pinned in fork.config.json (chainId
# kept at 31337 per the fork-track convention), then reads the Morpho market
# state, token metadata, oracle price, and DEX-route liquidity straight from
# the fork. All addresses/parameters come from fork.config.json — downstream
# scripts (loop entry, vault deploy) consume the same file, not constants.
#
# Env:
#   BASE_RPC_URL   upstream Base RPC to fork from (default: https://mainnet.base.org)
#   FORK_PORT      local anvil port (default: from fork.config.json, 8545)
#
# Re-runnable: kills any anvil it previously started (pidfile) and restarts.
# Leaves the fork running for subsequent scripts; logs in deploy/.fork/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"          # priime-demo
DEPLOY="$ROOT/deploy"
CFG="$DEPLOY/fork.config.json"
FORKDIR="$DEPLOY/.fork"
mkdir -p "$FORKDIR"

say() { echo; echo "== $* =="; }
cfg() { jq -r "$1" "$CFG"; }

# --- 0. config --------------------------------------------------------------
BASE_RPC_URL="${BASE_RPC_URL:-$(cfg .fork.rpc_url_default)}"
FORK_BLOCK=$(cfg .fork.block_number)
FORK_CHAIN_ID=$(cfg .fork.fork_chain_id)
FORK_PORT="${FORK_PORT:-$(cfg .fork.fork_port)}"
RPC="http://localhost:$FORK_PORT"

MORPHO=$(cfg .morpho.blue)
MKT=$(cfg .morpho.market.id)
LOAN=$(cfg .morpho.market.params.loan_token)
COLL=$(cfg .morpho.market.params.collateral_token)
ORACLE=$(cfg .morpho.market.params.oracle)
IRM=$(cfg .morpho.market.params.irm)
LLTV=$(cfg .morpho.market.params.lltv)
POOL=$(cfg .swap_route.pool)
ROUTER=$(cfg .swap_route.router)

# --- 1. start the fork ------------------------------------------------------
say "start anvil fork of Base @ block $FORK_BLOCK"
if [ -f "$FORKDIR/anvil.pid" ]; then
  kill "$(cat "$FORKDIR/anvil.pid")" >/dev/null 2>&1 || true
  sleep 1
fi
anvil --fork-url "$BASE_RPC_URL" --fork-block-number "$FORK_BLOCK" \
  --chain-id "$FORK_CHAIN_ID" --host 0.0.0.0 --port "$FORK_PORT" \
  > "$FORKDIR/anvil.log" 2>&1 &
echo $! > "$FORKDIR/anvil.pid"
for i in $(seq 1 30); do
  cast block-number --rpc-url "$RPC" >/dev/null 2>&1 && break
  [ "$i" = 30 ] && { echo "FATAL: fork not reachable on :$FORK_PORT; see $FORKDIR/anvil.log"; exit 1; }
  sleep 1
done
echo "fork up: block $(cast block-number --rpc-url "$RPC"), chainId $(cast chain-id --rpc-url "$RPC")"

# --- 2. smoke: Morpho market ------------------------------------------------
say "Morpho Blue market $MKT"
PARAMS=$(cast call "$MORPHO" "idToMarketParams(bytes32)(address,address,address,address,uint256)" "$MKT" --rpc-url "$RPC")
echo "$PARAMS" | sed 's/^/  /'
read -r P_LOAN P_COLL P_ORACLE P_IRM P_LLTV <<< "$(echo "$PARAMS" | awk '{print $1}' | tr '\n' ' ')"
for pair in "$P_LOAN:$LOAN:loanToken" "$P_COLL:$COLL:collateralToken" "$P_ORACLE:$ORACLE:oracle" "$P_IRM:$IRM:irm" "$P_LLTV:$LLTV:lltv"; do
  got=$(echo "${pair%%:*}" | tr 'A-F' 'a-f'); rest="${pair#*:}"
  want=$(echo "${rest%%:*}" | tr 'A-F' 'a-f'); name="${rest#*:}"
  [ "$got" = "$want" ] || { echo "FAILED: on-chain $name=$got != config $want"; exit 1; }
done
echo "  market params match fork.config.json"

STATE=$(cast call "$MORPHO" "market(bytes32)(uint128,uint128,uint128,uint128,uint128,uint128)" "$MKT" --rpc-url "$RPC")
TSA=$(echo "$STATE" | sed -n 1p | awk '{print $1}')
TBA=$(echo "$STATE" | sed -n 3p | awk '{print $1}')
echo "  totalSupplyAssets = $TSA ($(echo "scale=0; $TSA/1000000" | bc) USDC)"
echo "  totalBorrowAssets = $TBA ($(echo "scale=0; $TBA/1000000" | bc) USDC)"
[ "$TSA" -gt 0 ] && [ "$TBA" -gt 0 ] || { echo "FAILED: empty market"; exit 1; }

# --- 3. smoke: tokens -------------------------------------------------------
say "token metadata"
for t in "$COLL:USDe:18" "$LOAN:USDC:6"; do
  addr="${t%%:*}"; rest="${t#*:}"; wsym="${rest%%:*}"; wdec="${rest#*:}"
  sym=$(cast call "$addr" 'symbol()(string)' --rpc-url "$RPC" | tr -d '"')
  dec=$(cast call "$addr" 'decimals()(uint8)' --rpc-url "$RPC")
  echo "  $addr  $sym/$dec"
  [ "$sym" = "$wsym" ] && [ "$dec" = "$wdec" ] || { echo "FAILED: expected $wsym/$wdec"; exit 1; }
done

# --- 4. smoke: oracle price -------------------------------------------------
say "oracle price (scale 1e24 = 36 + 6 - 18)"
PRICE=$(cast call "$ORACLE" "price()(uint256)" --rpc-url "$RPC" | awk '{print $1}')
echo "  price = $PRICE (USDC per USDe = $(echo "scale=6; $PRICE/1000000000000000000000000" | bc))"
[ "$(echo "$PRICE > 0" | bc)" = 1 ] || { echo "FAILED: zero oracle price"; exit 1; }

# --- 5. smoke: DEX route liquidity ------------------------------------------
say "swap route: Aerodrome Slipstream USDe/USDC pool $POOL"
PU=$(cast call "$COLL" 'balanceOf(address)(uint256)' "$POOL" --rpc-url "$RPC" | awk '{print $1}')
PC=$(cast call "$LOAN" 'balanceOf(address)(uint256)' "$POOL" --rpc-url "$RPC" | awk '{print $1}')
LIQ=$(cast call "$POOL" 'liquidity()(uint128)' --rpc-url "$RPC" | awk '{print $1}')
echo "  pool USDe  = $(echo "scale=0; $PU/1000000000000000000" | bc)"
echo "  pool USDC  = $(echo "scale=0; $PC/1000000" | bc)"
echo "  in-range L = $LIQ  (router $ROUTER)"
[ "$(echo "$LIQ > 0" | bc)" = 1 ] || { echo "FAILED: no in-range liquidity on swap route"; exit 1; }

echo
echo "SUCCESS: Base fork @ $FORK_BLOCK on :$FORK_PORT — Morpho USDe/USDC 91.5% market, tokens, oracle, and swap route all live"
echo "fork stays up for the loop entry script; stop with: kill \$(cat $FORKDIR/anvil.pid)"
