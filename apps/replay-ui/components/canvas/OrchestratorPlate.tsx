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
  routerBadge,
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
  params,
  focused,
  snap,
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
  params: Record<string, ParamValue>;
  focused: boolean;
  /** The plate's arrival beat, held ~450ms by `markSnap` (design item 20). */
  snap?: boolean;
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
  const badge = routerBadge(signals, route);
  const quoting = badge.state === "quoting";
  const noQuote = badge.state === "gap";
  return (
    <div
      /* `snap` is the plate's ARRIVAL, and it is the one plate the user does
         not place: it mounts on its own the instant a second lane lands, and
         until this it did so with no beat at all (design item 20). Same
         `rk-plate--snap` every module plate takes from `markSnap`, and the
         reduced-motion substitution at build.css:2353 already covers it. */
      className={`rk-plate rk-orch${focused ? " rk-plate--focused on" : ""}${snap ? " rk-plate--snap" : ""}`}
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
            {/* EMPTY, not `OR` (design item 21). Every other plate prints an
                ordinal or nothing, and this was the only one inventing a
                two-letter code in the numeral slot. `VaultPlate` is the other
                plate that is not a numbered module and it renders the same
                empty span. */}
            <span className="n" />
          </div>
          {helpOpen ? (
            <div className="hm-helppop" onClick={(e) => e.stopPropagation()}>
              {ORCHESTRATOR_DEF.description}
            </div>
          ) : null}
          <span className="hm-jack bus" data-jack="orchestrator:bus" />
          <div className="hm-scr">
            {/* ONE STATE TAG AND ONE REGISTER TAG, and nothing else in the
                badge row (item 9). The state says what the machine is doing;
                `modeled` says what kind of number every figure under it is.
                Two tags, three words, no sentence. */}
            <div className="hm-st">
              <span>Allocation</span>
              <span style={{ display: "inline-flex", gap: 4 }}>
                <span
                  className={`hm-bdg${badge.state === "watching" ? " ok" : ""}`}
                  data-badge
                  data-badge-state={badge.state}
                >
                  {badge.text}
                </span>
                <span className="hm-bdg" data-badge data-badge-state="modeled">
                  modeled
                </span>
              </span>
            </div>
            <div className="hm-mid" style={{ alignItems: "stretch", gap: 7 }}>
              {signals.map((s) => (
                <div key={s.loopId} className={`rk-orchrow${s.drying ? " dry" : ""}`}>
                  {/* THE LANE'S OWN LABEL, not an ordinal. `USDC lending` is
                      12 characters and the row has to hold it, because a bar
                      labelled `LANE 2` names nothing a reader of this rack
                      recognises. */}
                  <span>{s.label.length > 13 ? `${s.label.slice(0, 12)}…` : s.label}</span>
                  {/* F.3 / F.5 — the shared track. The tick is the derived
                      floor `max(0, 1 − (N−1)·maxWeight)`, which restates a
                      bound `validateOrchestrator` already enforces, so drawing
                      it can never contradict the machine. */}
                  <AllocationTrack
                    targetPct={s.allocationBps / 100}
                    /* A lane with no market is not a slot and carries no band.
                       Null draws no tick and no headroom; 0 and 1 would draw a
                       floor at nothing and a ceiling at everything. */
                    /* NULL WHEN THE BAND IS THE WHOLE BOOK (G1). A tick at 0%
                       and headroom to 100% are marks that state no bound, and a
                       mark that states no bound is one the reader has to
                       decode for nothing. On any pair that is not a lane and
                       its floor the shipped band comes back and so do both. */
                    floorPct={
                      bands[s.loopId] && bands[s.loopId].minWeight > 0 ? bands[s.loopId].minWeight * 100 : null
                    }
                    maxPct={
                      bands[s.loopId] && bands[s.loopId].maxWeight < 1 ? bands[s.loopId].maxWeight * 100 : null
                    }
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
              {quoting ? "quoting" : noQuote ? "quote gap" : `governs ${loops.length} lane${loops.length === 1 ? "" : "s"}`}
            </div>
          </div>
          <div className="hm-acts">
            {/* ── THE FLOOR CAPTION AND THE WEEK STRIP ARE GONE (item 9) ──
                Both described bounds this pair no longer has. The floor
                sentence said "the router does not drain past 40%", and under
                the switch it drains to zero and rebuilds; the week strip drew
                a 25% turnover ceiling the record does not publish for this
                pair. Two clauses removed from a 150px component that the
                founder read as "way too wordy".

                What replaced them is the three rows on the screen above, in
                the plate's own grammar: label left, mono value right. The
                budget still binds and the vault page's Parameters panel states
                it as a row; a meter for it on the plate would be a fourth
                object drawing one number. */}
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
                {/* `Best lane` (item 9). It was `Follow yield`, then `Hold the
                    better lane`: four words on a key that has room for two,
                    on a plate the founder read as way too wordy. The claim is
                    unchanged and still the measured one, a protection ratchet
                    rather than a yield follower. `data-key` is unchanged: it
                    is an id, not chrome. */}
                <div className="hm-key lit" data-key="follow">
                  <span className="hm-led" />
                  Best lane
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
