"use client";

/**
 * ContextDock (IT4_DOCK_SPEC §1/§2, mockup register 2026-08-20) — the
 * right-panel context dock shell: header with the mode kicker + collapse
 * key, the collapsed rail (whole strip re-opens; label stays honest about
 * the current mode), and the mode switch over Discover / Module / Compose /
 * Portfolio panels. The dock is NEVER empty and never closes — the
 * collapse key is the only dismiss.
 *
 * 2026-08-22 — the `lane` mode is gone and `compose` replaces the catalog as
 * the resting panel (COMPOSE_PANEL_SPEC §3.1). Scroll position resets when
 * `mode.kind` changes and is PRESERVED when only the compose scope changes:
 * scoping to a lane you were already reading is not a new screen.
 */

import { useEffect, useRef } from "react";
import type { LoopId, ModuleKey, ParamValue, PortfolioGraph } from "@/lib/canvas/types";
import { committedFamilies, nodeFor } from "@/lib/canvas/graph-ops";
import { pricingParamsFor } from "@/lib/canvas/pricing-params";
import { dockRailLabel, dockRailLit, type DockMode } from "@/lib/canvas/dock-state";
import type { UnifiedRow } from "@/lib/canvas/unified-list";
import DiscoverPanel, { discoverKicker } from "./DiscoverPanel";
import ModulePanel from "./ModulePanel";
import ComposePanel from "./ComposePanel";
import { PortfolioVariant, type DockLaneView } from "./LanePanel";
import type { OpportunitiesPayload } from "../types";
import type { ProjectedCandidate } from "@/lib/canvas/opportunities";

export interface ContextDockProps {
  mode: DockMode;
  collapsed: boolean;
  onToggleCollapse: () => void;
  portfolio: PortfolioGraph;
  lanes: DockLaneView[];
  oppData: OpportunitiesPayload | null;
  oppError: string | null;
  onParam: (loopId: string, key: ModuleKey, field: string, value: ParamValue) => void;
  onEject: (loopId: string, key: ModuleKey) => void;
  /** One leverage stop, written straight through to the safety-buffer param
   *  the lane already stores. There is no separate risk state to set. */
  onSetLeverage: (loopId: LoopId, leverage: number) => void;
  onOrchParam: (field: string, value: ParamValue) => void;
  /** One lane's allocation share in bps (P1-6). */
  onAlloc: (loopId: string, bps: number) => void;
  onSelectMarket: (fields: Record<string, string>, row: UnifiedRow) => void;
  onSwap: (loopId: string) => void;
  onInstallDefaults: (loopId: string) => void;
  /** The UNREPRICED catalog row behind a lane, for the reclaim readout (P0-E).
   *  Forwarded verbatim: this dock is a pass-through for it and must not
   *  substitute `lane.reprice.candidate`, which is already repriced and would
   *  collapse the dominance sweep onto the lane's current leverage. */
  scanRowFor?: (loopId: LoopId) => ProjectedCandidate | null;
  /** Which lane compose is scoped to (null = the whole portfolio). */
  scopeLoopId: LoopId | null;
  portfolioApy: number | null;
  vaultCapacityUsd: number | null;
  showAddLane: boolean;
  onFocusModule: (loopId: LoopId, key: ModuleKey) => void;
  onFocusOrchestrator: () => void;
  onAddLane: () => void;
  /** Add a module from the compose panel. `origin` is the pressed key's own
   *  rect: the dart departs from under the finger, which is the entire
   *  cause-and-effect argument between the panel and the canvas. */
  onAddModule: (loopId: string, key: ModuleKey, origin: DOMRect | null) => void;
  /** Eject a module from the COMPOSE panel — unlike `onEject` (the module
   *  panel's key, which closes the panel it lives in) this keeps lane focus,
   *  because the control must survive its own click. */
  onEjectModule: (loopId: string, key: ModuleKey, origin: DOMRect | null) => void;
  onRemoveLoop: (loopId: string) => void;
}

export default function ContextDock(props: ContextDockProps) {
  const { mode, portfolio, lanes } = props;
  const laneOf = (loopId: string | null) => lanes.find((l) => l.loop.id === loopId) ?? null;

  /* THE LAST LANE COMPOSE WAS SCOPED TO. `bodyKey` below kills the remount on
     a scope move, but compose can still be left and re-entered through a
     module (module → board-void click → unscoped compose), and that remount
     would land on `lanes[0]`. This ref lives in the dock, which does not
     remount, so the panel comes back where the user left it. */
  const lastScopedRef = useRef<LoopId | null>(null);
  if (mode.kind === "compose" && mode.scopeLoopId) lastScopedRef.current = mode.scopeLoopId;

  let kicker = "Markets";
  if (mode.kind === "discover") {
    kicker = discoverKicker(mode.reason, laneOf(mode.targetLoopId)?.loop.label ?? null);
  } else if (mode.kind === "module") {
    // raw loop ids never render (P2-1): a stale focus falls back to the bare kicker
    const label = laneOf(mode.loopId)?.loop.label;
    kicker = label ? `Module · ${label}` : "Module";
  } else if (mode.kind === "compose") {
    /* A single-lane portfolio renders WITHOUT accordion chrome, so the lane's
       name lives here — that is the whole reason the card can drop its
       header. A collapse control for a set of one is chrome pretending there
       is a choice. */
    const label =
      laneOf(mode.scopeLoopId)?.loop.label ?? (lanes.length === 1 ? lanes[0].loop.label : null);
    kicker = label ? `Compose · ${label}` : "Compose";
  } else {
    kicker = "Portfolio";
  }

  let content: React.ReactNode = null;
  if (mode.kind === "discover") {
    const target = laneOf(mode.targetLoopId);
    const srcParams = target
      ? (nodeFor(target.loop, "liquidity-source")?.data.params ?? {})
      : {};
    content = (
      <DiscoverPanel
        params={srcParams}
        /* THE LANE'S SURVIVING FAMILIES, read from the graph (wave audit
           2026-08-22, closing P0-7's handoff 1). Without this prop
           `DiscoverPanel` fell back to `familiesForCandidateId(params
           .candidateId)`, which on a lane that has not pinned a market yet
           answers "all three" — so a lane already committed to a collar was
           shown every lending row in the scan, each of which refuses with
           `market-family-mismatch` the moment it is pinned. That is the D2
           dead end wearing a different hat. The panel keeps its fallback for
           callers that cannot prove the lane; this one can. */
        families={target ? committedFamilies(target.loop) : null}
        data={props.oppData}
        error={props.oppError}
        onSelect={props.onSelectMarket}
      />
    );
  } else if (mode.kind === "module") {
    const lane = laneOf(mode.loopId);
    const node = lane ? nodeFor(lane.loop, mode.key) : null;
    if (lane && node) {
      content = (
        <ModulePanel
          laneLabel={lane.loop.label}
          moduleKey={mode.key}
          params={node.data.params}
          reprice={lane.reprice}
          repricing={lane.repricing}
          scan={lane.scan}
          hasHedge={!!nodeFor(lane.loop, "hedge")}
          comp={pricingParamsFor(lane.loop)}
          /* D3: forwarded verbatim, like `scanRowFor`. The dock is a
             pass-through for the lane's market and must not build a second
             opinion about it. */
          paramCtx={lane.paramCtx}
          onParam={(f, v) => props.onParam(mode.loopId, mode.key, f, v)}
          onEject={
            mode.key !== "liquidity-source" && mode.key !== "safety-buffer"
              ? () => props.onEject(mode.loopId, mode.key)
              : undefined
          }
          onSwap={() => props.onSwap(mode.loopId)}
        />
      );
    }
  } else if (mode.kind === "compose") {
    content = (
      <ComposePanel
        lanes={lanes}
        scopeLoopId={mode.scopeLoopId}
        lastScopedLoopId={lastScopedRef.current}
        portfolio={portfolio}
        portfolioApy={props.portfolioApy}
        vaultCapacityUsd={props.vaultCapacityUsd}
        showAddLane={props.showAddLane}
        onFocusModule={props.onFocusModule}
        onFocusOrchestrator={props.onFocusOrchestrator}
        onSetLeverage={props.onSetLeverage}
        onAddModule={props.onAddModule}
        onEjectModule={props.onEjectModule}
        onInstallDefaults={props.onInstallDefaults}
        scanRowFor={props.scanRowFor}
        onSwap={props.onSwap}
        onRemoveLoop={props.onRemoveLoop}
        onAddLane={props.onAddLane}
      />
    );
  } else {
    content = (
      <PortfolioVariant
        portfolio={portfolio}
        lanes={lanes}
        onOrchParam={props.onOrchParam}
        onAlloc={props.onAlloc}
      />
    );
  }

  /* Scroll resets on a MODE change and is PRESERVED when only the compose
     scope moves: scoping to a lane the user was already reading is not a new
     screen, and yanking them to the top would be. */
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [mode.kind]);

  /* DIRECTIONALITY, one attribute (§5.4): going DEEPER rises from +6px below,
     coming OUT settles from −6px above. That is what makes the swap read as
     navigation rather than a repaint. */
  const depth = mode.kind === "module" ? 2 : mode.kind === "portfolio" ? 2 : 1;
  const prevDepth = useRef(depth);
  const dir = depth >= prevDepth.current ? "in" : "out";
  prevDepth.current = depth;
  const swapKey = `${mode.kind}:${mode.kind === "compose" ? (mode.scopeLoopId ?? "-") : mode.kind === "module" ? mode.key : ""}`;
  /* THE BODY SWAPS ON A MODE CHANGE, NEVER ON A SCOPE MOVE.
     -------------------------------------------------------------------------
     `swapKey` was the React `key` on the body too, so scoping compose from
     Lane 2 to null REMOUNTED `ComposePanel`, whose accordion initialiser is
     `scopeLoopId ?? lanes[0]` — and the dock snapped back to Lane 1. That is
     the founder's "I can only see lane 1" from the dock side, and it fires on
     every deselect.
     It is also a contradiction the dock had already ruled on eleven lines up:
     scroll is PRESERVED across a scope move because "scoping to a lane the
     user was already reading is not a new screen". A remount is the largest
     possible new screen. The kicker still keys on the full identity, so the
     chrome beat that names the lane survives. */
  const bodyKey = mode.kind === "compose" ? "compose" : swapKey;

  return (
    <aside className="dock" onClick={(e) => e.stopPropagation()}>
      <div className="dock-head">
        {/* CHROME LEADS: the label tells you where you are before the body
            renders, never the reverse. */}
        <span className="mt-kicker" key={swapKey}>
          {kicker}
        </span>
        <button
          type="button"
          className="hm-key panel-key"
          data-key="collapse"
          aria-label="Collapse dock"
          onClick={props.onToggleCollapse}
        >
          ⟩
        </button>
      </div>
      <div className="dock-scroll" ref={scrollRef} data-dir={dir}>
        <div key={bodyKey}>{content}</div>
      </div>
      <button
        type="button"
        className="panel-rail"
        onClick={props.onToggleCollapse}
        aria-label="Open dock"
        title="Open dock ( ] )"
      >
        <i className="panel-rail-icon" aria-hidden>
          ▤
        </i>
        <span>
          {dockRailLit(mode) ? <i className="hm-led lit" /> : null}
          {dockRailLabel(mode)}
        </span>
        <span className="panel-rail-tip" aria-hidden>
          Open {dockRailLabel(mode)} ( ] )
        </span>
      </button>
    </aside>
  );
}
