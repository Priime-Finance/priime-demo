# Live demo: create a loop from the browser

End to end walkthrough of the local demo: a user opens `/vault`, fills a short form, hits **Deploy loop**, and watches real attested strikes land on their own handler within seconds. No curl anywhere.

## What runs

| Layer | Where | What it does |
| --- | --- | --- |
| Anvil fork | `deploy/fork.sh` | Pinned Base mainnet fork on `:8545`, real Morpho USDe/USDC market at block 49911282. |
| WAVS service | `deploy/vault-service.sh` | Deploys the POA service manager + `PriimeVault`, publishes the vault-nav wasm to IPFS, starts the `wavs-vault` node, waits for the first cron strike. |
| Loop server | `apps/loop-server` (Node HTTP) | Holds the manager owner key. Deploys new handlers and workflows on demand, and derives Journal shaped records from on chain state for the frontend. |
| Replay UI | `apps/replay-ui` (Next.js) | The `/vault` page renders the hero (captured journals, unchanged) plus a **Live loops** section wired to the loop server. |
| IPFS | `ipfs daemon` | Hosts the pinned `service.json`. |

## Script

```bash
bash deploy/run-live-demo.sh
```

Reruns bring up a fresh manager and vault, restart the two node servers, and reuse a running IPFS daemon when one is already up. Logs go to `deploy/.fork/live-demo/*.log`.

Then in the browser, on `/vault`:

1. Scroll to **Live loops**.
2. Fill **Name** (e.g. `my first loop`).
3. Leave **Strategist** and **Strike cadence** on defaults (or edit).
4. Hit **Deploy loop**.
5. A success line prints the new loop id and handler; a fresh card appears in the grid. Click it to open `/vault/live/<id>` and watch attested strikes land every strike cadence.

Shut everything down with:

```bash
bash deploy/run-live-demo.sh stop
```

## Prereqs (once)

Binaries in `$PATH`: `anvil`, `ipfs`, `docker`, `forge`, `pnpm`, `cast`, `jq`, `curl`, `brave` (override with `BROWSER=chromium` on the command line).

Docker daemon running (`sudo rc-service docker start` on Artix). Docker images `ghcr.io/lay3rlabs/wavs:2.0.0-vault-rc.15` and `ghcr.io/lay3rlabs/poa-middleware:1.0.1` pulled.

## Manual startup (no script)

Three shells:

```bash
# shell 1
ipfs daemon
```

```bash
# shell 2
bash deploy/fork.sh
bash deploy/vault-service.sh
```

Note the `service_manager` printed at the end of `vault-service.sh` and the component digest recorded in `deploy/.fork/wavs-vault/service.json`.

```bash
# shell 3 (loop-server)
SM=$(jq -r .service_manager deploy/.fork/vault-service.json)
DIG=$(jq -r '.workflows | to_entries[0].value.component.source.download.digest' \
  deploy/.fork/wavs-vault/service.json)

cd apps/loop-server
LOOP_SERVER_TOKEN=demo-token-0123456789abcdef \
RPC_URL=http://127.0.0.1:8545 \
CHAIN_ID=31337 \
MANAGER_ADDRESS=$SM \
OWNER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
PORT=8090 DB_PATH=/tmp/loop-demo.db \
COMPONENT_DIGEST=sha256:$DIG \
QUORUM_THRESHOLD=1 QUORUM_TOTAL=1 \
node src/main.ts
```

```bash
# shell 4 (frontend)
cd apps/replay-ui
LOOP_SERVER_URL=http://127.0.0.1:8090 \
LOOP_SERVER_TOKEN=demo-token-0123456789abcdef \
pnpm dev
```

Open `http://localhost:3000/vault` and use the form.

## The seam, at a glance

- `POST /loops` (loop server) validates the `LoopConfig`, deploys a new `PriimeVault` with the user as `strategist`, clones the template workflow into `service.json`, pins the mutation, and calls `setServiceURI` on the manager. WAVS nodes pick the new workflow up automatically via the `ServiceURIUpdated` event.
- `GET /loops/:id/journals` (loop server) reads `NavUpdated` logs off the handler, decodes `handleSignedEnvelope` calldata, and emits records that validate against `schema/journal.v1.schema.json`. Same shape as `schema/samples/*.json`, so any consumer that already handles the captured journals handles the live ones.
- The frontend proxies both through `/api/loops/*` (the bearer token stays in Node) and consumes them from `apps/replay-ui/lib/vaults/live-source.ts`.

## What proves it

`/vault/live/<loop-id>` shows the attested strike ledger for the loop you just deployed: inputs block, NAV (base units), operator count, quorum threshold and whether it reached, and the attestation tx hash. Every value comes from a `NavUpdated` event on your handler and the calldata of the tx that emitted it. Nothing is modeled; nothing is polled from a guessed source.

## Known limits

- Quorum is 1 of 1 today. The three node topology is a separate milestone; when it lands, the reader picks it up automatically.
- Handler contract has no funding UX in the browser yet. `requestDeposit` and the loop entry sequence still run via `deploy/enter-loop.sh` as the strategist. Deposits signed by the wallet are the next frontend task.
- The default `fromBlock` for the journal scan is `head - 9999` (the anvil fork RPC caps `eth_getLogs` at 10 000 blocks). Set `JOURNAL_FROM_BLOCK` on the loop server if you need to reach further back.
