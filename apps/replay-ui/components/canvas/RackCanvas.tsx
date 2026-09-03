"use client";

/**
 * RackCanvas (UX_SPEC §0-§4 + UX_ITERATION_3 + UX_ITERATION_4) — the v2
 * composition surface: a hardware rack. One lane per loop, plates are the
 * EXACT landing hm-hw modules, wires are SVG overlays, the canvas always
 * proposes the next action as a ghost slot. No ReactFlow: lanes are CSS flex
 * rows inside a CSS-transform pan/zoom viewport (translate+scale, clamped
 * [0.4, 1.25]); the graph model (PortfolioGraph + pure graph-ops) is
 * unchanged.
 *
 * The workstation is the canvas plus ONE panel: the context dock — Discover
 * (the market catalog), Module (mirrored PlateControls, one store),
 * Lane/Portfolio (risk dial, allocations, orchestrator dials). Dock mode is a
 * PURE DERIVATION of focus + discoverTarget (lib/canvas/dock-state.ts) — the
 * dock is never empty. No takeover ever mounts. (The LLM copilot panel that
 * used to hold the left column is gone with the single-flow strip; the
 * proposal-replay path it shared with the template seed remains.)
 *
 * Owns: portfolio reducer, draft persistence (KV + localStorage), per-lane
 * debounced reprice (350ms), focus (module/orchestrator/lane), stage
 * derivation, the lifted opportunities fetch, review, panel collapse/sheet
 * state.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access,
   @typescript-eslint/no-unsafe-argument,
   @typescript-eslint/no-floating-promises, @typescript-eslint/restrict-template-expressions,
   @typescript-eslint/no-misused-promises, @typescript-eslint/no-unnecessary-type-assertion,
   @typescript-eslint/prefer-nullish-coalescing --
 * Kit-verbatim file (priime-build-ui-kit integration). The unsafe-* findings
 * come from parsing untyped fetch/localStorage JSON (draft persistence, the
 * opportunities payload); not rewriting kit logic to satisfy lint, per the
 * integration's own directive. */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useLayoutEffect } from "react";

import type { LoopGraph, LoopId, ModuleKey, ParamValue, PortfolioGraph } from "@/lib/canvas/types";
import type { StrategyKind } from "@/lib/vaults/store";
import {
  addLoop,
  addModule,
  emptyPortfolio,
  loopById,
  nodeFor,
  removeLoop,
  removeModule,
  renameLoop,
  setAllocation,
  setAllocations,
  updateOrchestratorParam,
  updateParam,
  validateGraph,
  validatePortfolio,
} from "@/lib/canvas/graph-ops";
import { newLoopId, nodeId } from "@/lib/canvas/ids";
import { fromDraft, toDraft } from "@/lib/canvas/serialize";
import {
  LAUNCHABLE_VENUES,
  type CanvasVenueId,
} from "@/lib/canvas/opportunities";
import {
  classifyRepriceFailure,
  invalidatesQuote,
  laneDisplayApy,
} from "@/lib/canvas/reprice-state";
import { catalogRow, composedNetApy, mockQuote } from "@/lib/canvas/mock-quote";
import { buildTemplatePortfolio, templateById } from "@/lib/canvas/templates";
import { venueLabel } from "@/lib/canvas/labels";
import { DISPLAY_ORDER, getDef } from "@/lib/canvas/modules";
import { deriveRiskParams, matchRiskStop, type RiskStop } from "@/lib/canvas/risk-dial";
import {
  deriveDockMode,
  dockRailLabel,
  firstMarketlessLoopId,
  midBuildLoopId,
  type DiscoverTarget,
  type Focus,
} from "@/lib/canvas/dock-state";
import { buildPortfolioFromProposal } from "@/lib/canvas/copilot/apply";
import { buildDemoProposal } from "@/lib/canvas/demo-seed";
import { computeFit } from "@/lib/canvas/fit";
import type { ProposalPayload } from "@/lib/canvas/copilot/tools";
import Lane from "./Lane";
import OrchestratorPlate, { type LaneSignal } from "./OrchestratorPlate";
import ProgressRail, { type RailState } from "./ProgressRail";
import PublishFlow, { type PublishDraft } from "./PublishFlow";
import ContextDock from "./dock/ContextDock";
import type { DockLaneView } from "./dock/LanePanel";
import type { UnifiedRow } from "@/lib/canvas/unified-list";
import type { OpportunitiesPayload, RepriceData } from "./types";

const LS_V2 = "priime:canvas:draft:v2";
const LS_V1 = "priime:canvas:draft:v1";
const LS_PANELS = "priime:canvas:panels:v1";

/** Canvas zoom clamp (UX_ITERATION_3 §2; max raised so the IT4C viewport
 *  fit cap of 1.35 on >=1800px screens is reachable by hand too). */
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 1.35;
/** First-visit panel posture flips to BOTH OPEN at this viewport (IT4C §2).
 *  1280, not 1600: the dock is inline from 1241 up, and a first visit must
 *  show the market picker the step banner points at on a 1440 laptop. */
const PANELS_OPEN_MIN_W = 1280;

type Action =
  | { type: "load"; portfolio: PortfolioGraph }
  | { type: "add-loop" }
  | { type: "remove-loop"; loopId: LoopId }
  | { type: "rename-loop"; loopId: LoopId; label: string }
  | { type: "add-module"; loopId: LoopId; key: ModuleKey }
  | { type: "remove-module"; loopId: LoopId; key: ModuleKey }
  | { type: "param"; loopId: LoopId; key: ModuleKey; field: string; value: ParamValue }
  | { type: "orch-param"; field: string; value: ParamValue }
  | { type: "set-allocations"; allocationsBps: Record<LoopId, number> }
  | { type: "set-allocation"; loopId: LoopId; bps: number };

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
      return addModule(p, a.loopId, a.key);
    case "remove-module":
      return removeModule(p, a.loopId, a.key);
    case "param":
      return updateParam(p, a.loopId, a.key, a.field, a.value);
    case "orch-param":
      return updateOrchestratorParam(p, a.field, a.value);
    case "set-allocations":
      return setAllocations(p, a.allocationsBps);
    case "set-allocation":
      // one lane's share; largest-remainder rebalances the rest to Σ=10000
      return setAllocation(p, a.loopId, a.bps);
  }
}

/** The module params the pricing/compile requests need, per loop. */
function pricingParamsFor(loop: LoopGraph) {
  const src = nodeFor(loop, "liquidity-source");
  const hf = nodeFor(loop, "safety-buffer");
  const hedge = nodeFor(loop, "hedge");
  const compound = nodeFor(loop, "auto-compound");
  const venue = String(src?.data.params.venue ?? "");
  const candidateId = String(src?.data.params.candidateId ?? "");
  return {
    venue,
    candidateId,
    launchableVenue: LAUNCHABLE_VENUES.has(venue as CanvasVenueId),
    riskPreset: String(hf?.data.params.riskPreset ?? "standard") as
      | "conservative"
      | "standard"
      | "aggressive",
    targetLeverage: Number(hf?.data.params.targetLeverage ?? 3),
    hedge: hedge
      ? {
          hedgeLeverage: Number(hedge.data.params.hedgeLeverage ?? 3),
          reserveFraction: Number(hedge.data.params.reserveFraction ?? 0.1),
        }
      : null,
    compound: compound
      ? {
          cadence: String(compound.data.params.cadence ?? "24h") as "6h" | "24h" | "72h",
          minActionUsd: Number(compound.data.params.minActionUsd ?? 25),
        }
      : null,
  };
}

function initialPortfolio(): PortfolioGraph {
  return addLoop(emptyPortfolio()); // lane 1 exists at stage 0 from the first paint
}

function initialPanels(): { dock: boolean } {
  if (typeof window !== "undefined") {
    try {
      const raw = localStorage.getItem(LS_PANELS);
      if (raw) {
        const p = JSON.parse(raw);
        return { dock: !!p.dock }; // the user's choice always wins
      }
    } catch {
      /* best effort */
    }
    // First visit (IT4C §2): >=1600px space is abundant — the workstation
    // shows its full form with the dock open; below that it waits until
    // asked for (open on demand / forcing triggers).
    return { dock: window.innerWidth >= PANELS_OPEN_MIN_W };
  }
  return { dock: true };
}

export default function RackCanvas({ templateId }: { templateId?: string } = {}) {
  // Standalone-kit fix: wallet-free build — RackCanvas only used useAccount to
  // key draft persistence.
  const address = undefined;
  // Template deep link: resolved once from the URL param the /build router
  // passed down. Unknown ids resolve null → the normal empty canvas, never an
  // error.
  const template = useMemo(() => templateById(templateId), [templateId]);
  const [portfolio, dispatch] = useReducer(reducer, undefined, initialPortfolio);
  const [focus, setFocus] = useState<Focus>(null);
  /** Forced Discover target: WHY the dock is in Discover (add/swap). */
  const [discoverTarget, setDiscoverTarget] = useState<DiscoverTarget | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [reprices, setReprices] = useState<Record<LoopId, RepriceData | null>>({});
  const [repricing, setRepricing] = useState<Record<LoopId, boolean>>({});
  const [pulseKeys, setPulseKeys] = useState<Record<LoopId, number>>({});
  const [snapKeys, setSnapKeys] = useState<Set<string>>(new Set());
  const [oppData, setOppData] = useState<OpportunitiesPayload | null>(null);
  const [oppError, setOppError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  /** Lane risk dial state: absent = "balanced" (the default stop, P1-4). */
  const [riskStops, setRiskStops] = useState<Record<LoopId, RiskStop | "custom">>({});
  const [addPulse, setAddPulse] = useState(false);
  /** One honest line when a stored draft failed verification and was reset
   *  (recette P2-6). Dismissable; never silent. */
  const [draftNotice, setDraftNotice] = useState(false);

  // ── Workstation panels ──
  // SSR-deterministic (recette P2-5 hydration fix): closed on the first render
  // pass everywhere; the real default (persisted choice or viewport posture)
  // applies in the mount effect below, before first paint.
  const [panels, setPanels] = useState<{ dock: boolean }>({ dock: false });
  useLayoutEffect(() => {
    setPanels(initialPanels());
  }, []);
  const [sheet, setSheet] = useState<"dock" | null>(null); // mobile only, never persisted
  const [narrow, setNarrow] = useState(false); // 961–1240px: panels overlay
  const [mobile, setMobile] = useState(false); // ≤960px: bottom sheets

  // ── pan/zoom viewport (UX_ITERATION_3 §2) ──
  const [view, setView] = useState({ x: 24, y: 12, s: 1 });
  const [viewAnim, setViewAnim] = useState(false);
  const [panning, setPanning] = useState(false);
  const viewRef = useRef(view);
  // A pan (and a wheel burst) drives the board through the DOM directly and
  // commits ONE setView at the end, so the whole board does not reconcile per
  // pointer event. While that fast path owns the view, the committed state is
  // behind and must not clobber the live value.
  const viewLiveRef = useRef(false);
  if (!viewLiveRef.current) viewRef.current = view;
  const didPanRef = useRef(false);
  const animTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelRaf = useRef<number | null>(null);

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
  const viewportRef = useRef<HTMLDivElement | null>(null);

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

  // Entering the narrow band: the dock defaults closed (overlay-on-demand).
  useEffect(() => {
    if (narrow) setPanels({ dock: false });
  }, [narrow]);

  // Best-effort persistence of the collapse state (never the mobile sheet).
  useEffect(() => {
    try {
      localStorage.setItem(LS_PANELS, JSON.stringify(panels));
    } catch {
      /* private mode */
    }
  }, [panels]);

  /** Forcing triggers land here: a forced dock mode must never land in a
   *  collapsed panel. The copilot never auto-opens. */
  const openDock = useCallback(() => {
    if (mobile) {
      setSheet("dock");
      return;
    }
    setPanels((p) => (p.dock ? p : { dock: true }));
  }, [mobile]);

  const toggleDock = useCallback(() => {
    if (mobile) {
      setSheet((s) => (s === "dock" ? null : "dock"));
      return;
    }
    setPanels((p) => ({ dock: !p.dock }));
  }, [mobile]);

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
    (async () => {
      let corrupt = false;
      try {
        if (address) {
          try {
            const res = await fetch(`/api/canvas/draft?address=${address}`);
            const body = await res.json();
            const p = body?.draft ? await fromDraft(body.draft) : null;
            if (body?.draft && !p) corrupt = true;
            if (p && p.loops.length > 0) {
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
          if (p2 && p2.loops.length > 0) {
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
          if (p1 && p1.loops.length > 0) {
            dispatch({ type: "load", portfolio: p1 });
            localStorage.setItem(LS_V2, JSON.stringify(await toDraft(p1, Date.now())));
            localStorage.removeItem(LS_V1);
            corrupt = false;
          }
        } catch {
          corrupt = true; // unparseable JSON in LS is a corrupt draft too
          // Clear the bad keys, or the notice returns on every visit.
          localStorage.removeItem(LS_V2);
          localStorage.removeItem(LS_V1);
        }
      } finally {
        if (corrupt) setDraftNotice(true);
        setRestored(true);
      }
    })();
  }, [address, template]);

  // ── Lifted opportunities fetch (one fetch for the whole workstation) ──
  useEffect(() => {
    let alive = true;
    fetch("/api/canvas/opportunities")
      .then((r) => r.json())
      .then((b) => alive && setOppData(b))
      .catch(() => alive && setOppError("catalog unreachable"));
    return () => {
      alive = false;
    };
  }, []);

  // ── Debounced persist on every change ──
  useEffect(() => {
    if (!loadedRef.current) return;
    if (demoRef.current) return; // demo state is disposable, never a draft
    if (template) return; // template state is disposable too — the user's draft survives underneath
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
      const gated = p.candidateId && p.launchableVenue && !!nodeFor(loop, "safety-buffer");
      if (!gated) {
        if (repriceSigs.current[loop.id]) {
          delete repriceSigs.current[loop.id];
          setReprices((m) => ({ ...m, [loop.id]: null }));
        }
        continue;
      }
      const sig = JSON.stringify([
        p.venue,
        p.candidateId,
        p.targetLeverage,
        p.riskPreset,
        p.hedge?.hedgeLeverage,
        p.hedge?.reserveFraction,
        !!p.hedge,
      ]);
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
          // A 404 carries no body, and any answer may be unparseable: read
          // the body defensively so the STATUS drives classification.
          const body = res.status === 404 ? null : await res.json().catch(() => null);
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
        if (reviewOpen) setReviewOpen(false);
        else if (mobile && sheet) setSheet(null);
        else if (discoverTarget) setDiscoverTarget(null);
        else setFocus(null);
        return;
      }
      const el = document.activeElement as HTMLElement | null;
      const editable =
        !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (editable) return;
      if (e.key === "]") toggleDock();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reviewOpen, discoverTarget, mobile, sheet, toggleDock]);

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

  // ── Lane risk dial (UX_ITERATION_3 §3) — pure UI derivation ──

  const stopFor = useCallback(
    (loopId: LoopId): RiskStop | "custom" => riskStops[loopId] ?? "balanced",
    [riskStops],
  );

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

  /** Write the stop's derived params through the SAME clamps as any dial. */
  const applyRiskWithLt = useCallback((loopId: LoopId, stop: RiskStop, lt: number) => {
    const d = deriveRiskParams(stop, lt);
    setRiskStops((m) => ({ ...m, [loopId]: stop }));
    dispatch({ type: "param", loopId, key: "safety-buffer", field: "targetLeverage", value: d.targetLeverage });
    dispatch({ type: "param", loopId, key: "safety-buffer", field: "riskPreset", value: d.riskPreset });
  }, []);

  const markCustom = useCallback((loopId: LoopId) => {
    setRiskStops((m) => (m[loopId] === "custom" ? m : { ...m, [loopId]: "custom" }));
  }, []);

  // Restored drafts: infer each lane's dial position from its stored params
  // (exact stop match or Custom). Never overwrites an explicit stop, but a
  // lane READING "custom" whose params exactly match a stop snaps back to
  // that stop (recette P2-10: the chip is config-derived, not touch-derived
  // — two byte-identical configs must never label differently).
  useEffect(() => {
    if (!oppData) return;
    setRiskStops((m) => {
      let changed = false;
      const n = { ...m };
      for (const loop of portfolio.loops) {
        const hf = nodeFor(loop, "safety-buffer");
        const src = nodeFor(loop, "liquidity-source");
        if (!hf || String(src?.data.params.candidateId ?? "") === "") continue;
        const inferred = matchRiskStop(hf.data.params, ltFor(loop));
        if (n[loop.id] === undefined) {
          n[loop.id] = inferred;
          changed = true;
        } else if (n[loop.id] === "custom" && inferred !== "custom") {
          n[loop.id] = inferred;
          changed = true;
        }
      }
      return changed ? n : m;
    });
  }, [oppData, portfolio, ltFor]);

  const installDefaults = useCallback(
    (loopId: LoopId) => {
      const loop = loopById(portfolio, loopId);
      if (!loop) return;
      const lt = ltFor(loop);
      const stop = stopFor(loopId);
      // Default composition (founder ruling 2026-08-20): leverage + compound.
      // The hedge never self-installs; it is added from the dock on demand.
      const remaining: ModuleKey[] = (["safety-buffer", "auto-compound"] as ModuleKey[]).filter(
        (k) => !nodeFor(loop, k),
      );
      remaining.forEach((k, i) => {
        setTimeout(() => {
          dispatch({ type: "add-module", loopId, key: k });
          markSnap([nodeId(loopId, k)]);
          if (k === "safety-buffer" && stop !== "custom" && lt !== null) {
            applyRiskWithLt(loopId, stop, lt);
          }
        }, i * 160); // one-by-one snap, 160ms stagger
      });
    },
    [portfolio, markSnap, ltFor, stopFor, applyRiskWithLt],
  );

  const validation = useMemo(() => validatePortfolio(portfolio), [portfolio]);

  const laneComputed = useMemo(() => {
    return portfolio.loops.map((loop) => {
      const p = pricingParamsFor(loop);
      const server = reprices[loop.id] ?? null;
      const serverOk = server?.ok === true ? server : null;
      // Mockup register: every picked market prices. The live rail wins when
      // it answered; otherwise the latest catalog scan prices the lane
      // client-side. Failure states never render.
      const hit = serverOk ? null : catalogRow(oppData, p.candidateId);
      const q: RepriceData | null = serverOk ?? (hit ? mockQuote(hit, p.targetLeverage, p.riskPreset, Date.now()) : null);
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
      const rawNetApy = composedNetApy(ok?.candidate, laneHasHedge);
      const netApy = laneDisplayApy(rawNetApy, classCoherent);
      const laneReviewable = graphOk && !!p.candidateId && netApy !== null;
      // P1-4 narration: with borrow above yield at the margin, every extra
      // turn of leverage models LESS yield — the header says so in one line.
      const econ = ok?.candidate?.economics ?? null;
      const leverageYieldNegative = econ !== null && econ.borrowApyMarginal > econ.collateralYieldApy;
      return { loop, p, q, ok, graphOk, classCoherent, laneReviewable, netApy, leverageYieldNegative };
    });
  }, [portfolio, reprices, oppData]);

  const orchOn = portfolio.orchestrator.enabled && portfolio.loops.length >= 2;
  const allLanesReviewable = laneComputed.length > 0 && laneComputed.every((l) => l.laneReviewable);
  // Review arming, mockup register: every lane priced + a valid portfolio.
  const reviewable =
    validation.ok &&
    allLanesReviewable &&
    (!orchOn || validation.launchShapedLoopIds.length >= 2);
  const reviewReason = reviewable
    ? null
    : laneComputed.some((l) => !l.p.candidateId)
      ? "pick a market for every loop"
      : "finish the spine to arm publishing";
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

  // ── Hero portfolio APY (UX_ITERATION_3 §4): allocation-weighted blend;
  //    a single loop IS the portfolio. Any missing lane quote nulls the
  //    blend — a partial blend would lie. ──
  const allocBps = portfolio.orchestrator.allocationsBps;
  const portfolioApy = useMemo(() => {
    if (laneComputed.length === 0) return null;
    if (laneComputed.length === 1) return laneComputed[0]!.netApy;
    let acc = 0;
    for (const l of laneComputed) {
      if (typeof l.netApy !== "number") return null;
      acc += ((allocBps[l.loop.id] ?? 0) / 10000) * l.netApy;
    }
    return acc;
  }, [laneComputed, allocBps]);

  // Block pin for the hero: the OLDEST quoted block across lanes (every
  // number shown is valid at-or-after it).
  const heroBlock = useMemo(() => {
    const blocks = laneComputed
      .map((l) => l.ok?.blockNumber ?? null)
      .filter((b): b is number => typeof b === "number");
    return blocks.length > 0 ? Math.min(...blocks) : null;
  }, [laneComputed]);

  // ── Stage-aware guide line (UX_ITERATION_3 §5): always the next action.
  //    Quote failures are TRUTH states with a way out (P0-1): "Waiting on
  //    the live quote" may only ever describe an in-flight request. ──
  const anyQuoting = Object.values(repricing).some(Boolean);
  const guide = useMemo(() => {
    if (laneComputed.length === 0 || !anyMarket) return "Pick your first market";
    const noSpine = laneComputed.find((l) => l.p.candidateId && !l.graphOk);
    if (noSpine) {
      const coherence = validateGraph(noSpine.loop).issues.find(
        (i) => i.code === "unhedged-class-forbids-hedge",
      );
      if (coherence) return coherence.message;
      return "Install the defaults, then tune if you like";
    }
    const empty = laneComputed.find((l) => !l.p.candidateId);
    if (empty) return `Pick a market for ${empty.loop.label}`;
    if (!allLanesReviewable) return "Waiting on the modeled quote";
    // No second-loop prompt: the add-a-loop affordance is retired (see
    // `showAddLane`), so the hint would advise a move the canvas no longer has.
    if (laneComputed.length === 1) return "Review and publish when ready";
    return "Review when ready";
  }, [laneComputed, anyMarket, allLanesReviewable]);

  // ── One-shot ADD A LOOP pulse after the first lane completes (§5). ──
  useEffect(() => {
    if (addPulsedRef.current) return;
    if (laneComputed.length === 1 && laneComputed[0]!.laneReviewable) {
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
  const railSteps = useMemo(() => {
    const lane = railLane;
    const state = (done: boolean, now: boolean): RailState => (done ? "done" : now ? "now" : "todo");
    if (!lane) {
      return [
        { label: "Market", state: "now" as RailState },
        { label: "Leverage", state: "todo" as RailState },
        { label: "Compound", state: "todo" as RailState },
        { label: "Publish", state: "todo" as RailState },
      ];
    }
    const hasMarket = !!lane.p.candidateId;
    const hasSafety = !!nodeFor(lane.loop, "safety-buffer");
    const hasHedge = !!nodeFor(lane.loop, "hedge");
    const hasCompound = !!nodeFor(lane.loop, "auto-compound");
    return [
      { label: "Market", state: state(hasMarket, true) },
      { label: "Leverage", state: state(hasSafety, hasMarket) },
      // the hedge is opt-in: it earns a segment only once placed
      ...(hasHedge ? [{ label: "Hedge", state: "done" as RailState }] : []),
      { label: "Compound", state: state(hasCompound, hasMarket && hasSafety) },
      { label: "Publish", state: state(reviewable, lane.laneReviewable) },
    ];
  }, [railLane, reviewable]);

  const orchSignals: LaneSignal[] = laneComputed.map((l) => ({
    loopId: l.loop.id,
    label: l.loop.label,
    allocationBps: portfolio.orchestrator.allocationsBps[l.loop.id] ?? 0,
    drying: false, // mockup register: no drying warnings on the canvas
    noQuote: false,
  }));

  // The ghost add-a-loop lane is retired for this demo. There is one market and
  // one template, so its only outcome was duplicating the same loop and
  // summoning the orchestrator; the canvas now composes the single vault and
  // hands off to /vault. Hidden at the render site only — the lane machinery
  // underneath (graph-ops, the orchestrator) is untouched and comes back by
  // restoring this predicate.
  const showAddLane = false;

  // ── Publish draft: the Review and Publish input. One composition survives
  //    the strip, the leveraged loop; a multi-lane portfolio still publishes
  //    the loop-portfolio register. ──
  const publishDraft = useMemo<PublishDraft>(() => {
    const lanes = laneComputed;
    const first = lanes[0];
    const pair = first
      ? String(nodeFor(first.loop, "liquidity-source")?.data.params.pairLabel ?? "")
      : "";
    const collateral = pair.split("/")[0] || "ETH";
    const single = lanes.length === 1;
    const moduleNames: string[] = [];
    const moduleLines: { name: string; line: string }[] = [];
    for (const key of DISPLAY_ORDER) {
      if (lanes.some((l) => nodeFor(l.loop, key))) {
        const def = getDef(key);
        moduleNames.push(def.name);
        moduleLines.push({ name: def.name, line: def.tagline });
      }
    }
    if (orchOn) {
      moduleNames.push("Yield router");
      moduleLines.push({ name: "Yield router", line: "Routes deposits across loops toward modeled yield" });
    }
    const venue = single && first ? venueLabel(first.p.venue) : "Multi-venue";
    const params: { label: string; value: string }[] =
      single && first
        ? [
            { label: "Market", value: pair || "…" },
            { label: "Venue", value: venue },
            { label: "Target leverage", value: `${first.p.targetLeverage.toFixed(2)}x` },
            {
              label: "Risk profile",
              value: first.p.riskPreset.charAt(0).toUpperCase() + first.p.riskPreset.slice(1),
            },
            ...(first.p.compound ? [{ label: "Compound cadence", value: first.p.compound.cadence }] : []),
          ]
        : lanes.map((l) => ({
            label: l.loop.label,
            value: `${String(nodeFor(l.loop, "liquidity-source")?.data.params.pairLabel ?? "")} · ${((portfolio.orchestrator.allocationsBps[l.loop.id] ?? 0) / 100).toFixed(0)}%`,
          }));
    const kind: { strategy: StrategyKind; strategyLabel: string; defaultName: string; summary: string } = {
      strategy: "loop",
      strategyLabel: single ? "Leveraged loop" : "Loop portfolio",
      defaultName: single ? `My ${collateral} loop` : "My loop portfolio",
      summary: single
        ? `${pair || "A loop"} on ${venue}, ${(first?.p.targetLeverage ?? 3).toFixed(1)}x target, auto-managed end to end.`
        : `${lanes.length} loops with the router following modeled yield.`,
    };
    return {
      defaultName: kind.defaultName,
      strategy: kind.strategy,
      strategyLabel: kind.strategyLabel,
      summary: kind.summary,
      venue,
      market: single ? pair || "…" : `${lanes.length} markets`,
      modules: moduleNames,
      moduleLines,
      params,
      modeledApy: portfolioApy ?? 0,
    };
  }, [laneComputed, orchOn, portfolio, portfolioApy]);

  // ── IT4 focus/discover wiring (trigger table §2.3) ──

  const focusModule = useCallback(
    (loopId: LoopId, key: ModuleKey) => {
      setFocus({ kind: "module", loopId, key });
      setDiscoverTarget(null); // a plate click while Discover is forced means the user moved on
      openDock();
    },
    [openDock],
  );

  const focusLane = useCallback(
    (loopId: LoopId) => {
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

  /** Pick a row in Discover — same body as the retired takeover's onSelect,
   *  targeting the pending lane; an idle-Discover pick first creates a lane
   *  (same path as ADD A LOOP). After every pick the dock lands in Lane mode
   *  and the canvas spine self-proposes. */
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
      const src = loop ? nodeFor(loop, "liquidity-source") : null;
      if (!src) {
        dispatch({ type: "add-module", loopId, key: "liquidity-source" });
        markSnap([nodeId(loopId, "liquidity-source")]);
      }
      for (const [f, v] of Object.entries(fields)) {
        dispatch({ type: "param", loopId, key: "liquidity-source", field: f, value: v });
      }
      // the risk dial re-derives against the picked market's lt
      const stop = stopFor(loopId);
      if (loop && nodeFor(loop, "safety-buffer") && stop !== "custom" && typeof row.lt === "number") {
        applyRiskWithLt(loopId, stop, row.lt);
      }
      setDiscoverTarget(null);
      setFocus({ kind: "lane", loopId });
    },
    [discoverTarget, laneFacts, portfolio, markSnap, stopFor, applyRiskWithLt, invalidateQuote],
  );

  /** Apply a composed proposal: ONE atomic reducer commit; the persist effect
   *  saves the draft, the reprice-signature effect fires a live reprice per
   *  lane, validation re-runs via the memo. Used by the demo seed. */
  const applyProposal = useCallback(
    (p: ProposalPayload) => {
      const { portfolio: built, riskStops: rs, nodeIds } = buildPortfolioFromProposal(p);
      dispatch({ type: "load", portfolio: built });
      setRiskStops((m) => ({ ...m, ...rs }));
      markSnap(nodeIds);
      setDiscoverTarget(null);
      setFocus(null);
    },
    [markSnap],
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
    setRiskStops((m) => ({ ...m, ...built.riskStops }));
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
      })),
    [laneComputed, repricing],
  );

  // ── Viewport navigation (UX_ITERATION_3 §2) ──

  const clampScale = (s: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s));

  /** Write a view straight to the two elements that consume it — the board's
   *  grid offset and the viewport transform. Same values React renders, so a
   *  later commit repaints them identically. */
  const applyViewToDom = useCallback((v: { x: number; y: number; s: number }) => {
    const vp = viewportRef.current;
    if (vp) vp.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.s})`;
    const bd = boardRef.current;
    if (bd) bd.style.backgroundPosition = `${v.x}px ${v.y}px`;
  }, []);

  // Any unrelated re-render mid-gesture would repaint the committed (stale)
  // view, so re-apply the live one before paint.
  useLayoutEffect(() => {
    if (viewLiveRef.current) applyViewToDom(viewRef.current);
  });

  const animateView = useCallback((next: { x: number; y: number; s: number }) => {
    setViewAnim(true);
    if (animTimer.current) clearTimeout(animTimer.current);
    animTimer.current = setTimeout(() => setViewAnim(false), 360);
    viewRef.current = next; // keep same-tick reads (rapid key presses) fresh
    setView(next);
  }, []);

  /** Adaptive zoom-to-fit (IT4C §1): the pure math lives in lib/canvas/fit.
   *  The board column IS the available width (the workstation grid already
   *  subtracts open panels); the rack hugs its lanes (width:max-content in
   *  the IT4C css), so offsetWidth/Height are real lane bounds. */
  const fitView = useCallback(() => {
    const board = boardRef.current;
    const rack = rackRef.current;
    if (!board || !rack) return;
    const fit = computeFit({
      availableWidth: board.clientWidth,
      availableHeight: board.clientHeight,
      contentWidth: rack.offsetWidth,
      contentHeight: rack.offsetHeight,
      viewportWidth: window.innerWidth,
    });
    if (!fit) return;
    animateView(fit);
  }, [animateView]);

  const zoomBy = useCallback(
    (factor: number) => {
      const board = boardRef.current;
      if (!board) return;
      const v = viewRef.current;
      const s = clampScale(v.s * factor);
      if (s === v.s) return;
      const cx = board.clientWidth / 2;
      const cy = board.clientHeight / 2;
      const px = (cx - v.x) / v.s;
      const py = (cy - v.y) / v.s;
      animateView({ s, x: cx - px * s, y: cy - py * s });
    },
    [animateView],
  );

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
        next = { s, x: cx - px * s, y: cy - py * s };
      } else {
        next = { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY };
      }
      viewRef.current = next; // wheel bursts outpace renders — keep reads fresh
      viewLiveRef.current = true;
      applyViewToDom(next); // paint this event now; commit once per frame
      if (wheelRaf.current === null) {
        wheelRaf.current = requestAnimationFrame(() => {
          wheelRaf.current = null;
          viewLiveRef.current = false;
          setView(viewRef.current);
        });
      }
    };
    board.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      board.removeEventListener("wheel", onWheel);
      if (wheelRaf.current !== null) cancelAnimationFrame(wheelRaf.current);
      wheelRaf.current = null;
    };
  }, [applyViewToDom]);

  const isCanvasBackground = (t: EventTarget | null) => {
    const el = t as HTMLElement | null;
    return !el?.closest(".rk-plate,.rk-slot,.rk-addlane,.rk-nav,.rk-lanename,button,input,select,textarea");
  };

  const onBoardPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0 || !isCanvasBackground(e.target)) return;
      setViewAnim(false);
      didPanRef.current = false;
      const start = { px: e.clientX, py: e.clientY, x: viewRef.current.x, y: viewRef.current.y };
      viewLiveRef.current = true; // the drag owns the view until pointerup
      setPanning(true);
      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - start.px;
        const dy = ev.clientY - start.py;
        if (Math.abs(dx) + Math.abs(dy) > 3) didPanRef.current = true;
        const next = { ...viewRef.current, x: start.x + dx, y: start.y + dy };
        viewRef.current = next;
        applyViewToDom(next); // no setView per pointer event: the board would
        // reconcile every lane, plate and wire on each move
      };
      const onUp = () => {
        viewLiveRef.current = false;
        setPanning(false);
        setView(viewRef.current); // the one commit for the whole gesture
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [applyViewToDom],
  );

  // zoom-to-fit on lane add/remove (after the snap/zoom transitions settle)
  useEffect(() => {
    const t = setTimeout(fitView, 380);
    return () => clearTimeout(t);
  }, [portfolio.loops.length, fitView]);

  // IT4C: the rack hugs its lanes, so its layout size IS the content size —
  // any growth (module installs, ghost slots, focus width changes) re-fits,
  // debounced past the plate transitions. Transforms do not affect layout
  // size, so the fit animation itself never re-triggers this.
  useEffect(() => {
    const rack = rackRef.current;
    if (!rack) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver(() => {
      if (t) clearTimeout(t);
      t = setTimeout(fitView, 220);
    });
    ro.observe(rack);
    return () => {
      if (t) clearTimeout(t);
      ro.disconnect();
    };
  }, [fitView]);

  // board width changes on every panel collapse/expand — refit after the
  // grid transition finishes (IT4 §1.2)
  useEffect(() => {
    const t = setTimeout(fitView, 300);
    return () => clearTimeout(t);
  }, [panels.dock, fitView]);

  // window resize re-fits too, debounced 200ms (IT4C §1)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      if (t) clearTimeout(t);
      t = setTimeout(fitView, 200);
    };
    window.addEventListener("resize", onResize);
    return () => {
      if (t) clearTimeout(t);
      window.removeEventListener("resize", onResize);
    };
  }, [fitView]);

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
          reviewable={reviewable}
          reviewReason={reviewReason}
          guide={guide}
          saveState={saveState}
          notice={draftNotice ? "Your saved draft could not be verified and was reset." : null}
          onDismissNotice={() => setDraftNotice(false)}
          dockOpen={panels.dock}
          onToggleDock={toggleDock}
          onReview={() => setReviewOpen(true)}
        />
      </header>

      <div
        className="bc-work"
        data-dock={panels.dock ? "open" : "closed"}
        data-narrow={narrow ? "true" : undefined}
        data-sheet={mobile && sheet ? sheet : undefined}
      >
        <div
          className={`rk-board${panning ? " rk-board--panning" : ""}`}
          ref={boardRef}
          style={{ backgroundPosition: `${view.x}px ${view.y}px` }}
          onPointerDown={onBoardPointerDown}
          onDoubleClick={(e) => {
            if (isCanvasBackground(e.target)) fitView();
          }}
          onClick={() => {
            if (didPanRef.current) {
              didPanRef.current = false;
              return;
            }
            // canvas click clears BOTH in one shot (IT4 §2.4); on narrow /
            // mobile it also closes the overlay/sheet
            setDiscoverTarget(null);
            setFocus(null);
            if (narrow) setPanels({ dock: false });
            if (mobile) setSheet(null);
          }}
        >
          <div
            className={`rk-viewport${viewAnim ? " rk-viewport--anim" : ""}`}
            ref={viewportRef}
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }}
          >
            <div className={`rk-rack${portfolio.loops.length >= 2 ? " rk-rack--multi" : ""}`} ref={rackRef}>
              {orchOn ? (
                <div className="rk-orchcol">
                  <OrchestratorPlate
                    loops={portfolio.loops}
                    signals={orchSignals}
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
                    laneFocused={
                      portfolio.loops.length < 2 ||
                      (focus?.kind === "module" && focus.loopId === l.loop.id) ||
                      (focus?.kind === "lane" && focus.loopId === l.loop.id) ||
                      discoverTarget?.loopId === l.loop.id
                    }
                    reprice={l.q}
                    repricing={repricing[l.loop.id] ?? false}
                    netApy={l.netApy}
                    laneReviewable={l.laneReviewable}
                    leverageYieldNegative={l.leverageYieldNegative}
                    allocationBps={orchOn ? (portfolio.orchestrator.allocationsBps[l.loop.id] ?? 0) : null}
                    snapKeys={snapKeys}
                    pulseKey={pulseKeys[l.loop.id] ?? 0}
                    canRemove={portfolio.loops.length > 1}
                    onAdvancedTouch={() => markCustom(l.loop.id)}
                    onFocusModule={(key) => focusModule(l.loop.id, key)}
                    onFocusLane={() => focusLane(l.loop.id)}
                    onOpenCatalog={() => openSwap(l.loop.id)}
                    onInstallDefaults={() => installDefaults(l.loop.id)}
                    onAddModule={(key) => {
                      if (invalidatesQuote(key)) invalidateQuote(l.loop.id);
                      dispatch({ type: "add-module", loopId: l.loop.id, key });
                      markSnap([nodeId(l.loop.id, key)]);
                      if (key === "safety-buffer") {
                        const stop = stopFor(l.loop.id);
                        const lt = ltFor(l.loop);
                        if (stop !== "custom" && lt !== null) applyRiskWithLt(l.loop.id, stop, lt);
                      }
                    }}
                    onParam={(key, field, value) => dispatch({ type: "param", loopId: l.loop.id, key, field, value })}
                    onEject={(key) => {
                      if (invalidatesQuote(key)) invalidateQuote(l.loop.id);
                      dispatch({ type: "remove-module", loopId: l.loop.id, key });
                      setFocus(null);
                    }}
                    onRename={(label) => dispatch({ type: "rename-loop", loopId: l.loop.id, label })}
                    onRemoveLoop={() => {
                      dispatch({ type: "remove-loop", loopId: l.loop.id });
                      setFocus(null);
                    }}
                  />
                ))}
                {showAddLane ? (
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
              {orchOn ? <OrchWires rackRef={rackRef} portfolio={portfolio} /> : null}
            </div>
          </div>

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
          onParam={(loopId, key, field, value) => dispatch({ type: "param", loopId, key, field, value })}
          onEject={(loopId, key) => {
            if (invalidatesQuote(key)) invalidateQuote(loopId);
            dispatch({ type: "remove-module", loopId, key });
            setFocus(null);
          }}
          onAdvancedTouch={markCustom}
          onOrchParam={(field, value) => dispatch({ type: "orch-param", field, value })}
          onAlloc={(loopId, bps) => dispatch({ type: "set-allocation", loopId, bps })}
          onSelectMarket={onSelectMarket}
          onSwap={openSwap}
          onInstallDefaults={installDefaults}
          onAddModule={(loopId, key) => {
            if (invalidatesQuote(key)) invalidateQuote(loopId);
            dispatch({ type: "add-module", loopId, key });
            markSnap([nodeId(loopId, key)]);
          }}
          onRemoveLoop={(loopId) => {
            dispatch({ type: "remove-loop", loopId });
            setFocus(null);
          }}
        />

        {mobile ? (
          <div className="sheet-keys">
            <button type="button" className="hm-key" data-key="sheet-dock" onClick={toggleDock}>
              <span className="hm-led" />
              {dockRailLabel(dockMode)}
            </button>
          </div>
        ) : null}
      </div>

      {reviewOpen ? <PublishFlow draft={publishDraft} onClose={() => setReviewOpen(false)} /> : null}
    </div>
  );
}

/**
 * Orchestrator bus drops: one cable from the orchestrator's bus jack to each
 * lane's source-plate bus jack, with the allocation share at the midpoint.
 * Landing bus cable chrome: #d7b9ad under #000 (widths adapted 5/3 so both
 * read at canvas scale). Coordinates divide by the viewport transform scale
 * (the SVG lives inside the transform).
 */
function OrchWires({ rackRef, portfolio }: { rackRef: React.RefObject<HTMLDivElement | null>; portfolio: PortfolioGraph }) {
  const [paths, setPaths] = useState<{ d: string; label: string; x: number; y: number }[]>([]);

  useEffect(() => {
    const el = rackRef.current;
    if (!el) return;
    const measure = () => {
      const root = rackRef.current;
      if (!root) return;
      const rootRect = root.getBoundingClientRect();
      const k = root.offsetWidth > 0 && rootRect.width > 0 ? rootRect.width / root.offsetWidth : 1;
      const orchJack = root.querySelector<HTMLElement>('[data-jack="orchestrator:bus"]');
      if (!orchJack) {
        setPaths([]);
        return;
      }
      const o = orchJack.getBoundingClientRect();
      const ox = (o.left + o.width / 2 - rootRect.left) / k;
      const oy = (o.top + o.height / 2 - rootRect.top) / k;
      const next: { d: string; label: string; x: number; y: number }[] = [];
      for (const loop of portfolio.loops) {
        const jack = root.querySelector<HTMLElement>(`[data-jack="${loop.id}/liquidity-source:bus"]`);
        if (!jack) continue;
        const j = jack.getBoundingClientRect();
        const tx = (j.left + j.width / 2 - rootRect.left) / k;
        const ty = (j.top + j.height / 2 - rootRect.top) / k;
        const sag = 34 + Math.abs(ty - oy) * 0.12;
        next.push({
          d: `M ${ox.toFixed(1)} ${oy.toFixed(1)} C ${ox.toFixed(1)} ${(oy + sag).toFixed(1)}, ${tx.toFixed(1)} ${(ty + sag).toFixed(1)}, ${tx.toFixed(1)} ${ty.toFixed(1)}`,
          label: `${((portfolio.orchestrator.allocationsBps[loop.id] ?? 0) / 100).toFixed(0)}%`,
          x: (ox + tx) / 2,
          y: (oy + ty) / 2 + sag * 0.72,
        });
      }
      setPaths(next);
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
  }, [rackRef, portfolio]);

  return (
    <svg className="rk-wires" aria-hidden style={{ zIndex: 1 }}>
      {paths.map((p, i) => (
        <g key={i}>
          <path d={p.d} style={{ stroke: "#d7b9ad", strokeWidth: 5 }} />
          <path d={p.d} style={{ stroke: "#000000", strokeWidth: 3 }} />
          <text
            x={p.x}
            y={p.y}
            textAnchor="middle"
            style={{ fontFamily: "var(--fm)", fontSize: 9, fill: "#141210" }}
          >
            {p.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
