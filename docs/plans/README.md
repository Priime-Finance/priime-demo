# `docs/plans/`: dangling citations, explained

This directory does not exist in the checked-in repository. Source comments
across `apps/replay-ui` cite six documents inside it, by path (some also by a
section, work-package or ruling number, e.g. `A.3 #33`, `WP4`, `G1`, `R2`).
None of the six are committed here. Antoni wrote all six and deliberately
kept them untracked; his PR description says as much of the port spec
("kept untracked, never committed"). If you followed a citation and landed
on this file instead of the document it names, this page is what you get in
its place: what the document governed, reconstructed from how the code cites
it, and who to ask.

None of these entries are guesses about intent beyond what the citing
comments themselves say. Where a comment quotes or paraphrases a ruling, this
page reports that quote; it does not invent detail the code does not already
carry.

---

## `LATEST_UI_PORT_SPEC.md`

**Owner:** Antoni. **Cited:** ~63 times, in most of `apps/replay-ui`
(layout, routes, canvas, vault pages, tests, `tsconfig.json`,
`eslint.config.mjs`).

The governing spec for porting the UI from `build.priime.finance` (an
external, separate site referred to as "the kit") into this repo. Comments
cite it by lettered section (A, B, C, D, E, F), by numbered item within a
section (`A.3 #7`, `A.3 #33`, `2.17`), and by work package (`WP1`–`WP4`).
Between them, the citations cover:

- **Fonts and layout** (`A.3 #33`): the root layout owns every font face as
  a CSS variable; route layouts import CSS only.
- **The kit-verbatim carve-outs** (`A.3 #38`, `C.0.5`): `lib/canvas/**` and
  `lib/strategy-factory/**` are held byte-identical to the external kit, which
  is why `tsconfig.json` and `eslint.config.mjs` hold stylistic and strictness
  rules off those paths rather than reformatting ported code.
- **The server/client split** (`A.1`): four server-only shapes from the kit
  (Blob, KV, viem) don't travel to this repo, so `lib/canvas/server-shim.ts`
  redeclares their shapes, types only.
- **The vault pages** (`E`, `E.1`, `E.3`, `E.6`–`E.9`, `WP4.*`): `/vaults`,
  `/vaults/[slug]`, `/portfolio` and their sections (Activity, Automations,
  Performance, Verification, Attestation, Deposit rail) were ported from
  `build.priime.finance` commit `eb6d33a`, per the `/* Ported from
  build.priime.finance eb6d33a */` header on most files under
  `components/vaults/`.
- **The build canvas / copilot** (`B.1`, `B.2`, `D.1`–`D.5`, `2.2`–`2.11`):
  the composer's dock panels, the scoped copilot's owners and refusal
  strings, market scoping (`lib/demo-scope.ts`), and the chrome gate
  (`tests/chrome.test.ts`, "C, WP1 acceptance").
- **Named founder calls**, e.g. `J.1` in `lib/demo/market.ts`: the seed
  leverage the live vault is seated at on publish (2.50x).

If a citation here doesn't resolve against a section you can find some other
way, the spec itself is the only authority; ask Antoni for a copy.

## `ROUTER_LANE_PLAN.md`

**Owner:** Antoni. **Cited:** 6 times, in
`lib/demo/market.ts`, `lib/canvas/floor-pair.ts`,
`lib/canvas/scenario/hash.ts`, `lib/canvas/orchestrator/demo-rules.ts`,
`lib/canvas/orchestrator/attest.ts`, `lib/canvas/orchestrator/evaluate.ts`.

Antoni's design plan for the demo's router-between-lanes mechanism, referred
to in comments as "the founder's ruling" and cited by ruling id (`G1`, `G3`)
or plan id (`R2`, `R7`):

- **G1** (`lib/canvas/floor-pair.ts`): between a lane and its treasury-family
  floor, the router is "a SWITCH, not a band shift" (quoted directly in the
  code). The loop is fully unwound and rebuilt rather than partially
  reweighted, which is why `floor-pair.ts` hardcodes a whole-lane move for
  that one pair instead of deriving a band from the concentration dial.
- **R2** (`lib/canvas/orchestrator/demo-rules.ts`): the 48-hour sustain rule,
  quoted directly: "if the recursive loop lane has smaller yield for 48
  hours than a classic USDC lending on Aave, then the router unwinds ... and
  the opposite too." The 48 hours are fixed by this ruling; the crossing
  margin is derived, not zero.
- **G3** (`lib/demo/market.ts`): the market row's two rates are typed
  inputs, deliberately not re-typed to match the router's separately
  measured series (see `ROUTER_QUANT.md` below), each surface labelling
  which is which.
- **Plan WP-2, ruling R7** (`hash.ts`, `attest.ts`, `evaluate.ts`): these
  three modules are marked "PORTED VERBATIM" from the plan, i.e. code the
  plan itself specifies rather than describes.

## `ROUTER_QUANT.md`

**Owner:** Antoni. **Cited:** 5 times, in
`lib/canvas/router-replay.ts`, `lib/canvas/orchestrator/demo-rules.ts`,
`tests/orchestrate-route.test.ts` (3 citations).

The quant backtest write-up behind the router's numbers: per-regime move
counts (measured, whipsaw, incentive-halves, usdc-squeeze) over the aligned
history window, and the friction-bar derivation cited in `demo-rules.ts` as
"table in `docs/plans/ROUTER_QUANT.md`, section 'under the switch, measured
friction', 2026-09-07 night." `tests/orchestrate-route.test.ts` pins its
assertions to these published counts specifically so that a future change to
the router's evaluator "goes red and reaches a reader instead of quietly
redrawing the history `docs/plans/ROUTER_QUANT.md` prints." Losing the
document does not break the pins (the numbers are typed into the tests), but
it removes the only place the *why* behind those numbers is written down.

## `ROUTER_RECETTE.md`

**Owner:** Antoni. **Cited:** once, in `tests/recette-router.test.ts`.

A UAT-style "recette" (acceptance-test) matrix for the router lane, authored
2026-09-07. The test file implements what it calls "the headless half" of
it: M1 (route regimes), M2 (rules), M3 (review gating over every live-module
subset), M5 (copilot scope strings), M6 (series owners). M4 is absent from
the citing comment, so a non-headless (manual/UI) half likely exists in the
document that isn't exercised by this test file.

## `MODULE_INSTRUMENTS_RESUME.md`

**Owner:** Antoni. **Cited:** once, in `lib/canvas/lane-history-data.ts`.

Documents the "scratchpad generator" procedure used to regenerate
`lane-history-data.ts` (the two lanes' measured reserve-liquidity and
collateral-price histories) from two source JSON files. The comment is
explicit that rows in that file must never be hand-edited; regeneration goes
through the procedure this document names. Without it, the generator's
location and invocation are not recoverable from this repo.

## `strategy-factory-plan.md`

**Owner:** Antoni. **Cited:** once, in `lib/strategy-factory/types.ts`.

The plan for a separate "Strategy Factory" feature: a scanner/simulator
pipeline that produces block-pinned market snapshots and ranked strategy
candidates under a content-hash determinism gate ("Gate 1 requires identical
output for identical inputs"). Only "Phase 1, read-only discovery" is
implemented here (`lib/strategy-factory/types.ts`, the v1 Dolomite pipeline,
and `lib/strategy-factory/venues/types.ts`, a v2 multi-venue extension for
Aave v3 and Morpho Blue on Base). Later phases, if any, are described only in
the plan.

---

## Open action

**Committing the six originals is on Antoni.** Until then, this page is the
only record of what they governed, reconstructed secondhand from the code
that cites them; treat it as a pointer, not a substitute. Do not let this
README's existence become a reason to leave the documents uncommitted
indefinitely, and do not hand-edit citations across the 59 files that carry
them to work around the gap (see the closeout spec for why that
was ruled out as an integration task).
