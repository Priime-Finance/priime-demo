# priime-demo

Monorepo for the **verifiable vaults** demo: *the vault that cannot lie about its NAV*.

Three independent operators re-execute a NAV computation, agree on identical
result hashes, reach quorum, and attest the number on-chain. Corrupt one
operator and its lie is rejected while the honest quorum settles the truth.

## Layout

```
components/
  hello-nav/          # operator component (wavs:operator@2.7.0), returns nav=42
  hello-aggregator/   # aggregator component (wavs:aggregator@2.7.0), submits to the handler
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

Each component has its own README explaining what it does and why. This
top-level README covers the M1 hello-world pipeline below, the minimal path
through WAVS. For the fuller demo (compose a loop in the browser, publish
it, watch real attested strikes land on a live `PriimeVault`), see
`docs/LIVE_DEMO.md`.

## Sepolia deployment (already live)

A real Morpho market is deployed on Ethereum Sepolia (chain 11155111) and
is what `TARGET=sepolia` points at. Nothing needs to be re-created; the
addresses below are committed as the source of truth in
`packages/loop-deploy/src/catalog.ts` (`USDE_USDC_MORPHO_SEPOLIA`) and
`deploy/sepolia.config.json` (`morpho.market`).

| What | Address |
| --- | --- |
| Ethena USDe (real, canonical Sepolia) | `0x9458caaca74249abbe9e964b3ce155b98ec88ef2` |
| Circle USDC (real, canonical Sepolia) | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| Morpho Blue (real) | `0xd011EE229E7459ba1ddd22631eF7bF528d424A14` |
| MorphoChainlinkOracleV2 (ours, 1:1 stub) | `0x1fC32D70B1B6F85c4dbc2F0626C9e558BD2a1bE2` |
| Morpho market id (ours, 91.5% LLTV) | `0xee461cf86148c9e0e17c2bca906a4e7ff62bab1ff3334d20e82dd9672a899cb3` |

Created 2026-09-09 by `0x03F3c4B41d839846A13841506297a567a3ebBa7a` via
`deploy/sepolia-setup.sh`. `oracle.price()` returns exactly `1e24` (1:1),
`Morpho.idToMarketParams(id)` returns the four addresses plus 91.5% LLTV.

To reproduce or port to another testnet, see `deploy/sepolia-setup.sh`
(idempotent). The normal demo path does not need to run it.

## Base mainnet deployment (planned)

`TARGET=mainnet` points at Base itself (chain 8453). Zero deployment work
on our side: every address the vault reads is already live and is the same
contract that has attested the mainnet USDe/USDC market for months. The
deploy scripts stand up the POA service manager and per-loop PriimeVault
handlers on top; the market itself is unchanged.

| What | Address |
| --- | --- |
| Ethena USDe (real) | `0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34` |
| Circle USDC (real) | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Morpho Blue (real) | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` |
| AdaptiveCurveIRM (real) | `0x46415998764C29aB2a25CbeA6254146D50D22687` |
| Morpho market id (real, USDe/USDC 91.5% LLTV) | `0x54cf9be57fdfa6457a660991907434ff9d295c465a603a50126ff647d50b7354` |
| Market oracle (real, Chainlink-backed timelock) | `0xF4b17C79492d68775e22e8Dd0a2Bb22854A39A47` |
| Aerodrome USDe/USDC pool (real, entry leg) | `0x15BC08D2E2B405afeD3fB872DCd2d962BcCfB7e0` |

To run: fill in `.env.mainnet` (see the template at the repo root) with
`PRIIME_RPC_URL`, the four `PRIIME_*_KEY` role keys and a `LOOP_SERVER_TOKEN`,
then `env $(grep -v '^#' .env.mainnet | xargs) TARGET=mainnet deploy/vault-service.sh`.
Same script the fork uses. See `docs/LIVE_DEMO.md` for the full pipeline.

## M1: hello-world through the full WAVS pipeline (on anvil)

A hello-world component through the whole pipeline: scaffold, build, deploy, a
cron trigger fires, and the result lands in a handler contract on-chain.

### Prerequisites

Two long-running services (separate terminals):

```bash
anvil --host 0.0.0.0 --block-time 1     # chainId 31337 on :8545 (0.0.0.0 so containers can reach it)
ipfs daemon                             # gateway :8080, api :5001
```

Also required: Foundry (`anvil`/`cast`/`forge`), Rust with the `wasm32-wasip2`
target (pinned in `rust-toolchain.toml`), and these Docker images:

```
ghcr.io/lay3rlabs/wavs:2.0.0-vault-rc.15
ghcr.io/lay3rlabs/poa-middleware:1.0.1
```

### Run

```bash
bash deploy/deploy.sh
```

It builds both components, deploys the POA service manager + `HelloNavHandler`,
publishes the components + service to IPFS, assembles and deploys the service
(cron every 10s), registers the single operator, starts the WAVS node, and waits
for the first strike to land. Expected tail:

```
SUCCESS: strikeCount=1 latestNav=42
```

Inspect the running node with `docker logs wavs-m1`. The script is re-runnable
(fresh service manager + handler each run). It uses the well-known anvil test
mnemonic; local development only.

## The journal seam (schema)

Everything downstream is decoupled by one artifact: a JSON **journal**, one
record per NAV strike. The backend produces it (aggregator keyvalue + on-chain
attestation readback); the frontend consumes it. It is frozen so backend and
frontend can proceed in parallel.

- **Frontend / API (TS):** `import { type Journal, journalSchema } from "@priime-demo/journal-schema"` and validate with ajv against `journalSchema`.
- **Backend (Rust):** `priime_journal::Journal` (serde). `deny_unknown_fields` makes any drift from the frozen schema a test failure.

Verify all three representations agree:

```bash
cargo test -p priime-journal          # Rust types vs both samples (parse + round-trip + invariants)
npx ajv-cli@5 validate -s schema/journal.v1.schema.json \
  -d "schema/samples/*.json" --spec=draft2020 --strict=false   # JSON Schema vs samples
cd packages/journal-schema && npx -p typescript tsc --noEmit    # TS types compile
```

The schema is **frozen at v1**. Any change means a new `$id` (`journal.v2`) plus
a `schema_version` bump. See `schema/README.md`.
