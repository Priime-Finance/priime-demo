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
 * (`loopPublishedApyByDay` / `floorPublishedApyByDay`, through the fold); the
 * bar, the hysteresis, the sustain and the move weight come from
 * `demo-rules.ts`; the moves come from `evaluateOrchestrator`. The one test
 * this file performs itself is the breach test, quoted from
 * `lib/canvas/orchestrator/evaluate.ts:304-305`:
 *
 *     if (!Number.isFinite(improvement)) return { breaching: false, safeSide: true };
 *     return { breaching: improvement >= rule.threshold, safeSide: improvement <= rule.rearmLevel };
 *
 * and it performs it only to count the days a lane has been behind, which is
 * the clock the instrument draws and not a decision.
 *
 * ── THE SEAM, CLOSED (integration) ───────────────────────────────────────
 * This module shipped its own hand fold because the route did not exist at
 * the base commit. It no longer has one. `foldRouterRun("measured")` in
 * `lib/canvas/router-fold.ts` is the ONE fold, the same call the dock's run
 * panel reaches through `GET /api/canvas/orchestrate`, and the difference was
 * never cosmetic: the shipped `evaluateOrchestrator` ranks a destination
 * through `selectDestination`, gates each firing on payback and locks the
 * reverse edge until the last move has paid back, and a hand fold does none
 * of those. On the measured window both answered one move on 2026-06-12 at
 * 10.0pp, which is why the divergence was invisible; on `whipsaw` a hand fold
 * takes five moves where the evaluator takes three.
 *
 * WHAT THIS MODULE STILL OWNS is the READING of that run for the vault page:
 * the trailing streak that fills the 48 hour clock, the cooldown test, and
 * the day labels. The streak is a reading of the two published series against
 * the rule's own bar, not a second evaluation of the rules: the evaluator
 * zeroes its pin count on the pin that fires, and the clock has to keep
 * counting the days a lane is behind after it does.
 * `tests/vaults.test.ts` pins the answer to the quant's published measurement
 * (docs/plans/ROUTER_QUANT.md), so a divergence fails there first.
 *
 * ── ONE CLOCK ────────────────────────────────────────────────────────────
 * "Today" is the last aligned day of the capture, never `Date.now()`. The
 * Aave series publishes one point per day and the loop's midnight borrow is
 * the only reading on that clock; reading the wall clock would compare a rate
 * from September against a calendar from whenever the page is opened.
 */

import {
  ROUTER_FLOOR_SLOT,
  ROUTER_LOOP_SLOT,
  foldRouterRun,
} from "@/lib/canvas/router-fold";
import {
  DEMO_SUSTAIN_HOURS,
  DEMO_SUSTAIN_PINS_DAILY,
  DEMO_UPGRADE_THRESHOLD,
  demoDeriveAllRouterRules,
} from "@/lib/canvas/orchestrator/demo-rules";
import { clampOrchDials, ORCH_DIAL_DEFAULTS } from "@/lib/canvas/param-schema";
import { clampConcentrationPct } from "@/lib/canvas/orchestrator";
import type { LoopSlot, OrchRule } from "@/lib/canvas/orchestrator/types";

export { ROUTER_LOOP_SLOT };

export type RouterLaneId = typeof ROUTER_LOOP_SLOT | typeof ROUTER_FLOOR_SLOT;

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

/* THE SAME TWO SLOTS THE FOLD BUILDS, for the rule derivation only: no
   weight, decision or series is read off them here, and the fold is the one
   that folds them. `screenedAtApy` stays null for the reason stated there. */
const DIALS = clampOrchDials(ORCH_DIAL_DEFAULTS);
const MAX_WEIGHT = clampConcentrationPct(DIALS.maxConcentrationPct, 2) / 100;
const MIN_WEIGHT = Math.max(0, 1 - 1 * MAX_WEIGHT);
const SLOTS: LoopSlot[] = [ROUTER_LOOP_SLOT, ROUTER_FLOOR_SLOT].map((slotId) => ({
  slotId,
  venue: slotId === ROUTER_LOOP_SLOT ? "morpho-blue-base" : "treasury-ausdc-base",
  candidateId: slotId,
  marketKey: slotId,
  cls: "N1",
  targetWeight: 0.5,
  minWeight: MIN_WEIGHT,
  maxWeight: MAX_WEIGHT,
  screenedAtApy: null,
  metrics: { funding: false, basis: false },
}));

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

  /* THE ONE FOLD. Same call the dock's run panel makes through the route, on
     the same default regime, so the two surfaces cannot state two move
     counts. Everything below READS this run; nothing re-decides it. */
  const run = foldRouterRun("measured");
  const dates = run.days;
  const apyByLane: Record<RouterLaneId, number[]> = {
    loop: run.laneSeries.carryPublishedApy,
    floor: run.laneSeries.floorPublishedApy,
  };

  /* The rule set the fold itself built, re-derived from the same three
     owners: the cooldown the instrument states and the bar the clock counts
     against are the rule's own, and re-deriving from `demoDeriveAllRouterRules`
     is the same pure call rather than a second table. */
  const rules = demoDeriveAllRouterRules(DIALS, SLOTS, DEMO_SUSTAIN_PINS_DAILY);
  const loopRule = ruleFor(rules, ROUTER_LOOP_SLOT);

  const moves: RouterMove[] = run.decisions
    .filter((d) => d.moved.destSlotId === ROUTER_LOOP_SLOT || d.moved.destSlotId === ROUTER_FLOOR_SLOT)
    .map((d): RouterMove | null => {
      const tick = d.scenarioRef.tick;
      const date = dates[tick];
      if (date === undefined) return null;
      const source = d.moved.sourceSlotId === ROUTER_LOOP_SLOT ? ROUTER_LOOP_SLOT : ROUTER_FLOOR_SLOT;
      const dest: RouterLaneId = source === ROUTER_LOOP_SLOT ? ROUTER_FLOOR_SLOT : ROUTER_LOOP_SLOT;
      return {
        date,
        ms: Date.parse(`${date}T00:00:00.000Z`),
        source,
        dest,
        /* What the band actually let through, off the decision's own record
           of the source lane's weight either side of the move. The rule's
           12.5pp dial is not this number and never was. */
        weightFrac: Number((d.moved.weightBefore - d.moved.weightAfter).toFixed(9)),
        /* The improvement that fired it, read off the two published series at
           the tick it fired on: the same difference the rule tested. */
        improvementApy: (apyByLane[dest][tick] ?? 0) - (apyByLane[source][tick] ?? 0),
      };
    })
    .filter((m): m is RouterMove => m !== null);

  /* THE CLOCK, and it is a reading rather than a decision. `advanceRuleState`
     zeroes its own pin count on the pin that fires, so the fold cannot answer
     "how many consecutive days has this lane been behind by at least the
     bar"; the two published series can, through the same breach test
     `evaluate.ts:304-305` performs. */
  const streak: Record<RouterLaneId, number> = { loop: 0, floor: 0 };
  for (let i = 0; i < dates.length; i += 1) {
    for (const source of [ROUTER_LOOP_SLOT, ROUTER_FLOOR_SLOT] as RouterLaneId[]) {
      const dest: RouterLaneId = source === ROUTER_LOOP_SLOT ? ROUTER_FLOOR_SLOT : ROUTER_LOOP_SLOT;
      const improvement = (apyByLane[dest][i] ?? NaN) - (apyByLane[source][i] ?? NaN);
      const breaching = Number.isFinite(improvement) && improvement >= DEMO_UPGRADE_THRESHOLD;
      streak[source] = breaching ? streak[source] + 1 : 0;
    }
  }

  const last = dates.length - 1;
  const asOfDate = dates[last] ?? "";
  const asOfMs = Date.parse(`${asOfDate}T00:00:00.000Z`);
  const gapApy = last >= 0 ? (apyByLane.loop[last] ?? 0) - (apyByLane.floor[last] ?? 0) : 0;
  const behindLane: RouterLaneId | null =
    streak.loop > 0 ? ROUTER_LOOP_SLOT : streak.floor > 0 ? ROUTER_FLOOR_SLOT : null;
  const breachDays = behindLane === null ? 0 : streak[behindLane];
  const hoursBehind = Math.min(DEMO_SUSTAIN_HOURS, breachDays * ROUTER_HOURS_PER_DAILY_PIN);
  const lastMove = moves.length > 0 ? (moves[moves.length - 1] ?? null) : null;
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
      loop: run.weights[ROUTER_LOOP_SLOT] ?? 0,
      floor: run.weights[ROUTER_FLOOR_SLOT] ?? 0,
    },
  };
  return CACHED;
}
