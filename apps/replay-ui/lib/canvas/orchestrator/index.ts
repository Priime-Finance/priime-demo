/**
 * Orchestrator module surface (ARCHITECTURE_V2 §1c reshaped by
 * ORCHESTRATOR_SPEC R10: exactly three user-touchable dials, no rule
 * authoring). Descriptor-driven so the plate controls and server-side
 * clamps reuse the same ParamDescriptor machinery as module params.
 */

import { ECON_FLOOR_APY } from "@/lib/model-constants";
import type {
  LoopGraph,
  LoopId,
  ModuleKey,
  OrchestratorConfig as GraphOrchestratorConfig,
  ParamDescriptor,
  ParamValue,
  PortfolioGraph,
  ValidationIssue,
} from "../types";
import { clampOrchDials, ORCH_DIAL_DEFAULTS, type OrchestratorDials } from "../param-schema";
import { marketKeyOf } from "../ids";
/* `templates.ts` reaches this file back through `graph-ops.ts`. The cycle is
   inert by construction and by the same argument `graph-ops.ts` already
   records for its own edge into `templates`: neither side calls the other at
   module-evaluation time (this file's top level is object literals and
   function declarations, `templates`' is family models and row literals), so
   `fundingClassCandidateId` is only ever reached from inside
   `slotsFromPortfolio`.
   IT IS IMPORTED RATHER THAN RE-SPELLED because it is the shipped owner of
   "is this id a funding-class market" (templates.ts, the same predicate
   `laneStrategies` and `validateGraph` read). Re-typing its one-line prefix
   test here would put a second owner on a fact that already has one, and the
   two would drift the moment a scanner changes its id prefix — which is the
   drift the whole of WP-6 exists to close between the two slot builders. */
import { fundingClassCandidateId } from "../templates";
import {
  CONCENTRATION_MAX_PCT,
  CONCENTRATION_STEP_PCT,
  concentrationCeilingPct,
  concentrationFloorPct,
  clampConcentrationPct,
} from "./rule-schema";
import type { LoopSlot } from "./types";

export * from "./types";
export {
  advanceRuleState,
  applyMove,
  BASIS_DEV_ANNUALIZER,
  buildEmergencyIntent,
  buildIntent,
  buildOrchestratorConfig,
  canonicalRules,
  chainOfVenue,
  clampConcentrationPct,
  concentrationCeilingPct,
  concentrationFloorPct,
  CONCENTRATION_BASE_FLOOR_PCT,
  CONCENTRATION_MAX_PCT,
  CONCENTRATION_STEP_PCT,
  decodeOrchRule,
  deriveAllOrchRules,
  deriveMoveWeight,
  deriveOrchRules,
  edgeKey,
  edgeLocked,
  /* `moveFrictionFrac(sameChain)` was here until WP-1 split the two costs a
     move actually pays. The rail cost alone is `railExitProfile`, which is
     all `deriveOrchRules` may read; the priced move, rail plus settlement
     window, is `exitProfileFor(source, dest)`. Both are re-exported because
     the barrel is what every consumer outside this directory imports. */
  exitProfileFor,
  initialRuleState,
  lockReverseEdge,
  MAX_REVERSE_LOCK_MS,
  ORCH_HONESTY_LINE,
  orchRuleScopeLine,
  PAYBACK_HORIZON_DAYS,
  paybackMs,
  railExitProfile,
  riskAdjUnified,
  rulesHash,
  selectDestination,
  sizeMove,
  upgradeThreshold,
  UPGRADE_THRESHOLD_FLOOR,
  validateOrchestrator,
  orchRuleTable,
  type OrchRuleRow,
  type OrchRuleTable,
} from "./rule-schema";

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
    /* THE SUSTAIN CLAIM WAS FALSE ON THE ONE RULE THE DEMO ADVERTISES.
       `demo-rules.ts` fixes the router's `better_elsewhere` window at 48
       hours by founder ruling, so it does not move with the tempo; what the
       tempo still scales is the cooldown. The cell names `Patient |
       Standard | Reactive` are unchanged: that was ruled a founder call and
       this is a tempo claim, not a risk claim. */
    help: "One control: tempo scales every rule's cooldown. The 48 hour sustain on the router's own rule is fixed and does not move with it.",
  },
  {
    field: "maxConcentrationPct",
    friendlyLabel: "Max concentration",
    type: "slider",
    default: ORCH_DIAL_DEFAULTS.maxConcentrationPct,
    min: concentrationFloorPct(0),
    max: CONCENTRATION_MAX_PCT,
    step: CONCENTRATION_STEP_PCT,
    unit: "%",
    help: "Ceiling any single loop may hold. 100% would make the orchestrator vacuous; the floor is whichever is larger, 35% or the even split, because a ceiling under the even split is a rule no allocation can obey.",
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

/**
 * The dial descriptors AT A LANE COUNT (D4).
 *
 * `ORCH_DIAL_DEFS` is the static shape; this is the one every surface should
 * render, because the concentration floor is a function of how many lanes
 * exist. A slider whose minimum is infeasible is not a control, it is a
 * trap: at 2 lanes the old floor of 35 offered a ceiling below the 50/50
 * split the vault necessarily holds.
 *
 * Same array identity when nothing moves, so React sees no new props on a
 * re-render that changed nothing.
 */
export function orchDialDefs(laneCount: number): ParamDescriptor[] {
  const floor = concentrationFloorPct(laneCount);
  /* THE MAX MOVES WITH THE FLOOR. At one lane the feasible floor is 100 and a
     slider whose max stayed at 80 would render min above max — the same
     inverted band `concentrationFloorPct` now refuses, drawn instead of
     validated. `concentrationCeilingPct` is the one owner. */
  const ceiling = concentrationCeilingPct(laneCount);
  if (floor === ORCH_DIAL_DEFS[1].min && ceiling === ORCH_DIAL_DEFS[1].max) return ORCH_DIAL_DEFS;
  return ORCH_DIAL_DEFS.map((d) =>
    d.field === "maxConcentrationPct"
      ? {
          ...d,
          min: floor,
          max: ceiling,
          default: Math.min(ceiling, Math.max(floor, Number(d.default ?? floor))),
        }
      : d,
  );
}

/* `clampConcentrationPct` MOVED to `./rule-schema`, beside its own floor, and
   is re-exported by the barrel above. `buildOrchestratorConfig` lives there
   and has to clamp the dial it publishes at the lane count it publishes it
   for; the barrel is not importable from that file (initialization cycle), so
   a copy here would have been a second owner of the one number both slot
   builders, the validator and `LanePanel` all read. */

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
  const priorTotal = existing.reduce((s, id) => s + prev[id], 0);
  const freshBudget = even * fresh.length;
  const existingBudget = 10000 - freshBudget;
  const scaled = loopIds.map((id) => {
    if (!hasPrior(id)) return even;
    return priorTotal > 0 ? (prev[id] / priorTotal) * existingBudget : existingBudget / Math.max(1, existing.length);
  });
  const floors = scaled.map((x) => Math.floor(x));
  let remainder = 10000 - floors.reduce((s, x) => s + x, 0);
  // largest fractional parts get the leftover bps (ties: lower index first)
  const order = scaled
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => (b.frac !== a.frac ? b.frac - a.frac : a.i - b.i));
  const out: Record<LoopId, number> = {};
  for (const { i } of order) {
    out[loopIds[i]] = floors[i] + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
  }
  // preserve loopIds order in the object for stable serialization inputs
  const ordered: Record<LoopId, number> = {};
  for (const id of loopIds) ordered[id] = out[id];
  return ordered;
}

// ── D2: ONE definition of an active lane ─────────────────────────────────

/**
 * THE ACTIVE-LANE OWNER.
 *
 * Three aggregators held three answers to "which lanes count":
 *  · `vaultCapacity` filtered `allocationBps > 0`
 *  · `portfolioApy` iterated ALL lanes and nulled the hero on any missing
 *    quote, including a lane holding 0% of the book
 *  · `noCapLane` was weight-blind entirely
 * so a 0% lane was invisible to capacity, fatal to the headline APY, and
 * still published in the record. Three surfaces, three populations, one
 * vault.
 *
 * The rule, stated once: a lane is ACTIVE when it holds a positive share of
 * the book. A single-lane portfolio IS the portfolio, so its one lane is
 * active at 100% whatever the allocation map says — that degenerate branch
 * was already written twice (`portfolioApy` and `vaultCapacity` each had
 * their own copy) and it lives here now.
 *
 * Weights are returned alongside, normalized over the ACTIVE lanes only, so
 * a caller cannot re-divide by a different total than the filter used.
 */
export interface ActiveLane<T> {
  lane: T;
  loopId: LoopId;
  allocationBps: number;
  /** Share of the ACTIVE book. Σ over the returned lanes is exactly 1. */
  weight: number;
}

export function activeLanes<T>(
  lanes: readonly T[],
  allocationsBps: Record<string, number>,
  loopIdOf: (lane: T) => LoopId,
): ActiveLane<T>[] {
  if (lanes.length === 0) return [];
  const bpsOf = (lane: T) =>
    lanes.length === 1 ? 10000 : (allocationsBps[loopIdOf(lane)] ?? 0);
  const kept = lanes.filter((l) => {
    const bps = bpsOf(l);
    return Number.isFinite(bps) && bps > 0;
  });
  const total = kept.reduce((s, l) => s + bpsOf(l), 0);
  if (!(total > 0)) return [];
  return kept.map((lane) => ({
    lane,
    loopId: loopIdOf(lane),
    allocationBps: bpsOf(lane),
    weight: bpsOf(lane) / total,
  }));
}

/**
 * The allocation-weighted blend over the ACTIVE lanes.
 *
 * NULL DISCIPLINE, unchanged and now correctly scoped: a partial blend is a
 * lie, so any active lane without a quote nulls the hero. A lane at 0% is
 * not active and therefore cannot null anything — which is the whole point.
 */
export function portfolioApyOf<T>(
  active: readonly ActiveLane<T>[],
  netApyOf: (lane: T) => number | null | undefined,
): number | null {
  if (active.length === 0) return null;
  let acc = 0;
  for (const a of active) {
    const apy = netApyOf(a.lane);
    if (typeof apy !== "number" || !Number.isFinite(apy)) return null;
    acc += a.weight * apy;
  }
  return acc;
}

/**
 * D10 — THE PRINTED SHARES, COMPUTED ONCE.
 *
 * Four call sites each did `Math.round(bps / 100)` on their own lane, so
 * three lanes printed 33 + 33 + 33 = 99% and six printed 101%, while the
 * bars beside them summed correctly because they used the unrounded width.
 * Rounding is not distributive over a sum, so the only fix is to round the
 * WHOLE VECTOR at once: largest remainder, exactly as `normalizeAllocations`
 * already does in bps.
 *
 * Returns integers summing to exactly 100 whenever the input sums to 10000.
 */
export function allocationPercents(
  loopIds: readonly LoopId[],
  allocationsBps: Record<string, number>,
): Record<LoopId, number> {
  if (loopIds.length === 0) return {};
  const raw = loopIds.map((id) => {
    const bps = allocationsBps[id];
    return Number.isFinite(bps) && bps > 0 ? bps / 100 : 0;
  });
  const total = raw.reduce((s, x) => s + x, 0);
  const out: Record<LoopId, number> = {};
  if (!(total > 0)) {
    for (const id of loopIds) out[id] = 0;
    return out;
  }
  // Rescale to 100 so a map that does not sum to 10000 still prints a
  // coherent set rather than a set that silently misses the total.
  const scaled = raw.map((x) => (x / total) * 100);
  const floors = scaled.map((x) => Math.floor(x));
  let remainder = 100 - floors.reduce((s, x) => s + x, 0);
  const order = scaled
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => (b.frac !== a.frac ? b.frac - a.frac : a.i - b.i));
  const pcts = [...floors];
  for (const { i } of order) {
    if (remainder <= 0) break;
    pcts[i] += 1;
    remainder -= 1;
  }
  loopIds.forEach((id, i) => {
    out[id] = pcts[i];
  });
  return out;
}

/**
 * D1 — WHAT AN ALLOCATION FIELD SHOULD DO ON BLUR, as a pure decision.
 *
 * `null` means BAIL: leave the field and the vault exactly as they are.
 * A number is the bps to commit.
 *
 * It lives here, not in the input component, for one reason: the node test
 * environment cannot mount a React input, and a rule that can only be
 * verified by hand is a rule that regresses. The component is now a thin
 * shell over this function, so the behaviour is testable at the same place
 * it is defined.
 *
 * THE LOAD-BEARING COMPARISON is `typed === rendered`, both strings. The old
 * code compared `round(typed) * 100` against the underlying bps, and `pct`
 * is not injective on bps: at {3333, 3333, 3334} every field renders `33`,
 * parses to 3300, and 3300 ≠ 3333 fired a rewrite on a field nobody edited.
 * Round-tripping through the display is the only test that answers the
 * question actually being asked, which is "did the user change this".
 */
export function allocCommitBps(typed: string, rendered: string): number | null {
  const t = typed.trim();
  if (t === rendered) return null; // untouched, or retyped identically
  const v = Number(t);
  if (t === "" || !Number.isFinite(v)) return null; // unparseable: restore, commit nothing
  const rounded = Math.min(100, Math.max(0, Math.round(v)));
  if (String(rounded) === rendered) return null; // `33.4` on a field showing `33`
  return rounded * 100;
}

// ── D9: the plate's honest signals ───────────────────────────────────────

/**
 * What the orchestrator plate renders per lane. `drying` and `noQuote` were
 * hard-coded `false` at the one call site, so the plate's two honest
 * sub-lines were unreachable and its badge was permanently green — including
 * mid-reprice and on a lane with no market at all.
 */
export interface LaneSignal {
  loopId: string;
  label: string;
  allocationBps: number;
  /**
   * Share of the book, as a printed integer. Sums to 100 across lanes.
   *
   * OPTIONAL ONLY UNTIL THE CALL SITE MOVES. `deriveLaneSignals` always sets
   * both this and `quoting`; the optionality exists so `RackCanvas`'s
   * hand-built literal keeps compiling while it is owned by another wave.
   * When that literal is replaced by `deriveLaneSignals`, both fields become
   * required and the fallbacks below can go.
   */
  allocationPct?: number;
  /** amber DRYING: the gate fails, or the modeled APY sits under the floor. */
  drying: boolean;
  /** The lane has a market but no quote to show for it. */
  noQuote: boolean;
  /** A quote is in flight. Not a failure and not a state to colour green. */
  quoting?: boolean;
}

export interface LaneSignalInput {
  loopId: string;
  label: string;
  /** `candidate.eligible` at the latest pin; null when unknown. */
  eligible?: boolean | null;
  /** The lane's DISPLAY apy (already gated), null when it has none. */
  netApy: number | null;
  /** Whether the lane is pinned to a market at all. */
  hasMarket: boolean;
  /** A reprice is in flight for this lane. */
  repricing?: boolean;
}

/**
 * Derive the plate signals from the lane facts. Pure, so the plate cannot
 * invent a state and the canvas cannot forget to pass one.
 *
 * `quoting` OUTRANKS `noQuote`: a lane mid-reprice has no quote yet, and
 * calling that a gap would flash a warning on every dial move. It does NOT
 * outrank `drying` — a lane whose gate has already failed is still failing
 * while the next quote loads.
 */
export function deriveLaneSignals(
  inputs: readonly LaneSignalInput[],
  allocationsBps: Record<string, number>,
): LaneSignal[] {
  const pcts = allocationPercents(
    inputs.map((i) => i.loopId),
    inputs.length === 1
      ? { [inputs[0].loopId]: 10000 }
      : allocationsBps,
  );
  return inputs.map((i) => {
    const quoting = i.repricing === true;
    const drying =
      i.hasMarket &&
      (i.eligible === false ||
        (typeof i.netApy === "number" && i.netApy < ECON_FLOOR_APY));
    return {
      loopId: i.loopId,
      label: i.label,
      allocationBps:
        inputs.length === 1 ? 10000 : (allocationsBps[i.loopId] ?? 0),
      allocationPct: pcts[i.loopId] ?? 0,
      drying,
      noQuote: i.hasMarket && !quoting && i.netApy === null,
      quoting,
    };
  });
}

// ── D3/D6: the portfolio invariants the Review gate never checked ─────────

/**
 * The two portfolio-level issues `validatePortfolio` never raised.
 *
 * D3 — THE CONCENTRATION CAP WAS PRINTED AND NEVER ENFORCED. `setAllocation`
 * clamped to [0, 10000]; `validatePortfolio` checked keys and sum. The one
 * place that does encode the invariant, `validateOrchestrator`, sat behind a
 * modal imported by nothing. So a 95/5 vault published under a rule table
 * that said "max concentration 60%" — the product stating a policy it had no
 * mechanism to keep.
 *
 * D6 — MIXED FAMILIES PUBLISHED AS ONE MACHINE. There was no cross-lane
 * family check anywhere, and `publishDraft` collapsed everything to
 * `family = "loop"` and unioned `Auto center` with `Dynamic leverage` into a
 * single module list. Two different machines, one record, no signal.
 *
 * Both are returned as TYPED `ValidationIssue`s carrying their own message,
 * so the Review key can disarm with the actual reason instead of a generic
 * "not ready". Codes are the existing ones: `orch-rule-param` is defined as
 * an orchestrator dial/derived-rule invariant violation, and `family-mismatch`
 * is a family that does not belong with the others.
 */
export function portfolioAllocationIssues(
  p: PortfolioGraph,
  familyOf: (loop: LoopGraph) => string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const loopIds = p.loops.map((l) => l.id);
  if (loopIds.length === 0) return issues;

  // D3 — targetWeight ≤ maxWeight, per lane.
  const dials = dialsFromParams(p.orchestrator.params);
  const maxPct = clampConcentrationPct(dials.maxConcentrationPct, loopIds.length);
  const pcts = allocationPercents(loopIds, p.orchestrator.allocationsBps);
  if (p.orchestrator.enabled) {
    for (const loop of p.loops) {
      const share = pcts[loop.id] ?? 0;
      if (share > maxPct) {
        issues.push({
          code: "orch-rule-param",
          loopId: loop.id,
          message: `${loop.label} holds ${share}% of the book, over the ${maxPct}% max concentration`,
        });
      }
    }
  }

  // D6 — one portfolio, one machine.
  const families = new Map<string, LoopId[]>();
  for (const loop of p.loops) {
    const f = familyOf(loop);
    families.set(f, [...(families.get(f) ?? []), loop.id]);
  }
  if (families.size > 1) {
    const names = [...families.keys()].sort();
    issues.push({
      code: "family-mismatch",
      message: `This vault mixes ${names.join(" and ")} lanes; one vault publishes one machine`,
    });
  }
  return issues;
}

/** The params a lane's seated module carries, or `null` when it is not
 *  seated. `undefined` params and an absent module are DIFFERENT questions
 *  (defect X1), so the absence is returned rather than flattened to `{}`. */
function moduleParams(loop: LoopGraph, key: ModuleKey): Record<string, ParamValue> | null {
  return loop.nodes.find((n) => n.data.defKey === key)?.data.params ?? null;
}

function sourceParams(loop: LoopGraph): Record<string, ParamValue> {
  return moduleParams(loop, "liquidity-source") ?? {};
}

/** A stored param read as a number, or null when it states none. A boolean
 *  and an empty string are not numbers, so `Number()` is never asked. */
function statedNumber(v: ParamValue | undefined): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * THE CATALOG SCREEN THIS LANE WAS ADMITTED THROUGH (spec B.4), or null.
 *
 * `ECON_FLOOR_APY` is a LEVERED-LOOP scan gate (the scanner's `simulate.ts`):
 * the scanner applies it while ranking loops that borrow. A lane at L = 1
 * never passed through it, so there is no screen for it to fall below, and
 * emitting `apy-floor` against one makes it permanently breaching — all 24
 * funding fixture rows sit under the floor, top row 0.076961, none eligible.
 * Exempting only the unlevered side is what makes the exemption symmetric.
 *
 * DERIVED FROM THE GRAPH AND NOTHING ELSE, because `deriveOrchRules(dials,
 * slot, peers)` is re-derived byte-for-byte by R38 and may read nothing
 * outside its three arguments. The fact that GATES a rule therefore has to
 * sit ON the slot, which is what this function puts there.
 *
 * NO `safety-buffer` MEANS NO LEVERAGE, the ruling `pricingParamsFor` already
 * carries: an absent leverage module is the unlevered machine (supply the
 * collateral, borrow nothing), not a lane missing a dial. A seated module
 * that states no leverage is read the same way, which is the literal spec
 * sentence and the one reading that needs no second opinion about a default
 * `descriptorsFor` owns. Every seat the canvas can make writes the field
 * (`addModule` -> `defaultParams`), so the two readings only ever differ on a
 * hand-built graph.
 */
function screenedAtApyOf(loop: LoopGraph): number | null {
  const buffer = moduleParams(loop, "safety-buffer");
  if (!buffer) return null;
  const leverage = statedNumber(buffer.targetLeverage);
  return leverage !== null && leverage > 1 ? ECON_FLOOR_APY : null;
}

/**
 * WHICH SCANNER METRICS THIS LANE'S SOURCE ACTUALLY PRODUCES (spec B.4).
 *
 * A rule that reads a quantity its lane cannot produce is not a guard, it is
 * a promise. R36 asks this question; it used to ask `cls`, which answers a
 * different one — `cls N1` was handed `basis_early_warn` on `curBasisDev`,
 * a field that is on no client row.
 *
 * `basis` IS A READ, NOT A CONSTANT, and today it reads false everywhere:
 * `ProjectedCandidate` carries neither `curBasisDev` nor `maxBasisDev90d`,
 * and no `liquidity-source` descriptor writes either onto the graph, so no
 * lane the product can compose publishes a basis deviation. That is the
 * finding, and the correct consequence is that `basis_early_warn` disappears
 * rather than being emitted against nothing. Leaving it a read means the rule
 * returns by itself the day a scanner writes the field.
 */
function metricsOf(sp: Record<string, ParamValue>, candidateId: string): LoopSlot["metrics"] {
  return {
    funding: fundingClassCandidateId(candidateId),
    basis: statedNumber(sp.curBasisDev) !== null,
  };
}

/**
 * THE FLOOR A RULE MAY DRAIN A LANE TO (spec B.5), derived from the dials and
 * the lane count and from nothing else.
 *
 * It was the literal `0` at both builders, so a lane sold as a floor had no
 * floor and the upgrade rule could drain it to zero while the record printed
 * `0 to 60%`. It is not a fourth dial and it cannot collide with the user's
 * allocation control, because it RESTATES a constraint `validateOrchestrator`
 * already enforces: `sum(target) = 1` and `target_j <= max` for all j give
 * `target_i = 1 - sum_{j != i} target_j >= 1 - (N - 1) * max`. So it can
 * never create a violation a feasible allocation did not already have. At two
 * lanes with the dial at its 80% ceiling it is 20%; at three lanes it is 0,
 * honestly.
 */
function derivedMinWeight(slotCount: number, maxWeight: number): number {
  return Math.max(0, 1 - (slotCount - 1) * maxWeight);
}

/**
 * PortfolioGraph → LoopSlot[] for the derivation/validator (R1/R2 bridge).
 * maxWeight from dial 2 (R12); minWeight DERIVED per B.5, see
 * `derivedMinWeight`.
 *
 * THE OTHER BUILDER IS `compilePortfolio` AND THE TWO MUST AGREE. It builds
 * the same `LoopSlot[]` from a submitted compile body rather than from the
 * graph, and a slot the router evaluates on screen must be the slot the
 * published record was compiled from. The four fields that used to be a
 * second opinion here are `screenedAtApy`, `metrics.funding`, `metrics.basis`
 * and `minWeight`; each is now a derivation with a single stated rule, and
 * the body-side reading of each is the same rule over the same fact:
 *   screenedAtApy   this lane's applied leverage above 1 (body.targetLeverage,
 *                   which `pricingParamsFor` derives from this same seated
 *                   `safety-buffer`)
 *   metrics.funding fundingClassCandidateId(candidateId), one owner
 *   metrics.basis   the pinned row's own basis deviation, absent on both
 *                   sides today
 *   minWeight       max(0, 1 - (N - 1) * maxWeight) at the same N and the
 *                   same CLAMPED ceiling
 *
 * MARKETLESS LANES ARE NOT SLOTS (D9). An empty lane carries no
 * `candidateId`, so `cls` fell through the `=== "N1"` test to the class-A
 * default and the derivation dutifully produced a funding-streak rule for a
 * lane with no perp, no venue and no pin to evaluate it against. The rule
 * table then printed a funding guard the vault does not have. A lane with no
 * market is a lane the orchestrator does not govern yet; it re-enters the
 * moment it is pinned.
 *
 * The concentration ceiling is taken at the SLOT count, not the lane count,
 * for the same reason: it is the governed population that has to satisfy it.
 */
export function slotsFromPortfolio(p: PortfolioGraph): LoopSlot[] {
  const dials = dialsFromParams(p.orchestrator.params);
  const pinned = p.loops
    .map((loop) => ({ loop, sp: sourceParams(loop) }))
    .filter(({ sp }) => String(sp.candidateId ?? "") !== "");
  const maxWeight = clampConcentrationPct(dials.maxConcentrationPct, pinned.length) / 100;
  const minWeight = derivedMinWeight(pinned.length, maxWeight);
  return pinned.map(({ loop, sp }) => {
    const candidateId = String(sp.candidateId ?? "");
    return {
      slotId: loop.id,
      venue: String(sp.venue ?? ""),
      candidateId,
      marketKey: marketKeyOf(candidateId),
      cls: sp.cls === "N1" ? "N1" : "A",
      targetWeight: (p.orchestrator.allocationsBps[loop.id] ?? 0) / 10000,
      minWeight,
      maxWeight,
      screenedAtApy: screenedAtApyOf(loop),
      metrics: metricsOf(sp, candidateId),
    };
  });
}
