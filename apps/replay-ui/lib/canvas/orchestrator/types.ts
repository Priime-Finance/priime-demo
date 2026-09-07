/**
 * Orchestrator data model (ORCHESTRATOR_SPEC §1, R1–R9).
 *
 * The orchestrator is a head node ABOVE the loop spines (rank −1) governing
 * N ≥ 1 loop sub-graphs. A *pin* is one new SOURCE-DOCUMENT generation for a
 * loop's source, carried as an `ObservationRef`. Rule state advances on a new
 * (kind, seq); an identical document re-serve carries the same seq and is
 * refused (R24). The content hash left the dedupe path entirely and is
 * EVIDENCE: a repeated identical document is a non-event, and an unchanged
 * number across two distinct documents is two observations, so the streak
 * advances. A sustain window counts observations, not changes.
 *
 * ── THE RESERVE IS DELETED (recette D11, 2026-08-22) ──────────────────────
 * There was a `ReserveSlot`: validated to [0, 0.25], always exactly 0, with
 * no dial, no allocation row and no room in the Σ = 1 invariant, and it was
 * the ONLY destination `gate_flip` and the emergency path could name. So
 * three surfaces printed "evacuates to reserve" and "+ reserve" about a slot
 * that held nothing and could receive nothing. A destination that cannot
 * receive is not a destination; it is a promise.
 *
 * What actually happens when a gate flips is that the loop STOPS — capital
 * stays exactly where it is and the loop takes no new capital. That is
 * `pause`, and it is now what the rule says. `pause` is a terminal
 * destination, never a slot, never a weight.
 *
 * NOTE the name collision with lib/canvas/types.ts `OrchestratorConfig`
 * (the graph-side 3-dial store): this file's OrchestratorConfig is the DEEP
 * derived config (slots + rules + hash) built at validate/compile/eval time.
 * Import with an alias where both are in scope.
 */

import type { OrchestratorDials } from "../param-schema";

export type { OrchestratorDials };

/** One governed loop. candidateId/marketKey/contentHash pin exactly as the
 *  v1 liquidity-source module does (lib/canvas/modules.ts hidden params). */
export interface LoopSlot {
  slotId: string; // stable id, survives re-pins (the LoopId)
  venue: string; // scanner venue key
  candidateId: string; // CandidateV2.id
  marketKey: string;
  cls: "A" | "N1";
  /** Per-loop weight band. Fractions of orchestrated TVL. */
  targetWeight: number; // current steady-state target
  /**
   * Floor a rule may drain to. DERIVED, never typed (spec B.5):
   *   minWeight = max(0, 1 - (N - 1) * maxWeight)
   * which RESTATES the constraint `targetWeight <= maxWeight` plus
   * `sum(targetWeight) = 1` already imply, so it can never create a new
   * violation. Both builders (`slotsFromPortfolio` and `compilePortfolio`)
   * must compute it identically.
   */
  minWeight: number;
  maxWeight: number; // ceiling a rule may fill to
  /**
   * The catalog screen this lane was admitted through, or null when it was
   * never screened. ECON_FLOOR_APY is a LEVERED-LOOP scan gate
   * (the scanner's simulate.ts), so a lane at L = 1 never passed through
   * it and there is no screen for it to fall below. Derived from the graph:
   * a seated `safety-buffer` at an applied leverage above 1.
   *
   * `deriveOrchRules(dials, slot, peers)` is a pure function of its three
   * arguments and R38 re-derives it byte-for-byte, so the facts that GATE a
   * rule have to live on the slot rather than be looked up beside it.
   */
  screenedAtApy: number | null;
  /**
   * Which scanner metrics this lane's SOURCE actually produces. A rule that
   * reads a quantity the lane cannot produce is not a guard, it is a promise
   * (the D11 sentence, applied to a rule). R36 asks this, not `cls`.
   */
  metrics: { funding: boolean; basis: boolean };
}

/**
 * WHAT WAS OBSERVED, AND HOW IT IS IDENTIFIED.
 *
 * `blockNumber` and `contentHash` carried three jobs between them: chain
 * provenance, ordering, and identity. They coincide for a block scanner and
 * diverge for every source that is not one, which is why a funding lane's
 * guard has never been able to fire (blockNumber is 0 by ruling, and
 * `advanceRuleState` tested `<=`).
 *
 * `kind` carries provenance. `seq` carries ordering AND identity. `hash`
 * carries evidence and nothing else.
 *
 * CONTRACT ON `seq`, and it is load-bearing:
 *   - It is monotone within (slotId, kind) and nowhere else. Two kinds are
 *     never compared.
 *   - It is the SOURCE DOCUMENT's own generation ordinal, never the reader's
 *     clock. A cached re-serve must carry the same seq, or dedupe is lost.
 *       kind "block"    -> the block number.
 *       kind "print"    -> the scan document's own `generatedAtMs`.
 *       kind "nav"      -> the issuer's NAV publication index.
 *       kind "modeled"  -> the scenario tick index.
 *   - It is an ORDERING ORDINAL ONLY. It NEVER enters `decisionId` or any
 *     content-addressed field, because `generatedAtMs` is wall-clock and two
 *     observers must mint one id (the EventId::new discipline). The `hash`
 *     is what the id and the attestation carry.
 *
 * CONTRACT ON `hash`: sha-256 over the canonical serialization of the
 * METRIC-RELEVANT observed state, with `seq`, `label` and every timestamp
 * EXCLUDED. It is evidence, never a dedupe key. A constant hash across two
 * documents is legal and means the number did not move.
 */
export type ObservationKind = "block" | "print" | "nav" | "modeled";

export interface ObservationRef {
  kind: ObservationKind;
  seq: number;
  hash: string;
  /** Rendered verbatim. Claims a block ONLY when kind === "block". */
  label: string;
}

export interface PinObservation {
  ref: ObservationRef;
  breaching: boolean;
  safeSide: boolean;
  nowMs: number;
}

export type OrchTriggerMetric =
  | "net_apy_floor" // economics.netApyOnDepositApy < floorApy
  | "capacity_shrink" // capacityUsd < abs floor OR < frac × trailing max
  | "funding_p25_streak" // fundingP25Apr < floor (class A only)
  | "gate_flip" // candidate.eligible === false at the pin
  | "basis_early_warn" // curBasisDev > frac × DEPEG_MAX_CUR (N1 only)
  | "better_elsewhere"; // best dest riskAdj − source riskAdj ≥ improvement floor

export interface OrchRule {
  ruleId: string;
  metric: OrchTriggerMetric;
  /** Metric-specific threshold. Units: APY fractions for apy/funding/improvement,
   *  USD for capacity abs, fraction for capacity_shrink.frac / basis frac. */
  threshold: number;
  /** capacity_shrink second leg: capacityUsd < shrinkFrac × max(capacity over
   *  lookbackPins). null = absolute-floor leg only. */
  shrinkFrac: number | null;
  lookbackPins: number; // trailing window for shrink reference (0 = unused)
  /** Streak: rule FIRES after `sustainPins` CONSECUTIVE breaching pins;
   *  any non-breaching pin resets the counter to 0 (the
   *  confirmForceCloseClear pattern — flaps re-arm, never fire). */
  sustainPins: number;
  /** Hysteresis: after firing, the rule re-arms only when the metric has been
   *  on the safe side of `rearmLevel` for `sustainPins` consecutive pins.
   *  rearmLevel must clear threshold by the R28 gap. */
  rearmLevel: number;
  cooldownMs: number; // per-rule, per-slot; floor R29
  /** Weight moved per firing, as fraction of orchestrated TVL. The realized
   *  USD move is clamped by R31/R33. */
  moveWeight: number;
  /**
   * `best_eligible` ranks live peers; `pause` is TERMINAL — the loop stops
   * taking capital and nothing moves. `pause` replaced `reserve_only`
   * (D11): the reserve it named never existed.
   */
  destination: "best_eligible" | "pause";
}

/** The terminal, non-slot destination. Never a weight, never a peer. */
export const PAUSE_DESTINATION = "pause";

export interface OrchestratorConfig {
  v: 1;
  loops: LoopSlot[];
  dials: OrchestratorDials;
  /** DERIVED from dials by deriveOrchRules(); users never author OrchRule
   *  objects directly (same philosophy as deriveHfBands/deriveHlMarginBands). */
  rules: OrchRule[];
  /** sha-256 of canonical serialization minus timestamps — the buildVenueDoc
   *  contentHash discipline. */
  rulesHash: string;
}

/** Live evaluation state, persisted per (ruleId, slotId) in KV. */
export interface OrchRuleState {
  streak: number; // consecutive breaching pins
  /** Dedupe and ordering, both. Seeded to -1 so a genuine seq 0 is legal. */
  lastSeq: number;
  /** A kind change is a RE-PIN, not an ordering violation: ordinals from two
   *  clocks are incomparable, so the state resets rather than comparing a NAV
   *  index to a block height. */
  lastKind: ObservationKind | null;
  firedAtMs: number | null;
  armed: boolean; // false between fire and re-arm
  /** Safe-side pin count toward re-arm while !armed. */
  rearmStreak: number;
  lastMoveDirection: string | null; // "slotA->slotB" for the R32/R30 anti-cycle edge
}

/** What a firing produces. In v1 this is DISPLAY + LOG ONLY (§3, R16–R20). */
export interface ReallocIntent {
  intentId: string; // content-hash of the body (RSV-3 B1 pattern)
  ruleId: string;
  sourceSlotId: string;
  destSlotId: string; // a peer slotId, or PAUSE_DESTINATION (terminal)
  moveUsd: number;
  /** RENAMED (spec B.2) from the block-keyed map this field used to be. A
   *  field named for a block number while carrying a NAV index is the
   *  fabrication `run-scan-hl-funding.ts` refused to commit, and it would put
   *  a block that does not exist into a signed artifact. */
  observedBySlot: Record<string, ObservationRef>;
  reason: string; // human decode line
  emergency: boolean; // R34 path
}

/** R5 emergency source states come from live watcher/registry state, not pins. */
export interface SlotLiveState {
  slotId: string;
  candidateId: string;
  eligible: boolean; // latest pin
  statusLive: boolean; // registry status ∈ {Live}
  emergency: boolean; // any R5 state (kill fired, cleanup pending, HF < floor, bitmap pause)
  /** R27: an armed-and-breaching (or fired-and-not-rearmed) evacuation rule of its own. */
  evacuationBreaching: boolean;
  riskAdjUnified: number | null; // R4
  capacityUsd: number | null;
  allocatedUsd: number;
  /** RENAMED from `pinnedBlock` for the same reason as `observedBySlot`. */
  observed: ObservationRef;
}

export interface OrchViolation {
  invariant:
    | "weights-sum" // R23
    | "no-flapping-sustain" // R25
    | "dest-not-killed" // R27 (evaluation-time; validator checks structure)
    | "hysteresis-floor" // R28
    | "cooldown-floor" // R29
    | "anti-cycle" // R30
    | "min-move" // R31
    | "per-tick-and-budget-caps" // R33
    | "emergency-path" // R34
    | "funding-orders-below-kill" // R8/R35
    | "class-coherence" // R36
    | "weight-conservation-per-move" // R37
    | "derived-only" // R38
    | "dial-range"; // R12/R13/R15 clamps
  detail: string;
}

// ── The settlement ledger, the budget, the exit, and the receipt ──────────
//
// These five shapes are declared here because every one of them is read by
// more than one package: the evaluator writes them, the compile decode and
// the plate render them. They carry no behaviour and no defaults.

/**
 * The one-shot and carried cost of leaving a source for a destination.
 *
 * REPLACES `moveFrictionFrac(sameChain)`, which answered a boolean about
 * chains and could not say how long the capital is out of the market.
 *
 * `windowCost` is the return the source would have earned during the wait,
 * `sourceApy * settleDays / 365`. `exitDiscountFrac` is DELIBERATELY ABSENT
 * from the arithmetic: nothing in the repo measures a secondary-market exit
 * discount, and a fabricated constant reaching a signed artifact is the
 * defect the register exists to refuse.
 */
export interface ExitProfile {
  /** Fraction of the capital moved, paid once, at the move. */
  oneShotFrac: number;
  /** How many of the DESTINATION's own observations the capital waits. Never
   *  milliseconds: the wait is denominated in the clock that ends it. */
  settleSeqs: number;
  /** Source APY foregone across the wait, as an APY-frame fraction. */
  windowCost: number;
}

/**
 * Weight that has been committed to a destination but has not yet arrived.
 *
 * THE NON-ATOMICITY ANSWER, and it is deliberately NOT a third bucket in the
 * Σ = 1 invariant. `applyMove` stays one expression and the destination's
 * `targetWeight` rises immediately, so R37 and R23 hold unchanged. What the
 * leg carries is the PRICE of the wait: unsettled weight earns zero in the
 * lane's rendered return until its receipt lands. The wait is priced, not
 * weighted.
 */
export interface SettlementLeg {
  legId: string;
  /** The decision that opened it. One decision opens at most one leg. */
  decisionId: string;
  sourceSlotId: string;
  destSlotId: string;
  /** Fraction of orchestrated TVL in flight on this leg. */
  weight: number;
  /** The observation the leg opened at, and the destination-clock count it
   *  waits before it may close. */
  openedAt: ObservationRef;
  settleSeqs: number;
  /** Null while open. The observation that closed it once settled. */
  settledAt: ObservationRef | null;
}

/**
 * The turnover accumulator. There is no such accumulator today, which is why
 * `turnoverBudgetPctWeek` is a dial that cannot refuse anything: 11 of its 19
 * stops collapse to the same move weight. The ceiling becomes the dial.
 *
 * A firing that would breach `realized + inFlight > ceiling` is REFUSED with
 * a stated reason, never silently sized down: a move that is quietly smaller
 * than the rule asked for is a second opinion about the rule.
 */
export interface OrchBudgetState {
  /** Rolling window length, in ticks. One tick-week. */
  windowTicks: number;
  /** Settled turnover inside the window, as a fraction of orchestrated TVL. */
  realized: number;
  /** Committed-but-unsettled turnover, same frame. */
  inFlight: number;
  /** `turnoverBudgetPctWeek / 100`. */
  ceiling: number;
}

/**
 * WHAT WAS DECIDED, AND FROM WHAT.
 *
 * Action plus POINTER, never evidence inline: the record carries the hash a
 * reader resolves, and it never advertises a reference that does not resolve
 * (the `writeContextPin` invariant). Nothing wall-clock enters `decisionId` —
 * it is reproducible from `(rulesHash, ruleId, source.hash, dest.hash)`, so
 * two observers of one decision mint one id.
 *
 * `alternative` is the runner-up the ranking actually rejected, which is what
 * makes the record DERIVED from the decision rather than reconstructed beside
 * it. `{ reason: "no legal peer" }` is the honest form when there was none.
 */
export interface AttestedDecision {
  decisionId: string;
  rulesHash: string;
  rule: {
    ruleId: string;
    metric: OrchTriggerMetric;
    threshold: number;
    sustainPins: number;
    streakAtFire: number;
    cooldownMs: number;
  };
  /** By slotId. Every slot the decision read, on its own clock. */
  observed: Record<string, ObservationRef>;
  scenarioRef: {
    hash: string;
    seed: number;
    /** WP-4 owns the regime union (`lib/canvas/scenario`). Widened to string
     *  here so this file carries no import into a package it does not own. */
    regime: string;
    tick: number;
  };
  moved: {
    sourceSlotId: string;
    /** A peer slotId, or PAUSE_DESTINATION. */
    destSlotId: string;
    weightBefore: number;
    weightAfter: number;
    moveUsd: number;
  };
  cost: {
    oneShotFrac: number;
    oneShotUsd: number;
    settleSeqs: number;
    windowCost: number;
    paybackDays: number;
  };
  alternative:
    | { slotId: string; riskAdjUnified: number; lostBy: number }
    | { reason: "no legal peer" };
  budget: { realized: number; inFlight: number; ceiling: number };
}

/** What actually arrived. `shortfall` is the difference the decision promised
 *  and the settlement did not deliver, and it is a measurement, not an alarm. */
export interface AttestedReceipt {
  decisionId: string;
  settledAtRef: ObservationRef;
  realizedWeight: number;
  realizedCostUsd: number;
  shortfall: number;
}
