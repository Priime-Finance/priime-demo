# priime-demo, The onchain vault structuring platform

Compose, test, Scale and distribute vaults, in one verifiable venue.

Problem.
A vault has an infrastructure problem: a smart contract cannot react to markets, and it cannot compute the math a strategy needs, so the work that actually operates a vault sits on private servers, and that breaks composability, growth and trust.

Solution.
Priime is where a strategy becomes a verifiable, automated onchain vault. A strategy is composed on a canvas, backtested and launched as a vault, and the off-chain work it needs runs as decentralized compute on the Trustless Execution Network.

At ETHOnline we built the first strategy on Priime Build, composed from its first modules, with a floor and a router between its lanes.

Discover all hackathon demo info here: https://priime.finance/ETHOnline-Priime-Hackathon

## Uniswap V3 integration

The vault swaps USDe ↔ USDC through **Uniswap V3** on Base. The integration is:

- **Router interface**: [`contracts/src/interfaces/external/IUniswapV3SwapRouter02.sol`](contracts/src/interfaces/external/IUniswapV3SwapRouter02.sol)
- **On-chain swap call**: [`contracts/src/PriimeVault.sol::onMorphoFlashLoan`](contracts/src/PriimeVault.sol) (the `IUniswapV3SwapRouter02(swapRouter).exactInputSingle(...)` block inside the Morpho flashloan callback)
- **Selector whitelist**: [`contracts/src/PriimeVault.sol::_validatePlanStep`](contracts/src/PriimeVault.sol) pins `swapRouter` to `IUniswapV3SwapRouter02.exactInputSingle.selector` and decodes `ExactInputSingleParams` to enforce `recipient == address(this)`, so a compromised operator quorum cannot route the swap output anywhere but back to the vault.
- **Off-chain plan builders** (Rust `wasm32-wasip2`): [`components/vault-nav/src/nav.rs::plan_open_position`](components/vault-nav/src/nav.rs) and [`components/vault-nav/src/nav.rs::plan_redeem_collateral`](components/vault-nav/src/nav.rs) emit `exactInputSingle` calldata via the `alloy` `sol!` binding of `UniswapV3ExactInputSingleParams`.
- **Deployment config**: [`deploy/fork.config.json::swap_route`](deploy/fork.config.json) pins Base's `SwapRouter02` (`0x2626664c2603336E57B271c5C0b26F421741e481`), factory (`0x33128a8fC17869897dcE68Ed026d694621f6FDfD`) and the deep 0.05% USDe/USDC pool (`0xedAf6Ca46FB852D4AB0A2e9449d267cf03213F05`).

The vault is chain-agnostic: `SwapRouter02` is deployed at the same interface on every chain Uniswap V3 supports (Ethereum, Optimism, Arbitrum, Polygon, BNB, Avalanche, and more). Swap the three addresses in `deploy/fork.config.json` and redeploy.

Feedback on the developer experience of integrating Uniswap V3: see [FEEDBACK.md](FEEDBACK.md).

## The Graph integration

The vault's on-chain event history is indexed by an in-repo subgraph deployed to Subgraph Studio, and served over GraphQL to the replay UI so the strike ledger, per-day rollups and plan-execution history all come from an independent indexer instead of an RPC scan. The subgraph follows the ERC-4626 / Messari Standardized Vault shape, so the same query pattern works against any ERC-4626 vault indexed under the same conventions.

- **Subgraph package**: [`packages/subgraph/`](packages/subgraph/) — schema, mappings, manifest.
- **Standardized schema**: [`packages/subgraph/schema.graphql`](packages/subgraph/schema.graphql) — `Vault`, `VaultDailyMetric`, `VaultDepositRequest`, `VaultRedeemRequest`, `DepositFulfilled`, `RedeemFulfilled` follow ERC-4626 conventions; `Strike`, `PlanExecution`, `PlanRejection`, `Deleverage`, `ExecuteCall` are Priime-specific extensions covering the operator quorum's NAV attestation and quorum-signed strategy plans.
- **AssemblyScript mappings**: [`packages/subgraph/src/priime-vault.ts`](packages/subgraph/src/priime-vault.ts) — one handler per event, rolling up `Vault` counters plus a day-bucketed `VaultDailyMetric`.
- **Deployed endpoint (Subgraph Studio)**: `https://api.studio.thegraph.com/query/1755125/priime-demo/v0.0.2` — every factory-deployed vault is indexed on the next block after `VaultCreated` via a `PriimeVaultInstance` template, no subgraph redeploy per new vault.
- **UI consumer**: [`apps/replay-ui/lib/vaults/subgraph.ts`](apps/replay-ui/lib/vaults/subgraph.ts) fetches the vault snapshot; [`apps/replay-ui/components/vaults/SubgraphPanel.tsx`](apps/replay-ui/components/vaults/SubgraphPanel.tsx) renders it inside the vault page as an "Indexed by The Graph" panel that polls every 30 s.
- **Subgraph MCP**: [`packages/subgraph/SKILL.md`](packages/subgraph/SKILL.md) — a SKILL config that layers the Subgraph MCP on top of the deployed subgraph so an MCP-aware agent (Claude Desktop, Cursor, ChatGPT) can query the vault in natural language. That composes a second Graph product on the same schema.

## Layout

```
components/
  hello-nav/          # operator component (priime:operator@3.0.0), returns nav=42
  hello-aggregator/   # aggregator component (priime:aggregator@3.0.0), submits to the handler
  vault-nav/          # operator component (priime-vault-nav): prices a real loop's NAV
contracts/
  src/HelloNavHandler.sol   # M1 handler: validates operator sigs, records the attested NAV
  src/PriimeVault.sol       # live-loop handler, one per deployed loop; strategist holds the exit key
  src/MockServiceManager.sol, src/interfaces/
deploy/
  deploy.sh           # M1 only: one command, build -> deploy -> cron fires -> result on-chain
  fork.sh, vault-service.sh, enter-loop.sh, run-live-demo.sh, target.sh   # the live demo; see docs/LIVE_DEMO.md
schema/
  journal.v1.schema.json    # frozen backend/frontend seam (JSON Schema 2020-12), source of truth
  samples/                  # honest + sabotage journal fixtures
crates/journal/       # Rust serde types for the journal (deny_unknown_fields)
packages/journal-schema/    # TypeScript types + re-exported schema
packages/loop-deploy/       # loop control-plane library: service.json mutation, handler deploys, loop registry
apps/loop-server/           # authenticated HTTP API deploying user loops as workflows (see its README)
apps/replay-ui/             # Next.js frontend: the build canvas, the vault pages (see its README)
```

Each component has its own README explaining what it does and why. This top-level README covers the M1 hello-world pipeline below, the minimal path through Priime. For the fuller demo (compose a loop in the browser, publish it, watch real attested strikes land on a live `PriimeVault`), see `docs/LIVE_DEMO.md`.

## Sepolia deployment (already live)

A real Morpho market is deployed on Ethereum Sepolia (chain 11155111) and is what `TARGET=sepolia` points at. Nothing needs to be re-created; the addresses below are committed as the source of truth in `packages/loop-deploy/src/catalog.ts` (`USDE_USDC_MORPHO_SEPOLIA`) and `deploy/sepolia.config.json` (`morpho.market`).

| What | Address |
| --- | --- |
| Ethena USDe (real, canonical Sepolia) | `0x9458caaca74249abbe9e964b3ce155b98ec88ef2` |
| Circle USDC (real, canonical Sepolia) | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| Morpho Blue (real) | `0xd011EE229E7459ba1ddd22631eF7bF528d424A14` |
| MorphoChainlinkOracleV2 (ours, 1:1 stub) | `0x1fC32D70B1B6F85c4dbc2F0626C9e558BD2a1bE2` |
| Morpho market id (ours, 91.5% LLTV) | `0xee461cf86148c9e0e17c2bca906a4e7ff62bab1ff3334d20e82dd9672a899cb3` |

Created 2026-09-09 by `0x03F3c4B41d839846A13841506297a567a3ebBa7a` via `deploy/sepolia-setup.sh`. `oracle.price()` returns exactly `1e24` (1:1), `Morpho.idToMarketParams(id)` returns the four addresses plus 91.5% LLTV.

To reproduce or port to another testnet, see `deploy/sepolia-setup.sh` (idempotent). The normal demo path does not need to run it.

## Base mainnet deployment (live)

`TARGET=mainnet` runs against Base itself (chain 8453). The mainnet stack is deployed and attesting. Every user-facing vault deploys through a factory, so publishing a new loop through the composer emits `VaultCreated` and the subgraph auto-indexes the new address on the next block.

| What | Address |
| --- | --- |
| `PriimeVaultFactory` (ours) | `0xa3cbA56ECC2F6684abf3D5a0Fd2C93D030849aBF` (deployed at block `51230370`) |
| Service manager (ours) | `0x23d382E3c6b1625B0021d5ef291DBd12995cDf00` |
| Ethena USDe (real) | `0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34` |
| Circle USDC (real) | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Morpho Blue (real) | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` |
| AdaptiveCurveIRM (real) | `0x46415998764C29aB2a25CbeA6254146D50D22687` |
| Morpho market id (real, USDe/USDC 91.5% LLTV) | `0x54cf9be57fdfa6457a660991907434ff9d295c465a603a50126ff647d50b7354` |
| Market oracle (real, Chainlink-backed timelock) | `0xF4b17C79492d68775e22e8Dd0a2Bb22854A39A47` |
| Uniswap V3 USDe/USDC pool (real, entry leg) | `0xedAf6Ca46FB852D4AB0A2e9449d267cf03213F05` |
| Uniswap V3 SwapRouter02 (real) | `0x2626664c2603336E57B271c5C0b26F421741e481` |

### Factory deploy model

`contracts/src/PriimeVaultFactory.sol` owns the single "point at me" pin for the subgraph. Every vault deployment routes through `factory.deployVault(serviceManager, asset, strategist, strategy)`, which emits `VaultCreated(vault, strategist, serviceManager, asset, collateralToken, block)`. `packages/subgraph/subgraph.yaml` treats the factory as a data source and spawns a `PriimeVaultInstance` template per `VaultCreated`, so publishing a new loop through the composer surfaces on the subgraph endpoint the next block without a subgraph redeploy.

The factory address is persisted in `deploy/.mainnet/factory.json` and reused across re-runs; `packages/subgraph/scripts/sync-factory.sh` copies it into `networks.json` before `pnpm deploy`.

### Safety rails on the loop server

Two guards land at `POST /loops` and `DELETE /loops/:id` to keep testers from footgunning themselves:

- **Pool preflight** (`packages/loop-deploy/src/chain.ts::verifyUniswapV3Pool`). One `slot0()` call against the resolved pool address before any DB row or IPFS pin lands. Rejects with `400` if the ABI decode does not match the 7-word Uniswap V3 shape (Aerodrome CL forks return 6 words).
- **Pause guard** (`packages/loop-deploy/src/deployer.ts::PauseGuardError`). `DELETE /loops/:id` reads `totalPendingDepositAssets` and `totalPendingRedeemShares` off the vault before removing the workflow. Non-zero on either side → `409` with the pending amounts, so hitting pause on a vault mid-cycle cannot strand the depositor's escrow. The corresponding button is not exposed in the replay-ui vault page (`apps/replay-ui/components/vaults/LiveLoopDetail.tsx`); the guard defends the API regardless of client.

### Running the mainnet demo end to end

```bash
# 1. Fill .env.mainnet at the repo root (gitignored via .env.*). Required:
#    PRIIME_RPC_URL          - keyed provider URL, server-side only
#    PRIIME_PUBLIC_RPC_URL   - browser-facing RPC (e.g. https://mainnet.base.org)
#    PRIIME_OWNER_KEY        - manager owner + factory deployer
#    PRIIME_STRATEGIST_KEY   - vault strategist (Priime independent exit)
#    PRIIME_DEPOSITOR_KEY    - demo depositor
#    PRIIME_TREASURY_KEY     - funds the three operator EOAs
#    LOOP_SERVER_TOKEN       - openssl rand -hex 24

# 2. Bring up the service (POA manager + factory + template vault + 3 nodes).
#    First run deploys the factory; subsequent runs reuse it via factory.json.
env $(grep -v '^#' .env.mainnet | xargs) TARGET=mainnet bash deploy/vault-service.sh

# 3. Sync factory address into the subgraph and (re)deploy to Studio.
cd packages/subgraph
pnpm install
pnpm sync-factory       # reads deploy/.mainnet/factory.json, writes networks.json
pnpm build && pnpm deploy
cd -

# 4. Start loop-server + replay-ui.
env $(grep -v '^#' .env.mainnet | xargs) TARGET=mainnet bash deploy/run-live-demo.sh

# 5. In the browser: /build to publish a fresh vault through the composer
#    (goes through the factory), or /vaults/loop-<id> for any existing loop.
#    The SubgraphPanel on the vault page pulls from Studio and updates on
#    every block; the strike ledger lands within one cron interval.
```

`docs/LIVE_DEMO.md` has the four-target reference (fork/sepolia/mainnet) and target-selector semantics.


## M1: hello-world through the full Priime pipeline (on anvil)

A hello-world component through the whole pipeline: scaffold, build, deploy, a cron trigger fires, and the result lands in a handler contract on-chain.

### Prerequisites

Two long-running services (separate terminals):

```bash
anvil --host 0.0.0.0 --block-time 1     # chainId 31337 on :8545 (0.0.0.0 so containers can reach it)
ipfs daemon                             # gateway :8080, api :5001
```

Also required: Foundry (`anvil`/`cast`/`forge`), Rust with the `wasm32-wasip2` target (pinned in `rust-toolchain.toml`), and these Docker images:

```
ghcr.io/priime-finance/priime:3.0.0
ghcr.io/lay3rlabs/poa-middleware:1.0.1
```

### Run

```bash
bash deploy/deploy.sh
```

It builds both components, deploys the POA service manager + `HelloNavHandler`, publishes the components + service to IPFS, assembles and deploys the service (cron every 10s), registers the single operator, starts the Priime node, and waits for the first strike to land. Expected tail:

```
SUCCESS: strikeCount=1 latestNav=42
```

Inspect the running node with `docker logs priime-m1`. The script is re-runnable (fresh service manager + handler each run). It uses the well-known anvil test mnemonic; local development only.

## The journal seam (schema)

Everything downstream is decoupled by one artifact: a JSON **journal**, one record per NAV strike. The backend produces it (aggregator keyvalue + on-chain attestation readback); the frontend consumes it. It is frozen so backend and frontend can proceed in parallel.

- **Frontend / API (TS):** `import { type Journal, journalSchema } from "@priime-demo/journal-schema"` and validate with ajv against `journalSchema`.
- **Backend (Rust):** `priime_journal::Journal` (serde). `deny_unknown_fields` makes any drift from the frozen schema a test failure.

Verify all three representations agree:

```bash
cargo test -p priime-journal          # Rust types vs both samples (parse + round-trip + invariants)
npx ajv-cli@5 validate -s schema/journal.v1.schema.json \
  -d "schema/samples/*.json" --spec=draft2020 --strict=false   # JSON Schema vs samples
cd packages/journal-schema && npx -p typescript tsc --noEmit    # TS types compile
```

The schema is **frozen at v1**. Any change means a new `$id` (`journal.v2`) plus a `schema_version` bump. See `schema/README.md`.
