#!/usr/bin/env bash
# M3-3: vault-service deploy + seeded loop entry on the pinned Base fork.
#
# Runs against the fork started by deploy/fork.sh (must already be up):
#   1. deploys a FRESH POA service manager for the vault service (service
#      isolation, security review finding #1: PriimeVault is the ONLY handler
#      wired to this manager; HelloNavHandler is never deployed in this flow,
#      and the operator/signing keys are fresh ephemeral keys, fully disjoint
#      from deploy.sh's mnemonic indices 0 and 1),
#   2. deploys PriimeVault against it and asserts the wiring,
#   3. seeds the depositor with initial_deposit_usdc and requestDeposit()s,
#   4. lands a bootstrap NAV strike -- a GENUINELY VALID 1-of-1 quorum
#      signature over the real envelope digest (no mocked proofs; see the
#      digest note at step 5) -- which fulfills the deposit and unlocks the
#      capital,
#   5. enters the USDe/USDC recursive Morpho Blue loop via vault.execute(),
#      turn-sized so the END state lands on target_ltv (see the sizing note
#      at step 6), then revokes every approval,
#   6. checks the entry gates (health factor, config-driven net spread,
#      final LTV, escrow floor) from on-chain reads and prints the position.
#
# All strategy numbers come from fork.config.json (LOOP-03), never hardcoded.
# Decimals: USDC 6, USDe 18, Morpho oracle price scale 1e24 (36 + 6 - 18).
#
# Prereqs:
#   deploy/fork.sh                                # pinned Base fork on :8545
#   docker images: ghcr.io/lay3rlabs/poa-middleware:1.0.1
#
# Re-runnable: redeploys a fresh service manager + vault each run (the old
# position stays on the fork; restart fork.sh for a pristine state).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"          # priime-demo
DEPLOY="$ROOT/deploy"
CFG="$DEPLOY/fork.config.json"
FORKDIR="$DEPLOY/.fork"
POA_IMG="ghcr.io/lay3rlabs/poa-middleware:1.0.1"
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

# Keys. deploy.sh (hello-nav service) derives its operator + signing key from
# anvil mnemonic indices 0 and 1; the vault service must not reuse those
# (service isolation, finding #1) -- and on a MAINNET FORK the well-known
# anvil addresses cannot be signing keys at all: every one of them carries an
# EIP-7702 sweeper delegation on Base (compromised public keys), so they have
# code, and the POA registry's SignatureChecker routes any signer-with-code
# to ERC-1271 instead of ECDSA. The vault service's operator + signing key
# are therefore fresh ephemeral keys, generated per run and held only by this
# script -- a strictly stronger separation than "different mnemonic indices".
# Mnemonic accounts are still used where they only ORIGINATE transactions
# (the 7702 delegation code is inert for tx origination): index 0 funds the
# POA deploy and owns the registry; 4/5 are the strategist and depositor.
key()  { cast wallet private-key --mnemonic "$MNEMONIC" --mnemonic-index "$1"; }
addr() { cast wallet address     --mnemonic "$MNEMONIC" --mnemonic-index "$1"; }
K0=$(key 0)                                        # POA deployer + registry owner
STRATEGIST=$(addr 4); K_STRAT=$(key 4)
DEPOSITOR=$(addr 5);  K_DEP=$(key 5)
K_OP=$(cast wallet new | awk '/Private key:/{print $NF}')
OPERATOR=$(cast wallet address "$K_OP")
K_SIGN=$(cast wallet new | awk '/Private key:/{print $NF}')
SIGNING=$(cast wallet address "$K_SIGN")

# --- 1. preconditions: fork.sh must already be running ----------------------
say "preconditions"
[ -f "$FORKDIR/anvil.pid" ] && kill -0 "$(cat "$FORKDIR/anvil.pid")" 2>/dev/null \
  || { echo "FATAL: no running fork (pidfile $FORKDIR/anvil.pid); start it with: deploy/fork.sh"; exit 1; }
cast block-number --rpc-url "$RPC" >/dev/null 2>&1 \
  || { echo "FATAL: fork not reachable on :$FORK_PORT; start it with: deploy/fork.sh"; exit 1; }
[ "$(cast chain-id --rpc-url "$RPC")" = "$FORK_CHAIN_ID" ] \
  || { echo "FATAL: chainId mismatch on :$FORK_PORT (want $FORK_CHAIN_ID); is this the fork.sh anvil?"; exit 1; }
[ "$(cast code "$MORPHO" --rpc-url "$RPC")" != "0x" ] \
  || { echo "FATAL: Morpho Blue has no code; :$FORK_PORT is not a Base fork. Run deploy/fork.sh"; exit 1; }
docker info >/dev/null 2>&1 || { echo "FATAL: docker daemon not running (needed for POA middleware deploy)"; exit 1; }
echo "fork ok: block $(cast block-number --rpc-url "$RPC"), chainId $FORK_CHAIN_ID"

# RPC URL as seen from inside the POA container: with true host networking
# (Linux) localhost works; on Docker Desktop (macOS) the host is reachable
# only as host.docker.internal. Probe once and fail clearly if neither works.
DOCKER_RPC=""
for cand in "http://localhost:$FORK_PORT" "http://host.docker.internal:$FORK_PORT"; do
  if docker run --rm --network host --entrypoint cast "$POA_IMG" chain-id --rpc-url "$cand" >/dev/null 2>&1; then
    DOCKER_RPC="$cand"; break
  fi
done
[ -n "$DOCKER_RPC" ] || { echo "FATAL: fork on :$FORK_PORT not reachable from inside docker (tried localhost and host.docker.internal)"; exit 1; }
echo "container-side RPC: $DOCKER_RPC"

# --- 2. fresh POA service manager for the vault service ---------------------
# deploy.sh step-3 pattern, but with its own state dir (under .fork/, with
# the rest of the fork-session state) so the vault service's registry never
# aliases the hello-nav one.
say "deploy vault-service POA service manager"
mkdir -p "$FORKDIR/nodes-vault"
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
echo "vault service manager: $SM"

# --- 3. deploy PriimeVault wired to the fresh manager -----------------------
# PriimeVault is the ONLY handler on this manager; HelloNavHandler is NOT
# deployed in this flow (service isolation, security review finding #1).
say "deploy PriimeVault"
VAULT=$( cd "$ROOT/contracts" && forge create src/PriimeVault.sol:PriimeVault \
  --rpc-url "$RPC" --private-key "$K0" --broadcast \
  --constructor-args "$SM" "$USDC" "$STRATEGIST" \
  | awk '/Deployed to/{print $NF}' )
echo "vault: $VAULT (strategist $STRATEGIST)"
GOT_SM=$(cast call "$VAULT" 'getServiceManager()(address)' --rpc-url "$RPC")
[ "$(echo "$GOT_SM" | tr 'A-F' 'a-f')" = "$(echo "$SM" | tr 'A-F' 'a-f')" ] \
  || { echo "FATAL: vault.getServiceManager()=$GOT_SM != freshly deployed $SM"; exit 1; }
echo "service isolation ok: vault is wired to the fresh manager"

# --- 4. seed capital: fund depositor, requestDeposit ------------------------
# FORK-TRACK-ONLY FUNDING SCAFFOLDING: the depositor is funded by anvil-
# impersonating Morpho Blue itself (the largest USDC holder in config; holds
# the market's ~37M idle USDC at the pinned block). Never a mainnet pattern.
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

# --- 5. bootstrap NAV strike: register operator, sign, submit ---------------
# deploy.sh step-7 pattern with the vault-service indices. This is a
# GENUINELY VALID 1-of-1 quorum on the fork track, not a mocked proof: the
# signing key is registered on the freshly deployed POA registry and the
# signature is over the exact digest POAStakeRegistry.validate() checks.
#
# Digest derivation (from the POA contract source shipped in the
# poa-middleware image, contracts/src/ecdsa/POAStakeRegistry.sol):
#   validate(envelope, sigData):
#     messageHash = keccak256(abi.encode(envelope))          // Envelope struct
#     digest      = MessageHashUtils.toEthSignedMessageHash(messageHash)
#                 = keccak256("\x19Ethereum Signed Message:\n32" || messageHash)
#     ECDSA-recover each signature against digest; signers ascending; weights
#     must clear threshold + quorum at referenceBlock (uint32 max = latest).
# `cast wallet sign <32-byte-hex>` applies exactly that EIP-191 prefix, so we
# sign the keccak of the abi-encoded envelope with NO --no-hash flag. The WAVS
# node produces the same digest for aggregator submissions; the on-chain
# validate() is the source of truth both must match.
say "register vault-service operator (ephemeral keys)"
# The signing key must be a code-free EOA on the fork or the registry's
# SignatureChecker will take the ERC-1271 path and reject plain ECDSA sigs.
[ "$(cast code "$SIGNING" --rpc-url "$RPC")" = "0x" ] \
  || { echo "FATAL: signing key $SIGNING has code on the fork; cannot ECDSA-validate"; exit 1; }
# Fork-track-only scaffolding: gas money for the operator's one registration tx.
cast rpc anvil_setBalance "$OPERATOR" 0xde0b6b3a7640000 --rpc-url "$RPC" >/dev/null
cast send "$SM" "registerOperator(address,uint256)" "$OPERATOR" 1000 --private-key "$K0" --rpc-url "$RPC" >/dev/null
# Signing-key registration signature: raw keccak digest, no EIP-191 (contract
# verifies ECDSA over keccak256(abi.encode(operator)) directly) -> --no-hash.
ENC=$(cast abi-encode "f(address)" "$OPERATOR"); MSG=$(cast keccak "$ENC")
SIG=$(cast wallet sign --no-hash --private-key "$K_SIGN" "$MSG")
# updateOperatorSigningKey is msg.sender-scoped: sent BY the operator.
cast send "$SM" "updateOperatorSigningKey(address,bytes)" "$SIGNING" "$SIG" --private-key "$K_OP" --rpc-url "$RPC" >/dev/null
echo "operator $OPERATOR registered, signing key $SIGNING"

say "bootstrap NAV strike (real 1-of-1 quorum)"
INPUTS_BLOCK=$(cast block-number --rpc-url "$RPC")
# Payload = abi.encode(handler, nav, inputsBlock), the exact bytes the vault
# decodes: the first field binds the envelope to its intended handler (the
# vault checks it against address(this), guard zero), matching what the NAV
# component will sign once its workflow carries the handler address as
# config. The bootstrap attests nav=0 -- the honest pre-fold NAV: the
# strategy holds nothing yet and pending deposit escrow is excluded from NAV
# by definition. The zero-supply fulfillment then replaces NAV with the
# folded-in assets.
PAYLOAD=$(cast abi-encode "f(address,uint256,uint256)" "$VAULT" 0 "$INPUTS_BLOCK")
EVENT_ID=0x$(cast keccak "$(cast abi-encode "f(string,address,uint256)" "priime-vault-bootstrap" "$VAULT" "$INPUTS_BLOCK")" | cut -c3-42)
ORDERING=0x000000000000000000000000
ENV_TUPLE="($EVENT_ID,$ORDERING,$PAYLOAD)"
ENC_ENV=$(cast abi-encode "f((bytes20,bytes12,bytes))" "$ENV_TUPLE")
MSG_HASH=$(cast keccak "$ENC_ENV")
ENV_SIG=$(cast wallet sign --private-key "$K_SIGN" "$MSG_HASH")
REF_BLOCK=4294967295   # uint32 max: validate() uses latest registry checkpoints
cast send "$VAULT" "handleSignedEnvelope((bytes20,bytes12,bytes),(address[],bytes[],uint32))" \
  "$ENV_TUPLE" "([$SIGNING],[$ENV_SIG],$REF_BLOCK)" --private-key "$K0" --rpc-url "$RPC" >/dev/null
NAV=$(cast call "$VAULT" 'nav()(uint256)' --rpc-url "$RPC" | awk '{print $1}')
UPDATES=$(cast call "$VAULT" 'updateCount()(uint256)' --rpc-url "$RPC" | awk '{print $1}')
[ "$UPDATES" = "1" ] && [ "$NAV" = "$DEPOSIT" ] \
  || { echo "FATAL: bootstrap strike not folded (updateCount=$UPDATES nav=$NAV, want 1/$DEPOSIT)"; exit 1; }
echo "strike accepted: eventId=$EVENT_ID inputsBlock=$INPUTS_BLOCK nav=$NAV (deposit folded, capital unlocked)"

# --- 6. loop entry via vault.execute ----------------------------------------
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
# itself holds the position the NAV component will read. Approvals are
# exact-amount and revoked after entry (vault natspec).
exec_vault() { # exec_vault <target> <sig> [args...]
  local target="$1" sig="$2"; shift 2
  local data; data=$(cast calldata "$sig" "$@")
  cast send "$VAULT" "execute(address,bytes)" "$target" "$data" --private-key "$K_STRAT" --rpc-url "$RPC" >/dev/null
}
usde_bal()  { cast call "$USDE" 'balanceOf(address)(uint256)' "$VAULT" --rpc-url "$RPC" | awk '{print $1}'; }
usdc_bal()  { cast call "$USDC" 'balanceOf(address)(uint256)' "$VAULT" --rpc-url "$RPC" | awk '{print $1}'; }
oracle_p()  { cast call "$ORACLE" 'price()(uint256)' --rpc-url "$RPC" | awk '{print $1}'; }
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
  local amt="$1" min_out deadline got
  # USDC (6 dec) -> USDe (18 dec): scale by 1e12, bound by max_slippage_bps.
  min_out=$(ibc "$amt * 1000000000000 * (10000 - $SLIP_BPS) / 10000")
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

# --- 7. entry gates + final assertions (all from on-chain reads) ------------
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

say "position summary"
LEV_X4=$(ibc "$COLLVAL * 10000 / ($COLLVAL - $DEBT)")
echo "  vault              = $VAULT"
echo "  service manager    = $SM (fresh, vault-only)"
echo "  collateral         = $(fbc 6 "$COLL/10^18") USDe (\$$(fbc 2 "$COLLVAL/10^6") at oracle price)"
echo "  debt               = $(fbc 6 "$DEBT/10^6") USDC"
echo "  LTV                = $(fbc 4 "$LTV_X6/1000000")  (target $TARGET_LTV, LLTV $(fbc 3 "$LLTV6/1000000"))"
echo "  health factor      = $(fbc 4 "$HF_X4/10000")  (floor $HF_FLOOR)"
echo "  effective leverage = $(fbc 2 "$LEV_X4/10000")x"
echo "  turns used         = $TURN of $MAX_TURNS (plus seed conversion)"
echo "  attested NAV       = $NAV (bootstrap; next strike re-marks to position value)"
echo
echo "SUCCESS: vault-service deployed in isolation, deposit fulfilled by a real 1-of-1 attested strike, and the USDe/USDC Morpho loop entered at target LTV via vault.execute"
