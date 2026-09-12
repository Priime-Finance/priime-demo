#!/usr/bin/env bash
# TARGET resolution for the deploy scripts: one selector, one config per
# target, and exactly one place where a cheat code is allowed to exist.
#
# SOURCED, never executed. Every script in deploy/ sets ROOT and DEPLOY, then
# `source "$DEPLOY/target.sh"`.
#
# The premise: deploy/fork.config.json describes an anvil fork OF BASE MAINNET
# at a pinned block, using the real protocol addresses (real USDC, real USDe,
# real Morpho Blue, real Aerodrome). So almost nothing in these scripts is
# actually fork-specific. The market is the same market either way, and it
# stays in fork.config.json, shared by every target. What genuinely differs is
# small:
#
#   RPC / RPC_PORT      where transactions go
#   CHAIN_ID / CHAIN    31337 on the fork, 8453 on Base
#   STATE_DIR           deploy/.fork or deploy/.mainnet (per-run artifacts)
#   CRON_SCHEDULE       the NAV strike cadence (see targets/*.json for why)
#   IS_FORK             1 only when the chain is an anvil fork
#   how accounts get keys, gas and tokens
#   whether you can conjure a block or have to wait for one
#
# and the last three live behind three helpers: role_key / role_addr,
# fund_account and mine_or_wait. Those are the only functions that branch on
# the target, which is the whole point: an `anvil_*` RPC call must not appear
# anywhere else in deploy/ except fork.sh, which exists to start the fork.
#
# TARGET defaults to "fork", so every pre-existing invocation of every script
# keeps working with no change and no new environment.
#
# Targets:
#   fork         anvil fork of Base at the pinned block, chain 31337. Funding by
#                impersonation, keys from the well-known anvil mnemonic, blocks
#                forced with anvil_mine.
#   sepolia      Ethereum Sepolia, chain 11155111. A testnet track for the
#                public URL beat, backed by REAL tokens and REAL Morpho:
#                Ethena's canonical USDe testnet deployment plus Circle's
#                testnet USDC, both on Morpho Blue's own Sepolia deployment
#                using Morpho's ChainlinkOracleV2 factory. The one thing WE
#                deploy is the market itself (permissionless createMarket)
#                and its 1:1 stub oracle (Morpho's own factory pattern for
#                stable pairs). See deploy/sepolia-setup.sh.
#   mainnet      Base, chain 8453. Funding by real transfer, keys and RPC URL
#                from the environment (never committed, never defaulted), no
#                cheat codes, real block waits.

[ -n "${DEPLOY:-}" ] || { echo "FATAL: target.sh sourced without \$DEPLOY set" >&2; exit 1; }

TARGET="${TARGET:-fork}"
TARGET_FILE="$DEPLOY/targets/$TARGET.json"
[ -f "$TARGET_FILE" ] || {
  echo "FATAL: unknown TARGET '$TARGET' (no $TARGET_FILE)" >&2
  echo "       available targets: $(ls "$DEPLOY/targets" 2>/dev/null | sed 's/\.json$//' | tr '\n' ' ')" >&2
  exit 1
}

# Shared protocol base: the market, the tokens, the swap route, the strategy
# parameters. Identical for every target, because the fork IS Base.
CFG="${CFG:-$DEPLOY/$(jq -r '.protocol_config // "fork.config.json"' "$TARGET_FILE")}"
[ -f "$CFG" ] || { echo "FATAL: protocol config $CFG not found" >&2; exit 1; }

say()  { echo; echo "== $* =="; }
cfg()  { jq -r "$1" "$CFG"; }            # shared protocol/strategy config
tcfg() { jq -r "$1 // empty" "$TARGET_FILE"; }   # target config, empty if absent

# Target config lookup that refuses to return nothing.
tcfg_req() {
  local v
  v=$(jq -r "$1 // empty" "$TARGET_FILE")
  [ -n "$v" ] || { echo "FATAL: $TARGET_FILE is missing required key $1" >&2; exit 1; }
  printf '%s\n' "$v"
}

# The house idiom, mirroring required() in apps/loop-server/src/env.ts: fail
# loudly on anything missing, never substitute a default. Used for every
# mainnet secret, so a half-configured mainnet run stops before it signs
# anything rather than quietly reaching for an anvil key.
required_env() {
  local name="$1" v="${!1:-}"
  [ -n "$v" ] || { echo "FATAL: missing required env var $name (TARGET=$TARGET)" >&2; exit 1; }
  printf '%s\n' "$v"
}

# --- chain ------------------------------------------------------------------
CHAIN_ID=$(tcfg_req .chain_id)
CHAIN="evm:$CHAIN_ID"                     # ChainKey as Priime spells it
CHAIN_KIND=$(tcfg_req .chain.kind)        # anvil-fork | live
if [ "$CHAIN_KIND" = "anvil-fork" ]; then IS_FORK=1; else IS_FORK=0; fi
STATE_DIR="$DEPLOY/$(tcfg_req .state_dir)"
CRON_SCHEDULE=$(tcfg_req .service.cron_schedule)

RPC_MODE=$(tcfg_req .rpc.mode)
case "$RPC_MODE" in
  local)
    # A port we own on this machine. The env override (FORK_PORT) is the one
    # the scripts have always honoured.
    RPC_PORT_ENV=$(tcfg_req .rpc.port_env)
    RPC_PORT="${!RPC_PORT_ENV:-$(tcfg_req .rpc.port)}"
    RPC="http://localhost:$RPC_PORT"
    ;;
  env)
    # No default, deliberately: a defaulted RPC URL is how a live run ends up
    # pointed somewhere nobody chose.
    RPC_URL_ENV=$(tcfg_req .rpc.url_env)
    RPC=$(required_env "$RPC_URL_ENV")
    RPC_PORT=""
    ;;
  *)
    echo "FATAL: unknown rpc.mode '$RPC_MODE' in $TARGET_FILE" >&2; exit 1 ;;
esac

# --- keys -------------------------------------------------------------------
# Two sources, and only one of them has anything a script may guess at.
#   mnemonic  a BIP-39 phrase plus a role -> account-index map. The fork's
#             default is the public anvil junk mnemonic; worthless by design.
#   env       a role -> env-var-name map. Nothing is defaulted and nothing is
#             committed; a missing or malformed key is fatal.
KEY_SOURCE=$(tcfg_req .keys.source)
TARGET_MNEMONIC=""
if [ "$KEY_SOURCE" = "mnemonic" ]; then
  KEY_MNEMONIC_ENV=$(tcfg_req .keys.mnemonic_env)
  KEY_MNEMONIC_DEFAULT=$(tcfg .keys.mnemonic_default)
  TARGET_MNEMONIC="${!KEY_MNEMONIC_ENV:-$KEY_MNEMONIC_DEFAULT}"
  [ -n "$TARGET_MNEMONIC" ] \
    || { echo "FATAL: TARGET=$TARGET has no mnemonic; set $KEY_MNEMONIC_ENV" >&2; exit 1; }
elif [ "$KEY_SOURCE" != "env" ]; then
  echo "FATAL: unknown keys.source '$KEY_SOURCE' in $TARGET_FILE" >&2; exit 1
fi

# role_key <role> -> private key on stdout. Roles: owner, strategist,
# depositor, treasury. Never echoed anywhere else.
role_key() {
  local role="$1" slot k
  slot=$(tcfg_req ".keys.roles.\"$role\"")
  case "$KEY_SOURCE" in
    mnemonic) cast wallet private-key --mnemonic "$TARGET_MNEMONIC" --mnemonic-index "$slot" ;;
    env)
      k=$(required_env "$slot")
      [[ "$k" =~ ^0x[0-9a-fA-F]{64}$ ]] \
        || { echo "FATAL: $slot is not a 0x-prefixed 32-byte private key (role $role)" >&2; exit 1; }
      printf '%s\n' "$k"
      ;;
  esac
}

# role_addr <role> -> checksummed address on stdout.
role_addr() {
  local role="$1" slot
  slot=$(tcfg_req ".keys.roles.\"$role\"")
  case "$KEY_SOURCE" in
    mnemonic) cast wallet address --mnemonic "$TARGET_MNEMONIC" --mnemonic-index "$slot" ;;
    env)      cast wallet address --private-key "$(role_key "$role")" ;;
  esac
}

# Guard for scripts whose node config needs a shared mnemonic (deploy.sh puts
# one in priime.toml as signing_mnemonic and derives operator/signer from
# indices 0 and 1). Fails loudly rather than inventing one.
require_mnemonic_target() {
  [ "$KEY_SOURCE" = "mnemonic" ] \
    || { echo "FATAL: ${1:-this script} needs a mnemonic-backed target; TARGET=$TARGET takes its keys from the environment one by one" >&2; exit 1; }
}

# --- liveness ---------------------------------------------------------------
# On the fork the chain is ours and we started it, so the pidfile is the real
# check. On a live chain there is no pidfile; the chain id is the check.
require_chain_up() {
  if [ "$IS_FORK" = "1" ]; then
    [ -f "$STATE_DIR/anvil.pid" ] && kill -0 "$(cat "$STATE_DIR/anvil.pid")" 2>/dev/null \
      || { echo "FATAL: no running fork (pidfile $STATE_DIR/anvil.pid); start it with: deploy/fork.sh" >&2; exit 1; }
  fi
  [ "$(cast chain-id --rpc-url "$RPC" 2>/dev/null)" = "$CHAIN_ID" ] \
    || { echo "FATAL: chainId at $RPC is not $CHAIN_ID (TARGET=$TARGET)" >&2; exit 1; }
}

# require_gas <label> <address>
# On the fork every mnemonic account starts with 10000 ETH, so this is a
# no-op. On a live chain nothing is pre-funded, and an unfunded signer shows
# up as an unexplained revert several steps later; name it here instead.
require_gas() {
  local label="$1" who="$2" bal
  if [ "$IS_FORK" = "1" ]; then return 0; fi
  bal=$(cast balance "$who" --rpc-url "$RPC")
  [ "$bal" != "0" ] \
    || { echo "FATAL: $label $who holds no ETH on chain $CHAIN_ID; fund it before rerunning" >&2; exit 1; }
}

# --- blocks -----------------------------------------------------------------
# One block, please.
#
# On the fork that is anvil_mine: free, instant, and used to make a just-sent
# transaction observable before the next read. On a live chain no such thing
# exists, so we wait for the chain to produce one (Base: ~2s).
mine_or_wait() {
  if [ "$IS_FORK" = "1" ]; then
    cast rpc anvil_mine --rpc-url "$RPC" >/dev/null 2>&1 || true
    return 0
  fi
  local start now
  start=$(cast block-number --rpc-url "$RPC")
  for _ in $(seq 1 "${MINE_WAIT_TRIES:-60}"); do
    sleep 2
    now=$(cast block-number --rpc-url "$RPC")
    if [ "$now" -gt "$start" ]; then return 0; fi
  done
  echo "FATAL: no new block at $RPC after waiting; is the chain producing?" >&2
  exit 1
}

# --- funding ----------------------------------------------------------------
# fund_account <gas|0xTOKEN> <to> <amount>
#
# The single place a "give me free money" shim is allowed to live, and the
# reason the rest of the scripts read the same on either target.
#
#   TARGET=fork     anvil cheat codes. Gas is conjured with anvil_setBalance.
#                   Tokens are taken by impersonating the pinned block's
#                   largest USDC holder (Morpho Blue itself, read out of
#                   fork.config.json so the address is never duplicated).
#                   FORK-TRACK-ONLY FUNDING SCAFFOLDING. Never a mainnet
#                   pattern, which is exactly why it is fenced off here.
#   TARGET=mainnet  a plain transfer from the target's funded treasury key.
#                   Balances are checked first and a shortfall is fatal, so a
#                   run stops rather than half-funding an account.
#
# `amount` is wei for gas and base units for a token; either decimal or 0x.
fund_account() {
  local asset="$1" to="$2" amount="$3"
  if [ "$asset" = "gas" ]; then _fund_gas "$to" "$amount"; else _fund_token "$asset" "$to" "$amount"; fi
}

_to_dec() { case "$1" in 0x*|0X*) cast to-dec "$1" ;; *) printf '%s\n' "$1" ;; esac; }

_fund_gas() {
  local to="$1" amount="$2" want have delta from
  if [ "$IS_FORK" = "1" ]; then
    cast rpc anvil_setBalance "$to" "$amount" --rpc-url "$RPC" >/dev/null
    return 0
  fi
  want=$(_to_dec "$amount")
  have=$(cast balance "$to" --rpc-url "$RPC")
  if [ "$(echo "$have >= $want" | bc)" = "1" ]; then
    echo "  gas: $to already holds $have wei (want $want); nothing sent"
    return 0
  fi
  delta=$(echo "$want - $have" | bc)
  from=$(role_key treasury)
  cast send "$to" --value "$delta" --private-key "$from" --rpc-url "$RPC" >/dev/null
  echo "  gas: sent $delta wei to $to from the treasury"
  # Base's load-balanced RPC pool can serve a stale nonce to the NEXT `cast
  # send` if that call hits a different node than the one that just landed
  # this transaction. mine_or_wait blocks for one block (~2s on Base), which
  # is enough to propagate the incremented nonce across the pool.
  mine_or_wait
}

_fund_token() {
  local token="$1" to="$2" amount="$3" whale want from from_addr bal
  if [ "$IS_FORK" = "1" ]; then
    whale=$(cfg "$(tcfg_req .funding.token_whale_config_path)")
    cast rpc anvil_impersonateAccount "$whale" --rpc-url "$RPC" >/dev/null
    cast rpc anvil_setBalance "$whale" "$(tcfg_req .funding.impersonation_gas_wei)" --rpc-url "$RPC" >/dev/null
    cast send "$token" "transfer(address,uint256)(bool)" "$to" "$amount" \
      --from "$whale" --unlocked --rpc-url "$RPC" >/dev/null
    cast rpc anvil_stopImpersonatingAccount "$whale" --rpc-url "$RPC" >/dev/null
    return 0
  fi
  want=$(_to_dec "$amount")
  from=$(role_key treasury)
  from_addr=$(cast wallet address --private-key "$from")
  bal=$(cast call "$token" 'balanceOf(address)(uint256)' "$from_addr" --rpc-url "$RPC" | awk '{print $1}')
  [ "$(echo "$bal >= $want" | bc)" = "1" ] \
    || { echo "FATAL: treasury $from_addr holds $bal of token $token, needs $want; top it up before rerunning" >&2; exit 1; }
  cast send "$token" "transfer(address,uint256)(bool)" "$to" "$want" \
    --private-key "$from" --rpc-url "$RPC" >/dev/null
  echo "  token: transferred $want of $token to $to from the treasury"
}

mkdir -p "$STATE_DIR"
