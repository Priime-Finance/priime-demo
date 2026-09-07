"use client";

/**
 * OrchestratorPlate (UX_SPEC §4 + ORCHESTRATOR_SPEC R10–R13) — the
 * system-placed head plate. Auto-installs at the second lane; the user
 * never chooses to add it. Screen: allocation bars per lane with drying
 * drain-direction arrows. Exactly three dials on focus; the RULES key
 * opens the read-only derived-rule takeover. Everything it would do is
 * modeled only: no execution rail exists.
 *
 * ══ 2026-09-03 · THE DESTINATION IS DRAWN HERE TOO (spec F, WP-9) ═════════
 *
 * This plate is one of the router's TWO placements, and the contract on the
 * work package is that the destination is drawn on both "or one describes a
 * machine the other does not have". It used to draw allocation only: three
 * dials, a bar per lane, and no answer at all to the one question the module
 * is named for, which is WHERE THE CAPITAL WOULD GO. The dock's portfolio
 * panel is the other placement, and both now render one `ComposedRoute` from
 * one derivation over the lanes the user actually racked.
 *
 * The allocation bar also changed shape, from a plain fill to the shared
 * `AllocationTrack`: it carries the DERIVED floor as a tick and the lane's own
 * ceiling as headroom. A bar that ran to 100% with no marks advertised that a
 * floor lane can be drained to nothing, which the machine refuses.
 */

import { useMemo, useState } from "react";
import type { LoopGraph, ParamValue } from "@/lib/canvas/types";
import { orchDialDefs, ORCHESTRATOR_DEF, type LaneSignal } from "@/lib/canvas/orchestrator";
import OrchDial from "./dock/OrchDial";
import {
  AllocationTrack,
  AllocShareInput,
  DestinationLine,
  floorCaption,
  routerBadge,
  TurnoverStrip,
  type ComposedRoute,
} from "./dock/LanePanel";

/**
 * The signal shape moved to `lib/canvas/orchestrator` alongside
 * `deriveLaneSignals`, which is now the only producer (D9). It was declared
 * here, so its `drying` and `noQuote` fields were whatever the single call
 * site typed — and what it typed was `false, false`, permanently.
 */
export type { LaneSignal };

export default function OrchestratorPlate({
  loops,
  signals,
  bands,
  route,
  turnoverCeiling,
  params,
  focused,
  onFocus,
  onParam,
  onAlloc,
  onOpenRules,
}: {
  loops: LoopGraph[];
  signals: LaneSignal[];
  /** Per lane, the DERIVED floor and the clamped ceiling, as fractions. Both
   *  come off `LoopSlot`, so the plate draws the bounds the validator
   *  enforces rather than a second opinion about them. */
  bands: Record<string, { minWeight: number; maxWeight: number }>;
  /** Where the router would send capital, out of these lanes. */
  route: ComposedRoute;
  /** `turnoverBudgetPctWeek / 100`. A rack has never run, so nothing is spent
   *  and nothing is in flight; the strip states the ceiling the dial set. */
  turnoverCeiling: number;
  params: Record<string, ParamValue>;
  focused: boolean;
  onFocus: () => void;
  onParam: (field: string, value: ParamValue) => void;
  /** One lane's target share in bps; the rest rebalance to Σ=10000 (P1-6). */
  onAlloc: (loopId: string, bps: number) => void;
  onOpenRules: () => void;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const dialDefs = useMemo(() => orchDialDefs(loops.length), [loops.length]);
  /* D9 — the badge tells the truth about the quote, and green stays
     semantic. A lane mid-reprice is not a failure and not a success; it is
     QUOTING, and the badge says so instead of holding a green policy name
     over numbers that are about to move. `ok` (the green class) is earned
     only when every lane has a live quote and none of them is drying.
     THE DERIVATION MOVED TO `routerBadge`, beside `DestinationLine`, when the
     dock's own badge turned out to be the literal `hm-bdg ok`: one machine
     was wearing amber here and an unearned green there, over the same lanes,
     at the same instant. */
  const badge = routerBadge(signals);
  const quoting = badge.state === "quoting";
  const noQuote = badge.state === "gap";
  const drying = badge.state === "drying";
  /* THE FLOOR TICK'S CAPTION, the SAME string the dock renders. A mark on a
     bar that nothing explains is a mark the reader has to guess at, and F.3
     asks for the tick to be "labelled as what it is". Every lane carries the
     same derived floor (it is a function of the lane count and the
     concentration dial, not of the lane), so one caption states it once. */
  const floorPct = (() => {
    for (const s of signals) {
      const b = bands[s.loopId];
      if (b) return b.minWeight * 100;
    }
    return null;
  })();
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
              <span
                className={`hm-bdg${badge.state === "ok" ? " ok" : ""}`}
                data-badge
                data-badge-state={badge.state}
              >
                {badge.text}
              </span>
            </div>
            <div className="hm-mid" style={{ alignItems: "stretch", gap: 7 }}>
              {signals.map((s) => (
                <div key={s.loopId} className={`rk-orchrow${s.drying ? " dry" : ""}`}>
                  <span>{s.label.length > 8 ? `${s.label.slice(0, 7)}…` : s.label}</span>
                  {/* F.3 / F.5 — the shared track. The tick is the derived
                      floor `max(0, 1 − (N−1)·maxWeight)`, which restates a
                      bound `validateOrchestrator` already enforces, so drawing
                      it can never contradict the machine. */}
                  <AllocationTrack
                    targetPct={s.allocationBps / 100}
                    /* A lane with no market is not a slot and carries no band.
                       Null draws no tick and no headroom; 0 and 1 would draw a
                       floor at nothing and a ceiling at everything. */
                    floorPct={bands[s.loopId] ? bands[s.loopId].minWeight * 100 : null}
                    maxPct={bands[s.loopId] ? bands[s.loopId].maxWeight * 100 : null}
                  />
                  <AllocShareInput
                    bps={s.allocationBps}
                    pctValue={s.allocationPct}
                    dark
                    onCommit={(bps) => onAlloc(s.loopId, bps)}
                  />
                </div>
              ))}
            </div>
            {/* THE DESTINATION. One `ComposedRoute`, two placements. */}
            <div style={{ marginTop: 6 }}>
              <DestinationLine route={route} variant="plate" />
            </div>
            <div className="hm-sb">
              {quoting
                ? "quoting · holding"
                : noQuote
                  ? "quote gap · holding"
                  : drying
                    ? "drain modeled · no execution rail"
                    : `governs ${loops.length} loop${loops.length === 1 ? "" : "s"}`}
            </div>
          </div>
          <div className="hm-acts">
            {/* ── UNDER THE PLATE, WHICH IS WHERE F.6 PUTS THE WEEK STRIP AND
                   WHERE THE FLOOR CAPTION HAD TO GO ────────────────────────
                `.hm-scr` is 142px with `overflow:hidden` and
                `justify-content:space-between`, so a screen that runs long
                does not scroll and does not clip visibly: its flex children
                shrink, and the LAST one goes first. Measured with both of
                these inside it, the screen needed 182px and the status
                sub-line — the one that says `no execution rail` — was
                squeezed to a height of zero. A honesty line silently deleted
                by a layout is worse than one nobody wrote.

                So the two blocks that are ABOUT the plate rather than ON its
                screen moved out to the plate's face, which has no height cap.
                F.6's own words are "under the router plate, a week strip",
                and the strip now sits directly above the dial that sets its
                ceiling.

                ⚠ EVERY LABEL ON THIS FACE SETS ITS OWN COLOUR. `.hm-hw` pins
                ink to #141210 in both themes precisely because the canvas's
                themed cream would otherwise cross the object boundary onto
                the aluminium; `hm.css` calls the next inherited label "a
                loaded gun". #6c6c68 is `.hm-sb`'s own value. */}
            {floorPct === null ? null : (
              <div
                style={{
                  fontFamily: "var(--fm)",
                  fontSize: 8,
                  letterSpacing: ".06em",
                  lineHeight: 1.5,
                  color: "#6c6c68",
                  padding: "0 3px 6px",
                  overflowWrap: "anywhere",
                }}
              >
                {floorCaption(floorPct)}
              </div>
            )}
            <div style={{ padding: "0 3px 9px" }}>
              <TurnoverStrip realized={0} inFlight={0} ceiling={turnoverCeiling} variant="plate" />
            </div>
            <div className="hm-al">{focused ? "Dials" : "Policy"}</div>
            {focused ? (
              <div className="pc" onClick={(e) => e.stopPropagation()}>
                {dialDefs.map((d) => (
                  <OrchDial key={d.field} desc={d} value={params[d.field]} onChange={(v) => onParam(d.field, v)} />
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
