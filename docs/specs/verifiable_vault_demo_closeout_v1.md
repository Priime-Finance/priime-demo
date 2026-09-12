# Demo Closeout v1: state of the walkthrough

**Status:** State log, updated as items land | **Companion to:** `verifiable_vault_demo_spec_v1.md`

## The walkthrough

One person, one laptop, no help:

1. Clone, start a Base fork (or point at Base mainnet), bring up the service.
2. Import a funded demo wallet, connect it.
3. Compose a vault on `/build` and publish it. A real handler deploys via the factory.
4. Deposit USDC from the connected wallet.
5. Watch three operators re-execute the NAV and a **2-of-3 quorum** attest it.
6. Press "corrupt an operator" and watch the lie get outvoted.

Steps 1–5 are live. Step 6 depends on the sabotage-beat item below.

## What's live

- **Three Priime nodes, 2-of-3 quorum.** `deploy/vault-service.sh` registers three signing keys against the POA service manager; the aggregator submits from a per-node signer so nonces do not race. Every strike is quorum-signed and validated on-chain by `serviceManager.validate` inside `handleSignedEnvelope`.
- **Wallet-signed deposits and redeems.** `apps/replay-ui/components/vaults/DepositCard.tsx` and `RedeemCard.tsx` implement the ERC-7540 request-then-claim flow against the connected wallet. `requestDeposit` is permissionless; the NAV component prices idle USDC correctly.
- **`TARGET=mainnet` runs end to end.** Factory `0xa3cbA56ECC2F6684abf3D5a0Fd2C93D030849aBF`, service manager `0x23d382E3c6b1625B0021d5ef291DBd12995cDf00`, three registered operator EOAs, subgraph `v0.0.2` on Subgraph Studio.
- **Factory deploy model.** `contracts/src/PriimeVaultFactory.sol` is the single "point at me" address for the subgraph; every vault deployment routes through `factory.deployVault(...)` and emits `VaultCreated`, which the subgraph indexes via a `PriimeVaultInstance` template. Publishing a new loop through the composer surfaces on the endpoint the next block, without a subgraph redeploy.
- **Safety rails on the loop server.** `POST /loops` runs a `slot0()` shape check against the resolved pool address before writing anything (`packages/loop-deploy/src/chain.ts::verifyUniswapV3Pool`); non-Uniswap-V3 pools get `400` at publish time instead of failing every strike with an operator buffer overrun. `DELETE /loops/:id` reads `totalPendingDepositAssets` and `totalPendingRedeemShares` off the vault before removing the workflow (`packages/loop-deploy/src/deployer.ts::PauseGuardError`); non-zero on either side → `409` with the pending amounts, so a tester cannot strand their own escrow.
- **Environment surface.** `.env.mainnet` at the repo root is gitignored via the `.env.*` rule and holds every required secret in one file: `PRIIME_RPC_URL`, `PRIIME_PUBLIC_RPC_URL`, `PRIIME_OWNER_KEY`, `PRIIME_STRATEGIST_KEY`, `PRIIME_DEPOSITOR_KEY`, `PRIIME_TREASURY_KEY`, `LOOP_SERVER_TOKEN`. `docs/LIVE_DEMO.md` has the full run command.

## Still open

### The sabotage beat runs off fixtures, not live

`packages/loop-deploy/src/journal.ts` states it: a rejected operator's submission never reaches the manager, so a journal rebuilt from chain is always `status: settled` with `accepted: true` on every signer that made quorum. The corrupt-operator narrative currently runs off captured sample fixtures in `schema/samples/`. A live driver needs an aggregator-side journal writer, plus the "corrupt an operator" control itself.

## Explicitly not in this demo

- **Running the strategy.** A published vault holds its deposit as idle USDC. It does not automatically enter the leveraged loop, because that is roughly 40 strategist-only `execute` calls and nothing drives them for a user-published vault (`deploy/enter-loop.sh` drives one template vault only). An attested deposit is enough to show a vault that cannot lie about its NAV.
- **Quorum-authorised actions.** The operators attest a number, they do not authorise a move. The blocker is determinism: the loop's yield depends on the USDe incentive, which is Merkl-paid off-chain and is a hardcoded placeholder (`collateral_incentive_apr_bps`), so operators cannot agree on it. Solve that before designing anything on top.
