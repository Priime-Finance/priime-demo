# @priime-demo/subgraph

Subgraph indexing every `PriimeVault` deployed on Base. Modelled on the ERC-4626 shape so the same query pattern works against any tokenized vault; the Priime-specific entities (`Strike`, `PlanExecution`, `PlanRejection`, `Deleverage`, `ExecuteCall`) cover the Priime operator quorum's NAV attestation and quorum-signed strategy plans.

## What it indexes

A single [`PriimeVaultFactory`](../../contracts/src/PriimeVaultFactory.sol) on Base (chain id 8453). Every vault is deployed by calling `factory.deployVault(...)`, which emits `VaultCreated(vault, strategist, serviceManager, asset, collateralToken, block)`. The subgraph treats the factory as its one on-chain source, and the mapping in `src/priime-vault-factory.ts` spawns a `PriimeVaultInstance` template per event. Every subsequent vault event flows through the same handlers (`src/priime-vault.ts`) with zero manifest edits.

Events handled per vault instance:

| Event | Entity written | Rolls up |
|---|---|---|
| `NavUpdated` | `Strike` | `Vault.lastNav`, `Vault.updateCount`, `VaultDailyMetric.strikeCount / navEnd / navMin / navMax` |
| `DepositRequest` | `VaultDepositRequest` | `Vault.totalDepositRequested`, `VaultDailyMetric.depositRequests` |
| `RedeemRequest` | `VaultRedeemRequest` | `Vault.totalRedeemRequested`, `VaultDailyMetric.redeemRequests` |
| `DepositRequestFulfilled` | `DepositFulfilled` | `Vault.totalDepositFulfilled / totalShares`, `VaultDailyMetric.depositsFulfilled` |
| `RedeemRequestFulfilled` | `RedeemFulfilled` | `Vault.totalRedeemFulfilled / totalShares`, `VaultDailyMetric.redeemsFulfilled` |
| `DepositRequestRefunded` | `DepositRefunded` | — |
| `Executed` | `ExecuteCall` | — |
| `PlanExecuted` | `PlanExecution` | `VaultDailyMetric.planExecuted` |
| `PlanRejected` | `PlanRejection` | `VaultDailyMetric.planRejected` |
| `Deleveraged` | `Deleverage` | — |

The `Vault` entity's immutables (`asset`, `strategist`, `serviceManager`, `swapRouter`, `poolFee`) are read via `eth_call` on first event.

## Build + deploy

Factory address is not hardcoded into the manifest. `networks.json` carries the deployed factory address per network; `pnpm sync-factory` copies it out of `deploy/.<target>/factory.json` (written by `deploy/vault-service.sh`) so the first-run and re-run flows are the same command.

Prereqs: `pnpm` (workspace root) and a Subgraph Studio deploy key.

```bash
cd packages/subgraph
pnpm install
pnpm sync-factory                # reads deploy/.mainnet/factory.json -> networks.json
pnpm codegen                     # writes AssemblyScript bindings under generated/
pnpm build                       # compiles mappings to WASM under build/
graph auth <STUDIO_DEPLOY_KEY>   # once per machine
pnpm deploy                      # -> https://api.studio.thegraph.com/deploy/
```

The deploy URL and version label live in `package.json::scripts.deploy`. Deployed endpoint today: `https://api.studio.thegraph.com/query/1755125/priime-demo/v0.0.2`.

## Query examples

Latest 10 strikes across every vault, newest first:

```graphql
{
  strikes(orderBy: block, orderDirection: desc, first: 10) {
    vault { id }
    eventId
    nav
    inputsBlock
    breachFlags
    tx
    timestamp
  }
}
```

One vault's summary — pass the address the composer or `run-live-demo.sh` printed:

```graphql
{
  vault(id: "<vault address, lowercase>") {
    lastNav
    updateCount
    totalDepositFulfilled
    totalRedeemFulfilled
    totalShares
    breachFlags
  }
}
```

Rolling 30-day daily metric for one vault:

```graphql
{
  vaultDailyMetrics(
    where: { vault: "<vault address, lowercase>" }
    orderBy: day
    orderDirection: desc
    first: 30
  ) {
    day
    strikeCount
    navEnd
    depositsFulfilled
    redeemsFulfilled
    planRejected
  }
}
```
