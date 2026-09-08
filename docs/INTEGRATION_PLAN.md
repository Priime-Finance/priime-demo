# Integration plan: PR #15 onto main

Merging `antoni/router-lane` (204 files, +81k) onto `main`. Antoni's branch
predates Jakub's PR #13, which wired the frontend to loop-server.

**Working branch:** `khaled/integrate-router-lane`, cut from `main`. One PR.

---

## The problem in one paragraph

Git will merge this cleanly enough and produce a tree that compiles, ships,
and silently has no live path. Antoni deleted or rewrote every component that
mounted Jakub's wiring, so Jakub's files survive as orphans. The merge is four
re-attachments, not a conflict resolution.

| Jakub's file | Was mounted in | Antoni did |
|---|---|---|
| `Providers.tsx` (wagmi) | `app/layout.tsx` | rewrote layout, no Providers |
| `ConnectButton.tsx` | `SiteNav.tsx` | rewrote nav, uses mock `@/lib/wallet` |
| `publishLoopToServer()` | `PublishFlow.tsx` | rewrote publish to localStorage |
| `LiveVaultsSection.tsx` | `VaultDirectory.tsx` | deleted it |
| `app/vault/live/[id]` | route | 308s `/vault/*` to `/vaults/*` |

## The key simplification

Every Antoni call site imports from `@/lib/wallet`. **Keep that module path and
swap its body** from the localStorage mock to a wagmi adapter. Then `SiteNav`,
`PublishFlow`, `RackCanvas` and `PortfolioView` need zero wallet edits, and the
lanes become file-disjoint. This is what makes parallel work safe.

## Decisions taken

- **Ownership.** Antoni owns the visual layer. Jakub owns the backend. Where
  they meet, Antoni's markup renders Jakub's data. Never the reverse.
- **D1, the router.** Ships as a live-data instrument: real Morpho borrow APY
  and real Aave v3 Base USDC supply APY, real 48-hour sustain clock, no capital
  movement. The floor lane is labelled modeled. See Deferred.
- **D2, the vault page.** Antoni's `/vaults/[slug]` is the only vault page.
  Jakub's `LiveVaultDetail` markup is dropped; its data source is kept.
- **D3, the activity table.** Two labelled sources: live rows from the journal
  feed (no Verify link, there is no explorer for chain 31337), and Antoni's 9
  Base mainnet rows below, labelled as history, keeping their working links.
- **Deploy targets.** `TARGET=fork` and `TARGET=mainnet`. No Sepolia.

## Outcome

All four stages below landed. Four commits carry the merge: `749b593`
(Stage 1, mechanical merge), `17c35fc` (Stage 1.5), `3a477de` (Stage 2 wave
1, lanes B and C), `5540fbc` (Stage 2 wave 1, lane E). Lane D (this update,
plus `docs/plans/README.md`) is Stage 2 wave 2.

Lane A never ran as its own agent lane; Stage 1.5 absorbed it directly (see
that stage below), because the wallet adapter and the live-loop identity are
what every later lane's shared contract depends on, and a fan-out onto an
unfrozen contract was the failure mode the plan exists to avoid.

Three integration decisions were taken beyond what "Decisions taken" above
anticipated, once B, C and E were actually building against each other:

- **A live loop's address.** `apps/replay-ui/lib/vaults/live-id.ts` is the
  seam. loop-server mints ids as `loop-<8 hex>`, already slug-shaped and
  already distinct from every seed slug, so a live loop is reachable at
  `/vaults/loop-xxxxxxxx` with no prefix and no translation layer. Lane B's
  `PublishFlow` writes the destination (`liveLoopHref`); Lane C's
  `VaultDetail` reads it (`isLiveLoopSlug`); neither spells the pattern
  itself.
- **Two separate registers.** A real publish through `PublishFlow` no
  longer writes `lib/vaults/store.ts` at all: it POSTs to loop-server and
  redirects to the live address above. The showcase (seed vaults, plus
  whatever a composer session writes to the local store) and a real
  on-chain deployment are two distinct records with no overlap by
  construction; a live loop was never in the store to begin with.
- **The nine captured Base mainnet rows stay on the showcase only.** D3
  above planned two labelled sources on a live loop's Activity section; the
  actual call, made while building Lane C, pulled the nine rows back out
  entirely. They are evidence about the mechanism (a capture of another
  handler, on another chain, at another time) rather than about a specific
  deployment, so a freshly deployed loop with zero strikes now says so
  honestly instead of borrowing someone else's history to look less empty.

---

## Stages

### Stage 0, baseline (Khaled + Claude, serial)
Confirm `origin/main` passes the gates before anything merges into it.

### Stage 1, mechanical merge (Claude, serial)
Not parallelisable. Agents on a conflicted tree produce garbage.

1. `git merge origin/antoni/router-lane`. Take **Antoni's side wholesale** for
   every UI conflict. His tree is the product.
2. `next.config.mjs`: union. Both `transpilePackages` entries, Jakub's webpack
   aliases, Antoni's `/vault/*` redirect.
3. `pnpm-lock.yaml`: take Antoni's, then regenerate with `pnpm install`. Never
   hand-merge.
4. Accept Jakub's added files as-is, orphaned. Wire nothing yet.
5. Land a commit that typechecks and builds, with the live path knowingly dead.
   This is the fan-out point.

### Stage 1.5, freeze the shared contracts (Claude, serial)
Small, but it is what makes Stage 2 safe. Two things every later lane reads:

1. **The wallet adapter.** Rewrite `lib/wallet.ts` as a wagmi adapter keeping
   the exact export signatures Antoni's call sites use (`useAccount`,
   `useConnectModal`). Mount `<Providers>` in `layout.tsx`, delete
   `DemoWalletSheet`, invert the `chrome.test.ts:46` assertion that forbids
   Providers. This is the whole of what was Lane A.
2. **Live-loop identity.** Decide what `PublishFlow` pushes after a real
   publish and how `VaultDetail` tells a live loop from a seed or a published
   record at `/vaults/[slug]`. Lane B writes it, Lane C reads it.

Gates run here. Stage 2 does not start until this is green.

### Stage 2, parallel lanes (agents, one shared workspace)

No worktrees. Lanes run in the same tree, so two rules hold:

- **A lane edits only the files it owns.** Ownership is disjoint by path, which
  is also how a failure gets attributed.
- **A lane does not run the pnpm gates.** They read the whole project and write
  one `.next-verify`, so concurrent runs see each other's half-finished edits.
  Lanes report; Stage 3 verifies once. Lane E is the exception: it touches no
  TypeScript and runs a shell script, so it gates itself.

**Wave 1, parallel:** B, C, E. Disjoint paths, no shared type surface once
Stage 1.5 has landed.

**Wave 2, after Wave 1 is green:** D. It edits comments across B and C's files,
so it cannot run beside them.

### Stage 3, integration (Claude, serial)
Full gates. Attribute any failure by path to its lane and dispatch a fix-up
rather than fixing it silently. Then walk it by hand: blank canvas, browse
markets, install defaults, review, real connect, publish, vault page, activity.

### Stage 4, honesty pass (Claude + one agent)
Sweep every surface for a number labelled attested that is modeled, seeded or
captured. Antoni's branch is disciplined here already, so this is verification
rather than repair.

---

## Lanes

| Lane | Wave | Scope | Files owned | Agent |
|---|---|---|---|---|
| **B. Publish** | 1 | Swap `publishVault()` for `publishLoopToServer()` in `PublishFlow`. Re-apply Jakub's `candidateId` + `targetLeverage` draft hunk onto Antoni's rewritten `RackCanvas`. Map `LoopValidationError` onto Antoni's `failed` phase. Push the identity Stage 1.5 fixed. | `components/canvas/PublishFlow.tsx`, `components/canvas/RackCanvas.tsx` | Opus |
| **C. Vault page** | 1 | Biggest lane. Teach Antoni's `VaultDetail` to render a live loop from `/api/loops`, in Antoni's own markup. Mount live loops in `VaultsDirectory` using Antoni's card language. Two-source `ActivitySection` per D3. Delete Jakub's `LiveVaultDetail` / `LiveVaultsSection` markup, keep `live-source.ts`. Drop the dead `/vaults/live/[id]` route. | `components/vaults/**`, `app/vaults/**`, `vaults.css` | Opus |
| **E. Deploy targets** | 1 | Introduce `deploy/targets/{fork,mainnet}.json` and `TARGET=`. Move the three anvil cheat codes behind one `fund_account()` that branches on target: `enter-loop.sh:108` (impersonates Morpho Blue to fund the depositor), `vault-service.sh:219` (`anvil_setBalance` for operator gas), `anvil_mine`. Nothing else in the scripts is anvil-specific. **Needs Jakub's review before landing.** | `deploy/**` | Opus |
| **D. Docs** | 2 | Six planning documents (`LATEST_UI_PORT_SPEC.md`, `ROUTER_LANE_PLAN.md`, `ROUTER_QUANT.md`, `ROUTER_RECETTE.md`, `MODULE_INSTRUMENTS_RESUME.md`, `strategy-factory-plan.md`, 77 citations across 59 files) are cited from `docs/plans/` and were never committed; `TYPE_SYSTEM_RULING.md`, named when this row was planned, is no longer cited anywhere (`b9a7330` finished that ruling by hand, in code, rather than leaving it behind a citation). Landed as `docs/plans/README.md`: one entry per document naming what it governs and that committing the originals is on Antoni, rather than rewriting 77 carefully written citations. Also refreshed this document and `docs/LIVE_DEMO.md` for Lane E's deploy targets. | `docs/`, no source comments touched | Sonnet |

## Gates

From `apps/replay-ui`:

```
pnpm typecheck
pnpm lint          # 1 accepted warning: no-img-element in VintageFooter
pnpm test
NEXT_DIST_DIR=.next-verify pnpm build   # then delete .next-verify
```

**Who runs them.** Stages 0, 1, 1.5, 3 and 4 run the full set. Wave 1 lanes B
and C do not: they share one workspace and one `.next-verify`, so concurrent
runs read each other's half-finished edits. They report their diff and Stage 3
verifies once.

Lane E is the exception. It touches no TypeScript, so it gates itself with
`bash deploy/run-live-demo.sh` reaching a first strike on `TARGET=fork`.

---

## Deferred to the next iteration

Each of these is real, understood, and deliberately out of scope. Do not
quietly pick one up.

**1. The 2-of-3 quorum has never run.** Both `deploy.sh:127` and
`vault-service.sh:220` register exactly one operator at quorum 1/1, and
`loop-server/src/env.ts` defaults `QUORUM_THRESHOLD` and `QUORUM_TOTAL` to 1.
The corrupt-operator story on the Verification canvas is replayed from a
captured sample journal. `journal.ts` states that a rejected operator's
submission never reaches the manager, so the live feed can never produce it.
**Consequence for this merge: any copy claiming "2 of 3 required" on a live
surface is false and must not be shipped over live data.**

**2. The aggregator-side journal writer.** Without it the reader cannot
reconstruct rejected operators, per-operator arrival times, or real quorum
transitions. Every live journal comes out `status: settled`, `accepted: true`.
This is the same missing piece that blocks item 1.

**3. Router layer 2, the move executed on-chain.** Needs Aave v3 Base Pool in
the target config, an unwind-and-supply counterpart to `enter-loop.sh` driving
`vault.execute()`, and `vault-nav` taught to price an aUSDC position so NAV
stays attestable after the move. The decision would still be made by a trusted
EOA, not the quorum.

**4. Router layer 3, the decision attested by the quorum.** Needs journal v2
(v1 is frozen, `deny_unknown_fields`, no decision field), a component that
derives the decision from pinned-block state, and an action-authorisation path
in `PriimeVault` to replace the strategist role. **Blocker: determinism.** The
loop's yield depends on the USDe incentive, which is Merkl-paid off-chain,
excluded from NAV, and currently the hardcoded placeholder
`collateral_incentive_apr_bps: 550`. It is not readable on-chain, so operators
cannot agree on the comparison. Solve that first or the rest is unbuildable.

**5. `componentDigest` is all zeros** unless `COMPONENT_DIGEST` is set
(`env.ts`). That field exists so anyone can re-verify the component. **Done
for the one-shot path:** Lane E's `deploy/run-live-demo.sh` now reads the
digest out of the deployed `service.json` and sets it. Still open for the
manual, per-shell loop-server startup in `docs/LIVE_DEMO.md`, which does not
set it and so still prints an all-zeros digest.

**6. The router's friction bar.** Antoni derives a 1.51pp bar from a 0.19%
one-way friction estimate. Unwinding 5x leverage is 7 turns of Aerodrome swaps
against a pool holding roughly 460k USDe. Re-derive at size before that number
gates a real move. Quant owns this.

**7. Base Sepolia.** Deliberately skipped. It has no real Morpho Blue USDe/USDC
market, no Aerodrome USDe/USDC pool and no real USDe, so running there means
mock tokens, a mock market, a mock oracle and a mock pool. That is more fakery
than the mainnet fork, not less. If a narrow contract-only harness for deposit
and redemption mechanics is wanted later, that is a different thing and should
be named separately.

**8. `VAULT_SERVICE_JSON`'s default is not target-aware.**
`apps/loop-server/src/env.ts` defaults it to
`deploy/.fork/vault-service.json` unconditionally, regardless of `TARGET`.
Every caller that needs it under `TARGET=mainnet`
(`deploy/run-live-demo.sh`) works around this by passing the variable
explicitly, so the demo runs correctly either way, but the default itself
is a trap: invoke the loop server against `TARGET=mainnet` without
remembering the override and it silently reads fork state instead of
failing loudly. Either make the default target-aware or drop it and require
the variable outright, matching the `required()` idiom the rest of `env.ts`
already uses for mainnet secrets.

**9. Antoni's "Publish without connecting" affordance is gone, and his
documented walkthrough of the composer is now stale.** Lane B removed it:
under a real publish the connected address becomes the deployed vault's
strategist (its exit key), so a publish with no wallet connected has
nothing to do but fail, and a key whose only reachable outcome is a failure
card is worse than no key at all (`components/canvas/PublishFlow.tsx`,
header comment). This is a deliberate product departure from Antoni's own
walkthrough, flagged for him rather than resolved unilaterally. His
walkthrough needs updating, or his sign-off on the change, before it's
treated as current.
