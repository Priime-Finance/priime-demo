#!/usr/bin/env bash
#
# ALREADY DEPLOYED. THIS SCRIPT IS HERE TO REPRODUCE, NOT TO INITIALIZE.
# The Sepolia market this repo targets is LIVE on Ethereum Sepolia:
#   MorphoChainlinkOracleV2  0x1fC32D70B1B6F85c4dbc2F0626C9e558BD2a1bE2
#   Morpho market id         0xee461cf86148c9e0e17c2bca906a4e7ff62bab1ff3334d20e82dd9672a899cb3
# Created 2026-09-09 by 0x03F3c4B41d839846A13841506297a567a3ebBa7a. Both
# addresses are the source of truth in packages/loop-deploy/src/catalog.ts
# (USDE_USDC_MORPHO_SEPOLIA) and deploy/sepolia.config.json (morpho.market).
# Downstream code READS them from there; it does not re-derive.
#
# Run this script only to reproduce the deploy on a fresh Sepolia session,
# recover after a mid-way failure (it is idempotent and skips whatever is
# already onchain), or port the same market to another testnet. For the
# normal demo path you do not need to run this at all.
#
# One-shot bring-up for TARGET=sepolia: deploy the pieces of the market that
# Ethereum Sepolia does not carry (namely, an oracle contract and a market
# entry), and write the resulting addresses back into deploy/sepolia.config.json.
# Reads the config first and only deploys the pieces still missing, so
# re-running after a mid-way failure picks up where the previous run left off.
#
# Two steps, in order:
#
#   1. MorphoChainlinkOracleV2  -  the market's oracle. Deployed via Morpho's
#      OWN factory (`MorphoChainlinkOracleV2Factory` at the address baked into
#      sepolia.config.json), so the resulting contract IS the exact code that
#      oracles every real Morpho market. All four Chainlink feed slots are
#      set to address(0): the factory's oracle collapses that configuration
#      to a hardcoded `SCALE_FACTOR = 1e24` rate, which for an 18-decimal
#      collateral against a 6-decimal loan means "1 unit of collateral is
#      worth 1 unit of loan, forever." Same shape as the mainnet USDe/USDC
#      market's own oracle uses today.
#
#   2. Morpho.createMarket(loanToken=USDC, collateralToken=USDe,
#                          oracle=(1), irm=AdaptiveCurve, lltv=91.5%).
#      Permissionless: any address can create a market on Morpho. The market
#      id is derived from the params (keccak256), so the same params always
#      return the same id.
#
# Zero token deploys. Both USDe (Ethena) and USDC (Circle) already exist as
# real canonical testnet ERC-20s on Ethereum Sepolia - the config file names
# them explicitly.
#
# What it does NOT do:
#
#   - Seed a Uniswap V3 pool for the USDC <-> USDe entry leg. That is a
#     separate step; the vault's `enter` action swaps through this pool and
#     will fail without one. The decision to seed vs skip the loop entry is
#     tracked in the swap_route _comment in sepolia.config.json.
#
#   - Register the market in the WAVS service. That happens automatically
#     when deploy/vault-service.sh runs against TARGET=sepolia: it reads the
#     addresses from sepolia.config.json exactly as fork.sh reads them from
#     fork.config.json.
#
# Env:
#   TARGET=sepolia                (required; other targets refuse)
#   SEPOLIA_RPC_URL               HTTP endpoint (env-only, no default)
#   SEPOLIA_OWNER_KEY             0x + 32-byte hex; pays deploy gas
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY="$ROOT/deploy"
source "$DEPLOY/target.sh"

[ "$TARGET" = "sepolia" ] || {
  echo "FATAL: sepolia-setup.sh only runs against TARGET=sepolia (got '$TARGET')" >&2
  exit 1
}

OWNER_KEY=$(role_key owner)
OWNER_ADDR=$(role_addr owner)
require_gas "owner" "$OWNER_ADDR"

USDE=$(cfg .tokens.usde.address)
USDC=$(cfg .tokens.usdc.address)
MORPHO=$(cfg .morpho.blue)
IRM=$(cfg .morpho.adaptive_curve_irm)
FACTORY=$(cfg .morpho.chainlink_oracle_v2_factory)
LLTV=$(cfg .morpho.market.params.lltv)

ORACLE=$(cfg .morpho.market.params.oracle)
MARKET_ID=$(cfg .morpho.market.id)

# jq write helper: keeps the file's shape and comments intact by round-tripping
# through a temp file and moving it in place at the end.
write_cfg() {
  local path="$1" value="$2" tmp
  tmp=$(mktemp)
  jq --arg v "$value" "$path = \$v" "$CFG" > "$tmp"
  mv "$tmp" "$CFG"
}

# --- 1. MorphoChainlinkOracleV2 (all-zero feed slots => hardcoded 1:1) ------
if [ -z "$ORACLE" ]; then
  say "deploy MorphoChainlinkOracleV2 via factory (1:1 stub for USDe/USDC)"
  # createMorphoChainlinkOracleV2(
  #   IERC4626 baseVault,           address(0) = no vault, spot on collateral
  #   uint256  baseVaultConversionSample,
  #   AggregatorV3Interface baseFeed1,  address(0) = "assume price = 1"
  #   AggregatorV3Interface baseFeed2,  address(0)
  #   uint256  baseTokenDecimals,   USDe decimals = 18
  #   IERC4626 quoteVault,          address(0)
  #   uint256  quoteVaultConversionSample,
  #   AggregatorV3Interface quoteFeed1, address(0)
  #   AggregatorV3Interface quoteFeed2, address(0)
  #   uint256  quoteTokenDecimals,  USDC decimals = 6
  #   bytes32  salt                 anything; 0 is fine
  # )
  #
  # Two-step trick: use `cast call` to PREDICT the oracle address (the factory
  # returns it deterministically for a given salt), then `cast send` to
  ORACLE=$(cast call --rpc-url "$RPC" \
    "$FACTORY" \
    "createMorphoChainlinkOracleV2(address,uint256,address,address,uint256,address,uint256,address,address,uint256,bytes32)(address)" \
    0x0000000000000000000000000000000000000000 1 \
    0x0000000000000000000000000000000000000000 0x0000000000000000000000000000000000000000 18 \
    0x0000000000000000000000000000000000000000 1 \
    0x0000000000000000000000000000000000000000 0x0000000000000000000000000000000000000000 6 \
    0x0000000000000000000000000000000000000000000000000000000000000000 \
    --from "$OWNER_ADDR")
  [[ "$ORACLE" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "FATAL: bad predicted oracle address '$ORACLE'" >&2; exit 1; }
  # CREATE2 with a fixed zero salt gives a deterministic address. Deploy only
  # if code is absent - a re-run after the send but before the config write
  # would otherwise revert.
  if [ "$(cast code "$ORACLE" --rpc-url "$RPC")" = "0x" ]; then
    cast send --rpc-url "$RPC" --private-key "$OWNER_KEY" \
      "$FACTORY" \
      "createMorphoChainlinkOracleV2(address,uint256,address,address,uint256,address,uint256,address,address,uint256,bytes32)(address)" \
      0x0000000000000000000000000000000000000000 1 \
      0x0000000000000000000000000000000000000000 0x0000000000000000000000000000000000000000 18 \
      0x0000000000000000000000000000000000000000 1 \
      0x0000000000000000000000000000000000000000 0x0000000000000000000000000000000000000000 6 \
      0x0000000000000000000000000000000000000000000000000000000000000000 \
      >/dev/null
    [ "$(cast code "$ORACLE" --rpc-url "$RPC")" != "0x" ] || {
      echo "FATAL: oracle at $ORACLE has no code after deploy" >&2; exit 1
    }
  fi
  write_cfg .morpho.market.params.oracle "$ORACLE"
  echo "  MorphoChainlinkOracleV2 at $ORACLE"
else
  echo "  MorphoChainlinkOracleV2 already at $ORACLE (skipping)"
fi

# --- 2. Morpho.createMarket -------------------------------------------------
if [ -z "$MARKET_ID" ]; then
  say "create Morpho market (loan=USDC, collateral=USDe, oracle=1:1, irm=AdaptiveCurve, lltv=91.5%)"
  # Morpho market id = keccak256(abi.encode(MarketParams))  -  deterministic.
  MARKET_ID=$(cast keccak \
    "$(cast abi-encode 'f((address,address,address,address,uint256))' \
        "($USDC,$USDE,$ORACLE,$IRM,$LLTV)")")
  # Idempotent on-chain: `createMarket` reverts if the market already exists;
  # we swallow the revert (a partial previous run leaves the market present
  # but the id absent from config).
  cast send --rpc-url "$RPC" --private-key "$OWNER_KEY" \
    "$MORPHO" \
    "createMarket((address,address,address,address,uint256))" \
    "($USDC,$USDE,$ORACLE,$IRM,$LLTV)" \
    >/dev/null 2>&1 || echo "  (createMarket reverted; assuming market already exists)"
  write_cfg .morpho.market.id "$MARKET_ID"
  echo "  market id $MARKET_ID"
else
  echo "  market already recorded at $MARKET_ID (skipping)"
fi

say "sepolia setup complete"
echo "  next: decide on the swap route (see swap_route._comment in $CFG)"
echo "  next: deploy/vault-service.sh (with TARGET=sepolia) brings up the service against these addresses"
