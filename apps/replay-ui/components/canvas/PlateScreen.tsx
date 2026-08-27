"use client";

/**
 * PlateScreen (UX_SPEC §2.1, mockup register 2026-08-20) — the 142px OLED,
 * kind-mapped per module: src / band / gauge / fill / vault-src. Every
 * number carries the modeled register pinned to the latest scan; quoting
 * dims the screen (hardware state), never a spinner or a paragraph.
 * Eligibility verdicts, gate counts and stale-scan flags are gone: the
 * mockup presents clean, current-looking data.
 */

import { useEffect, useRef, useState } from "react";
import type { ModuleKey, ParamValue } from "@/lib/canvas/types";
import type { RepriceData } from "./types";

const pct = (v: number | null | undefined, dp = 1) =>
  typeof v === "number" ? `${(v * 100).toFixed(dp)}%` : "—";

export type ScreenState = "idle" | "quoting" | "ok" | "noquote";

interface PlateScreenProps {
  moduleKey: ModuleKey;
  params: Record<string, ParamValue>;
  reprice: RepriceData | null;
  state: ScreenState;
}

/** rAF count-up tween for the vault Net APY (UX §3.2 hero moment). */
export function useCountUp(target: number | null, ms = 500): number | null {
  const [value, setValue] = useState<number | null>(target);
  const fromRef = useRef<number | null>(target);
  useEffect(() => {
    if (target === null) {
      setValue(null);
      fromRef.current = null;
      return;
    }
    const from = fromRef.current ?? target;
    fromRef.current = target;
    if (from === target) {
      setValue(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const eased = 1 - (1 - k) * (1 - k);
      setValue(from + (target - from) * eased);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}

export default function PlateScreen({ moduleKey, params, reprice, state }: PlateScreenProps) {
  const ok = reprice?.ok === true ? reprice : null;
  const econ = ok?.candidate?.economics ?? null;

  const badge = (text: string, good: boolean) => (
    <span className={`hm-bdg${good ? " ok" : ""}`} data-badge>
      {text}
    </span>
  );
  const statusBadge = (idleText: string, okText: string, good = true) => {
    if (state === "quoting") return badge("…", false);
    if (state === "ok") return badge(okText, good);
    return badge(idleText, false);
  };

  if (moduleKey === "liquidity-source") {
    const pair = String(params.pairLabel ?? "");
    const sub = !pair
      ? "pick a market"
      : `${String(params.cls) === "N1" ? "unhedged" : "hedged"} · ${pct(econ?.netApyOnDepositApy ?? ok?.candidate?.headlineApr)} modeled`;
    return (
      <div className="hm-scr">
        <div className="hm-st">
          <span>Market</span>
          {statusBadge(pair ? "pinned" : "empty", "modeled")}
        </div>
        <div className="hm-mid hm-mid-src">
          <div className="hm-src-val">{pair || "NO MARKET"}</div>
          <div className="hm-sb">{sub}</div>
        </div>
      </div>
    );
  }

  if (moduleKey === "safety-buffer") {
    const hf = ok?.bands.hf ?? null;
    const lev = ok?.appliedLeverage ?? (typeof params.targetLeverage === "number" ? params.targetLeverage : 3);
    const markerPct = Math.min(96, Math.max(4, ((lev - 1.5) / (5 - 1.5)) * 100));
    return (
      <div className="hm-scr">
        <div className="hm-st">
          <span>HF band</span>
          {statusBadge("derive", hf ? `HF ${(hf.hfTargetBps / 1e4).toFixed(2)}` : "derived")}
        </div>
        <div className="hm-mid">
          <div className="hm-bandw">
            <span className="hm-bz warn" />
            <span className="hm-bz" />
            <span className="hm-bz act" />
            <span className="hm-bz" />
            <span className="hm-bmk" data-marker style={{ left: `${markerPct}%` }} />
          </div>
          <div className="hm-brow">
            <span>Emergency</span>
            <span>Trim</span>
            <span>Open</span>
          </div>
          <div className="hm-val" data-val>
            {lev.toFixed(2)}x
          </div>
        </div>
        <div className="hm-sb">
          {hf
            ? `auto-levers ${(hf.hfTargetBps / 1e4).toFixed(2)} · auto-delevers ${(hf.hfDeleverageBps / 1e4).toFixed(2)}`
            : "auto-levers · auto-delevers"}
        </div>
      </div>
    );
  }

  if (moduleKey === "hedge") {
    const margin = ok?.bands.margin ?? null;
    const funding = econ?.fundingP25Apr ?? null;
    // margin dot vs defender floor: defender at the zero line, restore right.
    const dotPct = margin
      ? Math.min(92, Math.max(8, 50 + ((margin.restore - margin.safetyFloor) / Math.max(margin.restore, 1e-9)) * 40))
      : 50;
    return (
      <div className="hm-scr">
        <div className="hm-st">
          <span>Protection</span>
          {statusBadge("arm", "neutral")}
        </div>
        <div className="hm-mid">
          <div className="hm-gauge">
            <span className="hm-hz" />
            <span className="hm-hdot" data-marker style={{ left: `${dotPct}%` }} />
          </div>
          <div className="hm-val" data-val>
            {funding !== null ? `${funding >= 0 ? "earns" : "costs"} ${pct(Math.abs(funding))}` : "—"}
          </div>
        </div>
        <div className="hm-sb">
          {funding !== null ? `delta-neutral · funding ${pct(funding)} p25` : "delta-neutral · margin auto-managed"}
        </div>
      </div>
    );
  }

  if (moduleKey === "auto-compound") {
    const cadence = String(params.cadence ?? "24h");
    const width = cadence === "6h" ? 78 : cadence === "24h" ? 52 : 26;
    const min = typeof params.minActionUsd === "number" ? params.minActionUsd : 25;
    return (
      <div className="hm-scr">
        <div className="hm-st">
          <span>Recapture</span>
          {statusBadge(cadence, cadence)}
        </div>
        <div className="hm-mid">
          <div className="hm-fill">
            <span className="hm-fillbar" data-bar style={{ width: `${width}%` }} />
          </div>
          <div className="hm-val" data-val>
            ${min} min
          </div>
        </div>
        <div className="hm-sb">re-levers earned yield to target</div>
      </div>
    );
  }

  return null;
}
