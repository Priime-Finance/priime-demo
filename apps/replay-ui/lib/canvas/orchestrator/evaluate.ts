/* ─────────────────────────────────────────────────────────────────────────
 * PORTED VERBATIM (plan WP-2, docs/plans/ROUTER_LANE_PLAN.md, ruling R7).
 *
 *   source repo   ~/Desktop/autoloop-clean/autoloop-frontend
 *   source path   lib/canvas/orchestrator/evaluate.ts
 *   source commit eb6d33a96954819b370e93727fc2d7dcd6ba23bc
 *
 * The body below is the live app's file, byte for byte, with this header
 * prepended and NOTHING ELSE CHANGED. Any import that did not resolve in the
 * demo is listed in the WP-2 report rather than silently rewritten here; a
 * ported file that quietly diverges from its source is a second
 * implementation wearing the first one's name.
 * ───────────────────────────────────────────────────────────────────────── */

/* eslint-disable @typescript-eslint/prefer-optional-chain, @typescript-eslint/no-unused-vars --
 * The two findings below are the SOURCE FILE'S OWN, and rewriting either
 * would make this a port that diverges from the file it names. The demo's
 * `rule-schema.ts` carries the same directive for the same reason, and that
 * is the precedent this follows. Reported as cross-package findings against
 * the live app rather than fixed here. */

/**
 * THE EVALUATOR (spec WP-8). The half of the orchestrator that had never run.
 *
 * `evaluateOrchestrator` folds a stream of `OrchTick`s over one
 * `OrchRuleState` per `(ruleId, slotId)` and emits `AttestedDecision[]`,
 * `SettlementLeg[]` and `AttestedReceipt[]`. It is PURE: no `Date.now()`, no
 * `Math.random()`, no I/O, no module-level state. The clock is `tickIndex`,
 * and `nowMs` arrives on the tick because `cooldownMs` is denominated in real
 * milliseconds by ruling (spec B.6.4) and must not be re-denominated here.
 *
 * ── THE SLOT UNIVERSE IS `cfg.loops`, AND FOREIGN REFS ARE COUNTED ────────
 *
 * A tick carrying a ref for a slotId outside `cfg.loops` is DROPPED AND
 * COUNTED, and the count is surfaced on the result. Dropping it silently
 * turns a corrupted input into a quiet non-event; counting it is what lets a
 * caller tell "the router did nothing" apart from "the router was fed a
 * portfolio it does not govern". The same discipline runs one level down:
 * `selectDestination` refuses a whole call whose candidate array names a
 * foreign slot, and `destinationRefusals` carries that count beside this one.
 *
 * ── THE BUDGET IS A REFUSAL, NEVER A SIZE-DOWN ────────────────────────────
 *
 * `turnoverBudgetPctWeek` has 19 stops and `deriveMoveWeight` collapses 11 of
 * them onto the same 0.25 move weight, so today more than half the dial is
 * inert. `OrchBudgetState` is the second channel that makes the ceiling the
 * dial itself: a rolling `windowTicks` sum of committed turnover, where
 * `realized + inFlight + this move > ceiling` REFUSES the firing with a
 * stated reason. It is never silently sized down, because a move quietly
 * smaller than the rule asked for is a second opinion about the rule, and a
 * record stating a move the rule did not ask for is the defect the whole
 * attestation exists to refuse.
 *
 * ── THE WAIT IS PRICED, NOT WEIGHTED ──────────────────────────────────────
 *
 * The destination's `targetWeight` rises IMMEDIATELY, so `applyMove` stays
 * one expression and R37 and R23 are untouched: Σ target = 1 at every tick,
 * including while a leg is open. There is no in-flight bucket in the
 * invariant. What the leg carries is the PRICE of the wait: weight on an open
 * leg earns ZERO, which is `earningWeightByTick` and is why Σ earning < 1
 * across a settlement. A three-bucket Σ would reopen the D11 shape.
 *
 * ── DEVIATIONS FROM THE SPEC'S LITERAL CALL ORDER, BOTH FORCED ────────────
 *
 * 1. The spec's sequence reads "selectDestination then sizeMove"; the shipped
 *    `selectDestination(slots, sourceSlotId, moveUsd, ...)` takes the move
 *    size as an argument, because the headroom filter is `0.5 * capacity -
 *    allocated >= moveUsd`. So `sizeMove` runs first and ONCE per (rule,
 *    tick), and the one sizing feeds both the metric's ranking and the
 *    destination's. Two sizings would be two opinions about one move.
 * 2. R31 says a sub-floor firing DEFERS and retries. `advanceRuleState` has
 *    already spent the rule's arm and stamped its cooldown by the time this
 *    file learns the rule fired, so the firing is REFUSED with the dust
 *    reason rather than queued. Refusing states what happened; a queue that
 *    re-fires without re-arming would be a second rule engine.
 */

import {
  advanceRuleState,
  applyMove,
  edgeLocked,
  exitProfileFor,
  initialRuleState,
  lockReverseEdge,
  PAUSE_DESTINATION,
  PAYBACK_HORIZON_DAYS,
  paybackMs,
  selectDestination,
  sizeMove,
} from "./index";
import { buildAttestedDecision, buildAttestedReceipt } from "./attest";
/* `pct` IS THE SOLE `%` EMITTER IN THIS CODEBASE and the refusal reasons are
   visible copy: they travel to the route's response and are rendered beside
   the meters. A private `(x * 100).toFixed(n) + "%"` here would be an
   eleventh copy of the thing `format.ts` exists to own, and it would also
   print a signed zero, which `pct` refuses on purpose. */
import { pct } from "../format";
/* TYPE-ONLY, and deliberately from `./rule-schema` rather than the barrel.
   `ExitEndpoint`, `DestinationRanking` and `RankedDestination` are not
   re-exported by `./index` yet (raised as a cross-package request against
   WP-6). A `import type` statement is erased before it reaches a module
   graph, so this cannot re-open the `rule-schema -> ../capacity -> ... ->
   templates -> graph-ops -> orchestrator/index` initialization cycle that
   makes `rule-schema` unusable as an entry point. Every VALUE above comes
   from the barrel for exactly that reason. */
import type { DestinationRanking, ExitEndpoint } from "./rule-schema";
import type {
  AttestedDecision,
  AttestedReceipt,
  ObservationRef,
  OrchBudgetState,
  OrchestratorConfig,
  OrchRule,
  OrchRuleState,
  SettlementLeg,
  SlotLiveState,
} from "./types";

/** A day in milliseconds. A unit, not a bound: `paybackMs` answers in ms and
 *  `PAYBACK_HORIZON_DAYS` is quoted in days, so one of them has to convert. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The slack on the budget comparison, DERIVED from the rounding it tolerates.
 *
 * `sizeMove` quantizes every move to a cent (`toFixed(2)`), so `n` committed
 * moves inside the window can have accumulated at most `n` cents of rounding
 * against a ceiling quoted as an exact fraction of the book. Refusing a whole
 * move because two cent-rounded moves spend a fraction of a cent past a
 * ceiling is a rounding artifact, not a policy, and it would show up as the
 * dial refusing at exactly the stop where it was designed to fit. The
 * tolerance is one cent per commit, expressed as a weight.
 */
function budgetEps(commitCount: number, tvlUsd: number): number {
  return tvlUsd > 0 ? (0.01 * (commitCount + 1)) / tvlUsd : 0;
}

// ── What one tick tells the evaluator ─────────────────────────────────────

/**
 * The quantities the derived rules read, in the frames they read them in.
 *
 * `netApyOnDepositApy` is the VENUE frame, because `net_apy_floor`'s
 * threshold is `ECON_FLOOR_APY`, a scan gate quoted on the scanner's own
 * number. `publishedNetApy` and `riskAdjUnified` are the PRODUCT frame, fee
 * inside, because the ranking and the drawn chart must be one frame (INV-11)
 * and the recorded two-frames defect is exactly a chart drawn in one and a
 * decision taken in the other.
 *
 * The producer composes `riskAdjUnified` and passes it; this file never
 * re-derives it, so there is one owner of "what is this lane worth".
 */
export interface SlotReading {
  netApyOnDepositApy: number | null;
  capacityUsd: number | null;
  fundingP25Apr: number | null;
  curBasisDev: number | null;
  eligible: boolean;
  statusLive: boolean;
  emergency: boolean;
  /** Fee inside. The frame the chart draws. */
  publishedNetApy: number | null;
  /** `riskAdjUnified(publishedNetApy, loopLeverage, maxBasisDev90d)`. */
  riskAdjUnified: number | null;
}

/** One slot's observation for one tick: the pin, and what it said. */
export interface SlotObservation {
  ref: ObservationRef;
  reading: SlotReading;
}

/**
 * The facts about a slot that do not move tick to tick.
 *
 * `settlementDays` is a MEASURED row field (the issuer's own published
 * window, through `redemption-route`), never a house constant, and it is 0 on
 * every lane whose exit is atomic. `cadenceBudgetTicks` is spec B.6.3: a
 * destination whose latest ref is older than its own publication cadence is
 * not eligible and drops out of the ranking, which is where "refuse to size
 * up on stale data" lives and it costs one predicate.
 */
export interface SlotStatics {
  /** `${protocol}-${chain}`; `chainOfVenue` parses the suffix. */
  venue: string;
  settlementDays: number;
  observationsPerDay: number;
  cadenceBudgetTicks: number;
}

export interface OrchTick {
  tickIndex: number;
  /** Real milliseconds. `cooldownMs` is an anti-thrash bound against
   *  wall-clock noise and must not be denominated in a source's ticks. */
  nowMs: number;
  /** By slotId. A slotId outside `cfg.loops` is dropped and counted. A slot
   *  absent from this map published NOTHING this tick and contributes no pin,
   *  so its rules neither advance nor reset (spec B.6.2). */
  refs: Record<string, SlotObservation>;
}

// ── What the evaluator answers with ───────────────────────────────────────

/**
 * A firing that did not become a move, and the reason in words.
 *
 * The code union is inline rather than a named export because nothing outside
 * this package narrows on it today, and a named type nobody imports is the
 * unwired-layer archetype at type level. `EvaluationRefusal["code"]` names it
 * for anyone who needs it.
 */
export interface EvaluationRefusal {
  tickIndex: number;
  ruleId: string;
  slotId: string;
  destSlotId: string | null;
  code:
    | "budget"
    | "payback"
    | "dust"
    | "edge-lock"
    | "no-destination"
    | "weight-band"
    | "no-endpoint";
  reason: string;
}

export interface EvaluateResult {
  decisions: AttestedDecision[];
  receipts: AttestedReceipt[];
  legs: SettlementLeg[];
  refusals: EvaluationRefusal[];
  /** Final target weights by slotId. */
  weights: Record<string, number>;
  /** Σ target at every tick. INV-1's evidence, per tick, not asserted once. */
  weightSumByTick: number[];
  /** Weight that is actually EARNING, by slotId, per tick. Weight on an open
   *  settlement leg is zero here and full in `weights`. */
  earningWeightByTick: Record<string, number[]>;
  budget: OrchBudgetState;
  budgetByTick: OrchBudgetState[];
  /** Refs carrying a slotId outside `cfg.loops`. */
  droppedRefs: number;
  droppedSlotIds: string[];
  /** `DestinationRanking.refused`, summed: candidate arrays that named a slot
   *  outside the composed universe and therefore refused a whole call. */
  destinationRefusals: number;
  /** Decision ids minted more than once in this run. See `attest.ts` — the
   *  preimage holds no ordinal by ruling, so this is surfaced rather than
   *  de-duplicated into silence. */
  duplicateDecisionIds: string[];
  /** Firings that became a weight move. */
  moves: number;
  /** Firings, moved or refused. */
  firings: number;
}

export interface EvaluateArgs {
  cfg: OrchestratorConfig;
  ticks: readonly OrchTick[];
  orchestratedTvlUsd: number;
  /** By slotId, for every slot in `cfg.loops`. */
  statics: Record<string, SlotStatics>;
  /** The run these ticks came from. `tick` is filled per decision. */
  scenario: { hash: string; seed: number; regime: string };
  /** One tick-week, in ticks. The caller owns its own clock: this file has no
   *  opinion about how long a week is on a stream it did not generate. */
  budgetWindowTicks: number;
}

// ── The metric predicates ─────────────────────────────────────────────────

/** The trailing high the shrink leg measures against: the largest capacity in
 *  the last `lookbackPins` observations of this slot, current one included. */
function trailingHigh(history: readonly number[], lookbackPins: number): number | null {
  if (lookbackPins <= 0 || history.length === 0) return null;
  const window = history.slice(Math.max(0, history.length - lookbackPins));
  return window.reduce((m, v) => Math.max(m, v), -Infinity);
}

/**
 * Is this rule's metric breaching, and is it on the safe side of its re-arm?
 *
 * They are two questions, not one negated: `advanceRuleState` resets a streak
 * on any non-breaching pin and re-arms only on `sustainPins` consecutive pins
 * strictly past `rearmLevel`, which is the R28 hysteresis gap. A pin can be
 * neither breaching nor safe-side, and that pin resets the streak without
 * advancing the re-arm — the confirmForceCloseClear asymmetry.
 */
function readMetric(
  rule: OrchRule,
  reading: SlotReading,
  capacityHistory: readonly number[],
  improvement: number,
): { breaching: boolean; safeSide: boolean } {
  switch (rule.metric) {
    case "net_apy_floor": {
      const v = reading.netApyOnDepositApy;
      if (v === null) return { breaching: false, safeSide: false };
      return { breaching: v < rule.threshold, safeSide: v >= rule.rearmLevel };
    }
    case "capacity_shrink": {
      const v = reading.capacityUsd;
      if (v === null) return { breaching: false, safeSide: false };
      const absLeg = rule.threshold > 0 && v < rule.threshold;
      const high = trailingHigh(capacityHistory, rule.lookbackPins);
      const shrinkLeg =
        rule.shrinkFrac !== null && high !== null && Number.isFinite(high) && v < rule.shrinkFrac * high;
      const breaching = absLeg || shrinkLeg;
      return { breaching, safeSide: !breaching && v >= rule.rearmLevel };
    }
    case "funding_p25_streak": {
      const v = reading.fundingP25Apr;
      if (v === null) return { breaching: false, safeSide: false };
      return { breaching: v < rule.threshold, safeSide: v >= rule.rearmLevel };
    }
    case "gate_flip":
      return { breaching: !reading.eligible, safeSide: reading.eligible };
    case "basis_early_warn": {
      const v = reading.curBasisDev;
      if (v === null) return { breaching: false, safeSide: false };
      return { breaching: v > rule.threshold, safeSide: v <= rule.rearmLevel };
    }
    case "better_elsewhere":
      if (!Number.isFinite(improvement)) return { breaching: false, safeSide: true };
      return { breaching: improvement >= rule.threshold, safeSide: improvement <= rule.rearmLevel };
  }
}

// ── The fold ──────────────────────────────────────────────────────────────

interface SlotRuntime {
  latest: SlotObservation | null;
  latestTick: number;
  observations: number;
  capacityHistory: number[];
  paused: boolean;
}

interface OpenLeg {
  leg: SettlementLeg;
  /** `observations` on the destination when the leg opened. */
  openedAtDestObservations: number;
  decisionId: string;
  committedUsd: number;
  realizedCostUsd: number;
  commitId: number;
}

/**
 * One committed move's turnover, as the budget sees it.
 *
 * Keyed by a MONOTONE id rather than by array position, because the rolling
 * window prunes this array every tick and an index into a pruned array points
 * at somebody else's move. Getting that wrong closes the wrong leg's budget
 * entry, which is a silent over-spend.
 */
interface Commit {
  commitId: number;
  tickIndex: number;
  weight: number;
  open: boolean;
}

/** The slotId a ruleId belongs to. Rule ids are `${slotId}:${family}` and the
 *  family is the LAST segment, so a slotId carrying a colon still parses. */
function slotOfRule(ruleId: string): string {
  const i = ruleId.lastIndexOf(":");
  return i > 0 ? ruleId.slice(0, i) : ruleId;
}

export function evaluateOrchestrator(args: EvaluateArgs): EvaluateResult {
  const { cfg, ticks, orchestratedTvlUsd: tvl, statics, budgetWindowTicks } = args;
  const scenario = args.scenario;

  const slotIds = cfg.loops.map((l) => l.slotId);
  const universe = new Set(slotIds);
  const bounds: Record<string, { min: number; max: number }> = {};
  const runtime: Record<string, SlotRuntime> = {};
  const weights: Record<string, number> = {};
  const earningWeightByTick: Record<string, number[]> = {};
  for (const l of cfg.loops) {
    bounds[l.slotId] = { min: l.minWeight, max: l.maxWeight };
    weights[l.slotId] = l.targetWeight;
    runtime[l.slotId] = { latest: null, latestTick: -1, observations: 0, capacityHistory: [], paused: false };
    earningWeightByTick[l.slotId] = [];
  }

  const rules = [...cfg.rules].sort((a, b) => a.ruleId.localeCompare(b.ruleId));
  const states: Record<string, OrchRuleState> = {};
  for (const r of rules) states[r.ruleId] = initialRuleState();

  let locks = { reverseLockedUntilMs: {} as Record<string, number> };
  const ceiling = cfg.dials.turnoverBudgetPctWeek / 100;

  const decisions: AttestedDecision[] = [];
  const receipts: AttestedReceipt[] = [];
  const closedLegs: SettlementLeg[] = [];
  const refusals: EvaluationRefusal[] = [];
  const weightSumByTick: number[] = [];
  const budgetByTick: OrchBudgetState[] = [];
  const droppedSlotIds: string[] = [];
  const seenDecisionIds = new Set<string>();
  const duplicateDecisionIds: string[] = [];

  let openLegs: OpenLeg[] = [];
  let commits: Commit[] = [];
  let commitSeq = 0;
  let droppedRefs = 0;
  let destinationRefusals = 0;
  let moves = 0;
  let firings = 0;
  let legSeq = 0;

  /** An evacuation rule of this slot that is breaching while armed, or has
   *  fired and not re-armed (R27). `better_elsewhere` is an UPGRADE, not an
   *  evacuation, so it never disqualifies a destination. */
  const evacuationBreaching = (slotId: string): boolean =>
    rules.some((r) => {
      if (r.metric === "better_elsewhere" || slotOfRule(r.ruleId) !== slotId) return false;
      const s = states[r.ruleId];
      return !s.armed || s.streak > 0;
    });

  const budgetNow = (tickIndex: number): OrchBudgetState => {
    const realized = commits
      .filter((c) => !c.open && c.tickIndex > tickIndex - budgetWindowTicks)
      .reduce((s, c) => s + c.weight, 0);
    const inFlight = commits.filter((c) => c.open).reduce((s, c) => s + c.weight, 0);
    return { windowTicks: budgetWindowTicks, realized, inFlight, ceiling };
  };

  const endpointAt = (slotId: string): ExitEndpoint | null => {
    const st = statics[slotId];
    const obs = runtime[slotId]?.latest;
    if (!st || !obs || obs.reading.publishedNetApy === null) return null;
    return {
      venue: st.venue,
      publishedNetApy: obs.reading.publishedNetApy,
      settlementDays: st.settlementDays,
      observationsPerDay: st.observationsPerDay,
    };
  };

  for (const tick of ticks) {
    // 1. Absorb the tick. A ref for a slot outside cfg.loops is dropped and
    //    counted; it never reaches a rule, a ranking or a record.
    for (const [slotId, obs] of Object.entries(tick.refs)) {
      if (!universe.has(slotId)) {
        droppedRefs += 1;
        if (!droppedSlotIds.includes(slotId)) droppedSlotIds.push(slotId);
        continue;
      }
      const rt = runtime[slotId];
      rt.latest = obs;
      rt.latestTick = tick.tickIndex;
      rt.observations += 1;
      if (obs.reading.capacityUsd !== null) rt.capacityHistory.push(obs.reading.capacityUsd);
    }

    // 2. Settle before deciding, so freed budget is available this tick. A leg
    //    closes on the DESTINATION's own clock: it waits `settleSeqs` of the
    //    destination's observations, which is what `ExitProfile.settleSeqs`
    //    means and why it is never milliseconds.
    const stillOpen: OpenLeg[] = [];
    for (const ol of openLegs) {
      const destRt = runtime[ol.leg.destSlotId];
      const elapsed = destRt.observations - ol.openedAtDestObservations;
      const settledRef = destRt.latest?.ref ?? null;
      if (elapsed >= ol.leg.settleSeqs && settledRef) {
        const closed: SettlementLeg = { ...ol.leg, settledAt: settledRef };
        closedLegs.push(closed);
        const commit = commits.find((c) => c.commitId === ol.commitId);
        if (commit) commit.open = false;
        receipts.push(
          buildAttestedReceipt({
            decisionId: ol.decisionId,
            settledAtRef: settledRef,
            realizedWeight: ol.leg.weight,
            realizedCostUsd: ol.realizedCostUsd,
            committedUsd: ol.committedUsd,
            /* Cents, on both sides. `sizeMove` quantizes the committed USD and
               `applyMove` quantizes the weight, so comparing an unrounded
               product against a rounded commitment reports a shortfall of a
               thousandth of a cent, which reads as a measurement and is
               arithmetic noise. */
            deliveredUsd: Number((ol.leg.weight * tvl).toFixed(2)),
          }),
        );
      } else {
        stillOpen.push(ol);
      }
    }
    openLegs = stillOpen;

    // 3. Prune the rolling window: a settled commit outside it no longer
    //    spends budget. An OPEN leg spends it wherever it was committed,
    //    because capital in flight is in flight.
    commits = commits.filter((c) => c.open || c.tickIndex > tick.tickIndex - budgetWindowTicks);

    // 4. Evaluate every rule, in ruleId order, against this tick.
    let indexWithinTick = 0;
    for (const rule of rules) {
      const slotId = slotOfRule(rule.ruleId);
      if (!universe.has(slotId)) continue;
      const obs = tick.refs[slotId];
      // No pin: an idle source neither fires nor forgets (spec B.6.2).
      if (!obs) continue;
      const rt = runtime[slotId];

      const equityUsd = weights[slotId] * tvl;
      const sizing = sizeMove({
        moveWeight: rule.moveWeight,
        orchestratedTvlUsd: tvl,
        sourceEquityUsd: equityUsd,
        /* No hedged destination bands are measured for a canvas lane, so the
           $50 unhedged floor applies. Passing a fabricated band would put a
           minimum deposit into a signed record that nothing measured. */
        destMarginBands: null,
      });

      // The candidate universe: every composed slot that is not paused and
      // whose latest ref is inside its own publication cadence (B.6.3).
      const candidates: SlotLiveState[] = [];
      for (const id of slotIds) {
        const r = runtime[id];
        if (!r.latest || r.paused) continue;
        const budgetTicks = statics[id]?.cadenceBudgetTicks ?? Infinity;
        if (tick.tickIndex - r.latestTick >= budgetTicks) continue;
        candidates.push({
          slotId: id,
          candidateId: cfg.loops.find((l) => l.slotId === id)?.candidateId ?? id,
          eligible: r.latest.reading.eligible,
          statusLive: r.latest.reading.statusLive,
          emergency: r.latest.reading.emergency,
          evacuationBreaching: evacuationBreaching(id),
          riskAdjUnified: r.latest.reading.riskAdjUnified,
          capacityUsd: r.latest.reading.capacityUsd,
          allocatedUsd: weights[id] * tvl,
          observed: r.latest.ref,
        });
      }

      let ranking: DestinationRanking | null = null;
      if (rule.destination !== PAUSE_DESTINATION) {
        ranking = selectDestination(candidates, slotId, sizing.moveUsd, rule.destination, slotIds);
        destinationRefusals += ranking.refused;
      }

      const sourceRiskAdj = obs.reading.riskAdjUnified;
      const bestPeer = ranking?.ranked[0];
      const improvement =
        sourceRiskAdj !== null && bestPeer && Number.isFinite(bestPeer.riskAdjUnified)
          ? bestPeer.riskAdjUnified - sourceRiskAdj
          : -Infinity;

      const { breaching, safeSide } = readMetric(rule, obs.reading, rt.capacityHistory, improvement);
      /* CAPTURED BEFORE THE ADVANCE, because firing RESETS the streak to 0 and
         the record has to state the streak the rule actually reached. It is
         not always `sustainPins`: a rule whose cooldown was still running kept
         counting breaching pins past the window, so reporting the threshold
         would understate a rule that had been breaching for twice as long. */
      const streakBeforePin = states[rule.ruleId].streak;
      const advanced = advanceRuleState(rule, states[rule.ruleId], {
        ref: obs.ref,
        breaching,
        safeSide,
        nowMs: tick.nowMs,
      });
      states[rule.ruleId] = advanced.state;
      if (!advanced.fired) continue;
      firings += 1;

      const streakAtFire = streakBeforePin + 1;
      const ruleRecord: AttestedDecision["rule"] = {
        ruleId: rule.ruleId,
        metric: rule.metric,
        threshold: rule.threshold,
        sustainPins: rule.sustainPins,
        streakAtFire,
        cooldownMs: rule.cooldownMs,
      };
      const observedRecord: Record<string, ObservationRef> = {};
      for (const id of slotIds) {
        const r = runtime[id].latest;
        if (r) observedRecord[id] = r.ref;
      }

      /* `budget` is snapshotted AFTER this move's own commit is recorded, so
         the record states where the week stood ONCE this move was counted
         rather than the room it had a moment earlier. A refused firing emits
         no decision, so there is no ambiguity about which snapshot a reader is
         looking at. */
      const emit = (
        destSlotId: string,
        weightBefore: number,
        weightAfter: number,
        moveUsd: number,
        cost: AttestedDecision["cost"],
        alternative: AttestedDecision["alternative"],
      ): AttestedDecision => {
        const decision = buildAttestedDecision({
          rulesHash: cfg.rulesHash,
          rule: ruleRecord,
          observed: observedRecord,
          scenarioRef: { hash: scenario.hash, seed: scenario.seed, regime: scenario.regime, tick: tick.tickIndex },
          moved: { sourceSlotId: slotId, destSlotId, weightBefore, weightAfter, moveUsd },
          cost,
          alternative,
          budget: budgetNow(tick.tickIndex),
        });
        if (seenDecisionIds.has(decision.decisionId)) duplicateDecisionIds.push(decision.decisionId);
        else seenDecisionIds.add(decision.decisionId);
        decisions.push(decision);
        indexWithinTick += 1;
        return decision;
      };

      /* NOTHING MOVES, AND THE COST OF NOTHING IS ZERO — except the payback,
         which is not zero, it is UNMEASURED. Zero would claim the move paid
         itself back instantly. `Infinity` is what `paybackMs` returns for a
         move that buys nothing, and it is what F.4 draws by omitting the
         bracket on a forced exit. */
      const noCost: AttestedDecision["cost"] = {
        oneShotFrac: 0,
        oneShotUsd: 0,
        settleSeqs: 0,
        windowCost: 0,
        paybackDays: Infinity,
      };

      // (a) The terminal destination. The loop STOPS: capital stays exactly
      //     where it is and the loop takes no new capital (D11).
      if (rule.destination === PAUSE_DESTINATION) {
        rt.paused = true;
        emit(PAUSE_DESTINATION, weights[slotId], weights[slotId], 0, noCost, { reason: "no legal peer" });
        continue;
      }

      // (b) No legal peer. The capital stays put; the record says so rather
      //     than omitting a decision the rule genuinely took.
      const destSlotId = ranking?.destination ?? PAUSE_DESTINATION;
      if (!ranking || destSlotId === PAUSE_DESTINATION) {
        refusals.push({
          tickIndex: tick.tickIndex,
          ruleId: rule.ruleId,
          slotId,
          destSlotId: null,
          code: "no-destination",
          reason:
            ranking && ranking.refused > 0
              ? `${ranking.refused} candidate slots outside the composed portfolio; the whole ranking was refused`
              : "no eligible peer with headroom; the capital stays put",
        });
        emit(PAUSE_DESTINATION, weights[slotId], weights[slotId], 0, noCost, ranking?.alternative ?? { reason: "no legal peer" });
        continue;
      }

      // (c) The priced move. `exitProfileFor`, never `railExitProfile`: the
      //     rule published the bar the RAIL alone justifies, and the evaluator
      //     holds both endpoints and can only ever refuse more.
      const sourceEnd = endpointAt(slotId);
      const destEnd = endpointAt(destSlotId);
      if (!sourceEnd || !destEnd) {
        refusals.push({
          tickIndex: tick.tickIndex,
          ruleId: rule.ruleId,
          slotId,
          destSlotId,
          code: "no-endpoint",
          reason: "one endpoint publishes no return in the product frame; the move cannot be priced",
        });
        continue;
      }
      const exit = exitProfileFor(sourceEnd, destEnd);
      const pbMs = paybackMs(exit, improvement);
      const paybackDays = pbMs / DAY_MS;

      if (sizing.deferred) {
        refusals.push({
          tickIndex: tick.tickIndex, ruleId: rule.ruleId, slotId, destSlotId,
          code: "dust", reason: sizing.reason,
        });
        continue;
      }

      if (edgeLocked(locks, slotId, destSlotId, tick.nowMs)) {
        refusals.push({
          tickIndex: tick.tickIndex, ruleId: rule.ruleId, slotId, destSlotId,
          code: "edge-lock",
          reason: `the ${slotId} to ${destSlotId} edge is locked until its last move pays back`,
        });
        continue;
      }

      const intendedWeight = sizing.moveUsd / tvl;
      const b = budgetNow(tick.tickIndex);
      if (b.realized + b.inFlight + intendedWeight > ceiling + budgetEps(commits.length, tvl)) {
        refusals.push({
          tickIndex: tick.tickIndex, ruleId: rule.ruleId, slotId, destSlotId,
          code: "budget",
          reason:
            `turnover ${pct(b.realized + b.inFlight, 2)} of ${pct(ceiling, 0)} spent this ` +
            `${budgetWindowTicks}-tick week; this move needs ${pct(intendedWeight, 2)} and is refused rather than sized down`,
        });
        continue;
      }

      /* THE PAYBACK GATE APPLIES TO AN UPGRADE AND TO NOTHING ELSE (F.4). A
         forced exit is unavoidable, so its cost is displayed and not gated;
         gating it would leave the capital in a lane the rule just condemned. */
      if (rule.metric === "better_elsewhere" && !(paybackDays <= PAYBACK_HORIZON_DAYS)) {
        refusals.push({
          tickIndex: tick.tickIndex, ruleId: rule.ruleId, slotId, destSlotId,
          code: "payback",
          reason: Number.isFinite(paybackDays)
            ? `payback ${paybackDays.toFixed(0)} days runs past the ${PAYBACK_HORIZON_DAYS}-day horizon`
            : `the move buys no improvement, so it never pays back`,
        });
        continue;
      }

      const before = weights[slotId];
      const destBefore = weights[destSlotId];
      const next = applyMove(weights, bounds, slotId, destSlotId, intendedWeight);
      const actualWeight = Number(((next[destSlotId] ?? 0) - destBefore).toFixed(9));
      if (!(actualWeight > 0)) {
        refusals.push({
          tickIndex: tick.tickIndex, ruleId: rule.ruleId, slotId, destSlotId,
          code: "weight-band",
          reason: `no room: ${slotId} is at its ${pct(bounds[slotId].min, 0)} floor or ${destSlotId} is at its ${pct(bounds[destSlotId].max, 0)} ceiling`,
        });
        continue;
      }
      for (const id of slotIds) weights[id] = next[id] ?? weights[id];
      moves += 1;

      locks = lockReverseEdge(locks, slotId, destSlotId, tick.nowMs, rule.cooldownMs, pbMs);

      const moveUsd = Number((actualWeight * tvl).toFixed(2));
      const oneShotUsd = Number((exit.oneShotFrac * moveUsd).toFixed(2));
      commitSeq += 1;
      const commitId = commitSeq;
      commits.push({ commitId, tickIndex: tick.tickIndex, weight: actualWeight, open: exit.settleSeqs > 0 });

      const decision = emit(
        destSlotId,
        before,
        weights[slotId],
        moveUsd,
        { oneShotFrac: exit.oneShotFrac, oneShotUsd, settleSeqs: exit.settleSeqs, windowCost: exit.windowCost, paybackDays },
        ranking.alternative,
      );

      const realizedCostUsd = Number((oneShotUsd + moveUsd * exit.windowCost).toFixed(2));
      if (exit.settleSeqs > 0) {
        legSeq += 1;
        openLegs.push({
          leg: {
            legId: `${decision.decisionId}:${legSeq}`,
            decisionId: decision.decisionId,
            sourceSlotId: slotId,
            destSlotId,
            weight: actualWeight,
            openedAt: obs.ref,
            settleSeqs: exit.settleSeqs,
            settledAt: null,
          },
          openedAtDestObservations: runtime[destSlotId].observations,
          decisionId: decision.decisionId,
          committedUsd: moveUsd,
          realizedCostUsd,
          commitId,
        });
      } else {
        // An atomic rail settles at the same observation it opened at, so the
        // receipt lands now and no leg is ever open.
        receipts.push(
          buildAttestedReceipt({
            decisionId: decision.decisionId,
            settledAtRef: runtime[destSlotId].latest?.ref ?? obs.ref,
            realizedWeight: actualWeight,
            realizedCostUsd,
            committedUsd: moveUsd,
            deliveredUsd: moveUsd,
          }),
        );
      }
    }

    // 5. Record the invariant and the meters this tick leaves behind.
    weightSumByTick.push(Number(slotIds.reduce((s, id) => s + weights[id], 0).toFixed(9)));
    for (const id of slotIds) {
      const inbound = openLegs.filter((ol) => ol.leg.destSlotId === id).reduce((s, ol) => s + ol.leg.weight, 0);
      earningWeightByTick[id].push(Number(Math.max(0, weights[id] - inbound).toFixed(9)));
    }
    budgetByTick.push(budgetNow(tick.tickIndex));
  }

  return {
    decisions,
    receipts,
    legs: [...closedLegs, ...openLegs.map((ol) => ol.leg)],
    refusals,
    weights,
    weightSumByTick,
    earningWeightByTick,
    budget: budgetNow(ticks.length > 0 ? ticks[ticks.length - 1].tickIndex : 0),
    budgetByTick,
    droppedRefs,
    droppedSlotIds,
    destinationRefusals,
    duplicateDecisionIds,
    moves,
    firings,
  };
}
