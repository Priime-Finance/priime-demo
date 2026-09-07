/**
 * Pure graph operations (BC-P1, portfolio-level since v2). No store, no
 * React: every mutation returns a new PortfolioGraph, edges are always
 * re-derived from the node set, and params are clamped at the boundary.
 *
 * Spine wiring rule (single source of truth, also enforced by validateGraph):
 *   the lane's family chain, wired sequentially through whichever chain
 *   modules are actually placed. One rule for all three families since
 *   2026-08-22 — the loop used to carry a hand-written three-clause version of
 *   the same thing, and it had no answer for `{source, hedge}`, which the
 *   deletion of `hedge-requires-safety-buffer` made a legal composition.
 *
 * v2 (ARCHITECTURE_V2 §2/§3): loops are lanes; node ids are namespaced
 * `${loopId}/${key}` (ids.ts). The orchestrator auto-installs at the second
 * loop and auto-uninstalls below two (UX_SPEC §4: the user never chooses to
 * add it), so `enabled` has exactly one writer — `withOrchestratorRule`. Its
 * wires are drawn by RackCanvas from measured DOM geometry and have no
 * graph-side representation.
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
import { descriptorsFor, DISPLAY_ORDER, getDef, MODULE_DEFS, type ParamContext } from "./modules";
/* templates.ts imports graph-ops back. The cycle is inert by construction:
   neither module calls the other at evaluation time (templates' top level is
   family models and object literals; this file's is constants and function
   declarations), so `familiesForCandidateId` is only ever reached from inside
   `validateGraph`. The id → family fact belongs beside the rows that carry it,
   which is why it is imported rather than re-spelled here. */
import { familiesForCandidateId, fundingClassCandidateId } from "./templates";
import { newLoopId, nodeId } from "./ids";
/* A LEAF, one import deep (`lib/demo-scope.ts`, which imports nothing). */
import { FLOOR_LANE_LABEL } from "./floor-pair";
import { FLOOR_MARKET_ID } from "@/lib/demo-scope";
/* Type-only, so the store ↔ canvas boundary carries no runtime edge: the graph
   adopts the store's own strategy word (`StrategyKind`) rather than minting a
   second enum for the same four products. */
import type { StrategyKind } from "@/lib/vaults/store";
import { defaultOrchestrator, normalizeAllocations, ORCH_DIAL_DEFS } from "./orchestrator";

// ── Layout constants (§3). Positions are presentational (hash-excluded);
//    the rack renderer lays out with CSS, these keep drafts deterministic. ──

export const ORCH_COL_X = 40; // orchestrator column, far left
export const LANE_X0 = 340; // loop rank-0 column start
export const COL_X = 340; // column pitch
export const LANE_TOP = 40; // IT4C: dead zone above lane 1 tightened (was 80)
export const LANE_H = 230; // node ~150px tall + gutter

function positionFor(laneIndex: number, key: ModuleKey) {
  return { x: LANE_X0 + getDef(key).rank * COL_X, y: LANE_TOP + laneIndex * LANE_H };
}

// ── Per-loop internals (v1 bodies, verbatim) ──────────────────────────────

export function nodeFor(loop: Pick<LoopGraph, "nodes">, key: ModuleKey): ModuleNode | undefined {
  return loop.nodes.find((n) => n.data.defKey === key);
}

/** Defaults, narrowed to the lane's market when the caller knows it. Without
 *  a context the STRUCTURAL defaults land and `reclampLoopParams` moves them
 *  the moment a market is pinned (recette A6/A11/A12). */
function defaultParams(key: ModuleKey, ctx?: ParamContext): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const p of descriptorsFor(key, ctx)) out[p.field] = p.default;
  return out;
}

// ── Lane families (TEMPLATE_DEEPLINKS 2026-08-21) ─────────────────────────
//
// Three lane shapes share the rack: the loop spine (unchanged), the
// delta-neutral LP lane (anchored by auto-center), and the treasury collar
// (anchored by the option legs). Family is a pure derivation of the placed
// module set; each family carries its own chain order and required set.

/**
 * `treasury` is the FOURTH family (BASIS CARRY + TREASURY FLOOR). It is a
 * family rather than a loop-family strategy because its rank-2 anchor is
 * `redemption-route`, not `hedge` or `safety-buffer`, and because the loop
 * family's OR-group must not learn about it: `{liquidity-source,
 * redemption-route}` inside `FAMILY_REQUIRED_GROUPS.loop` would be a complete,
 * publishable loop lane on a funding market holding no strategy module, which
 * publishes a naked long as a funding carry.
 */
export type LaneFamily = "loop" | "dnlp" | "collar" | "treasury";

export const FAMILY_CHAINS: Record<LaneFamily, ModuleKey[]> = {
  loop: ["liquidity-source", "safety-buffer", "hedge", "auto-compound"],
  dnlp: ["liquidity-source", "auto-center", "hedge", "auto-compound"],
  collar: ["liquidity-source", "covered-call", "protective-put", "auto-compound"],
  /* Three steps, not four: there is no rank-1 leverage step on a lane whose
     whole claim is that it is unlevered. `redemption-route` sits at rank 2,
     where the loop family seats its hedge. */
  treasury: ["liquidity-source", "redemption-route", "auto-compound"],
};

/**
 * THE OVERLAY KEYS — every module that is NOT a hop on any family's capital
 * spine (2026-08-26).
 *
 * DERIVED from `DISPLAY_ORDER` against `FAMILY_CHAINS`, never hand-typed, so a
 * second overlay costs nothing and a module moved onto a chain leaves this
 * automatically. One owner, and every reader below asks it the same single
 * question: is this key part of the lane's capital chain?
 *
 * WHY AN OVERLAY IS NOT A CHAIN MEMBER. `ModuleEdge.data.kind` is a
 * single-member union precisely so that "a `ModuleEdge` describes exactly one
 * thing: a hop along the capital spine". Auto-compound is a hop; earned yield
 * goes back into the loop. A watcher is not: nothing passes through it, and
 * its output is a decision ABOUT the other legs. Put it on a chain and
 * `deriveEdges` emits `auto-compound -> exogenous-risk` as `kind: "flow"`,
 * which is false in the data model, and the only way out is a special case one
 * comment-block after this file declares "ONE RULE FOR ALL THREE FAMILIES".
 *
 * AND THE DERIVATION THAT WOULD HAVE BROKEN SILENTLY. `CARRY_MODULES` below is
 * "every module that EARNS", derived from the chains. A watcher on a chain
 * joins that set, and `{liquidity-source, exogenous-risk, auto-compound}` then
 * passes `compound-requires-carry` — publishing an auto-compounder on a lane
 * that earns nothing. Off the chains, that stays right for free.
 */
export const OVERLAY_KEYS: ReadonlySet<ModuleKey> = new Set(
  DISPLAY_ORDER.filter(
    (k) => !(Object.keys(FAMILY_CHAINS) as LaneFamily[]).some((f) => FAMILY_CHAINS[f].includes(k)),
  ),
);

/** The chain members of a placed set: what the family derivations may read. */
function chainKeys(keys: readonly ModuleKey[]): ModuleKey[] {
  return keys.filter((k) => !OVERLAY_KEYS.has(k));
}

/**
 * How a family names itself on a surface, and in a validator message. Never
 * the raw enum.
 *
 * MOVED HERE from `compose-options.ts` 2026-08-22 (§2C S2). Two spellings of
 * one fact used to run side by side: a private `familyWord()` in this file
 * (which spelled the collar `collar`) and `FAMILY_LABEL` in the panel (which
 * spelled it `treasury-collar`), so the validator and the dock described the
 * same lane with different words. The label lives beside `FAMILY_CHAINS`
 * because that is where the family is declared, and because the panel imports
 * this file while this file must never import the panel.
 *
 * The collar is spelled `treasury collar`, matching the template's own name.
 */
export const FAMILY_LABEL: Record<LaneFamily, string> = {
  loop: "loop",
  dnlp: "delta-neutral LP",
  collar: "treasury collar",
  /* `treasury floor`, never bare `treasury`: the collar above already owns the
     word `treasury` in its own label, and two lanes must not answer to one
     word on the same rack. The floor is what this lane is FOR. */
  treasury: "treasury floor",
};

/**
 * WHAT TO CALL A LANE ON SCREEN, and it is not its ordinal.
 *
 * `Lane 2` is the canvas's own default and it means nothing to anyone who did
 * not build the rack: the plate drew `LANE 1` and `LANE 2` over two bars, the
 * founder read it as a component naming nothing, and the vault page's rule
 * sentence would have read `Moves everything to Lane 2`. An unrenamed lane
 * therefore shows its FAMILY, through `FAMILY_LABEL`, the one owner of that
 * word; a lane the builder actually named keeps the name they gave it,
 * because that name is a decision and this is not.
 *
 * It lives here because THREE surfaces ask it (the plate's bars, the dock's
 * bars, and the label the publish writes onto the record) and the publish had
 * the only copy of the rule.
 */
export function laneDisplayLabel(
  label: string,
  family: LaneFamily,
  candidateId?: string | null,
): string {
  if (!/^Lane \d+$/.test(label.trim())) return label;
  /* THE FLOOR LANE HAS A NAME OF ITS OWN, and it is not its family word: plan
     R1 called it `USDC lending` and the replay's lane key has said so since it
     was built, so a plate bar reading `treasury floor` beside a run panel
     reading `USDC lending` would be two names for one lane. Every other family
     falls through to its family word, which is what it is. */
  if (candidateId && candidateId === FLOOR_MARKET_ID) return FLOOR_LANE_LABEL;
  return FAMILY_LABEL[family];
}

/**
 * What a lane of this family must place before it is FINISHED, as OR-GROUPS:
 * one group per requirement, each satisfied by ANY ONE of its members.
 *
 * The shape changed 2026-08-22 (§2B) because the loop family acquired a second
 * legal anchor. With `hedge-requires-safety-buffer` deleted, `{source, hedge}`
 * at L = 1 is a complete, publishable lane — the funding carry — and a flat
 * required list has no way to say "either of these two finishes you".
 *
 * Two entries here are rulings, not bookkeeping:
 *
 *  • `loop` takes `safety-buffer` OR `hedge`. Requiring the leverage module
 *    outright is the steering the quant ledger struck down.
 *  • `dnlp` REQUIRES `hedge`. Without it `{source, auto-center}` validated
 *    `ok: true`, published, and printed a positive net APY for a position that
 *    is fully long the collateral. That is a live honesty bug two presses deep,
 *    and `STRUCTURAL_MODULES.dnlp` only ever closed it on eject.
 */
export const FAMILY_REQUIRED_GROUPS: Record<LaneFamily, ModuleKey[][]> = {
  loop: [["liquidity-source"], ["safety-buffer", "hedge"]],
  dnlp: [["liquidity-source"], ["auto-center"], ["hedge"]],
  collar: [["liquidity-source"], ["covered-call"], ["protective-put"]],
  /* Both singletons: the exit route is required BY NAME on this family, and
     it is the only anchor. `auto-compound` is optional here exactly as it is
     everywhere else.

     ⚠ `loop` ABOVE IS DELIBERATELY UNTOUCHED and must stay that way. */
  treasury: [["liquidity-source"], ["redemption-route"]],
};

/**
 * ⚠ TRANSITIONAL FLAT VIEW — do not read this in new code, read
 * `FAMILY_REQUIRED_GROUPS`.
 *
 * DERIVED (one owner: the groups above), never hand-typed, and it carries each
 * group's FIRST member so it reproduces exactly the flat list this constant
 * held before the OR-groups landed. It exists only so the three surfaces still
 * reading a flat list — `compose-options.ts`, `Lane.tsx`, `tips.ts` — keep
 * compiling until the surface wave re-points them; each is owned by another
 * item in this wave. It is a LOSSY view: on a loop lane it says
 * `safety-buffer` and cannot say "or the hedge".
 *
 * HANDOFF: delete this alias and rename `FAMILY_REQUIRED_GROUPS` back to
 * `FAMILY_REQUIRED` once those three call sites are gone.
 */
export const FAMILY_REQUIRED: Record<LaneFamily, ModuleKey[]> = Object.fromEntries(
  (Object.keys(FAMILY_REQUIRED_GROUPS) as LaneFamily[]).map((f) => [
    f,
    FAMILY_REQUIRED_GROUPS[f].map((group) => group[0]),
  ]),
) as Record<LaneFamily, ModuleKey[]>;

/** The groups `seen` does not satisfy. A group is satisfied by ANY member. */
function unsatisfiedGroups(groups: ModuleKey[][], seen: Set<ModuleKey>): ModuleKey[][] {
  return groups.filter((group) => !group.some((k) => seen.has(k)));
}

/**
 * Every module that EARNS on a lane: each family chain minus the source (which
 * only pins the market) and minus `auto-compound` (which only re-deploys what
 * the others earned). Derived from `FAMILY_CHAINS`, so a fourth family cannot
 * leave it stale. This is the set `compound-requires-carry` asks about.
 */
const CARRY_MODULES: ModuleKey[] = [
  ...new Set((Object.keys(FAMILY_CHAINS) as LaneFamily[]).flatMap((f) => FAMILY_CHAINS[f])),
].filter((k) => k !== "liquidity-source" && k !== "auto-compound");

/** The lane's family, derived from the placed modules (option legs win).
 *
 *  TOTAL by construction, and it stays that way: `deriveEdges`, `publishDraft`,
 *  `STRUCTURAL_MODULES` and every BOUND lane read this. What it cannot do is
 *  tell "this lane is a loop" from "this lane has not said yet" — an empty node
 *  set falls through to `"loop"`. That fallback is correct wiring (nothing to
 *  wire) and an unearned assertion on a blank canvas, which is what
 *  `laneFamilies` below exists to separate. */
export function laneFamily(nodes: ModuleNode[]): LaneFamily {
  const keys = new Set(nodes.map((n) => n.data.defKey));
  if (keys.has("covered-call") || keys.has("protective-put")) return "collar";
  if (keys.has("auto-center")) return "dnlp";
  /* The exit route is the treasury family's rank-2 anchor, so it names the
     family the same way the option legs and the range module name theirs.
     Without this clause a treasury lane falls through to `loop` and
     `deriveEdges` wires it along the LOOP chain, which is a lie in the data
     model rather than a cosmetic slip. */
  if (keys.has("redemption-route")) return "treasury";
  return "loop";
}

/**
 * The families still CONSISTENT with the placed set — the blank canvas's
 * missing derivation (MODULE-FIRST BUILD CANVAS §2a).
 *
 * `laneFamily([])` returns `"loop"`, so before this an empty lane was already a
 * loop lane: `auto-center` / `covered-call` / `protective-put` came back
 * `family-mismatch` before the user had expressed anything, and
 * `addableModules()` offered exactly one key. The reframe is the REMOVAL of
 * that unearned default, not a second mode beside it.
 *
 * A family survives while every placed module sits on its chain:
 *
 *   `{}`                              → all three  (nothing said yet)
 *   `{liquidity-source}`              → all three  (the source is in every chain)
 *   `{liquidity-source,safety-buffer}`→ ["loop"]   (BOUND — the gate fires again)
 *   `{safety-buffer,covered-call}`    → []         (impossible; `laneFamily`
 *                                                   calls it "collar" and
 *                                                   `validateGraph` flags it)
 *
 * Same verdict as today on every bound lane, one step earlier on the unbound
 * ones. Declaration order of `FAMILY_CHAINS` is the returned order, so a
 * surface listing the surviving anchors gets loop / dnlp / collar without
 * sorting anything.
 */
export function laneFamilies(nodes: ModuleNode[]): LaneFamily[] {
  /* OVERLAYS ARE NOT EVIDENCE ABOUT A FAMILY (2026-08-26). An overlay sits on
     no chain, so an unfiltered `.every` returns [] the moment one is placed —
     and the blast radius of that empty list is not cosmetic: `boundFamily`
     falls through to `laneFamily`, the validator's family gate then raises
     `family-mismatch` on the overlay itself and the lane becomes
     unpublishable, `committedFamilies` returns [] and `committedStrategy`
     publishes a COLLAR lane as `strategy: "loop"`. One filter, and every one
     of those behaves exactly as it does today. */
  const keys = chainKeys(nodes.map((n) => n.data.defKey));
  return (Object.keys(FAMILY_CHAINS) as LaneFamily[]).filter((f) =>
    keys.every((k) => FAMILY_CHAINS[f].includes(k)),
  );
}

/**
 * The family a lane is BOUND to, or null while more than one survives.
 *
 * Zero survivors is an impossible composition, not an unbound one, so it falls
 * back to `laneFamily` — that is the lane whose `family-mismatch` the validator
 * is already reporting, and the add surface must keep agreeing with it.
 */
function boundFamily(nodes: ModuleNode[]): LaneFamily | null {
  const fams = laneFamilies(nodes);
  if (fams.length === 1) return fams[0];
  if (fams.length === 0) return laneFamily(nodes);
  return null;
}

/**
 * Everything the lane has EXPRESSED, module set and pinned market together.
 *
 * A market is an expression too: a live supply/borrow row can only be priced
 * as a loop, and each hand-authored row belongs to exactly the family whose
 * model built it (`familiesForCandidate`). So a lane holding only its source
 * with a Morpho row pinned is unbound by its MODULES and committed by its
 * MARKET, and the whole shipped market-first flow lives in that state: it is
 * where `safety-buffer` is genuinely required and where `hedge` genuinely
 * carries the receipt "adds dynamic leverage too".
 *
 * DISTINCT FROM `boundFamily`, deliberately, and the two are used for
 * different jobs. The family GATE runs on modules alone, because the refusal it
 * writes is `family-mismatch` and that is the code `validateGraph` raises for a
 * module outside the chain; when it is the MARKET that refuses, the simulation
 * raises `market-family-mismatch` instead and the add surface must report THAT.
 * Commitment drives what is REQUIRED and what an add IMPLIES — questions about
 * where the lane is going, not about which sentence the refusal gets.
 *
 * EXPORTED 2026-08-22, and it is the substitution this wave is made of: every
 * surface that SPEAKS to the builder reads this, and `laneFamily()` may only be
 * read by code that already knows the lane is bound.
 */
export function committedFamilies(loop: Pick<LoopGraph, "nodes">): LaneFamily[] {
  const byModules = laneFamilies(loop.nodes);
  const candidateId = String(nodeFor(loop, "liquidity-source")?.data.params.candidateId ?? "");
  if (!candidateId) return byModules;
  const byMarket = familiesForCandidateId(candidateId);
  const both = byModules.filter((f) => byMarket.includes(f));
  // An empty intersection is the `market-family-mismatch` the validator is
  // already reporting; the module set is what the surface must keep describing.
  return both.length > 0 ? both : byModules;
}

/**
 * The single family the lane has committed to, or null while it is still open.
 *
 * THE ONE ACCESSOR A SURFACE MAY USE to reach a family word, a family chain, a
 * family's required set or a family model. Null is not an absence of
 * information: it is the lane saying it has not chosen, and a surface that
 * cannot handle null is a surface about to assert a default.
 *
 * Zero survivors is an IMPOSSIBLE composition rather than an open one, so it
 * resolves to `laneFamily()` — the lane the validator is already reporting a
 * `family-mismatch` against, which is the lane the surface must keep naming.
 */
export function committedFamily(loop: Pick<LoopGraph, "nodes">): LaneFamily | null {
  const fams = committedFamilies(loop);
  if (fams.length === 1) return fams[0];
  if (fams.length === 0) return laneFamily(loop.nodes);
  return null;
}

// ── Lane strategies (FUNDING LAUNCH RAIL, 2026-08-24) ─────────────────────
//
// Funding is a STRATEGY, not a fourth family (design ruling 1). The graph
// already builds it — a loop-family lane of `{liquidity-source, hedge}` at
// L = 1 on a debt-less market — so there is no new FAMILY_CHAINS entry and no
// validator change. What the family layer cannot say is which PRODUCT a
// loop-family lane is, because the loop family holds two: the levered loop
// and the funding carry. The strategy layer says it, one level above the
// families, from the same three kinds of expression a lane can make:
//
//   · `safety-buffer` placed  → the borrow leg exists, so the lane is a LOOP
//     and funding is ruled out (ruling 2: the leverage module still "makes
//     this a loop lane").
//   · a FUNDING-CLASS market pinned (spot held against a perp short, no debt
//     leg — `fundingClassCandidateId`) → there is nothing to lever, so the
//     levered loop is ruled out and the lane is a FUNDING carry.
//   · a DEBT-BEARING market pinned → there is no spot-vs-short book behind
//     it, so funding is ruled out.
//
// dnlp and collar map one-to-one onto their families and carry no split.

/** Declaration order IS the shelf order: the loop family's two strategies
 *  first, in the family's own order, then the other families as declared.
 *
 *  `treasury` is NOT optional here. `laneStrategies` pushes every non-loop
 *  family straight into this union, so a blank lane already returns five; a
 *  four-member registry beside a five-member derivation is the drift
 *  `shelf-count.test.ts` exists to catch, and it caught it. */
export const STRATEGIES: readonly StrategyKind[] = ["loop", "funding", "dnlp", "collar", "treasury"];

/**
 * How a strategy names itself on a surface. Never the raw enum, and never a
 * second spelling of a family word: `dnlp`/`collar` read their FAMILY_LABEL,
 * so the two layers cannot describe one lane with two words.
 */
export const STRATEGY_LABEL: Record<StrategyKind, string> = {
  loop: FAMILY_LABEL.loop,
  funding: "funding carry",
  dnlp: FAMILY_LABEL.dnlp,
  collar: FAMILY_LABEL.collar,
  /* Reads its FAMILY_LABEL for the same reason dnlp and collar do: the
     strategy layer never mints a second spelling of a family word. */
  treasury: FAMILY_LABEL.treasury,
};

/**
 * The strategies still consistent with everything the lane has EXPRESSED —
 * the strategy layer's `committedFamilies`, and derived FROM it so the two
 * layers cannot disagree about the families underneath.
 *
 * A blank lane returns all four. `{hedge}` returns three (the collar's chain
 * has no hedge). `{safety-buffer}` returns exactly `["loop"]` — the borrow
 * leg is the loop's own anchor and rules the funding carry out. A pinned
 * funding-class market rules the levered loop out the same way.
 */
export function laneStrategies(loop: Pick<LoopGraph, "nodes">): StrategyKind[] {
  const fams = committedFamilies(loop);
  const placed = new Set(loop.nodes.map((n) => n.data.defKey));
  const candidateId = String(nodeFor(loop, "liquidity-source")?.data.params.candidateId ?? "");
  /** null = no market pinned yet: neither loop nor funding is ruled out. */
  const fundingMarket: boolean | null = candidateId ? fundingClassCandidateId(candidateId) : null;
  const out: StrategyKind[] = [];
  for (const f of fams) {
    if (f === "loop") {
      if (fundingMarket !== true) out.push("loop");
      if (!placed.has("safety-buffer") && fundingMarket !== false) out.push("funding");
    } else {
      out.push(f);
    }
  }
  return out;
}

/**
 * The single strategy the lane has committed to, or null while it is open —
 * the strategy layer's `committedFamily`, and the one accessor a surface may
 * use to reach a strategy word or a publish `strategy` field.
 *
 * Zero survivors is an impossible composition (e.g. a restored draft holding
 * `safety-buffer` on a funding-class market), not an open one, so it falls
 * back to `laneFamily()` — the loop family maps onto the loop strategy, which
 * is the lane the validator is already describing.
 */
export function committedStrategy(loop: Pick<LoopGraph, "nodes">): StrategyKind | null {
  const s = laneStrategies(loop);
  if (s.length === 1) return s[0];
  if (s.length === 0) return laneFamily(loop.nodes);
  return null;
}

/**
 * The module keys an "add the missing piece" surface can ever ask for.
 *
 * Family is INFERRED from the placed set, so a family's anchor module can
 * never be the thing that is missing: the moment it is absent the lane is no
 * longer of that family, and the surface asks a different question entirely.
 * `auto-center` anchors `dnlp` alone, so it is unreachable this way; the
 * collar has two anchors, so each can be missing while the other holds the
 * lane in the family.
 *
 * SINGLE OWNER of that reachability fact. Any catalog keyed by "the module
 * this lane still needs" — today `tips.FAMILY_COPY` — is dead copy for a key
 * outside this set, and `canvas.test.ts` fails when one appears.
 *
 * WIDENED by `laneFamilies` (§2a). The paragraph above describes a BOUND lane,
 * and it is still exactly right there. An UNBOUND lane — `{}` or
 * `{liquidity-source}` — has no family to infer from, so it can be offered any
 * family's own anchor, and pressing one is what BINDS the lane. That is how
 * `auto-center` acquires the add surface it never had, and why
 * `FAMILY_COPY["auto-center"]` (written, dead until now) comes into service.
 *
 * SIMPLIFIED 2026-08-22 by the OR-groups. The old body had two halves — the
 * unbound anchors, then the bound lane's own first gap — and the second half
 * has been provably empty since every required member became individually
 * offerable on an open lane: a bound lane's gap is a member of one of ITS
 * groups, and every group member is in this union. The union is the set, and
 * `canvas.test.ts` pins it against what a blank lane can actually take, so the
 * claim and `addableModules` cannot drift apart.
 */
export function familyAddSurfaceKeys(): ModuleKey[] {
  const out = new Set<ModuleKey>();
  for (const family of Object.keys(FAMILY_REQUIRED_GROUPS) as LaneFamily[]) {
    for (const group of FAMILY_REQUIRED_GROUPS[family]) {
      for (const key of group) out.add(key);
    }
  }
  return [...out];
}

/**
 * The capital spine: the lane's family chain, wired sequentially through
 * whichever chain modules are placed.
 *
 * ONE RULE FOR ALL THREE FAMILIES since 2026-08-22. The loop used to run a
 * hand-written three-clause version of the same walk, and it produced the same
 * edges on every composition the loop could then hold — but it had no answer
 * for `{source, hedge}`, which the deletion of `hedge-requires-safety-buffer`
 * makes a legal, publishable lane. Under the old clauses that lane wired
 * NOTHING, and `{source, hedge, auto-compound}` wired a dangling
 * `hedge → compound` with the market unattached.
 *
 * A module outside the chain is unwired here and reported as `family-mismatch`
 * by the validator; drawing a wire to it would be the second opinion.
 */
export function deriveEdges(nodes: ModuleNode[]): ModuleEdge[] {
  const byKey = new Map(nodes.map((n) => [n.data.defKey, n]));
  const chain = FAMILY_CHAINS[laneFamily(nodes)]
    .map((k) => byKey.get(k))
    .filter((n): n is ModuleNode => !!n);
  const edges: ModuleEdge[] = [];
  for (let i = 0; i < chain.length - 1; i++) {
    const a = chain[i];
    const b = chain[i + 1];
    edges.push({ id: `e:${a.id}->${b.id}`, source: a.id, target: b.id, data: { kind: "flow" } });
  }
  return edges;
}

/**
 * Snap a value onto its descriptor's grid.
 *
 * RECETTE A3: a free value rounds to NEAREST; a value clamped against a
 * safety ceiling FLOORS. Rounding to nearest and then taking `min(max, v)`
 * left the Max risk stop storing 4.25 against a 4.1667 house cap — the stored
 * param sat above the ceiling the invariant was written to defend, and the
 * invariant could never fire because it checked the already-clamped value.
 * Once the ceiling binds, the only honest landing spot is the last grid
 * position AT OR BELOW it.
 */
function clampNumeric(desc: ParamDescriptor, value: number): number {
  const lo = typeof desc.min === "number" ? desc.min : null;
  const hi = typeof desc.max === "number" ? desc.max : null;
  let v = value;
  if (lo !== null) v = Math.max(lo, v);
  if (hi !== null) v = Math.min(hi, v);
  if (typeof desc.step === "number" && desc.step > 0 && lo !== null) {
    const nearest = lo + Math.round((v - lo) / desc.step) * desc.step;
    if (hi !== null && nearest > hi + 1e-9) {
      // the ceiling binds: floor to the grid rather than round through it
      v = lo + Math.floor((hi - lo) / desc.step + 1e-9) * desc.step;
    } else {
      v = nearest;
    }
    if (hi !== null) v = Math.min(hi, v);
    if (lo !== null) v = Math.max(lo, v);
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

  /* THE FAMILY THIS LANE IS JUDGED AGAINST — `committedFamily`, not
     `laneFamily` (§2 M3, 2026-08-22).

     `laneFamily([])` is `"loop"`, so reading it here judged a lane that had
     said NOTHING against the loop's own chain and the loop's own
     prerequisites. Null means the lane is genuinely open: more than one family
     still survives everything it has expressed, and no clause below has
     anything to hold it to yet. */
  const bound = committedFamily(graph);

  /* THE `missing-source` DEMOTION (§2 M1, 2026-08-22).
     ------------------------------------------------
     A `missing-source` ISSUE used to be pushed here. `liquidity-source` is
     already in all three FAMILY_REQUIRED sets (`:81-85`), so the fact was
     already modelled in the `missing` channel; carrying it ALSO as a hard
     issue is what made "module placed, no market yet" INVALID rather than
     INCOMPLETE — which is the state every module-first composition passes
     through between the first press and the market pick.

     Nothing downstream loses safety, and each claim is pinned by a test in
     canvas.test.ts: `ok` is unchanged (`issues.length === 0 && missing.length
     === 0`), so such a lane still fails `graphOk`, still prints no APY,
     still fails `deriveReviewGate` on `hasMarket`, and still cannot publish.
     `validatePortfolio` on a portfolio holding one still returns ok:false.

     REJECTED (make every module drag `liquidity-source` in with it): it needs
     a second change to `RackCanvas.onAddModule`, which deliberately installs
     only the module it is handed, and it seats an empty source node carrying
     `candidateId: ""` that flows straight into `pricingParamsFor`. One press,
     two plates, one fabricated node. This is one deleted push. The chain
     mechanism it would have used is itself gone since 2026-08-22 — see the
     `impliedBy` tombstone below. */

  /* Cross-family modules never share a lane — ON A BOUND LANE. While more
     than one family survives there is no chain to fall outside of, and nothing
     placed can be orphaned by a later choice, so the check is SKIPPED rather
     than evaluated against a default. */
  if (bound) {
    const chainSet = new Set(FAMILY_CHAINS[bound]);
    for (const k of seen) {
      /* An OVERLAY belongs on every family and therefore collides with none.
         The clause exists to catch a module that would be ORPHANED by a later
         choice, and an overlay cannot be orphaned: it is wired to nothing. */
      if (OVERLAY_KEYS.has(k)) continue;
      if (!chainSet.has(k)) {
        issues.push({
          code: "family-mismatch",
          message: `${MODULE_DEFS[k].name} does not belong on a ${FAMILY_LABEL[bound]} lane`,
        });
      }
    }
  }

  /* DELETED 2026-08-22 (§2 M2, §5 rank 1): `hedge-requires-safety-buffer`.
     ---------------------------------------------------------------------
     It forced the builder to install the module that is a COST on 10 to 13 of
     the 15 depositable rows before it would let them install the module that is
     the YIELD on 13 of 13. The quant ledger's ruling was "do not steer, remove
     the obstruction". Its deletion is what makes `{liquidity-source, hedge}` at
     L = 1 — the funding carry — a composition the rack can build, and it is why
     the loop's required set became an OR-group.

     `compound-requires-safety-buffer` became `compound-requires-carry` in the
     same edit. The old rule was a loop rule wearing a general name: it named
     `safety-buffer`, which sits on exactly one of the three chains. The true
     rule is family-agnostic and holds on all four shapes — there must be
     something on the lane that earns, or there is nothing to compound. */
  if (
    seen.has("auto-compound") &&
    !(seen.has("liquidity-source") && CARRY_MODULES.some((k) => seen.has(k)))
  ) {
    issues.push({
      code: "compound-requires-carry",
      message: "Auto-compound needs a module on the lane that earns",
    });
  }

  /* THE WATCHER NEEDS A ROUTE, AND A ROUTE NEEDS A MARKET (2026-08-26), and
     this is what finally gives `missing-source` a producer.

     The whole module is a derivation over the lane's capital route: the chain
     the collateral sits on, the chain the short settles on, the crossings
     between them. With no market pinned there is no route, so the module would
     name NOTHING — an installed plate whose entire content is an empty set.
     That is the same shape `compound-requires-carry` refuses one module over,
     and it is refused the same way: as a REFUSAL, never as a chain that drags
     the market in behind the press.

     `missing-source` is reused rather than a new code minted, and it is not a
     revival of the old clause. That clause pushed the issue for EVERY lane
     without a source, which is what made "module placed, no market yet"
     invalid rather than incomplete — the state every module-first composition
     passes through. This fires for exactly one key, and `compose-options`
     already carries the sentence for it (`pick a market for this lane first.`),
     written and dead until now. */
  const marketPinned =
    String(graph.nodes.find((n) => n.data.defKey === "liquidity-source")?.data.params.candidateId ?? "") !== "";
  if (seen.has("exogenous-risk") && !marketPinned) {
    issues.push({
      code: "missing-source",
      message: "Exogenous risk needs a market on this lane before it can name anything",
    });
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

  /* THE MARKET'S OWN FAMILY (§5 rule 5, the one genuinely new refusal).
     Once a builder can compose a collar lane and THEN browse markets, they can
     attempt to pin a live Morpho row onto it, which `collarModel` cannot price
     — and the converse, a hand-authored LP row onto a loop lane, which the loop
     arithmetic must never touch (`isHandAuthored`). Family membership is a
     property of the ROW, so it is derived from the row's own hand-authored
     terms and never from its venue name (the E1 anti-pattern).

     Enforced TWICE, exactly as `family-mismatch` already is: the catalog does
     not offer the row (compose-options / DiscoverPanel, surface wave), and this
     clause so a restored draft or a copilot proposal cannot smuggle one in.

     `laneFamilies` is the lane side, so an UNBOUND lane accepts any row: the
     pin is itself an expression, and it narrows the lane rather than colliding
     with it. */
  const candidateId = String(srcNode?.data.params.candidateId ?? "");
  if (candidateId) {
    const marketFams = familiesForCandidateId(candidateId);
    const laneFams = laneFamilies(graph.nodes);
    if (laneFams.length > 0 && !laneFams.some((f) => marketFams.includes(f))) {
      issues.push({
        code: "market-family-mismatch",
        message: `${String(srcNode?.data.params.pairLabel ?? candidateId)} cannot be priced on a ${FAMILY_LABEL[laneFams[0]]} lane`,
      });
    }
  }

  const canonical = deriveEdges(graph.nodes);
  const got = new Set(graph.edges.map((e) => e.id));
  if (canonical.length !== graph.edges.length || canonical.some((e) => !got.has(e.id))) {
    issues.push({ code: "edges-not-canonical", message: "Wiring does not match the spine" });
  }

  /* ══ THE TWO REDUCTIONS, AND THE TRAP BETWEEN THEM ══════════════════════
     WHAT A SURFACE MAY OFFER AS REQUIRED IS THE **INTERSECTION** ACROSS
     SURVIVING FAMILIES; WHAT MAKES A LANE FINISHED IS THE **UNION**.
     ─────────────────────────────────────────────────────────────────────
     They meet here, and conflating them is how this file breaks in either
     direction. `addableModules`' `required` answers "what may this surface
     OFFER", where over-claiming a family is a copy defect: the intersection on
     an open lane is `["liquidity-source"]` and nothing else may be called
     required. `missing`/`missingAny` feed `ok`, and `ok` is the publish gate:
     under-claiming here MINTS A LAUNCH-SHAPED VAULT, so an open lane is held to
     everything any surviving family would demand.

     Take the intersection here and `{liquidity-source}` — a lane holding its
     market and NOT ONE strategy module — comes back `ok: true`, is counted by
     `validatePortfolio.launchShapedLoopIds`, satisfies `deriveReviewGate`'s
     `validationOk` with `hasMarket` genuinely true, and arms the review key on
     a vault that does nothing with a deposit. An exhaustive sweep of all 128
     module subsets puts the blast radius at exactly that composition, and it is
     the one every module-first build passes through.

     REWRITTEN 2026-08-22. The note that stood here instructed the next reader
     NOT to move this off `laneFamily`, because at the time the only alternative
     on offer was the intersection. The union is the third answer: it is
     strictly STRONGER than the loop default it replaces (it demands everything
     the loop demanded and everything the other two do), so it keeps the safety
     property whole while asserting no family at all. That is the whole trick —
     the honest answer to "not finished" was never a family, it was a union. */
  const survivors: LaneFamily[] = bound ? [bound] : committedFamilies(graph);
  const groups: ModuleKey[][] = [];
  const seenGroups = new Set<string>();
  for (const f of survivors) {
    for (const group of unsatisfiedGroups(FAMILY_REQUIRED_GROUPS[f], seen)) {
      const sig = group.join("|");
      if (seenGroups.has(sig)) continue;
      seenGroups.add(sig);
      groups.push(group);
    }
  }
  const missing = groups.filter((g) => g.length === 1).map((g) => g[0]);
  const missingAny = groups.filter((g) => g.length > 1);
  return {
    ok: issues.length === 0 && missing.length === 0 && missingAny.length === 0,
    issues,
    missing,
    missingAny,
  };
}

// ── Lane addability (recette C10, build item 15) ──────────────────────────
//
// ONE derivation of what a lane can take. Before this, the ghost slots on the
// rack and the dock's compose panel each had their own opinion, `auto-center`
// / `covered-call` / `protective-put` had no add surface at all (6 of the 10
// valid lane compositions were template-only), and the discovery panel was
// about to become a fourth. Family-addability is derived HERE and nowhere
// else.
//
// The method is the only honest one available: simulate the addition and ask
// `validateGraph` what it thinks. A refusal the validator would not make
// cannot be invented, and a refusal the validator WOULD make cannot be
// swallowed. Adding a module that drags a prerequisite in with it is
// evaluated together with that prerequisite, so the chain rides back out on
// the result and the add surface can say what else it installs.

export interface AddableModule {
  key: ModuleKey;
  /**
   * A member of an UNSATISFIED required group in EVERY surviving family: this
   * is what blocks launch, whichever product the lane turns out to be.
   *
   * The intersection, never the union — see the reductions note in
   * `validateGraph`. On an open lane it collapses to `liquidity-source`, which
   * is the one thing required family-independently; on a bound loop lane with
   * its market pinned it is `safety-buffer` AND `hedge`, because after the
   * OR-groups either one finishes the lane and naming only the first would be
   * the steering this wave deleted.
   */
  required: boolean;
  /**
   * Modules installed ALONGSIDE this one (the chain receipt).
   *
   * EMPTY ON EVERY LANE since 2026-08-22, and the field survives on purpose.
   * It mirrored the two loop prerequisites in `validateGraph` and nothing else;
   * both are gone (`hedge-requires-safety-buffer` deleted,
   * `compound-requires-carry` is a refusal rather than a chain), so there is no
   * prerequisite left to drag in. Inventing one here would be exactly the
   * second opinion this derivation exists to delete.
   */
  implies: ModuleKey[];
}

export interface BlockedModule {
  key: ModuleKey;
  /** The `validateGraph()` issue code the refusal mirrors, one-to-one. */
  code: ValidationIssue["code"];
}

/**
 * WHAT THE MARKET RULED OUT — the one argument through which a market's own
 * model reaches these graph derivations (THE GHOST BAY RULING, 2026-08-22).
 *
 * OPTIONAL, and its absence is the shipped behaviour byte for byte: a caller
 * with no market in hand (a cold catalog, a quote in flight, every existing
 * test) gets exactly the answer this file gave before the ruling. That is the
 * same three-valued discipline `leverage-module.ts` states for `unknown` —
 * absence of data is not evidence of anything.
 *
 * A `ModuleKey[]` crosses this seam, never a priced row: the arithmetic that
 * produces it has ONE owner (`leverage-module.dominatedModules`), the graph
 * layer stays free of the pricing layer, and there is no import cycle to
 * reason about.
 */
export interface LaneMarket {
  /**
   * Modules this lane's market has measured as DOMINATED — every setting they
   * offer here is beaten on all three declared axes at once, so under L1 they
   * are not instruments on this market.
   *
   * ⚠ THIS IS NOT A LEGALITY CLAIM. `validateGraph` still takes them, the dock
   * shelf still offers them priced, and a lane already holding one still draws
   * its plate. It says only that no surface may PROPOSE them here.
   */
  dominated?: readonly ModuleKey[];
}

export interface LaneAddability {
  /** `laneFamily()` — TOTAL, and unchanged. Every existing consumer reads this. */
  family: LaneFamily;
  /**
   * The families still consistent with everything the lane has EXPRESSED —
   * its module set and the market it pinned.
   *
   * ADDED beside `family`, never in place of it, so no existing consumer
   * changes. Length > 1 means the lane has not asserted a strategy yet: a
   * surface reading this knows to offer one anchor per surviving family rather
   * than one family's chain. Length 1 is the shipped case and behaves exactly
   * as it always did. Length 0 cannot occur — an impossible composition falls
   * back to the module set, which the validator is already flagging.
   */
  families: LaneFamily[];
  addable: AddableModule[];
  blocked: BlockedModule[];
  /** Placed on the lane already. */
  installed: ModuleKey[];
  /**
   * The market's own ruling, carried through verbatim so the surfaces that
   * arrange this answer in space (`rackItems`) read it from the one derivation
   * instead of taking a second argument and forming a second opinion. Empty
   * whenever no market context was passed.
   */
  dominated: ModuleKey[];
}

type LaneShape = Pick<LoopGraph, "id" | "nodes">;

/** A throwaway node set carrying `keys` as well, wired canonically. */
function simulateAdd(loop: LaneShape, keys: ModuleKey[]): { nodes: ModuleNode[]; edges: ModuleEdge[] } {
  let nodes = loop.nodes;
  for (const key of keys) {
    if (nodes.some((n) => n.data.defKey === key)) continue;
    nodes = [
      ...nodes,
      {
        id: nodeId(loop.id, key),
        type: "priimeModule",
        position: { x: 0, y: 0 },
        data: { defKey: key, params: defaultParams(key) },
      },
    ];
  }
  return { nodes, edges: deriveEdges(nodes) };
}

/* DELETED 2026-08-22 (§2 M2): `impliedBy`. It answered "what does the loop
   spine need in place before `key` can sit on it", and mirrored the two
   `family === "loop"` prerequisites in `validateGraph`. Both are gone —
   `hedge-requires-safety-buffer` was deleted outright, and
   `compound-requires-carry` is a REFUSAL rather than a chain (§3C: the module
   is "available after", it does not silently drag its prerequisite in). With
   nothing left to mirror the function could only invent a prerequisite, which
   is the second opinion this whole derivation exists to delete.

   What it bought was one line of copy, `adds dynamic leverage too`, on a press
   that seated two plates. It also made the funding carry unbuildable
   market-first: on a lane with a market and no leverage, `Add dynamic hedge`
   installed the borrow leg the shape exists to delete.

   HANDOFF: `RackCanvas.composeAdd` and its `add-hedge` tip action each hold
   their OWN copy of that chain rule (`needsChain`, and a second `installDefaults`
   branch), neither of which ever read `implies`. They must install exactly the
   module they are handed, from `addable[].implies`. */

/** Issue codes carried right now, as a multiset. */
function issueCodesOf(shape: { nodes: ModuleNode[]; edges: ModuleEdge[] }): ValidationIssue["code"][] {
  return validateGraph(shape).issues.map((i) => i.code);
}

/** Codes `after` carries that `before` did not (multiset difference). */
function freshCodes(
  before: ValidationIssue["code"][],
  after: ValidationIssue["code"][],
): ValidationIssue["code"][] {
  const left = [...before];
  const out: ValidationIssue["code"][] = [];
  for (const c of after) {
    const i = left.indexOf(c);
    if (i >= 0) left.splice(i, 1);
    else out.push(c);
  }
  return out;
}

/**
 * Every module this lane can take, every module it refuses, and why.
 *
 * The ghost slots, the dock's compose panel and the discovery panel all read
 * this. A module absent from `addable` has no add surface, by construction.
 */
export function addableModules(loop: LaneShape, market?: LaneMarket): LaneAddability {
  const family = laneFamily(loop.nodes);
  const families = committedFamilies(loop);
  /* The lane's family ONCE its MODULES have one. Null while more than one
     survives, and that null is what opens the blank canvas. Module-only, on
     purpose: see `committedFamilies`. */
  const gate = boundFamily(loop.nodes);
  /* REQUIRED IS THE INTERSECTION (§2 M3, over the OR-groups since 2026-08-22).
     Reading `FAMILY_REQUIRED["loop"]` on a blank lane marks `safety-buffer`
     required while `auto-center` and `covered-call` are merely optional, which
     the compose panel's band sort then hoists to the top — market-first wearing
     a new hat. The intersection on a blank lane is exactly
     `["liquidity-source"]`, which is the one thing required
     family-independently.

     A key counts for a family when it is a member of one of that family's
     UNSATISFIED groups, so a requirement stops being required the moment ANY of
     its members is seated: on `{liquidity-source, hedge}` the loop's
     `[safety-buffer, hedge]` group is closed and neither key is called required
     again. The opposite reduction — the union — belongs to `missing`, and the
     note in `validateGraph` is where the two are held apart. */
  const placed = new Set(loop.nodes.map((n) => n.data.defKey));
  /* THE OR-GROUP IS RE-READ ONCE A MEMBER IS UNREACHABLE (THE GHOST BAY
     RULING, 2026-08-22).

     `required` means "this is what blocks launch, whichever product the lane
     turns out to be". On a loop lane the group is `[safety-buffer, hedge]` and
     BOTH members carry that flag, because either one finishes the lane. Where
     the market has ruled the leverage module dominated, that sentence stops
     being true of it: the lane launches without it, and the thing that
     actually blocks launch is the one member still standing.

     So a dominated member leaves the group before the intersection is taken.
     Two consequences, both intended:

       • the surviving member becomes a SINGLETON requirement, which is what
         `rackItems` reads to decide the hedge is a POSITION here rather than a
         CHOICE — the founder's "the hedge never self-proposes" ruling governs a
         choice between two ways to finish, and once one way is unreachable
         there is no choice left to steer;
       • the dominated member's own `required` goes FALSE, so the dock shelf
         stops printing "required to launch a loop lane" beside a module the
         lane demonstrably launches without.

     A group EVERY member of which is dominated collapses to nothing and marks
     no key required. That is the honest reading — it is a lane with no way
     forward, not a lane with a hidden way forward — and it is reached on
     exactly the rows THE HOLDING RULE in `leverage-module.ts` already names.

     `validateGraph` is deliberately NOT re-read this way: it answers a question
     about a GRAPH and holds no market, and launchability is its call, not this
     derivation's. */
  const dominated = new Set(market?.dominated ?? []);
  const requiredSets = (families.length > 0 ? families : [family]).map(
    (f) =>
      new Set(
        unsatisfiedGroups(FAMILY_REQUIRED_GROUPS[f], placed)
          .map((group) => group.filter((k) => !dominated.has(k)))
          .flat(),
      ),
  );
  const isRequired = (key: ModuleKey) => requiredSets.every((s) => s.has(key));
  const before = issueCodesOf({ nodes: loop.nodes, edges: deriveEdges(loop.nodes) });

  const installed: ModuleKey[] = [];
  const addable: AddableModule[] = [];
  const blocked: BlockedModule[] = [];

  for (const key of DISPLAY_ORDER) {
    if (nodeFor(loop, key)) {
      installed.push(key);
      continue;
    }
    /* THE FAMILY GATE, and it must run BEFORE the simulation. Verified live
       on the build canvas 2026-08-22.

       `laneFamily()` is DERIVED from the placed module set, so on a lane that
       holds only its liquidity source, adding auto-center simply FLIPS the
       family to "dnlp" and the simulation raises nothing at all — the compose
       panel duly offered `Add auto center`, `Add covered call` and `Add
       protective put` on a loop lane. One module later the identical click
       becomes a self-destruct: the installed leverage plate falls outside the
       dnlp chain, `family-mismatch` fires, and the lane is unpublishable
       while still printing a confident APY (only
       `unhedged-class-forbids-hedge` blanks the number).

       A module outside this lane's own chain is REFUSED, never offered.

       CONDITIONAL SINCE 2026-08-22 (§2 M2). The gate runs on a BOUND lane and
       is therefore preserved exactly where it was load-bearing: the T6
       self-destruct it describes is a lane ALREADY HOLDING `safety-buffer`
       being offered `auto-center`, and that lane is bound
       (`laneFamilies` = ["loop"]), so this fires unchanged. It is skipped only
       on `{}` and `{liquidity-source}`, where flipping the family orphans
       nothing because there is nothing to orphan. */
    if (gate && !OVERLAY_KEYS.has(key) && !FAMILY_CHAINS[gate].includes(key)) {
      blocked.push({ key, code: "family-mismatch" });
      continue;
    }
    // Exactly the module the press seats — there are no prerequisites left to
    // drag in (see the `impliedBy` tombstone above).
    const fresh = freshCodes(before, issueCodesOf(simulateAdd(loop, [key])));
    if (fresh.length > 0) {
      blocked.push({ key, code: fresh[0] });
      continue;
    }
    addable.push({ key, required: isRequired(key), implies: [] });
  }

  return { family, families, addable, blocked, installed, dominated: [...dominated] };
}

/** Can this lane take this module right now? The ghost slot's whole question. */
export function canAddModule(loop: LaneShape, key: ModuleKey): boolean {
  return addableModules(loop).addable.some((a) => a.key === key);
}

// ── The rail's steps (§4C) ────────────────────────────────────────────────

export type LaneStepKey = "market" | "strategy" | "publish" | ModuleKey;

export interface LaneStep {
  key: LaneStepKey;
  /** ≤ 10 characters — the rail's hard budget at Fraunces 7.5 (§7A). */
  label: string;
  /**
   * The step's own fact is in place: the market is pinned, the module is
   * seated. Always false for `publish`, which only the review gate can answer,
   * and for `strategy`, which is a placeholder for a choice not yet made.
   */
  placed: boolean;
}

/** The rail's word for each module. One owner; the labels are the abbreviations
 *  the 10-character budget forces, not the module names. */
const STEP_LABEL: Record<ModuleKey, string> = {
  "liquidity-source": "Market",
  "safety-buffer": "Leverage",
  hedge: "Hedge",
  "auto-center": "Range",
  "covered-call": "Call",
  "protective-put": "Put",
  "auto-compound": "Compound",
  /* 4 characters. REACHABLE, unlike the overlay below: `redemption-route` is
     on the treasury chain, so the rail draws Market / Exit / Compound. */
  "redemption-route": "Exit",
  /* UNREACHABLE, and required by the Record: `laneSteps` walks
     `FAMILY_CHAINS[bound]`, and an overlay is on no chain, so it earns no rail
     segment. The rail names the STEPS a lane's capital takes; a watcher is not
     one of them. */
  "exogenous-risk": "Exogenous",
};

/**
 * The steps this lane actually has, from what it has committed to.
 *
 * REPLACES the hardcoded `Market / Leverage / Compound / Publish` literal and
 * the three `lane.family` branches in `RackCanvas.railSteps`, which were a
 * second opinion about the family chains this file owns — and which printed the
 * LOOP chain on a lane that had chosen nothing, naming a strategy the builder
 * had not picked before they had picked anything at all.
 *
 * An UNBOUND lane has three steps and no family word: `Market`, `Strategy`,
 * `Publish`. Two of them are genuinely open, which is the honest reading of a
 * blank lane; `Strategy` is the placeholder for whichever anchor group the
 * lane eventually satisfies, and it is already the product's own word
 * (`strategy: StrategyKind`, `?strategy=funding`).
 *
 * A BOUND lane earns a segment per chain module that is either seated or is the
 * first member of an unsatisfied requirement — so the shipped hedge rule ("the
 * hedge is opt-in: it earns a segment only once placed") generalises instead of
 * being spelled out per family. Two consequences worth naming: a dn-LP lane now
 * shows `Hedge` before it is placed, because the hedge is required there; and a
 * funding carry (`{market, hedge}` at L = 1) shows no `Leverage` segment at all,
 * because its anchor group is closed and there is no borrow leg to name.
 *
 * The caller owns the STATE (`done` / `now` / `todo`): `placed` is the only
 * fact this file can prove, and whether `Publish` is reachable is the review
 * gate's question, not the graph's.
 */
export function laneSteps(loop: Pick<LoopGraph, "nodes">, marketCtx?: LaneMarket): LaneStep[] {
  const placed = new Set(loop.nodes.map((n) => n.data.defKey));
  const hasMarket =
    String(nodeFor(loop, "liquidity-source")?.data.params.candidateId ?? "") !== "";
  const market: LaneStep = { key: "market", label: "Market", placed: hasMarket };
  const publish: LaneStep = { key: "publish", label: "Publish", placed: false };

  const bound = committedFamily(loop);
  if (!bound) return [market, { key: "strategy", label: "Strategy", placed: false }, publish];

  /* THE SAME RE-READ THE RACK MAKES (THE GHOST BAY RULING, 2026-08-22), and
     it is here for P0-5's reason: the rail and the rack must not describe one
     lane differently. Without it a market whose leverage module the model has
     ruled out drew `Dynamic hedge` on the rack while the rail named
     `Leverage` — the exact disagreement P0-5 exists to prevent, and the rail
     would have been naming a module the lane cannot be offered. A group with
     no member left names no step, which is the honest reading of a lane with
     no way forward. */
  const dominated = new Set(marketCtx?.dominated ?? []);
  const unmet = unsatisfiedGroups(FAMILY_REQUIRED_GROUPS[bound], placed)
    .map((group) => group.filter((k) => !dominated.has(k)))
    .filter((group) => group.length > 0);
  const steps: LaneStep[] = [market];
  for (const key of FAMILY_CHAINS[bound]) {
    if (key === "liquidity-source") continue; // the market IS that step
    const seated = placed.has(key);
    // The first member of an unsatisfied group represents that requirement;
    // its alternatives stay off the rail so one requirement is one segment.
    const representsAGap = unmet.some((group) => group[0] === key);
    // `auto-compound` closes every chain and is always the last thing offered.
    if (seated || representsAGap || key === "auto-compound") {
      steps.push({ key, label: STEP_LABEL[key], placed: seated });
    }
  }
  steps.push(publish);
  return steps;
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
  /* `Lane ${n}`, not `Loop ${n}` (§3A). "Lane" is already the product's own
     word in seven files (`.rk-lane`, `Add a lane`, `laneCapacityUsd`,
     `LaneFamily`, …); the label was the single surface that named the lane a
     loop before it held one module, and it survives every binding without
     becoming false. It never auto-renames: the field is a user-editable input,
     and `renameLoop` — which templates use — is the only place the system names
     a lane. */
  const loops = restampPositions([...p.loops, { id, label: `Lane ${n}`, nodes: [], edges: [] }]);
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
  const next = f(p.loops[i], i);
  if (next === p.loops[i]) return p; // rejected mutation: keep referential identity
  const loops = [...p.loops];
  loops[i] = next;
  return { ...p, loops };
}

/** Add a module to a loop (one instance per kind per loop). `ctx` narrows the
 *  installed defaults to the lane's market — a hedge installed on a coin whose
 *  admissible max is 2.5x must not open at the structural default of 3 (A12). */
export function addModule(
  p: PortfolioGraph,
  loopId: LoopId,
  key: ModuleKey,
  ctx?: ParamContext,
): PortfolioGraph {
  return mapLoop(p, loopId, (loop, laneIndex) => {
    if (nodeFor(loop, key)) return loop;
    const node: ModuleNode = {
      id: nodeId(loopId, key),
      type: "priimeModule",
      position: positionFor(laneIndex, key),
      data: { defKey: key, params: defaultParams(key, ctx) },
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
 *
 * `ctx` narrows the descriptor to the lane's market (modules.descriptorsFor).
 * Without it the STRUCTURAL envelope clamps, which is the widest bound any
 * market could justify — correct, but looser than the picked market's own
 * ceiling. Every caller that knows the market should pass it.
 */
export function updateParam(
  p: PortfolioGraph,
  loopId: LoopId,
  key: ModuleKey,
  field: string,
  value: ParamValue,
  ctx?: ParamContext,
): PortfolioGraph {
  return mapLoop(p, loopId, (loop) => {
    const node = nodeFor(loop, key);
    if (!node) return loop;
    const next = clampAgainst(descriptorsFor(key, ctx), field, value);
    if (next === null) return loop;
    const nodes = loop.nodes.map((n) =>
      n.id === node.id ? { ...n, data: { ...n.data, params: { ...n.data.params, [field]: next } } } : n,
    );
    return { ...loop, nodes };
  });
}

/**
 * Re-clamp every stored param on a lane against the market it is pinned to
 * now (recette A6).
 *
 * A market swap on a lane whose dial position was hand-tuned used to skip the
 * re-derivation, and the clamp rode along with it: a leverage picked against
 * an Aave e-mode row survived the swap onto Dolomite and went into the publish
 * record above the new market's house cap. The clamp belongs to the market,
 * not to the control's position, so it must run on every swap.
 *
 * Values already inside the new bounds are untouched, and a lane with nothing
 * to move keeps referential identity so no downstream memo churns.
 *
 * ⚠ IT HAD NO PRODUCTION CALLER UNTIL 2026-09-02 (recette v2, PO-3). The
 * function was correct and the docstring above described a live defect the
 * product still had: `onSelectMarket` wrote the five swap fields and
 * re-derived the leverage alone, so a hedge leverage tuned to an ETH book's
 * ceiling of 5x survived a swap onto a book whose ceiling is 2.5x and
 * published at 5. `seatMarket` below is the caller, and it is now the ONLY
 * way the canvas seats a market.
 */
export function reclampLoopParams(p: PortfolioGraph, loopId: LoopId, ctx: ParamContext): PortfolioGraph {
  return mapLoop(p, loopId, (loop) => {
    let anyMoved = false;
    const nodes = loop.nodes.map((n) => {
      const descs = descriptorsFor(n.data.defKey, ctx);
      const params: Record<string, ParamValue> = { ...n.data.params };
      let nodeMoved = false;
      for (const [field, value] of Object.entries(n.data.params)) {
        const next = clampAgainst(descs, field, value);
        if (next === null || next === value) continue;
        params[field] = next;
        nodeMoved = true;
      }
      if (!nodeMoved) return n;
      anyMoved = true;
      return { ...n, data: { ...n.data, params } };
    });
    return anyMoved ? { ...loop, nodes } : loop;
  });
}

/**
 * The modules the SEATED MARKET rules out (recette v2, PO-1, 2026-09-02).
 *
 * A market is an expression (see `committedFamilies`), and swapping one under
 * a lane can contradict a module the lane already holds. The shipped case:
 * swap a levered loop onto a Hyperliquid funding row. `laneStrategies` then
 * survives nothing — the funding-class market rules the levered loop out, and
 * the placed `safety-buffer` rules the funding carry out — and
 * `committedStrategy`'s zero-survivor fallback answers `laneFamily`, i.e.
 * "loop". The vault published `strategy: 'loop'` on a debt-less book, with
 * three health-factor bands for a debt that does not exist and an
 * "Also installed — Dynamic leverage … before it reaches the liquidation
 * band" block on a lane that has no liquidation band.
 *
 * ⚠ NO SECOND SPELLING OF THE RULE. This does not know that a funding market
 * excludes the leverage module; it asks `laneStrategies` — the single owner of
 * that fact — whether the composition survives, and if it does not, which
 * removal restores it. A rule added there is enforced here for free, and the
 * two can never disagree about what a market rules out.
 *
 * Returns [] for the ordinary swap, where the seated market contradicts
 * nothing. Never removes the source: the source IS the market.
 */
export function modulesRuledOutByMarket(loop: Pick<LoopGraph, "nodes"> | null | undefined): ModuleKey[] {
  if (!loop) return [];
  if (!nodeFor(loop, "liquidity-source")?.data.params.candidateId) return [];
  const out: ModuleKey[] = [];
  let probe: Pick<LoopGraph, "nodes"> = loop;
  // DISPLAY_ORDER, so the same contradiction always resolves the same way.
  const placed = DISPLAY_ORDER.filter(
    (k) => k !== "liquidity-source" && loop.nodes.some((n) => n.data.defKey === k),
  );
  for (const key of placed) {
    if (laneStrategies(probe).length > 0) break;
    const without = { nodes: probe.nodes.filter((n) => n.data.defKey !== key) };
    if (laneStrategies(without).length <= laneStrategies(probe).length) continue;
    out.push(key);
    probe = without;
  }
  return out;
}

/**
 * SEAT A MARKET ON A LANE — the one path a market pick or a market swap takes
 * (recette v2, PO-1 + PO-3, 2026-09-02).
 *
 * `onSelectMarket` used to write the five identity fields with `updateParam`
 * and stop, so a swap moved the MARKET and left everything the market decides
 * standing:
 *
 *   · the dials kept their old book's positions and their old book's clamp
 *     (PO-3 — `reclampLoopParams` existed for exactly this and was dead), so a
 *     hedge leverage of 5x rode from a maxLev-25 book onto a maxLev-3 one
 *     and published above the new venue's own ceiling; and
 *   · the strategy kept its old word (PO-1), so a funding carry published as a
 *     Leveraged loop with health-factor bands for a debt it does not have.
 *
 * Both are the same defect: the lane's MARKET moved and the things derived
 * from the market did not. So the write is one operation, and the order is the
 * dependency order — seat, then re-derive what the market rules out, then
 * re-clamp what it bounds, then land the leverage on the new book's own
 * default.
 *
 * `ctxOf` rather than an imported `paramContextForLoop`: the context is
 * `pricing-params` + `mock-quote` + the live payload, and this module is the
 * pure graph layer that all three sit above. The caller (the canvas reducer)
 * already holds both. It is called AFTER each write, never once before, so the
 * bounds every step enforces are the bounds of the market actually seated.
 *
 * `landing` is the leverage the new market's own threshold and scanned ceiling
 * put the dial on; it is asked only when `safety-buffer` survived the seat, and
 * its answer is clamped like any other write.
 */
export function seatMarket(
  p: PortfolioGraph,
  loopId: LoopId,
  fields: Record<string, ParamValue>,
  ctxOf: (loop: LoopGraph) => ParamContext,
  landing?: (loop: LoopGraph) => number | null,
): PortfolioGraph {
  if (!loopById(p, loopId)) return p;
  let next = nodeFor(loopById(p, loopId)!, "liquidity-source")
    ? p
    : addModule(p, loopId, "liquidity-source", ctxOf(loopById(p, loopId)!));
  for (const [field, value] of Object.entries(fields)) {
    const loop = loopById(next, loopId);
    if (!loop) return next;
    next = updateParam(next, loopId, "liquidity-source", field, value, ctxOf(loop));
  }
  for (const key of modulesRuledOutByMarket(loopById(next, loopId))) {
    next = removeModule(next, loopId, key);
  }
  const seated = loopById(next, loopId);
  if (!seated) return next;
  const ctx = ctxOf(seated);
  next = reclampLoopParams(next, loopId, ctx);
  const clamped = loopById(next, loopId);
  if (!clamped || !nodeFor(clamped, "safety-buffer") || !landing) return next;
  const target = landing(clamped);
  if (target === null || !Number.isFinite(target)) return next;
  return updateParam(next, loopId, "safety-buffer", "targetLeverage", target, ctxOf(clamped));
}

// ── Orchestrator ops ──────────────────────────────────────────────────────
//
// DELETED 2026-08-22 (recette K2): `setOrchestratorEnabled`. It had no caller
// and could not have had a useful one — `withOrchestratorRule` re-derives
// `enabled` from the loop count on every lane mutation, so any hand-set value
// survived only until the next add/remove. The auto-rule is the sole owner of
// that flag; there is nothing for a user to toggle.

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
  for (const l of p.loops) allocationsBps[l.id] = l.id === loopId ? clamped : normalizedOthers[l.id];
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
    const v = allocationsBps[l.id];
    if (!Number.isInteger(v) || v < 0) return p;
    sum += v;
  }
  if (sum !== 10000) return p;
  const ordered: Record<LoopId, number> = {};
  for (const l of p.loops) ordered[l.id] = allocationsBps[l.id];
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
    out[ids[i]] = floors[i] + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
  }
  return out;
}

// DELETED 2026-08-22 (recette K2): `deriveOrchestratorEdges`. It emitted a
// second, parallel description of the orchestrator wires — one held here as
// `ModuleEdge`s with `kind: "alloc"`, one measured from the DOM by RackCanvas'
// `OrchWires`, which is what actually renders. Nothing but a test read this
// one. The `"alloc"` edge kind went with it (types.ts), so `ModuleEdge` again
// describes exactly one thing: the capital spine.

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
