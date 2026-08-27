/**
 * Pure graph operations (BC-P1, portfolio-level since v2). No store, no
 * React: every mutation returns a new PortfolioGraph, edges are always
 * re-derived from the node set, and params are clamped at the boundary.
 *
 * Spine wiring rule (single source of truth, also enforced by validateGraph):
 *   source → safety-buffer
 *   safety-buffer → hedge            (when hedge present)
 *   (hedge if present, else safety-buffer) → auto-compound
 *
 * v2 (ARCHITECTURE_V2 §2/§3): loops are lanes; node ids are namespaced
 * `${loopId}/${key}` (ids.ts); the orchestrator is a singleton head node
 * whose alloc edges are DERIVED, never stored. The orchestrator
 * auto-installs at the second loop and auto-uninstalls below two (UX_SPEC
 * §4: the user never chooses to add it).
 */

import type {
  LoopGraph,
  LoopId,
  ModuleEdge,
  ModuleKey,
  ModuleNode,
  ParamDescriptor,
  ParamValue,
  PortfolioGraph,
  PortfolioValidationResult,
  StrategyGraph,
  ValidationIssue,
  ValidationResult,
} from "./types";
import { getDef, MODULE_DEFS } from "./modules";
import { newLoopId, nodeId } from "./ids";
import { defaultOrchestrator, normalizeAllocations, ORCH_DIAL_DEFS } from "./orchestrator";

// ── Layout constants (§3). Positions are presentational (hash-excluded);
//    the rack renderer lays out with CSS, these keep drafts deterministic. ──

const LANE_X0 = 340; // loop rank-0 column start
const COL_X = 340; // column pitch
const LANE_TOP = 40; // IT4C: dead zone above lane 1 tightened (was 80)
const LANE_H = 230; // node ~150px tall + gutter

function positionFor(laneIndex: number, key: ModuleKey) {
  return { x: LANE_X0 + getDef(key).rank * COL_X, y: LANE_TOP + laneIndex * LANE_H };
}

// ── Per-loop internals (v1 bodies, verbatim) ──────────────────────────────

export function nodeFor(loop: Pick<LoopGraph, "nodes">, key: ModuleKey): ModuleNode | undefined {
  return loop.nodes.find((n) => n.data.defKey === key);
}

function defaultParams(key: ModuleKey): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const p of getDef(key).params) out[p.field] = p.default;
  return out;
}

// ── The lane chain ────────────────────────────────────────────────────────
//
// One lane shape survives the strip: the loop spine. The dn-lp and collar
// families went with the templates that were their only entry point.

/** The spine, in chain order. */
export const LANE_CHAIN: ModuleKey[] = [
  "liquidity-source",
  "safety-buffer",
  "hedge",
  "auto-compound",
];

/** Modules a lane must place before it is launch-shaped. */
const LANE_REQUIRED: ModuleKey[] = ["liquidity-source", "safety-buffer"];

export function deriveEdges(nodes: ModuleNode[]): ModuleEdge[] {
  const byKey = new Map(nodes.map((n) => [n.data.defKey, n]));
  const edges: ModuleEdge[] = [];
  const wire = (a: ModuleNode, b: ModuleNode) =>
    edges.push({ id: `e:${a.id}->${b.id}`, source: a.id, target: b.id, data: { kind: "flow" } });
  const src = byKey.get("liquidity-source");
  const hf = byKey.get("safety-buffer");
  const hedge = byKey.get("hedge");
  const compound = byKey.get("auto-compound");
  if (src && hf) wire(src, hf);
  if (hf && hedge) wire(hf, hedge);
  if (compound) {
    const feeder = hedge ?? hf;
    if (feeder) wire(feeder, compound);
  }
  return edges;
}

function clampNumeric(desc: ParamDescriptor, value: number): number {
  let v = value;
  if (typeof desc.min === "number") v = Math.max(desc.min, v);
  if (typeof desc.max === "number") v = Math.min(desc.max, v);
  if (typeof desc.step === "number" && desc.step > 0 && typeof desc.min === "number") {
    v = desc.min + Math.round((v - desc.min) / desc.step) * desc.step;
    // re-clamp after snapping, then kill float dust from the multiply
    if (typeof desc.max === "number") v = Math.min(desc.max, v);
    v = Number(v.toFixed(6));
  }
  return v;
}

/** Clamp one value against a descriptor list; returns null when rejected. */
function clampAgainst(descs: ParamDescriptor[], field: string, value: ParamValue): ParamValue | null {
  const desc = descs.find((p) => p.field === field);
  if (!desc) return null;
  if (desc.type === "slider" || desc.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    return clampNumeric(desc, value);
  }
  if (desc.type === "segmented" || desc.type === "select") {
    if (typeof value !== "string") return null;
    const allowed = desc.options?.some((o) => o.value === value);
    // empty options list (the market catalog fills it) accepts any string
    if (desc.options && desc.options.length > 0 && !allowed) return null;
    return value;
  }
  if (desc.type === "toggle") {
    return typeof value === "boolean" ? value : null;
  }
  return value;
}

// ── Per-loop validation (v1 body, verbatim, on a LoopGraph shape) ─────────

export function validateGraph(graph: Pick<StrategyGraph, "nodes" | "edges">): ValidationResult {
  const issues: ValidationIssue[] = [];
  const seen = new Set<ModuleKey>();

  for (const n of graph.nodes) {
    const def = MODULE_DEFS[n.data.defKey];
    if (!def) {
      issues.push({ code: "unknown-module", message: `Unknown module ${n.data.defKey}`, nodeId: n.id });
      continue;
    }
    if (seen.has(def.key)) {
      issues.push({ code: "duplicate-module", message: `${def.name} placed twice`, nodeId: n.id });
    }
    seen.add(def.key);

    for (const [field, value] of Object.entries(n.data.params)) {
      const desc = def.params.find((p) => p.field === field);
      if (!desc) {
        issues.push({ code: "unknown-param", message: `${def.name}: unknown param ${field}`, nodeId: n.id });
        continue;
      }
      if ((desc.type === "slider" || desc.type === "number") && typeof value === "number") {
        if ((typeof desc.min === "number" && value < desc.min) || (typeof desc.max === "number" && value > desc.max)) {
          issues.push({
            code: "param-out-of-bounds",
            message: `${def.name}: ${desc.friendlyLabel} ${value} outside [${desc.min}, ${desc.max}]`,
            nodeId: n.id,
          });
        }
      }
    }
  }

  if (!seen.has("liquidity-source") && [...seen].some((k) => k !== "liquidity-source")) {
    issues.push({ code: "missing-source", message: "Every strategy starts from a liquidity source" });
  }
  if (seen.has("hedge") && !seen.has("safety-buffer")) {
    issues.push({ code: "hedge-requires-safety-buffer", message: "Hedging needs dynamic leverage in place first" });
  }
  if (seen.has("auto-compound") && !seen.has("safety-buffer")) {
    issues.push({ code: "compound-requires-safety-buffer", message: "Auto-compound needs dynamic leverage in place first" });
  }

  // class coherence: the hedge is OPTIONAL everywhere (founder ruling
  // 2026-08-20 — a new lane composes without it; the user adds it from the
  // dock when they want it). Only the impossible direction stays an issue:
  // a market with no perp to hedge with cannot carry a hedge module.
  const srcNode = graph.nodes.find((n) => n.data.defKey === "liquidity-source");
  const cls = String(srcNode?.data.params.cls ?? "");
  if (cls === "N1" && seen.has("hedge")) {
    issues.push({
      code: "unhedged-class-forbids-hedge",
      message: "This market has no perp to hedge with: eject the hedge module",
    });
  }

  const canonical = deriveEdges(graph.nodes);
  const got = new Set(graph.edges.map((e) => e.id));
  if (canonical.length !== graph.edges.length || canonical.some((e) => !got.has(e.id))) {
    issues.push({ code: "edges-not-canonical", message: "Wiring does not match the spine" });
  }

  const missing = LANE_REQUIRED.filter((k) => !seen.has(k));
  return { ok: issues.length === 0 && missing.length === 0, issues, missing };
}

// ── Portfolio-level API (v2) ──────────────────────────────────────────────

export function emptyPortfolio(): PortfolioGraph {
  return { v: 2, loops: [], orchestrator: defaultOrchestrator() };
}

export function loopById(p: PortfolioGraph, loopId: LoopId): LoopGraph | undefined {
  return p.loops.find((l) => l.id === loopId);
}

/** Re-stamp lane positions on every loop's nodes (hash-excluded, free). */
function restampPositions(loops: LoopGraph[]): LoopGraph[] {
  return loops.map((loop, laneIndex) => ({
    ...loop,
    nodes: loop.nodes.map((n) => ({ ...n, position: positionFor(laneIndex, n.data.defKey) })),
  }));
}

/** Orchestrator auto-install rule (UX_SPEC §4): system-placed at lane 2. */
function withOrchestratorRule(p: PortfolioGraph): PortfolioGraph {
  const enabled = p.loops.length >= 2;
  const allocationsBps = normalizeAllocations(p.orchestrator.allocationsBps, p.loops.map((l) => l.id));
  return { ...p, orchestrator: { ...p.orchestrator, enabled, allocationsBps } };
}

export function addLoop(p: PortfolioGraph): PortfolioGraph {
  const id = newLoopId(p.loops.map((l) => l.id));
  const n = id.replace("loop_", "");
  const loops = restampPositions([...p.loops, { id, label: `Loop ${n}`, nodes: [], edges: [] }]);
  return withOrchestratorRule({ ...p, loops });
}

export function removeLoop(p: PortfolioGraph, loopId: LoopId): PortfolioGraph {
  const loops = restampPositions(p.loops.filter((l) => l.id !== loopId));
  const allocations = { ...p.orchestrator.allocationsBps };
  delete allocations[loopId];
  return withOrchestratorRule({ ...p, loops, orchestrator: { ...p.orchestrator, allocationsBps: allocations } });
}

export function renameLoop(p: PortfolioGraph, loopId: LoopId, label: string): PortfolioGraph {
  const loops = p.loops.map((l) => (l.id === loopId ? { ...l, label: label.slice(0, 48) } : l));
  return { ...p, loops };
}

function mapLoop(p: PortfolioGraph, loopId: LoopId, f: (loop: LoopGraph, laneIndex: number) => LoopGraph): PortfolioGraph {
  const i = p.loops.findIndex((l) => l.id === loopId);
  if (i < 0) return p;
  const next = f(p.loops[i]!, i);
  if (next === p.loops[i]) return p; // rejected mutation: keep referential identity
  const loops = [...p.loops];
  loops[i] = next;
  return { ...p, loops };
}

/** Add a module to a loop (one instance per kind per loop). */
export function addModule(p: PortfolioGraph, loopId: LoopId, key: ModuleKey): PortfolioGraph {
  return mapLoop(p, loopId, (loop, laneIndex) => {
    if (nodeFor(loop, key)) return loop;
    const node: ModuleNode = {
      id: nodeId(loopId, key),
      type: "priimeModule",
      position: positionFor(laneIndex, key),
      data: { defKey: key, params: defaultParams(key) },
    };
    const nodes = [...loop.nodes, node];
    return { ...loop, nodes, edges: deriveEdges(nodes) };
  });
}

export function removeModule(p: PortfolioGraph, loopId: LoopId, key: ModuleKey): PortfolioGraph {
  return mapLoop(p, loopId, (loop) => {
    const nodes = loop.nodes.filter((n) => n.data.defKey !== key);
    return { ...loop, nodes, edges: deriveEdges(nodes) };
  });
}

/**
 * Set a module param, clamped/snapped to its descriptor. Unknown fields and
 * options-violating values are rejected by returning the graph unchanged.
 */
export function updateParam(
  p: PortfolioGraph,
  loopId: LoopId,
  key: ModuleKey,
  field: string,
  value: ParamValue,
): PortfolioGraph {
  return mapLoop(p, loopId, (loop) => {
    const node = nodeFor(loop, key);
    if (!node) return loop;
    const next = clampAgainst(getDef(key).params, field, value);
    if (next === null) return loop;
    const nodes = loop.nodes.map((n) =>
      n.id === node.id ? { ...n, data: { ...n.data, params: { ...n.data.params, [field]: next } } } : n,
    );
    return { ...loop, nodes };
  });
}

// ── Orchestrator ops ──────────────────────────────────────────────────────

/** Dial update, clamped via ORCH_DIAL_DEFS (same idiom as module params). */
export function updateOrchestratorParam(p: PortfolioGraph, field: string, value: ParamValue): PortfolioGraph {
  const next = clampAgainst(ORCH_DIAL_DEFS, field, value);
  if (next === null) return p;
  return { ...p, orchestrator: { ...p.orchestrator, params: { ...p.orchestrator.params, [field]: next } } };
}

/** Set one loop's allocation; largest-remainder rebalances the others to Σ=10000. */
export function setAllocation(p: PortfolioGraph, loopId: LoopId, bps: number): PortfolioGraph {
  if (!loopById(p, loopId) || !Number.isFinite(bps)) return p;
  const clamped = Math.min(10000, Math.max(0, Math.round(bps)));
  const otherIds = p.loops.map((l) => l.id).filter((id) => id !== loopId);
  const prev = p.orchestrator.allocationsBps;
  const otherPrevTotal = otherIds.reduce((s, id) => s + (prev[id] ?? 0), 0);
  const remaining = 10000 - clamped;
  const scaledOthers: Record<string, number> = {};
  for (const id of otherIds) {
    scaledOthers[id] = otherPrevTotal > 0 ? ((prev[id] ?? 0) / otherPrevTotal) * remaining : remaining / Math.max(1, otherIds.length);
  }
  const normalizedOthers = normalizeAllocationsScaled(scaledOthers, otherIds, remaining);
  const allocationsBps: Record<string, number> = {};
  for (const l of p.loops) allocationsBps[l.id] = l.id === loopId ? clamped : normalizedOthers[l.id]!;
  return { ...p, orchestrator: { ...p.orchestrator, allocationsBps } };
}

/**
 * Write a full allocation vector at once (IT4 copilot APPLY). Keys must equal
 * the loop-id set and values must be non-negative integers summing to exactly
 * 10000; otherwise the portfolio is returned unchanged (same rejection idiom
 * as updateParam). Unlike sequential setAllocation calls, an arbitrary target
 * vector lands verbatim.
 */
export function setAllocations(p: PortfolioGraph, allocationsBps: Record<LoopId, number>): PortfolioGraph {
  const keys = Object.keys(allocationsBps).sort().join(",");
  const loopIds = p.loops.map((l) => l.id).sort().join(",");
  if (keys !== loopIds || p.loops.length === 0) return p;
  let sum = 0;
  for (const l of p.loops) {
    const v = allocationsBps[l.id]!;
    if (!Number.isInteger(v) || v < 0) return p;
    sum += v;
  }
  if (sum !== 10000) return p;
  const ordered: Record<LoopId, number> = {};
  for (const l of p.loops) ordered[l.id] = allocationsBps[l.id]!;
  return { ...p, orchestrator: { ...p.orchestrator, allocationsBps: ordered } };
}

/** Largest-remainder to an arbitrary total (helper for setAllocation). */
function normalizeAllocationsScaled(
  scaled: Record<string, number>,
  ids: string[],
  total: number,
): Record<string, number> {
  const floors = ids.map((id) => Math.floor(scaled[id] ?? 0));
  let remainder = total - floors.reduce((s, x) => s + x, 0);
  const order = ids
    .map((id, i) => ({ i, frac: (scaled[id] ?? 0) - Math.floor(scaled[id] ?? 0) }))
    .sort((a, b) => (b.frac !== a.frac ? b.frac - a.frac : a.i - b.i));
  const out: Record<string, number> = {};
  for (const { i } of order) {
    out[ids[i]!] = floors[i]! + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
  }
  return out;
}

// ── Portfolio validation (§2.3) ───────────────────────────────────────────

export function validatePortfolio(p: PortfolioGraph): PortfolioValidationResult {
  const issues: ValidationIssue[] = [];
  const perLoop: Record<LoopId, ValidationResult> = {};
  const launchShapedLoopIds: LoopId[] = [];

  for (const loop of p.loops) {
    const r = validateGraph(loop);
    perLoop[loop.id] = r;
    for (const issue of r.issues) issues.push({ ...issue, loopId: loop.id });
    if (r.ok) launchShapedLoopIds.push(loop.id);
  }

  const orch = p.orchestrator;
  if (orch.enabled) {
    if (launchShapedLoopIds.length < 2) {
      issues.push({
        code: "orch-needs-two-loops",
        message: "The orchestrator needs at least two launch-shaped loops to govern",
      });
    }
    const keySet = Object.keys(orch.allocationsBps).sort().join(",");
    const loopSet = p.loops.map((l) => l.id).sort().join(",");
    const sum = Object.values(orch.allocationsBps).reduce((s, x) => s + x, 0);
    if (keySet !== loopSet || sum !== 10000) {
      issues.push({
        code: "orch-alloc-sum",
        message: `Allocations must cover every loop and sum to 10000 bps (got ${sum})`,
      });
    }
    // Dial bounds against the descriptors (mirrors validateGraph's param loop)
    for (const desc of ORCH_DIAL_DEFS) {
      const value = orch.params[desc.field];
      if ((desc.type === "slider" || desc.type === "number") && typeof value === "number") {
        if ((typeof desc.min === "number" && value < desc.min) || (typeof desc.max === "number" && value > desc.max)) {
          issues.push({
            code: "orch-rule-param",
            message: `Orchestrator: ${desc.friendlyLabel} ${value} outside [${desc.min}, ${desc.max}]`,
          });
        }
      }
      if (desc.type === "segmented" && typeof value === "string" && desc.options && desc.options.length > 0) {
        if (!desc.options.some((o) => o.value === value)) {
          issues.push({ code: "orch-rule-param", message: `Orchestrator: unknown ${desc.friendlyLabel} "${value}"` });
        }
      }
    }
  }

  // duplicate-market: always an issue — reallocating between the same market
  // is meaningless and double-counts capacity.
  const byCandidate = new Map<string, LoopId>();
  for (const loop of p.loops) {
    const src = nodeFor(loop, "liquidity-source");
    const candidateId = String(src?.data.params.candidateId ?? "");
    if (!candidateId) continue;
    const firstLoop = byCandidate.get(candidateId);
    if (firstLoop) {
      issues.push({
        code: "duplicate-market",
        message: `Two loops pinned to the same market (${String(src?.data.params.pairLabel ?? candidateId)})`,
        loopId: loop.id,
      });
    } else {
      byCandidate.set(candidateId, loop.id);
    }
  }

  // Portfolio ok = zero hard issues and ≥1 launch-shaped loop; incomplete
  // extra loops are draft-legal (the draft route's incomplete-but-coherent rule).
  const ok = issues.length === 0 && launchShapedLoopIds.length >= 1;
  return { ok, issues, perLoop, launchShapedLoopIds };
}
