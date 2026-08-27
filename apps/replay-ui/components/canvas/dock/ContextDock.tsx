"use client";

/**
 * ContextDock (IT4_DOCK_SPEC §1/§2, mockup register 2026-08-20) — the
 * right-panel context dock shell: header with the mode kicker + collapse
 * key, the collapsed rail (whole strip re-opens; label stays honest about
 * the current mode), and the mode switch over Discover / Module / Lane /
 * Portfolio panels. The dock is NEVER empty and never closes — the
 * collapse key is the only dismiss.
 */

import type { ModuleKey, ParamValue, PortfolioGraph } from "@/lib/canvas/types";
import { nodeFor } from "@/lib/canvas/graph-ops";
import { dockRailLabel, dockRailLit, type DockMode } from "@/lib/canvas/dock-state";
import type { UnifiedRow } from "@/lib/canvas/unified-list";
import DiscoverPanel, { discoverKicker } from "./DiscoverPanel";
import ModulePanel from "./ModulePanel";
import { LaneVariant, PortfolioVariant, type DockLaneView } from "./LanePanel";
import type { OpportunitiesPayload } from "../types";

interface ContextDockProps {
  mode: DockMode;
  collapsed: boolean;
  onToggleCollapse: () => void;
  portfolio: PortfolioGraph;
  lanes: DockLaneView[];
  oppData: OpportunitiesPayload | null;
  oppError: string | null;
  onParam: (loopId: string, key: ModuleKey, field: string, value: ParamValue) => void;
  onEject: (loopId: string, key: ModuleKey) => void;
  onAdvancedTouch: (loopId: string) => void;
  onOrchParam: (field: string, value: ParamValue) => void;
  /** One lane's allocation share in bps (P1-6). */
  onAlloc: (loopId: string, bps: number) => void;
  onSelectMarket: (fields: Record<string, string>, row: UnifiedRow) => void;
  onSwap: (loopId: string) => void;
  onInstallDefaults: (loopId: string) => void;
  /** Add an optional module to a lane (the hedge is opt-in from here). */
  onAddModule: (loopId: string, key: ModuleKey) => void;
  onRemoveLoop: (loopId: string) => void;
}

export default function ContextDock(props: ContextDockProps) {
  const { mode, portfolio, lanes } = props;
  const laneOf = (loopId: string | null) => lanes.find((l) => l.loop.id === loopId) ?? null;
  const orchOn = portfolio.orchestrator.enabled && portfolio.loops.length >= 2;

  let kicker = "Markets";
  if (mode.kind === "discover") {
    kicker = discoverKicker(mode.reason, laneOf(mode.targetLoopId)?.loop.label ?? null);
  } else if (mode.kind === "module") {
    // raw loop ids never render (P2-1): a stale focus falls back to the bare kicker
    const label = laneOf(mode.loopId)?.loop.label;
    kicker = label ? `Module · ${label}` : "Module";
  } else if (mode.kind === "lane") {
    const label = laneOf(mode.loopId)?.loop.label;
    kicker = label ? `Lane · ${label}` : "Lane";
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
          onParam={(f, v) => props.onParam(mode.loopId, mode.key, f, v)}
          onEject={
            mode.key !== "liquidity-source" && mode.key !== "safety-buffer"
              ? () => props.onEject(mode.loopId, mode.key)
              : undefined
          }
          onAdvancedTouch={
            mode.key === "safety-buffer" || mode.key === "hedge"
              ? () => props.onAdvancedTouch(mode.loopId)
              : undefined
          }
          onSwap={() => props.onSwap(mode.loopId)}
        />
      );
    }
  } else if (mode.kind === "lane") {
    const lane = laneOf(mode.loopId);
    if (lane) {
      content = (
        <LaneVariant
          lane={lane}
          allocationBps={orchOn ? (portfolio.orchestrator.allocationsBps[lane.loop.id] ?? 0) : null}
          canRemove={portfolio.loops.length > 1}
          onInstallDefaults={() => props.onInstallDefaults(lane.loop.id)}
          onSwap={() => props.onSwap(lane.loop.id)}
          onAddModule={(key) => props.onAddModule(lane.loop.id, key)}
          onRemoveLoop={() => props.onRemoveLoop(lane.loop.id)}
        />
      );
    }
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

  return (
    <aside className="dock" onClick={(e) => e.stopPropagation()}>
      <div className="dock-head">
        <span className="mt-kicker">{kicker}</span>
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
      <div className="dock-scroll">{content}</div>
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
