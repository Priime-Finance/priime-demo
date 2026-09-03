/**
 * Lane-level risk dial (UX_ITERATION_3 §3).
 *
 * ONE dial, three stops (Safer · Balanced · Max, default Balanced since
 * recette P1-4: defaults must never land a retail user on max risk,
 * especially while a drying spread makes leverage yield-negative). PURE UI
 * derivation: each stop maps to a fraction of the house-max leverage for the
 * picked market's liquidation threshold plus an HF preset, written through
 * the SAME params (targetLeverage / riskPreset) and the SAME clamps
 * (clampLeverage, the safety-buffer descriptor grid) the v2 dials used.
 * The compiler/API surface is untouched — no new math, no new schema fields.
 *
 * Max = 1.0× house max is safe BY CONSTRUCTION: houseMaxLeverage(lt) is the
 * leverage at which the loop opens exactly at HF_TARGET (1.25) — the house
 * safety envelope, not a limit the dial can breach.
 */

import { clampLeverage, houseMaxLeverage, type RiskPreset } from "./param-schema";
import { getDef } from "./modules";

export type RiskStop = "safer" | "balanced" | "max";

const RISK_STOPS: readonly RiskStop[] = ["safer", "balanced", "max"];

/** Fraction of house-max leverage per stop (founder ruling 2026-07-28). */
const RISK_FRACTION: Record<RiskStop, number> = {
  safer: 0.6,
  balanced: 0.8,
  max: 1.0,
};

/** HF preset per stop: Safer widens the trim gaps, Balanced/Max run standard. */
const RISK_PRESET: Record<RiskStop, RiskPreset> = {
  safer: "conservative",
  balanced: "standard",
  max: "standard",
};

interface RiskDerivation {
  targetLeverage: number;
  riskPreset: RiskPreset;
}

/**
 * Stop + market lt → the exact params the dial writes, through the EXISTING
 * clampLeverage (house cap at the top, 1.5x floor at the bottom).
 */
export function deriveRiskParams(stop: RiskStop, lt: number): RiskDerivation {
  const raw = RISK_FRACTION[stop] * houseMaxLeverage(lt);
  return { targetLeverage: clampLeverage(raw, lt), riskPreset: RISK_PRESET[stop] };
}

/**
 * The descriptor snap graph-ops applies when the derived leverage is written
 * via updateParam (slider grid: min 1.5, step 0.25, max 5). Mirrored here so
 * stop inference compares stored values on the same grid.
 */
function snapToLeverageGrid(v: number): number {
  const d = getDef("safety-buffer").params.find((p) => p.field === "targetLeverage");
  const min = typeof d?.min === "number" ? d.min : 1.5;
  const max = typeof d?.max === "number" ? d.max : 5;
  const step = typeof d?.step === "number" ? d.step : 0.25;
  const c = Math.min(max, Math.max(min, v));
  return Number(Math.min(max, min + Math.round((c - min) / step) * step).toFixed(6));
}

/**
 * Infer the dial position from stored safety-buffer params. Anything that
 * does not match a stop exactly (hand-tuned advanced values, unknown lt,
 * legacy drafts) reads as "custom" — the dial never lies about what applies.
 */
export function matchRiskStop(
  params: { targetLeverage?: unknown; riskPreset?: unknown },
  lt: number | null,
): RiskStop | "custom" {
  const lev = typeof params.targetLeverage === "number" ? params.targetLeverage : null;
  const preset = typeof params.riskPreset === "string" ? params.riskPreset : null;
  if (lev === null || preset === null || lt === null) return "custom";
  for (const stop of RISK_STOPS) {
    const d = deriveRiskParams(stop, lt);
    if (preset === d.riskPreset && Math.abs(lev - snapToLeverageGrid(d.targetLeverage)) < 1e-6) {
      return stop;
    }
  }
  return "custom";
}
