# Demo Closeout v1: what is left to make the walkthrough real

**Status:** Task list, no further development in this run | **Date:** 2026-09-08
**Companion to:** `verifiable_vault_demo_spec_v1.md` (the beats this closes)

## The walkthrough we want

One person, one laptop, no help:

1. Clone, start a Base fork, bring up the service.
2. Import a funded demo wallet into MetaMask, connect it.
3. Compose a vault on `/build` and publish it. A real handler deploys.
4. Deposit simulated USDC from their own wallet.
5. Watch three operators re-execute the NAV and a **2-of-3 quorum** attest it.
6. Press "corrupt an operator" and watch the lie get outvoted.

Steps 1 to 4 work today, except the deposit has no button. **Steps 5 and 6 do
not exist**, and they are the whole claim.

## What already works

Compose and publish is real: seven clicks deploy a `PriimeVault` on the fork
with the connected wallet as strategist, and the operator attests its NAV
every 10 seconds. A deposit made by hand is escrowed, folded at the next
strike, and shows as attested NAV on the vault page. Verified end to end on
2026-09-08.

---

## The tasks

### 1. Three operators, 2-of-3. **Blocking. Jakub.**
`deploy/deploy.sh:127` and `deploy/vault-service.sh:220` each register exactly
one operator, and `apps/loop-server/src/env.ts` defaults `QUORUM_THRESHOLD`
and `QUORUM_TOTAL` to 1. **The demo's headline claim has never run.** Beats 2
and 3 of the original spec both need it; with fewer than three nodes a corrupt
operator stalls the quorum instead of being outvoted.

Needs: three signing keys, three registrations, threshold 2, and the node
topology to match (the spec says three nodes). The frontend already prints
whatever the journal reports, so nothing changes there.

### 2. One loop attests, the second does not. **Blocking. Jakub.**
Publish a second vault and it never gets a strike. Every loop is given
`cronSeconds: 10`, so all workflows fire on the same boundary and the
aggregator submits them from one signer: they race for a nonce and all but one
are dropped. Observed live: **168 `replacement transaction underpriced`
errors, 28 failed submissions**, first vault 116 updates, second vault zero.

An audience will publish a second vault. Cheapest fix is staggering the cron
per loop; properly, serialise submissions or give each workflow its own
submitter.

### 3. The sabotage beat. **Blocking for beat 3. Jakub.**
`packages/loop-deploy/src/journal.ts` states it: a rejected operator's
submission never reaches the manager, so a journal rebuilt from chain is
always `status: settled` with `accepted: true` on every signer. The corrupt
operator story currently runs off captured sample fixtures and cannot be
driven live. Needs an aggregator-side journal writer, plus the "corrupt an
operator" control itself.

### 4. A deposit button. **Small. Frontend.**
`requestDeposit` is permissionless and the NAV component already prices idle
USDC correctly (`nav = collateral + folded_idle - debt`). The live loop page
just has no rail. Two calls from the connected wallet, `approve` then
`requestDeposit`, then show pending until the next strike folds it. Nothing in
loop-server is involved; that was a wrong assumption during integration.

### 5. Hand the user a funded wallet. **Small. Scripts.**
`deploy/run-live-demo.sh` should mint a key, fund it, and print the import
instructions. Recipe, verified:

- Generate a **fresh random key**. Do not use the well-known Anvil accounts:
  on a Base fork they inherit EIP-7702 delegations from mainnet and carry
  code, which is avoidable confusion.
- ETH via `anvil_setBalance`; USDC by impersonating Morpho Blue, the largest
  holder at the pinned block (`fund_account` in `deploy/target.sh` already
  does both).
- Print: RPC `http://127.0.0.1:8545`, chain id `31337`, and the key to import.
- Tell the user to reset MetaMask's account data if they restart the fork,
  since it caches nonces.

### 6. `apps/replay-ui/.env.example`. **Trivial.**
Lists only the two `ANTHROPIC_` keys. Add `LOOP_SERVER_URL`,
`LOOP_SERVER_TOKEN`, `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_CHAIN_ID`. Cosmetic
now that all four default to the fork, but it is the file people read first.

---

## Explicitly not in this demo

**Running the strategy.** A published vault holds its deposit as idle USDC. It
does not enter the leveraged loop, because that is roughly 40 strategist-only
`execute` calls and nothing drives them for a user-published vault
(`deploy/enter-loop.sh` drives the template vault only). An attested deposit
is enough to show a vault that cannot lie about its NAV; leave it.

**Quorum-authorised actions.** The operators attest a number, they do not
authorise a move. The blocker is determinism: the loop's yield depends on the
USDe incentive, which is Merkl-paid off-chain and is a hardcoded placeholder
(`collateral_incentive_apr_bps`), so operators cannot agree on it. Solve that
before designing anything on top.

**Base mainnet.** `TARGET=mainnet` exists and defaults nothing, but has never
been run. Needs funded keys and a decision about real capital.
