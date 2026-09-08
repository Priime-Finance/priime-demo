"use client";

/* eslint-disable eqeqeq --
 * Kit-verbatim file, ported from build.priime.finance eb6d33a. The rules
 * above are the kit's own idiom (untyped fetch/localStorage JSON, loose
 * equality on sentinel values, the hook dependency lists it ships with);
 * not rewriting kit logic to satisfy lint, per the integration's own
 * directive. */
/**
 * DockReadouts (IT4_DOCK_SPEC §4.2, mockup register 2026-08-20) — derived
 * readouts above the mirrored module controls. Fed by the lane's effective
 * quote; every number carries the `modeled` register and a block pin when
 * one exists. Quoting is a badge state, never a spinner.
 */

import type { ModuleKey } from "@/lib/canvas/types";
import { NO_BORROW_BANDS_VALUE } from "@/lib/canvas/labels";
import { lev, pct } from "@/lib/canvas/format";
import { adverseMoveLine, liquidationDistance } from "@/lib/canvas/liquidation";
import { hedgeEconomics, hedgeHero } from "@/lib/canvas/hedge-econ";
import type { LaneComposition } from "@/lib/canvas/mock-quote";
import type { RepriceData } from "../types";

export default function DockReadouts({
  laneLabel,
  moduleName,
  moduleKey,
  reprice,
  repricing,
  hasHedge,
  comp,
}: {
  laneLabel: string;
  moduleName: string;
  moduleKey: ModuleKey;
  reprice: RepriceData | null;
  repricing: boolean;
  /**
   * Whether the LANE actually holds the hedge module (recette F9, W4-04).
   * These readouts used to key the two hedge rows on the MARKET's class — a
   * class-A candidate produces `hedgeEconomics` whether or not the module is
   * installed — so the Dynamic-leverage panel printed `funding 10.9% p25` and
   * `hedge value / pays 8.0pp` on a lane holding only market + leverage. The
   * rows describe a module; they render only where the module is.
   *
   * Optional until ModulePanel threads it (that file is owned elsewhere; see
   * the fixwave handoff). Absent, the one thing this panel can prove is its
   * own subject: the hedge module's OWN panel can only be open when the
   * module is seated, so `moduleKey === "hedge"` keeps those readouts, and
   * every other panel withholds what it cannot prove.
   */
  hasHedge?: boolean;
  /**
   * THE LANE'S COMPOSITION (C6, 2026-08-24).
   *
   * `hedge-econ`'s contract asks every caller holding a lane to pass it — "omit
   * it only when all you hold is an un-repriced catalog row" — and it decides
   * two things: f_b, and the compound step inside the PRODUCT frame the
   * `hedge value` row prints. Measured on Dolomite sWBERA/WBERA at 1.00x with
   * auto-compound on 24h, block 25282880: this row read `pays 2.0pp` while the
   * hedge plate 200px away read `pays 2.2pp`. One hedge, two numbers, which is
   * the whole defect this wave exists to close.
   *
   * ⚠ OPTIONAL, AND STILL UNPASSED. `ModulePanel` already holds this exact
   * object (it threads it to `laneCapacityUsd` on the line above its
   * `<DockReadouts>`), but that file is outside this change's ownership, so the
   * one-line `comp={comp}` is written to `seams-w3.md` instead of taken here.
   * Absent, this row behaves exactly as it did before — no regression, and the
   * seam is a single prop away from closed.
   */
  comp?: LaneComposition | null;
}) {
  const ok = reprice?.ok === true ? reprice : null;
  const econ = ok?.candidate?.economics ?? null;
  const hedgeInstalled = hasHedge ?? moduleKey === "hedge";
  const hedge = hedgeInstalled ? hedgeEconomics(ok?.candidate, comp ?? undefined) : null;
  /* The window the hedge's funding rate is published over (F3/D1), copied
     onto the row by `reconcileHedgeFunding` where the funding venue priced
     this book. Absent, the rate prints without one, exactly as before. */
  const fundingWindowDays = econ?.fundingWindowDays ?? null;
  const hf = ok?.bands.hf ?? null;
  const optionModule =
    moduleKey === "auto-center" || moduleKey === "covered-call" || moduleKey === "protective-put";
  /* ONE LiqDistance, read twice: the liquidation row prints its line and the
     HF band row keys its no-debt state off the same object, so the two rows
     cannot disagree about whether a borrow leg exists. */
  const liq = liquidationDistance(ok?.candidate?.lt, ok?.candidate?.economics?.loopLeverage);
  const cushion = adverseMoveLine(liq);
  /* A pinned market with no lending leg (funding/spot rows: `lt: null`,
     `debtSymbol: ""`) has no borrow leg at any leverage — the same rule
     `liquidationLinesOfLane` counts legs by — so the HF row withholds there
     too, not only at 1.00x (gate catch, 2026-08-24). */
  const spotOnly =
    ok?.candidate != null && (ok.candidate.lt == null || !ok.candidate.debtSymbol);
  const noDebt = spotOnly || liq?.unlevered === true;

  const badge = repricing ? (
    <span className="hm-bdg" data-badge>…</span>
  ) : (
    <span className={`hm-bdg${ok ? " ok" : ""}`} data-badge>modeled</span>
  );

  return (
    <div className="dock-readouts">
      <div className="dock-ro-head">
        <span className="dock-ro-lane">{laneLabel}</span>
        <span className="dock-ro-mod">{moduleName}</span>
        {badge}
      </div>
      {ok ? (
        <div className="dock-ro-rows">
          {/* Leverage readouts belong to the loop family; the range and
              option modules carry their own screens instead. */}
          {!optionModule ? (
            <div className="dock-ro-row">
              <span>applied leverage</span>
              {/* §4.5 — the leverage the MODEL used, never `appliedLeverage`:
                  repriceAtLeverage independently caps at min(applied, L0), so
                  the two diverge whenever the scan's own L0 is below the
                  house max, and this readout sits 200px from a plate. */}
              <b>{lev(ok.candidate?.economics?.loopLeverage ?? ok.appliedLeverage ?? ok.requestedLeverage ?? 3)}</b>
            </div>
          ) : null}
          {/* ⚠ THE RISK ROW, IN THE DEPOSITOR'S OWN UNIT (2026-08-22). The
              HF band below states what the AUTOMATION does and keeps its job;
              it does not state what the depositor is exposed to. This row
              does, through `liquidation.ts` — the same function the lane
              header, the compose control and the vault page read, so a
              builder and a depositor cannot be reading two numbers for one
              geometry. Withheld whole when the market's own threshold is not
              in hand: a cushion that cannot be proven prints nothing. */}
          {cushion && !optionModule ? (
            <div className="dock-ro-row">
              <span>liquidation</span>
              <b>{cushion}</b>
            </div>
          ) : null}
          {hf && !optionModule ? (
            <div className="dock-ro-row">
              <span>HF band</span>
              {/* ⚠ WITHHELD AT NO DEBT (G7 nit, 2026-08-24). At 1.00x the band
                  derivation clamps to its sentinel and this row printed
                  `auto-levers 10.00 · auto-delevers 9.93` on a lane that
                  borrows nothing, beside a liquidation row correctly answering
                  `no borrow leg to liquidate`. Same state, same grammar: with
                  no borrow leg there is no band to trim inside. */}
              <b>
                {noDebt
                  ? NO_BORROW_BANDS_VALUE
                  : `auto-levers ${(hf.hfTargetBps / 1e4).toFixed(2)} · auto-delevers ${(
                      hf.hfDeleverageBps / 1e4
                    ).toFixed(2)}`}
              </b>
            </div>
          ) : null}
          {/* The `margin band` row left with the plate's margin gauge
              (shadow-price R4). `mockQuote` sets `bands.margin = null` and the
              server path is gated on `launchableVenue`, so the row rendered on
              none of the 12 mock-priced rows and repeated one of two
              catalog-wide value pairs on the other 3. The escrow it was
              gesturing at is now stated where it moves: the hedge plate's
              caption and the panel ledger. */}
          {/* ⚠ SOLE ACCESSOR (model-core wave 2026-08-22). This row read the
              raw p25 funding rate off the compile economics block and applied
              its own earns/costs verb —
              one of the three independent call sites behind the screen where
              one hedge "earned 8.7%" and "cost 7.7%" at once. `hedge` is a
              RATE (`%`) and `hedge value` is a difference in POINTS (`pp`);
              they are different quantities and they now say so. */}
          {hedge ? (
            <>
              <div className="dock-ro-row">
                <span>funding</span>
                <b>
                  {pct(hedge.fundingApr)} p25
                  {fundingWindowDays != null ? ` over ${fundingWindowDays}d` : ""}
                </b>
              </div>
              <div className="dock-ro-row">
                <span>hedge value</span>
                <b>{hedgeHero(hedge)}</b>
              </div>
            </>
          ) : null}
          {/* `min deposit` moved to Review (shadow-price R5). Two values exist
              across the entire catalog — $50 on 12 of 15 rows, $80 on the
              ETH-hedged launchable ones — so it failed the same test that
              rejected a constant in the hedge hero: a readout slot that prints
              the same characters on every lane is chrome. It is still stated
              before a deposit, on the deposit rail. */}
          <div className="dock-ro-register">
            {ok.blockNumber ? `modeled · block ${ok.blockNumber}` : "modeled"}
          </div>
        </div>
      ) : (
        <div className="dock-ro-rows">
          <div className="dock-ro-register">modeled</div>
        </div>
      )}
    </div>
  );
}
