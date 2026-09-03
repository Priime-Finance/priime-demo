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
import { getDef } from "@/lib/canvas/modules";
import PlateControls from "../PlateControls";
import DockReadouts from "./DockReadouts";
import type { RepriceData } from "../types";

const pct = (v: number | null | undefined) =>
  typeof v === "number" ? `${(v * 100).toFixed(1)}%` : "—";
const cap = (v: number | null | undefined) =>
  typeof v === "number" ? (v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}k`) : "—";

export default function ModulePanel({
  laneLabel,
  moduleKey,
  params,
  reprice,
  repricing,
  onParam,
  onEject,
  onAdvancedTouch,
  onSwap,
}: {
  laneLabel: string;
  moduleKey: ModuleKey;
  params: Record<string, ParamValue>;
  reprice: RepriceData | null;
  repricing: boolean;
  onParam: (field: string, value: ParamValue) => void;
  onEject?: () => void;
  onAdvancedTouch?: () => void;
  onSwap: () => void;
}) {
  const def = getDef(moduleKey);
  const ok = reprice?.ok === true ? reprice : null;
  const econ = ok?.candidate?.economics ?? null;

  return (
    <div className="dock-module" onClick={(e) => e.stopPropagation()}>
      <DockReadouts
        laneLabel={laneLabel}
        moduleName={def.name}
        moduleKey={moduleKey}
        reprice={reprice}
        repricing={repricing}
      />

      {moduleKey === "liquidity-source" ? (
        <div className="dock-market">
          <div className="dock-market-pair">
            {String(params.pairLabel ?? "") || "NO MARKET"}
            {ok?.candidate ? <i className="mt-venuechip">{venueLabel(ok.candidate.venue)}</i> : null}
          </div>
          <div className="dock-market-meta">
            <span>{String(params.cls) === "N1" ? "unhedged" : "hedged"}</span>
            <span>net {pct(econ?.netApyOnDepositApy ?? ok?.candidate?.headlineApr)} modeled</span>
            <span>capacity {cap(econ?.capacityUsd)}</span>
          </div>
          <div className="hm-keys">
            <div
              role="button"
              tabIndex={0}
              className="hm-key lit"
              data-key="swap"
              onClick={(e) => {
                e.stopPropagation();
                onSwap();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onSwap();
              }}
            >
              <span className="hm-led" />
              Swap market
            </div>
          </div>
        </div>
      ) : (
        <PlateControls
          moduleKey={moduleKey}
          params={params}
          onParam={onParam}
          onEject={onEject}
          onAdvancedTouch={onAdvancedTouch}
        />
      )}
    </div>
  );
}
