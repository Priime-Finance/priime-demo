# @priime-demo/replay-ui

Next.js App Router UI for the verifiable-vault demo (`docs/specs/verifiable_vault_demo_spec_v1.md`, "The Vault That Cannot Lie"). One vault, its NAV independently re-executed by three operator nodes, a 2-of-3 quorum attesting the number, a corrupted node rejected on hash mismatch.

## Routes

`/` redirects to `/build`.

| Route | What it is |
| --- | --- |
| `/build` | The vault composer. Antoni's rack-canvas kit (see `priime-build-ui-kit.md`): hardware plates on a dotted board, a context dock, one market (USDe/USDC on Morpho Blue · Base), one template (leveraged loop). Install defaults, review, publish. Publish deploys a real `PriimeVault` on the target chain via `PriimeVaultFactory`, adds a workflow to the shared service, and redirects to `/vaults/loop-<id>`. |
| `/vaults` | The vaults directory. Live loops fetched from loop-server, newest first; a floor of seed vault cards is shown when the loop server is unreachable so the page never renders empty. |
| `/vaults/[slug]` | The vault page. `LiveLoopDetail` for a real published loop (attested strike ledger from loop-server, deposit/redeem cards wired to the connected wallet, subgraph panel indexed by The Graph); `VaultDetail` for a seed vault (verification canvas replaying the captured journals in `schema/samples/`). |
| `/portfolio` | Read-only portfolio view over the seed catalog; unaffected by the live loop flow. |

## Live vs replayed on `/vaults/[slug]`

`LiveLoopDetail` (real published loops) pulls three data sources: (a) `/api/loops/[id]` for the loop record and status, (b) `/api/loops/[id]/journals` for the on-chain `NavUpdated` history the loop-server derives from `handleSignedEnvelope` calldata, and (c) the Studio subgraph endpoint (`NEXT_PUBLIC_SUBGRAPH_URL`) for the independent strike ledger, deposit/redeem history and daily rollups. `SubgraphPanel` renders (c) inside the vault page as an "Indexed by The Graph" panel that polls every 30 s, so the page always has an out-of-band cross-check against the loop server's own numbers.

The pause button that used to sit on `LiveLoopDetail` is not exposed; the loop-server's `DELETE /loops/:id` guard refuses the request when the vault holds any `totalPendingDepositAssets` or `totalPendingRedeemShares`, and would strand a tester's escrow if the guard were bypassed. The API is defended regardless of client; the UI simply does not offer the trap.

`VaultDetail` (seed vaults, `heroSettlingJournal()` and friends) reads only the two captured journals in `schema/samples/` through the replay engine; that page never polls a live chain and says so next to the verification canvas. Modeled numbers are labeled `modeled`; attested numbers come from the journal and nowhere else.

## Layers

```
app/            Routes. Own React state, compose the rest.
  page.tsx            /       redirect to /build
  build/              /build  the composer: page.tsx + build.css + hm.css
  vaults/             /vaults directory + /vaults/[slug] detail page
  portfolio/          /portfolio read-only view
  api/                proxy routes: /api/loops/* -> loop-server (bearer token
                      stays in Node), /api/canvas/* -> local stubs only
  layout.tsx          fonts, metadata, favicon
  globals.css         base styles shared across routes

components/     Presentational.
  canvas/             /build rack (plates, wires, dock)
  vaults/             vault pages: LiveLoopDetail, VaultDetail, VerificationCanvas,
                      DepositCard, RedeemCard, SubgraphPanel, StrikeLedger,
                      ActivitySection, AttestationPanel, PerformanceSection,
                      SectionTabs, VaultsDirectory
  nav/, footer/       site chrome

lib/            Pure logic.
  journal.ts, source.ts, replay.ts   frozen captures + the replay engine
                                     (deriveReplayState; pacing in REPLAY_PACING)
  vaults/                            /vaults view logic: live-source (fetches),
                                     subgraph (GraphQL client), pipeline,
                                     requests (async deposits), attested formatting
  canvas/                            /build canvas logic: graph ops, templates,
                                     dock state, mock quote, serialization
  format.ts                          formatting

tests/          vitest against the real sample journals; lib/ only.
```

The seam that matters: `settleRequest` (in `lib/vaults/requests.ts`) prices a deposit from `heroSettlingJournal()`'s attested NAV and nothing else, and the Operators panel on `VaultDetail` derives every hash, NAV and quorum state from `deriveReplayState(journal, t)`. No component invents a number.

## Design laws (Antoni's system)

Cream ground, blue accents, navy hardware plates. Hanken Grotesk display in sentence case, IBM Plex Mono for all data, Fraunces italic for kickers only. Hairlines over glows. Green is status only and never colors a data number; red means danger only. Every modeled number is labeled modeled; attested numbers come only from the journal. The line "Replaying captured journal" stays on `VaultDetail`. No explorer links on replayed data, ever, and no em dashes in copy. Reference screenshots: `build-ui-steps/*.jpeg` at the workspace root.

## Environment

The UI reads these at boot:

| Variable | Purpose | Default |
| --- | --- | --- |
| `LOOP_SERVER_URL` | Server-side base URL for the `/api/loops/*` proxy. | `http://127.0.0.1:8090` |
| `LOOP_SERVER_TOKEN` | Bearer token for the proxy. Stays in Node. | `demo-token-...` (fork only) |
| `NEXT_PUBLIC_RPC_URL` | Browser-facing RPC. | `http://127.0.0.1:8545` |
| `NEXT_PUBLIC_CHAIN_ID` | Browser-facing chain id. | `31337` |
| `NEXT_PUBLIC_SUBGRAPH_URL` | Studio endpoint for the SubgraphPanel. When unset, the panel does not render. | unset |

`docs/LIVE_DEMO.md` and the top-level `README.md` describe the four-target flow (`fork`, `sepolia`, `mainnet`) end to end, including which variables `deploy/run-live-demo.sh` sets for you.

## Verification

```bash
pnpm --filter @priime-demo/replay-ui typecheck  # tsc --noEmit
pnpm --filter @priime-demo/replay-ui lint       # eslint .
pnpm --filter @priime-demo/replay-ui test       # vitest run  (pure lib/ only)
pnpm --filter @priime-demo/replay-ui build
```

All four run on every push and PR via `.github/workflows/replay-ui.yml`, cheapest gate first. `noUnusedLocals`, `noUnusedParameters` and `noUncheckedIndexedAccess` are on, so typecheck is also the dead-import check. Lint is ESLint 9 flat config with the typescript-eslint type-checked presets; run `eslint` directly, not the deprecated `next lint`.

A dev server may own `.next/` on port 3000. Build verification copies from an isolated directory and port instead:

```bash
NEXT_DIST_DIR=.next-verify pnpm build
NEXT_DIST_DIR=.next-verify npx next start -p 3117
```

`next build` re-adds `.next-verify/types/**/*.ts` to `tsconfig.json` `include`; drop that line before committing.

## The journal-schema seam

`@priime-demo/journal-schema` ships raw TypeScript source (no build step), so it is in `transpilePackages` in `next.config.mjs`. The two sample journals are imported from the repo-root `schema/` directory via the `@schema/*` path alias, so `schema/` stays the single source of truth.

## Replay pacing

The strike replay plays the captures at demo pace: relative event order preserved, gaps clamped for legibility. Tuned in one place, `REPLAY_PACING` in `lib/replay.ts`; the deposit settle delay (`STRIKE_ARRIVAL_MS` in `lib/vaults/requests.ts`) derives from it.

## Vercel

No `vercel.json`; Next.js is auto-detected. Set the project root directory to `apps/replay-ui`.
