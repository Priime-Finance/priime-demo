/**
 * Orchestrator module surface (ARCHITECTURE_V2 §1c reshaped by
 * ORCHESTRATOR_SPEC R10: exactly three user-touchable dials, no rule
 * authoring). Descriptor-driven so the plate controls and server-side
 * clamps reuse the same ParamDescriptor machinery as module params.
 */

import type { LoopGraph, LoopId, OrchestratorConfig as GraphOrchestratorConfig, ParamDescriptor, ParamValue, PortfolioGraph } from "../types";
import { clampOrchDials, ORCH_DIAL_DEFAULTS, type OrchestratorDials } from "../param-schema";
import { marketKeyOf } from "../ids";
import type { LoopSlot } from "./types";

export * from "./types";
export { deriveAllOrchRules, ORCH_HONESTY_LINE, orchRuleTable } from "./rule-schema";

export const ORCHESTRATOR_DEF = {
  name: "Capital router",
  tagline: "Reallocates capital from a drying loop to a better one",
  description:
    "Watches every loop's modeled economics on the same block-pinned quotes the plates use and derives the full reallocation rule set from three dials. Moves are capped per firing, never touch a loop mid-emergency, and in this version are modeled only: no execution rail exists yet.",
  /** Default policy name shown on the plate badge. */
  policyName: "FOLLOW THE YIELD",
} as const;

/** The three dials (R10–R13), rendered through the standard Control idiom. */
export const ORCH_DIAL_DEFS: ParamDescriptor[] = [
  {
    field: "reactivity",
    friendlyLabel: "Reallocation tempo",
    type: "segmented",
    default: ORCH_DIAL_DEFAULTS.reactivity,
    options: [
      { value: "patient", label: "Patient", numeric: 1.5 },
      { value: "standard", label: "Standard", numeric: 1.0 },
      { value: "reactive", label: "Reactive", numeric: 0.6 },
    ],
    help: "One control, many parameters: tempo scales every rule's sustain window and cooldown. The system owns the optimization.",
  },
  {
    field: "maxConcentrationPct",
    friendlyLabel: "Max concentration",
    type: "slider",
    default: ORCH_DIAL_DEFAULTS.maxConcentrationPct,
    min: 35,
    max: 80,
    step: 5,
    unit: "%",
    help: "Ceiling any single loop may hold. 100% would make the orchestrator vacuous; below 35% over-fragments pilot-sized books.",
  },
  {
    field: "turnoverBudgetPctWeek",
    friendlyLabel: "Turnover budget",
    type: "slider",
    default: ORCH_DIAL_DEFAULTS.turnoverBudgetPctWeek,
    min: 10,
    max: 100,
    // step 5 so the default 25 sits ON the grid (recette P1-7): the label,
    // the slider, and the compile decode must always show the same number.
    step: 5,
    unit: "%/wk",
    help: "Weekly ceiling on total capital moved. Unwind and re-enter costs are real; slower is usually better.",
  },
];

export function defaultOrchestrator(): GraphOrchestratorConfig {
  const params: Record<string, ParamValue> = {};
  for (const p of ORCH_DIAL_DEFS) params[p.field] = p.default;
  return { enabled: false, params, allocationsBps: {} };
}

/** Graph params → typed dials, hard-clamped (client never trusted). */
export function dialsFromParams(params: Record<string, ParamValue>): OrchestratorDials {
  return clampOrchDials({
    reactivity: params.reactivity,
    maxConcentrationPct: params.maxConcentrationPct,
    turnoverBudgetPctWeek: params.turnoverBudgetPctWeek,
  });
}

/**
 * Largest-remainder normalization: keys forced to loopIds, Σ forced to
 * exactly 10000. New loops (no prior entry) enter at the even share of the
 * final split; existing loops keep their ratios among themselves inside the
 * remainder.
 */
export function normalizeAllocations(
  prev: Record<string, number>,
  loopIds: LoopId[],
): Record<LoopId, number> {
  if (loopIds.length === 0) return {};
  const even = 10000 / loopIds.length;
  const hasPrior = (id: LoopId) => typeof prev[id] === "number" && Number.isFinite(prev[id]) && prev[id] >= 0;
  const existing = loopIds.filter(hasPrior);
  const fresh = loopIds.filter((id) => !hasPrior(id));
  const priorTotal = existing.reduce((s, id) => s + prev[id]!, 0);
  const freshBudget = even * fresh.length;
  const existingBudget = 10000 - freshBudget;
  const scaled = loopIds.map((id) => {
    if (!hasPrior(id)) return even;
    return priorTotal > 0 ? (prev[id]! / priorTotal) * existingBudget : existingBudget / Math.max(1, existing.length);
  });
  const floors = scaled.map((x) => Math.floor(x));
  let remainder = 10000 - floors.reduce((s, x) => s + x, 0);
  // largest fractional parts get the leftover bps (ties: lower index first)
  const order = scaled
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => (b.frac !== a.frac ? b.frac - a.frac : a.i - b.i));
  const out: Record<LoopId, number> = {};
  for (const { i } of order) {
    out[loopIds[i]!] = floors[i]! + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
  }
  // preserve loopIds order in the object for stable serialization inputs
  const ordered: Record<LoopId, number> = {};
  for (const id of loopIds) ordered[id] = out[id]!;
  return ordered;
}

function sourceParams(loop: LoopGraph): Record<string, ParamValue> {
  return loop.nodes.find((n) => n.data.defKey === "liquidity-source")?.data.params ?? {};
}

/**
 * PortfolioGraph → LoopSlot[] for the derivation/validator (R1/R2 bridge).
 * minWeight 0 (a rule may fully drain a loop); maxWeight from dial 2 (R12).
 */
export function slotsFromPortfolio(p: PortfolioGraph): LoopSlot[] {
  const dials = dialsFromParams(p.orchestrator.params);
  const maxWeight = dials.maxConcentrationPct / 100;
  return p.loops.map((loop) => {
    const sp = sourceParams(loop);
    const candidateId = String(sp.candidateId ?? "");
    return {
      slotId: loop.id,
      venue: String(sp.venue ?? ""),
      candidateId,
      marketKey: marketKeyOf(candidateId),
      cls: sp.cls === "N1" ? "N1" : "A",
      targetWeight: (p.orchestrator.allocationsBps[loop.id] ?? 0) / 10000,
      minWeight: 0,
      maxWeight,
    };
  });
}
