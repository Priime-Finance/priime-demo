/**
 * THE ROUTER BACKTEST, AS A GATE, FOLDED THROUGH THE SHIPPED EVALUATOR.
 *
 * ══ WHAT CHANGED, AND WHY IT MATTERS (G2, G3 of the quant seam) ═══════════
 *
 * This file used to be a HAND FOLD: it walked the days itself over
 * `advanceRuleState`, `applyMove` and the edge locks, and it restated
 * `evaluate.ts`'s two-line breach predicate because the evaluator was not in
 * the app yet. That produced two answers to "how many moves did the measured
 * 90 days take" — five against three on `whipsaw` — because a hand fold does
 * not rank a destination through `selectDestination`, gate a firing on
 * payback, or lock a reverse edge until the last move has paid back.
 *
 * It now folds `foldRouterScenario` (`lib/canvas/router-fold.ts`), which is
 * the SAME call `GET /api/canvas/orchestrate` and the vault page's Capital
 * router instrument make, over the same ticks, with the window and the bar as
 * parameters. There is one machine and this file measures it. Nothing here
 * restates a predicate the evaluator owns: the sustain is asserted off the
 * decision's own `streakAtFire`, the churn refusal off its own `firings`
 * against `moves`, and the friction off the decision's own `cost.oneShotUsd`.
 *
 * ── THE ROUTED BOOK, AND THE ONE CONVENTION IT NEEDS ─────────────────────
 * `earningWeightByTick` is recorded AFTER a tick's moves are applied, so the
 * yield for day i accrues on the weights day i-1 left behind. A move decided
 * on today's observation cannot have earned today's rate.
 */

import { describe, expect, it } from "vitest";

import { HOUSE_FEES } from "@/lib/canvas/fees";

import {
  DEMO_BAR_ONE_WAY_BREAKEVEN,
  DEMO_BAR_REGISTER_FLOOR,
  DEMO_BAR_ROUND_TRIP_BREAKEVEN,
  DEMO_MOVE_FRICTION_FRAC_ONE_WAY,
  DEMO_MOVE_GAS_ACTIONS,
  DEMO_MOVE_GAS_FRAC,
  DEMO_MOVE_SWAP_FRAC,
  DEMO_ROUTER_BOOK_USD,
  DEMO_ROUTER_MOVED_USD,
  DEMO_ROUTER_MOVE_WEIGHT,
  DEMO_ROUTER_RELAXATIONS,
  DEMO_ROUTER_SWAP_NOTIONAL_USD,
  DEMO_SUSTAIN_HOURS,
  DEMO_SUSTAIN_PINS_DAILY,
  DEMO_SUSTAIN_PINS_HOURLY,
  DEMO_UPGRADE_REARM,
  DEMO_UPGRADE_THRESHOLD,
  demoDeriveAllRouterRules,
  demoExitProfile,
  demoRouterPricing,
  demoRouterRules,
  isFloorPairSlot,
  validateDemoRouter,
} from "@/lib/canvas/orchestrator/demo-rules";
import { demoFloorPairSeat } from "@/lib/canvas/floor-pair-seat";
import {
  FLOOR_PAIR_MAX_CONCENTRATION_PCT,
  FLOOR_PAIR_MAX_WEIGHT,
  FLOOR_PAIR_MIN_WEIGHT,
  FLOOR_PAIR_MOVE_WEIGHT,
  FLOOR_PAIR_TURNOVER_PCT_WEEK,
  floorPairSeat,
  floorPairSeatBps,
  isDemoFloorPair,
} from "@/lib/canvas/floor-pair";
import {
  MOVE_FRICTION_FRAC_SAME_CHAIN,
  MOVE_WEIGHT_CAP,
  PAYBACK_HORIZON_DAYS,
  chainOfVenue,
  paybackMs,
  rulesHash,
  sizeMove,
} from "@/lib/canvas/orchestrator/rule-schema";
import type { LoopSlot } from "@/lib/canvas/orchestrator/types";
import { ORCH_DIAL_DEFAULTS } from "@/lib/canvas/param-schema";
import {
  ROUTER_FLOOR_SLOT,
  ROUTER_LOOP_SLOT,
  foldRouterRun,
  foldRouterScenario,
} from "@/lib/canvas/router-fold";
import {
  ROUTER_HISTORY,
  ROUTER_HISTORY_ALIGNED,
  ROUTER_HISTORY_GAPS,
  ROUTER_FLOOR_CANDIDATE_ID,
  floorPublishedApyByDay,
  floorRowForRate,
  loopPublishedApyByDay,
  routerPublishedToday,
  type RouterHistoryAlignedRow,
} from "@/lib/canvas/router-history";
import { DEFAULT_REGIME, REGIME_IDS, type RegimeId } from "@/lib/canvas/scenario/regime-ids";
import {
  TREASURY_CANDIDATES,
  issuerRedemptionTerms,
  settlementDaysOf,
  treasuryIssuerFacts,
} from "@/lib/canvas/templates";
import { DEMO_MARKET_ID, HERO_SEED_LEVERAGE } from "@/lib/demo/market";
import { ONCHAIN_EXECUTIONS } from "@/lib/vaults/onchain-executions";

const DAY_MS = 24 * 60 * 60 * 1000;
const TVL = DEMO_ROUTER_BOOK_USD;
const LOOP = ROUTER_LOOP_SLOT;
const FLOOR = ROUTER_FLOOR_SLOT;

function slot(slotId: string, venue: string, candidateId: string): LoopSlot {
  return {
    slotId,
    venue,
    candidateId,
    marketKey: candidateId,
    cls: "N1",
    targetWeight: 0.5,
    minWeight: FLOOR_PAIR_MIN_WEIGHT,
    maxWeight: FLOOR_PAIR_MAX_WEIGHT,
    /* NULL, and it is load-bearing (F5). `ECON_FLOOR_APY` is the levered-loop
       SCAN gate and this market never passed through one: the scan snapshot
       lists it under `ineligible` (lib/demo/market.ts). Handing it a screen it
       was never admitted through would leave an evacuation rule permanently
       breaching, and `evaluate.ts`'s `evacuationBreaching` would then
       disqualify the loop as a DESTINATION, silently deleting the return leg. */
    screenedAtApy: null,
    metrics: { funding: false, basis: false },
  };
}

const LOOP_SLOT = slot(LOOP, "morpho-blue-base", DEMO_MARKET_ID);
const FLOOR_SLOT = slot(FLOOR, "treasury-ausdc-base", ROUTER_FLOOR_CANDIDATE_ID);
const SLOTS = [LOOP_SLOT, FLOOR_SLOT];

// ── The one fold, read ────────────────────────────────────────────────────

interface RunResult {
  readonly regime: RegimeId;
  readonly days: number;
  readonly moves: number;
  readonly firings: number;
  readonly refusalCodes: string;
  readonly refusals: number;
  readonly routedApy: number;
  readonly staticLoopApy: number;
  readonly staticFloorApy: number;
  readonly staticHalfApy: number;
  readonly frictionApy: number;
  readonly dwellDays: number;
  readonly moveLine: string;
  readonly endWeights: string;
  readonly streaks: number[];
  readonly improvements: number[];
  readonly dailyBook: number[];
  readonly dailyLoop: readonly number[];
  readonly dailyFloor: readonly number[];
}

function run(
  regime: RegimeId,
  window: readonly RouterHistoryAlignedRow[] = ROUTER_HISTORY_ALIGNED,
  bar: number = DEMO_UPGRADE_THRESHOLD,
): RunResult {
  const f = foldRouterScenario({ regime, rows: window, bar });
  const n = f.days.length;
  const w = f.result.earningWeightByTick;
  const dailyBook: number[] = [];
  /* DAY ZERO IS THE SEAT, not a split. The fold opens on the lane the rule
     holds (`floor-pair-seat.ts`), so the first day's yield accrues on that
     seat; hardcoding 0.5 here would price day one on a position the run was
     never in and the "no moves means the static held lane" identity below
     would miss by the difference between the two lanes. */
  const seatLoop = demoFloorPairSeat() === "loop" ? 1 : 0;
  for (let i = 0; i < n; i += 1) {
    const wl = i === 0 ? seatLoop : (w[LOOP][i - 1] as number);
    const wf = i === 0 ? 1 - seatLoop : (w[FLOOR][i - 1] as number);
    dailyBook.push(wl * (f.loopPublishedApy[i] as number) + wf * (f.floorPublishedApy[i] as number));
  }
  const moved = f.result.decisions.filter((d) => d.moved.destSlotId !== "pause");
  /* THE FRICTION IS THE EVALUATOR'S OWN, off each decision's cost record, so
     the table charges what the machine charged and never a second estimate. */
  const frictionUsd = moved.reduce((s, d) => s + d.cost.oneShotUsd, 0);
  const frictionApy = ((frictionUsd / f.orchestratedTvlUsd) * 365) / n;
  const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
  const gaps: number[] = [];
  let cursor = 0;
  for (const d of moved) {
    gaps.push(d.scenarioRef.tick - cursor);
    cursor = d.scenarioRef.tick;
  }
  gaps.push(n - 1 - cursor);
  return {
    regime,
    days: n,
    moves: f.result.moves,
    firings: f.result.firings,
    refusals: f.result.refusals.length,
    refusalCodes: [...new Set(f.result.refusals.map((r) => r.code))].join(",") || "none",
    routedApy: mean(dailyBook) - frictionApy,
    staticLoopApy: mean(f.loopPublishedApy),
    staticFloorApy: mean(f.floorPublishedApy),
    staticHalfApy: mean(f.loopPublishedApy.map((l, i) => 0.5 * l + 0.5 * (f.floorPublishedApy[i] as number))),
    frictionApy,
    dwellDays: mean(gaps),
    moveLine:
      moved
        .map(
          (d) =>
            `${f.days[d.scenarioRef.tick]} ${d.moved.sourceSlotId}->${d.moved.destSlotId} ${(
              (d.moved.weightBefore - d.moved.weightAfter) *
              100
            ).toFixed(1)}pp`,
        )
        .join(" | ") || "none",
    endWeights: `${(f.result.weights[LOOP] as number).toFixed(3)} / ${(f.result.weights[FLOOR] as number).toFixed(3)}`,
    streaks: moved.map((d) => d.rule.streakAtFire),
    improvements: moved.map(
      (d) =>
        (d.moved.destSlotId === FLOOR
          ? (f.floorPublishedApy[d.scenarioRef.tick] as number) - (f.loopPublishedApy[d.scenarioRef.tick] as number)
          : (f.loopPublishedApy[d.scenarioRef.tick] as number) - (f.floorPublishedApy[d.scenarioRef.tick] as number)),
    ),
    dailyBook,
    dailyLoop: f.loopPublishedApy,
    dailyFloor: f.floorPublishedApy,
  };
}

const RUNS = REGIME_IDS.map((r) => run(r));

/**
 * THE SECOND WINDOW, and it is a finding rather than a feature.
 *
 * The USDe incentive is exactly zero for the first 42 aligned days, so on
 * those days a 2.5x loop pays a borrow out of no collateral yield and the
 * floor clears the bar every single day. This window starts on the day the
 * incentive arrived (2026-07-23), which is the first day this vault could have
 * existed as a product, and G2 rules the bar by what happens here.
 */
const INCENTIVE_START_INDEX = ROUTER_HISTORY_ALIGNED.findIndex((r) => r.loopRewardApr > 0);
const SINCE_INCENTIVE = ROUTER_HISTORY_ALIGNED.slice(INCENTIVE_START_INDEX);
const RUNS_SINCE = REGIME_IDS.map((r) => run(r, SINCE_INCENTIVE));

const pct = (x: number): string => `${(x * 100).toFixed(3)}%`;

/**
 * The improvement at which the evaluator's OWN payback gate stops refusing.
 *
 * IT IS THE MEASURED RAIL NOW, not `MOVE_FRICTION_FRAC_SAME_CHAIN`. The fold
 * passes `demoRouterExitProfile` into `evaluateOrchestrator`'s `exitProfile`
 * hook, so the cost record and `paybackMs` both charge this pair's own 18.6
 * bps rather than the flat 70 bps analogy. That is what makes the two lower
 * candidate bars reachable: the effective floor drops from 2.839pp to
 * 0.754pp, which is the one-way break-even itself.
 */
const PAYBACK_EFFECTIVE_BAR = (DEMO_MOVE_FRICTION_FRAC_ONE_WAY * 365) / PAYBACK_HORIZON_DAYS;

// ── The capture ───────────────────────────────────────────────────────────

describe("router-history: the capture, its gaps and its owners", () => {
  it("carries 95 union days, 89 aligned days and states the six holes", () => {
    expect(ROUTER_HISTORY).toHaveLength(95);
    expect(ROUTER_HISTORY_ALIGNED).toHaveLength(89);
    expect(ROUTER_HISTORY_GAPS).toHaveLength(6);
    const gapDates = new Set(ROUTER_HISTORY_GAPS.map((g) => g.date));
    for (const row of ROUTER_HISTORY) {
      const complete =
        row.aaveUsdcSupplyPct !== null && row.loopRewardPct !== null && row.loopBorrowPct !== null;
      expect(complete).toBe(!gapDates.has(row.date));
    }
  });

  it("is contiguous on both axes, so no hole was filled by carrying a value forward", () => {
    const days = ROUTER_HISTORY.map((r) => Date.parse(`${r.date}T00:00:00.000Z`));
    for (let i = 1; i < days.length; i += 1) {
      expect((days[i] as number) - (days[i - 1] as number)).toBe(DAY_MS);
    }
    const aligned = ROUTER_HISTORY_ALIGNED.map((r) => Date.parse(`${r.date}T00:00:00.000Z`));
    for (let i = 1; i < aligned.length; i += 1) {
      expect((aligned[i] as number) - (aligned[i - 1] as number)).toBe(DAY_MS);
    }
  });

  it("prices the floor row through treasuryModel: at the issuer's own rate it IS the shipped row", () => {
    const facts = treasuryIssuerFacts(ROUTER_FLOOR_CANDIDATE_ID);
    const shipped = TREASURY_CANDIDATES.find((c) => c.id === ROUTER_FLOOR_CANDIDATE_ID);
    expect(facts).not.toBeNull();
    expect(shipped).toBeDefined();
    const rebuilt = floorRowForRate((facts as { apyMean30d: number }).apyMean30d);
    expect(rebuilt).not.toBeNull();
    expect(JSON.parse(JSON.stringify(rebuilt))).toEqual(JSON.parse(JSON.stringify(shipped)));
  });

  it("the two published series exist on all 89 days and carry the compute fee", () => {
    const loop = loopPublishedApyByDay();
    const fl = floorPublishedApyByDay();
    expect(loop).toHaveLength(89);
    expect(fl).toHaveLength(89);
    for (let i = 0; i < fl.length; i += 1) {
      const row = ROUTER_HISTORY_ALIGNED[i] as RouterHistoryAlignedRow;
      expect((fl[i] as { apy: number }).apy).toBeCloseTo(row.aaveUsdcSupplyApy * (1 - HOUSE_FEES.computeOnYield), 12);
    }
  });

  it("today is one clock: the last aligned day, not the capture instant", () => {
    const today = routerPublishedToday();
    expect(today).not.toBeNull();
    expect((today as { date: string }).date).toBe("2026-09-07");
    const loop = loopPublishedApyByDay();
    const fl = floorPublishedApyByDay();
    expect((today as { loop: number }).loop).toBe((loop[loop.length - 1] as { apy: number }).apy);
    expect((today as { floor: number }).floor).toBe((fl[fl.length - 1] as { apy: number }).apy);
  });
});

// ── The switch ────────────────────────────────────────────────────────────

describe("the switch: what G1 relaxes, and the three facts that make this pair a floor pair", () => {
  it("is a treasury-family lane, on the same chain, with an atomic route", () => {
    /* G1's condition is structural and `floor-pair.ts` asks it by id. These
       are the three structural facts, pinned against the owners that hold
       them, so the id list can never outlive the structure. */
    expect(TREASURY_CANDIDATES.some((c) => c.id === ROUTER_FLOOR_CANDIDATE_ID)).toBe(true);
    expect(chainOfVenue(LOOP_SLOT.venue)).toBe(chainOfVenue(FLOOR_SLOT.venue));
    const terms = issuerRedemptionTerms(ROUTER_FLOOR_CANDIDATE_ID);
    expect(terms).not.toBeNull();
    expect(settlementDaysOf(terms!)).toBe(0);
    expect(isDemoFloorPair([DEMO_MARKET_ID, ROUTER_FLOOR_CANDIDATE_ID])).toBe(true);
    expect(isFloorPairSlot(LOOP_SLOT, SLOTS)).toBe(true);
    expect(isFloorPairSlot(FLOOR_SLOT, SLOTS)).toBe(true);
  });

  it("a lane that is not half of this pair keeps the shipped move cap", () => {
    const stranger = slot("other", "morpho-blue-base", "morpho-blue-base:8453:WETH-USDC:0xdeadbeef");
    expect(isDemoFloorPair([DEMO_MARKET_ID, stranger.candidateId])).toBe(false);
    const rules = demoRouterRules(ORCH_DIAL_DEFAULTS, LOOP_SLOT, [LOOP_SLOT, stranger]);
    const upgrade = rules.find((r) => r.metric === "better_elsewhere")!;
    expect(upgrade.moveWeight).toBe(DEMO_ROUTER_MOVE_WEIGHT);
    expect(upgrade.moveWeight).toBeLessThanOrEqual(MOVE_WEIGHT_CAP);
  });

  it("ONE number for a move on this pair: the whole lane, on every rule and every surface", () => {
    /* Item 8(d): "13% of the book per move" and "10.0pp" were two numbers for
       one thing. Under the switch there is one, and it is the whole lane. */
    expect(FLOOR_PAIR_MOVE_WEIGHT).toBe(1);
    expect(FLOOR_PAIR_MIN_WEIGHT).toBe(0);
    expect(FLOOR_PAIR_MAX_WEIGHT).toBe(1);
    expect(FLOOR_PAIR_MAX_CONCENTRATION_PCT).toBe(100);
    expect(FLOOR_PAIR_TURNOVER_PCT_WEEK).toBe(100);
    for (const r of demoDeriveAllRouterRules(ORCH_DIAL_DEFAULTS, SLOTS)) {
      if (r.metric === "better_elsewhere") expect(r.moveWeight).toBe(FLOOR_PAIR_MOVE_WEIGHT);
    }
    /* And the sizing owner honours it rather than clamping it back to R33's
       quarter: `max(0.25, moveWeight)`, which is the identity inside R15. */
    const whole = sizeMove({
      moveWeight: FLOOR_PAIR_MOVE_WEIGHT,
      orchestratedTvlUsd: TVL,
      sourceEquityUsd: 0.5 * TVL,
      destMarginBands: null,
    });
    expect(whole.moveUsd).toBe(0.5 * TVL);
    const shipped = sizeMove({
      moveWeight: MOVE_WEIGHT_CAP,
      orchestratedTvlUsd: TVL,
      sourceEquityUsd: 0.5 * TVL,
      destMarginBands: null,
    });
    expect(shipped.moveUsd).toBe(0.25 * 0.5 * TVL);
  });

  it("relaxes exactly two invariants, by name, and enforces every other one", () => {
    expect(DEMO_ROUTER_RELAXATIONS.map((r) => r.invariant)).toEqual([
      "per-tick-and-budget-caps",
      "dial-range",
    ]);
    const fold = foldRouterScenario({ regime: "measured" });
    /* The shipped validator, run on the config the route actually folds: zero
       violations left once the two named ones are cleared. */
    expect(validateDemoRouter(fold.cfg)).toEqual([]);
    /* And the two it clears are really there: the plain validator sees them. */
    const rules = fold.cfg.rules;
    for (const r of rules) {
      if (r.metric !== "better_elsewhere") continue;
      expect(r.moveWeight).toBeGreaterThan(MOVE_WEIGHT_CAP);
      /* R25, R28 and R29 stay enforced at their shipped floors. */
      expect(r.sustainPins).toBe(DEMO_SUSTAIN_PINS_DAILY);
      expect(r.threshold - r.rearmLevel).toBeCloseTo(0.02, 12);
      expect(r.cooldownMs).toBeGreaterThanOrEqual(6 * 60 * 60 * 1000);
    }
  });

  it("passes the orchestrator validator, with R38 re-checked against the demo derivation", async () => {
    const rules = demoDeriveAllRouterRules(ORCH_DIAL_DEFAULTS, SLOTS);
    const cfg = {
      v: 1 as const,
      loops: SLOTS,
      dials: { ...ORCH_DIAL_DEFAULTS, maxConcentrationPct: FLOOR_PAIR_MAX_CONCENTRATION_PCT },
      rules,
      rulesHash: await rulesHash(rules),
    };
    expect(validateDemoRouter(cfg)).toEqual([]);
    /* A tampered rule set keeps everything, including the two relaxations. */
    const tampered = { ...cfg, rules: rules.map((r) => ({ ...r, sustainPins: 9 })) };
    expect(validateDemoRouter(tampered).length).toBeGreaterThan(0);
  });
});

// ── The constants ─────────────────────────────────────────────────────────

describe("demo-rules: the friction, the bar and the 48 hours", () => {
  it("prices this move at 18.6 bps one way, a quarter of the flat same-chain constant", () => {
    expect(DEMO_ROUTER_MOVE_WEIGHT).toBe(0.125);
    expect(DEMO_ROUTER_MOVED_USD).toBe(3125);
    expect(DEMO_ROUTER_SWAP_NOTIONAL_USD).toBe(7812.5);
    expect(DEMO_MOVE_SWAP_FRAC).toBeCloseTo(0.00122, 9);
    expect(DEMO_MOVE_GAS_FRAC).toBeCloseTo(0.00064, 9);
    expect(DEMO_MOVE_FRICTION_FRAC_ONE_WAY).toBeCloseTo(0.00186, 9);
    expect(DEMO_MOVE_FRICTION_FRAC_ONE_WAY).toBeLessThan(MOVE_FRICTION_FRAC_SAME_CHAIN);
    expect(DEMO_MOVE_GAS_ACTIONS).toBe(4);
  });

  it("carries all three candidate bars, and ships the one the machine honours", () => {
    expect(DEMO_BAR_ONE_WAY_BREAKEVEN).toBeCloseTo(0.00754, 6);
    expect(DEMO_BAR_ROUND_TRIP_BREAKEVEN).toBeCloseTo(0.01508, 6);
    expect(DEMO_BAR_REGISTER_FLOOR).toBe(0.03);
    /* THE ROUND-TRIP BREAK-EVEN SHIPS (G2, fix wave 2). It sits UNDER the
       register floor by name, which is the licence G2 gave a demo-scoped
       owner; `UPGRADE_THRESHOLD_FLOOR` itself is untouched and
       `DEMO_BAR_REGISTER_FLOOR` still computes it. */
    expect(DEMO_UPGRADE_THRESHOLD).toBe(DEMO_BAR_ROUND_TRIP_BREAKEVEN);
    expect(DEMO_UPGRADE_THRESHOLD).toBeLessThan(DEMO_BAR_REGISTER_FLOOR);
    /* R28's 2pp gap, met exactly, and the re-arm is NEGATIVE at this bar. That
       is legal and it is stricter, not weaker: the rule re-arms only once the
       improvement is at or under -0.492%, which is the other lane leading by
       0.492%. A lane that merely stops trailing does not re-arm the rule that
       left it. */
    expect(DEMO_UPGRADE_REARM).toBeCloseTo(-0.00492, 9);
    expect(DEMO_UPGRADE_REARM).toBeLessThan(0);
    expect(DEMO_UPGRADE_THRESHOLD - DEMO_UPGRADE_REARM).toBeCloseTo(0.02, 12);
    /* THE ARGUMENT THE TABLE BELOW MAKES, AS AN ASSERTION, AND IT CHANGED
       SIDES. The evaluator used to charge `exitProfileFor`'s flat 0.700% while
       the rule published a bar derived from the measured 0.186%, so
       `paybackMs` imposed an effective 2.84pp floor no rule had stated and
       only the register bar cleared it. One friction prices one move now, so
       the effective floor IS the one-way break-even, and both derived
       candidates are reachable. */
    expect(PAYBACK_EFFECTIVE_BAR).toBeCloseTo(DEMO_BAR_ONE_WAY_BREAKEVEN, 4);
    expect(PAYBACK_EFFECTIVE_BAR).toBeCloseTo(0.00754, 4);
    /* A QUARTER OF WHAT IT WAS: the old floor was the flat constant's own
       365/90, which is 2.839pp, and it is what forced the register bar. */
    expect((MOVE_FRICTION_FRAC_SAME_CHAIN * 365) / PAYBACK_HORIZON_DAYS).toBeCloseTo(0.02839, 5);
    expect(PAYBACK_EFFECTIVE_BAR).toBeLessThan((MOVE_FRICTION_FRAC_SAME_CHAIN * 365) / PAYBACK_HORIZON_DAYS);
    expect(DEMO_BAR_ROUND_TRIP_BREAKEVEN).toBeGreaterThan(PAYBACK_EFFECTIVE_BAR);
    expect(DEMO_UPGRADE_THRESHOLD).toBeGreaterThan(PAYBACK_EFFECTIVE_BAR);
  });

  it("charges ONE friction for one move: the measured rail, in every cost record", () => {
    /* THE DEFECT THIS CLOSES. The bar is derived from
       `DEMO_MOVE_FRICTION_FRAC_ONE_WAY`; the evaluator was charging
       `MOVE_FRICTION_FRAC_SAME_CHAIN`, four times as much, in the cost record
       the dock prints and the payback gate reads. Both ends are atomic, so the
       measured profile carries no settlement window and no window cost. */
    const priced = demoRouterPricing(
      [DEMO_MARKET_ID, ROUTER_FLOOR_CANDIDATE_ID],
      { venue: "morpho-blue-base", publishedNetApy: 0.03, settlementDays: 0, observationsPerDay: 1 },
      { venue: "treasury-ausdc-base", publishedNetApy: 0.028, settlementDays: 0, observationsPerDay: 1 },
    );
    expect(priced.exit).toEqual(demoExitProfile());
    expect(priced.exit.oneShotFrac).toBe(DEMO_MOVE_FRICTION_FRAC_ONE_WAY);
    expect(priced.exit.settleSeqs).toBe(0);
    expect(priced.exit.windowCost).toBe(0);
    expect(priced.bar).toBe(DEMO_UPGRADE_THRESHOLD);
    /* AND IT IS SCOPED. A portfolio that is not this pair gets the two shipped
       functions, unchanged, on the same two endpoints. */
    const stranger = demoRouterPricing(
      [DEMO_MARKET_ID, "morpho-blue-base:8453:WETH-USDC:0xdeadbeef"],
      { venue: "morpho-blue-base", publishedNetApy: 0.03, settlementDays: 0, observationsPerDay: 1 },
      { venue: "morpho-blue-base", publishedNetApy: 0.028, settlementDays: 0, observationsPerDay: 1 },
    );
    expect(stranger.exit.oneShotFrac).toBe(MOVE_FRICTION_FRAC_SAME_CHAIN);
    expect(stranger.bar).toBe(0.03);
    /* THE FOLD ACTUALLY CHARGES IT: every decision's own cost record is the
       measured rail against the dollars it moved, not the flat constant. */
    for (const regime of REGIME_IDS) {
      const f = foldRouterScenario({ regime });
      for (const d of f.result.decisions) {
        if (d.moved.destSlotId === "pause") continue;
        expect(d.cost.oneShotFrac).toBe(DEMO_MOVE_FRICTION_FRAC_ONE_WAY);
        expect(d.cost.oneShotUsd).toBeCloseTo(DEMO_MOVE_FRICTION_FRAC_ONE_WAY * d.moved.moveUsd, 2);
      }
    }
  });

  it("seats the whole book in one lane, and the lane is the one the rule holds", () => {
    /* A SWITCH HOLDS ONE LANE (fix wave 2, ruling 2). The pair's published
       rates today have the loop ahead, so the loop is seated and the floor
       opens empty. The rule's own bar is what asks the question. */
    const today = routerPublishedToday();
    expect(today).not.toBeNull();
    const t = today as { loop: number; floor: number };
    expect(t.floor - t.loop).toBeLessThan(DEMO_UPGRADE_THRESHOLD);
    expect(demoFloorPairSeat()).toBe("loop");
    expect(
      floorPairSeat({ loop: 0.03, floor: 0.03 + DEMO_UPGRADE_THRESHOLD + 1e-9 }, DEMO_UPGRADE_THRESHOLD),
    ).toBe("floor");
    expect(floorPairSeat(null, DEMO_UPGRADE_THRESHOLD)).toBe("loop");
    const seat = floorPairSeatBps(
      [
        { loopId: "loop_1", candidateId: DEMO_MARKET_ID },
        { loopId: "loop_2", candidateId: ROUTER_FLOOR_CANDIDATE_ID },
      ],
      "loop",
    );
    expect(seat).toEqual({ loop_1: 10000, loop_2: 0 });
    /* Not this pair, no seat: the caller keeps its own allocation. */
    expect(
      floorPairSeatBps([{ loopId: "loop_1", candidateId: DEMO_MARKET_ID }], "loop"),
    ).toBeNull();
    /* And the fold opens on it, which is why every move now carries 100pp. */
    const f = foldRouterScenario({ regime: "measured" });
    expect(f.cfg.loops.find((l) => l.slotId === LOOP)?.targetWeight).toBe(1);
    expect(f.cfg.loops.find((l) => l.slotId === FLOOR)?.targetWeight).toBe(0);
  });

  it("maps 48 hours onto both cadences, and the live cadence is measured", () => {
    expect(DEMO_SUSTAIN_HOURS).toBe(48);
    expect(DEMO_SUSTAIN_PINS_DAILY).toBe(2);
    expect(DEMO_SUSTAIN_PINS_HOURLY).toBe(48);
    const stamps = [...ONCHAIN_EXECUTIONS].map((e) => e.timestamp).sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let i = 1; i < stamps.length; i += 1) gaps.push((stamps[i] as number) - (stamps[i - 1] as number));
    gaps.sort((a, b) => a - b);
    const mid =
      gaps.length % 2 === 1
        ? (gaps[(gaps.length - 1) / 2] as number)
        : ((gaps[gaps.length / 2 - 1] as number) + (gaps[gaps.length / 2] as number)) / 2;
    expect(Math.round(mid / 3600)).toBe(1);
    expect(DEMO_SUSTAIN_PINS_HOURLY).toBe(DEMO_SUSTAIN_HOURS / 1);
  });

  it("overrides only the better_elsewhere rule and leaves every other guard alone", () => {
    const base = demoRouterRules(ORCH_DIAL_DEFAULTS, LOOP_SLOT, SLOTS);
    const upgrade = base.find((r) => r.metric === "better_elsewhere")!;
    expect(upgrade.sustainPins).toBe(DEMO_SUSTAIN_PINS_DAILY);
    expect(upgrade.threshold).toBe(DEMO_UPGRADE_THRESHOLD);
    expect(upgrade.rearmLevel).toBe(DEMO_UPGRADE_REARM);
    for (const r of base) {
      if (r.metric === "better_elsewhere") continue;
      expect(r.moveWeight).toBe(DEMO_ROUTER_MOVE_WEIGHT);
    }
    const floorUpgrade = demoRouterRules(ORCH_DIAL_DEFAULTS, FLOOR_SLOT, SLOTS).find(
      (r) => r.metric === "better_elsewhere",
    )!;
    expect(floorUpgrade.threshold).toBe(upgrade.threshold);
    expect(floorUpgrade.rearmLevel).toBe(upgrade.rearmLevel);
    expect(floorUpgrade.sustainPins).toBe(upgrade.sustainPins);
    expect(floorUpgrade.moveWeight).toBe(upgrade.moveWeight);
  });
});

// ── The backtest ──────────────────────────────────────────────────────────

const HEAD = "regime            moves firings dwell  routed   loop     floor    50/50    friction  refusals";

function tableRow(r: RunResult): string {
  return [
    r.regime.padEnd(17),
    String(r.moves).padStart(5),
    String(r.firings).padStart(7),
    r.dwellDays.toFixed(1).padStart(6),
    pct(r.routedApy).padStart(8),
    pct(r.staticLoopApy).padStart(8),
    pct(r.staticFloorApy).padStart(8),
    pct(r.staticHalfApy).padStart(8),
    pct(r.frictionApy).padStart(9),
    `  ${r.refusals} (${r.refusalCodes})`,
  ].join(" ");
}

describe("the backtest: the switch over the measured window and three regimes", () => {
  it("prints the table, at all three bars, over both windows", () => {
    const lines = [
      "",
      `router backtest UNDER THE SWITCH, ${RUNS[0]?.days} aligned days, book $${TVL.toLocaleString("en-US")}, L ${HERO_SEED_LEVERAGE}x`,
      `bar ${pct(DEMO_UPGRADE_THRESHOLD)} / re-arm ${pct(DEMO_UPGRADE_REARM)} / sustain ${DEMO_SUSTAIN_PINS_DAILY} daily pins / one firing carries the whole lane / budget ${FLOOR_PAIR_TURNOVER_PCT_WEEK}% per week`,
      `friction charged by the evaluator: ${pct(DEMO_MOVE_FRICTION_FRAC_ONE_WAY)} of the capital moved (the measured rail, through the fold's exitProfile hook), against the flat ${pct(MOVE_FRICTION_FRAC_SAME_CHAIN)} exitProfileFor would have charged`,
      HEAD,
    ];
    for (const r of RUNS) lines.push(tableRow(r));
    for (const r of RUNS) {
      lines.push(`${r.regime}: end weights ${r.endWeights}, moves ${r.moveLine}`);
    }
    lines.push("");
    lines.push(
      `since the incentive arrived (${SINCE_INCENTIVE[0]?.date} on, ${SINCE_INCENTIVE.length} days), the window in which this vault could have existed`,
    );
    lines.push(HEAD);
    for (const r of RUNS_SINCE) lines.push(tableRow(r));
    for (const r of RUNS_SINCE) {
      lines.push(`since-incentive ${r.regime}: end weights ${r.endWeights}, moves ${r.moveLine}`);
    }

    /* ══ G2: THE BAR, RE-MEASURED UNDER THE SWITCH ══════════════════════════
       Three bars, two windows, four regimes, one machine. */
    lines.push("");
    lines.push("the bar, re-measured under the switch: three candidates, both windows");
    lines.push("window          bar          value  regime            moves firings   routed    50/50   friction  refusals");
    for (const [label, win] of [
      ["full", ROUTER_HISTORY_ALIGNED],
      ["since-incentive", SINCE_INCENTIVE],
    ] as const) {
      for (const [barName, bar] of [
        ["one-way", DEMO_BAR_ONE_WAY_BREAKEVEN],
        ["round-trip", DEMO_BAR_ROUND_TRIP_BREAKEVEN],
        ["register", DEMO_BAR_REGISTER_FLOOR],
      ] as const) {
        for (const reg of REGIME_IDS) {
          const r = run(reg, win, bar);
          lines.push(
            [
              label.padEnd(15),
              barName.padEnd(11),
              pct(bar).padStart(7),
              reg.padEnd(17),
              String(r.moves).padStart(5),
              String(r.firings).padStart(7),
              pct(r.routedApy).padStart(9),
              pct(r.staticHalfApy).padStart(8),
              pct(r.frictionApy).padStart(9),
              `  ${r.refusals} (${r.refusalCodes})`,
            ].join(" "),
          );
        }
      }
    }
    lines.push("");
    lines.push(
      `the evaluator's own payback gate is an effective bar of ${pct(PAYBACK_EFFECTIVE_BAR)}: below it a move is refused whatever the rule published`,
    );

    console.log(lines.join("\n"));
    expect(RUNS).toHaveLength(4);
    expect(RUNS_SINCE).toHaveLength(4);
    expect(INCENTIVE_START_INDEX).toBe(42);
  });

  it("the default regime stays `measured`, and every routed return names its window (G4, F7)", () => {
    /* G4: the 42 zero-incentive days are the case the floor lane exists for,
       so the switcher opens on them and the regimes carry the return leg.
       F7: the payback horizon is 90 days and BOTH windows here are shorter, so
       a routed return quoted over either understates the mechanism rather than
       measuring it. Every row above therefore travels with its window, and the
       two windows are named with their day counts. */
    expect(DEFAULT_REGIME).toBe("measured");
    expect(RUNS[0]?.days).toBe(89);
    expect(RUNS_SINCE[0]?.days).toBe(47);
    for (const r of [...RUNS, ...RUNS_SINCE]) expect(r.days).toBeLessThan(PAYBACK_HORIZON_DAYS);
  });

  it("the fold in this file IS the fold the route serves, on the same regime", () => {
    /* Item 3, asserted rather than assumed: the gate and the product are one
       machine. The route's decisions for `measured` and this table's move
       count for `measured` are the same number, off the same call. */
    const routed = foldRouterRun("measured");
    const here = RUNS.find((r) => r.regime === "measured")!;
    const routeMoves = routed.decisions.filter((d) => d.moved.destSlotId !== "pause").length;
    expect(routeMoves).toBe(here.moves);
    expect(routed.days).toHaveLength(here.days);
    expect(routed.dials).toEqual({
      maxConcentrationPct: FLOOR_PAIR_MAX_CONCENTRATION_PCT,
      turnoverBudgetPctWeek: FLOOR_PAIR_TURNOVER_PCT_WEEK,
    });
  });

  it("the switch evacuates and rebuilds: every move carries a whole lane", () => {
    for (const r of [...RUNS, ...RUNS_SINCE]) {
      const f = foldRouterScenario({ regime: r.regime });
      for (const d of f.result.decisions) {
        if (d.moved.destSlotId === "pause") continue;
        /* The source ends at zero. That is what "relocates the capital" means,
           and it is the sentence the founder asked for. */
        expect(d.moved.weightAfter).toBe(0);
      }
    }
  });

  it("never moves without the sustain: the evaluator's own streak at fire clears the window", () => {
    for (const r of [...RUNS, ...RUNS_SINCE]) {
      for (const s of r.streaks) expect(s).toBeGreaterThanOrEqual(DEMO_SUSTAIN_PINS_DAILY);
    }
  });

  it("whipsaw fires more often than it moves, so the mechanism refuses churn", () => {
    for (const runs of [RUNS, RUNS_SINCE]) {
      const w = runs.find((r) => r.regime === "whipsaw")!;
      expect(w.firings).toBeGreaterThan(w.moves);
      expect(w.refusals).toBeGreaterThan(0);
    }
  });

  it("the routed book is a convex combination of the two lanes on every single day", () => {
    for (const r of [...RUNS, ...RUNS_SINCE]) {
      for (let i = 0; i < r.dailyBook.length; i += 1) {
        const lo = Math.min(r.dailyLoop[i] as number, r.dailyFloor[i] as number);
        const hi = Math.max(r.dailyLoop[i] as number, r.dailyFloor[i] as number);
        expect(r.dailyBook[i]).toBeGreaterThanOrEqual(lo - 1e-12);
        expect(r.dailyBook[i]).toBeLessThanOrEqual(hi + 1e-12);
      }
    }
  });

  it("a run with no moves is exactly the SEATED lane's own book, so friction is only ever charged on a move", () => {
    /* It was the static 50/50 before the seat. A switch holds one lane, so a
       run that never fires is the held lane and nothing else; comparing it to
       a half-and-half book would compare it to a position the machine is
       never in. */
    const held = demoFloorPairSeat() === "loop" ? "staticLoopApy" : "staticFloorApy";
    for (const r of [...RUNS, ...RUNS_SINCE]) {
      if (r.moves > 0) continue;
      expect(r.frictionApy).toBe(0);
      expect(r.routedApy).toBeCloseTo(r[held], 12);
    }
  });

  it("every move it makes pays itself back inside the 90-day horizon", () => {
    for (const r of [...RUNS, ...RUNS_SINCE]) {
      for (const imp of r.improvements) {
        expect(paybackMs(demoExitProfile(), imp) / DAY_MS).toBeLessThanOrEqual(PAYBACK_HORIZON_DAYS);
      }
    }
  });

  it("the switch beats the lane it left in every regime, whipsaw included, once one friction is charged", () => {
    /* THIS FLIPPED, AND THE REASON IS THE FRICTION AND NOTHING ELSE. Charging
       `exitProfileFor`'s flat 0.700% on a whole-book move, a violent square
       wave paid 4.306% annualised and ended BELOW the lane it left. The rail
       this pair was actually measured on is 0.186%, so the same four moves
       cost 3.051% and whipsaw ends at -0.475% against a static loop of
       -1.729%. The old loss was an artefact of the second friction, not a
       property of the machine. What still holds is that whipsaw is by far the
       most expensive regime and that its routed book is NEGATIVE. */
    for (const r of RUNS) expect(r.routedApy).toBeGreaterThan(r.staticLoopApy);
    const w = RUNS.find((r) => r.regime === "whipsaw")!;
    expect(w.routedApy).toBeLessThan(0);
    for (const r of RUNS) {
      if (r.regime === "whipsaw") continue;
      expect(w.frictionApy).toBeGreaterThan(r.frictionApy);
    }
  });
});
