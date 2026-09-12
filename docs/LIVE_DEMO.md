# Live demo: publish a loop from the composer

End to end walkthrough of the local demo: a user opens `/build`, composes a vault on the canvas, hits **Publish vault** with a connected wallet, and watches real attested strikes land on their own handler within seconds. No curl anywhere.

Every script under `deploy/` resolves a deploy **target** first (`TARGET`, default `fork`); see "Deploy target" below. Unless a step says otherwise, this walkthrough describes `TARGET=fork`, the default and the only target that needs no environment setup.

## What runs

| Layer | Where | What it does |
| --- | --- | --- |
| Chain | `deploy/fork.sh` (`TARGET=fork` only) | Pinned Base mainnet fork on `:8545`, real Morpho USDe/USDC market at block 49911282. Under `TARGET=mainnet` there is no chain to start; the scripts talk to Base itself. |
| Priime service | `deploy/vault-service.sh` | Deploys the POA service manager + `PriimeVault`, publishes the vault-nav wasm to IPFS, starts the `priime-vault` node, waits for the first cron strike. |
| Loop server | `apps/loop-server` (Node HTTP) | Holds the manager owner key. Resolves the composer's `candidateId` against `packages/loop-deploy/src/catalog.ts`, deploys a new handler + workflow on demand, and derives Journal-shaped records from on chain state for the frontend. |
| Replay UI | `apps/replay-ui` (Next.js) | The `/build` canvas composes the vault; the `Review & publish` modal POSTs to the loop server through `/api/loops`. A published loop is reachable at `/vaults/loop-xxxxxxxx` (see `apps/replay-ui/lib/vaults/live-id.ts`), where `VaultDetail` shows the attested strike ledger. |
| IPFS | `ipfs daemon` | Hosts the pinned `service.json`. |

## Deploy targets: `fork`, `sepolia`, `mainnet`

`deploy/target.sh` (sourced by every script in `deploy/`) resolves `TARGET` against `deploy/targets/$TARGET.json`. Three targets exist; an unknown `TARGET` is rejected by name.

- `TARGET=fork` (default): anvil fork of Base at a pinned block. Chain 31337. Everything cheat-coded and free. The market, tokens and strategy parameters come from `deploy/fork.config.json`.
- `TARGET=sepolia`: real Ethena USDe and Circle USDC on Morpho Blue, Ethereum Sepolia (chain 11155111). The Morpho market is ALREADY DEPLOYED (id `0xee461cf8...9cb3`, oracle `0x1fC32D70...1bE2`, see the root README or `packages/loop-deploy/src/catalog.ts::USDE_USDC_MORPHO_SEPOLIA`); `deploy/sepolia-setup.sh` exists only to reproduce or port that deploy. The market, tokens and strategy parameters come from `deploy/sepolia.config.json`.
- `TARGET=mainnet`: Base itself, chain 8453. Real money; nothing defaulted. Shares `deploy/fork.config.json` with the fork target because the fork IS Base at a pinned block.

**`TARGET=fork` (the default).** An anvil fork of Base mainnet at the block pinned in `fork.config.json`, served on chain id `31337`, `:8545` by default (override with `FORK_PORT`). Needs no environment variables:
- Keys come from the well-known, worthless anvil mnemonic (override with `FORK_MNEMONIC`); the account-index-to-role map is `owner=0`, `strategist=4`, `depositor=5`, `treasury=0` (unused, since funding on the fork doesn't go through a treasury).
- Funding is cheat codes: `anvil_setBalance` conjures ETH, and USDC is taken by impersonating Morpho Blue (the pinned block's largest USDC holder). These cheat codes exist only behind `TARGET=fork`.
- Blocks are forced with `anvil_mine`; the strike cadence is every 10 seconds.
- The fork's own upstream RPC (what it forks *from*) defaults to `https://mainnet.base.org`; override with `BASE_RPC_URL` if you need a different upstream provider.
- Per-run artifacts land in `deploy/.fork/` (logs in `deploy/.fork/live-demo/*.log`).

**`TARGET=mainnet`.** Base itself, chain id `8453`. **Defaults nothing** and fails loudly, per-variable, the moment something required is missing (`deploy/target.sh`'s `required_env`, mirroring `required()` in `apps/loop-server/src/env.ts`):
- `PRIIME_RPC_URL` (required): the RPC endpoint scripts and the loop server sign and send through. Likely carries a provider API key in its path, so it is never sent to the browser.
- `PRIIME_PUBLIC_RPC_URL` (required, separate from the above): the browser-facing RPC URL `run-live-demo.sh` hands to the frontend as `NEXT_PUBLIC_RPC_URL`. Kept distinct so a keyed URL never reaches the client.
- `PRIIME_OWNER_KEY`, `PRIIME_STRATEGIST_KEY`, `PRIIME_DEPOSITOR_KEY`, `PRIIME_TREASURY_KEY` (all required): one 0x-prefixed private key each for the four roles. They may be four distinct keys or fewer; that's an operational choice the scripts don't make for you.
- `LOOP_SERVER_TOKEN` (required): `run-live-demo.sh`'s `demo-token-...` default is fork-only; a live run must supply its own bearer token (`openssl rand -hex 24`).
- `.env.mainnet` at the repo root holds every required variable in one file, gitignored via the `.env.*` rule. Copy from the template committed in the tree and fill in the blanks; then `env $(grep -v '^#' .env.mainnet | xargs) TARGET=mainnet deploy/vault-service.sh`.
- Funding is a real transfer from the treasury key, balance-checked first; a shortfall is fatal rather than silently short-funding an account. Blocks are real; the scripts poll for one rather than forcing it. The strike cadence is `0 * * * * *` (once per minute), a UX pick rather than a cost cap; Base gas per strike is a fraction of a cent, so cadence choices land in the ~$1/day range at 60s or ~$7/day at 10s. See `deploy/targets/mainnet.json` for the tradeoff comment.
- Per-run artifacts land in `deploy/.mainnet/`.
- `deploy/deploy.sh` (the top-level M1 hello-world pipeline in the repo README) refuses `TARGET=mainnet` outright: its `priime.toml` wants one shared signing mnemonic, which only a mnemonic-backed target (`fork`) has.

`TARGET=mainnet` moves real money and has not been exercised end to end in this repo; see "Known limits" below. Treat it accordingly.

## Script

```bash
bash deploy/run-live-demo.sh
# or, against Base:
TARGET=mainnet bash deploy/run-live-demo.sh
```

Reruns bring up a fresh manager and vault, restart the two node servers, and reuse a running IPFS daemon when one is already up. Logs go to `deploy/.<target>/live-demo/*.log` (`deploy/.fork/...` under the default `TARGET=fork`, `deploy/.mainnet/...` under `TARGET=mainnet`). Set `OPEN_BROWSER=0` to skip the browser launch at the end.

Then in the browser, on `/build`:

1. **Pick a market** → **USDe/USDC**.
2. **Install defaults** (adds Dynamic leverage + Auto-compound).
3. **Review & publish** (top right).
4. **Connect** (in the modal) → your wallet on the local anvil (see wallet setup below; on `TARGET=mainnet`, whatever wallet holds the strategist key).
5. **Publish vault**. Success redirects to `/vaults/loop-xxxxxxxx` and attested strikes land every strike cadence (10s on the fork, hourly on mainnet).

Shut everything down with:

```bash
bash deploy/run-live-demo.sh stop
# match the TARGET the run used, e.g.:
TARGET=mainnet bash deploy/run-live-demo.sh stop
```

## Wallet setup (one time, `TARGET=fork`)

MetaMask, Brave Wallet, or any injected EVM wallet:

- **Network**: Custom RPC `http://127.0.0.1:8545`, chain id `31337`.
- **Import account** with a well-known anvil private key, e.g. `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d` (address `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`, 10000 ETH on the fork).

The connected address becomes the loop's **strategist** (the exit key on the handler contract, independent of Priime).

On `TARGET=mainnet` there is no wallet-setup step here: connect whatever wallet holds (or should hold) the account named by `PRIIME_STRATEGIST_KEY`. Nothing is pre-funded and no key is printed by the script.

## Prereqs (once)

Binaries in `$PATH`: `ipfs`, `docker`, `forge`, `pnpm`, `cast`, `jq`, `curl`, `brave` (override with `BROWSER=chromium` on the command line). `anvil` is only required for `TARGET=fork`.

Docker daemon running (`sudo rc-service docker start` on Artix). Docker images `ghcr.io/priime-finance/priime:3.0.0` and `ghcr.io/lay3rlabs/poa-middleware:1.0.1` pulled.

## Manual startup (no script, `TARGET=fork`)

`TARGET=mainnet` is scripted via `deploy/vault-service.sh` and `deploy/run-live-demo.sh`. There is no four-shell manual walkthrough for mainnet — the scripts read the env file, deploy the factory once and reuse it, sync the factory address into the subgraph, and start the two node servers. Full sequence:

```bash
# 1. Fill .env.mainnet at the repo root. Required:
#    PRIIME_RPC_URL, PRIIME_PUBLIC_RPC_URL, PRIIME_OWNER_KEY,
#    PRIIME_STRATEGIST_KEY, PRIIME_DEPOSITOR_KEY, PRIIME_TREASURY_KEY,
#    LOOP_SERVER_TOKEN. Gitignored via .env.*.

# 2. Manager + factory + template vault + three Priime nodes.
#    First run deploys the factory and writes deploy/.mainnet/factory.json;
#    subsequent runs reuse it, so the subgraph never needs a redeploy per
#    new user vault.
env $(grep -v '^#' .env.mainnet | xargs) TARGET=mainnet bash deploy/vault-service.sh

# 3. Sync factory address into subgraph, redeploy to Studio.
cd packages/subgraph
pnpm install
pnpm sync-factory          # reads deploy/.mainnet/factory.json → networks.json
pnpm build && pnpm deploy  # v0.0.2 endpoint at api.studio.thegraph.com/query/1755125/priime-demo
cd -

# 4. Loop-server + replay-ui.
env $(grep -v '^#' .env.mainnet | xargs) TARGET=mainnet bash deploy/run-live-demo.sh

# 5. Browser: /build to publish a fresh vault (deploys through the factory,
#    subgraph indexes it on the next block), or /vaults/loop-<id> for any
#    existing loop.
```

`deploy/target.sh` and `deploy/targets/mainnet.json` are the source of truth for what the scripts read.

Four shells:

```bash
# shell 1
ipfs daemon
```

```bash
# shell 2
bash deploy/fork.sh
bash deploy/vault-service.sh
```

Note the `service_manager` printed at the end of `vault-service.sh`.

```bash
# shell 3 (loop-server)
SM=$(jq -r .service_manager deploy/.fork/vault-service.json)

cd apps/loop-server
LOOP_SERVER_TOKEN=demo-token-0123456789abcdef \
RPC_URL=http://127.0.0.1:8545 \
CHAIN_ID=31337 \
MANAGER_ADDRESS=$SM \
OWNER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
PORT=8090 DB_PATH=/tmp/loop-demo.db \
QUORUM_THRESHOLD=1 QUORUM_TOTAL=1 \
node src/main.ts
```

```bash
# shell 4 (frontend)
cd apps/replay-ui
pnpm dev
```

Every variable the UI reads already defaults to the fork: loop-server at `127.0.0.1:8090`, the RPC at `127.0.0.1:8545`, chain `31337`, and the bearer token to the same `demo-token-...` the script above uses. The token default is **localhost only** (`lib/loop-server.ts`, pinned by `tests/loop-server-auth.test.ts`); point `LOOP_SERVER_URL` at any other host and `LOOP_SERVER_TOKEN` becomes required again, because loop-server deploys with a funded owner key. Set them explicitly when you want something else:

```bash
LOOP_SERVER_URL=http://127.0.0.1:8090 \
LOOP_SERVER_TOKEN=demo-token-0123456789abcdef \
NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545 \
NEXT_PUBLIC_CHAIN_ID=31337 \
pnpm dev
```

Open `http://localhost:3000/build`, wire your wallet as above, and publish.

Note: `OWNER_PRIVATE_KEY` above is not read from `deploy/target.sh`; it is the fork mnemonic's index-0 key, written out literally because a manual walkthrough that shells out to `cast wallet private-key` per step is not lighter than the script. `VAULT_SERVICE_JSON` is omitted because `apps/loop-server/src/env.ts` defaults it to `deploy/.fork/vault-service.json`, which happens to be correct for `TARGET=fork` and only `TARGET=fork` (see `docs/specs/verifiable_vault_demo_closeout_v1.md`).

## The seam, at a glance

- The composer's Review card emits a five-field body: `{ name, strategist, cronSeconds, candidateId, targetLeverage }`.
- `POST /loops` (loop server) calls `resolveLoopConfig`, which looks `candidateId` up in `packages/loop-deploy/src/catalog.ts` and refuses unknown candidates with a `400 { issues: [...] }`. On a hit it merges the catalog's addresses with the user's leverage + cadence into the full `LoopConfig`, deploys a new `PriimeVault` with the connected wallet as `strategist`, clones the template workflow into `service.json`, pins the mutation, and calls `setServiceURI` on the manager. Priime nodes pick the new workflow up automatically via the `ServiceURIUpdated` event.
- `GET /loops/:id/journals` (loop server) reads `NavUpdated` logs off the handler, decodes `handleSignedEnvelope` calldata, and emits records that validate against `schema/journal.v1.schema.json`.
- The frontend proxies both through `/api/loops/*` (the bearer token stays in Node) and consumes them from `apps/replay-ui/lib/vaults/live-source.ts`.

## What proves it

`/vaults/loop-xxxxxxxx` shows the attested strike ledger for the loop you just published: inputs block, NAV (base units), operator count, quorum threshold and whether it reached, and the attestation tx hash. Every value comes from a `NavUpdated` event on your handler and the calldata of the tx that emitted it. Nothing is modeled; nothing is polled from a guessed source.

## Known limits

- **One market in the catalog.** `USDe/USDC on Morpho Blue · Base` is the only entry in `packages/loop-deploy/src/catalog.ts` because that is the workflow `deploy/vault-service.sh` deploys. The composer's market picker still surfaces other candidates for design purposes; publishing one that isn't in the catalog returns `400` with a specific message. Adding a market means either running `vault-service.sh` per market or teaching it to register N workflows in one shot, then adding a `MarketSpec` row.
- The default `fromBlock` for the journal scan is `head - 9999` (the anvil fork RPC caps `eth_getLogs` at 10 000 blocks). Set `JOURNAL_FROM_BLOCK` on the loop server if you need to reach further back.
- **Sabotage beat.** `packages/loop-deploy/src/journal.ts` still notes that a rejected operator's submission never reaches the manager, so the live journal always reads `status: settled` with `accepted: true` on every signer that made quorum. The corrupt-operator narrative currently runs off captured sample fixtures; a live driver needs an aggregator-side journal writer plus the "corrupt an operator" control.

## What's live

- **2-of-3 quorum on three Priime nodes** (`priime-vault-{1,2,3}`). Every composer-published vault attests through the same three-node topology.
- **`TARGET=mainnet` runs end to end.** Factory `0xa3cbA56ECC2F6684abf3D5a0Fd2C93D030849aBF`, service manager `0x23d382E3c6b1625B0021d5ef291DBd12995cDf00`, three registered operator EOAs, subgraph `v0.0.2` on Subgraph Studio.
- **Factory + subgraph template.** Every new vault deploys through `PriimeVaultFactory.deployVault(...)` and emits `VaultCreated`. The subgraph's `PriimeVaultFactory` data source spawns a `PriimeVaultInstance` template on that event, so publishing a fresh loop through the composer surfaces on the Studio endpoint on the next block without a subgraph redeploy.
- **Safety rails.** Two guards on the loop server:
  - `POST /loops` runs a `slot0()` shape check against the resolved pool address before any DB row or IPFS pin lands (`packages/loop-deploy/src/chain.ts::verifyUniswapV3Pool`). A pool whose ABI does not decode into the 7-word Uniswap V3 shape is rejected with `400` at publish time.
  - `DELETE /loops/:id` reads `totalPendingDepositAssets` and `totalPendingRedeemShares` off the vault before removing the workflow (`packages/loop-deploy/src/deployer.ts::PauseGuardError`). Non-zero on either side → `409` with the pending amounts, so a tester cannot strand their own escrow by removing the workflow mid-cycle. The corresponding button is not exposed in the replay-ui vault page; the guard defends the API regardless of client.
- **Wallet-signed deposits and redeems** land through `apps/replay-ui/components/vaults/DepositCard.tsx` and `apps/replay-ui/components/vaults/RedeemCard.tsx`.
