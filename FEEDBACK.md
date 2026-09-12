# FEEDBACK.md

Feedback on integrating Uniswap V3 into `PriimeVault`, the async ERC-7540
vault the operator quorum in this repo attests NAV for.

Context: `PriimeVault` runs a recursive USDe/USDC loop on Morpho Blue.
Every strike, three independent operators re-execute a NAV computation,
agree on one result hash, and land the attestation on Base. The vault
swaps USDe → USDC through a pinned Uniswap V3 pool inside its own
`onMorphoFlashLoan` callback so the whole delever step is atomic.

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

1. **`ExactInputSingleParams` is the same on every V3 deployment.** The
   Solidity struct and the alloy `sol!` binding line up cleanly, and the
   vault picks up its swap route from a single immutable in the config.
   The `_validatePlanStep` selector-and-decode check treats the router
   as a plain V3 target.
2. **SwapRouter02's callback ABI is compact.** No `deadline` in the
   per-swap params means one fewer field to thread through the operator
   quorum's plan payload. The vault keeps a reserved word in the
   callback data for wire-format stability so plan builders can be
   upgraded independently of on-chain contracts.
3. **On-chain sanity readable via `IUniswapV3Factory.getPool`.** Checking
   the pool address from `(tokenA, tokenB, fee)` in a shell one-liner is
   the cleanest developer flow we've had for pinning a swap route across
   the four common fee tiers.
4. **The 0.05% USDe/USDC pool on Base is deep (~$1M in-range).** A
   single-hop route was enough; we didn't have to reach for Universal
   Router's `execute(commands, inputs)` decoding or a permit2 flow to
   get useful liquidity.

## Rough edges we hit

1. **SwapRouter02 vs the older SwapRouter (v1) are documented ambiguously
   across third-party material.** Only the docs.uniswap.org deployments
   index makes the per-swap `deadline` difference explicit. We had to
   reverse a "which router am I looking at" moment from `cast sig`
   selector matching before we could trust the ABI.
2. **Universal Router's chain-agnostic story is stronger than
   SwapRouter02's**, but the API is heavier (`Commands` byte constants,
   `Inputs[]`, permit2 wiring). For a single-hop AMM leg where we
   already want deterministic bytes for the operator-quorum hash,
   SwapRouter02 is the right cut. Documenting when to pick which would
   help.
3. **Fee tier is a naked `uint24`.** Passing `500` when we mean 0.05%
   (`500 / 1e6`) is a slot people trip on. A named `FeeTier` enum in
   `@uniswap/v3-periphery` bindings would help — or at least a docs
   table right next to the router ABI.
4. **V3 pool `slot0()` returns seven words on the canonical Uniswap
   deployment.** Our Rust-side alloy `sol!` binding names each word
   explicitly (`sqrtPriceX96`, `tick`, `observationIndex`,
   `observationCardinality`, `observationCardinalityNext`, `feeProtocol`,
   `unlocked`). A canonical `IUniswapV3PoolState` alloy crate would save
   every integrator from re-typing this.

## Would-be-nice

- **A Foundry cheat that quotes `exactInputSingle` off a pinned block
  without invoking the router.** Right now we simulate through the
  router; a `IUniswapV3Quoter::quoteExactInputSingle` binding usable
  from the plan builder would give us the same slippage floor without
  sending the tx.
- **Subgraph fixtures for USDe/USDC on Base** so tests can pin against
  a known price range without hitting live RPC.

Repo: https://github.com/Priime-Finance/priime-demo
Chain(s) shipped on: Base (chain id 8453). SwapRouter02, factory
addresses and interface are the same on every V3 deployment, so the
vault runs chain-agnostically — the three addresses in
`deploy/fork.config.json` are the only per-chain input.
