# @priime-demo/replay-ui

Next.js App Router UI for the verifiable-vault demo
(`docs/specs/verifiable_vault_demo_spec_v1.md`, "The Vault That Cannot Lie").
One vault, its NAV independently re-executed by three operator nodes, a 2-of-3
quorum attesting the number, a corrupted node rejected on hash mismatch.

Two product routes; `/` redirects to `/build`.

| Route | What it is |
| --- | --- |
| `/build` | The vault composer. Antoni's rack-canvas kit (see `priime-build-ui-kit.md`): hardware plates on a dotted board, a context dock, one market (USDe/USDC on Morpho Blue · Base), one template (leveraged loop). Install defaults, review, publish. |
| `/vault` | The published vault. Attested stat band, the Operators panel (three node cards, quorum bar, attestation block, replay / corrupt / restore controls), automation instruments, parameters, strike ledger, and async deposits that settle at the next attested NAV strike. |

Everything attested on `/vault` is read off the two captured journals in
`schema/samples/` through the replay engine; the page never polls a live
chain and says so in the Operators section. Modeled numbers are labeled
`modeled`; attested numbers come from the journal and nowhere else.

## Layers

```
app/            Routes. Own React state, compose the rest.
  page.tsx            /       redirect to /build
  build/              /build  the composer: page.tsx + build.css + hm.css
  vault/              /vault  the vault page: page.tsx + vault.css
  api/canvas/*        local stubs only: draft (204), reprice (intentional 404
                      so the client uses the offline mock quote), and the
                      opportunities catalog served from a checked-in fixture.
                      Nothing in this app contacts an external service.
  layout.tsx          fonts, metadata, favicon
  globals.css         base styles shared by both routes

components/     Presentational. canvas/ is the /build rack (plates, wires,
                dock), vaults/ is the /vault page (OperatorNodes, deposits,
                ledger), nav/ and footer/ are the site chrome.

lib/            Pure logic, unit-tested.
  journal.ts, source.ts, replay.ts   the frozen captures + the replay engine
                                     (deriveReplayState; pacing in REPLAY_PACING)
  vaults/                            /vault view logic: pipeline, requests
                                     (async deposits), attested formatting, store
  canvas/                            /build canvas logic: graph ops, templates,
                                     dock state, mock quote, serialization
  format.ts, copy.ts, boot.ts        formatting, fixed copy, URL params

tests/          vitest against the real sample journals; lib/ only.
```

The seam that matters: `settleRequest` (in `lib/vaults/requests.ts`) prices a
deposit from `heroSettlingJournal()`'s attested NAV and nothing else, and the
Operators panel derives every hash, NAV and quorum state from
`deriveReplayState(journal, t)`. No component invents a number.

## Design laws (Antoni's system)

Cream ground, blue accents, navy hardware plates. Hanken Grotesk display in
sentence case, IBM Plex Mono for all data, Fraunces italic for kickers only.
Hairlines over glows. Green is status only and never colors a data number;
red means danger only. Every modeled number is labeled modeled; attested
numbers come only from the journal. The line "Replaying captured journal"
stays. No explorer links on replayed data, ever, and no em dashes in copy.
Reference screenshots: `build-ui-steps/*.jpeg` at the workspace root.

## Verification

```bash
pnpm --filter @priime-demo/replay-ui typecheck  # tsc --noEmit
pnpm --filter @priime-demo/replay-ui lint       # eslint .
pnpm --filter @priime-demo/replay-ui test       # vitest run  (pure lib/ only)
pnpm --filter @priime-demo/replay-ui build
```

All four run on every push and PR via `.github/workflows/replay-ui.yml`,
cheapest gate first. `noUnusedLocals`, `noUnusedParameters` and
`noUncheckedIndexedAccess` are on, so typecheck is also the dead-import
check. Lint is ESLint 9 flat config with the typescript-eslint type-checked
presets; run `eslint` directly, not the deprecated `next lint`.

A dev server may own `.next/` on port 3000. Build verification copies from an
isolated directory and port instead:

```bash
NEXT_DIST_DIR=.next-verify pnpm build
NEXT_DIST_DIR=.next-verify npx next start -p 3117
```

`next build` re-adds `.next-verify/types/**/*.ts` to `tsconfig.json`
`include`; drop that line before committing.

## The journal-schema seam

`@priime-demo/journal-schema` ships raw TypeScript source (no build step), so
it is in `transpilePackages` in `next.config.mjs`. The two sample journals are
imported from the repo-root `schema/` directory via the `@schema/*` path
alias, so `schema/` stays the single source of truth.

## Replay pacing

The strike replay plays the captures at demo pace: relative event order
preserved, gaps clamped for legibility. Tuned in one place, `REPLAY_PACING`
in `lib/replay.ts`; the deposit settle delay (`STRIKE_ARRIVAL_MS` in
`lib/vaults/requests.ts`) derives from it.

## Vercel

No `vercel.json`; Next.js is auto-detected. Set the project root directory
to `apps/replay-ui`.
