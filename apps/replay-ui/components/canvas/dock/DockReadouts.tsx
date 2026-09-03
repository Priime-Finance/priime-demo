"use client";

/**
 * DockReadouts (IT4_DOCK_SPEC §4.2, mockup register 2026-08-20) — derived
 * readouts above the mirrored module controls. Fed by the lane's effective
 * quote; every number carries the `modeled` register and a block pin when
 * one exists. Quoting is a badge state, never a spinner.
 */

import type { ModuleKey } from "@/lib/canvas/types";
import type { RepriceData } from "../types";

const pct = (v: number | null | undefined, dp = 1) =>
  typeof v === "number" ? `${(v * 100).toFixed(dp)}%` : "—";

export default function DockReadouts({
  laneLabel,
  moduleName,
  moduleKey,
  reprice,
  repricing,
}: {
  laneLabel: string;
  moduleName: string;
  moduleKey: ModuleKey;
  reprice: RepriceData | null;
  repricing: boolean;
}) {
  const ok = reprice?.ok === true ? reprice : null;
  const econ = ok?.candidate?.economics ?? null;
  const hf = ok?.bands.hf ?? null;
  const margin = ok?.bands.margin ?? null;
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
          <div className="dock-ro-row">
            <span>applied leverage</span>
            <b>{(ok.appliedLeverage ?? ok.requestedLeverage ?? 3).toFixed(2)}x</b>
          </div>
          {hf ? (
            <div className="dock-ro-row">
              <span>HF band</span>
              <b>
                auto-levers {(hf.hfTargetBps / 1e4).toFixed(2)} · auto-delevers{" "}
                {(hf.hfDeleverageBps / 1e4).toFixed(2)}
              </b>
            </div>
          ) : null}
          {moduleKey === "hedge" && margin ? (
            <div className="dock-ro-row">
              <span>margin band</span>
              <b>
                defender floor {pct(margin.safetyFloor)} · restore {pct(margin.restore)}
              </b>
            </div>
          ) : null}
          {econ && econ.fundingP25Apr !== null ? (
            <div className="dock-ro-row">
              <span>funding</span>
              <b>
                {econ.fundingP25Apr >= 0 ? "earns" : "costs"} {pct(Math.abs(econ.fundingP25Apr))} ·
                funding p25
              </b>
            </div>
          ) : null}
          <div className="dock-ro-row">
            <span>min deposit</span>
            <b>${ok.minDepositUsd}</b>
          </div>
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
