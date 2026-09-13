#!/usr/bin/env bash
# M3-3/M3-4: seeded loop entry against the live vault service on the pinned
# Base fork.
#
# Runs against deploy/fork.sh (fork) + deploy/vault-service.sh (service:
# manager, vault, Priime node, cron NAV strikes). Every settlement here is a
# REAL attested strike from the running pipeline; this script signs nothing:
#   1. reads the vault/strategist from the service bring-up,
#   2. seeds the depositor with initial_deposit_usdc and requestDeposit()s,
#   3. waits for the next cron NAV strike to fulfill the deposit (bootstrap:
#      the component attests the pre-fold NAV of 0 — empty position, pending
#      escrow excluded — and the zero-supply fulfillment folds the deposit),
#   4. enters the USDe/USDC recursive Morpho Blue loop via vault.execute(),
#      turn-sized so the END state lands on target_ltv, then revokes every
#      approval,
#   5. checks the entry gates (health factor, config-driven net spread,
#      final LTV, escrow floor) from on-chain reads,
#   6. waits for the next strike AFTER entry and checks the attested NAV
#      re-marks to the position: collateral at min(par, pool TWAP) minus
#      debt, within 10 bps of the oracle-par position value.
#
# All strategy numbers come from fork.config.json (LOOP-03), never hardcoded.
# Decimals: USDC 6, USDe 18, Morpho oracle price scale 1e24 (36 + 6 - 18).
#
# Target-aware: the market, the route and every strategy number are the same
# on TARGET=fork and TARGET=mainnet, because the fork IS Base at a pinned
# block. The one thing that is not the same is step 2, where the depositor's
# USDC comes from: impersonation on the fork, a real transfer on Base. That
# branch lives in fund_account() in deploy/target.sh and nowhere else.
#
# Prereqs:
#   deploy/fork.sh                                # TARGET=fork only: pinned Base fork on :8545
#   deploy/vault-service.sh                       # service + node + first strike
#   TARGET=mainnet: PRIIME_RPC_URL + the role keys named in
#                   deploy/targets/mainnet.json, with a treasury holding the
#                   deposit in USDC.
#
# Re-runnable against a fresh vault-service.sh run (one seed per vault).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"          # priime-demo
DEPLOY="$ROOT/deploy"
source "$DEPLOY/target.sh"                        # TARGET, RPC, STATE_DIR, say(), cfg(), helpers
FORKDIR="$STATE_DIR"
SVC="$FORKDIR/vault-service.json"

ibc() { echo "$1" | bc; }                          # integer bc (big-number math)
fbc() { echo "scale=$1; $2" | bc; }                # fixed-scale bc (display only)

# --- 0. config + keys -------------------------------------------------------
FORK_PORT="$RPC_PORT"
FORK_CHAIN_ID="$CHAIN_ID"

USDC=$(cfg .tokens.usdc.address)
USDE=$(cfg .tokens.usde.address)
MORPHO=$(cfg .morpho.blue)
MKT=$(cfg .morpho.market.id)
ORACLE=$(cfg .morpho.market.params.oracle)
IRM=$(cfg .morpho.market.params.irm)
LLTV=$(cfg .morpho.market.params.lltv)             # 1e18 scale
POOL=$(cfg .swap_route.pool)                       # read by pool_p() below
ROUTER=$(cfg .swap_route.router)
POOL_FEE=$(cfg .swap_route.fee)                    # Uniswap V3 fee tier (uint24, e.g. 500)
MKT_PARAMS="($USDC,$USDE,$ORACLE,$IRM,$LLTV)"      # Morpho MarketParams tuple

TARGET_LTV=$(cfg .deploy_params.target_ltv)        # e.g. 0.80
MAX_TURNS=$(cfg .deploy_params.max_loop_turns)
HF_FLOOR=$(cfg .deploy_params.health_factor_floor) # e.g. 1.05
MIN_SPREAD_BPS=$(cfg .deploy_params.min_net_spread_bps)
DEPOSIT_USDC=$(cfg .deploy_params.initial_deposit_usdc)
SLIP_BPS=$(cfg .deploy_params.max_slippage_bps)
INC_APR_BPS=$(cfg .deploy_params.collateral_incentive_apr_bps)
DEPOSIT=$(ibc "$DEPOSIT_USDC * 1000000")           # USDC base units (6 dec)

# Fixed-point (1e6) versions of the ratio params for integer math.
L6=$(ibc "$TARGET_LTV * 1000000 / 1")              # target LTV
HF6=$(ibc "$HF_FLOOR * 1000000 / 1")               # health-factor floor
LLTV6=$(ibc "$LLTV / 1000000000000")               # LLTV in 1e6
# Per-turn borrow cap: the intermediate LTV right after a borrow (before its
# proceeds are supplied) may never push HF below the floor, so cap at
# lltv / health_factor_floor. Config-derived; no separate margin knob.
U6=$(ibc "$LLTV6 * 1000000 / $HF6")

# Role keys come from the target: mnemonic indices on the fork (where accounts
# originate transactions only), named env vars on a live chain.
STRATEGIST=$(role_addr strategist); K_STRAT=$(role_key strategist)
DEPOSITOR=$(role_addr depositor);   K_DEP=$(role_key depositor)

# --- 1. preconditions: chain + vault service must be live -------------------
say "preconditions (TARGET=$TARGET, chain $CHAIN_ID)"
require_chain_up            # fork: anvil pidfile + chain id; live: chain id
[ -f "$SVC" ] || { echo "FATAL: $SVC missing; run deploy/vault-service.sh first"; exit 1; }
VAULT=$(jq -r .vault "$SVC")
SM=$(jq -r .service_manager "$SVC")
[ "$(jq -r .strategist "$SVC" | tr 'A-F' 'a-f')" = "$(echo "$STRATEGIST" | tr 'A-F' 'a-f')" ] \
  || { echo "FATAL: service strategist != this target's strategist role"; exit 1; }
require_gas strategist "$STRATEGIST"   # no-op on the fork; anvil pre-funds
require_gas depositor  "$DEPOSITOR"
[ "$(cast code "$VAULT" --rpc-url "$RPC")" != "0x" ] \
  || { echo "FATAL: vault $VAULT has no code; rerun deploy/vault-service.sh"; exit 1; }
U0=$(cast call "$VAULT" 'updateCount()(uint256)' --rpc-url "$RPC" | awk '{print $1}')
[ "$U0" != "0" ] || { echo "FATAL: no strikes yet; is the vault-service node running?"; exit 1; }
[ "$(cast call "$VAULT" 'totalSupply()(uint256)' --rpc-url "$RPC" | awk '{print $1}')" = "0" ] \
  || { echo "FATAL: vault already seeded; rerun deploy/vault-service.sh for a fresh vault"; exit 1; }
echo "vault $VAULT live: updateCount=$U0 (cron strikes landing)"

# --- 2. seed capital: fund depositor, requestDeposit ------------------------
# Where the depositor's USDC comes from is the ONE genuinely target-specific
# step in this script, and it is fenced off in fund_account() (deploy/target.sh):
#   fork     FORK-TRACK-ONLY FUNDING SCAFFOLDING. anvil-impersonates the
#            pinned block's largest USDC holder (Morpho Blue itself) and takes
#            the deposit. Never a mainnet pattern.
#   mainnet  a plain transfer from the target's funded treasury key, which
#            must already hold the USDC or the run stops.
# Everything after this line is identical on both.
say "seed depositor with $DEPOSIT_USDC USDC (TARGET=$TARGET funding) + requestDeposit"
fund_account "$USDC" "$DEPOSITOR" "$DEPOSIT"
cast send "$USDC" "approve(address,uint256)(bool)" "$VAULT" "$DEPOSIT" --private-key "$K_DEP" --rpc-url "$RPC" >/dev/null
cast send "$VAULT" "requestDeposit(uint256,address,address)" "$DEPOSIT" "$DEPOSITOR" "$DEPOSITOR" \
  --private-key "$K_DEP" --rpc-url "$RPC" >/dev/null
PENDING=$(cast call "$VAULT" 'totalPendingDepositAssets()(uint256)' --rpc-url "$RPC" | awk '{print $1}')
[ "$PENDING" = "$DEPOSIT" ] || { echo "FATAL: pending deposit $PENDING != $DEPOSIT"; exit 1; }
echo "pending deposit escrowed: $PENDING"

# --- 3. wait for the next real strike to fulfill the deposit ----------------
# The running pipeline attests the pre-fold NAV (0: empty position, escrow
# excluded) and the zero-supply fulfillment folds the deposit in. No script
# signature anywhere: this is the live service settling the vault.
#
# The wait budget follows the target's cadence (targets/<target>.json):
# 60s covers the fork's 10-second cron many times over, an hourly mainnet
# cron needs more than an hour.
STRIKE_TRIES=$(( $(tcfg_req .service.strike_timeout_secs) / 5 ))
say "await bootstrap strike (real pipeline fulfills the deposit, up to $((STRIKE_TRIES * 5))s)"
FULFILLED=0
for i in $(seq 1 "$STRIKE_TRIES"); do
  sleep 5
  PENDING=$(cast call "$VAULT" 'totalPendingDepositAssets()(uint256)' --rpc-url "$RPC" | awk '{print $1}')
  if [ "$PENDING" = "0" ]; then FULFILLED=1; break; fi
  echo "  t+$((i*5))s: deposit still pending"
done
[ "$FULFILLED" = "1" ] || { echo "FATAL: deposit not fulfilled; inspect the priime-vault node logs"; exit 1; }
NAV=$(cast call "$VAULT" 'nav()(uint256)' --rpc-url "$RPC" | awk '{print $1}')
[ "$NAV" = "$DEPOSIT" ] || { echo "FATAL: bootstrap fold nav=$NAV, want $DEPOSIT"; exit 1; }
echo "deposit fulfilled by attested strike: nav=$NAV (capital unlocked)"

# --- 4. loop entry via vault.execute ----------------------------------------
# Turn sizing. Naively borrowing target_ltv of each new tranche undershoots
# (geometric decay -> ~0.70 LTV at 0.80 target). Instead each turn borrows up
# to the intermediate cap u = lltv / health_factor_floor (HF never below the
# floor even between borrow and re-supply), and the LAST turn borrows exactly
# the remainder that lands the END state on target_ltv:
#   headroom = u*C - D          (max safe borrow this turn)
#   x_rem    = (L*C - D)/(1-L)  (borrow that makes final LTV = L after supply)
#   b        = min(headroom, x_rem)
# with C = collateral value (oracle 1e24 price), D = debt, both re-read
# on-chain every turn, so swap slippage self-corrects. Feasibility is solved
# up front: simulating worst-case slippage per turn gives the minimum turn
# count, which must fit in max_loop_turns (a 4-turn ceiling caps LTV at 0.763
# even at zero margin -- the reason max_loop_turns is 7 in config).
say "solve turn schedule (target LTV $TARGET_LTV, cap u=$(fbc 6 "$U6/1000000"), max $MAX_TURNS turns)"
EFF6=$(ibc "(10000 - $SLIP_BPS) * 100")   # worst-case swap efficiency, 1e6
SIM_C=$(ibc "$DEPOSIT * $EFF6 / 1000000"); SIM_D=0; SIM_TURNS=0
while :; do
  HEADROOM=$(ibc "$U6 * $SIM_C / 1000000 - $SIM_D")
  X_REM=$(ibc "($L6 * $SIM_C / 1000000 - $SIM_D) * 1000000 / (1000000 - $L6)")
  [ "$(ibc "$X_REM <= 0")" = "1" ] && break
  B=$HEADROOM; [ "$(ibc "$X_REM < $HEADROOM")" = "1" ] && B=$X_REM
  [ "$(ibc "$B <= 0")" = "1" ] && { echo "FATAL: no borrow headroom in simulation"; exit 1; }
  SIM_D=$(ibc "$SIM_D + $B"); SIM_C=$(ibc "$SIM_C + $B * $EFF6 / 1000000")
  SIM_TURNS=$((SIM_TURNS + 1))
  [ "$B" = "$X_REM" ] && break
  [ "$SIM_TURNS" -gt 50 ] && { echo "FATAL: simulation did not converge"; exit 1; }
done
echo "minimum turns at worst-case slippage: $SIM_TURNS"
[ "$SIM_TURNS" -le "$MAX_TURNS" ] \
  || { echo "FATAL: target_ltv $TARGET_LTV needs $SIM_TURNS turns, max_loop_turns is $MAX_TURNS (recursive loop bound; see fork.config.json _comment_turns)"; exit 1; }

# All strategy calls go through vault.execute as the strategist, so the vault
# itself holds the position the NAV component reads. Approvals are
# exact-amount and revoked after entry (vault natspec).
exec_vault() { # exec_vault <target> <sig> [args...]
  local target="$1" sig="$2"; shift 2
  local data; data=$(cast calldata "$sig" "$@")
  cast send "$VAULT" "execute(address,bytes)" "$target" "$data" --private-key "$K_STRAT" --rpc-url "$RPC" >/dev/null
}
usde_bal()  { cast call "$USDE" 'balanceOf(address)(uint256)' "$VAULT" --rpc-url "$RPC" | awk '{print $1}'; }
usdc_bal()  { cast call "$USDC" 'balanceOf(address)(uint256)' "$VAULT" --rpc-url "$RPC" | awk '{print $1}'; }
oracle_p()  { cast call "$ORACLE" 'price()(uint256)' --rpc-url "$RPC" | awk '{print $1}'; }
# Pool spot price at slot0, same 1e24 scale as oracle_p (USDC value per 1e18
# USDe): price_1e24 = sqrtPriceX96^2 * 1e36 / 2^192 (token0=USDe, token1=USDC;
# same formula as components/vault-nav/src/nav.rs price_1e24_at_tick). Spot,
# not oracle_p's min(par,TWAP): oracle_p caps at par, which is exactly what
# breaks min_out below when USDe trades above par.
pool_p() {
  local sqrtp
  # SwapRouter02 sits on top of the Uniswap V3 pool. Uniswap V3 pools
  # return 7 words from slot0 (feeProtocol as the 6th uint8 is present);
  # Aerodrome CL forks return 6. `.swap_route` in the catalog is pinned
  # to Uniswap V3 (see fork.config.json), so decode 7 words. A future
  # Aerodrome market pin would need its own reader wired the same way
  # `contracts/src/PriimeVault.sol::verifyUniswapV3Pool` sanity-checks
  # the shape at deploy time.
  sqrtp=$(cast call "$POOL" 'slot0()(uint160,int24,uint16,uint16,uint16,uint8,bool)' --rpc-url "$RPC" | awk 'NR==1{print $1}')
  ibc "$sqrtp * $sqrtp * 10^36 / 2^192"
}
# Position reads: collateral (1e18) and debt (1e6, borrow shares -> assets
# rounded up with Morpho's virtual-shares convention).
read_pos() { # sets COLL, DEBT, COLLVAL
  local pos mkt bs tba tbs P
  pos=$(cast call "$MORPHO" "position(bytes32,address)(uint256,uint128,uint128)" "$MKT" "$VAULT" --rpc-url "$RPC" | awk '{print $1}')
  bs=$(echo "$pos" | sed -n 2p); COLL=$(echo "$pos" | sed -n 3p)
  mkt=$(cast call "$MORPHO" "market(bytes32)(uint128,uint128,uint128,uint128,uint128,uint128)" "$MKT" --rpc-url "$RPC" | awk '{print $1}')
  tba=$(echo "$mkt" | sed -n 3p); tbs=$(echo "$mkt" | sed -n 4p)
  DEBT=$(ibc "($bs * ($tba + 1) + ($tbs + 1000000) - 1) / ($tbs + 1000000)")
  P=$(oracle_p)
  COLLVAL=$(ibc "$COLL * $P / 1000000000000000000000000000000000000")   # 1e24 scale -> USDC 1e6
}
swap_supply() { # swap the vault's whole USDC amount $1 -> USDe, supply it all
  local amt="$1" price min_out got
  # USDC (6 dec) -> USDe (18 dec) at the pool's current spot price, bound by
  # max_slippage_bps: out ~= amt * 1e36 / price_1e24 (inverse of nav.rs's
  # collateral_value = collateral_1e18 * price_1e24 / 1e36). Par-only pricing
  # (old: amt * 1e12) overstates min_out whenever USDe trades above par and
  # halts entry on a real premium.
  price=$(pool_p)
  min_out=$(ibc "$amt * 10^36 * (10000 - $SLIP_BPS) / ($price * 10000)")
  exec_vault "$USDC" "approve(address,uint256)" "$ROUTER" "$amt"                     # exact-amount
  # Uniswap V3 SwapRouter02.exactInputSingle takes SEVEN fields:
  #   (tokenIn, tokenOut, uint24 fee, recipient, amountIn, amountOutMinimum, sqrtPriceLimitX96)
  # NOT the 8-field Aerodrome CL shape with int24 tickSpacing + a deadline
  # slot. Using the wrong shape decodes into arbitrary field positions and
  # the swap either reverts or steers into an unrelated pool. See
  # contracts/src/interfaces/external/IUniswapV3SwapRouter02.sol for the
  # canonical struct the vault's allowlist pins against.
  exec_vault "$ROUTER" "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))" \
    "($USDC,$USDE,$POOL_FEE,$VAULT,$amt,$min_out,0)"
  got=$(usde_bal)
  exec_vault "$USDE" "approve(address,uint256)" "$MORPHO" "$got"                     # exact-amount
  exec_vault "$MORPHO" "supplyCollateral((address,address,address,address,uint256),uint256,address,bytes)" \
    "$MKT_PARAMS" "$got" "$VAULT" "0x"
}

say "enter loop: seed conversion + up to $MAX_TURNS sized borrow turns"
swap_supply "$(usdc_bal)"                        # seed: all unlocked USDC -> collateral
read_pos
echo "seed supplied: $(fbc 2 "$COLL/10^18") USDe (\$$(fbc 2 "$COLLVAL/10^6"))"

TURN=0
while :; do
  read_pos
  HEADROOM=$(ibc "$U6 * $COLLVAL / 1000000 - $DEBT")
  X_REM=$(ibc "($L6 * $COLLVAL / 1000000 - $DEBT) * 1000000 / (1000000 - $L6)")
  [ "$(ibc "$X_REM <= 0")" = "1" ] && break      # already at/over target
  B=$HEADROOM; LANDING=0
  [ "$(ibc "$X_REM <= $HEADROOM")" = "1" ] && { B=$X_REM; LANDING=1; }
  [ "$(ibc "$B <= 0")" = "1" ] && { echo "FATAL: no borrow headroom on-chain (COLLVAL=$COLLVAL DEBT=$DEBT)"; exit 1; }
  TURN=$((TURN + 1))
  [ "$TURN" -gt "$MAX_TURNS" ] && { echo "FATAL: exceeded max_loop_turns=$MAX_TURNS before landing"; exit 1; }
  # borrow (onBehalf = vault, receiver = vault) -> swap -> supply
  exec_vault "$MORPHO" "borrow((address,address,address,address,uint256),uint256,uint256,address,address)" \
    "$MKT_PARAMS" "$B" 0 "$VAULT" "$VAULT"
  swap_supply "$B"
  read_pos
  echo "turn $TURN: borrowed $(fbc 2 "$B/10^6") USDC -> LTV $(fbc 4 "$DEBT/$COLLVAL"), HF $(fbc 4 "$COLLVAL*$LLTV6/1000000/$DEBT")"
  [ "$LANDING" = "1" ] && break
done

# Revoke every approval granted through execute (vault natspec: exact-amount
# and revoked once entry completes). Exact approvals are consumed, but reset
# to 0 explicitly so no allowance survives the entry sequence.
say "revoke approvals"
exec_vault "$USDC" "approve(address,uint256)" "$ROUTER" 0
exec_vault "$USDE" "approve(address,uint256)" "$MORPHO" 0
for pair in "$USDC:$ROUTER" "$USDE:$MORPHO"; do
  ALLOW=$(cast call "${pair%%:*}" 'allowance(address,address)(uint256)' "$VAULT" "${pair#*:}" --rpc-url "$RPC" | awk '{print $1}')
  [ "$ALLOW" = "0" ] || { echo "FATAL: allowance ${pair} not revoked ($ALLOW)"; exit 1; }
done
echo "all approvals reset to 0"

# --- 5. entry gates (all from on-chain reads) -------------------------------
say "entry gates"
read_pos

# Gate 1: health factor = collateral value * LLTV / debt >= floor.
HF_X4=$(ibc "$COLLVAL * $LLTV6 / 1000000 * 10000 / $DEBT")   # HF in 1e4
echo "health factor      : $(fbc 4 "$HF_X4/10000") (floor $HF_FLOOR)"
[ "$(ibc "$HF_X4 >= $HF6 / 100")" = "1" ] || { echo "FAILED: health factor below floor"; exit 1; }

# Gate 2: net spread. Borrow APR from the Morpho IRM view (per-second WAD
# rate * seconds-per-year). Documented simplification: the carry on the
# collateral leg is incentive-paid (Merkl) and excluded from NAV (NAV-02),
# so the gate uses the config's collateral_incentive_apr_bps placeholder:
#   net = incentive APR - borrow APR >= min_net_spread_bps.
MKT_STATE=$(cast call "$MORPHO" "market(bytes32)(uint128,uint128,uint128,uint128,uint128,uint128)" "$MKT" --rpc-url "$RPC" | awk '{print $1}' | tr '\n' ' ')
read -r M1 M2 M3 M4 M5 M6 <<< "$MKT_STATE"
RATE=$(cast call "$IRM" "borrowRateView((address,address,address,address,uint256),(uint128,uint128,uint128,uint128,uint128,uint128))(uint256)" \
  "$MKT_PARAMS" "($M1,$M2,$M3,$M4,$M5,$M6)" --rpc-url "$RPC" | awk '{print $1}')
BORROW_APR_BPS=$(ibc "$RATE * 31536000 * 10000 / 1000000000000000000")
NET_BPS=$(ibc "$INC_APR_BPS - $BORROW_APR_BPS")
echo "borrow APR         : ${BORROW_APR_BPS} bps (IRM view); incentive carry ${INC_APR_BPS} bps (config placeholder)"
echo "net spread         : ${NET_BPS} bps (min ${MIN_SPREAD_BPS})"
[ "$(ibc "$NET_BPS >= $MIN_SPREAD_BPS")" = "1" ] || { echo "FAILED: net spread below min_net_spread_bps"; exit 1; }

# Gate 3: final LTV within 50 bps of target_ltv.
LTV_X6=$(ibc "$DEBT * 1000000 / $COLLVAL")
LTV_DIFF=$(ibc "d = $LTV_X6 - $L6; if (d < 0) d = -d; d")
echo "final LTV          : $(fbc 4 "$LTV_X6/1000000") (target $TARGET_LTV, |diff| $(ibc "$LTV_DIFF / 100") bps)"
[ "$(ibc "$LTV_DIFF <= 5000")" = "1" ] || { echo "FAILED: final LTV more than 50 bps from target"; exit 1; }

# Gate 4: escrow floor intact -- vault idle USDC covers pending deposit
# escrow + reserved redemption payouts (both zero after the bootstrap
# strike; the invariant is asserted, not assumed).
IDLE=$(usdc_bal)
FLOOR=$(ibc "$(cast call "$VAULT" 'totalPendingDepositAssets()(uint256)' --rpc-url "$RPC" | awk '{print $1}') + $(cast call "$VAULT" 'totalClaimableRedeemAssets()(uint256)' --rpc-url "$RPC" | awk '{print $1}')")
echo "escrow floor       : idle USDC $IDLE >= floor $FLOOR"
[ "$(ibc "$IDLE >= $FLOOR")" = "1" ] || { echo "FAILED: escrow floor breached"; exit 1; }

# --- 6. the re-mark: next strike attests the levered position ---------------
# The component values collateral at min(par, pool TWAP) and debt at accrued
# share math, so the attested NAV must land within 10 bps of the position
# value read here at oracle par (the TWAP sits just under peg at the pinned
# state; the bound only widens under a real depeg).
say "await post-entry strike (NAV re-marks to the levered position, up to $((STRIKE_TRIES * 5))s)"
ENTRY_BLOCK=$(cast block-number --rpc-url "$RPC")
REMARKED=0
for i in $(seq 1 "$STRIKE_TRIES"); do
  sleep 5
  IB=$(cast call "$VAULT" 'lastInputsBlock()(uint256)' --rpc-url "$RPC" | awk '{print $1}')
  if [ "$(ibc "$IB >= $ENTRY_BLOCK")" = "1" ]; then REMARKED=1; break; fi
  echo "  t+$((i*5))s: last inputsBlock $IB < entry block $ENTRY_BLOCK"
done
[ "$REMARKED" = "1" ] || { echo "FATAL: no post-entry strike; inspect the priime-vault node logs"; exit 1; }
NAV=$(cast call "$VAULT" 'nav()(uint256)' --rpc-url "$RPC" | awk '{print $1}')
read_pos
EXPECT=$(ibc "$COLLVAL - $DEBT")
NAV_DIFF=$(ibc "d = $NAV - $EXPECT; if (d < 0) d = -d; d")
TOL=$(ibc "$COLLVAL / 1000")   # 10 bps of collateral value
echo "attested NAV       : $NAV (par-value position $EXPECT, |diff| $NAV_DIFF, tol $TOL)"
[ "$(ibc "$NAV_DIFF <= $TOL")" = "1" ] || { echo "FAILED: attested NAV outside tolerance of position value"; exit 1; }

say "position summary"
LEV_X4=$(ibc "$COLLVAL * 10000 / ($COLLVAL - $DEBT)")
echo "  vault              = $VAULT"
echo "  service manager    = $SM (one service, vault workflow)"
echo "  collateral         = $(fbc 6 "$COLL/10^18") USDe (\$$(fbc 2 "$COLLVAL/10^6") at oracle price)"
echo "  debt               = $(fbc 6 "$DEBT/10^6") USDC"
echo "  LTV                = $(fbc 4 "$LTV_X6/1000000")  (target $TARGET_LTV, LLTV $(fbc 3 "$LLTV6/1000000"))"
echo "  health factor      = $(fbc 4 "$HF_X4/10000")  (floor $HF_FLOOR)"
echo "  effective leverage = $(fbc 2 "$LEV_X4/10000")x"
echo "  turns used         = $TURN of $MAX_TURNS (plus seed conversion)"
echo "  attested NAV       = $NAV (live re-mark: min(par, TWAP) collateral minus accrued debt)"
echo
echo "SUCCESS: deposit fulfilled and position re-marked by REAL attested strikes from the running service; USDe/USDC Morpho loop entered at target LTV via vault.execute"
