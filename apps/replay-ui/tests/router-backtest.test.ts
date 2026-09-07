/**
 * THE ROUTER BACKTEST, AS A GATE.
 *
 * It folds the measured 90 days and each of the plan's three stress regimes
 * through the SAME machine the route will run: `demoRouterRules` for the rule
 * set, `advanceRuleState` for the streak and the hysteresis, `sizeMove` and
 * `applyMove` for the transfer, `lockReverseEdge` for the anti-cycle,
 * `paybackMs` for the horizon gate, and the two published series out of
 * `router-history.ts`. Nothing here re-derives an APY, a threshold or a
 * friction: every one of them has an owner and this file imports it.
 *
 * The one thing it does restate is the two-line breach test, because
 * `evaluate.ts` is not in this app yet (plan WP-2 ports it verbatim). It is
 * the live file's own lines, `lib/canvas/orchestrator/evaluate.ts:304-305`:
 *
 *     if (!Number.isFinite(improvement)) return { breaching: false, safeSide: true };
 *     return { breaching: improvement >= rule.threshold, safeSide: improvement <= rule.rearmLevel };
 *
 * SEAM, stated: when WP-2 lands `evaluate.ts`, this fold must call it rather
 * than keep its own copy.
 */

import { describe, expect, it } from "vitest";

import { publishedNetApy, repriceAtLeverage } from "@/lib/canvas/mock-quote";

import {
  DEMO_MOVE_FRICTION_FRAC_ONE_WAY,
  DEMO_MOVE_GAS_ACTIONS,
  DEMO_MOVE_GAS_FRAC,
  DEMO_MOVE_SWAP_FRAC,
  DEMO_ROUTER_BOOK_USD,
  DEMO_ROUTER_MOVED_USD,
  DEMO_ROUTER_MOVE_WEIGHT,
  DEMO_ROUTER_SWAP_NOTIONAL_USD,
  DEMO_SUSTAIN_HOURS,
  DEMO_SUSTAIN_PINS_DAILY,
  DEMO_SUSTAIN_PINS_HOURLY,
  DEMO_UPGRADE_REARM,
  DEMO_UPGRADE_THRESHOLD,
  demoDeriveAllRouterRules,
  demoExitProfile,
  demoRouterRules,
  validateDemoRouter,
} from "@/lib/canvas/orchestrator/demo-rules";
import {
  MOVE_FRICTION_FRAC_SAME_CHAIN,
  PAYBACK_HORIZON_DAYS,
  advanceRuleState,
  applyMove,
  chainOfVenue,
  edgeLocked,
  initialRuleState,
  lockReverseEdge,
  paybackMs,
  rulesHash,
  sizeMove,
} from "@/lib/canvas/orchestrator/rule-schema";
import type { LoopSlot, OrchRule, OrchRuleState } from "@/lib/canvas/orchestrator/types";
import type { EdgeLockState } from "@/lib/canvas/orchestrator/rule-schema";
import { ORCH_DIAL_DEFAULTS } from "@/lib/canvas/param-schema";
import {
  ROUTER_HISTORY,
  ROUTER_HISTORY_ALIGNED,
  ROUTER_HISTORY_GAPS,
  ROUTER_FLOOR_CANDIDATE_ID,
  floorPublishedApyByDay,
  floorRowForRate,
  loopPublishedApyByDay,
  loopRowForDay,
  routerPublishedToday,
  type RouterHistoryAlignedRow,
} from "@/lib/canvas/router-history";
import { TREASURY_CANDIDATES, treasuryIssuerFacts } from "@/lib/canvas/templates";
import { DEMO_MARKET_ID, HERO_SEED_LEVERAGE } from "@/lib/demo/market";
import { ONCHAIN_EXECUTIONS } from "@/lib/vaults/onchain-executions";

const DAY_MS = 24 * 60 * 60 * 1000;
const TVL = DEMO_ROUTER_BOOK_USD;
const LOOP = "loop";
const FLOOR = "floor";

const MAX_WEIGHT = ORCH_DIAL_DEFAULTS.maxConcentrationPct / 100;
/** The B.5 derivation: `max(0, 1 - (N - 1) * maxWeight)` at N = 2. */
const MIN_WEIGHT = Math.max(0, 1 - 1 * MAX_WEIGHT);

function slot(slotId: string, venue: string, candidateId: string): LoopSlot {
  return {
    slotId,
    venue,
    candidateId,
    marketKey: candidateId,
    cls: "N1",
    targetWeight: 0.5,
    minWeight: MIN_WEIGHT,
    maxWeight: MAX_WEIGHT,
    /* NULL, and it is load-bearing. `ECON_FLOOR_APY` is the levered-loop SCAN
       gate and this market never passed through one: the scan snapshot lists
       it under `ineligible` (lib/demo/market.ts). Handing it a screen it was
       never admitted through would leave an evacuation rule permanently
       breaching, and `evaluate.ts`'s `evacuationBreaching` would then
       disqualify the loop as a DESTINATION, which silently deletes the
       founder's return leg. */
    screenedAtApy: null,
    metrics: { funding: false, basis: false },
  };
}

const LOOP_SLOT = slot(LOOP, "morpho-blue-base", DEMO_MARKET_ID);
const FLOOR_SLOT = slot(FLOOR, "treasury-ausdc-base", ROUTER_FLOOR_CANDIDATE_ID);
const SLOTS = [LOOP_SLOT, FLOOR_SLOT];

// ── The regimes (plan R3), each stating its transform ─────────────────────

interface Regime {
  readonly id: string;
  readonly mechanism: string;
  readonly transform: (rows: readonly RouterHistoryAlignedRow[]) => RouterHistoryAlignedRow[];
}

/**
 * THE TRANSFORMS ARE ANCHORED TO DATES, NOT TO ARRAY POSITIONS.
 *
 * A regime keyed on the index of whatever window it is handed is a different
 * event in every window: "day 45" is 2026-07-25 in the 89-day replay and
 * 2026-09-05 in the 47-day one, so the same regime name would mean two
 * different stresses. Every transform below reads the day's position in
 * `ROUTER_HISTORY_ALIGNED`, so a regime is one event on one calendar.
 */
const alignedIndexOf = (date: string): number =>
  ROUTER_HISTORY_ALIGNED.findIndex((r) => r.date === date);

/** Day 45 of the aligned window: two days after the incentive first paid. */
const HALVE_FROM = "2026-07-25";
/** Day 61 of the aligned window, and 20 days of squeeze from there. */
const SQUEEZE_FROM = "2026-08-10";
const SQUEEZE_DAYS = 20;
/**
 * The squeeze's size, and it is SIZED TO THE BAR rather than picked.
 *
 * The plan asked for 3pp. Measured, 3pp does not clear the bar: 0.8 x 3pp is
 * 2.4pp of published lift against a loop that leads by about 0.3pp in the
 * post-incentive era, so the regime produced zero crossings and demonstrated
 * nothing. The smallest lift that clears 3.0pp is 4.13pp; this is that,
 * rounded up to a round number. A USDC supply rate reaching about 8.7% in a
 * utilization spike is the stress the regime is named for, and the fact that
 * a 3pp spike is NOT enough to move this router is itself the finding.
 */
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

const REGIMES: readonly Regime[] = [
  {
    id: "measured",
    mechanism: "the last 90 days as they happened, no transform",
    transform: (rows) => [...rows],
  },
  {
    id: "incentive-halves",
    mechanism: `loopRewardApr is halved from ${HALVE_FROM} on`,
    transform: (rows) =>
      rows.map((r) =>
        r.date >= HALVE_FROM ? { ...r, loopRewardApr: r.loopRewardApr * 0.5 } : r,
      ),
  },
  {
    id: "usdc-squeeze",
    mechanism: `aaveUsdcSupplyApy gains ${(SQUEEZE_LIFT * 100).toFixed(0)}pp for ${SQUEEZE_DAYS} days from ${SQUEEZE_FROM}, then reverts`,
    transform: (rows) => {
      const from = alignedIndexOf(SQUEEZE_FROM);
      return rows.map((r) => {
        const i = alignedIndexOf(r.date);
        return i >= from && i < from + SQUEEZE_DAYS
          ? { ...r, aaveUsdcSupplyApy: r.aaveUsdcSupplyApy + SQUEEZE_LIFT }
          : r;
      });
    },
  },
  {
    id: "whipsaw",
    mechanism: `aaveUsdcSupplyApy gains a square wave of +/-${(WHIPSAW_AMPLITUDE * 100).toFixed(0)}pp whose runs grow 2, 3, 4, 5 days`,
    transform: (rows) =>
      rows.map((r) => ({
        ...r,
        aaveUsdcSupplyApy:
          r.aaveUsdcSupplyApy + whipsawSign(alignedIndexOf(r.date)) * WHIPSAW_AMPLITUDE,
      })),
  },
];

// ── The fold ──────────────────────────────────────────────────────────────

interface Move {
  readonly index: number;
  readonly date: string;
  readonly source: string;
  readonly dest: string;
  readonly weight: number;
  readonly nowMs: number;
  readonly improvement: number;
}

interface Refusal {
  readonly index: number;
  readonly code: string;
}

interface RunResult {
  readonly regime: string;
  readonly days: number;
  readonly moves: readonly Move[];
  readonly refusals: readonly Refusal[];
  readonly routedApy: number;
  readonly staticLoopApy: number;
  readonly staticFloorApy: number;
  readonly staticHalfApy: number;
  readonly frictionApy: number;
  readonly dwellDays: number;
  readonly crossings: number;
  readonly breachHistory: Record<string, boolean[]>;
  readonly endWeights: Record<string, number>;
  /** The book's gross rate on every day, before friction. */
  readonly dailyBook: readonly number[];
  readonly dailyLoop: readonly number[];
  readonly dailyFloor: readonly number[];
}

/* The two owners, applied one row at a time. `router-history` exports the
   series over the CAPTURED window; a regime walks a transform of it, so these
   two call the same owners on the transformed rows. The module's public
   surface stays the captured history, which is what every product surface
   reads. */
function loopPublishedApyOn(row: RouterHistoryAlignedRow): number | null {
  return publishedNetApy(repriceAtLeverage(loopRowForDay(row), HERO_SEED_LEVERAGE), false);
}

function floorPublishedApyOn(row: RouterHistoryAlignedRow): number | null {
  return publishedNetApy(floorRowForRate(row.aaveUsdcSupplyApy), false);
}

function seriesFor(rows: readonly RouterHistoryAlignedRow[]): {
  dates: string[];
  loop: number[];
  floor: number[];
} {
  const dates: string[] = [];
  const loop: number[] = [];
  const floor: number[] = [];
  for (const row of rows) {
    const l = loopPublishedApyOn(row);
    const f = floorPublishedApyOn(row);
    if (l === null || f === null) continue;
    dates.push(row.date);
    loop.push(l);
    floor.push(f);
  }
  return { dates, loop, floor };
}

function ruleFor(rules: readonly OrchRule[], slotId: string): OrchRule {
  const r = rules.find((x) => x.ruleId === `${slotId}:upgrade`);
  if (!r) throw new Error(`no upgrade rule for ${slotId}`);
  return r;
}

function run(
  regime: Regime,
  window: readonly RouterHistoryAlignedRow[] = ROUTER_HISTORY_ALIGNED,
  barOverride?: number,
): RunResult {
  const rows = regime.transform(window);
  const { dates, loop, floor } = seriesFor(rows);
  const derived = demoDeriveAllRouterRules(ORCH_DIAL_DEFAULTS, SLOTS);
  /* The sensitivity below re-runs the fold at the RAW break-even bar instead
     of the register floor. Only the bar and its own 2pp re-arm gap move; the
     sustain, the cooldown and the sizing are untouched. */
  const rules =
    barOverride === undefined
      ? derived
      : derived.map((r) =>
          r.metric === "better_elsewhere"
            ? { ...r, threshold: barOverride, rearmLevel: Number((barOverride - 0.02).toFixed(6)) }
            : r,
        );
  const states: Record<string, OrchRuleState> = {
    [LOOP]: initialRuleState(),
    [FLOOR]: initialRuleState(),
  };
  const bounds = {
    [LOOP]: { min: MIN_WEIGHT, max: MAX_WEIGHT },
    [FLOOR]: { min: MIN_WEIGHT, max: MAX_WEIGHT },
  };
  let weights: Record<string, number> = { [LOOP]: 0.5, [FLOOR]: 0.5 };
  let locks: EdgeLockState = { reverseLockedUntilMs: {} };
  const moves: Move[] = [];
  const refusals: Refusal[] = [];
  const breachHistory: Record<string, boolean[]> = { [LOOP]: [], [FLOOR]: [] };
  const dailyBook: number[] = [];
  let bookSum = 0;
  let frictionFrac = 0;
  let crossings = 0;
  const wasBreaching: Record<string, boolean> = { [LOOP]: false, [FLOOR]: false };

  for (let i = 0; i < dates.length; i += 1) {
    const date = dates[i] as string;
    const apy: Record<string, number> = { [LOOP]: loop[i] as number, [FLOOR]: floor[i] as number };
    const nowMs = Date.parse(`${date}T00:00:00.000Z`);
    /* Yield accrues on the weights in force at the START of the day; a move
       decided on today's observation cannot have earned today's rate. */
    const bookToday =
      (weights[LOOP] as number) * (apy[LOOP] as number) +
      (weights[FLOOR] as number) * (apy[FLOOR] as number);
    dailyBook.push(bookToday);
    bookSum += bookToday;

    for (const source of [LOOP, FLOOR]) {
      const dest = source === LOOP ? FLOOR : LOOP;
      const rule = ruleFor(rules, source);
      const improvement = (apy[dest] as number) - (apy[source] as number);
      // evaluate.ts:304-305, verbatim.
      const breaching = Number.isFinite(improvement) && improvement >= rule.threshold;
      const safeSide = !Number.isFinite(improvement) || improvement <= rule.rearmLevel;
      breachHistory[source]?.push(breaching);
      if (breaching && !wasBreaching[source]) crossings += 1;
      wasBreaching[source] = breaching;

      const advanced = advanceRuleState(rule, states[source] as OrchRuleState, {
        ref: { kind: "modeled", seq: i, hash: "", label: `day ${date}` },
        breaching,
        safeSide,
        nowMs,
      });
      states[source] = advanced.state;
      if (!advanced.fired) continue;

      if (edgeLocked(locks, source, dest, nowMs)) {
        refusals.push({ index: i, code: "anti-cycle" });
        continue;
      }
      const exit = demoExitProfile();
      const pbMs = paybackMs(exit, improvement);
      if (!(pbMs / DAY_MS <= PAYBACK_HORIZON_DAYS)) {
        refusals.push({ index: i, code: "payback" });
        continue;
      }
      const sizing = sizeMove({
        moveWeight: rule.moveWeight,
        orchestratedTvlUsd: TVL,
        sourceEquityUsd: (weights[source] as number) * TVL,
        destMarginBands: null,
      });
      if (sizing.deferred) {
        refusals.push({ index: i, code: "min-move" });
        continue;
      }
      const before = weights[dest] as number;
      const next = applyMove(weights, bounds, source, dest, sizing.moveUsd / TVL);
      const actual = Number(((next[dest] as number) - before).toFixed(9));
      if (!(actual > 0)) {
        refusals.push({ index: i, code: "weight-band" });
        continue;
      }
      weights = next;
      frictionFrac += exit.oneShotFrac * actual;
      moves.push({ index: i, date, source, dest, weight: actual, nowMs, improvement });
      locks = lockReverseEdge(locks, source, dest, nowMs, rule.cooldownMs, pbMs);
    }
  }

  const n = dates.length;
  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
  const frictionApy = (frictionFrac * 365) / n;
  const gaps: number[] = [];
  let cursor = 0;
  for (const m of moves) {
    gaps.push(m.index - cursor);
    cursor = m.index;
  }
  gaps.push(n - 1 - cursor);

  return {
    regime: regime.id,
    days: n,
    moves,
    refusals,
    routedApy: bookSum / n - frictionApy,
    staticLoopApy: mean(loop),
    staticFloorApy: mean(floor),
    staticHalfApy: mean(loop.map((l, i) => 0.5 * l + 0.5 * (floor[i] as number))),
    frictionApy,
    dwellDays: mean(gaps),
    crossings,
    breachHistory,
    endWeights: weights,
    dailyBook,
    dailyLoop: loop,
    dailyFloor: floor,
  };
}

const RUNS = REGIMES.map((r) => run(r));

/**
 * THE SECOND WINDOW, and it is a finding rather than a feature.
 *
 * The USDe incentive is exactly zero for the first 42 aligned days, so on
 * those days a 2.5x loop pays a borrow out of no collateral yield and the
 * floor clears the 3pp bar every single day. The router spends its whole
 * concentration band there, in June, and every stress regime downstream then
 * has no room left to demonstrate anything. This window starts on the day the
 * incentive arrived (2026-07-23), which is the first day this vault could
 * have existed as a product, and it is what the regimes actually exercise.
 */
const INCENTIVE_START_INDEX = ROUTER_HISTORY_ALIGNED.findIndex((r) => r.loopRewardApr > 0);
const SINCE_INCENTIVE = ROUTER_HISTORY_ALIGNED.slice(INCENTIVE_START_INDEX);
const RUNS_SINCE = REGIMES.map((r) => run(r, SINCE_INCENTIVE));

const pct = (x: number): string => `${(x * 100).toFixed(3)}%`;

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
    /* The floor is unlevered, so its published number is exactly the issuer
       rate less the 20% compute fee. This is the fee identity, checked on the
       lane rather than asserted about it. */
    for (let i = 0; i < fl.length; i += 1) {
      const row = ROUTER_HISTORY_ALIGNED[i] as RouterHistoryAlignedRow;
      expect((fl[i] as { apy: number }).apy).toBeCloseTo(row.aaveUsdcSupplyApy * 0.8, 12);
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

  it("derives the bar through upgradeThreshold, and the register floor is what binds", () => {
    const raw = (DEMO_MOVE_FRICTION_FRAC_ONE_WAY * 365) / PAYBACK_HORIZON_DAYS;
    expect(raw).toBeLessThan(0.03);
    expect(DEMO_UPGRADE_THRESHOLD).toBe(0.03);
    expect(DEMO_UPGRADE_REARM).toBe(0.01);
    /* R28 met exactly, in the invariant's own terms. */
    expect(DEMO_UPGRADE_THRESHOLD - DEMO_UPGRADE_REARM).toBeCloseTo(0.02, 12);
    /* A move at the bar pays itself back well inside the horizon. */
    expect(paybackMs(demoExitProfile(), DEMO_UPGRADE_THRESHOLD) / DAY_MS).toBeLessThan(
      PAYBACK_HORIZON_DAYS,
    );
  });

  it("maps 48 hours onto both cadences, and the live cadence is measured", () => {
    expect(DEMO_SUSTAIN_HOURS).toBe(48);
    expect(DEMO_SUSTAIN_PINS_DAILY).toBe(2);
    expect(DEMO_SUSTAIN_PINS_HOURLY).toBe(48);
    const stamps = [...ONCHAIN_EXECUTIONS].map((e) => e.timestamp).sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let i = 1; i < stamps.length; i += 1) gaps.push((stamps[i] as number) - (stamps[i - 1] as number));
    gaps.sort((a, b) => a - b);
    const mid = gaps.length % 2 === 1 ? (gaps[(gaps.length - 1) / 2] as number)
      : ((gaps[gaps.length / 2 - 1] as number) + (gaps[gaps.length / 2] as number)) / 2;
    /* The handler lands about hourly: the median gap rounds to one hour. */
    expect(Math.round(mid / 3600)).toBe(1);
    expect(DEMO_SUSTAIN_PINS_HOURLY).toBe(DEMO_SUSTAIN_HOURS / 1);
  });

  it("overrides only the better_elsewhere rule and leaves every other guard alone", () => {
    const base = demoRouterRules(ORCH_DIAL_DEFAULTS, LOOP_SLOT, SLOTS);
    const upgrade = base.find((r) => r.metric === "better_elsewhere")!;
    expect(upgrade.sustainPins).toBe(DEMO_SUSTAIN_PINS_DAILY);
    expect(upgrade.threshold).toBe(DEMO_UPGRADE_THRESHOLD);
    expect(upgrade.rearmLevel).toBe(DEMO_UPGRADE_REARM);
    /* Both lanes settle on Base, so the pair is same-chain and one margin
       governs both directions. */
    expect(chainOfVenue(LOOP_SLOT.venue)).toBe(chainOfVenue(FLOOR_SLOT.venue));
    const floorUpgrade = demoRouterRules(ORCH_DIAL_DEFAULTS, FLOOR_SLOT, SLOTS).find(
      (r) => r.metric === "better_elsewhere",
    )!;
    expect(floorUpgrade.threshold).toBe(upgrade.threshold);
    expect(floorUpgrade.rearmLevel).toBe(upgrade.rearmLevel);
    expect(floorUpgrade.sustainPins).toBe(upgrade.sustainPins);
  });

  it("passes the orchestrator validator, with R38 re-checked against the demo derivation", async () => {
    const rules = demoDeriveAllRouterRules(ORCH_DIAL_DEFAULTS, SLOTS);
    const cfg = {
      v: 1 as const,
      loops: SLOTS,
      dials: ORCH_DIAL_DEFAULTS,
      rules,
      rulesHash: await rulesHash(rules),
    };
    expect(validateDemoRouter(cfg)).toEqual([]);
  });
});

// ── The backtest ──────────────────────────────────────────────────────────

describe("the backtest: the mechanism over the measured window and three regimes", () => {
  it("prints the table", () => {
    const lines = [
      "",
      `router backtest, ${RUNS[0]?.days} aligned days, book $${TVL.toLocaleString("en-US")}, L ${HERO_SEED_LEVERAGE}x`,
      `bar ${pct(DEMO_UPGRADE_THRESHOLD)} / re-arm ${pct(DEMO_UPGRADE_REARM)} / sustain ${DEMO_SUSTAIN_PINS_DAILY} daily pins / friction ${pct(DEMO_MOVE_FRICTION_FRAC_ONE_WAY)} one way`,
      "regime            moves dwell  routed   loop     floor    50/50    friction  refusals",
    ];
    for (const r of RUNS) {
      lines.push(
        [
          r.regime.padEnd(17),
          String(r.moves.length).padStart(5),
          r.dwellDays.toFixed(1).padStart(6),
          pct(r.routedApy).padStart(8),
          pct(r.staticLoopApy).padStart(8),
          pct(r.staticFloorApy).padStart(8),
          pct(r.staticHalfApy).padStart(8),
          pct(r.frictionApy).padStart(9),
          `  ${r.refusals.length} (${[...new Set(r.refusals.map((x) => x.code))].join(",") || "none"})`,
        ].join(" "),
      );
    }
    for (const r of RUNS) {
      lines.push(
        `${r.regime}: crossings ${r.crossings}, end weights loop ${(r.endWeights[LOOP] as number).toFixed(3)} / floor ${(r.endWeights[FLOOR] as number).toFixed(3)}, moves ${r.moves.map((m) => `${m.date} ${m.source}->${m.dest} ${(m.weight * 100).toFixed(1)}pp`).join(" | ") || "none"}`,
      );
    }
    lines.push("");
    lines.push(
      `since the incentive arrived (${SINCE_INCENTIVE[0]?.date} on, ${SINCE_INCENTIVE.length} days), the window in which this vault could have existed`,
    );
    lines.push("regime            moves dwell  routed   loop     floor    50/50    friction  refusals");
    for (const r of RUNS_SINCE) {
      lines.push(
        [
          r.regime.padEnd(17),
          String(r.moves.length).padStart(5),
          r.dwellDays.toFixed(1).padStart(6),
          pct(r.routedApy).padStart(8),
          pct(r.staticLoopApy).padStart(8),
          pct(r.staticFloorApy).padStart(8),
          pct(r.staticHalfApy).padStart(8),
          pct(r.frictionApy).padStart(9),
          `  ${r.refusals.length} (${[...new Set(r.refusals.map((x) => x.code))].join(",") || "none"})`,
        ].join(" "),
      );
    }
    for (const r of RUNS_SINCE) {
      lines.push(
        `since-incentive ${r.regime}: crossings ${r.crossings}, end weights loop ${(r.endWeights[LOOP] as number).toFixed(3)} / floor ${(r.endWeights[FLOOR] as number).toFixed(3)}, moves ${r.moves.map((m) => `${m.date} ${m.source}->${m.dest} ${(m.weight * 100).toFixed(1)}pp`).join(" | ") || "none"}`,
      );
    }
    /* THE BAR'S OWN SENSITIVITY. The break-even for this pair is 0.75% and
       the register floor lifts it to 3.0%. This is what the other choice
       would have produced, so the ruling is measured rather than asserted. */
    const RAW_BAR = (DEMO_MOVE_FRICTION_FRAC_ONE_WAY * 365) / PAYBACK_HORIZON_DAYS;
    lines.push("");
    lines.push(
      `sensitivity: the same fold at the RAW break-even bar ${pct(RAW_BAR)} instead of the ${pct(DEMO_UPGRADE_THRESHOLD)} register floor`,
    );
    lines.push("window          regime            moves  routed   50/50    friction");
    for (const [label, win] of [
      ["full", ROUTER_HISTORY_ALIGNED],
      ["since-incentive", SINCE_INCENTIVE],
    ] as const) {
      for (const reg of REGIMES) {
        const r = run(reg, win, RAW_BAR);
        lines.push(
          [
            label.padEnd(15),
            r.regime.padEnd(17),
            String(r.moves.length).padStart(5),
            pct(r.routedApy).padStart(8),
            pct(r.staticHalfApy).padStart(8),
            pct(r.frictionApy).padStart(9),
          ].join(" "),
        );
      }
    }
     
    console.log(lines.join("\n"));
    expect(RUNS).toHaveLength(4);
    expect(RUNS_SINCE).toHaveLength(4);
    expect(INCENTIVE_START_INDEX).toBe(42);
    expect(alignedIndexOf(HALVE_FROM)).toBe(44);
    expect(alignedIndexOf(SQUEEZE_FROM)).toBe(60);
  });

  it("never moves without the sustain: every move has 2 consecutive breaching days behind it", () => {
    for (const r of [...RUNS, ...RUNS_SINCE]) {
      for (const m of r.moves) {
        const hist = r.breachHistory[m.source] as boolean[];
        expect(hist[m.index]).toBe(true);
        expect(hist[m.index - 1]).toBe(true);
      }
    }
  });

  it("never round-trips inside one cooldown", () => {
    for (const r of [...RUNS, ...RUNS_SINCE]) {
      for (let i = 1; i < r.moves.length; i += 1) {
        const prev = r.moves[i - 1] as Move;
        const cur = r.moves[i] as Move;
        if (cur.source === prev.dest && cur.dest === prev.source) {
          const rule = ruleFor(demoDeriveAllRouterRules(ORCH_DIAL_DEFAULTS, SLOTS), prev.source);
          expect(cur.nowMs - prev.nowMs).toBeGreaterThanOrEqual(rule.cooldownMs);
        }
      }
    }
  });

  it("whipsaw: the crossings outnumber the moves, so the mechanism refuses churn", () => {
    for (const runs of [RUNS, RUNS_SINCE]) {
      const w = runs.find((r) => r.regime === "whipsaw")!;
      expect(w.crossings).toBeGreaterThan(0);
      expect(w.moves.length).toBeLessThan(w.crossings);
    }
  });

  it("the concentration band, not the rule, is what caps a relocation", () => {
    /* At two lanes and a 60% ceiling the B.5 floor is 40%, so a book seated
       50/50 can shift at most 10pp before `applyMove` has no room. The
       founder's sentence says "relocates the capital"; the mechanism SHIFTS
       allocation inside a band and never evacuates a lane. Every regime that
       stays inverted ends at the same 0.400 / 0.600. */
    expect(MIN_WEIGHT).toBe(0.4);
    expect(MAX_WEIGHT).toBe(0.6);
    const m = RUNS.find((r) => r.regime === "measured")!;
    expect(m.endWeights[LOOP]).toBeCloseTo(MIN_WEIGHT, 9);
    expect((m.moves[0] as Move).weight).toBeCloseTo(0.1, 9);
    expect((m.moves[0] as Move).weight).toBeLessThan(DEMO_ROUTER_MOVE_WEIGHT);
  });

  it("the measured window crosses the bar in one direction only, and the doc says so", () => {
    const m = RUNS.find((r) => r.regime === "measured")!;
    const loopAhead = (m.breachHistory[FLOOR] as boolean[]).filter(Boolean).length;
    const floorAhead = (m.breachHistory[LOOP] as boolean[]).filter(Boolean).length;
    /* The USDe incentive is zero for the first 42 days of the window, so a
       2.5x loop pays its borrow out of nothing and the floor clears the 3pp
       bar on every one of them. The loop never clears it going the other way:
       its best day is 1.7pp ahead. The return leg is shown by the regimes,
       not by the measured history, and ROUTER_QUANT.md states that. */
    expect(floorAhead).toBeGreaterThan(0);
    expect(loopAhead).toBe(0);
  });

  it("the routed book is a convex combination of the two lanes on every single day", () => {
    /* Routing moves capital; it never creates leverage. The book's gross rate
       has to sit between the two lanes' rates every day, or the fold has
       invented a return. */
    for (const r of [...RUNS, ...RUNS_SINCE]) {
      for (let i = 0; i < r.dailyBook.length; i += 1) {
        const lo = Math.min(r.dailyLoop[i] as number, r.dailyFloor[i] as number);
        const hi = Math.max(r.dailyLoop[i] as number, r.dailyFloor[i] as number);
        expect(r.dailyBook[i]).toBeGreaterThanOrEqual(lo - 1e-12);
        expect(r.dailyBook[i]).toBeLessThanOrEqual(hi + 1e-12);
      }
    }
  });

  it("a run with no moves is exactly the static 50/50 book, so friction is only ever charged on a move", () => {
    for (const r of [...RUNS, ...RUNS_SINCE]) {
      if (r.moves.length > 0) continue;
      expect(r.frictionApy).toBe(0);
      expect(r.routedApy).toBeCloseTo(r.staticHalfApy, 12);
    }
  });

  it("over the measured 90 days the routed book beats the lane the router left, in every regime", () => {
    for (const r of RUNS) {
      expect(r.routedApy).toBeGreaterThan(r.staticLoopApy);
    }
  });

  it("every move it makes pays itself back inside the 90-day horizon", () => {
    /* The gate, verified rather than assumed. `paybackMs` is the owner and
       the fold refuses a firing whose payback runs past the horizon, so no
       recorded move may exceed it.

       WHAT THIS DOES NOT SAY, and the doc says it instead: the horizon is 90
       days and a replay window can be shorter. A move landing 3 days before a
       47-day window closes is correct AND still unpaid when the replay stops,
       so a routed return quoted over a window shorter than the payback is an
       understatement of the mechanism, not a measurement of it. */
    for (const r of [...RUNS, ...RUNS_SINCE]) {
      for (const m of r.moves) {
        const days = paybackMs(demoExitProfile(), m.improvement) / DAY_MS;
        expect(days).toBeLessThanOrEqual(PAYBACK_HORIZON_DAYS);
      }
    }
  });
});
