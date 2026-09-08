# Live demo: publish a loop from the composer

End to end walkthrough of the local demo: a user opens `/build`, composes a
vault on the canvas, hits **Publish vault** with a connected wallet, and
watches real attested strikes land on their own handler within seconds. No
curl anywhere.

## What runs

| Layer | Where | What it does |
| --- | --- | --- |
| Anvil fork | `deploy/fork.sh` | Pinned Base mainnet fork on `:8545`, real Morpho USDe/USDC market at block 49911282. |
| WAVS service | `deploy/vault-service.sh` | Deploys the POA service manager + `PriimeVault`, publishes the vault-nav wasm to IPFS, starts the `wavs-vault` node, waits for the first cron strike. |
| Loop server | `apps/loop-server` (Node HTTP) | Holds the manager owner key. Resolves the composer's `candidateId` against `packages/loop-deploy/src/catalog.ts`, deploys a new handler + workflow on demand, and derives Journal-shaped records from on chain state for the frontend. |
| Replay UI | `apps/replay-ui` (Next.js) | The `/build` canvas composes the vault; the `Review & publish` modal POSTs to the loop server through `/api/loops`. `/vault/live/<id>` shows the attested strike ledger. |
| IPFS | `ipfs daemon` | Hosts the pinned `service.json`. |

## Script

```bash
bash deploy/run-live-demo.sh
```

Reruns bring up a fresh manager and vault, restart the two node servers, and
reuse a running IPFS daemon when one is already up. Logs go to
`deploy/.fork/live-demo/*.log`. Set `OPEN_BROWSER=0` to skip the browser
launch at the end.

Then in the browser, on `/build`:

1. **Pick a market** → **USDe/USDC**.
2. **Install defaults** (adds Dynamic leverage + Auto-compound).
3. **Review & publish** (top right).
4. **Connect** (in the modal) → your wallet on the local anvil (see wallet
   setup below).
5. **Publish vault**. Success redirects to `/vault/live/<loop-id>` and
   attested strikes land every strike cadence.

Shut everything down with:

```bash
bash deploy/run-live-demo.sh stop
```

## Wallet setup (one time)

MetaMask, Brave Wallet, or any injected EVM wallet:

- **Network**: Custom RPC `http://127.0.0.1:8545`, chain id `31337`.
- **Import account** with a well-known anvil private key, e.g.
  `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d`
  (address `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`, 10000 ETH on the
  fork).

The connected address becomes the loop's **strategist** (the exit key on the
handler contract, independent of WAVS).

## Prereqs (once)

Binaries in `$PATH`: `anvil`, `ipfs`, `docker`, `forge`, `pnpm`, `cast`,
`jq`, `curl`, `brave` (override with `BROWSER=chromium` on the command
line).

Docker daemon running (`sudo rc-service docker start` on Artix). Docker
images `ghcr.io/lay3rlabs/wavs:2.0.0-vault-rc.15` and
`ghcr.io/lay3rlabs/poa-middleware:1.0.1` pulled.

## Manual startup (no script)

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
LOOP_SERVER_URL=http://127.0.0.1:8090 \
LOOP_SERVER_TOKEN=demo-token-0123456789abcdef \
NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545 \
NEXT_PUBLIC_CHAIN_ID=31337 \
pnpm dev
```

Open `http://localhost:3000/build`, wire your wallet as above, and publish.

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

`/vault/live/<loop-id>` shows the attested strike ledger for the loop you
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
