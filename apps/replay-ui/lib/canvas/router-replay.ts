/**
 * THE MEASURED REPLAY'S DECISIONS, AS ONE SYNCHRONOUS OWNER.
 *
 * The vault page has to state three facts about the router that only a fold
 * over the measured history can answer: how long the trailing lane has been
 * behind (the 48 hour clock), which cascade row is lit right now, and when
 * the last move was. This module answers exactly those, once, so the
 * instrument, the ledger row and any future reader share one arithmetic.
 *
 * ── NOTHING HERE IS A NEW NUMBER ─────────────────────────────────────────
 * The two published series come from `router-history.ts`
 * (`loopPublishedApyByDay` / `floorPublishedApyByDay`); the bar, the
 * hysteresis, the sustain and the move weight come from `demo-rules.ts`; the
 * state machine, the sizing, the anti-cycle lock and the weight transfer come
 * from `rule-schema.ts`. This file owns the SEQUENCING and nothing else, and
 * the sequencing is the same one `tests/router-backtest.test.ts` folds, line
 * for line, including the two-line breach test quoted from the live app's
 * `lib/canvas/orchestrator/evaluate.ts:304-305`:
 *
 *     if (!Number.isFinite(improvement)) return { breaching: false, safeSide: true };
 *     return { breaching: improvement >= rule.threshold, safeSide: improvement <= rule.rearmLevel };
 *
 * ── THE SEAM, STATED RATHER THAN DISCOVERED ──────────────────────────────
 * WP-2 lands `app/api/canvas/orchestrate/route.ts` and ports `evaluate.ts`
 * verbatim. That route folds the SAME history through the SAME rules for the
 * dock's run panel. When it lands it must call `measuredRouterReplay()` (or
 * this module must call it) rather than keep a second fold: two answers to
 * "how many moves did the measured 90 days produce" is exactly the defect the
 * shipping harness names. Filed as a cross-package request by WP-3.
 * `tests/vaults.test.ts` pins this fold's answer to the quant's published
 * measurement (docs/plans/ROUTER_QUANT.md), so a divergence fails here first.
 *
 * ── ONE CLOCK ────────────────────────────────────────────────────────────
 * "Today" is the last aligned day of the capture, never `Date.now()`. The
 * Aave series publishes one point per day and the loop's midnight borrow is
 * the only reading on that clock; reading the wall clock would compare a rate
 * from September against a calendar from whenever the page is opened.
 */

import {
  ROUTER_FLOOR_CANDIDATE_ID,
  ROUTER_HISTORY_ALIGNED,
  floorPublishedApyByDay,
  loopPublishedApyByDay,
} from "@/lib/canvas/router-history";
import {
  DEMO_ROUTER_BOOK_USD,
  DEMO_SUSTAIN_HOURS,
  DEMO_SUSTAIN_PINS_DAILY,
  demoDeriveAllRouterRules,
  demoExitProfile,
} from "@/lib/canvas/orchestrator/demo-rules";
import {
  PAYBACK_HORIZON_DAYS,
  advanceRuleState,
  applyMove,
  edgeLocked,
  initialRuleState,
  lockReverseEdge,
  paybackMs,
  sizeMove,
  type EdgeLockState,
} from "@/lib/canvas/orchestrator/rule-schema";
import type { LoopSlot, OrchRule, OrchRuleState } from "@/lib/canvas/orchestrator/types";
import { ORCH_DIAL_DEFAULTS } from "@/lib/canvas/param-schema";
import { DEMO_MARKET_ID } from "@/lib/demo/market";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The two lanes, by the slot ids the rules are keyed on. The loop's id is
 *  exported because the ledger's detail line reads a move's direction off it
 *  and a second spelling of "loop" is how that sentence comes to run backwards;
 *  the floor's is internal, nothing outside this fold asks for it. */
export const ROUTER_LOOP_SLOT = "loop";
const ROUTER_FLOOR_SLOT = "floor";

export type RouterLaneId = typeof ROUTER_LOOP_SLOT | typeof ROUTER_FLOOR_SLOT;

const MAX_WEIGHT = ORCH_DIAL_DEFAULTS.maxConcentrationPct / 100;
/** The B.5 derivation `max(0, 1 - (N - 1) * maxWeight)` at N = 2 lanes. */
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
    /* NULL, and load-bearing: this market never passed a levered-loop scan
       gate (lib/demo/market.ts lists it under `ineligible`), so handing it a
       screen would leave an evacuation rule permanently breaching and delete
       the founder's return leg. Same reasoning as the backtest's slot. */
    screenedAtApy: null,
    metrics: { funding: false, basis: false },
  };
}

const SLOTS: readonly LoopSlot[] = [
  slot(ROUTER_LOOP_SLOT, "morpho-blue-base", DEMO_MARKET_ID),
  slot(ROUTER_FLOOR_SLOT, "treasury-ausdc-base", ROUTER_FLOOR_CANDIDATE_ID),
];

/** One decision the measured replay actually took. */
export interface RouterMove {
  /** The aligned day it fired on, `YYYY-MM-DD`. */
  readonly date: string;
  readonly ms: number;
  readonly source: RouterLaneId;
  readonly dest: RouterLaneId;
  /** What actually moved, as a fraction of the book, after the band clamped it. */
  readonly weightFrac: number;
  /** The improvement that fired it, as an APY fraction. */
  readonly improvementApy: number;
}

/** Everything a surface needs to state the router's position today. */
export interface RouterReplay {
  /** How many aligned days the fold actually walked. */
  readonly days: number;
  /** The rule's own cooldown, in whole hours, from the derived rule set. */
  readonly cooldownHours: number;
  /** The last aligned day, which is what every surface means by "today". */
  readonly asOfDate: string;
  readonly asOfMs: number;
  /** Loop published APY minus floor published APY, today. Signed. */
  readonly gapApy: number;
  /** The lane that is behind today by at least the bar, or null. */
  readonly behindLane: RouterLaneId | null;
  /** Consecutive trailing days the behind lane has cleared the bar. */
  readonly breachDays: number;
  /** Those days in the founder's unit, capped at his window. */
  readonly hoursBehind: number;
  /** True while the window is full and a move is pending. */
  readonly clockFull: boolean;
  /** True while the most recent move is still inside its own cooldown. */
  readonly inCooldown: boolean;
  readonly moves: readonly RouterMove[];
  readonly lastMove: RouterMove | null;
  /** The weights the fold ends on, keyed by lane. */
  readonly endWeights: Readonly<Record<RouterLaneId, number>>;
}

function ruleFor(rules: readonly OrchRule[], slotId: string): OrchRule | null {
  return rules.find((r) => r.ruleId === `${slotId}:upgrade`) ?? null;
}

/** How many hours one daily pin is worth, from the founder's own window.
 *  Internal: the clock is published as `hoursBehind`, already converted. */
const ROUTER_HOURS_PER_DAILY_PIN = DEMO_SUSTAIN_HOURS / DEMO_SUSTAIN_PINS_DAILY;

/**
 * `Sep 7, 2026` from an aligned day's own `YYYY-MM-DD`, on the capture's UTC
 * clock. ONE owner, because the instrument foot, the section's register note
 * and the Parameters provenance row all name the same day and a second
 * formatter is how they come to name two.
 */
export function routerDayLabel(date: string): string {
  const ms = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(ms)) return date;
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

let CACHED: RouterReplay | null = null;

/**
 * Fold the measured 89 aligned days through the demo's rules.
 *
 * Pure and deterministic, so it is memoized: every surface on the page asks
 * the same question and the answer cannot change between them.
 */
export function measuredRouterReplay(): RouterReplay {
  if (CACHED !== null) return CACHED;

  const loopSeries = loopPublishedApyByDay();
  const floorSeries = floorPublishedApyByDay();
  const rules = demoDeriveAllRouterRules(ORCH_DIAL_DEFAULTS, SLOTS);
  const loopRule = ruleFor(rules, ROUTER_LOOP_SLOT);
  const floorRule = ruleFor(rules, ROUTER_FLOOR_SLOT);

  const dates: string[] = [];
  const apyByLane: Record<RouterLaneId, number[]> = { loop: [], floor: [] };
  for (const day of ROUTER_HISTORY_ALIGNED) {
    const l = loopSeries.find((p) => p.date === day.date);
    const f = floorSeries.find((p) => p.date === day.date);
    // A day either side prices is dropped, never filled: the two owners
    // decline in the same way `router-history` declines on a gap day.
    if (!l || !f) continue;
    dates.push(day.date);
    apyByLane.loop.push(l.apy);
    apyByLane.floor.push(f.apy);
  }

  const states: Record<RouterLaneId, OrchRuleState> = {
    loop: initialRuleState(),
    floor: initialRuleState(),
  };
  const bounds: Record<string, { min: number; max: number }> = {
    [ROUTER_LOOP_SLOT]: { min: MIN_WEIGHT, max: MAX_WEIGHT },
    [ROUTER_FLOOR_SLOT]: { min: MIN_WEIGHT, max: MAX_WEIGHT },
  };
  let weights: Record<string, number> = { [ROUTER_LOOP_SLOT]: 0.5, [ROUTER_FLOOR_SLOT]: 0.5 };
  let locks: EdgeLockState = { reverseLockedUntilMs: {} };
  const moves: RouterMove[] = [];
  /* The trailing streak per lane, kept beside the state machine rather than
     read out of it: `advanceRuleState` zeroes `streak` on the pin that fires,
     and the clock has to keep counting the days the lane is behind. */
  const streak: Record<RouterLaneId, number> = { loop: 0, floor: 0 };

  for (let i = 0; i < dates.length; i += 1) {
    const date = dates[i];
    const nowMs = Date.parse(`${date}T00:00:00.000Z`);
    for (const source of [ROUTER_LOOP_SLOT, ROUTER_FLOOR_SLOT] as RouterLaneId[]) {
      const dest: RouterLaneId = source === ROUTER_LOOP_SLOT ? ROUTER_FLOOR_SLOT : ROUTER_LOOP_SLOT;
      const rule = source === ROUTER_LOOP_SLOT ? loopRule : floorRule;
      if (rule === null) continue;
      const improvement = (apyByLane[dest][i]) - (apyByLane[source][i]);
      // evaluate.ts:304-305, verbatim.
      const breaching = Number.isFinite(improvement) && improvement >= rule.threshold;
      const safeSide = !Number.isFinite(improvement) || improvement <= rule.rearmLevel;
      streak[source] = breaching ? streak[source] + 1 : 0;

      const advanced = advanceRuleState(rule, states[source], {
        ref: { kind: "modeled", seq: i, hash: "", label: `day ${date}` },
        breaching,
        safeSide,
        nowMs,
      });
      states[source] = advanced.state;
      if (!advanced.fired) continue;
      if (edgeLocked(locks, source, dest, nowMs)) continue;
      const exit = demoExitProfile();
      const pbMs = paybackMs(exit, improvement);
      if (!(pbMs / DAY_MS <= PAYBACK_HORIZON_DAYS)) continue;
      const sizing = sizeMove({
        moveWeight: rule.moveWeight,
        orchestratedTvlUsd: DEMO_ROUTER_BOOK_USD,
        sourceEquityUsd: (weights[source]) * DEMO_ROUTER_BOOK_USD,
        destMarginBands: null,
      });
      if (sizing.deferred) continue;
      const before = weights[dest];
      const next = applyMove(weights, bounds, source, dest, sizing.moveUsd / DEMO_ROUTER_BOOK_USD);
      const actual = Number(((next[dest]) - before).toFixed(9));
      if (!(actual > 0)) continue;
      weights = next;
      moves.push({ date, ms: nowMs, source, dest, weightFrac: actual, improvementApy: improvement });
      locks = lockReverseEdge(locks, source, dest, nowMs, rule.cooldownMs, pbMs);
    }
  }

  const last = dates.length - 1;
  const asOfDate = (dates[last] ?? ROUTER_HISTORY_ALIGNED[ROUTER_HISTORY_ALIGNED.length - 1]?.date ?? "");
  const asOfMs = Date.parse(`${asOfDate}T00:00:00.000Z`);
  const gapApy = last >= 0 ? (apyByLane.loop[last]) - (apyByLane.floor[last]) : 0;
  const behindLane: RouterLaneId | null =
    streak.loop > 0 ? ROUTER_LOOP_SLOT : streak.floor > 0 ? ROUTER_FLOOR_SLOT : null;
  const breachDays = behindLane === null ? 0 : streak[behindLane];
  const hoursBehind = Math.min(DEMO_SUSTAIN_HOURS, breachDays * ROUTER_HOURS_PER_DAILY_PIN);
  const lastMove = moves.length > 0 ? (moves[moves.length - 1]) : null;
  const cooldownMs = loopRule?.cooldownMs ?? 0;
  const inCooldown = lastMove !== null && asOfMs - lastMove.ms < cooldownMs;

  CACHED = {
    days: dates.length,
    cooldownHours: Math.round(cooldownMs / (60 * 60 * 1000)),
    asOfDate,
    asOfMs,
    gapApy,
    behindLane,
    breachDays,
    hoursBehind,
    clockFull: hoursBehind >= DEMO_SUSTAIN_HOURS,
    inCooldown,
    moves,
    lastMove,
    endWeights: {
      loop: weights[ROUTER_LOOP_SLOT],
      floor: weights[ROUTER_FLOOR_SLOT],
    },
  };
  return CACHED;
}
