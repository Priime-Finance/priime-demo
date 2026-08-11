# @priime-demo/replay-ui

Next.js App Router UI for the verifiable-vault demo (spec M5). Two routes:

| Route | What it is |
| --- | --- |
| `/` | The **living system canvas**. The vault, three operator nodes and the Base attestation node drawn as one diagram, with a NAV strike flowing through it every 12 seconds and a `corrupt` switch on each node. Fed by a client-side simulator. |
| `/debug` | The **engine harness**. Replays the two captured journals in `schema/samples/` through the real replay engine: strike selector, play/pause/scrub, raw `ReplayState` dump. Engineering tool, deliberately unstyled. |

The canvas runs on a **client-side simulator** (`lib/simulate.ts`) until the
backend exists. It says so in the masthead, under the canvas and on the chain
node, and nothing it produces is ever deep-linked to an explorer. The replay
engine and the captured-journal source are untouched and still tested: they are
what the canvas swaps onto when the live feed lands.

## Layers

Four of them, one direction. This is the rule to keep; breaking it is how the
next rewrite becomes a jenga tower.

```
app/          Routes. Own React state, compose the other three.
  page.tsx        /      : the two clocks, one derived frame, the layout
  inspectors.tsx         : the four inspector bodies (panel // 08)
  rail.tsx               : the peer + registry rail
  debug/page.tsx  /debug : the engine harness
  layout.tsx             : pre-paint theme boot
  globals.css            : the console stylesheet + both colour registers
      |
      +--> hooks/      The ONLY place a clock, a listener or a subscription lives.
      |      useSimulator.ts   the two clocks: strike interval + animation frame
      |      useCanvasMode.ts  the 760px canvas breakpoint (matchMedia)
      |
      +--> lib/        Pure. No React, no DOM, no Date.now(). Unit-tested.
      |      journal.ts        typed import of the two frozen samples
      |      source.ts         JournalSource interface + StaticJournalSource
      |      replay.ts         the engine: deriveReplayState(journal, t)
      |      simulate.ts       the simulator: nextStrike(state, config)
      |      canvas.ts         geometry: node placement, edge routes, pulses
      |      stage-view.ts     buildStageView(): the whole page's view model
      |      format.ts         BigInt NAV percentages, hashes, UTC clock
      |      environment.ts    typed view of fixtures/environment.v1.json
      |      deploy-config.ts  DEPLOY_FORM, the scripted deploy parameters
      |      copy.ts           fixed copy: the two disclaimers, blank tokens
      |      boot.ts           the ?sim-* URL params
      |
      +--> components/ Presentational. Props in, JSX out. Never imports hooks/,
             the engine, the simulator, the fixtures or the formatters — the
             page derives every value and passes preformatted strings down.

tests/          vitest, against the real sample journals. Covers lib/ only.
fixtures/       Presentation fixture data, replaced by the live backend.
styles/tokens/  Copy of priime-design-system/project/tokens/*.css.
public/fonts/   Local TTFs referenced by styles/tokens/fonts.css.
```

Two edges are narrower than "never", and both are deliberate:

- **`components/SystemCanvas.tsx` imports `lib/canvas`** for `pointAtProgress`
  and `polylinePath`. That is pure geometry with no state and no data in it —
  the ban is on the engine, the simulator and the fixtures, not on maths.
- **`lib/stage-view.ts` and `lib/copy.ts` import component prop *types***
  (`import type`, erased at build, no runtime edge). That is what makes the
  compiler catch drift between what the page derives and what the components
  will accept.

`buildStageView` is the seam that matters. Everything the page shows is a total
function of one frame — `{ journal, timeline, state, tMs, sim, corrupt,
reducedMotion, history }` plus the registry — so a frame is reproducible, and
the derivation is tested without mounting anything (`tests/stage-view.test.ts`).

## The canvas (`/`)

No transport. No play, replay or scrub. The heartbeat is ambient: a strike
fires every `STRIKE_INTERVAL_MS`, and between strikes the lamps breathe.

| Element | What it is | What drives it |
| --- | --- | --- |
| Vault door | The vault, drawn as an SVG bank-vault door (bezel, bolts, hinges, spoke handle, recessed readout). Click it to inspect. | `SimState` (NAV, LTV, health factor) + `DEPLOY_FORM` for the parameters |
| Operator plates | `node-1/2/3` from the registry fixture: status lamp, mini LCD with the last `result_hash` and NAV, quorum weight, and the `corrupt` switch | `deriveReplayState(journal, t)` per strike |
| Base node | Where the attestation lands: registry address, quorum state, simulated tx | the same `ReplayState` |
| Read wires | vault -> every operator, pulsing simultaneously when a strike fires: three independent reads of the same position at `inputs_block` | the timeline's `trigger` event |
| Submit wires | operator -> chain, one packet per submission, green when accepted, red when it diverged | the timeline's `submission` events |
| Mesh wires | the mDNS p2p mesh between all three operators (peer ids on hover) | `fixtures/environment.v1.json` |
| Strike ticker | the last 20 strikes; click one to open its detail | the simulator's history |

**The corrupt switch.** Flip it and the node is visibly sick immediately
(red lamp, red plate, a buzz in its socket), and from the **next** strike it
reports a NAV inflated 20-80%, lands on a hash of its own, and is excluded
from quorum. Un-flip it and it heals on the next strike. Flip **two** and no
hash reaches the threshold at all: the strike stalls, nothing is attested, and
the canvas says so. That is exactly why the set is three nodes at 2-of-3.

## The simulator / live-journal seam

This is the one thing to understand before wiring the backend up.

Both feeds produce the same artifact: a `Journal` conforming to the frozen
`schema/journal.v1.schema.json`. Nothing downstream of that knows which one it
got.

```
  TODAY                                 WHEN THE BACKEND LANDS
  lib/simulate.ts                       lib/source.ts
    nextStrike(state, config)             PollingJournalSource implements
      -> Journal                            JournalSource -> Journal
          |                                       |
          +---> hooks/useSimulator.ts     <-------+   (swap here, and only here)
                  buildTimeline + deriveReplayState
                        |
                        v
                  lib/stage-view.ts  buildStageView()
                        |
                        v
                  app/page.tsx -> components/
```

The swap is one hook. `JournalSource` (in `lib/source.ts`) is already async,
snapshot-returning and tolerant of an incomplete journal (`pending`/`stalled`,
null attestation, unreached quorum) precisely so a polling implementation is a
drop-in; `StaticJournalSource` serves the two captures today and `/debug`
already drives the engine through that interface. What changes is the hook that
owns the clock: instead of calling `nextStrike` on an interval it polls
`source.get(strikeId)` and re-derives. `buildStageView` and every component
below it are untouched, because they only ever see a `Journal` and a `t`.

`deriveReplayState(journal, t)` is pure: no module state, no `Date.now()`. The
caller owns the clock, so scrubbing backwards and rendering a *growing*
(pending) journal both fall out for free. `buildTimeline` compiles the journal's
own unix timestamps into a demo-paced schedule — relative order preserved
exactly, gaps clamped so every event is legible (tuned in one place,
`REPLAY_PACING`; the two captures play in 17.2 s and 15.0 s).

### Honesty rules the simulator must keep

Hashes are FNV mixes, not keccak; signatures are padding, not secp256k1; the
attestation tx hash is a placeholder marked `SIM` and is deliberately **not** a
Basescan link. A dead explorer link on a verification demo would be the exact
failure mode this product exists to catch. Simulate the *shape*, never the
*authority*. `tests/simulate.test.ts` is the contract on the shape.

## URL parameters

Invisible to a presenter; they exist so `chrome --headless=new` can park the
page on an exact frame. Parsed once at boot in `lib/boot.ts`.

| Param | Route | Values | Effect |
| --- | --- | --- | --- |
| `sim-seed` | `/` | int (default `7`) | PRNG seed. Same seed, same session. |
| `sim-interval` | `/` | ms (default `12000`) | Strike interval. Time acceleration. |
| `sim-strikes` | `/` | int (default `0`) | Pre-run this many strikes into history at boot, so the ticker is populated. |
| `sim-freeze` | `/` | ms | Freeze the animation clock at this offset **and stop scheduling strikes**. The deterministic-frame hook. |
| `corrupt` | `/` | `node-3`, or a comma list, or signing addresses | Start with these operators lying, from the first strike. |
| `strike` | `/debug` | `strike_id` | Which capture to load. |
| `t` | `/debug` | ms | Park the clock at this offset. |
| `play` | `/debug` | `1` | Start the clock running. |
| `theme` | both | `light` \| `dark` | Force a register for one page load (handled pre-paint in `app/layout.tsx`; does not touch localStorage). |

Useful frames (seed 7):

```
/?sim-seed=7&sim-strikes=6&sim-freeze=9000                 idle, breathing
/?sim-seed=7&sim-strikes=3&sim-freeze=1000                 strike mid-flight (vault -> operators)
/?sim-seed=7&corrupt=node-3&sim-strikes=3&sim-freeze=1700  red packet in flight
/?sim-seed=7&corrupt=node-3&sim-strikes=4&sim-freeze=9000  sabotage settled 2-of-3
/?sim-seed=7&corrupt=node-2,node-3&sim-freeze=9000         quorum not reached, strike stalled
```

Note that `chrome --headless --window-size=390,844` clamps to a platform
minimum window width and silently lays out wider than it captures. Drive the
narrow viewport through CDP `Emulation.setDeviceMetricsOverride` instead.

Two things are **not** deterministic even under `sim-freeze`, and a screenshot
comparison has to allow for both: the CSS animations (lamp breathe, corrupt
buzz, wheel spin) run on their own phase, and every UTC clock readout derives
from `Date.now()`. Add `--force-prefers-reduced-motion` to kill the first;
the second is a handful of pixels in the attestation panel.

## Verification

```bash
pnpm --filter @priime-demo/replay-ui typecheck  # tsc --noEmit
pnpm --filter @priime-demo/replay-ui lint       # eslint .
pnpm --filter @priime-demo/replay-ui test       # vitest run  (pure lib/ only)
pnpm --filter @priime-demo/replay-ui build
```

All four run on every push and PR via `.github/workflows/replay-ui.yml`, in
that order: cheapest gate first, the build last.

`noUnusedLocals`, `noUnusedParameters` and `noUncheckedIndexedAccess` are
enabled in `tsconfig.json`, so `tsc --noEmit` is also the dead-import check
and the reason every `arr[0]!` in the codebase is load-bearing rather than
decoration. There is no `knip`; for dead *exports*, grep.

Lint is ESLint 9 flat config (`eslint.config.mjs`), running
`next/core-web-vitals` plus `next/typescript` plus the `typescript-eslint`
*type-checked* presets. The type-aware rules are the point: floating
promises, unsafe `any` crossing a boundary and misused async handlers are
invisible to both `tsc` and a syntax-only lint. Run `eslint` directly rather
than `next lint`, which is deprecated upstream and needs no wrapper here.

### Verification builds

A dev server may own `.next/` on port 3000. Build and serve verification copies
from an isolated directory and port instead — never stomp the dev server:

```bash
NEXT_DIST_DIR=.next-verify pnpm build
NEXT_DIST_DIR=.next-verify npx next start -p 3117
```

`next build` re-adds `.next-verify/types/**/*.ts` to `tsconfig.json`
`include`; drop that line before committing.

For a before/after pixel comparison, `--dump-dom` on both builds is stricter
and cheaper than screenshots: normalise the timestamps and the seeded hashes,
and the rendered markup should be byte-identical.

## The journal-schema seam

`@priime-demo/journal-schema` ships raw TypeScript source (no build step, no
compiled `exports`), so it's added to `transpilePackages` in `next.config.mjs`
rather than prebuilt.

The two sample journals are imported directly from the repo-root `schema/`
directory (not copied into this app) via the `@schema/*` path alias in
`tsconfig.json`, so `schema/` stays the single source of truth. This worked
cleanly with Next's default webpack resolution + `resolveJsonModule` — no
`predev`/`prebuild` copy step was needed.

## Design tokens

`styles/tokens/*.css` is a copy of the design system's token files, each
stamped with its source path and copy date, and it stays pristine. The single
exception is documented at the top of `fonts.css`: the two Noto Sans JP
`@font-face` blocks and their 11 MB of TTFs were dropped, because nothing in
this app sets `font-family: "Noto Sans JP"` (`typography.css` names only Geist
and Geist Mono). No token *value* has been edited.

`colors.css` ships one theme (the light aluminium register) — no
`prefers-color-scheme` or `[data-theme]` switch exists in the token set, so
this app owns theming, entirely by remapping the semantic aliases (`--bg`,
`--text`, `--border`, ...) in `app/globals.css`.

`app/globals.css` opens with a numbered table of contents; keep new rules
inside an existing section rather than appending to the bottom.

The chassis is black; the machined controls stay aluminium (the register
switch), exactly as the kit draws them. `components/` recreates the kit's
Panel / Module / Screen / Metric / BarMeter / Badge / Chip / Field / Toggle as
typed React, styled from tokens in `globals.css`.

### The canvas is chassis, not screen

SVG `fill` cannot take a CSS gradient, so the canvas has its own **solid**
aliases (`--canvas-bg`, `--canvas-plate`, `--canvas-wire`, `--canvas-ink`,
`--vault-face-a/b`, ...) rather than reusing `--plate`, which resolves to
`--grad-card` in the light register and would silently paint nothing. Those
aliases flip with the register: a black steel vault door on the dark chassis,
a brushed-aluminium one on the light chassis. The mini LCDs inside the plates
(`.lcd`) do not flip — same rule as every other screen in the console.

### Motion

Lamps breathe on a ~3.6 s cycle, a corrupted node buzzes in its socket, the
vault handle turns while a strike is reading the position, and packets travel
their wires. Under `prefers-reduced-motion: reduce` all of that becomes state
instead of movement: no travelling dots, no buzz, no spin — a wire is simply
lit or it is not. The travelling pulses are computed in `buildStageView` from
the animation clock (not CSS), so a frozen frame renders deterministically.

## Light and dark registers

Dark is the default. Light is presenter-selectable from the switch in the
header (`components/ThemeToggle.tsx`), stored in `localStorage` under
`priime.replay-ui.theme` and re-applied by a synchronous inline script at
the top of `<body>` in `app/layout.tsx`, so a reload never flashes the wrong
chassis. There is no system-preference sniffing: a presenter picks a
register for a room, not for an OS setting.

| | dark (default) | light (`data-theme="light"`) |
| --- | --- | --- |
| page | `--k-900` + `--dash-on-black` grid | `--alu-50` + `--alu-200` grid (the kit's `.blueprint-grid`) |
| plates | `--k-800`, Panel `tone="dark"` shadow | `--grad-card` + `--e-card` (Panel `tone="light"`) |
| ink | `--alu-0` / `--ink-300` / `--g-600` | `--ink-800` / `--doc-prose` / `--doc-callout` |
| wells | `--k-900` groove | `--surface-150` (the kit's Field) |
| screens | recessed, LCD palette | **unchanged** — recessed, LCD palette |

The dark block is scoped `html:not([data-theme="light"])` rather than
`:root`, so under `[data-theme="light"]` the kit's own shipped values
survive untouched and the light register *is* the kit's default look. Only
the aliases listed under `[data-theme="light"]` in `globals.css` move off
that default, and each one carries the reason inline.

Screens do not flip: an instrument console keeps its readouts dark on a
light chassis, and the LCD micro-palette lives there. `.screen` re-declares
the dark ink and status aliases locally in light mode, so everything inside
one renders identically in both registers. The canvas's in-SVG mini LCDs
follow the same rule.

The coloured chassis inks (`--accent-ink`, `--status-ok/warn/bad`) are the
kit's light-register colours mixed a step toward `--ink-900` in light mode:
`--o-600`, `--neg`, `--ok` and `--warn` are drawn by the kit as fills and
indicators and land at 3.4–4.4:1 as 10–12px type, just under AA. Mix
percentages are the measured minimum that clears 4.5:1 on the surface each
one actually lands on.

## Vercel

No `vercel.json` — Next.js is auto-detected. When wiring up the Vercel
project, set **root directory to `apps/replay-ui`**.

## Scripts

```bash
pnpm --filter @priime-demo/replay-ui dev
pnpm --filter @priime-demo/replay-ui typecheck  # tsc --noEmit
pnpm --filter @priime-demo/replay-ui lint       # eslint .
pnpm --filter @priime-demo/replay-ui test       # vitest run
pnpm --filter @priime-demo/replay-ui build
```
