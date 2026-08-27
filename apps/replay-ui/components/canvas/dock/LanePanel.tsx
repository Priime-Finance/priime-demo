"use client";

/**
 * LanePanel (IT4_DOCK_SPEC §5, mockup register 2026-08-20) — the dock's
 * lane / portfolio mode.
 *
 * Lane variant: lane name + modeled net APY, a build checklist mirroring
 * the ghost spine with Install defaults, the Add dynamic hedge key (the
 * hedge never self-installs), allocation share, Swap market and (guarded)
 * Remove loop keys. The lane-level risk dial is gone: risk parameters live
 * inside the module plates.
 *
 * Portfolio variant: allocation bars, the three orchestrator dials via the
 * shared OrchDial renderer, and the Rules decode.
 */

/* eslint-disable @typescript-eslint/prefer-optional-chain --
 * Kit-verbatim file (priime-build-ui-kit integration); not rewriting kit
 * logic to satisfy lint, per the integration's own directive. */

import { useMemo, useState } from "react";
import type { LoopGraph, LoopId, ModuleKey, ParamValue, PortfolioGraph } from "@/lib/canvas/types";
import { nodeFor } from "@/lib/canvas/graph-ops";
import {
  orchRuleTable,
  deriveAllOrchRules,
  dialsFromParams,
  ORCH_DIAL_DEFS,
  ORCH_HONESTY_LINE,
  ORCHESTRATOR_DEF,
  slotsFromPortfolio,
} from "@/lib/canvas/orchestrator";
import OrchDial from "./OrchDial";
import type { RepriceData } from "../types";

export interface DockLaneView {
  loop: LoopGraph;
  /** The effective quote (live rail or catalog-modeled); never a failure. */
  reprice: RepriceData | null;
  repricing: boolean;
  netApy: number | null;
  graphOk: boolean;
  laneReviewable: boolean;
  /** Borrow above yield at the margin (P1-4 narration). */
  leverageYieldNegative: boolean;
}

function ActionKey({ label, lit, warn, onClick }: { label: string; lit?: boolean; warn?: boolean; onClick: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={`hm-key${lit ? " lit" : ""}${warn ? " pc-eject" : ""}`}
      data-key={label.toLowerCase().replace(/\s+/g, "-")}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick();
      }}
    >
      <span className="hm-led" />
      {label}
    </div>
  );
}

export function LaneVariant({
  lane,
  allocationBps,
  canRemove,
  onInstallDefaults,
  onSwap,
  onAddModule,
  onRemoveLoop,
}: {
  lane: DockLaneView;
  allocationBps: number | null;
  canRemove: boolean;
  onInstallDefaults: () => void;
  onSwap: () => void;
  /** Add an optional module to this lane (the hedge lives here now). */
  onAddModule: (key: ModuleKey) => void;
  onRemoveLoop: () => void;
}) {
  const ok = lane.reprice?.ok === true ? lane.reprice : null;
  const src = nodeFor(lane.loop, "liquidity-source");
  const hasMarket = String(src?.data.params.candidateId ?? "") !== "";
  const hedgedClass = String(src?.data.params.cls ?? "") !== "N1";
  const hasSafety = !!nodeFor(lane.loop, "safety-buffer");
  const hasHedge = !!nodeFor(lane.loop, "hedge");
  const hasCompound = !!nodeFor(lane.loop, "auto-compound");

  // The checklist mirrors the lane's spine.
  const steps: { label: string; state: "done" | "now" | "skip" | "todo" }[] = useMemo(
    () => [
      { label: "Market", state: hasMarket ? "done" : "now" },
      { label: "Leverage", state: hasSafety ? "done" : hasMarket ? "now" : "todo" },
      { label: "Compound", state: hasCompound ? "done" : hasMarket && hasSafety ? "now" : "todo" },
      ...(hasHedge ? [{ label: "Hedge", state: "done" as const }] : []),
    ],
    [hasMarket, hasSafety, hasHedge, hasCompound],
  );
  const spineIncomplete = hasMarket && !lane.graphOk;

  return (
    <div className="dock-lane" onClick={(e) => e.stopPropagation()}>
      <div className="dock-lane-head">
        <b>{lane.loop.label}</b>
      </div>
      <div className="dock-lane-apy">
        {lane.repricing ? (
          "quoting…"
        ) : lane.netApy !== null ? (
          <>
            net APY <b>{(lane.netApy * 100).toFixed(1)}%</b>
            <span className="dock-ro-register">
              {ok && ok.blockNumber ? ` modeled · block ${ok.blockNumber}` : " modeled"}
            </span>
          </>
        ) : (
          <span className="dock-ro-register">modeled</span>
        )}
      </div>
      {lane.leverageYieldNegative ? (
        <span className="rk-riskline">leverage is yield-negative in this market today</span>
      ) : null}

      <div className="dock-checklist">
        {steps.map((s) => (
          <div key={s.label} className={`rail-step ${s.state}`}>
            <span className="rail-dot" />
            {s.label}
          </div>
        ))}
      </div>
      {spineIncomplete ? (
        <div className="hm-keys">
          <ActionKey label="Install defaults" lit onClick={onInstallDefaults} />
        </div>
      ) : null}

      {hasMarket && hedgedClass && !hasHedge && hasSafety ? (
        <div className="hm-keys">
          <ActionKey label="Add dynamic hedge" onClick={() => onAddModule("hedge")} />
        </div>
      ) : null}

      {allocationBps !== null ? (
        <div className="dock-lane-share">{(allocationBps / 100).toFixed(0)}% allocation</div>
      ) : null}

      <div className="hm-keys dock-lane-acts">
        <ActionKey label="Swap market" onClick={onSwap} />
        {canRemove ? <ActionKey label="Remove loop" warn onClick={onRemoveLoop} /> : null}
      </div>
    </div>
  );
}

/**
 * Allocation share editor (recette P1-6): a real percent input. Commits on
 * blur/Enter through setAllocation (largest-remainder rebalances the other
 * lanes to Σ=10000). Shared by the dock's portfolio panel and the canvas
 * orchestrator plate.
 */
export function AllocShareInput({
  bps,
  dark,
  onCommit,
}: {
  bps: number;
  dark?: boolean;
  onCommit: (bps: number) => void;
}) {
  const commit = (el: HTMLInputElement) => {
    const v = Number(el.value);
    if (!Number.isFinite(v)) {
      el.value = (bps / 100).toFixed(0);
      return;
    }
    const next = Math.min(100, Math.max(0, Math.round(v))) * 100;
    if (next !== bps) onCommit(next);
    else el.value = (bps / 100).toFixed(0);
  };
  return (
    <span className={`rk-allocedit${dark ? " dark" : ""}`} onClick={(e) => e.stopPropagation()}>
      <input
        type="number"
        min={0}
        max={100}
        step={1}
        key={bps}
        defaultValue={(bps / 100).toFixed(0)}
        aria-label="allocation percent"
        onBlur={(e) => commit(e.target)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
      <b>%</b>
    </span>
  );
}

export function PortfolioVariant({
  portfolio,
  lanes,
  onOrchParam,
  onAlloc,
}: {
  portfolio: PortfolioGraph;
  lanes: DockLaneView[];
  onOrchParam: (field: string, value: ParamValue) => void;
  /** One lane's target share in bps; the rest rebalance to Σ=10000 (P1-6). */
  onAlloc: (loopId: LoopId, bps: number) => void;
}) {
  const [rulesOpen, setRulesOpen] = useState(true); // default open — it is why the user focused the orchestrator
  const alloc = portfolio.orchestrator.allocationsBps;

  const rules = useMemo(() => {
    const dials = dialsFromParams(portfolio.orchestrator.params);
    return deriveAllOrchRules(dials, slotsFromPortfolio(portfolio));
  }, [portfolio]);

  return (
    <div className="dock-portfolio" onClick={(e) => e.stopPropagation()}>
      <div className="dock-lane-head">
        <b>{ORCHESTRATOR_DEF.name}</b>
        <span className="hm-bdg ok" data-badge>
          {ORCHESTRATOR_DEF.policyName}
        </span>
      </div>

      <div className="dock-allocs">
        {lanes.map((l) => (
          <div key={l.loop.id} className="rk-orchrow">
            <span>{l.loop.label.length > 10 ? `${l.loop.label.slice(0, 9)}…` : l.loop.label}</span>
            <span className="rk-orchbar">
              <i style={{ width: `${(alloc[l.loop.id] ?? 0) / 100}%` }} />
            </span>
            <AllocShareInput
              bps={alloc[l.loop.id] ?? 0}
              dark
              onCommit={(bps) => onAlloc(l.loop.id, bps)}
            />
          </div>
        ))}
      </div>
      <div className="dock-orch-status">{`governs ${portfolio.loops.length} loops + reserve`}</div>

      <div className="pc dock-orch-dials">
        {ORCH_DIAL_DEFS.map((d) => (
          <OrchDial
            key={d.field}
            desc={d}
            value={portfolio.orchestrator.params[d.field]!}
            onChange={(v) => onOrchParam(d.field, v)}
          />
        ))}
      </div>

      <div className="hm-keys">
        <ActionKey label="Rules" lit={rulesOpen} onClick={() => setRulesOpen((v) => !v)} />
      </div>
      {rulesOpen ? (
        <div className="dock-rules">
          <div className="rt-policy">{ORCHESTRATOR_DEF.policyName} · one policy, every loop</div>
          <span className="rt-modeled">modeled · no execution rail</span>
          {(() => {
            const t = orchRuleTable(rules);
            return (
              <>
                {t.rows.map((row) => (
                  <div key={row.metric} className="rt-rule" style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "2px 10px", alignItems: "baseline" }}>
                    <b style={{ letterSpacing: ".06em", fontSize: "10px" }}>{row.name}</b>
                    <span style={{ fontSize: "9.5px", opacity: 0.7, whiteSpace: "nowrap" }}>
                      {row.patience} · cooldown {row.cooldown}
                    </span>
                    <span style={{ gridColumn: "1 / -1", opacity: 0.85 }}>{row.trigger}</span>
                  </div>
                ))}
                <div className="rt-floor">
                  Every rule: at most {t.maxMovePct.toFixed(0)}% of the book per move · one failing
                  scan never moves capital · emergencies go to reserve, bypassing cooldowns.{" "}
                  {ORCH_HONESTY_LINE}
                </div>
              </>
            );
          })()}
        </div>
      ) : null}
    </div>
  );
}
