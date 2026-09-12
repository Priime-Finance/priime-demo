# @priime-demo/subgraph

Subgraph indexing `PriimeVault` on Base. Modelled on the ERC-4626 shape so the same query pattern works against any tokenized vault; the Priime-specific entities (`Strike`, `PlanExecution`, `PlanRejection`, `Deleverage`, `ExecuteCall`) cover the Priime operator quorum's NAV attestation and quorum-signed strategy plans.

## What it indexes

Vault contract: [`0x38ecc349143f107126094e37d20cf14589adceef`](https://basescan.org/address/0x38ecc349143f107126094e37d20cf14589adceef) on Base (chain id 8453), from deploy block `51174469`.

Events handled:

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

Prereqs: `pnpm` (workspace root) and a Subgraph Studio deploy key.

```bash
cd packages/subgraph
pnpm install
pnpm codegen         # writes AssemblyScript bindings under generated/
pnpm build           # compiles mappings to WASM under build/
graph auth <STUDIO_DEPLOY_KEY>    # once per machine
pnpm deploy          # -> https://api.studio.thegraph.com/deploy/
```

The deploy URL and version label live in `package.json::scripts.deploy`.

## Query examples

Latest 10 strikes newest-first, one line each:

```graphql
{
  strikes(orderBy: block, orderDirection: desc, first: 10) {
    eventId
    nav
    inputsBlock
    breachFlags
    tx
    timestamp
  }
}
```

Vault summary:

```graphql
{
  vault(id: "0x38ecc349143f107126094e37d20cf14589adceef") {
    lastNav
    updateCount
    totalDepositFulfilled
    totalRedeemFulfilled
    totalShares
    breachFlags
  }
}
```

Rolling 30-day daily metric:

```graphql
{
  vaultDailyMetrics(
    where: { vault: "0x38ecc349143f107126094e37d20cf14589adceef" }
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
