"use client";

/**
 * OrchestratorPlate (UX_SPEC §4 + ORCHESTRATOR_SPEC R10–R13) — the
 * system-placed head plate. Auto-installs at the second lane; the user
 * never chooses to add it. Screen: allocation bars per lane with drying
 * drain-direction arrows. Exactly three dials on focus; the RULES key
 * opens the read-only derived-rule takeover. Everything it would do is
 * modeled only: no execution rail exists.
 */

import { useState } from "react";
import type { LoopGraph, ParamValue } from "@/lib/canvas/types";
import { ORCH_DIAL_DEFS, ORCHESTRATOR_DEF } from "@/lib/canvas/orchestrator";
import OrchDial from "./dock/OrchDial";
import { AllocShareInput } from "./dock/LanePanel";

export interface LaneSignal {
  loopId: string;
  label: string;
  allocationBps: number;
  /** amber DRYING: gate fails / APY under floor on a fresh quote. */
  drying: boolean;
  noQuote: boolean;
}

export default function OrchestratorPlate({
  loops,
  signals,
  params,
  focused,
  onFocus,
  onParam,
  onAlloc,
  onOpenRules,
}: {
  loops: LoopGraph[];
  signals: LaneSignal[];
  params: Record<string, ParamValue>;
  focused: boolean;
  onFocus: () => void;
  onParam: (field: string, value: ParamValue) => void;
  /** One lane's target share in bps; the rest rebalance to Σ=10000 (P1-6). */
  onAlloc: (loopId: string, bps: number) => void;
  onOpenRules: () => void;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  return (
    <div
      className={`rk-plate rk-orch${focused ? " rk-plate--focused on" : ""}`}
      data-node-id="orchestrator"
      onClick={(e) => {
        e.stopPropagation();
        onFocus();
      }}
    >
      <div className="hm-hw">
        <div className="hm-body">
          <div className="hm-tag">
            <span className="nm">
              {ORCHESTRATOR_DEF.name}
              <button
                type="button"
                className="hm-help"
                aria-label="About the orchestrator"
                onClick={(e) => {
                  e.stopPropagation();
                  setHelpOpen((v) => !v);
                }}
              >
                ?
              </button>
            </span>
            <span className="n">OR</span>
          </div>
          {helpOpen ? (
            <div className="hm-helppop" onClick={(e) => e.stopPropagation()}>
              {ORCHESTRATOR_DEF.description}
            </div>
          ) : null}
          <span className="hm-jack bus" data-jack="orchestrator:bus" />
          <div className="hm-scr">
            <div className="hm-st">
              <span>Allocation</span>
              <span className="hm-bdg ok" data-badge>
                {ORCHESTRATOR_DEF.policyName}
              </span>
            </div>
            <div className="hm-mid" style={{ alignItems: "stretch", gap: 7 }}>
              {signals.map((s) => (
                <div key={s.loopId} className={`rk-orchrow${s.drying ? " dry" : ""}`}>
                  <span>{s.label.length > 8 ? `${s.label.slice(0, 7)}…` : s.label}</span>
                  <span className="rk-orchbar">
                    <i style={{ width: `${s.allocationBps / 100}%` }} />
                  </span>
                  <AllocShareInput bps={s.allocationBps} dark onCommit={(bps) => onAlloc(s.loopId, bps)} />
                </div>
              ))}
            </div>
            <div className="hm-sb">
              {signals.some((s) => s.noQuote)
                ? "quote gap · holding"
                : signals.some((s) => s.drying)
                  ? "drain modeled · no execution rail"
                  : `governs ${loops.length} loops + reserve`}
            </div>
          </div>
          <div className="hm-acts">
            <div className="hm-al">{focused ? "Dials" : "Policy"}</div>
            {focused ? (
              <div className="pc" onClick={(e) => e.stopPropagation()}>
                {ORCH_DIAL_DEFS.map((d) => (
                  <OrchDial key={d.field} desc={d} value={params[d.field]!} onChange={(v) => onParam(d.field, v)} />
                ))}
                <div className="hm-keys">
                  <div
                    role="button"
                    tabIndex={0}
                    className="hm-key"
                    data-key="rules"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenRules();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") onOpenRules();
                    }}
                  >
                    <span className="hm-led" />
                    Rules
                  </div>
                </div>
              </div>
            ) : (
              <div className="hm-keys">
                <div className="hm-key lit" data-key="follow">
                  <span className="hm-led" />
                  Follow yield
                </div>
                <div
                  role="button"
                  tabIndex={0}
                  className="hm-key"
                  data-key="rules"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenRules();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") onOpenRules();
                  }}
                >
                  <span className="hm-led" />
                  Rules
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
