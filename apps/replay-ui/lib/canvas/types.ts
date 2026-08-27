/**
 * Priime Build canvas — core data model (BC-P1).
 *
 * Ported (trimmed) from priime-build/lib/types.ts: the ModuleDef/ParamDescriptor/
 * StrategyGraph contract survives; marketplace/audit/social fields do not.
 * Node/edge shapes are used DIRECTLY as @xyflow/react node/edge payloads.
 *
 * Spine invariant: modules occupy fixed ranks on a left-to-right capital spine
 * (source 0 → safety-buffer 1 → hedge 2 → auto-compound 3). Edges are DERIVED
 * from the set of placed modules (see graph-ops.deriveEdges) — never free-drawn.
 */

export type ModuleKey = "liquidity-source" | "safety-buffer" | "hedge" | "auto-compound";

type ParamControlType = "slider" | "segmented" | "toggle" | "select" | "number";

export type ParamValue = number | string | boolean;

interface ParamOption {
  value: string;
  label: string;
  /** Compact key label for narrow segmented keys (falls back to label). */
  shortLabel?: string;
  /** Optional underlying numeric the option maps to (e.g. preset -> multiplier). */
  numeric?: number;
}

/**
 * A single friendly, guardrailed parameter descriptor.
 * Drives the param panel control, server-side validation, and store clamping.
 * min/max are HARD clamps; recommendedMin/Max render as the soft band.
 */
export interface ParamDescriptor {
  field: string;
  friendlyLabel: string;
  type: ParamControlType;
  default: ParamValue;
  min?: number;
  max?: number;
  step?: number;
  recommendedMin?: number;
  recommendedMax?: number;
  unit?: string;
  help?: string;
  options?: ParamOption[];
  advanced?: boolean;
  /** Set programmatically (e.g. by the opportunity catalog); never rendered as a control. */
  hidden?: boolean;
}

export interface ModuleDef {
  key: ModuleKey;
  name: string;
  tagline: string;
  description: string;
  /** Fixed position on the capital spine; also the auto-layout column. */
  rank: 0 | 1 | 2 | 3;
  /** Optional modules can be absent from a valid graph. */
  optional: boolean;
  params: ParamDescriptor[];
}

interface NodePosition {
  x: number;
  y: number;
}

/** Data carried on a React Flow node (node.data). */
interface ModuleNodeData extends Record<string, unknown> {
  defKey: ModuleKey;
  params: Record<string, ParamValue>;
}

/** Shaped to be used directly as a React Flow node. */
export interface ModuleNode {
  id: string;
  type: "priimeModule";
  position: NodePosition;
  data: ModuleNodeData;
}

/** Shaped to be used directly as a React Flow edge. */
export interface ModuleEdge {
  id: string;
  source: string;
  target: string;
  data: { kind: "flow" | "alloc" };
}

export interface StrategyGraph {
  nodes: ModuleNode[];
  edges: ModuleEdge[];
}

// ── v2: portfolio of loops + orchestrator ─────────────────────────────────

/** Loop ids are `loop_<n>` (monotonic integer, deterministic). Never "orchestrator". */
export type LoopId = string;

/**
 * One loop = exactly today's 4-module spine. `nodes`/`edges` keep the
 * ModuleNode/ModuleEdge shapes so graph-ops and compile extraction survive
 * unchanged. Node ids are NAMESPACED: `${loopId}/${defKey}` (see ids.ts) —
 * module identity stays in data.defKey.
 */
export interface LoopGraph {
  id: LoopId;
  /** User-renamable lane label; defaults to "Loop <n>". Presentational: excluded from contentHash. */
  label: string;
  nodes: ModuleNode[];
  edges: ModuleEdge[];
}

/**
 * Graph-side orchestrator state. Exactly THREE user-touchable dials
 * (ORCHESTRATOR_SPEC R10): reactivity, maxConcentrationPct,
 * turnoverBudgetPctWeek. Rules are NEVER stored here — they are derived by
 * deriveOrchRules() at validate/compile/eval time (R38 derived-only; a draft
 * carrying hand-edited rules cannot exist because there is nowhere to put
 * them). Allocations are display/derivation state normalized to Σ=10000 bps.
 */
export interface OrchestratorConfig {
  enabled: boolean;
  /** The three ORCHESTRATOR_SPEC dials, clamped via ORCH_DIAL_DEFS descriptors. */
  params: Record<string, ParamValue>;
  /** Target capital split in bps, keyed by LoopId. Invariant: keys == loop ids, Σ == 10000. */
  allocationsBps: Record<LoopId, number>;
}

export interface PortfolioGraph {
  v: 2;
  loops: LoopGraph[]; // array order = lane order (presentational, excluded from hash)
  orchestrator: OrchestratorConfig;
}

/** v2 persisted envelope (KV: canvas:draft:{address} — same key, self-describing v). */
export interface CanvasDraftV2 {
  v: 2;
  portfolio: PortfolioGraph;
  contentHash: string; // sha-256 of canonicalizeV2(portfolio)
  savedAtMs: number;
}

/** The persisted draft envelope (KV: canvas:draft:{address}). */
export interface CanvasDraft {
  v: 1;
  graph: StrategyGraph;
  /** sha-256 of the canonical serialization; recomputed on save, checked on load. */
  contentHash: string;
  savedAtMs: number;
}

export type AnyCanvasDraft = CanvasDraft | CanvasDraftV2;

export interface ValidationIssue {
  code:
    | "unknown-module"
    | "duplicate-module"
    | "missing-source"
    | "hedge-requires-safety-buffer"
    | "hedged-class-needs-hedge"
    | "unhedged-class-forbids-hedge"
    | "compound-requires-safety-buffer"
    | "edges-not-canonical"
    | "unknown-param"
    | "param-out-of-bounds"
    // portfolio-level (v2)
    | "orch-needs-two-loops" // orchestrator enabled with < 2 launch-shaped loops
    | "orch-alloc-sum" // allocationsBps keys != loop ids, or Σ != 10000
    | "orch-rule-param" // orchestrator dial / derived-rule invariant violation
    | "duplicate-market"; // two loops pinned to the same candidateId
  message: string;
  nodeId?: string;
  /** Set on per-loop issues inside a portfolio validation. */
  loopId?: LoopId;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  /** Modules still needed before the graph is launch-shaped (readiness chip). */
  missing: ModuleKey[];
}

export interface PortfolioValidationResult {
  ok: boolean;
  /** Portfolio-level (loopId unset) + per-loop (loopId set) issues. */
  issues: ValidationIssue[];
  /** Today's validateGraph result per loop. */
  perLoop: Record<LoopId, ValidationResult>;
  /** Loops that individually pass validateGraph().ok — the orchestrator gate counts these. */
  launchShapedLoopIds: LoopId[];
}
