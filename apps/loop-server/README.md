# @priime-demo/loop-server

Authenticated control plane for deploying user configured loops onto the shared WAVS service (Option A: one workflow per loop, one service, one operator set, one quorum).

What a loop deploy does, in order:

1. Validates the user's `LoopConfig` (market addresses, cadence, TWAP window, strategist).
2. Deploys a `PriimeVault` handler with the user as `strategist` -- the WAVS independent exit: the strategist can unwind the position with the machinery completely dead.
3. Fetches the manager's current service.json, clones the template workflow, swaps the cron window, the vault-nav config, and the aggregator submit target, pins the result to IPFS, and calls `setServiceURI`.
4. Operator nodes pick the new workflow up automatically via the `ServiceURIUpdated` event. No operator action per loop.

Every service.json mutation runs through one serialized queue (the service definition is a single shared document with last write wins semantics), and every step is recorded in a sqlite registry so a crashed deploy resumes instead of duplicating work.

## Trust model

The server holds the service manager owner key. That key controls the service definition and pays handler deploy gas; it never touches user funds. User money sits behind per loop handlers whose strategist is the user.

## Run

Prereqs: `forge build` in `contracts/` (handler artifact), a running fork + service (`deploy/fork.sh`, `deploy/vault-service.sh`), IPFS daemon.

```bash
LOOP_SERVER_TOKEN=$(openssl rand -hex 16) \
RPC_URL=http://127.0.0.1:8545 \
CHAIN_ID=31337 \
MANAGER_ADDRESS=<service manager> \
OWNER_PRIVATE_KEY=<manager owner key> \
USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
pnpm --filter @priime-demo/loop-server start
```

Optional: `PORT` (8090), `CHAIN_KEY` (`evm:<CHAIN_ID>`), `IPFS_API_URL` (:5001), `IPFS_GATEWAY_URL` (:8080), `HANDLER_ARTIFACT_PATH`, `DB_PATH`, `TEMPLATE_WORKFLOW_ID` (required once the service has more than one workflow).

The server binds 127.0.0.1 only; `deploy/nginx.conf` is the TLS ingress sample.

## API

All routes except `/healthz` require `Authorization: Bearer $LOOP_SERVER_TOKEN`.

| Route | Effect |
| --- | --- |
| `GET /healthz` | liveness |
| `GET /loops` | list loops with status and step |
| `POST /loops` | create and deploy (body: LoopConfig, see below) |
| `GET /loops/:id` | one loop |
| `POST /loops/:id/resume` | resume a failed deploy from its recorded step |
| `DELETE /loops/:id` | remove the loop's workflow from the service (handler stays on chain) |

LoopConfig body:

```json
{
  "name": "my loop",
  "strategist": "0x...",
  "cronSeconds": 30,
  "marketId": "0x...32 bytes...",
  "lltv": "915000000000000000",
  "usdeAddress": "0x...",
  "oracleAddress": "0x...",
  "irmAddress": "0x...",
  "morphoAddress": "0x...",
  "poolAddress": "0x...",
  "twapWindowSecs": 1800,
  "inputsBlockLag": 2
}
```

Constraints: cadence 5..59s or whole minutes up to 1h; TWAP window >= 300s (the component's effective window floor); addresses and marketId are hex validated; lltv in (0, 1e18].

## Verification

```bash
pnpm --filter @priime-demo/loop-deploy test   # 41 tests: builder, config, registry, deployer, lossless json
npx tsc --noEmit                              # in packages/loop-deploy and apps/loop-server
```

The deployer tests cover the invariants that matter: lossless round trip of >2^53 trigger timestamps, template cloning with unknown field passthrough, crash resume without handler redeploys, and serialized concurrent mutations (both loops land).
