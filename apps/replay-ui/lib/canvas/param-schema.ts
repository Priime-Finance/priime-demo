/**
 * Canvas parameter schema (BC-P3) — ONE derivation + ONE validator, consumed
 * identically by the UI, the /api/canvas routes, and the future registry-write
 * scripts. Users turn dials; the full band set is DERIVED and clamped here.
 *
 * The invariants below are not aesthetic: each encodes a shipped bug class
 * (T5, D4, A1, A3, A9, A12) or an on-chain/Priime requirement. Do not loosen one
 * without reading the incident it encodes. Equally: do not ADD one that
 * restates a constant defined ten lines above it. Three of the five that
 * shipped here did exactly that and were deleted (see the validator note).
 */

export type RiskPreset = "conservative" | "standard" | "aggressive";

// ── Grid helpers ──────────────────────────────────────────────────────────
//
// Rule (recette (c)): every clamp against a safety ceiling FLOORS to the
// grid; only free parameters round to nearest. Rounding a cap-derived value
// to nearest is how the Max stop came to store 4.25 against a 4.1667 house
// cap (A3) — the stored param was above the ceiling it was derived from.

/** Largest multiple of `grid` at or below `v`. Never returns above `v`. */
export function floorToGrid(v: number, grid: number): number {
  if (!(grid > 0) || !Number.isFinite(v)) return v;
  return Number((Math.floor(v / grid + 1e-9) * grid).toFixed(6));
}

/** Smallest multiple of `grid` at or above `v`. For lower bounds, which must
 *  never land below the quantity they are protecting. */
export function ceilToGrid(v: number, grid: number): number {
  if (!(grid > 0) || !Number.isFinite(v)) return v;
  return Number((Math.ceil(v / grid - 1e-9) * grid).toFixed(6));
}

/** The safety-buffer leverage slider grid (modules.ts descriptor step). */
export const LEVERAGE_GRID = 0.25;

/**
 * The lowest leverage the product will build at (A2, 2026-08-22). Was 1.5.
 *
 * `netApy(L)` is AFFINE in L, with slope `f_b · (collateralYieldApy −
 * borrowApyMarginal)` — constant in L. When that slope is negative the maximum
 * over the reachable interval is the BOTTOM corner, and the bottom corner of
 * the real problem is L = 1: a plain supply position, hedged, with no borrow
 * leg at all. The slider floored at 1.5, so on the live catalog the optimum
 * sat OUTSIDE the control's range on 13 of 15 depositable rows. syrupUSDC/GHO
 * models −24.01% at the Balanced stop and +4.31% at L = 1 — a 28.3pp swing the
 * user could not reach by dragging.
 *
 * 1.0 is therefore not a degenerate input to be guarded around; it is the
 * corner solution of the model this product already ships, and the guards
 * below (`hfTargetBpsFor`, `HF_TARGET_CAP_BPS`) exist so it can be REACHED,
 * not so it can be excluded.
 *
 * The safety-buffer module stays installed at L = 1. Ejecting it to reach the
 * corner trips `optional: false` in four places (graph-ops `FAMILY_REQUIRED`,
 * two more sites there, `compose-options`) and drops the lane into the phantom
 * `targetLeverage ?? 3` path. Lower the floor; keep the module.
 */
export const PRODUCT_MIN_LEVERAGE = 1;

// ── Health-factor bands (loop side, bps of HF) ────────────────────────────
//
// ONE steady state (recette A1). The leverage dial and the HF band are two
// encodings of the same position, so the band is DERIVED from the applied
// leverage and the market's liquidation threshold, never from the preset
// alone:
//
//     HF_target = lt · L / (L − 1)
//
// The preset scales ONLY the gaps below that target (how early the machine
// trims, how much room it leaves before the emergency line). House lineage
// (kHYPE, simulate.ts): open at HF 1.25 with a trim at 1.18, i.e. a 7pp
// standard gap, and an absolute emergency floor at 1.10 that no preset can
// move. Before this change `deriveHfBands` read only the preset, so Safer on
// lt 0.75 opened at HF 2.25 under a band telling the automation to re-lever
// above HF 1.30 (= 3.71x): the automation undid the dial the moment it armed.

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

/** The house trim gap in HF units: 1.25 open → 1.18 trim. */
const HOUSE_TRIM_GAP = (HF_HOUSE.target - HF_HOUSE.deleverage) / 10_000; // 0.07

const PRESET_SPREAD: Record<RiskPreset, number> = {
  conservative: 1.5, // wider gaps: trims earlier, more headroom
  standard: 1.0,
  aggressive: 0.6, // tighter gaps, never below house floor
};

/** The trim gap this preset runs, in HF units (0.105 / 0.07 / 0.042). */
export function presetSpread(preset: RiskPreset): number {
  return Number((HOUSE_TRIM_GAP * PRESET_SPREAD[preset]).toFixed(6));
}

/** Beyond HF 10 a position is effectively unliquidatable and the band is
 *  decorative; cap so an L at or approaching 1 cannot produce Infinity. */
export const HF_TARGET_CAP_BPS = 100_000;

/**
 * The steady-state health factor a position at leverage `L` on a market with
 * liquidation threshold `lt` actually opens at. The one definition.
 *
 * At L = 1 there is no borrow leg, so there is no liquidation price and HF is
 * unbounded. Since A2 made 1.0 a REACHABLE dial position, that is answered
 * directly with the cap rather than by dividing by an epsilon: the old
 * `Math.max(1 + 1e-6, L)` produced 1e6·lt before the cap clipped it, and
 * returned NaN for a non-finite L. Both now return the cap, which is the
 * honest reading — an unlevered position is not liquidatable.
 */
export function hfTargetBpsFor(liqLtv: number, appliedLeverage: number): number {
  if (!(appliedLeverage > 1)) return HF_TARGET_CAP_BPS;
  const hf = (liqLtv * appliedLeverage) / (appliedLeverage - 1);
  if (!Number.isFinite(hf)) return HF_TARGET_CAP_BPS;
  return Math.min(HF_TARGET_CAP_BPS, Math.round(hf * 10_000));
}

/** Distance to liquidation at a given HF target, as a fraction of collateral
 *  value: 1 − 1/HF. The quantity a depositor can actually check. */
export function distanceToLiquidation(hfTargetBps: number): number {
  if (!(hfTargetBps > 0)) return 0;
  return 1 - 10_000 / hfTargetBps;
}

export function deriveHfBands(preset: RiskPreset, appliedLeverage: number, liqLtv: number): HfBands {
  const spreadBps = Math.round(presetSpread(preset) * 10_000);
  const target = hfTargetBpsFor(liqLtv, appliedLeverage);
  const deleverage = target - spreadBps;
  return {
    hfTargetBps: target,
    hfDeleverageBps: deleverage,
    // The emergency line is absolute: 1.10 is the house floor, and a position
    // that opens close to it inherits the tighter of the two.
    hfFloorBps: Math.max(HF_HOUSE.floor, target - 2 * spreadBps),
    hfEmergencyTargetBps: Math.max(HF_EMERGENCY_TARGET, target),
  };
}

// ── HL margin bands (hedge side, ratio of notional) ───────────────────────
//
// MM-additive rule (strategy-constants.ts): venue MM = 1/(2·maxLeverage);
// every band = MM + the SAME absolute pp offset the shipped strategies use.
// The binding constraint is distance-to-liquidation, an absolute quantity —
// hence additive, not proportional. All edges snap to 25 bps (the Priime
// hl_margin.rs quantizer requirement — off-bucket edges break quorum).

export interface HlMarginBandsDerived {
  maintenanceMargin: number;
  fastTrim: number; // MM + 0.015  (W12)
  safetyFloor: number; // MM + 0.03   (W11 defender)
  yellowCeiling: number; // MM + 0.12   (top-up cascade)
  regrowGate: number; // MM + 0.15
  restore: number; // MM + 0.18   (SS-2: ≥ regrowGate + 3pp)
}

/** EXPORTED so a published ladder edge can be INVERTED back to the maintenance
 *  margin it was derived from (`liquidation.coinMaxLeverageFromMarginRule`).
 *  The offsets are additive over MM by construction, which is the only reason
 *  the inversion is exact rather than a fit. */
export const BAND_OFFSETS = {
  fastTrim: 0.015,
  safetyFloor: 0.03,
  yellowCeiling: 0.12,
  regrowGate: 0.15,
  restore: 0.18,
} as const;

export const BPS_BUCKET = 0.0025; // 25 bps

export function snap25(v: number): number {
  return Number((Math.round(v / BPS_BUCKET) * BPS_BUCKET).toFixed(6));
}

/** Snap UP to the 25 bps grid. Maintenance margin is a liquidation distance,
 *  so its quantizer must never round TOWARD liquidation (A9): a coin with
 *  venue maxLeverage 6 has MM 8.333%, and nearest-rounding shipped 8.25% —
 *  8 bps of the depositor's buffer given away by the quantizer. */
export function snapUp25(v: number): number {
  return ceilToGrid(v, BPS_BUCKET);
}

export function deriveHlMarginBands(coinMaxLeverage: number): HlMarginBandsDerived {
  // The venue rule is MM = 1/(2·maxLeverage); the grid may only ever make it
  // MORE conservative. Every offset is an exact multiple of 25 bps (0.015 =
  // 6 buckets, 0.03 = 12, 0.12 = 48, 0.15 = 60, 0.18 = 72), so deriving the
  // bands from the SNAPPED mm keeps the whole ladder on the grid with no
  // further rounding — snap25 below only clears float dust.
  const mm = snapUp25(1 / (2 * coinMaxLeverage));
  return {
    maintenanceMargin: mm,
    fastTrim: snap25(mm + BAND_OFFSETS.fastTrim),
    safetyFloor: snap25(mm + BAND_OFFSETS.safetyFloor),
    yellowCeiling: snap25(mm + BAND_OFFSETS.yellowCeiling),
    regrowGate: snap25(mm + BAND_OFFSETS.regrowGate),
    restore: snap25(mm + BAND_OFFSETS.restore),
  };
}

// ── Hedge dial bounds, derived from the margin ladder (A11, A12) ──────────
//
// Both hedge dials are ranges the market defines, not ranges someone typed.
// They are also the two terms of the escrow fraction
// f_b = L_h/(L_h + 1 + r·L_h) (see lib/canvas/mock-quote.ts `fB`), so a bound
// that is not derived from the ladder mis-sizes the hedge AND the capacity.

/** `hedgeLeverage` admissible range. The short's own margin ratio 1/L_h must
 *  sit at or above the restore band (= MM + 18pp), otherwise the hedge opens
 *  INSIDE the band the refill machine is supposed to restore it to: at HL
 *  maxLeverage 3 that ceiling is 2.88, and the shipped default of 3 opened
 *  under it. Floors to the 0.5 dial grid — it is a safety ceiling. */
export function hedgeLeverageBounds(bands: HlMarginBandsDerived): {
  min: number;
  max: number;
  step: number;
  default: number;
} {
  const step = 0.5;
  const max = Math.max(1.5, floorToGrid(1 / bands.restore, step));
  return { min: 1.5, max, step, default: Math.min(3, max) };
}

/** `reserveFraction` admissible range. The reserve funds the refill from the
 *  defender floor back to restore, so its FLOOR is that distance
 *  (restore − safetyFloor = 15pp), not the 10pp that shipped. Ceils to the
 *  0.05 dial grid — it is a lower bound. */
export function reserveFractionBounds(bands: HlMarginBandsDerived): {
  min: number;
  max: number;
  step: number;
  default: number;
} {
  const step = 0.05;
  const min = ceilToGrid(bands.restore - bands.safetyFloor, step);
  const max = Math.max(min, 0.3);
  return { min, max, step, default: min };
}

// ── Loop leverage clamp ───────────────────────────────────────────────────
//
// FOUNDER RULING (2026-08-21): the house maximum is the TRIM trigger, not the
// opening leverage. "Maximum" has to mean maximum. The old ceiling was the
// leverage that OPENS at HF 1.25, which left the trim band permitting a
// steady state 23% above the advertised house maximum (HF 1.18 at lt 0.95 is
// L 5.13 against an advertised 4.17 — A8). The ceiling is now the leverage
// whose trim trigger sits at HF 1.25:
//
//     HF_target = 1.25 + spread(preset)   ⇒   L = T / (T − lt),  T = that target
//
// which is 3.50 at lt 0.95 standard (was 4.17) and 2.75 at lt 0.86. It also
// makes the preset earn its keep: a tighter trim gap buys leverage headroom
// (3.78 aggressive vs 3.35 conservative at lt 0.95) instead of being strictly
// dominated.

/** Absolute backstop for the degenerate branch below. No real lending market
 *  has lt anywhere near 1.29, so this is a guard against a garbage lt reaching
 *  the dial, never a reachable ceiling. */
export const HOUSE_LEVERAGE_HARD_CAP = 10;

export function houseMaxLeverage(lt: number, preset: RiskPreset = "standard"): number {
  const T = HF_HOUSE.target / 10_000 + presetSpread(preset);
  if (!Number.isFinite(lt) || !(T > lt)) return HOUSE_LEVERAGE_HARD_CAP;
  return Math.min(HOUSE_LEVERAGE_HARD_CAP, T / (T - lt));
}

export function clampLeverage(requested: number, lt: number, preset: RiskPreset = "standard"): number {
  // floor at 3dp: the clamped value must never exceed the exact house max
  const max = Math.floor(houseMaxLeverage(lt, preset) * 1000) / 1000;
  // A2: the floor is PRODUCT_MIN_LEVERAGE (1), not 1.5. The old floor put the
  // corner optimum outside the clamp on 13 of 15 live rows.
  return Math.min(Math.max(PRODUCT_MIN_LEVERAGE, requested), max);
}

// ── The breakeven leverage (R4, 2026-08-24) ───────────────────────────────
//
// A THIRD CEILING, and it is an ECONOMIC one rather than a safety one.
//
// `houseMaxLeverage` answers "how far before the trim trigger reaches HF 1.25"
// and `scanMaxLeverage` answers "how far did the scan actually price". Neither
// asks whether the position still EARNS at that leverage, and on a market
// where the marginal borrow costs more than the collateral yields, it does
// not. `netCarry(L)` is affine with a NEGATIVE slope there:
//
//     netCarry(L) = L·(y − b) + b + f − drag          (mock-quote.repriceAtLeverage)
//
// so it crosses zero exactly once, at
//
//     L_breakeven = (b + f − drag) / (b − y),    defined only where b > y
//
// and every setting above that crossing models a depositor ending the period
// with less than they put in. The canvas already REFUSES to publish such a
// lane (`review-gating`'s `netApy <= 0` clause), so before this ceiling
// existed the product's own default could land a public `?template=` URL, and
// any market swap under a seated leverage module, on a dead primary action —
// a control offering a setting the next control refuses.
//
// FEE-INVARIANT BY CONSTRUCTION (R1). The compute fee multiplies a positive
// lane by 0.8 and leaves a non-positive one alone, and 0.8 × 0 = 0, so the
// crossing is at the same L before and after the fee. This ceiling and the fee
// identity do not interact.
//
// NOT A SECOND OWNER OF THE ARITHMETIC. The four terms below are the four the
// pricer already carries on the row; `leverage-stops.breakevenStopFor` is the
// one place they are read off a candidate, and `leverage-breakeven-stop.test`
// pins this closed form against `repriceAtLeverage` itself over the committed
// catalog rather than against a restatement of it.

/** The four terms of `netCarry(L)`, exactly as the pricer charges them. */
export interface CarryTerms {
  /** `economics.collateralYieldApy` — what a deployed dollar earns. */
  collateralYieldApy: number;
  /** `economics.borrowApyMarginal` — what the marginal borrowed dollar costs. */
  borrowApyMarginal: number;
  /** Funding credited to the short leg. Zero on a lane that runs no short. */
  fundingApr: number;
  /** Execution drag charged on the lane, hedged or not. */
  execDragApr: number;
}

/**
 * Where `netCarry(L)` crosses zero, or null where it never crosses from above.
 *
 * Null on a non-negative slope is the honest answer, not a fallback: with
 * `y >= b` the carry is flat or rising in L, so there is no leverage past
 * which the lane stops earning and no ceiling to impose.
 */
export function breakevenLeverage(t: CarryTerms): number | null {
  const slope = t.collateralYieldApy - t.borrowApyMarginal;
  if (!Number.isFinite(slope) || slope >= 0) return null;
  const L = (t.borrowApyMarginal + t.fundingApr - t.execDragApr) / -slope;
  return Number.isFinite(L) ? L : null;
}

/**
 * The highest leverage ON THE DIAL'S GRID that still models STRICTLY above
 * zero.
 *
 * The strictness is the whole point of the second clause: `review-gating`
 * closes on `netApy <= 0`, so a crossing that lands exactly on a grid point
 * would otherwise be offered as the max stop and refused as the publish. One
 * grid step down is the largest setting both controls agree on.
 *
 * May return a value below `PRODUCT_MIN_LEVERAGE`, and that is information,
 * not an error: it says the market subtracts at every leverage the product
 * builds at, including the unlevered corner. `deriveLeverageBounds` floors it
 * back to the product minimum, so 1.00x is always offered and the review gate
 * — not the dial — states the refusal with its number.
 */
export function breakevenStop(breakeven: number): number {
  const f = floorToGrid(breakeven, LEVERAGE_GRID);
  return Number((Math.abs(f - breakeven) < 1e-9 ? f - LEVERAGE_GRID : f).toFixed(6));
}

/**
 * The safety-buffer leverage descriptor, derived per market instead of the
 * flat [1.5, 5] that shipped (A7: 17–36% of the slider was dead on every live
 * row). `scanMaxLeverage` is the row's own `economics.loopLeverage` — the
 * highest leverage the scan actually priced; above it the dial moves the
 * readout while nothing reprices (A4).
 *
 * Every cap-derived value FLOORS to the grid.
 *
 * A2 (2026-08-22): `min` is `PRODUCT_MIN_LEVERAGE`. The bounds are the domain
 * an affine objective is maximized over, so a floor above the corner does not
 * merely hide a stop — it changes the answer. Note the grid is unshifted: 1.5,
 * 3.0 and `STRUCTURAL_MAX_LEVERAGE` (3.75) are all exact multiples of 0.25
 * above 1.0, so no stored leverage moved when the floor dropped.
 *
 * `breakevenStopLeverage` is the third ceiling (R4) and it is OPTIONAL and
 * ADDITIVE: a caller that does not hold the market's economics passes nothing
 * and gets exactly the bounds that shipped. It enters the same `Math.min` as
 * the other two rather than post-clamping the result, so `default`, `recMin`
 * and `recMax` are re-derived from the ceiling that actually binds and every
 * member of the returned set stays a member of THIS derivation — the property
 * `single-owner.test.ts` guards for the leverage stops.
 */
export function deriveLeverageBounds(
  lt: number,
  preset: RiskPreset,
  scanMaxLeverage?: number | null,
  breakevenStopLeverage?: number | null,
): { min: number; max: number; step: number; default: number; recMin: number; recMax: number } {
  const min = PRODUCT_MIN_LEVERAGE;
  const ceiling = Math.min(
    houseMaxLeverage(lt, preset),
    typeof scanMaxLeverage === "number" && Number.isFinite(scanMaxLeverage) ? scanMaxLeverage : Infinity,
    typeof breakevenStopLeverage === "number" && Number.isFinite(breakevenStopLeverage)
      ? breakevenStopLeverage
      : Infinity,
  );
  const max = Math.max(min, floorToGrid(ceiling, LEVERAGE_GRID));
  return {
    min,
    max,
    step: LEVERAGE_GRID,
    default: Math.max(min, floorToGrid(0.8 * max, LEVERAGE_GRID)),
    recMin: Math.max(min, floorToGrid(0.5 * max, LEVERAGE_GRID)),
    recMax: Math.max(min, floorToGrid(0.85 * max, LEVERAGE_GRID)),
  };
}

// ── Minimum deposit (D4 chain, launch-config.ts lineage) ──────────────────
//
// Trim-first at the fastTrim trigger needs residual short ≥ $10 dust floor:
// S ≥ 10 · restore/fastTrim, deposit ≈ S/0.75 + gas carve; and the funding
// rail's coverage leg gates at $50 equity. House floor stays $50 unless the
// derived bound exceeds it (wider restore ⇒ larger bound).

/** The ONE minimum deposit (B10 retired four of them: $100 in `mockQuote`,
 *  $100 in `MIN_VIABLE_CAPACITY_USD`, this derived floor, and $10 in the
 *  deposit rail). Every surface that states a minimum reads this or
 *  `minDepositUsd(bands)`, which can only raise it. */
export const MIN_DEPOSIT_USD = 50;

/** The scan's f_b (`simulate.ts` `F_B`), for the one caller shape that holds
 *  no composition. Not an alternative derivation of a running lane's escrow;
 *  see `minDepositUsd` below and `capacity.ts` `SCAN_FB`, which carries the
 *  identical status for the identical reason. */
const SCAN_ESCROW_FRACTION = 0.75;

/**
 * `escrowFraction` is f_b, the share of the deposit that reaches the loop.
 *
 * f_b IS A PARAMETER HERE, NEVER A DERIVATION (R5 grep, 2026-08-22). This
 * module is imported by `mock-quote`, so it cannot import `fbForComposition`
 * back without a cycle — which is exactly why the constant survived here
 * after it was killed everywhere else, and why `compile.ts` was still
 * stating a minimum computed at 0.75 in the same decode block whose APY was
 * priced at 0.6742. Every caller that holds a composition now passes
 * `fbForComposition(comp)`; the default below is the SCAN f_b, carrying the
 * same status as `capacity.ts` `SCAN_FB` — the value a caller with no
 * composition in hand is implicitly denominated in, not a second opinion
 * about the running lane.
 *
 * The default is the CONSERVATIVE direction by construction: a larger f_b
 * divides the dust floor down, so 0.75 can only UNDERSTATE the minimum a
 * composed lane needs, and a composed caller can only raise it.
 */
export function minDepositUsd(bands: HlMarginBandsDerived, escrowFraction = SCAN_ESCROW_FRACTION): number {
  const fb = escrowFraction > 0.05 && escrowFraction <= 1 ? escrowFraction : SCAN_ESCROW_FRACTION;
  const dustFloorShort = 10 * (bands.restore / bands.fastTrim);
  const fromTrim = Math.ceil((dustFloorShort / fb + 2.5) / 5) * 5;
  return Math.max(MIN_DEPOSIT_USD, fromTrim);
}

// ── Orchestrator dials (ORCHESTRATOR_SPEC R10–R15) ────────────────────────
//
// Exactly three user-touchable dials on the orchestrator node; everything
// else (the OrchRule[] set) is DERIVED in orchestrator/rule-schema.ts. The
// same clamp philosophy as the module params: hard clamps here, one
// derivation, one validator, consumed identically by UI and routes.

export type OrchReactivity = "patient" | "standard" | "reactive";

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

// ── Validator: every derived set passes or nothing renders/compiles ───────
//
// A15: three invariants were deleted here because they were tautologies, not
// checks. `ss2-restore-gap` (restore ≥ regrowGate + 3pp), `hysteresis`
// (restore − safetyFloor ≥ 15pp) and `ioc-landability` ((fastTrim − MM)/(1+MM)
// > 1%) all restate BAND_OFFSETS arithmetic: the offsets are constants, the
// differences are exactly 3pp, exactly 15pp and exactly 1.5pp by construction,
// so each passed with zero margin for every input and could only ever fire on
// a hand-mutated band object. A validator whose members cannot fail hides the
// ones that can. The three replacements below all read a quantity the band set
// does NOT determine: the applied leverage, the stored param, the venue's own
// maintenance margin, and the hedge dial.

export interface BandViolation {
  invariant:
    | "hf-ordering" // on-chain require(floor < deleverage < target)
    | "t5-emergency-target" // emergency target inside/above the band
    | "hf-floor-minimum" // emergency ≥ 11000
    | "hf-target-matches-position" // the band describes the leverage actually applied
    | "margin-ordering" // MM < fastTrim < safetyFloor < ... < restore
    | "mm-away-from-liquidation" // MM never quantized toward liquidation
    | "hedge-leverage-margin-band" // the short opens at or above `restore`
    | "bucket-snap" // every margin edge on the 25 bps grid
    | "leverage-house-cap";
  detail: string;
}

/**
 * Context the validator cannot derive from the band sets alone.
 *
 * `storedLeverage` is the param the canvas SAVED and publishes — the value the
 * house cap has to be checked against. Checking the applied leverage (which
 * `clampLeverage` has already pinned to the cap) meant `leverage-house-cap`
 * could never fire, which is how the Max stop came to store 4.25 against a
 * 4.1667 cap (A3).
 */
export interface BandContext {
  storedLeverage?: number | null;
  hedgeLeverage?: number | null;
  coinMaxLeverage?: number | null;
  preset?: RiskPreset;
}

export function validateBands(
  hf: HfBands,
  margin: HlMarginBandsDerived | null,
  loopLeverage: number,
  lt: number,
  ctx: BandContext = {},
): BandViolation[] {
  const v: BandViolation[] = [];
  const preset = ctx.preset ?? "standard";
  if (!(hf.hfFloorBps < hf.hfDeleverageBps && hf.hfDeleverageBps < hf.hfTargetBps)) {
    v.push({ invariant: "hf-ordering", detail: `${hf.hfFloorBps} < ${hf.hfDeleverageBps} < ${hf.hfTargetBps} fails` });
  }
  if (hf.hfFloorBps < 11_000) {
    v.push({ invariant: "hf-floor-minimum", detail: `emergency floor ${hf.hfFloorBps} < 11000` });
  }
  if (hf.hfEmergencyTargetBps < hf.hfTargetBps) {
    v.push({ invariant: "t5-emergency-target", detail: `emergency target ${hf.hfEmergencyTargetBps} below target ${hf.hfTargetBps}` });
  }
  // A1: the band and the dial are one steady state. Tolerance is 100 bps of
  // HF; skipped where the target is capped (an unlevered position has no
  // meaningful liquidation geometry).
  const expectedTarget = hfTargetBpsFor(lt, loopLeverage);
  if (expectedTarget < HF_TARGET_CAP_BPS && Math.abs(hf.hfTargetBps - expectedTarget) > 100) {
    v.push({
      invariant: "hf-target-matches-position",
      detail: `HF target ${hf.hfTargetBps} does not describe L ${loopLeverage} at lt ${lt} (expected ${expectedTarget})`,
    });
  }
  // A3: check the STORED param, not the already-clamped applied value.
  const checkL = typeof ctx.storedLeverage === "number" ? ctx.storedLeverage : loopLeverage;
  const cap = houseMaxLeverage(lt, preset);
  if (checkL > cap + 1e-6) {
    v.push({
      invariant: "leverage-house-cap",
      detail: `L ${checkL} above house max ${cap.toFixed(3)} for lt ${lt} (${preset})`,
    });
  }
  if (margin) {
    const order = [
      margin.maintenanceMargin,
      margin.fastTrim,
      margin.safetyFloor,
      margin.yellowCeiling,
      margin.regrowGate,
      margin.restore,
    ];
    if (!order.every((x, i) => i === 0 || x > order[i - 1])) {
      v.push({ invariant: "margin-ordering", detail: order.join(" < ") + " fails" });
    }
    // A9: the 25 bps quantizer may only ever move MM away from liquidation.
    if (typeof ctx.coinMaxLeverage === "number" && ctx.coinMaxLeverage > 0) {
      const venueMm = 1 / (2 * ctx.coinMaxLeverage);
      if (margin.maintenanceMargin < venueMm - 1e-9) {
        v.push({
          invariant: "mm-away-from-liquidation",
          detail: `MM ${margin.maintenanceMargin} below the venue rule ${venueMm.toFixed(6)} at maxLeverage ${ctx.coinMaxLeverage}`,
        });
      }
    }
    // A12: the short's own margin ratio must sit at or above `restore`, or the
    // hedge opens inside the band the refill machine restores it to.
    if (typeof ctx.hedgeLeverage === "number" && ctx.hedgeLeverage > 0) {
      if (1 / ctx.hedgeLeverage < margin.restore - 1e-9) {
        v.push({
          invariant: "hedge-leverage-margin-band",
          detail: `hedge ${ctx.hedgeLeverage}x opens at margin ${(1 / ctx.hedgeLeverage).toFixed(4)}, inside restore ${margin.restore}`,
        });
      }
    }
    for (const [k, x] of Object.entries(margin)) {
      if (Math.abs(x / BPS_BUCKET - Math.round(x / BPS_BUCKET)) > 1e-6) {
        v.push({ invariant: "bucket-snap", detail: `${k}=${x} off the 25 bps grid` });
      }
    }
  }
  return v;
}
