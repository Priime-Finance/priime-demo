# FEEDBACK.md

Feedback on integrating Uniswap V3 into `PriimeVault`, the async ERC-7540
vault the operator quorum in this repo attests NAV for.

Context: `PriimeVault` runs a recursive USDe/USDC loop on Morpho Blue. Every
strike, three independent operators re-execute a NAV computation, agree on
one result hash, and land the attestation on Base. The vault swaps USDe →
USDC through a pinned pool inside its own `onMorphoFlashLoan` callback so
the whole delever step is atomic. We swapped that leg from Aerodrome
Slipstream (a Uniswap V3 fork) to Uniswap V3 proper.

## Where the integration lives

- **Router interface**: `contracts/src/interfaces/external/IUniswapV3SwapRouter02.sol`
- **On-chain call site**: `contracts/src/PriimeVault.sol::onMorphoFlashLoan`,
  the `IUniswapV3SwapRouter02(swapRouter).exactInputSingle(...)` call
- **Plan-step validator**: `contracts/src/PriimeVault.sol::_validatePlanStep`,
  where the `(target, selector)` whitelist pins `swapRouter` to
  `IUniswapV3SwapRouter02.exactInputSingle.selector` and decodes the
  `ExactInputSingleParams` to enforce `recipient == address(this)`
- **Off-chain plan builders** (Rust, `wasm32-wasip2` component):
  `components/vault-nav/src/nav.rs::plan_open_position` and
  `components/vault-nav/src/nav.rs::plan_redeem_collateral`, both emit
  `exactInputSingle` calldata via the `alloy` `sol!` binding of
  `UniswapV3ExactInputSingleParams`
- **Deployment config**: `deploy/fork.config.json::swap_route` names the
  Base V3 SwapRouter02 (`0x2626664c2603336E57B271c5C0b26F421741e481`),
  factory (`0x33128a8fC17869897dcE68Ed026d694621f6FDfD`), the deep 0.05%
  USDe/USDC pool (`0xedAf6Ca46FB852D4AB0A2e9449d267cf03213F05`), and fee
  tier `500`

## What went well

1. **`ExactInputSingleParams` is the same on every V3 deployment.** Once the
   Solidity struct + `sol!` binding matched, the vault picked up the new
   router by swapping one immutable in the config. The `_validatePlanStep`
   selector-and-decode check moved over unchanged shape-wise.
2. **SwapRouter02's dropped `deadline` field simplified the callback ABI.**
   We keep a reserved slot in the callback payload for wire-format
   stability, but the vault contract stopped needing to thread a deadline
   through the delever plan.
3. **On-chain sanity readable via `IUniswapV3Factory.getPool`.** Checking
   the pool address from `(tokenA, tokenB, fee)` in a shell one-liner is
   the cleanest developer flow we've had for pinning a swap route across
   the four common fee tiers.
4. **The 0.05% USDe/USDC pool on Base is deep (~$1M in-range) —
   we didn't have to switch to a routed multi-hop path.** Universal Router
   would have added permit2 + `execute(commands, inputs)` decoding on top
   of what SwapRouter02 gives us; for a single-hop route, sticking with
   SwapRouter02 kept the on-chain surface small.

## Rough edges we hit

1. **`slot0()` ABI differs between V3 and its forks by one word.**
   Aerodrome Slipstream drops V3's `feeProtocol` field (7 words → 6). Our
   Rust-side `sol!` binding for the pool had been written against
   Aerodrome; migrating to V3 meant adding `uint8 feeProtocol` between
   `observationCardinalityNext` and `bool unlocked`. Easy to fix, easy to
   miss — a docs page comparing the pool ABI diffs across the popular V3
   forks would be nice.
2. **SwapRouter02 has no `deadline` in the per-swap params but the older
   `SwapRouter` (v1) does.** Both are documented as "V3 router" in
   third-party material; only the docs.uniswap.org deployment index makes
   the distinction. We had to reverse a "which router am I looking at"
   moment from `cast sig` selector matching.
3. **Universal Router's chain-agnostic story is stronger than
   SwapRouter02's**, but the API is heavier (`Commands` byte constants,
   `Inputs[]`, permit2 wiring). For a single-hop AMM leg where we already
   want deterministic bytes for the operator-quorum hash, SwapRouter02 was
   the right cut. Documenting when to pick which would help.
4. **Fee tier is a naked `uint24`.** Passing `500` when we meant `500`
   basis-points-of-a-million (0.05%) is a slot people trip on. A named
   `FeeTier` enum in `@uniswap/v3-periphery` bindings would help — or at
   least a docs table right next to the router ABI.

## Would-be-nice

- **A Foundry cheat that quotes `exactInputSingle` off a pinned block
  without invoking the router.** Right now we simulate through the router;
  a `IUniswapV3Quoter::quoteExactInputSingle` would give us the same
  slippage floor in the plan builder without sending the tx.
- **Subgraph fixtures for USDe/USDC on Base** so tests can pin against a
  known price range without hitting live RPC.

Repo: https://github.com/Priime-Finance/priime-demo
Chain(s) shipped on: Base (chain id 8453). The `SwapRouter02`, factory
addresses and interface are the same on every V3 deployment, so the vault
works chain-agnostically — swap the three addresses in
`deploy/fork.config.json` and redeploy.
