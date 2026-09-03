/**
 * Canvas parameter schema (BC-P3) — ONE derivation + ONE validator, consumed
 * identically by the UI, the /api/canvas routes, and the future registry-write
 * scripts. Users turn dials; the full band set is DERIVED and clamped here.
 *
 * The invariants below are not aesthetic: each encodes a shipped bug class
 * (SS-2, T5, D4, P0-3) or an on-chain/WAVS requirement. Do not loosen one
 * without reading the incident it encodes.
 */

export type RiskPreset = "conservative" | "standard" | "aggressive";

// ── Health-factor bands (loop side, bps of HF) ────────────────────────────
//
// House scheme (kHYPE lineage): open at HF 1.25 (HF_TARGET, simulate.ts),
// standard trim ~1.18, emergency below 1.10 with the emergency re-lever
// target back INSIDE the band (T5: emergency target ∈ [deleverage, target]).
// Presets move the trim/emergency spacing, never below the house floor.

export interface HfBands {
  /** Steady-state open/re-lever target. */
  hfTargetBps: number;
  /** Standard deleverage trigger (trim back toward target). */
  hfDeleverageBps: number;
  /** Emergency floor: last automated line before liquidation at 10000. */
  hfFloorBps: number;
  /** Where the emergency deleverage re-levers to (T5: inside the band). */
  hfEmergencyTargetBps: number;
}

const HF_HOUSE = { target: 12_500, deleverage: 11_800, floor: 11_000 };
/** T5 incident value: emergency target parks at 1.30, inside [floor, ∞) and
 *  above target so a post-emergency book is unambiguously safe. */
const HF_EMERGENCY_TARGET = 13_000;

const PRESET_SPREAD: Record<RiskPreset, number> = {
  conservative: 1.5, // wider gaps: trims earlier, more headroom
  standard: 1.0,
  aggressive: 0.6, // tighter gaps, never below house floor
};

export function deriveHfBands(preset: RiskPreset): HfBands {
  const k = PRESET_SPREAD[preset];
  const target = HF_HOUSE.target + Math.round((k - 1) * 1_000); // 11900..13000 by preset
  const deleverage = HF_HOUSE.floor + Math.round(k * (HF_HOUSE.deleverage - HF_HOUSE.floor));
  return {
    hfTargetBps: Math.max(target, deleverage + 200),
    hfDeleverageBps: deleverage,
    hfFloorBps: HF_HOUSE.floor, // emergency floor is not preset-tunable
    hfEmergencyTargetBps: Math.max(HF_EMERGENCY_TARGET, target),
  };
}

// ── HL margin bands (hedge side, ratio of notional) ───────────────────────
//
// MM-additive rule (strategy-constants.ts): venue MM = 1/(2·maxLeverage);
// every band = MM + the SAME absolute pp offset the shipped strategies use.
// The binding constraint is distance-to-liquidation, an absolute quantity —
// hence additive, not proportional. All edges snap to 25 bps (the WAVS
// hl_margin.rs quantizer requirement — off-bucket edges break quorum).

export interface HlMarginBandsDerived {
  maintenanceMargin: number;
  fastTrim: number; // MM + 0.015  (W12)
  safetyFloor: number; // MM + 0.03   (W11 defender)
  yellowCeiling: number; // MM + 0.12   (top-up cascade)
  regrowGate: number; // MM + 0.15
  restore: number; // MM + 0.18   (SS-2: ≥ regrowGate + 3pp)
}

// ── Loop leverage clamp ───────────────────────────────────────────────────
//
// The house never opens above HF_TARGET-derived leverage for the market's
// liquidation threshold. The dial can go safer, never past the house.

export function houseMaxLeverage(lt: number): number {
  const HF_TARGET = 1.25;
  return 1 / (1 - lt / HF_TARGET);
}

export function clampLeverage(requested: number, lt: number): number {
  // floor at 3dp: the clamped value must never exceed the exact house max
  const max = Math.floor(houseMaxLeverage(lt) * 1000) / 1000;
  return Math.min(Math.max(1.5, requested), max);
}

// ── Orchestrator dials (ORCHESTRATOR_SPEC R10–R15) ────────────────────────
//
// Exactly three user-touchable dials on the orchestrator node; everything
// else (the OrchRule[] set) is DERIVED in orchestrator/rule-schema.ts. The
// same clamp philosophy as the module params: hard clamps here, one
// derivation, one validator, consumed identically by UI and routes.

type OrchReactivity = "patient" | "standard" | "reactive";

/** The exact PRESET_SPREAD pattern (R11): k scales sustain windows/cooldowns. */
export const ORCH_REACTIVITY_K: Record<OrchReactivity, number> = {
  patient: 1.5,
  standard: 1.0,
  reactive: 0.6,
};

export interface OrchestratorDials {
  reactivity: OrchReactivity;
  maxConcentrationPct: number; // 35..80, step 5, default 60 (R12)
  /** 10..100, step 5, default 25 (R13). Step was 10 until recette P1-7:
   *  the default 25 was unrepresentable on its own slider, so the label
   *  said 25 while the slider and the decode said 30. The grid must always
   *  represent the default. */
  turnoverBudgetPctWeek: number;
}

export const ORCH_DIAL_DEFAULTS: OrchestratorDials = {
  reactivity: "standard",
  maxConcentrationPct: 60,
  turnoverBudgetPctWeek: 25,
};

/** R29/R15 cooldown floor: 12 × WATCHER_COOLDOWN_MS (30min) = 6h. Portfolio
 *  moves are 10–100× costlier than an HL-only resize (2026-05-13 retune). */
export const ORCH_COOLDOWN_FLOOR_MS = 6 * 60 * 60 * 1000;

function snapStep(v: number, min: number, max: number, step: number): number {
  const c = Math.min(max, Math.max(min, v));
  return Math.min(max, min + Math.round((c - min) / step) * step);
}

/** Hard clamp for the three dials. Server-side re-clamp doctrine: the client
 *  is never trusted (R12: values outside [35,80] rejected → clamped here). */
export function clampOrchDials(raw: Partial<Record<keyof OrchestratorDials, unknown>>): OrchestratorDials {
  const reactivity: OrchReactivity =
    raw.reactivity === "patient" || raw.reactivity === "reactive" ? raw.reactivity : "standard";
  const conc =
    typeof raw.maxConcentrationPct === "number" && Number.isFinite(raw.maxConcentrationPct)
      ? snapStep(raw.maxConcentrationPct, 35, 80, 5)
      : ORCH_DIAL_DEFAULTS.maxConcentrationPct;
  const turnover =
    typeof raw.turnoverBudgetPctWeek === "number" && Number.isFinite(raw.turnoverBudgetPctWeek)
      ? snapStep(raw.turnoverBudgetPctWeek, 10, 100, 5)
      : ORCH_DIAL_DEFAULTS.turnoverBudgetPctWeek;
  return { reactivity, maxConcentrationPct: conc, turnoverBudgetPctWeek: turnover };
}
