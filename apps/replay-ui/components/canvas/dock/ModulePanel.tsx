"use client";

/**
 * ModulePanel (IT4_DOCK_SPEC §4, mockup register 2026-08-20) — the focused
 * module mirrored full-size.
 *
 * The dock does NOT re-implement controls: it renders the SAME PlateControls
 * component with the SAME props RackCanvas threads to the plate, so both
 * surfaces are controlled projections of the one portfolio store and emit
 * identical { type: "param" } actions through identical clamps.
 *
 * liquidity-source (PlateControls returns null for it) renders the market
 * summary instead, with one action key: Swap market. Eligibility verdicts,
 * gate lists and stale-selection notes are gone — clean modeled data only.
 */

import type { ModuleKey, ParamValue } from "@/lib/canvas/types";
import { venueLabel } from "@/lib/canvas/labels";
import { getDef, type ParamContext } from "@/lib/canvas/modules";
import { fmtCapacityUsd, laneCapacityUsd } from "@/lib/canvas/capacity";
import type { LaneComposition } from "@/lib/canvas/mock-quote";
import { lev, scanRef } from "@/lib/canvas/format";
import PlateControls from "../PlateControls";
import {
  CLASS_FAMILY,
  HOLD_FIELD,
  NO_SIGNAL_LINE,
  watchViewOf,
} from "@/lib/canvas/exogenous";
import DockReadouts from "./DockReadouts";
import type { RepriceData } from "../types";

/**
 * One party, one row: the name, the route fact, its state, and its `Hold`.
 *
 * `Hold` is the canvas's own existing word for "armed, does not act" — it
 * already ships as `hm-key data-key="hold"` on the hedge, auto-center and both
 * option legs. A hold moves ONE party across the answered line, in either
 * direction, and it can NEVER remove a party from the named list. That is what
 * makes the completeness claim `skipBarLabel` refuses unreachable by
 * construction: no user action can shrink the named set except ejecting the
 * module itself.
 */
/** The absence sentence for a class nothing reads, or null. Only the two
 *  invariant families with no live signal own one; a class that merely
 *  DEGRADES breaks no promise and gets none. */
function noSignalLine(k: { name: string; signal: readonly string[] }): string | null {
  if (k.signal.length > 0) return null;
  const fam = CLASS_FAMILY[k.name];
  return (fam && NO_SIGNAL_LINE[fam]) ?? null;
}

function DepsBlock({
  params,
  reprice,
  hasHedge,
  onParam,
  onEject,
}: {
  params: Record<string, ParamValue>;
  reprice: RepriceData | null;
  hasHedge: boolean;
  onParam: (field: string, value: ParamValue) => void;
  onEject?: () => void;
}) {
  const ok = reprice?.ok === true ? reprice : null;
  const view = watchViewOf({
    candidate: ok?.candidate ?? null,
    placed: hasHedge ? ["hedge", "exogenous-risk"] : ["exogenous-risk"],
    params: { "exogenous-risk": params },
  });
  return (
    <div className="dock-deps">
      {view.rows.length === 0 ? (
        <div className="mt-status">Pick a market and this lane names what it depends on.</div>
      ) : (
        <>
          {/* THE SAME TWO INTEGERS THE SHELF QUOTED BEFORE THE PRESS (recette
              fix, 2026-08-27), so the builder can reconcile this panel with
              the skip bar in the compose pane. That bar counts what the vault
              does not MEASURE and it rose when this module seated — because
              one blind row standing for four lumped dependencies became one
              row per party, not because anything stopped being read. The
              second integer here is the part of that rise this module owns,
              and it is derived, so it cannot drift from the bar. */}
          <div className="dock-deps-head">
            {view.unreadCount > 0
              ? `${view.named} parties on this route. Nothing in this product reads ${view.unreadCount} of them.`
              : `${view.named} parties on this route.`}{" "}
            Every party here touches your capital on this lane. Change the route and the list
            changes with it.
          </div>
          {view.rows.map((r) => {
            const held = params[HOLD_FIELD[r.id]] === true;
            const answered = view.answered.has(r.id);
            return (
              <div key={r.id} className="dock-dep" data-state={r.state}>
                <div className="dock-dep-nm">
                  {r.party}
                  <i className="dock-dep-st">{r.state}</i>
                </div>
                <div className="dock-dep-why">{r.because}</div>
                <div className="dock-dep-cls">
                  {r.classes.map((k) => (
                    <div key={k.name} className="dock-dep-pair">
                      {/* THE PAIR IS THE ATOM. A surface showing only the watch
                          half throws away the half that says why watching is
                          worth anything — and the ACT half is a subjectless
                          imperative with no tense and no agent, which states a
                          DESIGNED response and cannot be read as a running
                          guarantee. Do not add an agent to these lines. */}
                      <b>{k.name}</b>
                      <span>{k.watch}</span>
                      {answered ? <span className="dock-dep-act">{k.act}</span> : null}
                      {noSignalLine(k) ? (
                        <span className="dock-dep-blind">{noSignalLine(k)}</span>
                      ) : null}
                    </div>
                  ))}
                </div>
                <div className="hm-keys">
                  <div
                    role="button"
                    tabIndex={0}
                    aria-pressed={held}
                    aria-label={`Hold ${r.party}`}
                    className={`hm-key${held ? " lit" : ""}`}
                    data-key="hold"
                    onClick={(e) => {
                      e.stopPropagation();
                      onParam(HOLD_FIELD[r.id], !held);
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault();
                      e.stopPropagation();
                      onParam(HOLD_FIELD[r.id], !held);
                    }}
                  >
                    <span className="hm-led" />
                    {held ? "Held" : "Hold"}
                  </div>
                </div>
              </div>
            );
          })}
        </>
      )}
      <PlateControls
        moduleKey="exogenous-risk"
        params={params}
        reprice={reprice}
        hasHedge={hasHedge}
        onParam={onParam}
        onEject={onEject}
      />
    </div>
  );
}

export default function ModulePanel({
  laneLabel,
  moduleKey,
  params,
  reprice,
  repricing,
  scan,
  hasHedge,
  comp,
  paramCtx,
  onParam,
  onEject,
  onSwap,
}: {
  laneLabel: string;
  moduleKey: ModuleKey;
  params: Record<string, ParamValue>;
  /** The lane's market (D3, 2026-08-24). The dock renders the SAME
   *  `PlateControls` as the plate, so it must hand it the same bounds: without
   *  this the mirrored dial published the structural envelope while the plate
   *  60px of dock away published the market's own. */
  paramCtx?: ParamContext;
  reprice: RepriceData | null;
  repricing: boolean;
  /** FRAME M — the lane's UNREPRICED scan row. See DockLaneView.scan. */
  scan?: { apr: number | null; lev: number | null } | null;
  /** Whether the lane runs the short leg, and its composition — the two
   *  inputs `laneCapacityUsd` states a lane's room from. */
  hasHedge: boolean;
  comp: LaneComposition | null;
  onParam: (field: string, value: ParamValue) => void;
  onEject?: () => void;
  onSwap: () => void;
}) {
  const def = getDef(moduleKey);
  const ok = reprice?.ok === true ? reprice : null;
  const econ = ok?.candidate?.economics ?? null;
  /* CAPACITY COMES FROM ITS OWNER (2026-08-23). This printed
     `econ.capacityUsd` raw — the stored bound in the scan's frame — while the
     compose card 40px away printed `laneCapacityUsd` at the lane's escrow
     share: `$330K` here against `$367K` there for one kHYPE book, the 0.75 /
     0.6742 ratio again. R0.1 (capacity.ts): every capacity figure on every
     surface comes out of that file. */
  const laneCap = laneCapacityUsd(ok?.candidate, hasHedge, comp);
  /* THE SECOND CHIMERA (§4.4). This block carried the IDENTICAL defect the
     source plate did, and fixing only the plate would have moved it here: a
     hard-coded `hedged`/`unhedged` word from the market's pinned class beside
     `net {pct(econ.netApyOnDepositApy)} modeled` — the market's hedged
     arithmetic repriced at the lane's leverage. Both die in the same change.
     What is left is one frame: the market, at its own leverage, labeled
     `scan`. */
  const ref = scanRef(scan?.apr, scan?.lev);
  const laneLev = econ?.loopLeverage ?? null;

  return (
    <div className="dock-module" onClick={(e) => e.stopPropagation()}>
      <DockReadouts
        laneLabel={laneLabel}
        moduleName={def.name}
        moduleKey={moduleKey}
        reprice={reprice}
        repricing={repricing}
        hasHedge={hasHedge}
        /* S3 seam close, WAVE 3 (seam S-H1-1). Without this the `hedge value`
           row builds its `hedgeEconomics` on NO composition, so it lands on a
           different compound cadence from every other hedge surface and the
           dock prints a second number for one hedge: measured `pays 2.0pp`
           here against the hedge plate's `pays 2.2pp` 200px away, Dolomite
           sWBERA/WBERA at 1.00x with auto-compound 24h, block 25282880.
           `comp` is already this component's prop and already feeds
           `laneCapacityUsd` above; `DockReadouts.comp` was declared for it. */
        comp={comp}
      />

      {moduleKey === "exogenous-risk" ? (
        /* ══ THE NAMED LIST — the dock's own special case, mirroring the
           `dock-market` block below ═══════════════════════════════════════
           The plate holds the LINE; the dock holds the list and the
           exceptions. One row per party, in ROUTE ORDER, because the order IS
           the argument for why each one is here — which is why there is no
           second route diagram anywhere in this product.

           `because` is a route fact interpolating this lane's own nouns, never
           prose about dependencies in general. This is where the second-party
           argument lives: watching a dependency is not consolation for being
           unable to stop a hack, it is the only defence that exists for the
           position a composed vault is actually in — and it is delivered as
           six concrete sentences about THIS lane rather than as one abstract
           paragraph. */
        <DepsBlock params={params} reprice={reprice} hasHedge={hasHedge} onParam={onParam} onEject={onEject} />
      ) : moduleKey === "liquidity-source" ? (
        <div className="dock-market">
          <div className="dock-market-pair">
            {String(params.pairLabel ?? "") || "NO MARKET"}
            {ok?.candidate ? <i className="mt-venuechip">{venueLabel(ok.candidate.venue)}</i> : null}
          </div>
          {/* Two tokens, not the spec's three: the venue is already a chip on
              the pair line 8px above, and printing it twice in one column is
              the same noise §3.3 refuses on the installed row. */}
          <div className="dock-market-meta">
            <span>{ref ? `scan ${ref}` : laneLev ? lev(laneLev) : "not priced"}</span>
            <span>capacity {fmtCapacityUsd(laneCap)}</span>
          </div>
          <div className="hm-keys">
            <button
              type="button"
              className="hm-key lit"
              data-key="swap"
              onClick={(e) => {
                e.stopPropagation();
                onSwap();
              }}
            >
              <span className="hm-led" />
              Swap market
            </button>
          </div>
        </div>
      ) : (
        <PlateControls
          moduleKey={moduleKey}
          params={params}
          ctx={paramCtx}
          reprice={reprice}
          onParam={onParam}
          onEject={onEject}
        />
      )}
    </div>
  );
}
