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

export type ModuleKey =
  | "liquidity-source"
  | "safety-buffer"
  | "hedge"
  | "auto-compound"
  // Template families (TEMPLATE_DEEPLINKS 2026-08-21): the delta-neutral LP
  // range instrument and the treasury-collar option legs. Not on the loop
  // spine — each belongs to its own lane family (graph-ops FAMILY_CHAINS).
  | "auto-center"
  | "covered-call"
  | "protective-put"
  /**
   * THE FIRST OVERLAY (2026-08-26). Not on any FAMILY_CHAIN, deliberately:
   * an edge is "a hop along the capital spine", and nothing passes THROUGH a
   * watcher — its output is a decision ABOUT the other legs. Putting it on a
   * chain would make `deriveEdges` emit a `kind: "flow"` edge that is a lie in
   * the data model, and would silently enrol it in `CARRY_MODULES`, which is
   * derived from the chains and means "every module that EARNS". It sits at
   * rank 4, off the spine, and `graph-ops.OVERLAY_KEYS` is the one predicate
   * that says so.
   */
  | "exogenous-risk"
  /**
   * THE EXIT ROUTE (BASIS CARRY + TREASURY FLOOR). Rank 2, and it is the
   * treasury family's own rank-2 anchor the way `hedge` is the loop's: a
   * treasury lane holds an issuer position and the only question at rank 2 is
   * how the position is turned back into cash. A lane holding BOTH `hedge`
   * and this is refused (`hedge-or-exit`): two rank-2 modules are
   * alternatives, not a stack.
   *
   * It is NOT in `FAMILY_REQUIRED_GROUPS.loop`. Adding it there makes
   * `{liquidity-source, redemption-route}` launch-shaped on a funding market,
   * which publishes a naked long as a funding carry two presses deep.
   */
  | "redemption-route";

export type ParamControlType = "slider" | "segmented" | "toggle" | "select" | "number";

export type ParamValue = number | string | boolean;

export interface ParamOption {
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
  /**
   * Fixed position on the capital spine; also the auto-layout column.
   *
   * WIDENED TO 4 for the first OVERLAY module (2026-08-26). An overlay has no
   * position ON the spine, so it takes the column after the last one: both
   * readers are safe there, and neither is a claim. `positionFor` is
   * presentational and hash-excluded; `serialize.sortNodes` uses the rank only
   * to order nodes deterministically inside the canonical form.
   */
  rank: 0 | 1 | 2 | 3 | 4;
  /** Optional modules can be absent from a valid graph. */
  optional: boolean;
  params: ParamDescriptor[];
}

export interface NodePosition {
  x: number;
  y: number;
}

/** Data carried on a React Flow node (node.data). */
export interface ModuleNodeData extends Record<string, unknown> {
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

/**
 * Shaped to be used directly as a React Flow edge.
 *
 * `kind` carried a second member, `"alloc"`, for the orchestrator wires. Only
 * `deriveOrchestratorEdges` ever produced one and only its own test ever read
 * one — the wires that actually render are measured from the DOM. Both went
 * on 2026-08-22 (recette K2), and the union is a single member because a
 * `ModuleEdge` describes exactly one thing: a hop along the capital spine.
 */
export interface ModuleEdge {
  id: string;
  source: string;
  target: string;
  data: { kind: "flow" };
}

export interface StrategyGraph {
  nodes: ModuleNode[];
  edges: ModuleEdge[];
}

// ── v2: portfolio of loops + orchestrator ─────────────────────────────────

/** Loop ids are `loop_<n>` (monotonic integer, deterministic). Never "orchestrator". */
export type LoopId = string;

/** Singleton orchestrator node id, reserved — no LoopId may collide. */
export const ORCHESTRATOR_NODE_ID = "orchestrator";

/**
 * One loop = exactly today's 4-module spine. `nodes`/`edges` keep the
 * ModuleNode/ModuleEdge shapes so graph-ops and compile extraction survive
 * unchanged. Node ids are NAMESPACED: `${loopId}/${defKey}` (see ids.ts) —
 * module identity stays in data.defKey.
 */
export interface LoopGraph {
  id: LoopId;
  /** User-renamable lane label; defaults to "Lane <n>". Presentational: excluded from contentHash. */
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
    // NO PRODUCER since 2026-08-22 (MODULE-FIRST BUILD CANVAS §2 M1). The push
    // in `validateGraph` was deleted: `liquidity-source` is in all three
    // FAMILY_REQUIRED sets, so a source-less lane is already reported through
    // the `missing` channel, and carrying it ALSO as a hard issue is what made
    // "module placed, no market yet" invalid rather than incomplete. The member
    // stays so `refusalFor` keeps its branch and a restored older draft's
    // stored code still reads; delete both together or neither.
    | "missing-source"
    // DELETED 2026-08-22 (THE UNCOMMITTED CANVAS §2 M2): "hedge-requires-safety-buffer".
    // The clause it named forced the builder to install the module that COSTS
    // money on most depositable rows before it would let them install the module
    // that IS the yield on all of them. The quant ledger's ruling was "do not
    // steer, remove the obstruction", so the rule went and the code went with
    // it. Unlike `missing-source` there is no restored-draft reader to keep it
    // alive for: no draft stores an issue code.
    // NOTE: "hedged-class-needs-hedge" lived here with no producer. It was
    // retired by the founder ruling of 2026-08-20 (the hedge is OPTIONAL on a
    // hedged-class market; ejecting it reprices the lane onto the model's
    // unhedged branch and is a legitimate composition). Only the converse
    // survives: an unhedged-class market has no perp leg to install.
    | "unhedged-class-forbids-hedge"
    | "family-mismatch" // a module from another lane family placed on this lane
    // The MARKET's half of the same rule (2026-08-22). `family-mismatch` catches
    // a module that does not belong on this lane; this catches a MARKET that
    // does not — a live scan row pinned to a collar lane that `collarModel`
    // cannot price, or a hand-authored LP row pinned to a loop lane whose
    // arithmetic must never touch it. Derived from the row's own hand-authored
    // terms (`familiesForCandidate`), never from its venue name.
    | "market-family-mismatch"
    // RENAMED from "compound-requires-safety-buffer" 2026-08-22 (§2 M2). The
    // old spelling was a loop-family rule wearing a general name: it demanded
    // `safety-buffer`, which exists on exactly one of the three chains, so a
    // collar or an LP lane was measured against a module it can never hold.
    // The true rule is family-agnostic and holds on all four shapes: there must
    // be something on the lane that EARNS, or there is nothing to compound.
    | "compound-requires-carry"
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
  /**
   * Modules still needed before the graph is launch-shaped (readiness chip) —
   * the requirements with exactly ONE way to satisfy them.
   */
  missing: ModuleKey[];
  /**
   * The requirements with SEVERAL ways to satisfy them, one group per
   * requirement, each satisfied by any single member.
   *
   * Added 2026-08-22 with the OR-group requirement model (THE UNCOMMITTED
   * CANVAS §2B): a loop lane is finished by `safety-buffer` OR `hedge`, so
   * "what is still missing" stopped being a flat list of keys. Additive on
   * purpose — every consumer of `missing` keeps compiling, and every consumer
   * that gates on readiness must read `ok`, which counts both channels.
   */
  missingAny: ModuleKey[][];
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

// ── How a row's economics were produced (recette build item 22, E1) ───────
//
// Three files used to ask "is this a template row?" by matching the VENUE
// NAME (`isTemplateVenue`): `mock-quote.hedgelessApy`, `hedge-econ`, and the
// capacity path. Venue name is a coincidence of which mock venue a template
// happens to be authored against; the real question is whether the numbers
// came out of the scan's model or out of a hand-authored family model, and
// that is a property of the ECONOMICS, not of the string next to it.
//
// The flag rides on `economics.model`. Absent means "scan-derived", so every
// row the scanner emits is correct without touching the scanner.

/** Provenance of a candidate's economics block. */
export type EconomicsModel = "scan-derived" | "hand-authored";

/**
 * Structural view of a candidate's economics, narrow enough that a
 * `ProjectedCandidate["economics"]` satisfies it without a cast.
 *
 * `netApyOnDepositApy` is present only to keep this off TypeScript's weak-type
 * check (a target whose properties are ALL optional rejects a source that
 * shares none of them); it is never read here.
 */
export interface TaggedEconomics {
  netApyOnDepositApy: number;
  model?: EconomicsModel;
}

/** Provenance of an economics block. Absent tag = the scan produced it. */
export function economicsModel(e: TaggedEconomics | null | undefined): EconomicsModel {
  return e?.model === "hand-authored" ? "hand-authored" : "scan-derived";
}

/**
 * True when the numbers were authored by a family model in `templates.ts`
 * rather than derived by the scan. Such a row must NOT be run through the
 * loop arithmetic (`grossCarry`, the f_b escrow conversion, the exec-drag
 * inversion): it has no borrow leg, no HL margin escrow and no scan leverage,
 * so every one of those returns a number about a machine that does not exist.
 */
export function isHandAuthored(e: TaggedEconomics | null | undefined): boolean {
  return economicsModel(e) === "hand-authored";
}
