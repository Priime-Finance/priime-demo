# @priime-demo/loop-server

Authenticated control plane for deploying user-configured loops onto the shared Priime service. One workflow per loop, one service, one operator set, one quorum.

What a loop deploy does, in order:

1. Validates the composer body (`candidateId`, `targetLeverage`, `cronSeconds`, optional `strategyParams`) against `packages/loop-deploy/src/config.ts::resolveLoopConfig`, which resolves market addresses from `packages/loop-deploy/src/catalog.ts`.
2. Runs a pool preflight: one `slot0()` call against the resolved pool address, rejected as `400` if the ABI decode does not match the 7-word Uniswap V3 shape.
3. Calls `PriimeVaultFactory.deployVault(...)` on-chain, which deploys a `PriimeVault` with the composer's connected wallet as `strategist` (the Priime independent exit) and emits `VaultCreated`.
4. Fetches the manager's current service.json, clones the template workflow, swaps the cron window, the vault-nav config and the aggregator submit target, pins the result to IPFS, and calls `setServiceURI`.
5. Priime nodes pick the new workflow up automatically via the `ServiceURIUpdated` event; the subgraph picks the new vault up automatically via the factory template. No operator action per loop, no subgraph redeploy per loop.

Every service.json mutation runs through one serialized queue (the service definition is a single shared document with last-write-wins semantics), and every step is recorded in a sqlite registry so a crashed deploy resumes rather than duplicating work.

## Trust model

The server holds the service manager owner key. That key controls the service definition and pays factory / vault deploy gas; it never touches user funds. User money sits behind per-loop vaults whose strategist is the user.

## Safety rails

Two guards run before any side effect:

- **Pool preflight** on `POST /loops` — `packages/loop-deploy/src/chain.ts::verifyUniswapV3Pool`. One `slot0()` call on the resolved pool address; fails the request with `400` if it does not decode into `(uint160, int24, uint16, uint16, uint16, uint8, bool)`. Aerodrome-CL forks return six words and hit this rail; the alternative is a strike-time buffer overrun in the operator wasm.
- **Pause guard** on `DELETE /loops/:id` — `packages/loop-deploy/src/deployer.ts::PauseGuardError`. Reads `totalPendingDepositAssets` and `totalPendingRedeemShares` off the vault before mutating service.json; refuses the request with `409` if either is non-zero, so a tester cannot strand their own escrow by removing the workflow mid-cycle. The replay-ui vault page does not surface a pause button; the guard defends the API regardless of client.

## Run

Prereqs: a running fork + service (`deploy/fork.sh`, `deploy/vault-service.sh`), IPFS daemon. `FACTORY_ADDRESS` may be passed via env or read from `VAULT_SERVICE_JSON` (`.factory`), which `vault-service.sh` writes.

```bash
LOOP_SERVER_TOKEN=$(openssl rand -hex 16) \
RPC_URL=http://127.0.0.1:8545 \
CHAIN_ID=31337 \
MANAGER_ADDRESS=<service manager> \
FACTORY_ADDRESS=<PriimeVaultFactory> \
OWNER_PRIVATE_KEY=<manager owner key> \
USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
pnpm --filter @priime-demo/loop-server start
```

Optional: `PORT` (8090), `CHAIN_KEY` (`evm:<CHAIN_ID>`), `IPFS_API_URL` (:5001), `IPFS_GATEWAY_URL` (:8080), `DB_PATH`, `TEMPLATE_WORKFLOW_ID` (required once the service has more than one workflow), `VAULT_SERVICE_JSON` (defaults to `deploy/.fork/vault-service.json`), `COMPONENT_DIGEST`, `QUORUM_THRESHOLD` (2), `QUORUM_TOTAL` (3), `JOURNAL_FROM_BLOCK`.

The server binds 127.0.0.1 only; `deploy/nginx.conf` is the TLS ingress sample.

## API

All routes except `/healthz` require `Authorization: Bearer $LOOP_SERVER_TOKEN`.

| Route | Effect |
|---|---|
| `GET /healthz` | liveness |
| `GET /loops` | list loops with status and step |
| `POST /loops` | validate, run pool preflight, deploy through factory, mutate service.json (body below) |
| `GET /loops/:id` | one loop |
| `POST /loops/:id/resume` | resume a failed deploy from its recorded step |
| `DELETE /loops/:id` | run pause guard, then remove the loop's workflow from the service (vault stays on chain) |

`POST /loops` body (matches `packages/loop-deploy/src/config.ts::LoopConfigInput`):

```json
{
  "name": "my loop",
  "strategist": "0x...",
  "cronSeconds": 60,
  "candidateId": "morpho-blue-base:8453:USDe-USDC:0x54cf9be5",
  "targetLeverage": 2.5,
  "strategyParams": {
    "hf_target_bps": "15250",
    "hf_deleverage_bps": "14550",
    "hf_floor_bps": "13850",
    "risk_preset": "standard",
    "applied_leverage": "2.5",
    "compound_cadence_hours": "6",
    "compound_threshold_usd": "155",
    "collateral_yield_apy": "0.044",
    "capacity_binding": "modeled"
  }
}
```

The market's addresses (asset, morpho, oracle, IRM, swap router, pool, pool fee, TWAP window, inputs block lag) are resolved from the catalog by `candidateId`; a strategist cannot override them. Constraints: `cronSeconds` is 5..59 or whole minutes up to 1h; `targetLeverage` in `[1, 10]`; `strategyParams` is a flat string map merged verbatim into the component config (see `strategy-composer.md` for the accepted keys).

## Verification

```bash
pnpm --filter @priime-demo/loop-deploy test   # builder, config, registry, deployer, pause guard, pool preflight
pnpm --filter @priime-demo/loop-server exec tsc --noEmit
```

The deployer tests cover the invariants that matter: lossless round trip of >2^53 trigger timestamps, template cloning with unknown-field passthrough, crash resume without factory redeploys, serialized concurrent mutations (both loops land), the pause guard refusing on non-zero pending balances, and the pool preflight refusing a wrong-shape `slot0()`.
