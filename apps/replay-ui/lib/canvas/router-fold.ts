/**
 * THE ROUTER REPLAY, FOLDED OVER MEASURED HISTORY (plan WP-2, rulings R2/R3/R6).
 *
 * `foldRouterRun(regime)` builds ONE tick per captured day out of
 * `lib/canvas/router-history.ts`, folds those ticks through the ported
 * `evaluateOrchestrator`, and answers the `RouterRun` shape `LanePanel.tsx`
 * declares (its lines 988 to 1075), plus `ok` and `modeled`.
 *
 * ── ONE FOLD, TWO READERS (integration, WP-3's cross-package request 4) ───
 * It lives in `lib` rather than in the route because TWO surfaces state what
 * the measured 89 days produced: the dock's run panel, through
 * `GET /api/canvas/orchestrate`, and the vault page's Capital router
 * instrument, through `measuredRouterReplay()` in `lib/canvas/router-replay.ts`.
 * Both call THIS function. The instrument shipped its own hand fold while the
 * route did not exist yet, and a hand fold is measurably not the same machine:
 * it walks the state transitions itself and does not rank a destination
 * through `selectDestination`, gate a firing on payback, or lock a reverse
 * edge until the last move has paid back. On `measured` the two agreed; on
 * `whipsaw` a hand fold takes five moves where the evaluator takes three.
 * Two answers to "how many moves did the measured 90 days produce" is the
 * defect the shipping harness names, so there is one answer and this is it.
 *
 * ── WHY IT IS SYNCHRONOUS ────────────────────────────────────────────────
 * The instrument renders synchronously, so the fold cannot be async. Nothing
 * in it ever was: `rulesHash` is `sha256Hex(canonicalRules(rules))` behind an
 * async signature, and `sha256Hex` is the package's own synchronous
 * implementation. `rulesHashSync` below is that one line, and
 * `tests/orchestrate-route.test.ts` asserts it equals `await rulesHash(rules)`
 * on the rule set this fold actually builds, so the identity the panel prints
 * cannot drift from the shipped owner.
 *
 * ── IT REPLAYS, IT DOES NOT GENERATE ─────────────────────────────────────
 * The live app's route at the same path folds a SEEDED synthetic funding
 * scenario. Plan R7 ports the evaluator and nothing else, so there is no
 * generator here and no seed: the ticks are the 89 days all three sources
 * published on, and a stress regime is a TRANSFORM of those days rather than
 * a different draw. `scenario.seed` is therefore 0, which is the stated
 * absence rather than a number a reader could act on, and the panel's footer
 * prints `scenario.calibratedTo` (the capture instant) in its place.
 *
 * ── EVERY NUMBER HAS AN OWNER AND THIS FILE IMPORTS IT ───────────────────
 *   the two published series      `loopPublishedApyByDay` / `floorPublishedApyByDay`
 *                                 (through `loopRowForDay` / `floorRowForRate`
 *                                 on the transformed rows, which is the same
 *                                 pair of owners one day at a time)
 *   the bar, the re-arm, the
 *   48 hours and the move size    `lib/canvas/orchestrator/demo-rules.ts`
 *   the risk-adjusted frame       `riskAdjUnified`, the shipped owner
 *   the band, the budget and the
 *   whole-lane move weight        `lib/canvas/floor-pair.ts`
 *   the seat the run opens on     `lib/canvas/floor-pair-seat.ts`
 *   the price of a move           `demoRouterExitProfile`, the pair's own
 *                                 measured rail, through the evaluator's hook
 *   the book the friction is
 *   quoted against                `DEMO_ROUTER_BOOK_USD`
 * Nothing below re-derives an APY, a threshold, a friction or a weight.
 *
 * ── THE SLOTS ARE BUILT BY HAND, AND THAT IS A STATED CHOICE ─────────────
 * `slotsFromPortfolio(p)` takes a `PortfolioGraph`, which is CLIENT state:
 * the rack lives in `RackCanvas` and no portfolio exists on the server for
 * this route to read. The two slots below are therefore built by hand, field
 * for field in the shape that builder produces, with the same derivations:
 * `maxWeight` and `minWeight` from `lib/canvas/floor-pair.ts` (the switch's
 * own band, G1), `cls` from the row, and
 * `metrics` false on both axes because neither lane seats a perp leg. This
 * is the same slot pair `tests/router-backtest.test.ts` folds, so the route
 * and the quant's gate are measuring one portfolio.
 *
 * ── THE TRANSFORMS ARE DEFINED HERE, AND THAT IS ALSO STATED ─────────────
 * The quant's module exports no transform: the four regimes live in
 * `tests/router-backtest.test.ts`, a test file, which no production module
 * may import. They are therefore defined ONCE here, with the same anchors,
 * the same sizes and the same growing-run whipsaw the backtest ran.
 *
 * ⚠ THE TRANSFORMS AGREE AND THE FOLDS DO NOT, ON ONE REGIME, MEASURED AND
 * STATED RATHER THAN PAPERED OVER. The backtest is a HAND FOLD: it walks the
 * days itself over `advanceRuleState`, `applyMove` and the edge locks. This
 * route folds the SHIPPED `evaluateOrchestrator`, which additionally ranks a
 * destination through `selectDestination`, gates each firing on payback and
 * locks the reverse edge until the last move has paid back. On `measured`,
 * `incentive-halves` and `usdc-squeeze` the two agree exactly, one move each.
 * On `whipsaw` they do not: the hand fold takes five moves, and this route
 * reproduces its first three (2026-06-12 loop to floor 10.0pp, 2026-07-24 and
 * 2026-08-05 floor to loop) and then REFUSES the fourth and fifth, at
 * 2026-08-16 on the reverse-edge lock and at 2026-08-28 on the concentration
 * band. The shipped machine is the stricter of the two, which is the
 * direction a protection ratchet should err in, but the printed backtest's
 * whipsaw row and this panel's whipsaw run are then two different counts.
 * `tests/orchestrate-route.test.ts` pins BOTH the agreement and the
 * divergence so neither can move without a test going red, and the
 * disagreement is carried to the quant as a cross-package finding rather
 * than reconciled here by editing an owner this package does not own.
 */

import { publishedNetApy, repriceAtLeverage } from "@/lib/canvas/mock-quote";
import { marketKeyOf } from "@/lib/canvas/ids";
import { canonicalRules, riskAdjUnified } from "@/lib/canvas/orchestrator";
import {
  DEMO_ROUTER_BOOK_USD,
  DEMO_SUSTAIN_PINS_DAILY,
  DEMO_UPGRADE_THRESHOLD,
  demoDeriveAllRouterRules,
  demoRouterExitProfile,
  validateDemoRouter,
} from "@/lib/canvas/orchestrator/demo-rules";
import { demoFloorPairSeat } from "@/lib/canvas/floor-pair-seat";
import {
  FLOOR_LANE_LABEL,
  FLOOR_PAIR_MAX_CONCENTRATION_PCT,
  FLOOR_PAIR_MAX_WEIGHT,
  FLOOR_PAIR_MIN_WEIGHT,
  FLOOR_PAIR_TURNOVER_PCT_WEEK,
} from "@/lib/canvas/floor-pair";
import { decisionIdOf, unresolvedReferences } from "@/lib/canvas/orchestrator/attest";
import { evaluateOrchestrator } from "@/lib/canvas/orchestrator/evaluate";
import type { AttestedDecision } from "@/lib/canvas/orchestrator/types";
import type {
  OrchTick,
  SlotObservation,
  SlotReading,
  SlotStatics,
} from "@/lib/canvas/orchestrator/evaluate";
import type { LoopSlot, OrchRule, OrchestratorConfig } from "@/lib/canvas/orchestrator/types";
import { clampOrchDials, ORCH_DIAL_DEFAULTS } from "@/lib/canvas/param-schema";
import { contentHash, sha256Hex } from "@/lib/canvas/scenario/hash";
import {
  DEFAULT_REGIME,
  isRegimeId,
  REGIME_LABEL,
  type RegimeId,
} from "@/lib/canvas/scenario/regime-ids";
import {
  ROUTER_FLOOR_CANDIDATE_ID,
  ROUTER_HISTORY_ALIGNED,
  ROUTER_HISTORY_CAPTURED_AT,
  floorRowForRate,
  loopRowForDay,
  type RouterHistoryAlignedRow,
} from "@/lib/canvas/router-history";
import {
  TREASURY_CANDIDATES,
  issuerRedemptionTerms,
  settlementDaysOf,
} from "@/lib/canvas/templates";
import { DEMO_MARKET_ID, HERO_SEED_LEVERAGE, demoMarketCandidate } from "@/lib/demo/market";


/** The two lanes, named once and exported, because `router-replay.ts` reads
 *  the same two slot ids off this fold's decisions and weights. */
export const ROUTER_LOOP_SLOT = "loop";
export const ROUTER_FLOOR_SLOT = "floor";

/** The shipped identity, one line, synchronous. See the header. */
function rulesHashSync(rules: OrchRule[]): string {
  return sha256Hex(canonicalRules(rules));
}

/* `floor` sorts before `loop`, which is the order `demoDeriveAllRouterRules`
   emits rules in. Aliased locally so the body below reads as it was written. */
const LOOP_SLOT = ROUTER_LOOP_SLOT;
const FLOOR_SLOT = ROUTER_FLOOR_SLOT;

/**
 * THE SEAT THE RUN OPENS ON, AND IT IS NOT A SPLIT (fix wave 2, ruling 2).
 *
 * A switch holds ONE lane: between firings the book is entirely in the lane
 * the rule holds, and `lib/canvas/floor-pair-seat.ts` is the one owner of
 * which. It was an even 50/50 here, which made the replay open in a position
 * the machine is never in and printed every first move as a half-move: the
 * measured run's own first decision read `50.0pp` out of a 100% rule, because
 * the lane it evacuated only held half the book.
 *
 * The canvas, the published record and this fold all read the same seat, so
 * the run panel opens on the allocation the plate draws.
 *
 * IT IS READ INSIDE THE FOLD, NEVER AT MODULE LOAD. `demoFloorPairSeat`
 * reaches the capture, which reaches `templates`, and a module body that
 * evaluates that graph on import is the F6 shape this package already paid
 * for once.
 */
function seatWeights(): { loop: number; floor: number } {
  const loop = demoFloorPairSeat() === "loop" ? 1 : 0;
  return { loop, floor: 1 - loop };
}

/** One tick is one captured day, so a turnover week is seven of them. The
 *  evaluator has no opinion about how long a week is on a stream it did not
 *  generate; this is the caller's clock and it is stated once. */
const BUDGET_WINDOW_TICKS = 7;

// ── The regimes, as transforms of the measured rows ───────────────────────

/**
 * THE TRANSFORMS ARE ANCHORED TO DATES, NOT TO ARRAY POSITIONS, so a regime
 * is one event on one calendar rather than a different event in every window.
 */
const alignedIndexOf = (date: string): number =>
  ROUTER_HISTORY_ALIGNED.findIndex((r) => r.date === date);

/** Two days after the USDe incentive first paid. */
const HALVE_FROM = "2026-07-25";
/** The squeeze, and its size is SIZED TO THE BAR rather than picked: the plan
 *  asked for 3pp of supply lift, which is only 2.4pp of published lift after
 *  the compute fee, and against a loop leading by about 0.3pp it moved this
 *  router not at all. 5pp of supply is 4pp published, which clears
 *  `DEMO_UPGRADE_THRESHOLD` with room at every bar the sensitivity folds. The
 *  number the bar itself is is NOT retyped here: this is a stress transform,
 *  and its one job is to be big enough that the regime is a crossing. */
const SQUEEZE_FROM = "2026-08-10";
const SQUEEZE_DAYS = 20;
const SQUEEZE_LIFT = 0.05;
/** The whipsaw's square wave on the Aave input, and its growing run lengths. */
const WHIPSAW_AMPLITUDE = 0.07;

function whipsawSign(index: number): number {
  let cursor = 0;
  let run = 2;
  let sign = 1;
  while (cursor + run <= index) {
    cursor += run;
    run += 1;
    sign = -sign;
  }
  return sign;
}

export const REGIME_TRANSFORM: Record<
  RegimeId,
  (rows: readonly RouterHistoryAlignedRow[]) => RouterHistoryAlignedRow[]
> = {
  measured: (rows) => [...rows],
  "incentive-halves": (rows) =>
    rows.map((r) => (r.date >= HALVE_FROM ? { ...r, loopRewardApr: r.loopRewardApr * 0.5 } : r)),
  "usdc-squeeze": (rows) => {
    const from = alignedIndexOf(SQUEEZE_FROM);
    return rows.map((r) => {
      const i = alignedIndexOf(r.date);
      return i >= from && i < from + SQUEEZE_DAYS
        ? { ...r, aaveUsdcSupplyApy: r.aaveUsdcSupplyApy + SQUEEZE_LIFT }
        : r;
    });
  },
  whipsaw: (rows) =>
    rows.map((r) => ({
      ...r,
      aaveUsdcSupplyApy: r.aaveUsdcSupplyApy + whipsawSign(alignedIndexOf(r.date)) * WHIPSAW_AMPLITUDE,
    })),
};

// ── The two lanes' rows ───────────────────────────────────────────────────

const FLOOR_ROW = TREASURY_CANDIDATES.find((c) => c.id === ROUTER_FLOOR_CANDIDATE_ID) ?? null;

/** The issuer's own published window, never a house constant. `instant-usdc`
 *  settles same block, so this is 0 by measurement and not by assumption. */
function floorSettlementDays(): number {
  const terms = issuerRedemptionTerms(ROUTER_FLOOR_CANDIDATE_ID);
  return terms ? settlementDaysOf(terms) : 0;
}

/**
 * The observation a hash is a hash OF. Same preimage the live route uses, so
 * two runs of the same day on the same reading mint the same pointer.
 */
function observationHash(marketKey: string, r: SlotReading): string {
  return contentHash({
    marketKey,
    netApyOnDepositApy: r.netApyOnDepositApy,
    capacityUsd: r.capacityUsd,
    fundingP25Apr: r.fundingP25Apr,
    curBasisDev: r.curBasisDev,
    eligible: r.eligible,
  });
}

/** One lane's reading for one day, in the frames the derived rules read them
 *  in: the venue frame for the scan gate, the published frame for the chart
 *  and the ranking, one owner each. */
function readingOf(
  venueNet: number | null,
  published: number | null,
  capacityUsd: number | null,
  leverage: number,
): SlotReading {
  return {
    netApyOnDepositApy: venueNet,
    capacityUsd,
    /* Neither lane carries a perp leg or a basis reading, so both are null
       rather than zero: a zero here is a measurement and these are absences. */
    fundingP25Apr: null,
    curBasisDev: null,
    eligible: true,
    statusLive: true,
    emergency: false,
    publishedNetApy: published,
    riskAdjUnified: published === null ? null : riskAdjUnified(published, leverage, null),
  };
}

/**
 * The fold's answer. The panel consumes it as its own `RouterRun` projection
 * over the wire, so the index signature stays; the five members named here
 * are the ones the SECOND reader (`lib/canvas/router-replay.ts`) folds no
 * further, and naming them is what stops that reader from casting `unknown`
 * back into a shape it would then be free to get wrong.
 */
interface RunAnswer {
  ok: true;
  modeled: true;
  /** One `YYYY-MM-DD` per tick, in tick order: the fold's own calendar. A day
   *  neither lane could be priced on is dropped from both this and `ticks`,
   *  so a tick index is a position in THIS array and never in the capture. */
  days: string[];
  scenario: { hash: string; seed: number; ticks: number; calibratedTo: string };
  decisions: AttestedDecision[];
  weights: Record<string, number>;
  laneSeries: { carryPublishedApy: number[]; floorPublishedApy: number[]; carryCapacityUsd: number[] };
  [k: string]: unknown;
}

/**
 * ONE FOLD, PARAMETERISED, so the gate and the product measure one machine.
 *
 * `foldRouterRun` is this function on the aligned window at the shipped bar.
 * `tests/router-backtest.test.ts` is this function on a chosen window at a
 * chosen bar, which is what makes the sensitivity table (G2) a measurement of
 * the SHIPPED evaluator rather than of a hand fold that happens to agree with
 * it on three regimes out of four. The tick builder lives here and there is
 * only one of it.
 */
export interface RouterScenarioFold {
  regime: RegimeId;
  /** One `YYYY-MM-DD` per tick, in tick order. */
  days: string[];
  /** The two published series over those days, fee inside. */
  loopPublishedApy: number[];
  floorPublishedApy: number[];
  loopCapacityUsd: number[];
  cfg: OrchestratorConfig;
  result: ReturnType<typeof evaluateOrchestrator>;
  scenarioHash: string;
  orchestratedTvlUsd: number;
  /** The observation hashes this run minted, for the reference check. */
  observations: Map<string, { slotId: string; tick: number }>;
  settlementDays: number;
}

export function foldRouterScenario(args: {
  regime: RegimeId;
  /** Defaults to the whole aligned window. A shorter window is a WINDOW, not
   *  a different history: the transforms are date-anchored, so a regime is the
   *  same event on the same calendar in both. */
  rows?: readonly RouterHistoryAlignedRow[];
  /** Defaults to the shipped bar. Any other value is a sensitivity fold and
   *  the caller states which window it was folded over (F7). */
  bar?: number;
}): RouterScenarioFold {
  const regime = args.regime;
  const bar = args.bar ?? DEMO_UPGRADE_THRESHOLD;
  const rows = REGIME_TRANSFORM[regime](args.rows ?? ROUTER_HISTORY_ALIGNED);

  const loopBase = demoMarketCandidate();
  if (!FLOOR_ROW) throw new Error(`the floor row ${ROUTER_FLOOR_CANDIDATE_ID} is not in TREASURY_CANDIDATES`);

  // ── The slots ───────────────────────────────────────────────────────────
  /* THE SWITCH'S OWN BAND AND BUDGET (G1). The pair is banded [0, 1] so a
     firing can evacuate a lane and rebuild it, the concentration dial states
     the same ceiling the band carries, and the weekly budget admits exactly
     ONE full move: a second inside the same seven ticks is refused by the
     budget rather than sized down. All four numbers come from
     `lib/canvas/floor-pair.ts`; nothing here retypes one, and
     `clampConcentrationPct` is deliberately NOT applied to the published
     ceiling, because clamping it would put the dial back inside a range the
     slots no longer obey. */
  const dials = clampOrchDials({
    ...ORCH_DIAL_DEFAULTS,
    turnoverBudgetPctWeek: FLOOR_PAIR_TURNOVER_PCT_WEEK,
  });
  const maxWeight = FLOOR_PAIR_MAX_WEIGHT;
  const minWeight = FLOOR_PAIR_MIN_WEIGHT;
  const seat = seatWeights();
  const slots: LoopSlot[] = [
    {
      slotId: LOOP_SLOT,
      venue: String(loopBase.venue ?? ""),
      candidateId: DEMO_MARKET_ID,
      marketKey: marketKeyOf(DEMO_MARKET_ID),
      cls: loopBase.cls === "N1" ? "N1" : "A",
      targetWeight: seat.loop,
      minWeight,
      maxWeight,
      /* NULL, and it is load-bearing. `ECON_FLOOR_APY` is the levered-loop
         SCAN gate and this market never passed through one: the scan snapshot
         lists it under `ineligible`. Handing it a screen it was never admitted
         through would leave an evacuation rule permanently breaching, and
         `evaluate.ts`'s `evacuationBreaching` would then disqualify the loop
         as a DESTINATION, which silently deletes the founder's return leg. */
      screenedAtApy: null,
      metrics: { funding: false, basis: false },
    },
    {
      slotId: FLOOR_SLOT,
      venue: FLOOR_ROW.venue,
      candidateId: ROUTER_FLOOR_CANDIDATE_ID,
      marketKey: marketKeyOf(ROUTER_FLOOR_CANDIDATE_ID),
      cls: FLOOR_ROW.cls === "N1" ? "N1" : "A",
      targetWeight: seat.floor,
      minWeight,
      maxWeight,
      screenedAtApy: null,
      metrics: { funding: false, basis: false },
    },
  ];

  /* THE CONFIG IS `buildOrchestratorConfig`'S OWN SHAPE, with ONE substitution:
     the rules come from `demoDeriveAllRouterRules` rather than
     `deriveAllOrchRules`, because the founder's 48 hours and the quant's
     derived bar are what this replay is about. Every other field, including
     the lane-count clamp on the published dial, is that builder's line for
     line. `validateDemoRouter` then re-checks every invariant and clears R38
     only after re-deriving from the same pure function. */
  const rules = demoDeriveAllRouterRules(dials, slots, DEMO_SUSTAIN_PINS_DAILY, bar);
  const cfg: OrchestratorConfig = {
    v: 1,
    loops: [...slots].sort((a, b) => a.slotId.localeCompare(b.slotId)),
    dials: {
      ...dials,
      maxConcentrationPct: FLOOR_PAIR_MAX_CONCENTRATION_PCT,
    },
    rules,
    /* THE SHIPPED OWNER, awaited. `rulesHash` is the Web Crypto sha-256 over
       `canonicalRules`, which is the hash a compiled record carries; hashing
       the rule objects with `contentHash` here would be a second spelling of
       the same policy identity and the panel's `policy` line would then not
       match anything else in the product. */
    rulesHash: rulesHashSync(rules),
  };
  const violations = validateDemoRouter(cfg, DEMO_SUSTAIN_PINS_DAILY, bar);
  if (violations.length > 0) {
    throw new Error(
      `the replay's config violates ${violations.length} invariants: ${violations[0]?.invariant}: ${violations[0]?.detail}`,
    );
  }

  // ── The ticks, one per captured day ─────────────────────────────────────
  const settlementDays = floorSettlementDays();
  const statics: Record<string, SlotStatics> = {
    [LOOP_SLOT]: {
      venue: slots[0].venue,
      /* An unwind plus a spot sale rather than a redemption request, so the
         window is the structural 0 every non-issuer row carries. */
      settlementDays: 0,
      observationsPerDay: 1,
      /* One reading per day on both series, so a ref one tick old is stale. */
      cadenceBudgetTicks: 1,
    },
    [FLOOR_SLOT]: {
      venue: slots[1].venue,
      settlementDays,
      observationsPerDay: 1,
      cadenceBudgetTicks: 1,
    },
  };

  const ticks: OrchTick[] = [];
  const observations = new Map<string, { slotId: string; tick: number }>();
  const days: string[] = [];
  const laneSeries = {
    carryPublishedApy: [] as number[],
    floorPublishedApy: [] as number[],
    carryCapacityUsd: [] as number[],
  };

  let t = 0;
  for (const row of rows) {
    const loopRow = repriceAtLeverage(loopRowForDay(row), HERO_SEED_LEVERAGE);
    const floorRow = floorRowForRate(row.aaveUsdcSupplyApy);
    const loopPublished = publishedNetApy(loopRow, false);
    const floorPublished = publishedNetApy(floorRow, false);
    /* A day either lane cannot be priced on is DROPPED, never filled: a
       carried-forward number in a chart the founder reads as history is the
       one thing the capture refuses to do. On the aligned window this never
       fires, because the economics are present by construction. */
    if (loopPublished === null || floorPublished === null) continue;

    const loopCapacity = loopRow.economics?.capacityUsd ?? null;
    const floorCapacity = floorRow?.economics.capacityUsd ?? null;

    days.push(row.date);
    laneSeries.carryPublishedApy.push(loopPublished);
    laneSeries.floorPublishedApy.push(floorPublished);
    laneSeries.carryCapacityUsd.push(loopCapacity ?? 0);

    const loopReading = readingOf(
      loopRow.economics?.netApyOnDepositApy ?? null,
      loopPublished,
      loopCapacity,
      HERO_SEED_LEVERAGE,
    );
    const floorReading = readingOf(
      floorRow?.economics.netApyOnDepositApy ?? null,
      floorPublished,
      floorCapacity,
      /* Unlevered by construction (`loopLeverage` 1 on the row). */
      1,
    );

    const loopHash = observationHash(slots[0].marketKey, loopReading);
    const floorHash = observationHash(slots[1].marketKey, floorReading);
    observations.set(loopHash, { slotId: LOOP_SLOT, tick: t });
    observations.set(floorHash, { slotId: FLOOR_SLOT, tick: t });

    const refs: Record<string, SlotObservation> = {
      [LOOP_SLOT]: {
        /* `modeled` is the honest kind: this is a captured rate replayed, not
           a block this node watched. `seq` is the tick and the label is the
           day, so a receipt names the date rather than an ordinal. */
        ref: { kind: "modeled", seq: t, hash: loopHash, label: `day ${row.date}` },
        reading: loopReading,
      },
      [FLOOR_SLOT]: {
        ref: { kind: "modeled", seq: t, hash: floorHash, label: `day ${row.date}` },
        reading: floorReading,
      },
    };
    /* `nowMs` is the DAY'S OWN midnight, never `Date.now()`: `cooldownMs` is
       denominated in real milliseconds by ruling, and a wall clock would make
       the run irreproducible. */
    ticks.push({ tickIndex: t, nowMs: Date.parse(`${row.date}T00:00:00.000Z`), refs });
    t += 1;
  }

  const scenarioHash = contentHash({
    regime,
    capturedAt: ROUTER_HISTORY_CAPTURED_AT,
    days: rows.map((r) => [r.date, r.aaveUsdcSupplyApy, r.loopRewardApr, r.loopBorrowApy]),
  });

  const orchestratedTvlUsd = DEMO_ROUTER_BOOK_USD;

  const result = evaluateOrchestrator({
    cfg,
    ticks,
    orchestratedTvlUsd,
    statics,
    /* No seed: see the header. The regime IS the run's identity here. */
    scenario: { hash: scenarioHash, seed: 0, regime },
    budgetWindowTicks: BUDGET_WINDOW_TICKS,
    /* ONE FRICTION FOR ONE MOVE. Without this the fold published a bar derived
       from the measured 18.6 bps rail and then charged `exitProfileFor`'s flat
       70 bps in every cost record, which `paybackMs` turned into an effective
       2.84pp bar the rule never stated. The hook is the evaluator's own (the
       one addition to that port) and the profile is `demo-rules`', scoped by
       the same predicate as the rest of the switch: hand it a portfolio that
       is not this pair and it answers `exitProfileFor` unchanged. */
    exitProfile: demoRouterExitProfile(slots.map((s) => s.candidateId)),
  });

  /* THE RUN MUST NEVER ADVERTISE A REFERENCE THAT DOES NOT RESOLVE, and every
     decision id must be re-mintable from the four fields the record carries.
     Both checks run HERE rather than in a test, so the route cannot answer
     with a record that fails them. */
  const resolves = (hash: string) => hash === scenarioHash || observations.has(hash);
  const unresolved = result.decisions.flatMap((d) =>
    unresolvedReferences(d, resolves).map((p) => `${d.decisionId}: ${p}`),
  );
  if (unresolved.length > 0) {
    throw new Error(`the run advertises ${unresolved.length} unresolvable references: ${unresolved[0]}`);
  }
  for (const d of result.decisions) {
    const again = decisionIdOf({
      rulesHash: d.rulesHash,
      ruleId: d.rule.ruleId,
      sourceHash: d.observed[d.moved.sourceSlotId]?.hash ?? "",
      destHash: d.moved.destSlotId === "pause" ? "" : (d.observed[d.moved.destSlotId]?.hash ?? ""),
    });
    if (again !== d.decisionId) {
      throw new Error(`decision ${d.decisionId} is not reproducible from the record it carries`);
    }
  }

  return {
    regime,
    days,
    loopPublishedApy: laneSeries.carryPublishedApy,
    floorPublishedApy: laneSeries.floorPublishedApy,
    loopCapacityUsd: laneSeries.carryCapacityUsd,
    cfg,
    result,
    scenarioHash,
    orchestratedTvlUsd,
    observations,
    settlementDays,
  };
}

export function foldRouterRun(regimeParam: string | null): RunAnswer {
  const regime: RegimeId = isRegimeId(regimeParam) ? regimeParam : DEFAULT_REGIME;
  const fold = foldRouterScenario({ regime });
  const { cfg, result, days, scenarioHash, orchestratedTvlUsd, settlementDays } = fold;
  const loopBase = demoMarketCandidate();
  if (!FLOOR_ROW) throw new Error(`the floor row ${ROUTER_FLOOR_CANDIDATE_ID} is not in TREASURY_CANDIDATES`);
  const laneSeries = {
    carryPublishedApy: fold.loopPublishedApy,
    floorPublishedApy: fold.floorPublishedApy,
    carryCapacityUsd: fold.loopCapacityUsd,
  };

  return {
    ok: true,
    modeled: true,
    days,
    regime,
    regimeLabel: REGIME_LABEL[regime],
    scenario: {
      hash: scenarioHash,
      seed: 0,
      ticks: days.length,
      /* The capture instant, verbatim from its owner. This is what the panel
         prints where a generated run would print a seed. */
      calibratedTo: ROUTER_HISTORY_CAPTURED_AT,
    },
    rulesHash: cfg.rulesHash,
    orchestratedTvlUsd,
    /* Both lanes always run: the demo's whole subject is the pair. */
    carryOnly: false,
    dials: {
      maxConcentrationPct: cfg.dials.maxConcentrationPct,
      turnoverBudgetPctWeek: cfg.dials.turnoverBudgetPctWeek,
    },
    lanes: [
      {
        slotId: LOOP_SLOT,
        candidateId: DEMO_MARKET_ID,
        venue: cfg.loops.find((l) => l.slotId === LOOP_SLOT)?.venue ?? "",
        /* The book, as the row names it. */
        book: loopBase.pair ?? "USDe/USDC",
        capacityUsd: loopBase.economics?.capacityUsd ?? 0,
        settlementDays: 0,
        sourceEligible: loopBase.eligible === true,
      },
      {
        slotId: FLOOR_SLOT,
        candidateId: ROUTER_FLOOR_CANDIDATE_ID,
        venue: cfg.loops.find((l) => l.slotId === FLOOR_SLOT)?.venue ?? "",
        /* Plan R1's lane label, through its one owner. The row's own
           `collateralSymbol` is the receipt token, aUSDC, and the band key is
           a lane key rather than a token key. */
        book: FLOOR_LANE_LABEL,
        capacityUsd: FLOOR_ROW.economics.capacityUsd ?? 0,
        settlementDays,
        sourceEligible: FLOOR_ROW.eligible === true,
      },
    ],
    laneSeries,
    decisions: result.decisions,
    receipts: result.receipts,
    legs: result.legs,
    refusals: result.refusals,
    weights: result.weights,
    weightSumByTick: result.weightSumByTick,
    earningWeightByTick: result.earningWeightByTick,
    budgetByTick: result.budgetByTick,
    moves: result.moves,
    firings: result.firings,
  };
}
