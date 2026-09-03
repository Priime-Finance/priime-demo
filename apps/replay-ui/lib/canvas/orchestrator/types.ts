/**
 * Orchestrator data model (ORCHESTRATOR_SPEC §1, R1–R9).
 *
 * The orchestrator is a head node ABOVE the loop spines (rank −1) governing
 * N ≥ 2 loop sub-graphs plus the implicit reserve slot. A *pin* is one new
 * venue-doc generation for a loop's venue: block-pinned, content-hashed.
 * Rule state advances only on a pin with a NEW blockNumber; an identical
 * contentHash re-serve must not advance a streak (R24).
 */

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
  minWeight: number; // floor a rule may drain to (0 allowed)
  maxWeight: number; // ceiling a rule may fill to
}

type OrchTriggerMetric =
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
  destination: "best_eligible" | "reserve_only";
}
