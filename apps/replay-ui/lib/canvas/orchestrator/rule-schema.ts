/**
 * Orchestrator rule derivation + validation + evaluation (ORCHESTRATOR_SPEC
 * §2, §4). The BC-P3 one-derivation-one-validator contract: deriveOrchRules
 * is the ONLY producer of OrchRule[]; validateOrchestrator is the mirror of
 * validateBands (typed violations; any violation blocks render/compile).
 *
 * Every mechanism here transplants a rule that survived production:
 * streaks-with-reset from confirmForceCloseClear, hysteresis floors from the
 * SS-2/15pp band incidents, cooldown floors and the 2×-friction test from
 * the 2026-05-13 rebalance-bleed retune, the 0.25-per-tick clamp from the
 * W15 reserve system, emergency-does-one-bounded-thing from the defender.
 *
 * HONEST V1 LINE (§3): everything in this file is composition + modeled
 * preview. There is NO execution rail; intents are display + log only.
 */

import {
  clampOrchDials,
  ORCH_COOLDOWN_FLOOR_MS,
  ORCH_REACTIVITY_K,
  type OrchestratorDials,
} from "../param-schema";
import type { LoopSlot, OrchRule } from "./types";

// Standalone-kit fix: lib/strategy-factory/simulate(.ts|-v2.ts) and
// lib/v4/launch-config.ts are not part of this integration (same gap as the
// ECON_FLOOR_APY fix in lib/canvas/opportunities.ts — these are the strategy
// factory's grounding constants, pinned here to their known production
// values so the orchestrator's rule derivation still typechecks and runs).
const ECON_FLOOR_APY = 0.08;
const MIN_CAPACITY_USD = 100_000;
const DEPEG_MAX_CUR = 0.005;

// ── Grounding constants (all real, cited in the spec header) ──────────────

const ORCH_FUNDING_FLOOR_APR = -0.05;
/** R13: the 0.25 per-move cap mirrors the reserve rail's 0.25·E clamp. */
const MOVE_WEIGHT_CAP = 0.25;
const MOVE_WEIGHT_FLOOR = 0.05;
/** R13 sizing assumption: expected firings per week for the budget split. */
const EXPECTED_FIRINGS_PER_WEEK = 2;

const HOUR_MS = 60 * 60 * 1000;

// ── R7: the default derived rule set (per loop) ───────────────────────────

/** Base (k=1) cooldowns per rule family; scaled by k, floored at 6h (R15). */
const BASE_COOLDOWN_MS: Record<string, number> = {
  "apy-floor": 24 * HOUR_MS,
  capacity: 12 * HOUR_MS,
  funding: 24 * HOUR_MS,
  gate: 6 * HOUR_MS,
  "basis-warn": 12 * HOUR_MS,
  upgrade: 72 * HOUR_MS,
};

function sustain(base: number, k: number): number {
  return Math.max(2, Math.ceil(base * k)); // R15: sustainPins ≥ 2
}

function cooldown(ruleKey: string, k: number): number {
  return Math.max(ORCH_COOLDOWN_FLOOR_MS, Math.round((BASE_COOLDOWN_MS[ruleKey] ?? 24 * HOUR_MS) * k));
}

/** R13: per-firing moveWeight from the turnover budget, clamped to R15 range. */
function deriveMoveWeight(dials: OrchestratorDials): number {
  const w = Math.min(MOVE_WEIGHT_CAP, dials.turnoverBudgetPctWeek / 100 / EXPECTED_FIRINGS_PER_WEEK);
  return Math.max(MOVE_WEIGHT_FLOOR, Number(w.toFixed(6)));
}

/**
 * The R7 table for ONE slot. k = reactivity multiplier (R11). Rule ids are
 * `${slotId}:${family}` so state persists per (ruleId) == per (rule, slot).
 *
 * NOTE (documented deviation): R7 lists the `upgrade` rearmLevel as +0.015,
 * which violates R28's own ≥2pp floor against the +0.03 threshold. R28 is
 * the invariant; the default is set to +0.01 (gap exactly 2pp).
 */
function deriveOrchRules(dials: OrchestratorDials, slot: LoopSlot): OrchRule[] {
  const d = clampOrchDials(dials);
  const k = ORCH_REACTIVITY_K[d.reactivity];
  const moveWeight = deriveMoveWeight(d);
  const rules: OrchRule[] = [
    {
      ruleId: `${slot.slotId}:apy-floor`,
      metric: "net_apy_floor",
      threshold: ECON_FLOOR_APY, // 0.08
      shrinkFrac: null,
      lookbackPins: 0,
      sustainPins: sustain(6, k),
      rearmLevel: ECON_FLOOR_APY + 0.02, // 0.10 = floor + 2pp (≥ CARRY_P25_FLOOR gap)
      cooldownMs: cooldown("apy-floor", k),
      moveWeight,
      destination: "best_eligible",
    },
    {
      ruleId: `${slot.slotId}:capacity`,
      metric: "capacity_shrink",
      threshold: MIN_CAPACITY_USD, // 100_000 abs
      shrinkFrac: 0.5,
      lookbackPins: 13,
      sustainPins: sustain(3, k),
      rearmLevel: 1.15 * MIN_CAPACITY_USD, // 15% relative — the param-schema 15pp echo
      cooldownMs: cooldown("capacity", k),
      moveWeight,
      destination: "best_eligible",
    },
    {
      ruleId: `${slot.slotId}:gate`,
      metric: "gate_flip",
      threshold: 0,
      shrinkFrac: null,
      lookbackPins: 0,
      /** R9: 2 fixed, not 1 — every scanner gate fails closed on missing data;
       *  two consecutive failing pins at distinct blocks distinguishes a real
       *  flip from an RPC flap (FC_CLEAR_CONSECUTIVE_FLAT = 2 reasoning). */
      sustainPins: 2,
      rearmLevel: 0, // boolean metric: re-arm = sustainPins clean pins
      cooldownMs: cooldown("gate", k),
      moveWeight,
      destination: "reserve_only",
    },
    {
      ruleId: `${slot.slotId}:upgrade`,
      metric: "better_elsewhere",
      threshold: 0.03,
      shrinkFrac: null,
      lookbackPins: 0,
      sustainPins: sustain(13, k),
      rearmLevel: 0.01, // R28 floor: threshold − 2pp (see deviation note above)
      cooldownMs: cooldown("upgrade", k),
      moveWeight,
      destination: "best_eligible",
    },
  ];
  if (slot.cls === "A") {
    rules.push({
      ruleId: `${slot.slotId}:funding`,
      metric: "funding_p25_streak",
      threshold: ORCH_FUNDING_FLOOR_APR, // −0.05, strictly above the −10 APR kill band (R8)
      shrinkFrac: null,
      lookbackPins: 0,
      sustainPins: sustain(6, k),
      rearmLevel: 0.0,
      cooldownMs: cooldown("funding", k),
      moveWeight,
      destination: "best_eligible",
    });
  }
  if (slot.cls === "N1") {
    rules.push({
      ruleId: `${slot.slotId}:basis-warn`,
      metric: "basis_early_warn",
      threshold: 0.5 * DEPEG_MAX_CUR, // 0.0025
      shrinkFrac: null,
      lookbackPins: 0,
      sustainPins: sustain(3, k),
      rearmLevel: 0.4 * DEPEG_MAX_CUR, // 20% relative gap
      cooldownMs: cooldown("basis-warn", k),
      moveWeight,
      destination: "best_eligible",
    });
  }
  return rules.sort((a, b) => a.ruleId.localeCompare(b.ruleId));
}

/** All rules for all slots, deterministic order (R14: one pure derivation). */
export function deriveAllOrchRules(dials: OrchestratorDials, slots: LoopSlot[]): OrchRule[] {
  return [...slots]
    .sort((a, b) => a.slotId.localeCompare(b.slotId))
    .flatMap((s) => deriveOrchRules(dials, s));
}

// ── Decode lines (R40 register; review modal + rule takeover share these) ──

/** Compact policy rows for the rules matrix (founder feedback 2026-07-29:
 *  the sentence dump was wordy and per-loop duplication read as inaccurate —
 *  rules are ONE portfolio policy derived from the dials, identical for every
 *  loop; render them once). Shared tails (max move, one-scan-never-moves)
 *  belong in a single footer, not in every row. */
interface OrchRuleRow {
  metric: OrchRule["metric"];
  name: string;
  trigger: string;
  patience: string;
  cooldown: string;
}

const METRIC_NAME: Record<OrchRule["metric"], string> = {
  net_apy_floor: "YIELD DRIES",
  capacity_shrink: "CAPACITY SHRINKS",
  funding_p25_streak: "FUNDING TURNS",
  gate_flip: "GATE FAILS",
  basis_early_warn: "BASIS DRIFTS",
  better_elsewhere: "BETTER LOOP",
};

const METRIC_TRIGGER: Record<OrchRule["metric"], (r: OrchRule) => string> = {
  net_apy_floor: (r) =>
    `net APY below ${(r.threshold * 100).toFixed(0)}% (re-arms above ${(r.rearmLevel * 100).toFixed(0)}%)`,
  capacity_shrink: (r) =>
    `capacity under $${Math.round(r.threshold / 1000)}k or half its ${r.lookbackPins}-pin high`,
  funding_p25_streak: (r) => `funding p25 under ${(r.threshold * 100).toFixed(0)}% APR`,
  gate_flip: (_r) => `failing scans at distinct blocks: evacuates to reserve`,
  basis_early_warn: (r) => `basis deviation over ${(r.threshold * 100).toFixed(2)}%`,
  better_elsewhere: (r) =>
    `spread above ${(r.threshold * 100).toFixed(0)}% holds and beats 2x the move cost`,
};

/** One row per rule KIND from the first slot (every slot derives the same
 *  policy from the same dials — asserted cheap here). */
export function orchRuleTable(rules: OrchRule[]): { rows: OrchRuleRow[]; maxMovePct: number } {
  const firstSlot = rules.length > 0 ? rules[0]!.ruleId.split(":")[0] : "";
  const mine = rules.filter((r) => r.ruleId.split(":")[0] === firstSlot);
  const rows = mine.map((r) => ({
    metric: r.metric,
    name: METRIC_NAME[r.metric],
    trigger: METRIC_TRIGGER[r.metric](r),
    patience: `${r.sustainPins} scan${r.sustainPins === 1 ? "" : "s"}`,
    cooldown: `${(r.cooldownMs / HOUR_MS).toFixed(0)}h`,
  }));
  const maxMovePct = mine.length > 0 ? Math.max(...mine.map((r) => r.moveWeight)) * 100 : 0;
  return { rows, maxMovePct };
}

/** The R40 honesty line — verbatim register, shown wherever rules render. */
export const ORCH_HONESTY_LINE =
  "Reallocation is modeled only. Every move requires the execution rail and starts Shadow.";
