#!/usr/bin/env bash
# M3-3/M3-4: seeded loop entry against the live vault service on the pinned
# Base fork.
#
# Runs against deploy/fork.sh (fork) + deploy/vault-service.sh (service:
# manager, vault, WAVS node, cron NAV strikes). Every settlement here is a
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
# Prereqs:
#   deploy/fork.sh                                # pinned Base fork on :8545
#   deploy/vault-service.sh                       # service + node + first strike
#
# Re-runnable against a fresh vault-service.sh run (one seed per vault).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"          # priime-demo
DEPLOY="$ROOT/deploy"
CFG="$DEPLOY/fork.config.json"
FORKDIR="$DEPLOY/.fork"
SVC="$FORKDIR/vault-service.json"
MNEMONIC="test test test test test test test test test test test junk"   # anvil default

say() { echo; echo "== $* =="; }
cfg() { jq -r "$1" "$CFG"; }
ibc() { echo "$1" | bc; }                          # integer bc (big-number math)
fbc() { echo "scale=$1; $2" | bc; }                # fixed-scale bc (display only)

# --- 0. config + keys -------------------------------------------------------
FORK_PORT="${FORK_PORT:-$(cfg .fork.fork_port)}"
FORK_CHAIN_ID=$(cfg .fork.fork_chain_id)
RPC="http://localhost:$FORK_PORT"

USDC=$(cfg .tokens.usdc.address)
USDE=$(cfg .tokens.usde.address)
MORPHO=$(cfg .morpho.blue)
MKT=$(cfg .morpho.market.id)
ORACLE=$(cfg .morpho.market.params.oracle)
IRM=$(cfg .morpho.market.params.irm)
LLTV=$(cfg .morpho.market.params.lltv)             # 1e18 scale
ROUTER=$(cfg .swap_route.router)
TICK_SPACING=$(cfg .swap_route.tick_spacing)
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

# Mnemonic accounts originate transactions only: 4 = strategist, 5 = depositor.
key()  { cast wallet private-key --mnemonic "$MNEMONIC" --mnemonic-index "$1"; }
addr() { cast wallet address     --mnemonic "$MNEMONIC" --mnemonic-index "$1"; }
STRATEGIST=$(addr 4); K_STRAT=$(key 4)
DEPOSITOR=$(addr 5);  K_DEP=$(key 5)

# --- 1. preconditions: fork + vault service must be live --------------------
say "preconditions"
[ -f "$FORKDIR/anvil.pid" ] && kill -0 "$(cat "$FORKDIR/anvil.pid")" 2>/dev/null \
  || { echo "FATAL: no running fork; start it with: deploy/fork.sh"; exit 1; }
[ "$(cast chain-id --rpc-url "$RPC")" = "$FORK_CHAIN_ID" ] \
  || { echo "FATAL: chainId mismatch on :$FORK_PORT; is this the fork.sh anvil?"; exit 1; }
[ -f "$SVC" ] || { echo "FATAL: $SVC missing; run deploy/vault-service.sh first"; exit 1; }
VAULT=$(jq -r .vault "$SVC")
SM=$(jq -r .service_manager "$SVC")
[ "$(jq -r .strategist "$SVC" | tr 'A-F' 'a-f')" = "$(echo "$STRATEGIST" | tr 'A-F' 'a-f')" ] \
  || { echo "FATAL: service strategist != mnemonic index 4"; exit 1; }
[ "$(cast code "$VAULT" --rpc-url "$RPC")" != "0x" ] \
  || { echo "FATAL: vault $VAULT has no code; rerun deploy/vault-service.sh"; exit 1; }
U0=$(cast call "$VAULT" 'updateCount()(uint256)' --rpc-url "$RPC" | awk '{print $1}')
[ "$U0" != "0" ] || { echo "FATAL: no strikes yet; is the vault-service node running?"; exit 1; }
[ "$(cast call "$VAULT" 'totalSupply()(uint256)' --rpc-url "$RPC" | awk '{print $1}')" = "0" ] \
  || { echo "FATAL: vault already seeded; rerun deploy/vault-service.sh for a fresh vault"; exit 1; }
echo "vault $VAULT live: updateCount=$U0 (cron strikes landing)"

# --- 2. seed capital: fund depositor, requestDeposit ------------------------
# FORK-TRACK-ONLY FUNDING SCAFFOLDING: the depositor is funded by anvil-
# impersonating Morpho Blue itself (largest USDC holder at the pinned block).
# Never a mainnet pattern.
say "seed depositor with $DEPOSIT_USDC USDC (fork-only impersonation) + requestDeposit"
cast rpc anvil_impersonateAccount "$MORPHO" --rpc-url "$RPC" >/dev/null
cast rpc anvil_setBalance "$MORPHO" 0xde0b6b3a7640000 --rpc-url "$RPC" >/dev/null
cast send "$USDC" "transfer(address,uint256)(bool)" "$DEPOSITOR" "$DEPOSIT" \
  --from "$MORPHO" --unlocked --rpc-url "$RPC" >/dev/null
cast rpc anvil_stopImpersonatingAccount "$MORPHO" --rpc-url "$RPC" >/dev/null
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
say "await bootstrap strike (real pipeline fulfills the deposit)"
FULFILLED=0
for i in $(seq 1 12); do
  sleep 5
  PENDING=$(cast call "$VAULT" 'totalPendingDepositAssets()(uint256)' --rpc-url "$RPC" | awk '{print $1}')
  if [ "$PENDING" = "0" ]; then FULFILLED=1; break; fi
  echo "  t+$((i*5))s: deposit still pending"
done
[ "$FULFILLED" = "1" ] || { echo "FATAL: deposit not fulfilled; inspect the wavs-vault node logs"; exit 1; }
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
  sqrtp=$(cast call "$POOL" 'slot0()(uint160,int24,uint16,uint16,uint16,bool)' --rpc-url "$RPC" | awk 'NR==1{print $1}')
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
  local amt="$1" price min_out deadline got
  # USDC (6 dec) -> USDe (18 dec) at the pool's current spot price, bound by
  # max_slippage_bps: out ~= amt * 1e36 / price_1e24 (inverse of nav.rs's
  # collateral_value = collateral_1e18 * price_1e24 / 1e36). Par-only pricing
  # (old: amt * 1e12) overstates min_out whenever USDe trades above par and
  # halts entry on a real premium.
  price=$(pool_p)
  min_out=$(ibc "$amt * 10^36 * (10000 - $SLIP_BPS) / ($price * 10000)")
  deadline=$(( $(cast block latest -f timestamp --rpc-url "$RPC") + 600 ))
  exec_vault "$USDC" "approve(address,uint256)" "$ROUTER" "$amt"                     # exact-amount
  exec_vault "$ROUTER" "exactInputSingle((address,address,int24,address,uint256,uint256,uint256,uint160))" \
    "($USDC,$USDE,$TICK_SPACING,$VAULT,$deadline,$amt,$min_out,0)"
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
say "await post-entry strike (NAV re-marks to the levered position)"
ENTRY_BLOCK=$(cast block-number --rpc-url "$RPC")
REMARKED=0
for i in $(seq 1 12); do
  sleep 5
  IB=$(cast call "$VAULT" 'lastInputsBlock()(uint256)' --rpc-url "$RPC" | awk '{print $1}')
  if [ "$(ibc "$IB >= $ENTRY_BLOCK")" = "1" ]; then REMARKED=1; break; fi
  echo "  t+$((i*5))s: last inputsBlock $IB < entry block $ENTRY_BLOCK"
done
[ "$REMARKED" = "1" ] || { echo "FATAL: no post-entry strike; inspect the wavs-vault node logs"; exit 1; }
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
