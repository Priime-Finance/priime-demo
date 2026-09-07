"use client";

/* eslint-disable @typescript-eslint/consistent-type-definitions, @typescript-eslint/no-floating-promises, @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/non-nullable-type-assertion-style, @typescript-eslint/prefer-optional-chain, @typescript-eslint/restrict-template-expressions, react-hooks/exhaustive-deps --
 * Kit-verbatim file, ported from build.priime.finance eb6d33a. The rules
 * above are the kit's own idiom (untyped fetch/localStorage JSON, loose
 * equality on sentinel values, the hook dependency lists it ships with);
 * not rewriting kit logic to satisfy lint, per the integration's own
 * directive. */
/**
 * RackCanvas (UX_SPEC §0-§4 + UX_ITERATION_3 + UX_ITERATION_4) — the v2
 * composition surface: a hardware rack. One lane per loop, plates are the
 * EXACT landing hm-hw modules, wires are SVG overlays, the canvas always
 * proposes the next action as a ghost slot. No ReactFlow: lanes are CSS flex
 * rows inside a CSS-transform pan/zoom viewport (translate+scale, clamped
 * [0.4, 1.25]); the graph model (PortfolioGraph + pure graph-ops) is
 * unchanged.
 *
 * Iteration 4 (IT4_DOCK_SPEC + IT4_COPILOT_SPEC): the three-column
 * workstation. Left: the REAL AI copilot panel (never auto-opens, never
 * mutates the canvas — APPLY replays proposals through this reducer).
 * Right: the context dock — Discover (the retired MarketTakeover content),
 * Module (mirrored PlateControls, one store), Compose (the lane's leverage
 * stops, its modules and what each is worth), Portfolio (allocations,
 * orchestrator dials + derived-rules decode; RuleTakeover
 * absorbed). Dock mode is a PURE DERIVATION of focus + discoverTarget
 * (lib/canvas/dock-state.ts) — the dock is never empty. No takeover ever
 * mounts.
 *
 * Owns: portfolio reducer, draft persistence (KV + localStorage), per-lane
 * debounced reprice (350ms), focus (module/orchestrator/lane), stage
 * derivation, the lifted opportunities fetch, review, panel collapse/sheet
 * state.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useLayoutEffect } from "react";
import { useAccount } from "@/lib/wallet";
import { COMING_SOON, DEMO_SCOPE, isLiveMarket } from "@/lib/demo-scope";

import type { LoopGraph, LoopId, ModuleKey, ParamValue, PortfolioGraph } from "@/lib/canvas/types";
import type { StrategyKind } from "@/lib/vaults/store";
/* THE ONE ROUNDING from published bps to a printed health factor. It lives in
   `lib/vaults/store.ts` beside `deriveLeverageZones`, which is the rule every
   published record has always used; the canvas imports it rather than holding
   a second one. See `healthBandsRow` below for what the second one cost. */
import { hfFromBps } from "@/lib/vaults/store";
import {
  addLoop,
  addModule,
  addableModules,
  committedStrategy,
  emptyPortfolio,
  FAMILY_LABEL,
  laneFamily,
  laneSteps,
  loopById,
  nodeFor,
  OVERLAY_KEYS,
  removeLoop,
  removeModule,
  renameLoop,
  seatMarket,
  setAllocation,
  setAllocations,
  updateOrchestratorParam,
  updateParam,
  validateGraph,
  validatePortfolio,
} from "@/lib/canvas/graph-ops";
import { newLoopId, nodeId } from "@/lib/canvas/ids";
import { fromDraft, toDraft } from "@/lib/canvas/serialize";
import { HOUSE_FLOOR_APR, isTemplateVenue, type ProjectedCandidate } from "@/lib/canvas/opportunities";
import {
  classifyRepriceFailure,
  invalidatesQuote,
  laneDisplayApy,
  type RepriceFailureKind,
} from "@/lib/canvas/reprice-state";
import { catalogRow, laneQuote, mockQuote, publishedNetApy, type CatalogHit } from "@/lib/canvas/mock-quote";
import { reconcileHedgeFunding } from "@/lib/canvas/perp-books";
import { hedgeEconomics } from "@/lib/canvas/hedge-econ";
import { ARROW, MATERIAL_DELTA, MINUS, lev, pct, usd } from "@/lib/canvas/format";
import { pricingParamsFor, publishedModelRecord, type LanePricingParams } from "@/lib/canvas/pricing-params";
import { deriveReviewGate } from "@/lib/canvas/review-gating";
import {
  acceptsDeposits,
  capacityBindingSentence,
  fmtCapacityUsd,
  isModeledBinding,
  vaultCapacity,
} from "@/lib/canvas/capacity";
import {
  buildTemplatePortfolio,
  collarForfeit,
  collarForfeitLine,
  collarForfeitValue,
  templateById,
  templateCatalogHit,
} from "@/lib/canvas/templates";
import { defaultInstallChain, dominatedModules, verdictRow } from "@/lib/canvas/leverage-module";
import { leverageBayTriple } from "@/lib/canvas/leverage-bay";
import { APPLIED_LEVERAGE_LABEL, chainLabel, NO_BORROW_BANDS_VALUE, venueLabel } from "@/lib/canvas/labels";
import { DISPLAY_ORDER, defaultValueFor, getDef, type ParamContext } from "@/lib/canvas/modules";
/* D3 (2026-08-24): `paramContextFor` moved to lib. The dial's ATTRIBUTE and
   the dial's CLAMP must be one reading of one bound, so the controls need the
   same narrowing argument the reducer clamps with — and a pure derivation over
   the graph cannot be shared from inside a client component. */
import { paramContextFor, paramContextForLoop } from "@/lib/canvas/param-context";
import {
  breakevenStopFor,
  landingLeverage,
  laneLeverageStops,
} from "@/lib/canvas/leverage-stops";
import {
  HF_TARGET_CAP_BPS,
  PRODUCT_MIN_LEVERAGE,
  type HfBands,
  type RiskPreset,
} from "@/lib/canvas/param-schema";
import {
  deriveDockMode,
  dockRailLabel,
  dockScopeLoopId,
  firstMarketlessLoopId,
  laneAfterRemoval,
  laneStep,
  midBuildLoopId,
  type DiscoverTarget,
  type Focus,
} from "@/lib/canvas/dock-state";
import { isBoardVoid } from "@/lib/canvas/hit";
import {
  orchestratorBusWires,
  resolveInverse,
  type BusTarget,
  type BusWire,
} from "@/lib/canvas/wire-geometry";
import { buildPortfolioFromProposal } from "@/lib/canvas/copilot/apply";
import { buildDemoProposal } from "@/lib/canvas/demo-seed";
import { computeFit, FIT_MIN_SCALE_MOBILE } from "@/lib/canvas/fit";
import type { Tip, TipContext } from "@/lib/canvas/tips";
import type { ProposalPayload } from "@/lib/canvas/copilot/tools";
import Lane from "./Lane";
import TipDart, { type DartShot } from "./TipDart";
import OrchestratorPlate, { type LaneSignal } from "./OrchestratorPlate";
import ProgressRail, { type RailState } from "./ProgressRail";
import TipStack from "./TipStack";
import {
  TIP_GUTTER,
  TIP_PILL_BELOW,
  useTips,
  usePrefersReducedMotion,
  type TipQuiet,
  type TipUndoSnapshot,
} from "./useTips";
import PublishFlow, { type PublishDraft } from "./PublishFlow";
import ContextDock from "./dock/ContextDock";
import { composedRoute, type DockLaneView } from "./dock/LanePanel";
/* The router's own derivations, imported rather than restated: the slots the
   validator sees (`slotsFromPortfolio`), the dials it clamps
   (`dialsFromParams`) and the honest per-lane plate signals
   (`deriveLaneSignals`, whose two most useful fields were hard-coded here). */
import { deriveLaneSignals, dialsFromParams, slotsFromPortfolio } from "@/lib/canvas/orchestrator";
import CopilotPanel from "./CopilotPanel";
import {
  discoverAbsence,
  modeledRows,
  reconcileSharedCapacity,
  type UnifiedRow,
} from "@/lib/canvas/unified-list";
import { fundingPublishView, railVerdictFor } from "@/lib/canvas/funding-launch";
import { subscribeOpportunities } from "@/lib/canvas/opportunities-client";
import type { OpportunitiesPayload, RepriceData } from "./types";

const LS_V2 = "priime:canvas:draft:v2";
const LS_V1 = "priime:canvas:draft:v1";
const LS_PANELS = "priime:canvas:panels:v1";

/** Re-exported from the one owner (`labels.ts`) so existing importers and the
 *  cross-file parity pin keep their entry point while the STRING has a single
 *  declaration in the tree. */
export { NO_BORROW_BANDS_VALUE };

/**
 * THE `Health bands` PARAMETER ROW, AS THE RECORD PUBLISHES IT.
 *
 * Two defects lived on this one line, and both were fabrications rather than
 * formatting slips.
 *
 * 1. A SECOND ROUNDING. The canvas held a private
 *    `(bps / 10_000).toFixed(2)`, which rounds a FLOAT. 13450 bps is exactly
 *    1.345, but the nearest double sits just below it, so `toFixed` printed
 *    `1.34` here while `deriveLeverageZones` — which rounds from the bps
 *    INTEGER, `Math.round(bps / 100) / 100` — printed `1.35` in the record's
 *    Protection envelope and in the Automations cascade. One published
 *    integer, two spellings, on one page. The rounding now has ONE owner
 *    (`hfFromBps`, store.ts) and this file imports it. Never write a second.
 *
 * 2. A SENTINEL PRINTED AS A MEASUREMENT. At L = 1 there is no borrow leg, so
 *    `hfTargetBpsFor` answers `HF_TARGET_CAP_BPS` (100000) — a deliberate cap
 *    that exists so the corner is REACHABLE, not a health factor anybody
 *    measured. Rendered, it published `10.00 target · 9.93 deleverage · 9.86
 *    floor` on an unlevered vault: three fabricated numbers describing a
 *    liquidation line that does not exist. The row now states the fact.
 *
 * Both conditions are tested, because either alone is sufficient: the cap is
 * what the pricing layer answers, and the applied leverage is what the user
 * set. A lane can arrive with one without the other (a record published
 * before the cap existed, or a leverage the model clamped after the bands
 * were derived), and neither may print a band.
 */
export function healthBandsRow(
  hf: HfBands,
  appliedLeverage: number | null,
): { label: string; value: string } {
  const noBorrowLeg =
    hf.hfTargetBps === HF_TARGET_CAP_BPS ||
    (appliedLeverage !== null && appliedLeverage <= PRODUCT_MIN_LEVERAGE + 1e-9);
  return {
    label: "Health bands",
    value: noBorrowLeg
      ? NO_BORROW_BANDS_VALUE
      : `${hfFromBps(hf.hfTargetBps)} target · ${hfFromBps(hf.hfDeleverageBps)} deleverage · ${hfFromBps(hf.hfFloorBps)} floor`,
  };
}

/** Canvas zoom clamp (UX_ITERATION_3 §2; max raised so the IT4C viewport
 *  fit cap of 1.35 on >=1800px screens is reachable by hand too).
 *
 *  THE MIN IS THE MOBILE FIT FLOOR (recette I3). At 0.4 the manual floor sat
 *  ABOVE the scale a 390px phone actually fits at (~0.28), so on the one
 *  device where zooming out matters most the `−` key was silently inert: it
 *  clamped to a scale the canvas was already past. The manual floor can
 *  never be tighter than the automatic one. */
const ZOOM_MIN = FIT_MIN_SCALE_MOBILE;
const ZOOM_MAX = 1.35;
/** Undo depth (recette I7). Five is the number of expensive actions a user
 *  gets through before they stop being able to name what they did — past
 *  that an undo stack is a time machine, not a correction. */
const UNDO_DEPTH = 5;
type UndoEntry = {
  portfolio: PortfolioGraph;
  /** What Cmd+Z would take back, in the receipt strip's own voice. */
  label: string;
};

type Action =
  | { type: "load"; portfolio: PortfolioGraph }
  | { type: "add-loop" }
  | { type: "remove-loop"; loopId: LoopId }
  | { type: "rename-loop"; loopId: LoopId; label: string }
  | { type: "add-module"; loopId: LoopId; key: ModuleKey; ctx?: ParamContext }
  | { type: "remove-module"; loopId: LoopId; key: ModuleKey }
  | {
      type: "param";
      loopId: LoopId;
      key: ModuleKey;
      field: string;
      value: ParamValue;
      ctx?: ParamContext;
    }
  /* ONE COMMIT PER MARKET SEAT (recette v2, PO-1 + PO-3, 2026-09-02).
     A swap used to be `add-module` + five `param` dispatches, every one of
     them clamped against the context `dispatch` built from `portfolioRef` —
     i.e. the market being swapped AWAY from, since the ref only advances on
     re-render. So the pick wrote the new market's identity under the old
     market's bounds and nothing re-derived afterwards. `seatMarket` does the
     whole seat in one reducer step and re-reads the context after every
     write; `opp` rides along because the context is a fact about the live
     payload, and this is a pure function of the graph plus that payload. */
  | {
      type: "seat-market";
      loopId: LoopId;
      fields: Record<string, ParamValue>;
      opp: OpportunitiesPayload | null;
      /** The leverage the NEW market puts the dial on, asked on the seated
       *  lane so the ceiling is derived from the row now under it. */
      landing?: (loop: LoopGraph) => number | null;
    }
  | { type: "orch-param"; field: string; value: ParamValue }
  | { type: "set-allocations"; allocationsBps: Record<LoopId, number> }
  | { type: "set-allocation"; loopId: LoopId; bps: number };

/* `paramContextFor` now lives in lib/canvas/param-context.ts, for the reason
   `pricingParamsFor` does: it is a pure derivation over the graph, and D3
   made it something two surfaces share rather than one reducer's private
   argument. The controls render their bounds from `descriptorsFor(key, ctx)`
   with THIS context, so the attribute a slider publishes and the clamp that
   snaps its value back are one reading of one bound. */

function reducer(p: PortfolioGraph, a: Action): PortfolioGraph {
  switch (a.type) {
    case "load":
      return a.portfolio;
    case "add-loop":
      return addLoop(p);
    case "remove-loop":
      return removeLoop(p, a.loopId);
    case "rename-loop":
      return renameLoop(p, a.loopId, a.label);
    case "add-module":
      return addModule(p, a.loopId, a.key, a.ctx);
    case "remove-module":
      return removeModule(p, a.loopId, a.key);
    case "param":
      return updateParam(p, a.loopId, a.key, a.field, a.value, a.ctx);
    case "seat-market":
      return seatMarket(
        p,
        a.loopId,
        a.fields,
        (loop) => paramContextForLoop(loop, a.opp),
        a.landing,
      );
    case "orch-param":
      return updateOrchestratorParam(p, a.field, a.value);
    case "set-allocations":
      return setAllocations(p, a.allocationsBps);
    case "set-allocation":
      // one lane's share; largest-remainder rebalances the rest to Σ=10000
      return setAllocation(p, a.loopId, a.bps);
  }
}

/**
 * WHAT A MARKET SEAT WOULD COST, AND THEREFORE WHETHER IT NEEDS A WAY BACK
 * (recette v2 G7, PO-1 follow-up, 2026-09-02).
 *
 * `seatMarket` re-derives the composition against the seated book, so a swap
 * can now EJECT a module the builder installed: a kHYPE loop holding
 * {liquidity-source, safety-buffer, hedge, auto-compound} swapped onto a
 * Hyperliquid funding row comes back without the leverage plate, because the
 * funding market rules it out. That re-derivation is right and is the whole
 * point of PO-1. What it turned `Swap market` into is a DESTRUCTIVE control —
 * and every other destructive control on this workstation has a way back:
 * `composeEject` pushes `ejected dynamic leverage`, `applyProposal` pushes
 * `loaded a blueprint`, `removeLoop` pushes `removed a loop`. The swap pushed
 * nothing, so a plate could leave the canvas with no key that brings it back.
 *
 * ⚠ NO SECOND SPELLING OF THE EJECTION RULE. This does not re-implement
 * `modulesRuledOutByMarket`; it runs the SEAT the reducer is about to run, on
 * the same graph with the same context, and reads which plates did not
 * survive. The two can never disagree about what a swap costs, and a rule
 * added to `laneStrategies` is named here for free.
 *
 * CONDITIONAL BY DESIGN. The undo stack is five deep, which is what a builder
 * can still name; an ordinary first pick and an ordinary lending-to-lending
 * swap eject nothing and must not spend a slot. Returns null for those, and
 * the label for the seat that costs something — naming the loss, because the
 * ejected plate's own name is already in hand and the label is the only thing
 * the builder reads before pressing Undo.
 */
export function marketSeatUndoLabel(
  before: PortfolioGraph,
  loopId: LoopId,
  fields: Record<string, ParamValue>,
  ctxOf: (loop: LoopGraph) => ParamContext,
): string | null {
  const lane = loopById(before, loopId);
  if (!lane) return null;
  const after = loopById(seatMarket(before, loopId, fields, ctxOf), loopId);
  if (!after) return null;
  const kept = new Set(after.nodes.map((n) => n.data.defKey));
  // DISPLAY_ORDER, so one contradiction always reads the same way round —
  // the same ordering `modulesRuledOutByMarket` resolves it in.
  const lost = DISPLAY_ORDER.filter(
    (k) => lane.nodes.some((n) => n.data.defKey === k) && !kept.has(k),
  );
  if (lost.length === 0) return null;
  const names = lost.map((k) => getDef(k).name.toLowerCase());
  const said =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  /* THE VERB IS THE GRAPH'S, not the caller's. A module-first lane holds
     plates before it holds a market (see `blank-entry` / `module-first`), so
     its FIRST pick can eject one too — and calling that a swap would name an
     action the builder never took. Read off the market the lane had, which is
     the one fact that separates the two. */
  const swap = !!nodeFor(lane, "liquidity-source")?.data.params.candidateId;
  return `${swap ? "swapped" : "picked"} the market, ejected ${said}`;
}

/* `pricingParamsFor` now lives in lib/canvas/pricing-params.ts (recette item
   8/§5): it is a pure derivation over the graph and it is the `comp`
   argument every priced path takes, so a client component was the one place
   it could not live. Re-exported here under the name the existing call sites
   import, and extended there with the dials this file used to drop on the
   floor (deltaBandPct, fundingFloorApr, fundingWindowEpochs, hlCoin, pair,
   chain) — every one of which is now published. */
export { pricingParamsFor } from "@/lib/canvas/pricing-params";

function initialPortfolio(): PortfolioGraph {
  return addLoop(emptyPortfolio()); // lane 1 exists at stage 0 from the first paint
}

/**
 * Is this graph WORK, or just an opened builder?
 *
 * The restore and persist paths both used `loops.length > 0`, which is true of
 * `initialPortfolio()` itself: one lane, no modules. So opening the canvas and
 * touching nothing minted a restorable "draft", and every later visit reopened
 * it. A lane with no module expresses no decision, carries no market and
 * prices nothing, so it is not a composition and must not be restored as one.
 *
 * One predicate, used by both sides, so the thing that gets SAVED and the
 * thing that gets RESTORED can never disagree about what counts.
 */
function hasWork(p: PortfolioGraph): boolean {
  return p.loops.some((l) => l.nodes.length > 0);
}

/** C-H1: re-base ONE live-rail candidate onto the payload's funding-book
 *  register. The shell venue exists only to ride the candidate through
 *  `reconcileHedgeFunding` beside the payload's own venues, so the same
 *  min-window owner that prices every card prices the pinned lane.
 *
 *  B4 (2026-08-24): the SAME shell now also rides `reconcileSharedCapacity`.
 *  `/api/canvas/reprice` prices one pair with no capacity ledger — it cannot
 *  build one, it only scanned a single venue — so the live rail returned a
 *  candidate carrying the loose per-pair reading of a book six other scans had
 *  measured tighter, and the dock printed it beside a copilot card printing the
 *  reconciled one. Reconciling HERE rather than in the route is the only place
 *  the other venue documents are in hand, and it is the same fail-safe minimum
 *  the catalog takes: a fresher reading can only ever tighten a printed
 *  capacity, never loosen one. */
function rebaseLiveCandidate(
  c: ProjectedCandidate,
  venues: OpportunitiesPayload["venues"],
): ProjectedCandidate {
  if (venues.length === 0) return c;
  const shell = {
    venue: c.venue,
    label: c.venue,
    generatedAtMs: 0,
    blockNumber: 0,
    contentHash: "",
    stale: false,
    launchable: true,
    hedged: [c],
    unhedged: [],
  };
  const out = reconcileSharedCapacity(reconcileHedgeFunding([...venues, shell]));
  return out[out.length - 1]?.hedged[0] ?? c;
}

function initialPanels(): { cp: boolean; dock: boolean; tips: boolean } {
  if (typeof window !== "undefined") {
    try {
      const raw = localStorage.getItem(LS_PANELS);
      if (raw) {
        const p = JSON.parse(raw);
        // the user's choices always win; tips default ON for existing drafts
        return { cp: !!p.cp, dock: !!p.dock, tips: p.tips !== false };
      }
    } catch {
      /* best effort */
    }
    // First visit (docs/plans/LATEST_UI_PORT_SPEC.md 2.2): the dock opens on
    // the blank canvas at every width; the copilot never auto-opens and is the
    // rail key's or `[`'s to open.
    return { cp: false, dock: true, tips: true };
  }
  return { cp: false, dock: true, tips: true };
}

export default function RackCanvas({ templateId }: { templateId?: string } = {}) {
  const { address } = useAccount();
  // Template deep link (TEMPLATE_DEEPLINKS 2026-08-21): resolved once from
  // the URL param the /build router passed down. Unknown ids resolve null →
  // the normal empty canvas, never an error.
  const template = useMemo(() => {
    const t = templateById(templateId);
    return t && t.canvas === "loop" ? t : null;
  }, [templateId]);
  /**
   * `?new=1` on the Create vault CTA (founder, 2026-08-22). Read from the URL
   * rather than from state so a hard navigation to the CTA always starts
   * fresh, and so the flag is available on the very first render, before the
   * restore effect runs.
   *
   * It does NOT delete the stored draft. It declines to LOAD it, and
   * `stashedDraft` below offers it straight back, because a CTA that silently
   * discards a builder's work is worse than one that reopens it.
   */
  const startFresh = useMemo(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("new") === "1";
  }, []);
  /** The stored draft `?new=1` declined to load, offered back as one key. */
  const [stashedDraft, setStashedDraft] = useState<PortfolioGraph | null>(null);
  const [portfolio, rawDispatch] = useReducer(reducer, undefined, initialPortfolio);
  /** R6: graph-ops clamps against MODULE_DEFS' STRUCTURAL envelope unless it
   *  is handed the picked market's own bounds. Nothing passed them, so every
   *  targetLeverage slider ran to 3.75 while the market's derived ceiling was
   *  as low as 2.25 (over-stated on 15 of 15 live rows), and the "recommended
   *  X to Y" band was dead on every dial in the product.
   *
   *  The reducer is pure over the graph, so the context is attached at
   *  dispatch. Refs rather than deps: `dispatch` identity is held by most
   *  children, and re-binding it on every portfolio or catalog change would
   *  re-render the whole rack. */
  const portfolioRef = useRef(portfolio);
  portfolioRef.current = portfolio;
  const oppDataRef = useRef<OpportunitiesPayload | null>(null);
  /** C6: no tip may ENTER within 350ms of a reducer commit. Every dispatch on
   *  this surface goes through here so that window is never missed. */
  const [lastDispatchAt, setLastDispatchAt] = useState(0);
  const dispatch = useCallback((a: Action) => {
    setLastDispatchAt(Date.now());
    if (a.type === "param" || a.type === "add-module") {
      rawDispatch({ ...a, ctx: paramContextFor(portfolioRef.current, oppDataRef.current, a.loopId) });
      return;
    }
    rawDispatch(a);
  }, []);
  const [focus, setFocus] = useState<Focus>(null);
  /** The Esc ladder reads focus from a ref so the key handler never has to
   *  re-bind (and never walks a stale ring). */
  const focusRef = useRef<Focus>(null);
  focusRef.current = focus;
  /** Forced Discover target: WHY the dock is in Discover (add/swap). */
  const [discoverTarget, setDiscoverTarget] = useState<DiscoverTarget | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [reprices, setReprices] = useState<Record<LoopId, RepriceData | null>>({});
  const [repricing, setRepricing] = useState<Record<LoopId, boolean>>({});
  const [pulseKeys, setPulseKeys] = useState<Record<LoopId, number>>({});
  const [snapKeys, setSnapKeys] = useState<Set<string>>(new Set());
  const [oppData, setOppData] = useState<OpportunitiesPayload | null>(null);
  // feeds paramContextFor at dispatch time without re-binding `dispatch`
  oppDataRef.current = oppData;
  const [oppError, setOppError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  /* THE LANE RISK STOP STATE IS GONE (2026-08-22). It held a subjective
     adjective, defaulted every lane to "balanced" before anything had been
     written to the graph, and was the second owner of a leverage the
     safety-buffer param already carries. The control's position is now READ
     from `targetLeverage` — the value that actually applies and actually
     publishes — so there is no second state to keep in sync, no undo entry to
     restore beside the graph, and no way for the chip to report a stop the
     graph does not hold. */
  const [addPulse, setAddPulse] = useState(false);

  /**
   * ONE OPEN HELP POPOVER, ON THE ESC LADDER (recette I9).
   *
   * Each plate used to own a private `helpOpen` boolean, so nothing could
   * close anyone else's: several `?` cards overlapped at fit scale, none of
   * them answered to Escape, and a defocused plate kept its card up. A
   * single node id is the whole fix — opening one closes the rest by
   * construction, and the ladder has something to walk out of.
   */
  const [helpNodeId, setHelpNodeId] = useState<string | null>(null);
  const helpNodeIdRef = useRef<string | null>(null);
  helpNodeIdRef.current = helpNodeId;
  const toggleHelp = useCallback((id: string) => {
    setHelpNodeId((cur) => (cur === id ? null : id));
  }, []);

  /* ══ THE UNDO STACK (recette I7) ════════════════════════════════════════
     `Remove` on a lane, `Eject` on a plate and the copilot's APPLY are the
     three most expensive actions on this canvas, all one click, none of them
     confirmed. `tipUndoRef` held exactly one snapshot and only for a
     tip-accepted action — undo existed for the cheapest thing the surface
     does and for nothing else.

     The reducer is pure and the graph immutable, so a snapshot is a
     reference and a stack of five costs nothing. Since the risk stop stopped
     being a second piece of state beside the graph, the graph IS the whole
     snapshot: the leverage the control writes is a safety-buffer param, so an
     undo that restores the graph restores the control's position by
     construction. Bound to Cmd/Ctrl+Z, narrated through the receipt strip the
     header already renders — no second surface. ══ */
  const undoStackRef = useRef<UndoEntry[]>([]);
  const [undoLabel, setUndoLabel] = useState<string | null>(null);
  const pushUndo = useCallback((label: string) => {
    undoStackRef.current = [
      ...undoStackRef.current,
      { portfolio: portfolioRef.current, label },
    ].slice(-UNDO_DEPTH);
    setUndoLabel(label);
  }, []);
  /** One honest line when a stored draft failed verification and was reset
   *  (recette P2-6). Dismissable; never silent. */
  const [draftNotice, setDraftNotice] = useState(false);

  // ── IT4 workstation panels ──
  // SSR-deterministic (recette P2-5 hydration fix): both closed on the first
  // render pass everywhere; the real default (persisted choice or viewport
  // posture) applies in the mount effect below, before first paint.
  const [panels, setPanels] = useState<{ cp: boolean; dock: boolean; tips: boolean }>({
    cp: false,
    dock: false,
    tips: true,
  });
  useLayoutEffect(() => {
    setPanels(initialPanels());
  }, []);
  const [sheet, setSheet] = useState<"cp" | "dock" | null>(null); // mobile only, never persisted
  const [narrow, setNarrow] = useState(false); // 961–1240px: panels overlay
  const [mobile, setMobile] = useState(false); // ≤960px: bottom sheets

  // ── pan/zoom viewport (UX_ITERATION_3 §2) ──
  const [view, setView] = useState({ x: 24, y: 12, s: 1 });
  const [viewAnim, setViewAnim] = useState(false);
  const [panning, setPanning] = useState(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  const didPanRef = useRef(false);
  const animTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadedRef = useRef(false);
  const addPulsedRef = useRef(false);
  // ── Demo mode (/build?demo=1): the public preview embed. Seeds once from
  //    the live catalog and never persists (see the demo-seed effect below).
  const demoRef = useRef(false);
  const demoSeededRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repriceSigs = useRef<Record<LoopId, string>>({});
  const repriceTimers = useRef<Record<LoopId, ReturnType<typeof setTimeout>>>({});
  const rackRef = useRef<HTMLDivElement | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    demoRef.current = new URLSearchParams(window.location.search).has("demo");
    // The preview embed brings its own chrome: hide the floating site nav
    // (build.css scopes the rule to [data-demo]) so the frame shows only
    // the product.
    if (demoRef.current) document.documentElement.setAttribute("data-demo", "1");
    return () => document.documentElement.removeAttribute("data-demo");
  }, []);

  // ── Breakpoints (IT4 §1.3) ──
  useEffect(() => {
    const mqNarrow = window.matchMedia("(max-width:1240px)");
    const mqMobile = window.matchMedia("(max-width:960px)");
    const apply = () => {
      setNarrow(mqNarrow.matches && !mqMobile.matches);
      setMobile(mqMobile.matches);
    };
    apply();
    mqNarrow.addEventListener("change", apply);
    mqMobile.addEventListener("change", apply);
    return () => {
      mqNarrow.removeEventListener("change", apply);
      mqMobile.removeEventListener("change", apply);
    };
  }, []);

  /** Live read of `panels` for the breakpoint effect, which must inspect the
   *  current pair WITHOUT taking it as a dependency (it runs on `narrow`). */
  const panelsRef = useRef(panels);
  panelsRef.current = panels;
  /** The pair the user had open before the narrow band forced them shut. */
  const preNarrowRef = useRef<{ cp: boolean; dock: boolean } | null>(null);

  // Entering the narrow band: both panels default closed (overlay-on-demand).
  // Leaving it restores what was open — the override is a LAYOUT CONSEQUENCE,
  // not a decision the user made, so it neither survives the band nor is
  // written to the preference (I8, below).
  useEffect(() => {
    if (narrow) {
      const p = panelsRef.current;
      if (p.cp || p.dock) preNarrowRef.current = { cp: p.cp, dock: p.dock };
      setPanels((x) => (x.cp || x.dock ? { ...x, cp: false, dock: false } : x));
      return;
    }
    const pre = preNarrowRef.current;
    if (!pre) return;
    preNarrowRef.current = null;
    setPanels((x) => ({ ...x, ...pre }));
  }, [narrow]);

  /* Best-effort persistence of the collapse pair (never the mobile sheet).
     I8 — A TRANSIENT RESIZE IS NOT A PREFERENCE. Dragging a window through
     the 961–1240px band slams both panels shut, and this effect used to
     write that shut pair straight over the stored choice, so the panels were
     still closed on the next visit at full width. In the narrow and mobile
     regimes the stored cp/dock pair is now carried forward untouched; only
     `tips`, which the user toggles by hand at every width, is written. */
  useEffect(() => {
    try {
      let next = panels;
      if (narrow || mobile) {
        const raw = localStorage.getItem(LS_PANELS);
        const stored = raw ? JSON.parse(raw) : null;
        next = {
          cp: stored ? !!stored.cp : panels.cp,
          dock: stored ? !!stored.dock : panels.dock,
          tips: panels.tips,
        };
      }
      localStorage.setItem(LS_PANELS, JSON.stringify(next));
    } catch {
      /* private mode */
    }
  }, [panels, narrow, mobile]);

  /** Forcing triggers land here: a forced dock mode must never land in a
   *  collapsed panel. The copilot never auto-opens. */
  const openDock = useCallback(() => {
    if (mobile) {
      setSheet("dock");
      return;
    }
    setPanels((p) => (narrow ? { ...p, cp: false, dock: true } : p.dock ? p : { ...p, dock: true }));
  }, [mobile, narrow]);

  const toggleCp = useCallback(() => {
    if (mobile) {
      setSheet((s) => (s === "cp" ? null : "cp"));
      return;
    }
    setPanels((p) => (narrow ? { ...p, cp: !p.cp, dock: p.cp ? p.dock : false } : { ...p, cp: !p.cp }));
  }, [mobile, narrow]);

  const toggleDock = useCallback(() => {
    if (mobile) {
      setSheet((s) => (s === "dock" ? null : "dock"));
      return;
    }
    setPanels((p) => (narrow ? { ...p, dock: !p.dock, cp: p.dock ? p.cp : false } : { ...p, dock: !p.dock }));
  }, [mobile, narrow]);

  // ── Restore draft once: KV (wallet) → LS v2 → LS v1 (migrate + converge).
  //    A draft that EXISTS but fails verification resets with one honest
  //    line (recette P2-6), never silently. ──
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    // Template deep links always open on the template composition: the
    // stored draft is neither loaded nor overwritten (template state is
    // disposable, exactly like demo mode — the persist effect skips it).
    if (template) {
      setRestored(true);
      return;
    }
    /* `?new=1`: OPEN BLANK, BUT DO NOT DISCARD.
       The CTA asked for a fresh canvas, so nothing is dispatched. The stored
       draft is still read, and if it holds real work it is handed to
       `stashedDraft` so the rail can offer it back with one key. The persist
       effect stands down until a module exists, so this blank canvas cannot
       overwrite what the stash is holding. */
    if (startFresh) {
      (async () => {
        try {
          const raw = localStorage.getItem(LS_V2) ?? localStorage.getItem(LS_V1);
          const p = raw ? await fromDraft(JSON.parse(raw)) : null;
          if (p && hasWork(p)) setStashedDraft(p);
        } catch {
          /* an unreadable draft is simply not offered */
        } finally {
          setRestored(true);
        }
      })();
      return;
    }
    (async () => {
      let corrupt = false;
      try {
        if (address) {
          try {
            const res = await fetch(`/api/canvas/draft?address=${address}`);
            const body = await res.json();
            const p = body?.draft ? await fromDraft(body.draft) : null;
            if (body?.draft && !p) corrupt = true;
            if (p && hasWork(p)) {
              dispatch({ type: "load", portfolio: p });
              return;
            }
          } catch {
            /* fall through */
          }
        }
        try {
          const rawV2 = localStorage.getItem(LS_V2);
          const p2 = rawV2 ? await fromDraft(JSON.parse(rawV2)) : null;
          if (rawV2 && !p2) {
            corrupt = true;
            localStorage.removeItem(LS_V2); // the reset IS the recovery
          }
          if (p2 && hasWork(p2)) {
            dispatch({ type: "load", portfolio: p2 });
            corrupt = false;
            return;
          }
          const rawV1 = localStorage.getItem(LS_V1);
          const p1 = rawV1 ? await fromDraft(JSON.parse(rawV1)) : null;
          if (rawV1 && !p1) {
            corrupt = true;
            localStorage.removeItem(LS_V1);
          }
          if (p1 && hasWork(p1)) {
            dispatch({ type: "load", portfolio: p1 });
            localStorage.setItem(LS_V2, JSON.stringify(await toDraft(p1, Date.now())));
            localStorage.removeItem(LS_V1);
            corrupt = false;
          }
        } catch {
          corrupt = true; // unparseable JSON in LS is a corrupt draft too
        }
      } finally {
        if (corrupt) setDraftNotice(true);
        setRestored(true);
      }
    })();
  }, [address, template, startFresh]);

  // ── Lifted opportunities subscription (one for the whole workstation).
  //    Polls once a minute while the tab is visible so the background
  //    rescan the first fetch triggers lands without a manual reload. ──
  /* ONE FUNDING REGISTER (C-H1, 2026-08-23). Every payload is re-based
     through `reconcileHedgeFunding` at the lift, so each perp book prices
     at ONE p25 over ONE window on every catalog read in this file.

     ONE CAPACITY TOO (B4, 2026-08-24). `unified-list`'s own handoff note asked
     for exactly this line: "the LANE still reprices from the raw payload
     (`catalogRow(opp, id)`), so it does not see the reconciled capacity. Apply
     `reconcileSharedCapacity(venues)` once at lift time and both surfaces read
     one number for one book." Until it landed, the copilot's blueprint card —
     built from `buildUnifiedList`, which reconciles inside `toRows` — printed
     the tightest reading of a shared book while the dock, reading the raw
     payload through `catalogRow`, printed the loosest. Measured on the walk:
     `$15.9K` on the card against `$26.3K` in the dock for ONE composition of
     ONE lane, and on the committed fixture catalog TEN rows diverge, kHYPE by
     84% ($11,696 against $21,572). A capacity is a promise of room; the loose
     one advertises space the vault has already been told is not there.

     ORDER IS LOAD-BEARING: `buildUnifiedList` runs `reconcileHedgeFunding`
     first and derives its ledger from the result, so the composition here
     reproduces the catalog's own numbers exactly rather than approximately. */
  useEffect(
    () =>
      subscribeOpportunities<OpportunitiesPayload>(
        (d) =>
          setOppData(
            d ? { ...d, venues: reconcileSharedCapacity(reconcileHedgeFunding(d.venues)) } : d,
          ),
        setOppError,
      ),
    [],
  );

  // ── Debounced persist on every change ──
  useEffect(() => {
    if (!loadedRef.current) return;
    if (demoRef.current) return; // demo state is disposable, never a draft
    if (template) return; // template state is disposable too — the user's draft survives underneath
    /* AN EMPTY CANVAS IS NOT WORK, AND MUST NOT OVERWRITE WORK.
       `initialPortfolio()` seats one empty lane, and this effect used to write
       it 800ms after first paint. So merely OPENING the builder minted a
       "draft" of nothing, and under `?new=1` that blank would have overwritten
       the very composition `stashedDraft` is holding out to the user. Writing
       only once a module exists makes the stash safe by construction rather
       than by ordering luck. */
    if (!hasWork(portfolio)) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaveState("saving");
      const draft = await toDraft(portfolio, Date.now());
      try {
        localStorage.setItem(LS_V2, JSON.stringify(draft));
      } catch {
        /* private mode */
      }
      if (address) {
        try {
          await fetch("/api/canvas/draft", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ address, portfolio }),
          });
        } catch {
          /* draft KV is best-effort */
        }
      }
      setSaveState("saved");
    }, 800);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [portfolio, address, template]);

  // ── Per-loop debounced reprice (350ms — the dial must feel wired) ──
  useEffect(() => {
    const liveIds = new Set(portfolio.loops.map((l) => l.id));
    for (const id of Object.keys(repriceSigs.current)) {
      if (!liveIds.has(id)) {
        delete repriceSigs.current[id];
        const t = repriceTimers.current[id];
        if (t) clearTimeout(t);
        delete repriceTimers.current[id];
        setReprices((m) => {
          const n = { ...m };
          delete n[id];
          return n;
        });
      }
    }
    for (const loop of portfolio.loops) {
      const p = pricingParamsFor(loop);
      /* THE QUOTE GATE IS THE MARKET, NOT THE MODULE SET (P0-A, 2026-08-22).
         ---------------------------------------------------------------------
         This read `... && !!nodeFor(loop, "safety-buffer")`, so a lane holding
         a market and a hedge and NO leverage module never issued a
         `/api/canvas/reprice` call and fell through to `mockQuote` alone. That
         composition is the funding carry — the machine THE MODULE RULING
         (`installDefaults` below) makes the default on every market whose
         leverage slope is not positive — so the ONE composition the product
         recommends was the one composition with no server confirmation, while
         every composition it does not recommend had one. The client/server
         agreement check is the instrument that catches a client-side pricing
         drift; pointing it away from the default points it away from the
         money.

         The two surviving clauses are the two the ROUTE needs: a market to
         look up (`marketKey` is derived from `candidateId`, and a missing one
         is a 400) and a launchable venue (the route live-scans the Morpho
         pair and nothing else — Aave, Dolomite and the two template venues
         are not in `LAUNCHABLE_VENUES`). The module set is not one of them.
         The request body carries `targetLeverage` and `riskPreset`, and
         `pricingParamsFor` already answers `PRODUCT_MIN_LEVERAGE` /
         `"standard"` for a loop lane holding no `safety-buffer` — the
         unlevered machine, which `repriceAtLeverage` has priced since A2 and
         `evaluatePairV2` clamps to on the server side. Nothing in this effect
         has to know whether a plate is on the rack. */
      const gated = p.candidateId && p.launchableVenue;
      if (!gated) {
        if (repriceSigs.current[loop.id]) {
          delete repriceSigs.current[loop.id];
          setReprices((m) => ({ ...m, [loop.id]: null }));
        }
        continue;
      }
      /* THE SIGNATURE IS THE REQUEST (2026-08-23). It used to carry the two
         hedge dials and the hedge's presence, none of which the request body
         sends: the route serves the market's row and knows nothing of the
         lane's composition, so a hedge-dial move re-issued an identical call,
         dimmed every plate for the round trip, and landed the same row. The
         composition is applied client-side in `laneQuote`, inside the memo,
         the instant the dial moves. */
      const sig = JSON.stringify([p.venue, p.candidateId, p.targetLeverage, p.riskPreset]);
      if (repriceSigs.current[loop.id] === sig) continue;
      repriceSigs.current[loop.id] = sig;
      const prev = repriceTimers.current[loop.id];
      if (prev) clearTimeout(prev);
      const loopId = loop.id;
      repriceTimers.current[loopId] = setTimeout(async () => {
        setRepricing((m) => ({ ...m, [loopId]: true }));
        try {
          const res = await fetch("/api/canvas/reprice", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              venue: p.venue,
              candidateId: p.candidateId,
              targetLeverage: p.targetLeverage,
              riskPreset: p.riskPreset,
            }),
          });
          const body = await res.json();
          // Definitive answers are classified, never flattened (P0-1):
          // 404 = the market left the live scan; anything else = failed.
          setReprices((m) => ({
            ...m,
            [loopId]: body?.ok
              ? (body as RepriceData)
              : {
                  ok: false,
                  error: body?.error ?? "quote failed",
                  kind: classifyRepriceFailure(res.status),
                },
          }));
        } catch {
          setReprices((m) => ({
            ...m,
            [loopId]: { ok: false, error: "quote service unreachable", kind: "unreachable" },
          }));
        } finally {
          setRepricing((m) => ({ ...m, [loopId]: false }));
          setPulseKeys((m) => ({ ...m, [loopId]: (m[loopId] ?? 0) + 1 }));
        }
      }, 350);
    }
  }, [portfolio]);

  /** Drop a lane's quote NOW (composition changed, P1-5): the shown number
   *  must never describe a vault that is no longer on the canvas. The next
   *  effect pass re-quotes if the lane is still quotable. */
  const invalidateQuote = useCallback((loopId: LoopId) => {
    delete repriceSigs.current[loopId];
    const t = repriceTimers.current[loopId];
    if (t) clearTimeout(t);
    delete repriceTimers.current[loopId];
    setReprices((m) => (m[loopId] === null ? m : { ...m, [loopId]: null }));
  }, []);

  // ── Esc order (IT4 §2.4) + panel toggle keys ([ copilot, ] dock) ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        /* THE ESC LADDER (§3.7). Escape walks OUT ONE RING AT A TIME:
           help popover → module → compose scoped to that lane → compose
           scope null → nothing. It used to walk straight to `setFocus(null)`,
           which threw away the lane the user was standing in. Esc NEVER
           collapses the dock; `]` is the only dismiss.

           The help card is the INNERMOST ring (I9): it is the smallest thing
           on screen and the last thing opened, so it is the first thing
           Escape takes back. */
        if (helpNodeIdRef.current) setHelpNodeId(null);
        else if (reviewOpen) setReviewOpen(false);
        else if (mobile && sheet) setSheet(null);
        else if (discoverTarget) setDiscoverTarget(null);
        else if (focusRef.current?.kind === "module") {
          setFocus({ kind: "lane", loopId: focusRef.current.loopId });
        } else setFocus(null);
        return;
      }
      const el = document.activeElement as HTMLElement | null;
      const editable =
        !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (editable) return; // the copilot chat input must be able to type brackets
      if (e.key === "[") return toggleCp();
      if (e.key === "]") return toggleDock();
      /* ↑ / ↓ WALK THE RACK once a lane is selected. No roving tabindex is
         needed: the selection lives in React state, not in DOM focus, so
         there is exactly one tab stop per lane either way. ←/→ deliberately
         stay unbound — they collide with the plates' own dials and with the
         board pan. The editable guard above is the same one `[` and `]`
         already prove. */
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      const f = focusRef.current;
      if (f?.kind !== "lane") return;
      const ids = portfolioRef.current.loops.map((l) => l.id);
      const next = laneStep(ids, f.loopId, e.key === "ArrowDown" ? 1 : -1);
      if (!next) return;
      e.preventDefault();
      setFocus({ kind: "lane", loopId: next });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reviewOpen, discoverTarget, mobile, sheet, toggleCp, toggleDock]);

  const markSnap = useCallback((ids: string[]) => {
    setSnapKeys((s) => new Set([...s, ...ids]));
    setTimeout(() => {
      setSnapKeys((s) => {
        const n = new Set(s);
        for (const id of ids) n.delete(id);
        return n;
      });
    }, 450);
  }, []);

  /* ══ THE COMPOSITION BEAT (COMPOSE_PANEL_SPEC §5.2/§5.3) ═══════════════════
     Before this, `snapin`, `apyflash` and two independent 500ms count-ups all
     fired at the SAME INSTANT, so nothing on screen was caused by anything
     else; and on remove there was no exit at all (the dispatch went straight
     into unmount). That is why toggling the hedge read as a glitch rather
     than as an economic event.

     ONE conductor. Every number hangs off one beat token, and the phases are
     the house cadence already in the file (installDefaults staggers at 160ms).

       ADD     t=0   key clunk (exists) + DART leaves the pressed key
               t=160 dispatch + markSnap — the dart LANDS before the plate exists
               t=880 the receipt narrates the jump, after the digits land
       REMOVE  t=0   the plate powers DOWN (screen first, then the body)
               t=340 the real dispatch, deferred behind `ejecting`
               t=860 the receipt, reversed

     REDUCED MOTION is a SUBSTITUTION, not a strip: the dart is never mounted,
     the defer is skipped (an instant vanish under the cursor reads as a
     crash, so CSS swaps in a 100ms opacity fade), and because the digits CUT,
     LANGUAGE carries the causation — the receipt fires at t=0 and holds
     longer instead of arriving at t=880.
     ═══════════════════════════════════════════════════════════════════════ */
  const reduceMotion = usePrefersReducedMotion();
  const [ejectingKeys, setEjectingKeys] = useState<Set<string>>(new Set());
  const [beatDart, setBeatDart] = useState<DartShot | null>(null);
  const [receipt, setReceipt] = useState<{ key: number; text: string } | null>(null);
  const beatSeq = useRef(0);
  const beatTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  /** THE INTERLOCK: a standing Add key makes two presses in 400ms trivially
   *  reachable. A second composition change while a beat is live CANCELS the
   *  first; it never queues. */
  const cancelBeat = useCallback(() => {
    for (const t of beatTimers.current) clearTimeout(t);
    beatTimers.current = [];
  }, []);
  const later = useCallback((fn: () => void, ms: number) => {
    beatTimers.current.push(setTimeout(fn, ms));
  }, []);
  useEffect(() => () => cancelBeat(), [cancelBeat]);

  const fireReceipt = useCallback(
    (text: string, reduce: boolean) => {
      beatSeq.current += 1;
      const key = beatSeq.current;
      // Never queued: a second change REPLACES the token and restarts the
      // clock. A 4s token with a close button would be two controls for one
      // idea, so there is no dismiss.
      const show = () => {
        setReceipt({ key, text });
        later(() => setReceipt((r) => (r?.key === key ? null : r)), reduce ? 6000 : 4000);
      };
      if (reduce) show();
      else later(show, 880);
    },
    [later],
  );

  /** Fire the dart from the pressed key's own rect to the node it creates,
   *  falling back to the lane's ghost slot and then its vault. */
  const shootDart = useCallback(
    (origin: DOMRect | null, targetSel: string, loopId: LoopId) => {
      const board = boardRef.current;
      if (!board || !origin) return;
      const b = board.getBoundingClientRect();
      const lane = board.querySelector<HTMLElement>(`[data-loop-id="${loopId}"]`);
      const el =
        board.querySelector<HTMLElement>(targetSel) ??
        lane?.querySelector<HTMLElement>(".rk-slot") ??
        lane?.querySelector<HTMLElement>(".rk-vault") ??
        null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const to = { x: r.left + r.width / 2 - b.left, y: r.top + r.height / 2 - b.top };
      // Never dart to something the user cannot see: it would exit the
      // overflow:hidden board and read as a glitch.
      if (!(to.x > 0 && to.y > 0 && to.x < b.width && to.y < b.height)) return;
      beatSeq.current += 1;
      setBeatDart({
        key: beatSeq.current,
        from: { x: origin.left + origin.width / 2 - b.left, y: origin.top + origin.height / 2 - b.top },
        to,
        compact: mobile,
      });
    },
    [mobile],
  );

  // ── Lane leverage stops — pure UI derivation, one owner ──

  /** Liquidation threshold for the lane's pinned market: catalog row first,
   *  live quote as fallback. Null when neither knows the market. */
  const ltFor = useCallback(
    (loop: LoopGraph): number | null => {
      const src = nodeFor(loop, "liquidity-source");
      const id = String(src?.data.params.candidateId ?? "");
      if (!id) return null;
      for (const v of oppData?.venues ?? []) {
        const c = v.hedged.concat(v.unhedged).find((x) => x.id === id);
        if (c && typeof c.lt === "number") return c.lt;
      }
      const r = reprices[loop.id];
      if (r?.ok === true && r.candidate && typeof r.candidate.lt === "number") return r.candidate.lt;
      return null;
    },
    [oppData, reprices],
  );


  /**
   * Write one leverage stop. ONE param, through the SAME reducer path a drag
   * of the Advanced slider takes, so every clamp and the descriptor grid snap
   * apply identically.
   *
   * The old writer set `riskPreset` too, which is how the preset ladder came
   * to own the ceiling as well as the position — `houseMaxLeverage` is
   * preset-aware, so the stop moved the cap it was derived from. The preset is
   * the user's own Advanced control now and this never touches it.
   */
  const setLeverage = useCallback((loopId: LoopId, leverage: number) => {
    dispatch({ type: "param", loopId, key: "safety-buffer", field: "targetLeverage", value: leverage });
  }, []);

  /** The leverage a fresh pick lands on: the dial's own default for that
   *  market and that lane's preset, from the single owner.
   *
   *  THE ECONOMIC CEILING TRAVELS WITH IT (S1, 2026-08-24, ruling R4). B6 put
   *  the breakeven clamp inside `deriveLeverageBounds` and `laneLeverageStops`
   *  applies it, but every WRITE of the dial's default came through here with
   *  no 4th argument — so seating the leverage module, or swapping the market
   *  under a lane that already holds it, could still land a lane above the
   *  leverage at which it models zero. That is the reachable path from a card
   *  reading +4.3% to a lane modelling −19.4%, and `deriveReviewGate` then
   *  refuses the publish the lane just walked into. Passing the row closes it
   *  at the one place the number is written. */
  const landingFor = useCallback(
    (
      loop: LoopGraph | null,
      lt: number,
      scanMaxLeverage?: number | null,
      row?: ProjectedCandidate | null,
    ): number => {
      const hf = loop ? nodeFor(loop, "safety-buffer") : null;
      const preset = String(hf?.data.params.riskPreset ?? "standard") as RiskPreset;
      /* The same two reads `composedTerms` takes for the short leg, so the
         ceiling is derived on the lane the landing is about to be written to
         — not on a hedge-less abstraction of it. */
      const hasHedge = !!loop && loop.nodes.some((n) => n.data.defKey === "hedge");
      const ceiling = row ? breakevenStopFor(row, hasHedge, loop ? pricingParamsFor(loop) : null) : null;
      return landingLeverage(lt, preset, scanMaxLeverage, ceiling);
    },
    [],
  );

  const installDefaults = useCallback(
    (loopId: LoopId) => {
      const loop = loopById(portfolio, loopId);
      if (!loop) return;
      const lt = ltFor(loop);
      /* THE CHAIN IS DERIVED FROM THE MARKET, IN ONE PLACE (P0-D, 2026-08-22).
         ---------------------------------------------------------------------
         The class-aware branch (founder ruling 2026-08-21: the advertised
         catalog number and the default composition must describe the same
         machine) used to be spelled here as a ternary. It now lives in
         `defaultInstallChain` beside THE MODULE RULING it shares a decision
         with, because both clauses read the same row and one of them has to be
         swept over the fixture catalog by a test — which cannot import a
         `.tsx`.

         What changed in behaviour: `safety-buffer` is no longer unconditional.
         Where the market's leverage slope is not positive its optimum is
         `L = 1`, at which the module's contribution is exactly zero on every
         axis it moves, so the lane does not hold it. That is ABSENCE, not a
         hidden dial: `riskPreset`'s consequence is undefined at `L = 1` and a
         disabled module keeps that null path reachable in `PlateControls`,
         where it falls back to the banned adjective register.

         `leverageModuleVerdict` underneath it is deliberately THREE-valued: a
         row the client has no economics for yet reads `unknown`, which keeps
         the module, because absence of data is not evidence of a non-positive
         slope and a cold catalog must not silently strip a lane. `row` is null
         on that path too, so the chain this builds is byte-identical to the
         one the old ternary built whenever the market is unknown. */
      const src = nodeFor(loop, "liquidity-source");
      const cid = String(src?.data.params.candidateId ?? "");
      const row = cid ? (catalogRow(oppData, cid)?.row ?? null) : null;
      /* THE CEILING READS THE RAW ROW; THE CHAIN READS THE SIGN (2026-08-23).
         `scanMax` is `economics.loopLeverage`, which a repriced candidate
         carries at the lane's own leverage, so it stays on the raw row or
         null. The chain turns on `sign(cy − bo)`, which is reprice-invariant,
         so when the venue has gone quiet the lane's own candidate answers it
         rather than `unknown` re-seating a module the market already ruled
         out. See `verdictRow`. */
      const scanMax = row?.economics?.loopLeverage ?? null;
      const held = reprices[loopId];
      const chain: ModuleKey[] = defaultInstallChain(
        verdictRow(row, held?.ok === true ? held.candidate : null),
      );
      const remaining: ModuleKey[] = chain.filter((k) => !nodeFor(loop, k));
      if (remaining.length === 0) return;
      // One snapshot for the whole staggered chain: undo returns the lane to
      // what it was before the key was pressed, not to the middle of an
      // animation the user never saw as a state.
      pushUndo(remaining.length > 1 ? `installed ${remaining.length} modules` : "installed a module");
      remaining.forEach((k, i) => {
        setTimeout(() => {
          dispatch({ type: "add-module", loopId, key: k });
          markSnap([nodeId(loopId, k)]);
          if (k === "safety-buffer" && lt !== null) {
            setLeverage(loopId, landingFor(loop, lt, scanMax, row));
          }
        }, i * 160); // one-by-one snap, 160ms stagger
      });
    },
    [portfolio, markSnap, ltFor, landingFor, setLeverage, oppData, pushUndo, reprices],
  );

  const validation = useMemo(() => validatePortfolio(portfolio), [portfolio]);

  const laneComputed = useMemo(() => {
    return portfolio.loops.map((loop) => {
      const p = pricingParamsFor(loop);
      const server = reprices[loop.id] ?? null;
      const serverOkRaw = server?.ok === true ? server : null;
      /* ONE FUNDING REGISTER, live rail half (C-H1). The rail's candidate
         still carries the loop scanner's own p25 window; re-base it against
         the (already reconciled) payload's book index before anything reads
         it, so the pinned lane, the header and the cards price the same book
         at the same rate over the same window. */
      const serverOk =
        serverOkRaw?.candidate && oppData
          ? { ...serverOkRaw, candidate: rebaseLiveCandidate(serverOkRaw.candidate, oppData.venues) }
          : serverOkRaw;
      // Mockup register (founder 2026-08-20): every picked market prices.
      // The live rail wins when it answered; otherwise the latest catalog
      // scan prices the lane client-side; template mock candidates price
      // from the registry. Failure states never render.
      /* FRAME M (COMPOSE_PANEL_SPEC §2 conflict A, plumbing). `q.candidate`
         is ALWAYS the repriced lane — `laneQuote` and `mockQuote` both run
         `repriceAtLeverage` — so the market's own headline at its own
         leverage comes from the row, resolved UNCONDITIONALLY here and
         threaded down as `scan`. Deliberately NOT a pick-time param:
         validateGraph raises `unknown-param` for anything outside
         MODULE_DEFS, and a new param would move the draft hash. */
      const catalogHit = catalogRow(oppData, p.candidateId);
      /* THE LIVE ROW (2026-08-23). The rail's `candidate` is the market at its
         own ceiling in the scan frame — the same object the catalog holds, one
         block fresher — so wherever a surface needs "the market as scanned" it
         reads this first and the catalog second. The stops, the bridge's
         ceiling rung, the reclaim and the leverage bay all price off it, which
         is what makes the capsule's lit cell and the header the same
         arithmetic on the same row at the same block. */
      const liveHit: CatalogHit | null =
        serverOk?.candidate ? { row: serverOk.candidate, blockNumber: serverOk.blockNumber } : null;
      const marketHit = liveHit ?? catalogHit;
      const scanHit = marketHit ?? templateCatalogHit(p.candidateId);
      const scan = scanHit
        ? {
            apr: scanHit.row.headlineApr ?? null,
            lev: scanHit.row.economics?.loopLeverage ?? null,
          }
        : null;
      /* THE UNREPRICED CATALOG ROW, for THE GHOST BAY RULING (2026-08-22).
         Byte-identical to the row `installDefaults` resolves its chain from —
         same `catalogRow` call, same deliberate exclusion of
         `templateCatalogHit`. Deliberately NOT the live row: the rack's shape
         must not flicker with the quote state, and the sign it reads is
         reprice-invariant, so the catalog is the stable reader. A hand-authored row
         carries no loop chain, so it has no answer about a leverage module and
         null is the honest input: `dominatedModules(null)` is empty, which is
         the shipped rack.

         Split off `scanHit` rather than reusing it precisely because `scanHit`
         DOES fall back to the template registry, and feeding a hand-authored
         row to `defaultInstallChain` would make the rack's `Install defaults`
         count disagree with the press that `installDefaults` performs. */
      const marketRow = catalogHit?.row ?? null;
      /* THE COMPOSITION IS AN ARGUMENT (recette item 8/§6). `p` IS the lane's
         LaneComposition, so both hedge dials and the delta band price the
         lane here instead of being decorative: without it `mockQuote` fell
         back to the descriptor defaults and every dial below the leverage
         slider moved nothing on screen.

         ONE FRAME (2026-08-23). The live rail's answer goes through
         `laneQuote` — `repriceAtLeverage` on the server's row at the server's
         applied leverage and THIS composition — never onto the canvas raw.
         Raw, it carried the scan's flat `F_B`, and the header, bridge and
         hedge plate printed 0.75 / 0.6742 = 1.1125 times what the capsule,
         the reclaim and the tips printed for the same lane. */
      const q: RepriceData | null = serverOk
        ? laneQuote(serverOk, p)
        : scanHit
          ? mockQuote(scanHit, p.targetLeverage, p.riskPreset, p)
          : null;
      const ok = q?.ok === true ? q : null;
      const graphValidation = validateGraph(loop);
      const graphOk = graphValidation.ok;
      // class coherence: only the impossible direction (hedge on a market
      // with no perp) blanks the number — recette P1-5, narrowed 2026-08-20.
      const classCoherent = !graphValidation.issues.some(
        (i) => i.code === "unhedged-class-forbids-hedge",
      );
      // Composition-honest: without the hedge module the funding leg's carry
      // leaves the lane, so hedged rows reprice minus the funding term.
      const laneHasHedge = loop.nodes.some((n) => n.data.defKey === "hedge");
      /* THE PRODUCT NUMBER, NOT THE VENUE FACT (S1, 2026-08-24, ruling R1).
         This line read `composedNetApy` — the venue frame, before the house's
         own 20% compute fee — and it is the whole loop path: it feeds
         `portfolioApy`, which feeds `modeledApy`, which is what the canvas
         vault node, the review sheet, the published record and the directory
         card all print. `VaultDetail` captions that number "net of venue
         costs and the 20% compute fee", so a fee-free number under that
         caption is a number the product does not deliver. `publishedNetApy`
         is the same one derivation (`composedTerms`) carried one step
         further: fee first, then compound the after-fee yield. Browse-markets
         rows deliberately STAY on `composedNetApy` — a market row answers
         "what does this venue pay", which is not a claim about Priime. */
      const rawNetApy = publishedNetApy(ok?.candidate, laneHasHedge, p);
      /* THE DISPLAY GATE (recette item 9). Class coherence was the only
         condition; a lane whose graph is hard-invalid still printed a number
         from the last quote that happened to survive. A number the graph
         cannot produce is not the lane's number, so `graphOk` joins the gate
         at the one place the gate is applied. */
      const netApy = laneDisplayApy(rawNetApy, classCoherent && graphOk);
      /* THE VENUE TERM (2026-08-23). This gate had no venue clause at all, so a
         lane on a venue with NO LAUNCH RAIL armed the review key as soon as it
         priced. Measured on the funding venue: `{liquidity-source,
         safety-buffer}` on wstETH validates, `composedNetApy` without the hedge
         is 1.9800%, and the gate armed — a NAKED LONG advertised as a 1.98%
         yield product, held back only by the catalog card having no onClick.
         A missing click handler is an accident, not a gate.
         It is not a funding defect: four venues already armed it with no rail.
         THE DISJUNCT IS LOAD-BEARING. `p.launchableVenue` alone takes the two
         TEMPLATE venues (`aerodrome-base`, `options-base`) with it, and both
         are deliberately outside `LAUNCHABLE_VENUES` while being the only way
         the dn-LP and collar products reach review at all.

         THE THIRD DISJUNCT — THE EYES-OPEN PIN (funding launch rail, design
         ruling 3, 2026-08-24). A row that is rail-absent but FULLY MEASURED
         (`discoverAbsence` null on the pinned market: priced, deposits, a leg
         to hold, not ruled negative) composes, reaches review and publishes as
         a modeled design CARRYING THE VENUE VERDICT — the same precedent the
         two template venues already set, entered the same way: a disjunct on
         this gate, never a `LAUNCHABLE_VENUES` flip, because that set owns the
         compile-rail fact. The four measurement-absent classes stay screen-only:
         an absence never pins, so it can never reach this line. */
      const pinnedRow = marketHit?.row ?? null;
      const eyesOpenPin =
        !!p.candidateId &&
        !p.launchableVenue &&
        !isTemplateVenue(p.venue) &&
        !!pinnedRow &&
        !pinnedRow.launchable &&
        discoverAbsence(pinnedRow) === null;
      const laneReviewable =
        graphOk &&
        !!p.candidateId &&
        netApy !== null &&
        (p.launchableVenue || isTemplateVenue(p.venue) || eyesOpenPin);
      /** The verdict an eyes-open lane wears in its header and carries into
       *  the record. One owner (`railVerdictFor`); null everywhere else. */
      const railVerdict = eyesOpenPin ? railVerdictFor(p.venue) : null;
      // P1-4 narration: with borrow above yield at the margin, every extra
      // turn of leverage models LESS yield — the header says so in one line.
      const econ = ok?.candidate?.economics ?? null;
      const leverageYieldNegative = econ !== null && econ.borrowApyMarginal > econ.collateralYieldApy;
      const family = laneFamily(loop.nodes);
      /* THE LEVERAGE STOPS, computed in lib and threaded. The cushion each
         stop holds and the modeled APY at it are both derived from the SAME
         repriced candidate this lane's own hero is derived from, through
         `laneLeverageStops` — no component holds any of that arithmetic, and
         a stop the control offers is guaranteed to be a stop the lane can
         actually price. Empty until a market is pinned: before an `lt` exists
         there is no ceiling, no cushion and no APY, so the control does not
         render at all. */
      const lt = ltFor(loop);
      /* ⚠ THE STOPS PRICE OFF THE UNREPRICED SCAN ROW, NEVER `ok.candidate`.
         This is FRAME M, and getting it wrong is not cosmetic: `ok.candidate`
         has ALREADY been through `repriceAtLeverage`, which caps at the row's
         own `economics.loopLeverage` — so pricing the stops off it makes the
         lane's CURRENT leverage the ceiling, and every stop above it collapses
         onto the current one. Caught on screen: the top two cells printed the
         identical cushion and the identical APY. `scanHit.row` is the market
         as the scan quoted it, which is exactly what `mockQuote` prices the
         lane from, so the cell for the current stop reproduces the lane's own
         hero and the cells above it are reachable. */
      const stops =
        family === "loop" && nodeFor(loop, "safety-buffer")
          ? laneLeverageStops({
              liqLtv: lt,
              preset: p.riskPreset,
              scanMaxLeverage: scan?.lev ?? null,
              candidate: scanHit?.row ?? null,
              hasHedge: laneHasHedge,
              comp: p,
            })
          : [];
      /* THE ROW THE VERDICT READS (2026-08-23). The raw catalog row when the
         venue served one — byte-identical to the shipped rack on every such
         row — else the lane's own priced candidate, for the SIGN only. When
         morpho-blue-hyperevm answered empty, `marketRow` was null, the ghost
         bay returned and `Install defaults` re-seated a module the market had
         ruled out, while the stops priced off this very candidate. The sign
         is reprice-invariant; the ceiling is not, and `scan` / `scanRowFor`
         keep reading the raw row for that. */
      const verdict = verdictRow(marketRow, ok?.candidate ?? null);
      return {
        loop,
        p,
        q,
        ok,
        graphOk,
        classCoherent,
        laneReviewable,
        eyesOpenPin,
        railVerdict,
        netApy,
        leverageYieldNegative,
        family,
        scan,
        marketRow,
        /** The unrepriced market row the lane prices from: live when the rail
         *  answered, the catalog's otherwise, never a hand-authored row. */
        pricedFromRow: marketHit?.row ?? null,
        verdictRow: verdict,
        lt,
        stops,
        /* THE CONTROLS' BOUNDS, FROM THE CLAMP'S OWN ARGUMENT (D3,
           2026-08-24). `dispatch` attaches exactly this — same function, same
           portfolio, same payload — to every `param` action before the reducer
           clamps with it, so a dial that renders from it publishes the bound
           its own clamp enforces. Built here rather than in the plate because
           the plate holds neither the portfolio nor the catalog. */
        paramCtx: paramContextFor(portfolio, oppData, loop.id),
      };
    });
  }, [portfolio, reprices, oppData, ltFor]);

  /**
   * THE UNREPRICED SCAN ROW behind a lane (P0-E, law L10) — the seam
   * `ComposePanel` documents on `scanRowFor` and cannot close from inside the
   * dock, because `oppData` is only ever in hand here. Without it `reclaim`
   * was never called with a row and the readout rendered NOTHING on every
   * market, which is P0-E's whole deliverable dark behind a green unit test.
   *
   * ⚠ IT MUST BE AN UNREPRICED ROW, NEVER the lane's priced candidate. The
   * dominance sweep enters through `repriceAtLeverage`, which caps at the
   * row's own `economics.loopLeverage`; feeding it an already-repriced row
   * makes the lane's CURRENT leverage the ceiling, so every setting above it
   * collapses onto that value and the sweep reports a real trade as a tie —
   * silently, and in the depositor's favour. That is the one failure mode
   * that would have the reclaim readout state a cost of zero on a market
   * where the dial genuinely pays, which is the opposite of what L10 exists
   * to publish.
   *
   * THE LIVE ROW FIRST (2026-08-23). Since the rail serves the market's row at
   * its own ceiling, that row is unrepriced too — and it is the one the
   * header is priced from. Reading the catalog here while the header read the
   * rail put the reclaim's "1.7pp less" and the header's number on two blocks.
   * `laneComputed.pricedFromRow` is that resolution, made once.
   *
   * `templateCatalogHit` is deliberately NOT consulted. A hand-authored row
   * carries no loop chain, `validateGraph` refuses the loop family on it
   * outright, and the sweep has nothing to compare. Null is the honest answer
   * there, and null renders nothing.
   */
  const scanRowFor = useCallback(
    (loopId: LoopId): ProjectedCandidate | null =>
      laneComputed.find((l) => l.loop.id === loopId)?.pricedFromRow ?? null,
    [laneComputed],
  );

  const orchOn = portfolio.orchestrator.enabled && portfolio.loops.length >= 2;
  /* §2.6 — a GATE, not a caveat: publishing a vault that cannot physically
     absorb one minimum deposit is a broken product. One clause, one route
     out (Swap market, on the header's reason line). */
  const noCapLane = laneComputed.find((l) => l.p.candidateId && !acceptsDeposits(l.ok?.candidate));
  /* THE NEVER-POSITIVE GATE (recette item 9). The canvas already refuses a
     vault that cannot absorb a deposit; a vault whose own model says the
     depositor ends the year with less than they started is the same refusal
     one step earlier, and it needs no new arithmetic — `netApy` is already
     on the lane. Routed through `deriveReviewGate`, which is the single
     owner of this decision and was, until now, imported by nothing. */
  const negApyLane = laneComputed.find((l) => typeof l.netApy === "number" && l.netApy <= 0);
  const reviewGate = useMemo(
    () =>
      deriveReviewGate({
        validationOk: validation.ok,
        /* The validator's own first sentence, so the one refusal that used to
           name no action and no number now names the thing it is refusing.
           The gate lowercases it; nothing here rewrites it. */
        validationIssue: validation.issues[0]?.message ?? null,
        lanes: laneComputed.map((l) => ({
          laneReviewable: l.laneReviewable,
          eligible: l.ok?.candidate?.eligible ?? null,
          hasMarket: !!l.p.candidateId,
          /* A lane holding nothing but its market is a supply position, not a
             vault: it is never launch-shaped, and until this clause landed the
             gate had no sentence for it and fell through to "open validation
             issues" — which `validatePortfolio` does not even raise for it.

             ⚠ AN OVERLAY IS NOT THAT MODULE (gate fix, 2026-08-27). The raw
             `!== "liquidity-source"` test was written when every module was a
             hop on the capital spine, so it read as "something that earns".
             The first overlay broke that silently: seating `exogenous-risk` on
             a bare source lane flipped `hasModule` to true and armed the very
             gate whose sentence is that a lane holding nothing that earns is
             not a vault. A watcher earns nothing — that is the whole reason it
             is off the chains, off `CARRY_MODULES` and out of the quote — so
             it cannot be the module this clause is asking for. Same predicate
             `graph-ops` already uses everywhere else, so a second overlay
             inherits the answer with no edit here. */
          hasModule: l.loop.nodes.some(
            (n) => n.data.defKey !== "liquidity-source" && !OVERLAY_KEYS.has(n.data.defKey),
          ),
          /* The positions this lane still has to hold, from the validator that
             closed the gate — never re-derived here. Lets the gate say what is
             MISSING instead of claiming something does not FIT, which is a
             different sentence and was the false one. */
          missing: validateGraph(l.loop).missing,
          acceptsDeposits: l.p.candidateId ? acceptsDeposits(l.ok?.candidate) : undefined,
          netApy: l.netApy,
        })),
        orchOn,
        launchShapedCount: validation.launchShapedLoopIds.length,
      }),
    [laneComputed, validation, orchOn],
  );
  const reviewable = reviewGate.armed;
  const reviewReason = reviewGate.reason;
  const reviewFixLoopId = reviewable
    ? null
    : (noCapLane?.loop.id ?? negApyLane?.loop.id ?? null);
  const anyMarket = laneComputed.some((l) => !!l.p.candidateId);

  // ── Dock mode: a PURE derivation (IT4 §2.2) — never empty, no takeover ──
  const laneFacts = useMemo(
    () =>
      laneComputed.map((l) => ({
        loopId: l.loop.id,
        hasMarket: !!l.p.candidateId,
        graphOk: l.graphOk,
      })),
    [laneComputed],
  );
  const dockMode = useMemo(
    () =>
      deriveDockMode({
        discoverTarget,
        focus,
        anyMarket,
        firstMarketlessLoopId: firstMarketlessLoopId(laneFacts),
        midBuildLoopId: midBuildLoopId(laneFacts),
      }),
    [discoverTarget, focus, anyMarket, laneFacts],
  );

  /**
   * EVERYTHING THAT MOVES A BUS JACK AND IS NOT ALREADY `portfolio`, for
   * `OrchWires`. `dockScopeLoopId(dockMode)` is the SAME derivation `Lane`
   * uses for `laneFocused` below — one owner, so the wires cannot re-measure
   * against a seat the lanes disagree with. `focus` is here for the second
   * mover: a focused plate widens 244 → 340 and slides every jack to its
   * right. Panels and sheets resize the board under the rack.
   */
  const orchMeasureKey = `${dockScopeLoopId(dockMode) ?? ""}|${
    focus === null
      ? "none"
      : focus.kind === "module"
        ? `module:${focus.loopId}:${focus.key}`
        : focus.kind === "lane"
          ? `lane:${focus.loopId}`
          : "orchestrator"
  }|${panels.cp}|${panels.dock}|${panels.tips}|${mobile}|${sheet ?? ""}|${ejectingKeys.size}`;

  // ── Hero portfolio APY (UX_ITERATION_3 §4): allocation-weighted blend;
  //    a single loop IS the portfolio. Any missing lane quote nulls the
  //    blend — a partial blend would lie. ──
  const allocBps = portfolio.orchestrator.allocationsBps;
  const portfolioApy = useMemo(() => {
    if (laneComputed.length === 0) return null;
    if (laneComputed.length === 1) return laneComputed[0].netApy;
    let acc = 0;
    for (const l of laneComputed) {
      if (typeof l.netApy !== "number") return null;
      acc += ((allocBps[l.loop.id] ?? 0) / 10000) * l.netApy;
    }
    return acc;
  }, [laneComputed, allocBps]);

  /* ── Vault deposit capacity (CAPACITY_SPEC §1.4). NOT the sum and NOT
     min(C_i / w_i): lanes SHARE resources, so usages add within a resource
     group and the tightest group binds. The Review card and the dock's
     portfolio line both read this one call. ── */
  const vaultCap = useMemo(
    () =>
      vaultCapacity(
        laneComputed.map((l) => ({
          candidate: l.ok?.candidate,
          hasHedge: !!nodeFor(l.loop, "hedge"),
          // Single-lane portfolios ARE the portfolio (mirrors portfolioApy's
          // own single-lane branch); the formula then degenerates to that
          // lane's own capacity.
          allocationBps: laneComputed.length === 1 ? 10000 : (allocBps[l.loop.id] ?? 0),
          // The escrow term is a function of both hedge dials, so capacity
          // moves with them or the two hedge dials are decorative here too.
          comp: l.p,
        })),
      ),
    [laneComputed, allocBps],
  );

  // Block pin for the hero: the OLDEST quoted block across lanes (every
  // number shown is valid at-or-after it).
  const heroBlock = useMemo(() => {
    const blocks = laneComputed
      .map((l) => l.ok?.blockNumber ?? null)
      .filter((b): b is number => typeof b === "number");
    return blocks.length > 0 ? Math.min(...blocks) : null;
  }, [laneComputed]);

  // ── R1 (TIP_SPEC 2026-08-21): the stage-aware guide line is DELETED, not
  //    reduced. The header states WHAT IS TRUE (meter, hero, .rail-status);
  //    the canvas tip stack states WHAT TO DO NEXT, and it can do it. The
  //    blank-canvas case is already served louder by GhostSlot ("Pick a
  //    market"), the dock's Discover mode and .rail-seg-active. "Waiting on
  //    the modeled quote" was never a next step: it is a truth state, and it
  //    folds into .rail-status as a token.
  //
  //    R6: catalog staleness is chrome, never a tip. The oldest scan age
  //    behind the shown numbers rides in .rail-status beside the block pin.
  const anyQuoting = Object.values(repricing).some(Boolean);
  const scanAgeDays = useMemo(() => {
    if (!oppData?.venues?.length) return null;
    const used = new Set(laneComputed.map((l) => l.p.venue).filter(Boolean));
    const docs = oppData.venues.filter((v) => used.size === 0 || used.has(v.venue));
    if (docs.length === 0) return null;
    const oldest = Math.min(...docs.map((v) => v.generatedAtMs));
    return Math.max(0, Math.floor((oppData.nowMs - oldest) / 86_400_000));
  }, [oppData, laneComputed]);

  // ── One-shot ADD A LOOP pulse after the first lane completes (§5). ──
  useEffect(() => {
    if (addPulsedRef.current) return;
    if (laneComputed.length === 1 && laneComputed[0].laneReviewable) {
      addPulsedRef.current = true;
      setAddPulse(true);
      const t = setTimeout(() => setAddPulse(false), 5200);
      return () => clearTimeout(t);
    }
  }, [laneComputed]);

  // rail reflects the focused lane (module OR lane focus), defaulting to the first
  const railLane =
    (focus?.kind === "module" || focus?.kind === "lane"
      ? laneComputed.find((l) => l.loop.id === focus.loopId)
      : undefined) ?? laneComputed[0];
  /* THE RAIL HOLDS NO OPINION ABOUT WHICH STEPS A LANE HAS (P0-5).
     What stood here was a second opinion about the family chains `graph-ops`
     owns: a hardcoded `Market / Leverage / Compound / Publish` literal for the
     no-lane case, and three `lane.family` branches restating `FAMILY_CHAINS` by
     hand. Because `laneFamily` is total, those branches printed the LOOP chain
     on a lane that had chosen nothing — the meter named a strategy the builder
     had not picked, before they had picked anything at all.

     `laneSteps` is now the single owner of the SHAPE, and an unbound lane comes
     back `Market · Strategy · Publish`, with no family word in it. What stays
     here is the STATE, which is the only part the graph cannot prove: whether a
     step is open is the validator's question and whether Publish is reachable
     is the review gate's, neither of which the graph can answer.

     ONE AMBIENT CLOCK (§7F). `.rail-seg.now` carries this screen's only
     permitted continuous animation. It is declared once, at `build.css:799`,
     with no per-segment delay, so the two `now` segments of an unbound lane
     beat as one lamp with two lit elements rather than as two clocks. They
     mount in the same paint — `laneSteps` returns both on the lane's first
     render — which is what keeps them in phase. Nothing here may light a
     third. */
  const railSteps = useMemo(() => {
    const lane = railLane;
    if (!lane) {
      // No lane at all is the emptiest reading of an unbound one, and it takes
      // its labels from the same owner rather than restating them.
      return laneSteps({ nodes: [] }).map((s) => ({
        label: s.label,
        state: (s.key === "publish" ? "todo" : "now") as RailState,
      }));
    }
    const hasMarket = !!lane.p.candidateId;
    /* "Open" is the VALIDATOR's own answer, never a second rule: the compound
       step goes live exactly when `compound-requires-carry` releases it, so the
       rail cannot disagree with the dock about what can be pressed today. */
    /* THE RAIL READS THE SAME MARKET THE RACK DOES (THE GHOST BAY RULING,
       2026-08-22). Without this argument the rail kept naming `Leverage` as
       the step that finishes a lane whose leverage module the model has ruled
       out, while the rack drew `Dynamic hedge` — the rail and the rack
       describing one lane differently, which is the disagreement P0-5 exists
       to prevent. One derivation, one market, on both surfaces. */
    const market = { dominated: dominatedModules(lane.verdictRow) };
    const addable = new Set(addableModules(lane.loop, market).addable.map((a) => a.key));
    return laneSteps(lane.loop, market).map((s): { label: string; state: RailState } => {
      if (s.key === "publish") {
        return { label: s.label, state: reviewable ? "done" : lane.laneReviewable ? "now" : "todo" };
      }
      // The unbound placeholder: a choice nobody has made is always open.
      if (s.key === "strategy") return { label: s.label, state: "now" };
      if (s.key === "market") return { label: s.label, state: s.placed ? "done" : "now" };
      return {
        label: s.label,
        state: s.placed ? "done" : hasMarket && addable.has(s.key) ? "now" : "todo",
      };
    });
  }, [railLane, reviewable]);

  /**
   * THE PLATE'S SIGNALS, DERIVED (spec WP-9; D9's own handoff, taken).
   *
   * This was a hand-built literal with `drying: false, noQuote: false` typed
   * into it, so the plate's two honest sub-lines were unreachable and its
   * badge was permanently green — including mid-reprice and on a lane with no
   * market at all. `deriveLaneSignals` has been the declared owner since D9
   * shipped, and its docblock names THIS literal as the reason its
   * `allocationPct` and `quoting` fields had to stay optional.
   *
   * Every input below is a fact already on the lane, and none of them is
   * softened: `eligible` is the pinned candidate's own scan verdict,
   * `netApy` is the lane's display number, `hasMarket` is whether a market is
   * pinned at all, and `repricing` is the same per-lane flag the plates read.
   */
  const orchSignals: LaneSignal[] = useMemo(
    () =>
      deriveLaneSignals(
        laneComputed.map((l) => ({
          loopId: l.loop.id,
          label: l.loop.label,
          eligible: l.ok?.candidate?.eligible ?? null,
          netApy: l.netApy,
          hasMarket: !!l.p.candidateId,
          repricing: repricing[l.loop.id] ?? false,
        })),
        portfolio.orchestrator.allocationsBps,
      ),
    [laneComputed, portfolio.orchestrator.allocationsBps, repricing],
  );

  /* THE SLOTS THE VALIDATOR SEES. The plate draws `minWeight` and `maxWeight`
     off these, so the tick on an allocation bar is the bound
     `validateOrchestrator` enforces rather than a second opinion about it. */
  const orchSlots = useMemo(() => slotsFromPortfolio(portfolio), [portfolio]);
  const orchDials = useMemo(
    () => dialsFromParams(portfolio.orchestrator.params),
    [portfolio.orchestrator.params],
  );
  const orchBands = useMemo(
    () =>
      Object.fromEntries(
        orchSlots.map((s) => [s.slotId, { minWeight: s.minWeight, maxWeight: s.maxWeight }]),
      ),
    [orchSlots],
  );
  /* WHERE THE CAPITAL WOULD GO, over the lanes on THIS rack. The dock's
     portfolio panel calls the same function over the same lanes, so the two
     router placements cannot describe two machines (spec F, WP-9 contract). */
  const orchRoute = useMemo(
    () =>
      composedRoute(
        orchSlots,
        laneComputed.map((l) => ({
          loopId: l.loop.id,
          label: l.loop.label,
          publishedNetApy: l.netApy,
          appliedLeverage: l.ok?.candidate?.economics?.loopLeverage ?? l.ok?.appliedLeverage ?? null,
          capacityUsd: l.ok?.candidate?.economics?.capacityUsd ?? null,
          eligible: l.ok?.candidate?.eligible ?? null,
          settlementDays: Number(
            nodeFor(l.loop, "redemption-route")?.data.params.settlementDays ?? 0,
          ),
          blockNumber: l.ok?.blockNumber ?? 0,
          venue: l.p.venue,
        })),
      ),
    [orchSlots, laneComputed],
  );

  // the ghost add-a-loop lane appears only once every lane is launch-shaped
  const showAddLane = laneComputed.length > 0 && laneComputed.every((l) => l.graphOk);
  /* A second lane is the capital router, and with one live strategy the
     router is coming soon (docs/plans/LATEST_UI_PORT_SPEC.md A.2): the ghost
     keeps its live show-predicate and takes the register instead of a press. */
  const addLaneSoon = DEMO_SCOPE.liveStrategies.length === 1;

  // ── Publish draft (founder brief item 7): the Review and Publish input.
  //    Family-aware (TEMPLATE_DEEPLINKS): a single dn-lp lane publishes
  //    strategy "dnlp", a single collar lane publishes "collar"; multi-lane
  //    portfolios keep the loop-portfolio register. ──
  const publishDraft = useMemo<PublishDraft>(() => {
    const lanes = laneComputed;
    const first = lanes[0];
    const pair = first?.p.pairLabel ?? "";
    const collateral = pair.split("/")[0] || "ETH";
    const single = lanes.length === 1;
    /* ── THE MODEL RECORD (recette item 8) ───────────────────────────────
       Everything below this line was composed on the canvas and then
       DROPPED at publish, leaving the vault page to re-invent it: it
       guessed the liquidation threshold from the market's name, invented
       the health bands from a preset it did not have, hardcoded the hedge
       venue and the margin rule, and restated a harvest threshold the
       schema had retired. The reader now prefers every field below over
       its own guess, so the guesses are reached only by records published
       before this wave.

       A value states what the user saw. `null` states that the model
       declines to state it (the reader renders nothing, or falls to its
       documented backfill). Nothing here is defaulted to a number that was
       not on the screen. */
    const record = publishedModelRecord(
      lanes.map((l) => ({
        p: l.p,
        /* The family decides which fields the record may state: only the loop
           family runs a borrow leg, so `publishedModelRecord` publishes
           `liqLtv` / `appliedLeverage` / the HF bands off it alone (MTX-2,
           2026-09-01). */
        family: l.family,
        lt: l.ok?.candidate?.lt ?? null,
        /* THE LEVERAGE THE MODEL ACTUALLY USED, the same precedence the
           plates, DockReadouts and the register lane (below) read.
           `ok.appliedLeverage` is the server's clamp of the dial's REQUEST
           and diverges from `economics.loopLeverage` wherever the model
           capped tighter (L0 < houseMax, or a funding-class market priced
           at 1.00x): a 2.75x loop swapped onto the kHYPE funding market
           published "at 2.75x" in the summary and the Leverage row while
           every priced surface and the APY said 1.00x (gate catch,
           2026-08-24). The record states the number the vault runs. */
        appliedLeverage: l.ok?.candidate?.economics?.loopLeverage ?? l.ok?.appliedLeverage ?? null,
        rowHlCoin: l.ok?.candidate?.hlCoin ?? null,
        blockNumber: l.ok?.blockNumber ?? null,
        bands: l.ok?.bands ?? null,
      })),
      vaultCap?.cand.economics?.capacityBinding ?? null,
    );
    const { liqLtv, appliedLeverage } = record;
    const hfBands = single ? (first?.ok?.bands.hf ?? null) : null;
    const margin = single ? (first?.ok?.bands.margin ?? null) : null;
    const hedgeP = single ? (first?.p.hedge ?? null) : null;
    const compoundP = single ? (first?.p.compound ?? null) : null;
    /** ONE leverage formatter (`format.ts` `lev`, 2 dp), and one leverage:
     *  the APPLIED one. `targetLeverage` is the dial's request; the house
     *  clamp is what the position opens at, and publishing the request made
     *  the summary, the params row and the vault page all quote a number the
     *  vault never ran. */
    const levText = lev(appliedLeverage);
    const family = single && first ? first.family : "loop";
    /**
     * ⚠ THE MULTI-LANE FAMILY COLLAPSE, CORRECTED TO NAME BOTH FAMILIES
     * (spec WP-9; founder call H-2 is DISCLOSE, never refuse).
     *
     * The line above collapses every multi-lane portfolio to `"loop"`, which
     * is what the dnlp and collar PARAM branches need and is a statement
     * about the machine the moment it reaches copy. A basis carry lane beside
     * a treasury floor lane published "2 loops with the router following
     * modeled yield" — one of those lanes has no borrow leg, no liquidation
     * threshold and no loop chain, and the record named it a loop anyway.
     *
     * `FAMILY_LABEL` is the single owner of a family's word (it exists
     * because the validator and the dock once spelled the collar two ways),
     * so the disclosure reads the families off the LANES and joins their own
     * labels. A portfolio whose lanes are all one family still reads as that
     * one family, so nothing moves on the shipped single-family records.
     */
    const laneFamilies = Array.from(new Set(lanes.map((l) => l.family)));
    const familiesPhrase = laneFamilies.map((f) => FAMILY_LABEL[f]).join(" and ");
    const mixedFamily = laneFamilies.length > 1;
    /* ── THE STRATEGY, from its ONE accessor (funding launch rail, WI-3) ──
       `committedStrategy` is the graph's own word for what this lane IS, and
       the record adopts it: a loop-family lane on a funding-class market with
       its hedge seated publishes `strategy: "funding"` and renders the
       funding-class register on its vault page. The family word below keeps
       driving the dnlp/collar branches it always drove. */
    const laneStrategy: StrategyKind =
      single && first ? (committedStrategy(first.loop) ?? family) : "loop";
    const fundingView =
      single && first && laneStrategy === "funding"
        ? fundingPublishView({
            row: first.ok?.candidate ?? first.pricedFromRow,
            pair,
            venueId: first.p.venue,
            hlCoin: first.p.hlCoin ?? first.ok?.candidate?.hlCoin ?? null,
            hedge: first.p.hedge,
            // The lane's own hedge economics at its own composition — the
            // same object the plate's escrow caption reads.
            hedgeEcon: hedgeEconomics(first.ok?.candidate ?? null, first.p),
            compound: first.p.compound,
            capacityUsd: vaultCap?.usd ?? null,
            capacityBindingLabel:
              vaultCap === null
                ? null
                : capacityBindingSentence(vaultCap.cand, vaultCap.sharedCount, vaultCap.hasHedge),
            chainId: first.p.chainId,
            blockNumber: first.ok?.blockNumber ?? null,
          })
        : null;
    /** The eyes-open venue verdict this record carries (null off the rail). */
    const eyesOpenVerdict = single && first ? first.railVerdict : null;
    const moduleNames: string[] = [];
    const moduleLines: { name: string; line: string }[] = [];
    for (const key of DISPLAY_ORDER) {
      if (lanes.some((l) => nodeFor(l.loop, key))) {
        const def = getDef(key);
        moduleNames.push(def.name);
        // The collar's compound line speaks its own register.
        const line =
          key === "auto-compound" && family === "collar" ? "Net premium reinvested" : def.tagline;
        moduleLines.push({ name: def.name, line });
      }
    }
    if (orchOn) {
      moduleNames.push("Yield router");
      moduleLines.push({ name: "Yield router", line: "Routes deposits across loops toward modeled yield" });
    }
    /* ⚠ THE OVERLAY'S OWN STATE, INTO THE RECORD (recette 2026-08-27, track 1).
       -------------------------------------------------------------------------
       The loop above already publishes the watcher's NAME (it walks
       `DISPLAY_ORDER`, which ends on the overlay), so a published vault said
       `Also installed · Exogenous risk` from the day the module shipped. What
       it published nowhere was the state behind that name, and `placedKeysOf`
       had nothing to read — so the same page also printed `1 thing this vault
       does not measure · Oracle, bridge, stablecoin and RPC health`, the
       constant sentence the module exists to replace.
       Two facts close it, and both are on this canvas already:
         · the overlay node's params — the stop the builder moved and the holds
           they set, which decide which parties carry a written response;
         · the gates the scan read on this row at this block, so the parties
           the canvas showed at `measured` stay measured on the record instead
           of silently sinking to `blind`.
       `ok.candidate` is the same priced row `HwPlate` and `PlateScreen` hand
       to `watchViewOf`, so the record's register and the plate read one row.
       Null / undefined where the lane seats no watcher: absent, never zero.

       THE COLLATERAL YIELD IS NOT ONE OF THE TWO and is published on every
       single-lane record, watcher or no watcher: it is a scan reading at this
       block exactly as `liqLtv` is, and gating a measured fact on an unrelated
       module would be the adapter the store refuses. It carries the issuer row
       (`partyPresent` asks this number and nothing else) and it moves no other
       entry, because `carry` and `hedge-econ` both need `borrowApyMarginal`
       beside it and that one is still not published. */
    const exoNode = single && first ? nodeFor(first.loop, "exogenous-risk") : undefined;
    const exoScanRow = exoNode && first ? (first.ok?.candidate ?? null) : null;
    const collateralYieldApy =
      single && first ? (first.ok?.candidate?.economics?.collateralYieldApy ?? null) : null;
    /* A COUNT IS A CLAIM (S1, 2026-08-24). This read `single ? label :
       "Multi-venue"`, so a two-lane portfolio whose lanes both sit on Morpho
       Blue Base published `Multi-venue` — a statement about a spread the
       vault does not have, and the same defect B5 removed from the funding
       canvas (`Hyperliquid + Hyperliquid` → `Cross-venue`). The identity is
       the venue ID, never the lane count: distinct ids decide, exactly as
       `funding-lane-rows.distinctVenueLabels` decides. */
    const laneVenueIds = Array.from(new Set(laneComputed.map((l) => l.p.venue).filter(Boolean)));
    const venue =
      laneVenueIds.length === 1
        ? venueLabel(laneVenueIds[0])
        : single && first
          ? venueLabel(first.p.venue)
          : "Multi-venue";
    const moduleParam = (key: ModuleKey, field: string): string => {
      if (!first) return "";
      return String(nodeFor(first.loop, key)?.data.params[field] ?? "");
    };
    /* QNT-3 — the quant ledger's collar ruling (2026-08-27): the premium is
       the price of the upside sold above the strike, so the review sheet and
       the record print the forgone upside beside the cash flow. Derived at
       the lane's OWN dials through `collarForfeit`, never typed. */
    const forfeit =
      single && first && family === "collar"
        ? collarForfeit({
            strikePct: moduleParam("covered-call", "strikePct"),
            floorPct: moduleParam("protective-put", "floorPct"),
            rollDays: moduleParam("covered-call", "rollDays"),
          })
        : null;
    let params: { label: string; value: string }[];
    if (fundingView) {
      /* The funding review sheet's rows — both legs with their chains, the
         funding percentile with its window, the escrow split, the capacity
         with the book noun, and the venue verdict — built by the one pure
         owner so a test can hold the record to them. */
      params = fundingView.params;
    } else if (single && first && family === "dnlp") {
      params = [
        { label: "Market", value: pair || "…" },
        { label: "Venue", value: venue },
        { label: "Range width", value: `±${moduleParam("auto-center", "rangePct") || "2.5"}%` },
        ...(first.p.compound ? [{ label: "Compound cadence", value: first.p.compound.cadence }] : []),
      ];
    } else if (single && first && family === "collar") {
      params = [
        { label: "Market", value: pair || "…" },
        { label: "Venue", value: venue },
        { label: "Call strike", value: `+${moduleParam("covered-call", "strikePct") || "15"}%` },
        /* QNT-3 — what the strike SELLS, in the row under it, so the record's
           Parameters carry the forfeiture with the dial that set it. */
        ...(forfeit ? [{ label: "Upside forfeited", value: collarForfeitValue(forfeit) }] : []),
        /* ONE QUANTITY, ONE GLYPH (S2 Wave 2 seam, 2026-08-24). This row wrote
           an ASCII hyphen while `AutomationsSection`'s protection envelope
           re-formats the SAME floor with `MINUS` (U+2212, `format.ts`'s one
           owner), so one record page printed `-12%` in Parameters and `−12%`
           four rows below it. The house rule is U+2212 on a signed value, so
           the WRITER moved — and the two ASCII-only parsers on the record side
           (`paramNum`, `riskGrade`'s `pctRow`) moved with it in the same edit,
           because moving the writer alone makes `pctRow` drop the sign and
           print `Protected floor 12%` on a floor that is below spot. */
        { label: "Put floor", value: `${MINUS}${moduleParam("protective-put", "floorPct") || "12"}%` },
        { label: "Roll cadence", value: `${moduleParam("covered-call", "rollDays") || "30"}d` },
        ...(first.p.compound ? [{ label: "Compound cadence", value: first.p.compound.cadence }] : []),
      ];
    } else if (single && first) {
      /* THE PARAMS THE CANVAS ACTUALLY RENDERED. Four rows used to ship, one
         of which ("Risk profile: Standard") was a subjective risk adjective
         the vault reader had to FILTER OUT — a ratified ban enforced by a
         patch on the reader while the writer kept emitting it. Deleted at
         the writer. Everything else here is a number the user set or the
         model applied, and every row is omitted rather than invented when
         the model has nothing to state. */
      params = [
        { label: "Market", value: pair || "…" },
        { label: "Venue", value: venue },
        /* ONE LEVERAGE, ONE LABEL (W1 GATE, 2026-08-24). This row shipped as
           `Leverage` while `VaultDetail` derives `Applied leverage` from the
           same automation and `lib/vaults/seeds.ts` writes `Applied leverage`
           for every sample. On a levered canvas record BOTH printed — measured
           on `/vaults/my-wsteth-loop` and `/vaults/my-cbeth-loop`, rows
           `Leverage 2.75x` and `Applied leverage 2.75x` — because the H10
           family rule keys on the first word and `leverage` never met
           `applied`. Under the shared label the exact-label dedupe collapses
           them to one row. `Applied` is also the honest word: this is the
           post-clamp leverage the model priced, not the dial's request, which
           is what `AutomationsSection` has always called it. */
        ...(appliedLeverage !== null ? [{ label: APPLIED_LEVERAGE_LABEL, value: levText }] : []),
        ...(liqLtv !== null ? [{ label: "Liquidation LTV", value: pct(liqLtv) }] : []),
        /* The live market's two inputs are TYPED (lib/demo/market.ts), not
           scanned, and the record says so in the same words the seeded hero
           record uses (lib/vaults/hero.ts), so a publish onto the one live
           record keeps the rows the reader had before the publish
           (docs/plans/LATEST_UI_PORT_SPEC.md E.7). Scoped to the live market:
           a scanned row states its inputs elsewhere. */
        ...(single &&
        first?.ok?.candidate &&
        isLiveMarket(first.ok.candidate.id) &&
        typeof first.ok.candidate.economics?.collateralYieldApy === "number" &&
        typeof first.ok.candidate.economics.borrowApyMarginal === "number"
          ? [
              { label: "Collateral yield, typed", value: pct(first.ok.candidate.economics.collateralYieldApy) },
              { label: "Borrow rate, typed", value: pct(first.ok.candidate.economics.borrowApyMarginal) },
            ]
          : []),
        /* ONE ROUNDING, AND NO SENTINEL RENDERED AS A NUMBER. Both rules live
           in `healthBandsRow` (module scope, above) so a test can hold the
           record to them without mounting the canvas. */
        ...(hfBands ? [healthBandsRow(hfBands, appliedLeverage)] : []),
        ...(hedgeP
          ? [
              { label: "Hedge leverage", value: lev(hedgeP.hedgeLeverage) },
              { label: "Margin reserve", value: `${pct(hedgeP.reserveFraction)} of short` },
              ...(record.hlCoin ? [{ label: "Hedge coin", value: record.hlCoin }] : []),
              // The delta band is derived, not tuned (modules.ts R1), so it
              // is published as a record field and not listed among the
              // parameters the user set.
              { label: "Funding floor", value: `${pct(hedgeP.fundingFloorApr)} APR` },
              { label: "Funding window", value: `${hedgeP.fundingWindowEpochs} epochs` },
            ]
          : []),
        ...(margin
          ? [
              {
                label: "Margin rule",
                // R5 grep: the last private `pct` on this surface, in a
                // PUBLISH RECORD of all places. `ARROW` comes from the same
                // owner so the glyph cannot drift to a hyphen-gt either.
                value: `${pct(margin.safetyFloor, 0)} ${ARROW} ${pct(margin.restore, 0)}`,
              },
            ]
          : []),
        ...(compoundP
          ? [
              { label: "Compound cadence", value: compoundP.cadence },
              { label: "Harvest threshold", value: usd(compoundP.minActionUsd) },
            ]
          : []),
        ...(vaultCap
          ? [
              /* A modeled binding is a register, not a venue noun: it prints
                 beside the figure and never as a `Capacity binding` row
                 (capacity.ts MODELED_CAPACITY_BINDING). */
              {
                label: "Capacity",
                value: isModeledBinding(record.capacityBinding)
                  ? `${fmtCapacityUsd(vaultCap.usd)} · modeled`
                  : fmtCapacityUsd(vaultCap.usd),
              },
              ...(record.capacityBinding && !isModeledBinding(record.capacityBinding)
                ? [{ label: "Capacity binding", value: record.capacityBinding }]
                : []),
            ]
          : []),
        /* ⚠ BLOCK 0 IS "NO CHAIN PIN", NOT A BLOCK (S2 Wave 2 seam,
           2026-08-24). `templateCatalogHit` returns `blockNumber: 0` for the
           two hand-authored template rows and says in its own comment that
           "every block-pin render site treats 0 as absent" — and this site
           did not: `!== null` let the zero through, so a lane seated from
           `?template=dn-lp` or `?template=treasury-collar` printed
           `Read at Base block 0` on the review sheet and published it into the
           record's Parameters. A provenance row that names a block nobody can
           look up is worse than no provenance row: it claims a scan that never
           happened. `funding-launch.ts:139` and `seeds.ts:294` already gate
           `> 0`; this is the third site, now saying the same thing. */
        ...(record.chainId !== null && record.blockNumber !== null && record.blockNumber > 0
          ? [
              {
                label: "Read at",
                value: `${chainLabel(record.chainId)} block ${record.blockNumber.toLocaleString("en-US")}`,
              },
            ]
          : []),
        /* The disclosure that replaced a blocking gate. Scan eligibility no
           longer closes Review (it is currently false on every market on
           offer, so it made the primary action permanently dead), but the
           fact must still travel with the design rather than being dropped. */
        /* ONE VERDICT PER RECORD. `Launch rail` (below) and this row are two
           spellings of the same fact — the lane has no armed rail and
           publishes as a modeled design — and a reader who meets both counts
           two findings where the model raised one. The eyes-open verdict is
           the more specific of the two (it names the venue and its chain), so
           it wins wherever it is present and this row states the fact only
           where nothing else does. */
        ...(reviewGate.ineligible && !eyesOpenVerdict
          ? [
              {
                label: "Venue launch gates",
                value: "not cleared on the latest scan, modeled design only",
              },
            ]
          : []),
        /* The eyes-open verdict travels on every rail-less measured lane
           (funding launch rail, ruling 3a): the record states the fact the
           builder pinned through. */
        ...(eyesOpenVerdict ? [{ label: "Launch rail", value: eyesOpenVerdict }] : []),
      ];
    } else {
      /* MULTI-LANE: one row per lane, and the row says what the lane IS.
         `WETH/USDC · 40%` named neither the venue the lane runs on nor the
         number it models, so a two-venue portfolio published two rows that
         could not be told apart. */
      /* ⚠ ONE WORD, ONCE. A treasury venue's label already NAMES the fund
         (`BUIDL · Ethereum`), and the lane's pair on that market is the fund
         symbol, so the join printed `BUIDL · BUIDL · Ethereum` on the review
         sheet and into the published record. The row is dropping a repeat of
         a word the venue label already carries, never editing the label: both
         strings keep their own single owner, and a loop lane whose pair is
         `WETH/USDC` matches no venue segment and is untouched. */
      params = lanes.map((l) => {
        const venueWord = venueLabel(l.p.venue);
        const pairWord = l.p.pairLabel || "";
        const head = pairWord && !venueWord.split(" · ").includes(pairWord) ? pairWord : null;
        return {
          label: l.loop.label,
          value: [
            head ?? (pairWord ? null : "…"),
            venueWord,
            pct((portfolio.orchestrator.allocationsBps[l.loop.id] ?? 0) / 10000, 0),
            pct(l.netApy),
          ]
            .filter((p): p is string => typeof p === "string" && p.length > 0)
            .join(" · "),
        };
      });
    }
    const hasHedge = single && first ? !!nodeFor(first.loop, "hedge") : false;
    const kind: { strategy: StrategyKind; strategyLabel: string; defaultName: string; summary: string } =
      fundingView
        ? {
            strategy: "funding",
            strategyLabel: fundingView.strategyLabel,
            defaultName: fundingView.defaultName,
            summary: fundingView.summary,
          }
        : family === "dnlp"
        ? {
            strategy: "dnlp",
            strategyLabel: "Delta-neutral LP",
            defaultName: "My delta-neutral LP",
            summary: `${pair || "An LP position"} on ${venue}${hasHedge ? ", price leg hedged to zero" : ""}, range auto-centered.`,
          }
        : family === "treasury"
          ? {
              /* A TREASURY FLOOR IS NOT A LOOP. Without this branch a single
                 BUIDL floor lane fell into the `else` and published with
                 `strategy: "loop"`, `strategyLabel: "Leveraged loop"`,
                 `defaultName: "My BUIDL loop"` and a summary reading "at
                 1.00x", on a lane that borrows nothing and holds a fund
                 share. The strategy field is also what routes the risk
                 register, so the record rendered a borrow leg and a
                 liquidation threshold that do not exist on it. */
              strategy: "treasury",
              strategyLabel: "Treasury floor",
              defaultName: `My ${pair || "treasury"} floor`,
              summary: `${pair || "A fund share"} held at ${venue}, redeemed on the issuer's own published window.`,
            }
        : family === "collar"
          ? {
              strategy: "collar",
              strategyLabel: "Treasury collar",
              defaultName: "My treasury collar",
              summary: `${pair || "A treasury position"} collared at ${venue}: calls fund the floor, net premium is the income.`,
            }
          : {
              strategy: "loop",
              strategyLabel: single
                ? "Leveraged loop"
                : mixedFamily
                  ? `${familiesPhrase} portfolio`
                  : "Loop portfolio",
              defaultName: single
                ? `My ${collateral} loop`
                : mixedFamily
                  ? `My ${familiesPhrase} portfolio`
                  : "My loop portfolio",
              summary: single
                ? // ONE formatter for the leverage, and it is the APPLIED
                  // one: the summary quoted the dial's request at 1 dp while
                  // the params row quoted it at 2, so one composition read
                  // "3.8x target" and "3.75x" on the same card.
                  `${pair || "A loop"} on ${venue}${appliedLeverage !== null ? ` at ${levText}` : ""}, auto-managed end to end.`
                : /* H-2 — a MIXED record names both families rather than
                     calling every lane a loop. A portfolio whose lanes are
                     all one family keeps the sentence it has always had, so
                     nothing moves on a record that was already true. */
                  mixedFamily
                  ? `${lanes.length} lanes, ${familiesPhrase}, with the router following modeled yield.`
                  : `${lanes.length} loops with the router following modeled yield.`,
            };
    return {
      ...record,
      defaultName: kind.defaultName,
      strategy: kind.strategy,
      strategyLabel: kind.strategyLabel,
      summary: kind.summary,
      venue,
      market: single ? pair || "…" : `${lanes.length} markets`,
      modules: moduleNames,
      moduleLines,
      params,
      laneCount: lanes.length,
      modeledApy: portfolioApy ?? 0,
      // QNT-3 — printed by the review sheet directly under the modeled APY;
      // review-card state, peeled before the record is written (the record
      // carries the same fact as its `Upside forfeited` param row).
      apyCompanion: forfeit ? collarForfeitLine(forfeit) : null,
      capacityUsd: vaultCap?.usd ?? null,
      capacityBindingLabel:
        vaultCap === null
          ? null
          : capacityBindingSentence(vaultCap.cand, vaultCap.sharedCount, vaultCap.hasHedge),
      railVerdict: eyesOpenVerdict,
      // See the block above `exoNode`. Absent on a lane with no watcher, so a
      // record published without one is byte for byte what it was.
      collateralYieldApy,
      exogenousParams: exoNode ? { ...exoNode.data.params } : null,
      failedGates: exoScanRow ? [...exoScanRow.failedGates] : null,
      gatesTotal: exoScanRow ? exoScanRow.gatesTotal : null,
      // The funding sheet renders its rows on the single-lane review card.
      reviewParams: fundingView ? true : undefined,
      // The pinned catalog ids, for the publish-success beacon only
      // (copilot loop B-1); PublishFlow peels them before the record is written.
      publishedMarketIds: lanes.map((l) => l.p.candidateId).filter((id) => typeof id === "string" && id.length > 0),
    };
  }, [laneComputed, orchOn, portfolio, portfolioApy, vaultCap]);

  // ── IT4 focus/discover wiring (trigger table §2.3) ──

  const focusModule = useCallback(
    (loopId: LoopId, key: ModuleKey) => {
      setFocus({ kind: "module", loopId, key });
      setDiscoverTarget(null); // a plate click while Discover is forced means the user moved on
      openDock();
    },
    [openDock],
  );

  /**
   * Select a lane. THE ONE PLACE every lane selection passes through — the
   * lane's whole background, its name button, its ghost bay — which is why
   * the pan guard lives here rather than at each caller.
   *
   * A drag that starts on a lane's background and ends on it releases a
   * `click` on that lane, and a 200px pan must never leave the user on a lane
   * they merely dragged across. `didPanRef` is reset by every pointerdown, so
   * this bails on exactly one click: the one that terminates a pan.
   */
  const focusLane = useCallback(
    (loopId: LoopId) => {
      if (didPanRef.current) return;
      setFocus({ kind: "lane", loopId });
      setDiscoverTarget(null);
      openDock();
    },
    [openDock],
  );

  const focusOrchestrator = useCallback(() => {
    setFocus({ kind: "orchestrator" });
    setDiscoverTarget(null);
    openDock();
  }, [openDock]);

  const openSwap = useCallback(
    (loopId: LoopId) => {
      setDiscoverTarget({ loopId, reason: "swap" });
      openDock();
    },
    [openDock],
  );

  const addLoopAndDiscover = useCallback(() => {
    setAddPulse(false);
    const freshId = newLoopId(portfolio.loops.map((l) => l.id));
    dispatch({ type: "add-loop" });
    setDiscoverTarget({ loopId: freshId, reason: "add" });
    openDock();
  }, [portfolio, openDock]);

  /**
   * Pick a row in Discover — same body as the retired takeover's onSelect,
   * targeting the pending lane; an idle-Discover pick first creates a lane
   * (same path as ADD A LOOP). After every pick the dock lands in Lane mode
   * and the canvas spine self-proposes.
   *
   * ══ THE SEAT IS ONE COMMIT (recette v2, PO-1 + PO-3, 2026-09-02) ═════════
   *
   * This wrote the market and stopped. Five `param` dispatches moved the
   * lane's identity onto a new book; nothing re-derived what the book decides.
   * Two published defects came out of that one omission:
   *
   *   · a hedge leverage tuned to a maxLev-25 book's ceiling of 5.0x survived
   *     the swap onto a maxLev-3 book whose ceiling is 2.5x, and published at
   *     5 — the exact failure `reclampLoopParams` was written to prevent and
   *     never called to prevent; and
   *   · swapping a loop lane onto a funding row left `committedStrategy` on
   *     "loop", so a funding carry published as a Leveraged loop carrying
   *     three health-factor bands for a debt it does not have.
   *
   * Worse, every one of those dispatches clamped against `paramContextFor`
   * built from `portfolioRef.current` — the market being swapped AWAY from,
   * because the ref only advances on re-render. `seatMarket` re-reads the
   * context after each write, so each step is bounded by the market actually
   * seated, and the whole seat is one reducer commit and one undo step.
   */
  const onSelectMarket = useCallback(
    (fields: Record<string, string>, row: UnifiedRow) => {
      let loopId = discoverTarget?.loopId ?? firstMarketlessLoopId(laneFacts);
      if (!loopId) {
        loopId = newLoopId(portfolio.loops.map((l) => l.id));
        dispatch({ type: "add-loop" });
      }
      // a market swap invalidates the old quote NOW (P1-5) — the previous
      // market's APY must never render under the new market's label
      invalidateQuote(loopId);
      const loop = loopById(portfolio, loopId);
      if (!loop || !nodeFor(loop, "liquidity-source")) {
        markSnap([nodeId(loopId, "liquidity-source")]);
      }
      /* THE WAY BACK OUT OF A DESTRUCTIVE SWAP (G7 PO-1 follow-up).
         BEFORE the dispatch, so the snapshot `pushUndo` takes off
         `portfolioRef.current` is the graph the builder was looking at when
         they picked — the same placement `composeEject` uses and for the same
         reason. Conditional on the seat actually costing a plate, so an
         ordinary pick or an ordinary lending-to-lending swap does not spend a
         slot in the 5-deep stack; `marketSeatUndoLabel` decides by running
         this very seat, so it can never disagree with what the reducer does a
         line later. */
      const swapUndo = marketSeatUndoLabel(portfolio, loopId, fields, (l) =>
        paramContextForLoop(l, oppDataRef.current),
      );
      if (swapUndo) pushUndo(swapUndo);
      dispatch({
        type: "seat-market",
        loopId,
        fields,
        opp: oppDataRef.current,
        // The leverage re-derives against the picked market's own threshold
        // and its own scanned ceiling — the SAME call the catalog card quoted
        // the row with, so the number on the card is the number the lane
        // stores. Asked on the SEATED lane, so `pricingParamsFor` inside the
        // breakeven stop reads the new market and not the one just left.
        landing:
          typeof row.lt === "number"
            ? (seated) => landingFor(seated, row.lt as number, row.economics?.loopLeverage ?? null, row)
            : undefined,
      });
      setDiscoverTarget(null);
      setFocus({ kind: "lane", loopId });
    },
    [discoverTarget, laneFacts, portfolio, markSnap, landingFor, invalidateQuote, pushUndo],
  );

  /** The visible market universe (recette P2-3): the copilot flags proposal
   *  lanes that are not in this set right now. */
  const visibleIds = useMemo(() => {
    if (!oppData) return null;
    const s = new Set<string>();
    for (const v of oppData.venues) {
      for (const c of v.hedged) s.add(c.id);
      for (const c of v.unhedged) s.add(c.id);
    }
    /* THE HAND-AUTHORED MARKETS ARE VISIBLE TOO (2026-08-24).
       This set was built from the SCAN venues only, so the dn-LP and treasury
       collar rows — which the shelf offers, the discovery list shows and the
       copilot can now propose — were never in it. Every collar and every LP
       blueprint therefore flagged itself `not in the visible market list right
       now`: a true statement about this set and a false one about the product.
       `modeledRows()` is the same owner the discovery list reads. */
    for (const r of modeledRows()) s.add(r.id);
    return s;
  }, [oppData]);

  /** Copilot APPLY (IT4_COPILOT_SPEC §3.5): ONE atomic reducer commit; the
   *  persist effect saves the draft, the reprice-signature effect fires a
   *  live reprice per lane, validation re-runs via the memo. */
  const applyProposal = useCallback(
    (p: ProposalPayload) => {
      /* THE SAME BOUNDS THE RACK CLAMPS WITH (recette v2, PO-2, 2026-09-02).
         `buildPortfolioFromProposal` seated the STRUCTURAL defaults while
         every dispatch on this rack carries `paramContextFor`, so an applied
         blueprint and a hand-composed lane on the SAME market published
         different dials — including a funding floor outside the band the
         product's own descriptor calls admissible for that book. The reader
         is passed in because the payload lives here, and it re-reads per lane
         because the bounds belong to the market that lane seated. */
      const { portfolio: built, nodeIds } = buildPortfolioFromProposal(p, (loop) =>
        paramContextForLoop(loop, oppDataRef.current),
      );
      // APPLY replaces the WHOLE composition in one commit. It is the single
      // most destructive control on the workstation and it had no way back.
      pushUndo("loaded a blueprint");
      dispatch({ type: "load", portfolio: built });
      markSnap(nodeIds);
      setDiscoverTarget(null);
      setFocus(null);
    },
    [markSnap, pushUndo],
  );

  // ── Demo seed (/build?demo=1): self-assemble ONCE from the live catalog,
  //    only on a pristine canvas — a restored draft always wins — replayed
  //    through the same APPLY path a copilot blueprint takes. Never persisted
  //    (the persist effect skips demo mode). ──
  useEffect(() => {
    if (!demoRef.current || demoSeededRef.current) return;
    if (!restored || !oppData?.venues?.length) return;
    const pristine = portfolio.loops.every(
      (l) => String(nodeFor(l, "liquidity-source")?.data.params.candidateId ?? "") === "",
    );
    if (!pristine) {
      demoSeededRef.current = true; // a real draft is on the canvas — leave it
      return;
    }
    const proposal = buildDemoProposal(oppData.venues);
    if (!proposal) return; // empty catalog: cold-start honestly
    demoSeededRef.current = true;
    applyProposal(proposal);
  }, [restored, oppData, portfolio, applyProposal]);

  // ── Template seed (/build?template=<id>): construct the template's lane
  //    exactly as if the user had picked the market and pressed Install
  //    defaults — same pure graph-ops, same clamps. Mock-candidate templates
  //    seed immediately; the catalog-pick template waits for the live
  //    catalog and cold-starts honestly if it never answers. ──
  const templateSeededRef = useRef(false);
  useEffect(() => {
    if (!template || templateSeededRef.current) return;
    if (!restored) return;
    if (template.seed.kind === "catalog-pick" && !oppData?.venues?.length) return;
    const built = buildTemplatePortfolio(template, oppData?.venues ?? []);
    if (!built) return; // no usable catalog row: the empty canvas is the honest state
    templateSeededRef.current = true;
    dispatch({ type: "load", portfolio: built.portfolio });
    markSnap(built.nodeIds);
    setDiscoverTarget(null);
    setFocus(null);
  }, [template, restored, oppData, markSnap]);

  // ── Demo self-heal: a SEEDED lane whose market left the live scan would
  //    open the preview on the gone-state dead end — nobody can click through
  //    the embed's gate to fix it. Drop that lane (never the last one; a
  //    single clean lane beats a clean lane plus a broken one). Real users
  //    outside demo mode keep the honest gone-state and its recovery keys. ──
  useEffect(() => {
    if (!demoRef.current || !demoSeededRef.current) return;
    if (portfolio.loops.length <= 1) return;
    const gone = portfolio.loops.find((l) => {
      const r = reprices[l.id];
      return r?.ok === false && r.kind === "gone";
    });
    if (gone) dispatch({ type: "remove-loop", loopId: gone.id });
  }, [portfolio, reprices]);

  const dockLanes: DockLaneView[] = useMemo(
    () =>
      laneComputed.map((l) => ({
        loop: l.loop,
        reprice: l.q,
        repricing: repricing[l.loop.id] ?? false,
        netApy: l.netApy,
        graphOk: l.graphOk,
        laneReviewable: l.laneReviewable,
        leverageYieldNegative: l.leverageYieldNegative,
        scan: l.scan,
        lt: l.lt,
        stops: l.stops,
        appliedLeverage: l.ok?.candidate?.economics?.loopLeverage ?? null,
        storedLeverage: l.p.targetLeverage,
        paramCtx: l.paramCtx,
      })),
    [laneComputed, repricing],
  );

  /* ── the two composition beats, bound to the compose panel's controls ── */

  /** Cause tokens for the receipt, capped short so `.rail-status` never
   *  wraps: an APY explainer that makes the page jump is worse than none. */
  const CAUSE: Partial<Record<ModuleKey, string>> = {
    hedge: "hedge",
    "safety-buffer": "leverage",
    "auto-compound": "compound",
    "auto-center": "range",
    "covered-call": "call",
    "protective-put": "put",
    "liquidity-source": "market",
  };

  /** What the lane's composed number is now, and what this change makes it.
   *  Both from `publishedNetApy` / `candidateApy` / `hedgelessApy` — the same
   *  functions the header calls, so the receipt cannot disagree with it.
   *  S1 2026-08-24: `from` moved to `publishedNetApy` WITH the header, so the
   *  receipt's arrow keeps both endpoints in one frame (R1). */
  const composedPair = useCallback(
    (loopId: LoopId, key: ModuleKey, dir: 1 | -1): { from: number | null; to: number | null } => {
      const lane = laneComputed.find((l) => l.loop.id === loopId);
      const cand = lane?.ok?.candidate ?? null;
      const hasHedge = !!(lane && nodeFor(lane.loop, "hedge"));
      const comp = lane?.p ?? null;
      const from = publishedNetApy(cand, hasHedge, comp);
      /* THE LEVERAGE KEY'S RECEIPT (2026-08-23) reads the bay's own triple:
         no debt → the landing the press seats, on the UNREPRICED row. The
         receipt and the bay cannot narrate two different moves. */
      if (key === "safety-buffer") {
        const t = leverageBayTriple(lane?.marketRow ?? null, hasHedge, comp, comp?.riskPreset ?? "standard");
        if (!t) return { from, to: from };
        // Add: the lane as it stands → the landing. Eject: the lane as it
        // stands → no debt. `from` is the header's own number either way.
        return dir === 1 ? { from, to: t.to } : { from, to: t.from };
      }
      /* THE COMPOUND KEY'S RECEIPT (DL-5, 2026-09-01). This key used to fall
         through to `{from, to: from}`, so the press never narrated — and
         because `cancelBeat` had already killed the standing receipt's clear
         timer, the PREVIOUS receipt held the strip with an endpoint the
         header had left behind. `to` reprices the SAME composition the press
         commits: on add, the descriptor defaults under the lane's own
         ParamContext (exactly what `dispatch` attaches to `add-module`); on
         eject, the compound-free composition. Same `publishedNetApy`, so the
         receipt's two ends are the header's before and after. */
      if (key === "auto-compound") {
        if (!comp) return { from, to: from };
        const seated =
          comp.compound ??
          ({
            cadence: String(defaultValueFor("auto-compound", "cadence", lane?.paramCtx) ?? "24h"),
            minActionUsd: Number(defaultValueFor("auto-compound", "minActionUsd", lane?.paramCtx) ?? 25),
          } as NonNullable<LanePricingParams["compound"]>);
        return {
          from,
          to: publishedNetApy(cand, hasHedge, { ...comp, compound: dir === 1 ? seated : null }),
        };
      }
      if (key !== "hedge") return { from, to: from };
      // ⚠ SOLE ACCESSOR: the hedge's two endpoints come from hedgeEconomics,
      // never from a second decomposition here, so the receipt cannot narrate
      // a jump the add key did not promise. It takes the SAME composition the
      // header priced with, so the receipt and the header cannot disagree.
      const h = hedgeEconomics(cand, comp);
      if (!h) return { from, to: from };
      /* ONE FEE FRAME ACROSS THE ARROW, AND THE FRAME IS THE OBJECT'S (C6,
         2026-08-24). This used to spell `applyComputeFee` on both ends here,
         which made this component the second owner of R1's ordering (the third
         was `ComposePanel`'s eject announcement) — and it dropped the compound
         step, so on a lane running auto-compound the receipt narrated a move
         between two numbers the header never showed. `hedgeEconomics` carries
         both frames now: `product` is `publishedNetApy` on each endpoint, from
         `composedTerms`, so the receipt's two ends ARE the header's before and
         after. */
      const p = h.product;
      return {
        from: dir === 1 ? p.withoutApy : p.withApy,
        to: dir === 1 ? p.withApy : p.withoutApy,
      };
    },
    [laneComputed],
  );

  const narrateBeat = useCallback(
    (key: ModuleKey, dir: 1 | -1, from: number | null, to: number | null) => {
      if (from === null || to === null || Math.abs(to - from) < MATERIAL_DELTA) {
        /* Nothing moved worth saying — but the press IS the last mutation
           now, and `cancelBeat` has already killed the standing receipt's
           clear timer, so a token left up would narrate a jump the header no
           longer shows, indefinitely (DL-5). The strip returns to the status
           line instead. */
        setReceipt(null);
        return;
      }
      fireReceipt(
        `${CAUSE[key] ?? "module"} ${dir === 1 ? "added" : "removed"} · ${pct(from)} ${ARROW} ${pct(to)}`,
        reduceMotion,
      );
    },
    // CAUSE is a module-scope literal; the deps that matter are the two hooks.
    [fireReceipt, reduceMotion],
  );

  const composeAdd = useCallback(
    (loopId: LoopId, key: ModuleKey, origin: DOMRect | null) => {
      cancelBeat();
      const { from, to } = composedPair(loopId, key, 1);
      /* ⚠ ONE PRESS INSTALLS ONE MODULE, ALWAYS. Do not reintroduce a chain
         case here; it is the defect this wave exists to close.

         DELETED 2026-08-22 (audit of the uncommitted-canvas wave): a
         `needsChain` branch read `laneFamily(loop.nodes) === "loop"` and, on a
         lane with no `safety-buffer`, called `installDefaults(loopId)` INSTEAD
         of adding the module that was pressed. Three things were wrong with it
         by the time it was found, each fatal on its own:

           1. `laneFamily()` is TOTAL and answers "loop" for an empty node set,
              so on a BLANK lane the branch was always taken. Pressing
              `Add dynamic hedge` installed Dynamic leverage and Auto-compound
              and NOT THE HEDGE — the module the builder pressed never entered
              the graph at all. Measured live on `/build?new=1`.
           2. Its stated premise ("validateGraph requires the leverage module
              before a hedge") named `hedge-requires-safety-buffer`, DELETED in
              P0-1. The rule went; the code enforcing it stayed behind.
           3. It claimed the bay's `adds dynamic leverage too` line had promised
              the extra modules. `impliedBy` was deleted in P0-4, so
              `ComposeAddable.implies` is `[]` on every lane and that line never
              renders. The handler was installing two modules nobody was told
              about.

         This was the last thing standing between the rack and the funding carry
         (`liquidity-source + hedge` at L = 1). `installDefaults` keeps its one
         honest caller: the market-first `Install defaults` key, which names
         what it installs. */
      if (!reduceMotion) shootDart(origin, `[data-node-id="${nodeId(loopId, key)}"]`, loopId);
      const commit = () => {
        if (invalidatesQuote(key)) invalidateQuote(loopId);
        dispatch({ type: "add-module", loopId, key });
        markSnap([nodeId(loopId, key)]);
      };
      if (reduceMotion) commit();
      else later(commit, 160); // house cadence; the dart lands first
      narrateBeat(key, 1, from, to);
    },
    [cancelBeat, composedPair, reduceMotion, shootDart, later, invalidateQuote, markSnap, dispatch, narrateBeat],
  );

  const composeEject = useCallback(
    (loopId: LoopId, key: ModuleKey) => {
      cancelBeat();
      // BEFORE the deferred dispatch, not inside it: the snapshot has to be
      // the graph the user was looking at when they pressed Eject.
      pushUndo(`ejected ${getDef(key).name.toLowerCase()}`);
      const { from, to } = composedPair(loopId, key, -1);
      const id = nodeId(loopId, key);
      const commit = () => {
        if (invalidatesQuote(key)) invalidateQuote(loopId);
        dispatch({ type: "remove-module", loopId, key });
        setEjectingKeys((s) => {
          const n = new Set(s);
          n.delete(id);
          return n;
        });
        // NOT setFocus(null): the control that fired this lives in the dock
        // and must survive its own click.
      };
      if (reduceMotion) {
        commit();
      } else {
        // The deferred unmount IS the animation: without it there is nothing
        // to power down, the node simply vanishes mid-frame.
        setEjectingKeys((s) => new Set(s).add(id));
        later(commit, 340);
      }
      narrateBeat(key, -1, from, to);
    },
    [cancelBeat, composedPair, reduceMotion, later, invalidateQuote, dispatch, narrateBeat, pushUndo],
  );

  /**
   * Remove a lane. The one call site that used to be two: `Lane`'s own
   * `Remove` key and the dock's lane panel both dispatched it inline, so
   * exactly one of them could have grown an undo and the other would not.
   */
  const removeLoop = useCallback(
    (loopId: LoopId) => {
      /* THE SELECTION SURVIVES A REMOVAL IT IS NOT ABOUT. Removing lane 3
         while standing on lane 1 used to deselect lane 1 — a lane the user
         never touched. And removing the SELECTED lane dropped to nothing,
         where the Esc ladder forty lines away already rules that leaving a
         thing lands on the thing that contained it: here, the neighbour that
         moves into the gap. Previous first, so the eye stays where the row
         was; the next lane only when the removed one was the first. */
      const heir = laneAfterRemoval(portfolio.loops.map((l) => l.id), loopId);
      pushUndo("removed a loop");
      dispatch({ type: "remove-loop", loopId });
      setHelpNodeId(null);
      setFocus((f) =>
        !f || f.kind === "orchestrator" || f.loopId !== loopId
          ? f
          : heir
            ? { kind: "lane", loopId: heir }
            : null,
      );
    },
    [dispatch, pushUndo, portfolio],
  );

  /**
   * Cmd/Ctrl+Z. Restores the graph, which since 2026-08-22 IS the whole state
   * a lane carries (the leverage a control writes is a safety-buffer param),
   * then says so
   * through the receipt strip the header already owns — the same token the
   * composition beat narrates with, so undo reads as part of the same
   * conversation rather than as a second notification system.
   */
  const undo = useCallback(() => {
    const stack = undoStackRef.current;
    const entry = stack[stack.length - 1];
    if (!entry) return;
    undoStackRef.current = stack.slice(0, -1);
    setUndoLabel(undoStackRef.current[undoStackRef.current.length - 1]?.label ?? null);
    cancelBeat();
    dispatch({ type: "load", portfolio: entry.portfolio });
    setFocus(null);
    setDiscoverTarget(null);
    setHelpNodeId(null);
    // `reduce = true`: an undo's receipt fires NOW. The 880ms delay exists to
    // let digits land after a change the user watched happen; there is
    // nothing to wait for when the change is being taken back.
    fireReceipt(`Undo · ${entry.label}`, true);
  }, [cancelBeat, dispatch, fireReceipt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "z" && e.key !== "Z") return;
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      // Never steal undo from a text field: the vault-name and lane-rename
      // inputs have their own, and it is the one the user means there.
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (undoStackRef.current.length === 0) return;
      e.preventDefault();
      undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);

  // ── Viewport navigation (UX_ITERATION_3 §2) ──

  const clampScale = (s: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s));

  const animateView = useCallback((next: { x: number; y: number; s: number }) => {
    setViewAnim(true);
    if (animTimer.current) clearTimeout(animTimer.current);
    animTimer.current = setTimeout(() => setViewAnim(false), 360);
    viewRef.current = next; // keep same-tick reads (rapid key presses) fresh
    setView(next);
  }, []);

  /**
   * THE CANVAS DOES NOT MOVE UNDER THE USER (recette I1).
   *
   * `userZoomedRef` records that the scale on screen is a CHOICE — set by
   * the +/− keys, by ctrl-wheel and by a two-finger pinch. While it stands,
   * every AUTOMATIC refit (lane count, panel toggle, window resize) stands
   * down; only FIT clears it. Before this, a chosen zoom survived until the
   * next layout twitch, which on this canvas is about one second.
   */
  const userZoomedRef = useRef(false);
  /** Lane count for the fit's legibility floor, read without re-binding. */
  const laneCountRef = useRef(portfolio.loops.length);
  laneCountRef.current = portfolio.loops.length;

  /** Adaptive zoom-to-fit (IT4C §1): the pure math lives in lib/canvas/fit.
   *  The board column IS the available width (the workstation grid already
   *  subtracts open panels); the rack hugs its lanes (width:max-content in
   *  the IT4C css), so offsetWidth/Height are real lane bounds.
   *
   *  `force` is the FIT key and the background double-click: an explicit
   *  request always wins and clears the manual-zoom flag. Everything else is
   *  the layout talking, and the layout does not get to overrule a choice. */
  const applyFit = useCallback(
    (force: boolean) => {
      if (!force && userZoomedRef.current) return;
      const board = boardRef.current;
      const rack = rackRef.current;
      if (!board || !rack) return;
      // Reserve the tip gutter whether or not the stack is currently
      // non-empty: conditional reservation re-runs the fit on every entrance
      // and exit and slides the whole rack under the user (TIP_SPEC D3).
      const narrowVp = window.innerWidth <= 960;
      const fit = computeFit({
        availableWidth: board.clientWidth,
        availableHeight: board.clientHeight,
        contentWidth: rack.offsetWidth,
        contentHeight: rack.offsetHeight,
        viewportWidth: window.innerWidth,
        laneCount: laneCountRef.current,
        reservedRight: !narrowVp && board.clientWidth >= TIP_PILL_BELOW ? TIP_GUTTER : 0,
        reservedTop: narrowVp ? 96 : 0,
      });
      if (!fit) return;
      if (force) userZoomedRef.current = false;
      animateView(fit);
    },
    [animateView],
  );

  /** The FIT key. Always fits, always clears the manual-zoom flag. */
  const fitView = useCallback(() => applyFit(true), [applyFit]);

  /**
   * Zoom anchored on WHAT THE USER IS LOOKING AT (I11).
   *
   * The board centre is a point nobody chose. With a plate focused, the
   * focused plate is the only thing on the canvas the user has named, so it
   * is the fixed point: pressing `+` grows the plate in place instead of
   * sliding it toward or away from the middle of an empty board.
   */
  const zoomBy = useCallback(
    (factor: number) => {
      const board = boardRef.current;
      if (!board) return;
      const v = viewRef.current;
      const s = clampScale(v.s * factor);
      if (s === v.s) return;
      const b = board.getBoundingClientRect();
      const el = board.querySelector<HTMLElement>(".rk-plate--focused");
      let cx = board.clientWidth / 2;
      let cy = board.clientHeight / 2;
      if (el) {
        const r = el.getBoundingClientRect();
        cx = r.left + r.width / 2 - b.left;
        cy = r.top + r.height / 2 - b.top;
      }
      const px = (cx - v.x) / v.s;
      const py = (cy - v.y) / v.s;
      userZoomedRef.current = true;
      animateView({ s, x: cx - px * s, y: cy - py * s });
    },
    [animateView],
  );

  /**
   * A SECOND VAULT (recette I6).
   *
   * Publishing left the composition exactly where it was, so "Create vault"
   * in the nav re-opened the vault that had just been published — the
   * product had no way to start over. The last lane cannot be removed and a
   * market cannot be cleared, so this is the only path to an empty canvas.
   *
   * It goes on the undo stack like every other expensive action: pressing
   * New by mistake after an hour of composing is precisely the moment Cmd+Z
   * has to work.
   */
  const composeAnother = useCallback(() => {
    pushUndo("cleared the canvas");
    dispatch({ type: "load", portfolio: initialPortfolio() });
    setReprices({});
    setRepricing({});
    repriceSigs.current = {};
    for (const t of Object.values(repriceTimers.current)) clearTimeout(t);
    repriceTimers.current = {};
    setFocus(null);
    setDiscoverTarget(null);
    setHelpNodeId(null);
    setReviewOpen(false);
    // The stored draft describes the vault that was just published. Leaving
    // it would put that composition back on the canvas on the next visit,
    // which is the same defect one reload later. The persist effect writes
    // the empty draft over the top of this within its debounce.
    try {
      localStorage.removeItem(LS_V2);
      localStorage.removeItem(LS_V1);
    } catch {
      /* private mode */
    }
    // An empty canvas is a new frame, not a resize: the fit is forced and
    // the manual-zoom flag goes with the composition it belonged to.
    userZoomedRef.current = false;
    setTimeout(() => applyFit(true), 60);
  }, [applyFit, dispatch, pushUndo]);

  // wheel: two-finger scroll pans, ctrl/cmd+wheel (and trackpad pinch) zooms
  // around the cursor. Non-passive listener — React's synthetic wheel cannot
  // preventDefault.
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setViewAnim(false);
      const v = viewRef.current;
      let next = v;
      if (e.ctrlKey || e.metaKey) {
        const rect = board.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const s = clampScale(v.s * Math.exp(-e.deltaY * 0.0022));
        if (s === v.s) return;
        const px = (cx - v.x) / v.s;
        const py = (cy - v.y) / v.s;
        userZoomedRef.current = true; // a chosen scale, same as the +/− keys
        next = { s, x: cx - px * s, y: cy - py * s };
      } else {
        next = { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY };
      }
      viewRef.current = next; // wheel bursts outpace renders — keep reads fresh
      setView(next);
    };
    board.addEventListener("wheel", onWheel, { passive: false });
    return () => board.removeEventListener("wheel", onWheel);
  }, []);

  const isCanvasBackground = (t: EventTarget | null) => {
    const el = t as HTMLElement | null;
    return !el?.closest(
      ".rk-plate,.rk-slot,.rk-addlane,.rk-nav,.rk-tips,.rk-dart,.rk-lanename,button,input,select,textarea",
    );
  };

  /** A two-finger pinch is in progress: the single-pointer pan stands down
   *  so the second finger cannot be read as a drag (I3 — the "jitter"). */
  const pinchingRef = useRef(false);

  const onBoardPointerDown = useCallback((e: React.PointerEvent) => {
    /* THE GESTURE RESETS THE FLAG, NEVER A CLICK THAT MAY NEVER COME.
       ---------------------------------------------------------------
       This line stood four lines down, INSIDE the guard, and the flag was
       cleared again by the board's own `onClick` — which any child that calls
       `stopPropagation` prevents from ever arriving. That is how the ghost
       bay's `Browse markets` came to be dead: drag the background, release
       over the dock, and `didPanRef` stayed true, so the next board click
       returned at its first line and the catalog never opened.

       Pointerdown bubbles from every child to the board, so putting the reset
       ahead of the guard means EVERY press starts a fresh gesture. Safe
       against the pinch: that sets the flag in its `onMove`, never its
       `onDown`. */
    didPanRef.current = false;
    if (e.button !== 0 || !isCanvasBackground(e.target)) return;
    if (pinchingRef.current) return;
    setViewAnim(false);
    const start = { px: e.clientX, py: e.clientY, x: viewRef.current.x, y: viewRef.current.y };
    setPanning(true);
    const onMove = (ev: PointerEvent) => {
      if (pinchingRef.current) return; // a second finger landed: this is a pinch now
      const dx = ev.clientX - start.px;
      const dy = ev.clientY - start.py;
      if (Math.abs(dx) + Math.abs(dy) > 3) didPanRef.current = true;
      setView((v) => ({ ...v, x: start.x + dx, y: start.y + dy }));
    };
    const onUp = () => {
      setPanning(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }, []);

  /**
   * TWO-POINTER PINCH (I3).
   *
   * `.rk-board` sets `touch-action:none` so the browser hands us every touch
   * — which means the browser's own pinch is gone and nothing replaced it.
   * On a phone the canvas fits at ~0.28 and the only way to read a plate was
   * a gesture the surface swallowed.
   *
   * Native listeners rather than React handlers: the pointer set has to be
   * tracked across the whole gesture (including a finger lifted outside the
   * board), and the wheel handler next door already establishes the pattern.
   * The anchor is the midpoint between the fingers, exactly like the wheel's
   * cursor anchor, so the point pinched stays put.
   */
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const pts = new Map<number, { x: number; y: number }>();
    let gesture: { dist: number; mx: number; my: number; view: { x: number; y: number; s: number } } | null =
      null;

    const two = () => {
      const [a, b] = [...pts.values()];
      return {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        mx: (a.x + b.x) / 2,
        my: (a.y + b.y) / 2,
      };
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size !== 2) return;
      const g = two();
      if (g.dist < 1) return;
      pinchingRef.current = true;
      setPanning(false);
      setViewAnim(false);
      gesture = { ...g, view: { ...viewRef.current } };
    };

    const onMove = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!gesture || pts.size !== 2) return;
      const g = two();
      if (g.dist < 1) return;
      const rect = board.getBoundingClientRect();
      const s = clampScale(gesture.view.s * (g.dist / gesture.dist));
      // Anchor on the START midpoint in CONTENT space, then place it under
      // the CURRENT midpoint: pinch and two-finger drag in one gesture.
      const px = (gesture.mx - rect.left - gesture.view.x) / gesture.view.s;
      const py = (gesture.my - rect.top - gesture.view.y) / gesture.view.s;
      const cx = g.mx - rect.left;
      const cy = g.my - rect.top;
      const next = { s, x: cx - px * s, y: cy - py * s };
      userZoomedRef.current = true;
      didPanRef.current = true; // the gesture is not a tap: never clears focus
      viewRef.current = next;
      setView(next);
    };

    const onUp = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) {
        gesture = null;
        // Held one frame past the last finger so the pan handler's own
        // pointerup does not immediately re-arm a drag from the survivor.
        if (pinchingRef.current) requestAnimationFrame(() => (pinchingRef.current = pts.size >= 2));
      }
    };

    board.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      board.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  /* ══ WHEN THE CANVAS IS ALLOWED TO MOVE ITSELF (recette I1) ═══════════════
     Exactly three automatic causes, and each is a change to the FRAME rather
     than to the composition: the lane count, the panel columns, the window.

     WHAT WAS DELETED: a ResizeObserver on `.rk-rack`. The rack hugs its
     lanes, so `.rk-plate--focused` widening 244→340px was a content resize,
     which re-ran the fit 220ms after every plate click — at 1440px the scale
     moved 0.566 → 0.523 and every other element on the canvas slid. It fired
     three more times during `installDefaults`, and it destroyed a manually
     chosen zoom on the same path. Reading a plate is not a request to move
     the rack, and the observer could not tell the difference.
     ═══════════════════════════════════════════════════════════════════════ */

  // lane add/remove (after the snap/zoom transitions settle)
  useEffect(() => {
    const t = setTimeout(() => applyFit(false), 380);
    return () => clearTimeout(t);
  }, [portfolio.loops.length, applyFit]);

  /**
   * THE ONE CAUSE THE RECETTE'S LIST DOES NOT NAME, and why it is here.
   *
   * With the observer gone, a lane that grew from one ghost slot to four
   * plates never re-fit: `Install defaults` left the vault terminus off the
   * right edge of the board with nothing on screen saying so. That is a
   * worse failure than the one being fixed.
   *
   * The distinction that matters is CONTENT vs LAYOUT. This effect keys off
   * the module COUNT — a composition the user committed — and never off a
   * measured box, so focusing a plate (244→340px, pure layout) cannot reach
   * it. And it is debounced past `installDefaults`' own 160ms stagger, so
   * three staggered installs settle into exactly ONE fit at the end rather
   * than the three the recette counted.
   */
  const moduleCount = useMemo(
    () => portfolio.loops.reduce((n, l) => n + l.nodes.length, 0),
    [portfolio.loops],
  );
  useEffect(() => {
    const t = setTimeout(() => applyFit(false), 620);
    return () => clearTimeout(t);
  }, [moduleCount, applyFit]);

  // board width changes on every panel collapse/expand — refit after the
  // grid transition finishes (IT4 §1.2)
  useEffect(() => {
    const t = setTimeout(() => applyFit(false), 300);
    return () => clearTimeout(t);
  }, [panels.cp, panels.dock, applyFit]);

  // window resize re-fits too, debounced 200ms (IT4C §1)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => applyFit(false), 200);
    };
    window.addEventListener("resize", onResize);
    return () => {
      if (t) clearTimeout(t);
      window.removeEventListener("resize", onResize);
    };
  }, [applyFit]);

  const canvasHasMarket = anyMarket;

  // ══════════════════════════════════════════════════════════════════════
  // CANVAS TIPS (TIP_SPEC). The rules engine is pure (lib/canvas/tips.ts)
  // and the clock is a hook (useTips.ts); RackCanvas only supplies context
  // and binds the TipActionId enum to the helpers that already live here.
  // ══════════════════════════════════════════════════════════════════════
  const [pointerOnBoard, setPointerOnBoard] = useState(false);
  const [boardW, setBoardW] = useState(0);
  const [boardH, setBoardH] = useState(0);
  const tipUndoRef = useRef<TipUndoSnapshot | null>(null);
  const [tipsDebug, setTipsDebug] = useState(false);

  useEffect(() => {
    setTipsDebug(new URLSearchParams(window.location.search).get("tips") === "debug");
  }, []);

  // C6: "a pointer is down anywhere on the board". Scoped to the board so a
  // click in the dock or the copilot never re-renders the canvas.
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const down = () => setPointerOnBoard(true);
    const up = () => setPointerOnBoard(false);
    board.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      board.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, []);

  // D3 three regimes, keyed off BOARD width (not viewport): a 1280 desktop
  // with both panels open leaves ~400px of board.
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const measure = () => {
      setBoardW(board.clientWidth);
      setBoardH(board.clientHeight);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(board);
    measure();
    return () => ro.disconnect();
  }, []);

  const ltByLoop = useMemo(() => {
    const m: Record<LoopId, number | null> = {};
    for (const loop of portfolio.loops) m[loop.id] = ltFor(loop);
    return m;
  }, [portfolio, ltFor]);

  const repriceFail = useMemo(() => {
    const m: Record<LoopId, RepriceFailureKind | null> = {};
    for (const loop of portfolio.loops) {
      const r = reprices[loop.id];
      m[loop.id] = r && r.ok === false ? (r.kind ?? "unreachable") : null;
    }
    return m;
  }, [portfolio.loops, reprices]);

  /** §7 — lanes whose compose card the user can actually see right now. */
  const composeVisibleLoopIds = useMemo<LoopId[]>(() => {
    const dockShowing = mobile ? sheet === "dock" : panels.dock;
    if (!dockShowing || dockMode.kind !== "compose") return [];
    if (dockMode.scopeLoopId) return [dockMode.scopeLoopId];
    // Unscoped compose renders every lane, but only ONE lane card is expanded
    // at 2+ lanes, and the collapsed ones show a dot row, not an add key.
    return laneComputed.length === 1 ? laneComputed.map((l) => l.loop.id) : [];
  }, [mobile, sheet, panels.dock, dockMode, laneComputed]);

  const tipCtx = useMemo<TipContext>(
    () => ({
      lanes: laneComputed,
      portfolio,
      validation,
      ltByLoop,
      oppData,
      repriceFail,
      houseFloor: HOUSE_FLOOR_APR,
      /* §7 — which lanes are ALREADY being offered the hedge by a visible
         compose card. A collapsed dock (or a narrow overlay that is closed)
         contributes nothing, which is exactly when the tip must still fire:
         it is then the only voice. */
      composeVisibleLoopIds: composeVisibleLoopIds,
    }),
    [laneComputed, portfolio, validation, ltByLoop, oppData, repriceFail, composeVisibleLoopIds],
  );

  const tipQuiet = useMemo<TipQuiet>(
    () => ({
      panning,
      pointerDown: pointerOnBoard,
      repricing,
      reviewOpen,
      discoverLoopId: panels.dock || mobile ? (discoverTarget?.loopId ?? null) : null,
      focusModule:
        panels.dock && focus?.kind === "module" ? { loopId: focus.loopId, key: focus.key } : null,
      lastDispatchAt,
      // C13 hard hide (unmount, never dim) so the live region stops
      // announcing invisible content.
      hidden: reviewOpen || (mobile && !!sheet) || (narrow && panels.dock),
      muted: !panels.tips,
    }),
    [
      panning,
      pointerOnBoard,
      repricing,
      reviewOpen,
      panels.dock,
      panels.tips,
      mobile,
      narrow,
      sheet,
      discoverTarget,
      focus,
      lastDispatchAt,
    ],
  );

  const tips = useTips(tipCtx, tipQuiet);

  /** A param-only accept gets .rk-plate--ack: half the amplitude of a
   *  placement, because less happened. */
  const ackTarget = useCallback((sel: string) => {
    const el = boardRef.current?.querySelector(sel);
    if (!el) return;
    el.classList.add("rk-plate--ack");
    setTimeout(() => el.classList.remove("rk-plate--ack"), 260);
  }, []);

  /**
   * The TipActionId binding. R4 is enforced here as much as in the catalog:
   * every `apply` is a pure reducer dispatch that is ARITHMETICALLY
   * DETERMINED by state the user already chose, and NO action anywhere in
   * this map picks a market. Market choice is always `openSwap`.
   */
  const runTip = useCallback(
    (tip: Tip) => {
      const a = tip.action;
      if (!a) return;
      const loopId = a.loopId;
      if (a.mode === "reveal") {
        if (a.actionId === "focus-module" && loopId && a.moduleKey) focusModule(loopId, a.moduleKey);
        else if (loopId) openSwap(loopId);
        return;
      }
      if (!loopId) return;
      // C11: capture BEFORE the dispatch. The reducer is pure and the graph
      // immutable, so a reference snapshot is a complete, cheap undo.
      tipUndoRef.current = { tip, portfolio, loopId };
      tips.noteAccept(tip); // C10a, synchronous
      switch (a.actionId) {
        case "install-defaults":
          installDefaults(loopId);
          break;
        case "add-module":
          if (a.moduleKey) {
            if (invalidatesQuote(a.moduleKey)) invalidateQuote(loopId);
            dispatch({ type: "add-module", loopId, key: a.moduleKey });
            markSnap([nodeId(loopId, a.moduleKey)]);
          }
          break;
        case "add-hedge": {
          /* `add-hedge` ADDS THE HEDGE. The second instance of the `needsChain`
             defect deleted at `composeAdd` above (wave audit 2026-08-22) lived
             here: `if (loop && !nodeFor(loop, "safety-buffer")) installDefaults`
             rested on `hedge-requires-safety-buffer`, which P0-1 deleted, and it
             was not even gated on the family — so an instruction to hedge a
             collar or an LP lane installed the loop's borrow leg and left the
             lane without the hedge that was asked for. Both callers now do the
             one thing they are named for. */
          invalidateQuote(loopId);
          dispatch({ type: "add-module", loopId, key: "hedge" });
          markSnap([nodeId(loopId, "hedge")]);
          break;
        }
        case "remove-hedge":
          invalidateQuote(loopId);
          dispatch({ type: "remove-module", loopId, key: "hedge" });
          // LEAVING A MODULE LANDS ON ITS LANE, never on nothing — the ruling
          // the Esc ladder already carries, applied to the four ejection
          // paths that were still throwing the lane away.
          setFocus({ kind: "lane", loopId });
          break;
        case "remove-module":
          /* The tip names the module it ejects (B8b: the leverage module held
             at no debt), and this removes exactly that node through the same
             reducer case the dock's cross and the plate's eject key use. */
          if (a.moduleKey) {
            if (invalidatesQuote(a.moduleKey)) invalidateQuote(loopId);
            dispatch({ type: "remove-module", loopId, key: a.moduleKey });
            setFocus({ kind: "lane", loopId });
          }
          break;
        case "set-leverage": {
          // The tip names the leverage it applies and this writes exactly
          // that number. No adjective is translated here and no second
          // derivation runs: the tip quoted its delta at this leverage
          // through `laneLeverageStops`, and the reducer applies the same
          // descriptor grid snap and house clamp any drag would.
          if (typeof a.leverage === "number") setLeverage(loopId, a.leverage);
          ackTarget(`[data-node-id="${nodeId(loopId, "safety-buffer")}"]`);
          break;
        }
        case "clamp-allocation":
          if (typeof a.bps === "number") {
            dispatch({ type: "set-allocation", loopId, bps: a.bps });
            ackTarget(".rk-orch");
          }
          break;
        case "requote":
          // Dropping the signature refires the debounced reprice effect. It
          // is a re-request, never a mutation, and it degrades to the
          // existing mockQuote path — never to an error card.
          invalidateQuote(loopId);
          break;
      }
    },
    [
      portfolio,
      tips,
      installDefaults,
      invalidateQuote,
      markSnap,
      dispatch,
      setLeverage,
      focusModule,
      openSwap,
      ackTarget,
    ],
  );

  const undoTip = useCallback(
    (tip: Tip) => {
      const snap = tipUndoRef.current;
      if (!snap || snap.tip.id !== tip.id) return;
      dispatch({ type: "load", portfolio: snap.portfolio });
      // Without the re-mute, undo restores the exact state that made the tip
      // true and the card returns 900ms later, which reads as the system
      // arguing with the user.
      tips.noteUndo(tip);
      tipUndoRef.current = null;
    },
    [dispatch, tips],
  );

  return (
    <div className="bc-root">
      <header className="bc-top">
        <ProgressRail
          title={template ? template.header : undefined}
          steps={railSteps}
          portfolioApy={portfolioApy}
          laneChips={laneComputed.map((l) => ({ id: l.loop.id, label: l.loop.label, netApy: l.netApy }))}
          blockNumber={heroBlock}
          quoting={anyQuoting}
          scanAgeDays={scanAgeDays}
          reviewable={reviewable}
          reviewReason={reviewReason}
          onReviewFix={reviewFixLoopId ? () => openSwap(reviewFixLoopId) : undefined}
          saveState={saveState}
          receipt={receipt}
          notice={
            draftNotice
              ? "Your saved draft could not be verified and was reset."
              : stashedDraft
                ? "You have a saved vault in progress."
                : null
          }
          noticeAction={
            stashedDraft && !draftNotice
              ? {
                  label: "Open it",
                  onClick: () => {
                    dispatch({ type: "load", portfolio: stashedDraft });
                    setStashedDraft(null);
                  },
                }
              : null
          }
          onDismissNotice={() => {
            setDraftNotice(false);
            setStashedDraft(null);
          }}
          cpOpen={panels.cp}
          dockOpen={panels.dock}
          onToggleCp={toggleCp}
          onToggleDock={toggleDock}
          onReview={() => setReviewOpen(true)}
        />
      </header>

      <div
        className="bc-work"
        data-cp={panels.cp ? "open" : "closed"}
        data-dock={panels.dock ? "open" : "closed"}
        data-narrow={narrow ? "true" : undefined}
        data-sheet={mobile && sheet ? sheet : undefined}
      >
        <CopilotPanel
          portfolio={portfolio}
          reprices={reprices}
          canvasHasMarket={canvasHasMarket}
          collapsed={!panels.cp}
          visibleIds={visibleIds}
          onApply={applyProposal}
          onToggleCollapse={toggleCp}
        />

        <div
          className={`rk-board${panning ? " rk-board--panning" : ""}`}
          ref={boardRef}
          style={{ backgroundPosition: `${view.x}px ${view.y}px` }}
          onPointerDown={onBoardPointerDown}
          /* `isBoardVoid`, not `isCanvasBackground`: a double-click inside a
             lane now selects that lane twice, and must not ALSO refit the
             view out from under the user. */
          onDoubleClick={(e) => {
            if (isBoardVoid(e.target)) fitView();
          }}
          onClick={(e) => {
            /* READ ONLY — the reset moved to `onBoardPointerDown`. */
            if (didPanRef.current) return;
            // I9 stands: a help card never survives a click past it. Ahead of
            // the guard because a plate click stops propagation and never
            // reaches here at all, so this only ever sees clicks the user
            // aimed somewhere else.
            setHelpNodeId(null);
            /* THE GUARD THIS ELEMENT NEVER HAD (founder report 2026-08-27).
               Its two siblings above check what is under the cursor; this one
               checked only whether a pan happened, so every un-stopped click
               inside a lane ran `setFocus(null)` — 32% of a lane's area,
               including the whole band around its modules. Clearing is
               destructive and unrequested, so it must name a positive target;
               selecting may rely on bubbling. */
            if (!isBoardVoid(e.target)) return;
            // canvas click clears BOTH in one shot (IT4 §2.4); on narrow /
            // mobile it also closes the overlay/sheet.
            //
            // THE PANEL DISMISSALS ARE INSIDE THE GUARD ON PURPOSE: on mobile
            // a lane tap calls `openDock` → `setSheet("dock")`, and an
            // unguarded `setSheet(null)` in the same tick would undo it. Safe,
            // because the sheet keeps two other dismiss paths — the dock's own
            // collapse key and Escape.
            setDiscoverTarget(null);
            setFocus(null);
            if (narrow) setPanels((p) => ({ ...p, cp: false, dock: false }));
            if (mobile) setSheet(null);
          }}
        >
          <div
            className={`rk-viewport${viewAnim ? " rk-viewport--anim" : ""}`}
            /* `--rk-s` PUBLISHES THE BOARD SCALE TO CSS (gate, 2026-08-27).
               Everything under this element is rasterised through
               `scale(view.s)`, so a 1px rule inside it is NOT 1px on screen:
               at the desktop fit scale (~0.63) it is 0.63 device px, and
               measured, the compositor drops it entirely. The lane seat's
               `border:1px solid var(--bc-ink)` painted NOTHING — darkest pixel
               across its edge was the unchanged ground, in both themes — while
               the same border at 2px painted a full-strength rgb(20,18,16).
               The frame that answers "which lane am I on" was invisible on the
               shipped canvas. `.rk-lane::before` divides by this, so the frame
               is exactly one device pixel at every zoom from 0.25 to 1.35. */
            style={
              {
                transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`,
                "--rk-s": String(view.s),
              } as React.CSSProperties
            }
          >
            <div className={`rk-rack${portfolio.loops.length >= 2 ? " rk-rack--multi" : ""}`} ref={rackRef}>
              {orchOn ? (
                <div className="rk-orchcol">
                  <OrchestratorPlate
                    loops={portfolio.loops}
                    signals={orchSignals}
                    bands={orchBands}
                    route={orchRoute}
                    turnoverCeiling={orchDials.turnoverBudgetPctWeek / 100}
                    params={portfolio.orchestrator.params}
                    focused={focus?.kind === "orchestrator"}
                    onFocus={focusOrchestrator}
                    onParam={(field, value) => dispatch({ type: "orch-param", field, value })}
                    onAlloc={(loopId, bps) => dispatch({ type: "set-allocation", loopId, bps })}
                    onOpenRules={focusOrchestrator}
                  />
                </div>
              ) : null}
              <div className="rk-lanes">
                {laneComputed.map((l) => (
                  <Lane
                    key={l.loop.id}
                    loop={l.loop}
                    multi={portfolio.loops.length >= 2}
                    focusedKey={focus?.kind === "module" && focus.loopId === l.loop.id ? focus.key : null}
                    /* THE SEAT AND THE DOCK'S KICKER ARE ONE DERIVATION.
                       This was a private four-clause OR that re-derived what
                       `dockMode` already knows, and it was missing the clause
                       `deriveDockMode` adds on its own: an unfocused
                       mid-build canvas scopes the dock to the first
                       incomplete lane. So the dock could say "Compose · Lane
                       2" while the canvas marked no lane at all. One owner
                       now (`dockScopeLoopId`), so they cannot disagree.
                       `loops < 2` stays: a single lane is always the subject,
                       and `.rk-rack--multi` is what gates the visible mark. */
                    laneFocused={
                      portfolio.loops.length < 2 || dockScopeLoopId(dockMode) === l.loop.id
                    }
                    reprice={l.q}
                    repricing={repricing[l.loop.id] ?? false}
                    netApy={l.netApy}
                    scan={l.scan}
                    scanRow={l.verdictRow}
                    paramCtx={l.paramCtx}
                    laneReviewable={l.laneReviewable}
                    railVerdict={l.railVerdict}
                    noCapacity={noCapLane?.loop.id === l.loop.id}
                    allocationBps={orchOn ? (portfolio.orchestrator.allocationsBps[l.loop.id] ?? 0) : null}
                    snapKeys={snapKeys}
                    ejectingKeys={ejectingKeys}
                    pulseKey={pulseKeys[l.loop.id] ?? 0}
                    canRemove={portfolio.loops.length > 1}
                    onFocusModule={(key) => focusModule(l.loop.id, key)}
                    onFocusLane={() => focusLane(l.loop.id)}
                    onOpenCatalog={() => openSwap(l.loop.id)}
                    onInstallDefaults={() => installDefaults(l.loop.id)}
                    onAddModule={(key) => {
                      if (invalidatesQuote(key)) invalidateQuote(l.loop.id);
                      dispatch({ type: "add-module", loopId: l.loop.id, key });
                      markSnap([nodeId(l.loop.id, key)]);
                      if (key === "safety-buffer" && l.lt !== null) {
                        setLeverage(l.loop.id, landingFor(l.loop, l.lt, l.scan?.lev ?? null, l.marketRow));
                      }
                    }}
                    onParam={(key, field, value) => dispatch({ type: "param", loopId: l.loop.id, key, field, value })}
                    onEject={(key) => {
                      composeEject(l.loop.id, key);
                      setFocus({ kind: "lane", loopId: l.loop.id });
                    }}
                    onRename={(label) => dispatch({ type: "rename-loop", loopId: l.loop.id, label })}
                    onRemoveLoop={() => removeLoop(l.loop.id)}
                    helpNodeId={helpNodeId}
                    onToggleHelp={toggleHelp}
                  />
                ))}
                {showAddLane && addLaneSoon ? (
                  /* COMING SOON (B.1): the same dashed bay, the label dimmed, the
                     tag centred under it at opacity 1, and the press withheld on
                     the element that would carry it. No pulse, no hover lift. */
                  <div
                    className="rk-addlane"
                    data-soon
                    aria-disabled="true"
                    tabIndex={-1}
                    style={{ flexDirection: "column", gap: 8, height: "auto", minHeight: 64, padding: "14px 0" }}
                  >
                    <button
                      type="button"
                      data-soon-press
                      aria-disabled="true"
                      tabIndex={-1}
                      style={{
                        font: "inherit",
                        letterSpacing: "inherit",
                        textTransform: "inherit",
                        color: "inherit",
                        background: "none",
                        border: 0,
                        padding: 0,
                        cursor: "default",
                      }}
                    >
                      ＋ Add a loop
                    </button>
                    <span className="soon-tag">{COMING_SOON.label}</span>
                  </div>
                ) : showAddLane ? (
                  <button
                    className={`rk-addlane${addPulse ? " want" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      addLoopAndDiscover();
                    }}
                  >
                    ＋ Add a loop
                  </button>
                ) : null}
              </div>
              {orchOn ? <OrchWires rackRef={rackRef} portfolio={portfolio} measureKey={orchMeasureKey} /> : null}
            </div>
          </div>

          {/* The dock's own dart. Never mounted under reduced motion (§5.7):
              it is real DOM, and the receipt carries the causation instead. */}
          {beatDart && !reduceMotion ? <TipDart shot={beatDart} /> : null}

          <TipStack
            tips={tips.visible}
            overflowCount={tips.overflow.length}
            expanded={tips.expanded}
            onExpand={tips.setExpanded}
            onAccept={runTip}
            onDismiss={tips.dismiss}
            onUndo={undoTip}
            boardRef={boardRef}
            reduce={reduceMotion}
            claimBeat={tips.claimBeat}
            // D3: the pill is also the honest fallback whenever the column
            // would exceed 50% of board height even at two cards.
            pill={boardW > 0 && (boardW < TIP_PILL_BELOW || boardH * 0.5 - 36 < 320)}
            mobile={mobile}
            debug={tipsDebug ? { candidates: tips.candidates, reasons: tips.gateReasons } : null}
          />

          <div className="rk-nav" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="hm-key" data-key="zoom-in" onClick={() => zoomBy(1.15)}>
              +
            </button>
            <button type="button" className="hm-key" data-key="zoom-out" onClick={() => zoomBy(1 / 1.15)}>
              −
            </button>
            <button type="button" className="hm-key" data-key="fit" onClick={fitView}>
              FIT
            </button>
            <button
              type="button"
              className="hm-key"
              data-key="new"
              title="Start a new vault on an empty canvas"
              onClick={composeAnother}
            >
              New
            </button>
            {/* The undo key is the VISIBLE half of Cmd+Z: a keyboard binding
                nobody can see is not an affordance. It mounts only when
                there is something to take back, and it names it. */}
            {undoLabel ? (
              <button
                type="button"
                className="hm-key"
                data-key="undo"
                title={`Undo ${undoLabel}`}
                onClick={undo}
              >
                Undo
              </button>
            ) : null}
            {/* SAME LAW as the undo key above (founder, 2026-08-27: "no need
                for tips button when no notification yet"). It mounts only once
                the tip layer has a subject — a card on screen, or a muted
                backlog behind the badge below — and then it stays for the rest
                of the session, because this key IS the recovery path out of
                every C8 dismissal and C7 oscillation mute (useTips C9) and a
                key that comes and goes takes that path with it. The predicate,
                and why it is not just `candidates.length`, is `hasTipSubject`
                in lib/canvas/tips.ts. */}
            {tips.everFired ? (
              <button
                type="button"
                className={`hm-key${panels.tips ? " lit" : ""}`}
                data-key="tips"
                aria-pressed={panels.tips}
                title="Canvas suggestions"
                onClick={() => {
                  setPanels((p) => ({ ...p, tips: !p.tips }));
                  if (!panels.tips) tips.reset();
                }}
              >
                <span className={`hm-led${panels.tips ? " lit" : ""}`} />
                Tips
                {!panels.tips && tips.candidates.length > 0 ? ` ${tips.candidates.length}` : ""}
              </button>
            ) : null}
          </div>
        </div>

        <ContextDock
          mode={dockMode}
          collapsed={!panels.dock}
          onToggleCollapse={toggleDock}
          portfolio={portfolio}
          lanes={dockLanes}
          oppData={oppData}
          oppError={oppError}
          scopeLoopId={dockMode.kind === "compose" ? dockMode.scopeLoopId : null}
          portfolioApy={portfolioApy}
          vaultCapacityUsd={vaultCap?.usd ?? null}
          showAddLane={showAddLane}
          onParam={(loopId, key, field, value) => dispatch({ type: "param", loopId, key, field, value })}
          onEject={(loopId, key) => {
            composeEject(loopId, key);
            setFocus({ kind: "lane", loopId });
          }}
          onSetLeverage={setLeverage}
          onOrchParam={(field, value) => dispatch({ type: "orch-param", field, value })}
          onAlloc={(loopId, bps) => dispatch({ type: "set-allocation", loopId, bps })}
          onSelectMarket={onSelectMarket}
          onSwap={openSwap}
          onInstallDefaults={installDefaults}
          scanRowFor={scanRowFor}
          onFocusModule={focusModule}
          onFocusOrchestrator={focusOrchestrator}
          onAddLane={addLoopAndDiscover}
          onAddModule={composeAdd}
          onEjectModule={(loopId, key) => composeEject(loopId, key)}
          onRemoveLoop={removeLoop}
        />

        {mobile ? (
          <div className="sheet-keys">
            <button type="button" className="hm-key" data-key="sheet-cp" onClick={toggleCp}>
              <span className="hm-led" />
              Copilot
            </button>
            <button type="button" className="hm-key" data-key="sheet-dock" onClick={toggleDock}>
              <span className="hm-led" />
              {dockRailLabel(dockMode)}
            </button>
          </div>
        ) : null}
      </div>

      {reviewOpen ? (
        <PublishFlow
          draft={publishDraft}
          onClose={() => setReviewOpen(false)}
          onComposeAnother={composeAnother}
        />
      ) : null}
    </div>
  );
}

/**
 * Orchestrator bus drops: one cable from the orchestrator's bus jack to each
 * lane's source-plate bus jack, with the allocation share at the midpoint.
 * Landing bus cable chrome: #d7b9ad under #000 (widths adapted 5/3 so both
 * read at canvas scale). Coordinates convert out of viewport space with the
 * SVG's own screen matrix (the SVG lives inside the board transform);
 * `lib/canvas/wire-geometry` owns that conversion and the path shape.
 *
 * `measureKey` — THE SAME FIX AS THE FUNDING RACK'S `RouterWires`, applied
 * here because this component had the identical gap and was one lane layout
 * away from showing it. Its deps were `[rackRef, portfolio]`: no focus, and
 * not even the panel state the funding rack carried. Lane focus is a
 * `zoom:.62 → .86` step on every plate in the lane (build.css), so selecting
 * another loop moves every bus jack.
 *
 * WHY IT NEVER SURFACED HERE: measured at 1440, switching loops changes the
 * WIDEST row's max-content width (loops rarely hold the same module count),
 * which resizes the rack root, which fires the `ResizeObserver` that then
 * re-measures. The funding rack's two lanes are identical, its root never
 * moves, and the observer stays silent. Correct-by-accident is not correct;
 * the key makes the trigger explicit on both racks.
 */
function OrchWires({ rackRef, portfolio, measureKey }: { rackRef: React.RefObject<HTMLDivElement | null>; portfolio: PortfolioGraph; measureKey: string }) {
  const [paths, setPaths] = useState<BusWire[]>([]);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const el = rackRef.current;
    if (!el) return;
    const measure = () => {
      const root = rackRef.current;
      if (!root) return;
      const orchJack = root.querySelector<HTMLElement>('[data-jack="orchestrator:bus"]');
      if (!orchJack) {
        setPaths([]);
        return;
      }
      const rootRect = root.getBoundingClientRect();
      const inverse = resolveInverse(svgRef.current?.getScreenCTM() ?? null, {
        originX: rootRect.left,
        originY: rootRect.top,
        k: root.offsetWidth > 0 && rootRect.width > 0 ? rootRect.width / root.offsetWidth : 1,
      });
      const targets: BusTarget[] = [];
      for (const loop of portfolio.loops) {
        const jack = root.querySelector<HTMLElement>(`[data-jack="${loop.id}/liquidity-source:bus"]`);
        if (!jack) continue;
        targets.push({
          id: loop.id,
          rect: jack.getBoundingClientRect(),
          label: pct((portfolio.orchestrator.allocationsBps[loop.id] ?? 0) / 10000, 0),
        });
      }
      setPaths(orchestratorBusWires(orchJack.getBoundingClientRect(), targets, inverse));
    };
    const raf = requestAnimationFrame(measure);
    const t = setTimeout(measure, 340);
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [rackRef, portfolio, measureKey]);

  return (
    <svg ref={svgRef} className="rk-wires" aria-hidden style={{ zIndex: 1 }}>
      {paths.map((p) => (
        <g key={p.id}>
          <path d={p.d} style={{ stroke: "#d7b9ad", strokeWidth: 5 }} />
          <path d={p.d} style={{ stroke: "#000000", strokeWidth: 3 }} />
          <text
            x={p.x}
            y={p.y}
            textAnchor="middle"
            style={{ fontFamily: '"IBM Plex Mono",monospace', fontSize: 9, fill: "#141210" }}
          >
            {p.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
