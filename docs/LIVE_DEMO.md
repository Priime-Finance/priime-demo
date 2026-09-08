# Live demo: publish a loop from the composer

End to end walkthrough of the local demo: a user opens `/build`, composes a
vault on the canvas, hits **Publish vault** with a connected wallet, and
watches real attested strikes land on their own handler within seconds. No
curl anywhere.

Every script under `deploy/` resolves a deploy **target** first (`TARGET`,
default `fork`); see "Deploy target" below. Unless a step says otherwise,
this walkthrough describes `TARGET=fork`, the default and the only target
that needs no environment setup.

## What runs

| Layer | Where | What it does |
| --- | --- | --- |
| Chain | `deploy/fork.sh` (`TARGET=fork` only) | Pinned Base mainnet fork on `:8545`, real Morpho USDe/USDC market at block 49911282. Under `TARGET=mainnet` there is no chain to start; the scripts talk to Base itself. |
| WAVS service | `deploy/vault-service.sh` | Deploys the POA service manager + `PriimeVault`, publishes the vault-nav wasm to IPFS, starts the `wavs-vault` node, waits for the first cron strike. |
| Loop server | `apps/loop-server` (Node HTTP) | Holds the manager owner key. Resolves the composer's `candidateId` against `packages/loop-deploy/src/catalog.ts`, deploys a new handler + workflow on demand, and derives Journal-shaped records from on chain state for the frontend. |
| Replay UI | `apps/replay-ui` (Next.js) | The `/build` canvas composes the vault; the `Review & publish` modal POSTs to the loop server through `/api/loops`. A published loop is reachable at `/vaults/loop-xxxxxxxx` (see `apps/replay-ui/lib/vaults/live-id.ts`), where `VaultDetail` shows the attested strike ledger. |
| IPFS | `ipfs daemon` | Hosts the pinned `service.json`. |

## Deploy target: `TARGET=fork` vs `TARGET=mainnet`

`deploy/target.sh` (sourced by every script in `deploy/`) resolves `TARGET`
against `deploy/targets/$TARGET.json`. There are two targets; an unknown
`TARGET` is rejected by name. Base Sepolia is deliberately not one of them
(no real Morpho Blue USDe/USDC market or Aerodrome pool there; see
`docs/INTEGRATION_PLAN.md`, Deferred 7). Both targets share the same market,
tokens and strategy parameters (`deploy/fork.config.json`); only what
genuinely differs by target lives in `deploy/targets/*.json`.

**`TARGET=fork` (the default).** An anvil fork of Base mainnet at the block
pinned in `fork.config.json`, served on chain id `31337`, `:8545` by
default (override with `FORK_PORT`). Needs no environment variables:
- Keys come from the well-known, worthless anvil mnemonic (override with
  `FORK_MNEMONIC`); the account-index-to-role map is `owner=0`,
  `strategist=4`, `depositor=5`, `treasury=0` (unused, since funding on the
  fork doesn't go through a treasury).
- Funding is cheat codes: `anvil_setBalance` conjures ETH, and USDC is
  taken by impersonating Morpho Blue (the pinned block's largest USDC
  holder). These cheat codes exist only behind `TARGET=fork`.
- Blocks are forced with `anvil_mine`; the strike cadence is every 10
  seconds.
- The fork's own upstream RPC (what it forks *from*) defaults to
  `https://mainnet.base.org`; override with `BASE_RPC_URL` if you need a
  different upstream provider.
- Per-run artifacts land in `deploy/.fork/` (logs in
  `deploy/.fork/live-demo/*.log`).

**`TARGET=mainnet`.** Base itself, chain id `8453`. **Defaults nothing** and
fails loudly, per-variable, the moment something required is missing
(`deploy/target.sh`'s `required_env`, mirroring `required()` in
`apps/loop-server/src/env.ts`):
- `PRIIME_RPC_URL` (required): the RPC endpoint scripts and the loop server
  sign and send through. Likely carries a provider API key in its path, so
  it is never sent to the browser.
- `PRIIME_PUBLIC_RPC_URL` (required, separate from the above): the
  browser-facing RPC URL `run-live-demo.sh` hands to the frontend as
  `NEXT_PUBLIC_RPC_URL`. Kept distinct so a keyed URL never reaches the
  client.
- `PRIIME_OWNER_KEY`, `PRIIME_STRATEGIST_KEY`, `PRIIME_DEPOSITOR_KEY`,
  `PRIIME_TREASURY_KEY` (all required): one 0x-prefixed private key each
  for the four roles. They may be four distinct keys or fewer; that's an
  operational choice the scripts don't make for you.
- `LOOP_SERVER_TOKEN` (required): `run-live-demo.sh`'s `demo-token-...`
  default is fork-only; a live run must supply its own bearer token.
- Funding is a real transfer from the treasury key, balance-checked first;
  a shortfall is fatal rather than silently short-funding an account.
  Blocks are real; the scripts poll for one rather than forcing it.
  The strike cadence is hourly, not every 10 seconds, because a strike is a
  real on-chain submission paying real Base gas.
- Per-run artifacts land in `deploy/.mainnet/`.
- `deploy/deploy.sh` (the top-level M1 hello-world pipeline in the repo
  README) refuses `TARGET=mainnet` outright: its `wavs.toml` wants one
  shared signing mnemonic, which only a mnemonic-backed target (`fork`) has.

`TARGET=mainnet` moves real money and has not been exercised end to end in
this repo; see "Known limits" below. Treat it accordingly.

## Script

```bash
bash deploy/run-live-demo.sh
# or, against Base:
TARGET=mainnet bash deploy/run-live-demo.sh
```

Reruns bring up a fresh manager and vault, restart the two node servers, and
reuse a running IPFS daemon when one is already up. Logs go to
`deploy/.<target>/live-demo/*.log` (`deploy/.fork/...` under the default
`TARGET=fork`, `deploy/.mainnet/...` under `TARGET=mainnet`). Set
`OPEN_BROWSER=0` to skip the browser launch at the end.

Then in the browser, on `/build`:

1. **Pick a market** → **USDe/USDC**.
2. **Install defaults** (adds Dynamic leverage + Auto-compound).
3. **Review & publish** (top right).
4. **Connect** (in the modal) → your wallet on the local anvil (see wallet
   setup below; on `TARGET=mainnet`, whatever wallet holds the strategist
   key).
5. **Publish vault**. Success redirects to `/vaults/loop-xxxxxxxx` and
   attested strikes land every strike cadence (10s on the fork, hourly on
   mainnet).

Shut everything down with:

```bash
bash deploy/run-live-demo.sh stop
# match the TARGET the run used, e.g.:
TARGET=mainnet bash deploy/run-live-demo.sh stop
```

## Wallet setup (one time, `TARGET=fork`)

MetaMask, Brave Wallet, or any injected EVM wallet:

- **Network**: Custom RPC `http://127.0.0.1:8545`, chain id `31337`.
- **Import account** with a well-known anvil private key, e.g.
  `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d`
  (address `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`, 10000 ETH on the
  fork).

The connected address becomes the loop's **strategist** (the exit key on the
handler contract, independent of WAVS).

On `TARGET=mainnet` there is no wallet-setup step here: connect whatever
wallet holds (or should hold) the account named by `PRIIME_STRATEGIST_KEY`.
Nothing is pre-funded and no key is printed by the script.

## Prereqs (once)

Binaries in `$PATH`: `ipfs`, `docker`, `forge`, `pnpm`, `cast`, `jq`,
`curl`, `brave` (override with `BROWSER=chromium` on the command line).
`anvil` is only required for `TARGET=fork`.

Docker daemon running (`sudo rc-service docker start` on Artix). Docker
images `ghcr.io/lay3rlabs/wavs:2.0.0-vault-rc.15` and
`ghcr.io/lay3rlabs/poa-middleware:1.0.1` pulled.

## Manual startup (no script, `TARGET=fork`)

For `TARGET=mainnet` there is no manual four-shell equivalent documented
here; use `TARGET=mainnet bash deploy/run-live-demo.sh` (above), which
drives `deploy/target.sh` for you. `deploy/target.sh` and
`deploy/targets/mainnet.json` are the source of truth for what a manual
mainnet run would need.

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

Every variable the UI reads already defaults to the fork: loop-server at
`127.0.0.1:8090`, the RPC at `127.0.0.1:8545`, chain `31337`, and the bearer
token to the same `demo-token-...` the script above uses. The token default is
**localhost only** (`lib/loop-server.ts`, pinned by
`tests/loop-server-auth.test.ts`); point `LOOP_SERVER_URL` at any other host
and `LOOP_SERVER_TOKEN` becomes required again, because loop-server deploys
with a funded owner key. Set them explicitly when you want something else:

```bash
LOOP_SERVER_URL=http://127.0.0.1:8090 \
LOOP_SERVER_TOKEN=demo-token-0123456789abcdef \
NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545 \
NEXT_PUBLIC_CHAIN_ID=31337 \
pnpm dev
```

Open `http://localhost:3000/build`, wire your wallet as above, and publish.

Note: `OWNER_PRIVATE_KEY` above is not read from `deploy/target.sh`; it is
the fork mnemonic's index-0 key, written out literally because a manual
walkthrough that shells out to `cast wallet private-key` per step is not
lighter than the script. `VAULT_SERVICE_JSON` is omitted because
`apps/loop-server/src/env.ts` defaults it to `deploy/.fork/vault-service.json`,
which happens to be correct for `TARGET=fork` and only `TARGET=fork` (see
`docs/INTEGRATION_PLAN.md`, Deferred).

## The seam, at a glance

- The composer's Review card emits a five-field body:
  `{ name, strategist, cronSeconds, candidateId, targetLeverage }`.
- `POST /loops` (loop server) calls `resolveLoopConfig`, which looks
  `candidateId` up in `packages/loop-deploy/src/catalog.ts` and refuses
  unknown candidates with a `400 { issues: [...] }`. On a hit it merges the
  catalog's addresses with the user's leverage + cadence into the full
  `LoopConfig`, deploys a new `PriimeVault` with the connected wallet as
  `strategist`, clones the template workflow into `service.json`, pins the
  mutation, and calls `setServiceURI` on the manager. WAVS nodes pick the
  new workflow up automatically via the `ServiceURIUpdated` event.
- `GET /loops/:id/journals` (loop server) reads `NavUpdated` logs off the
  handler, decodes `handleSignedEnvelope` calldata, and emits records that
  validate against `schema/journal.v1.schema.json`.
- The frontend proxies both through `/api/loops/*` (the bearer token stays
  in Node) and consumes them from
  `apps/replay-ui/lib/vaults/live-source.ts`.

## What proves it

`/vaults/loop-xxxxxxxx` shows the attested strike ledger for the loop you
just published: inputs block, NAV (base units), operator count, quorum
threshold and whether it reached, and the attestation tx hash. Every value
comes from a `NavUpdated` event on your handler and the calldata of the tx
that emitted it. Nothing is modeled; nothing is polled from a guessed
source.

## Known limits

- **One market in the catalog.** `USDe/USDC on Morpho Blue · Base` is the
  only entry in `packages/loop-deploy/src/catalog.ts` because that is the
  workflow `deploy/vault-service.sh` deploys. The composer's market picker
  still surfaces other candidates for design purposes; publishing one that
  isn't in the catalog returns `400` with a specific message. Adding a
  market means either running `vault-service.sh` per market or teaching it
  to register N workflows in one shot, then adding a `MarketSpec` row.
- **Quorum is 1 of 1 today.** The three-node topology is a separate
  milestone; when it lands, the reader picks it up automatically.
- **Handler contract has no funding UX in the browser yet.**
  `requestDeposit` and the loop entry sequence still run via
  `deploy/enter-loop.sh` as the strategist. Wallet-signed deposits are the
  next frontend task.
- The default `fromBlock` for the journal scan is `head - 9999` (the anvil
  fork RPC caps `eth_getLogs` at 10 000 blocks). Set
  `JOURNAL_FROM_BLOCK` on the loop server if you need to reach further
  back.
- **`TARGET=mainnet` has not been run end to end.** It was verified only as
  far as its prerequisite checks: unset `TARGET` reproduces the old fork
  constants, an unknown target is rejected by name, and a missing mainnet
  variable fails loudly (commit `5540fbc`). `run-live-demo.sh`'s mainnet
  branch (the loop server and replay-ui wiring) was exercised only as far
  as its prerequisite checks, not to a real deploy. Running it moves real
  money on Base.
