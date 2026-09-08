/**
 * THE ADVERSE PAIR MOVE — the one owner of the product's objective risk
 * quantity, and the one place it is spelled.
 *
 * ══ WHY THIS FILE EXISTS ═══════════════════════════════════════════════════
 *
 * Founder ruling, re-asserted 2026-08-22: risk is stated in MEASURABLE terms.
 * A subjective grade ("Standard", "Balanced", "Low") is banned, because it
 * means something different to every reader AND, on this product, something
 * different on every market. The vault page was cleaned of "Risk profile:
 * Standard" and the publish record stopped writing it; the CONTROLS were
 * missed, and a control offering adjectives is the same defect one level up.
 *
 * The measurable quantity is already shipped and already exact:
 *
 *     HF        = lt · L / (L − 1)        (param-schema.hfTargetBpsFor)
 *     distance  = 1 − 1/HF                (param-schema.distanceToLiquidation)
 *
 * so for any market and any leverage the adverse move IN THE COLLATERAL-VS-
 * DEBT PAIR that liquidates the loop is computable from the venue's own
 * liquidation threshold. Nothing is invented, nothing is estimated, and there
 * is no distribution assumption anywhere in it.
 *
 * ══ WHY IT IS A PAIR MOVE, NEVER A DRAWDOWN ════════════════════════════════
 *
 * Every depositable row in the live catalog is a same-family pair: an LST or
 * LRT against its base, or a yield-stable against a stable. The liquidating
 * variable is a BASIS or DEPEG move between the two assets, not a price move,
 * and the perp short hedges the deposit's USD delta while doing nothing to the
 * collateral/debt ratio — so this number is unchanged by installing or
 * ejecting the hedge. "Survives a 33% drawdown" would be false; "liquidates if
 * the collateral loses 33% against the debt asset" is what the arithmetic says.
 *
 * NAV drawdown is NOT offered here. It is exactly `L × (pair move)`, which at
 * liquidation is 58% to 96% across every live row and every stop — a wipeout
 * constant and a caveat wall — and there is no exact UNCONDITIONAL drawdown
 * without a depeg distribution the scan payload does not carry.
 *
 * ══ WHY THE STRINGS LIVE HERE TOO ══════════════════════════════════════════
 *
 * Before this file, `store.ts` and `AutomationsSection.tsx` each welded their
 * own `(d * 100).toFixed(0) + "% adverse pair move"`. Both were correct. That
 * is the dangerous shape, not a safe one (see single-owner.test.ts): a second
 * caller is one line away from choosing a different rounding, a different
 * glyph or a different noun. Callers get a STRING with the unit already on it
 * and never hold the raw fraction unless they are drawing geometry.
 */

/* eslint-disable @typescript-eslint/non-nullable-type-assertion-style, @typescript-eslint/prefer-optional-chain --
 * Kit-verbatim file, ported from build.priime.finance eb6d33a. The findings
 * are the typed presets reading kit idioms; not rewriting kit logic to satisfy
 * lint, per the integration's own directive (the RackCanvas.tsx precedent). */

import { pct } from "./format";
import {
  BAND_OFFSETS,
  BPS_BUCKET,
  deriveHlMarginBands,
  distanceToLiquidation,
  hfTargetBpsFor,
  presetSpread,
  PRODUCT_MIN_LEVERAGE,
  type RiskPreset,
} from "./param-schema";

/**
 * The distance, as a three-state answer rather than a number with a magic
 * value in it.
 *
 * `null` (the whole result) means UNKNOWN: the market's own liquidation
 * threshold is not in hand, so nothing may be printed. `unlevered` means there
 * is no borrow leg at all — since A2 made `PRODUCT_MIN_LEVERAGE = 1` a
 * reachable dial position, that is a real, common and SAFE state, not a
 * degenerate input. It is answered in words, never as "99%".
 */
export interface LiqDistance {
  /** 1 − 1/HF at the applied leverage, in (0,1). Null iff `unlevered`. */
  d: number | null;
  /** L ≤ 1: nothing is borrowed, so no liquidation price exists. */
  unlevered: boolean;
}

const finite = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

/**
 * THE ONE DERIVATION. Every surface that states a distance to liquidation —
 * canvas dock, lane header, plate, vault page, automations instrument —
 * reaches the number through this function and no other.
 *
 * `liqLtv` is the venue's own reported liquidation threshold (the catalog
 * row's `lt`, or the published record's `liqLtv`). `appliedLeverage` is the
 * leverage the MODEL used — `economics.loopLeverage`, never the dial's
 * request, which `repriceAtLeverage` may have capped at the scan's own L0.
 */
export function liquidationDistance(
  liqLtv: number | null | undefined,
  appliedLeverage: number | null | undefined,
): LiqDistance | null {
  if (!finite(liqLtv) || !(liqLtv > 0) || !(liqLtv < 1)) return null;
  if (!finite(appliedLeverage) || !(appliedLeverage > 0)) return null;
  if (appliedLeverage <= PRODUCT_MIN_LEVERAGE) return { d: null, unlevered: true };
  return liquidationDistanceAtHf(hfTargetBpsFor(liqLtv, appliedLeverage));
}

/**
 * THE SAME QUANTITY, ENTERED FROM A LIVE HEALTH FACTOR.
 *
 * The canvas and the vault page hold a market threshold and a leverage, so
 * they enter above. A RUNNING position holds neither: the dashboard reads
 * `hfBps` straight off the chain, and the loop it describes has been drifting
 * since the day it was published. Without this entry the dashboard had two
 * choices — re-derive `1 − 10000/hf` inline, or say nothing measurable — and
 * it took the second one, which is how "How safe your position is. Higher =
 * safer." survived the ratified cleanup on the one surface a depositor checks
 * most often.
 *
 * This is an ENTRY POINT, not a second derivation: `liquidationDistance`
 * delegates here, so the product contains exactly one expression for the
 * adverse pair move and both callers are provably reading it.
 *
 * `Infinity` is the honest reading of an unlevered on-chain HF (no debt, so
 * the ratio has no denominator), and it is answered in words like every other
 * unlevered position rather than as a 100% cushion.
 */
export function liquidationDistanceAtHf(
  hfBps: number | null | undefined,
): LiqDistance | null {
  if (typeof hfBps !== "number" || Number.isNaN(hfBps)) return null;
  if (hfBps === Number.POSITIVE_INFINITY) return { d: null, unlevered: true };
  if (!Number.isFinite(hfBps) || hfBps <= 0) return null;
  const d = distanceToLiquidation(hfBps);
  // HF at or below 1 is a position already past its own liquidation line. On
  // the canvas the house clamps make it unreachable; on a LIVE position it is
  // reachable in principle, and it prints nothing rather than a distance of
  // zero, which reads as a measurement of a cushion that is not there.
  if (!Number.isFinite(d) || d <= 0) return null;
  return { d: Math.min(1, d), unlevered: false };
}

/** `33%` / `no debt` — the bare value, for a control cell or a value slot. */
export function adverseMoveValue(x: LiqDistance | null): string | null {
  if (!x) return null;
  return x.unlevered ? "no debt" : pct(x.d, 0);
}

/** `33% adverse pair move` / `no borrow leg to liquidate` — the full line.
 *  Character-identical to the string the vault page has printed since the
 *  ratified cleanup, which is why that page reads this function now. */
export function adverseMoveLine(x: LiqDistance | null): string | null {
  if (!x) return null;
  return x.unlevered ? "no borrow leg to liquidate" : `${pct(x.d, 0)} adverse pair move`;
}

/** `33% adverse move` / `no borrow leg` — the narrow form, for a lane header
 *  or an inventory row where the word `pair` does not fit the budget. */
export function adverseMoveShort(x: LiqDistance | null): string | null {
  if (!x) return null;
  return x.unlevered ? "no borrow leg" : `${pct(x.d, 0)} adverse move`;
}

/**
 * How far the pair may drift before the automation TRIMS, in points of the
 * distance above.
 *
 * This is what the `riskPreset` segmented control actually sets, and it is the
 * only measurable thing it sets: `deriveHfBands` puts the trim trigger at
 * `target − presetSpread(preset)`, so the preset buys drift, not safety. It is
 * printed in place of the old `Wider / Std / Tighter` labels, which described
 * the gap and INVERTED the safety reading — the leftmost preset acts SOONEST,
 * and a reader inferred the opposite from the word.
 *
 * Both terms come from `distanceToLiquidation`, so this is a difference of two
 * values of the owner above and not a second derivation of anything.
 */
export function driftBeforeTrim(
  preset: RiskPreset,
  appliedLeverage: number | null | undefined,
  liqLtv: number | null | undefined,
): number | null {
  const at = liquidationDistance(liqLtv, appliedLeverage);
  if (!at || at.d === null) return null;
  const targetBps = hfTargetBpsFor(liqLtv as number, appliedLeverage as number);
  const trimBps = targetBps - Math.round(presetSpread(preset) * 10_000);
  // A trim trigger at or under HF 1.00 is not a trigger, it is a liquidation.
  if (!(trimBps > 10_000)) return null;
  const drift = at.d - distanceToLiquidation(trimBps);
  return drift > 0 ? drift : null;
}

// ══ THE SECOND LEG ═════════════════════════════════════════════════════════
//
// Everything above this line describes the LENDING leg: the collateral-vs-debt
// pair move that liquidates a borrow. That was the whole of this file while
// the product's default composition carried a borrow.
//
// It no longer does. The default machine on 11 of 15 live rows is
// `source + hedge + compound` at L = 1 — no borrow, no health factor, no
// lending liquidation line — AND A HYPERLIQUID SHORT AT `hedgeLeverage`. A
// perp short is a liquidatable position. A surface that printed "no
// liquidation" on that composition, from the half of this file above, would be
// making a false claim in the loudest place on the page, on the composition we
// recommend most often.
//
// So the second leg gets its arithmetic here, beside the first, for the reason
// the first one is here: two surfaces had each welded their own copy of the
// lending distance and both were correct, which is the dangerous shape rather
// than a safe one. There is no reason to let that happen twice.
//
// ══ THE DERIVATION ═════════════════════════════════════════════════════════
//
// The Hyperliquid account is UNIFIED: the spot hold IS the perp `marginUsed`.
// So per dollar of short notional the account opens holding
//
//     m0 = 1/L_h + r                      (margin + the idle reserve beside it)
//
// and the venue closes the position when the account's margin ratio decays to
// its maintenance margin. `deriveHlMarginBands` owns that ladder — MM is
// `1/(2·coinMaxLeverage)` snapped UP to the 25 bps grid (never toward
// liquidation), and the W11 defender floor is MM + 3pp. Both are read from
// there; neither is respelled.
//
// A short loses on an UP move. After an adverse coin move `x` the notional is
// `(1 + x)` and the equity is `(m0 − x)`, so the account's margin ratio is
// `(m0 − x)/(1 + x)`, and setting that equal to a band gives
//
//     x(band) = (m0 − band) / (1 + band)
//
// evaluated at MM for the venue's own line and at MM + 3pp for the band the
// defender trims on. At the shipped `(L_h 3, r 0.15)` on a coin the venue
// runs at 25x: m0 = 0.48333, MM = 2.00%, trim at +41.3%, liquidation at
// +45.4%, a reaction window of 4.1 points of coin move.
//
// ══ WHY IT USUALLY PRINTS `not measured`, AND RENDERS ANYWAY ═══════════════
//
// `coinMaxLeverage` does not cross the projection. `compile.ts` holds it (it
// already calls `deriveHlMarginBands(coin.maxLeverage)`); `ProjectedCandidate`
// drops it, so the canvas cannot compute MM and both moves come back null.
//
// The row still renders, as `not measured`. Deleting it would let a reader
// infer that the short has no liquidation line, which is the exact opposite of
// true — AN HONEST ABSENCE OUTRANKS A SILENT ONE. When the scan starts
// emitting the field, one argument arrives and the same row starts printing a
// number. Nothing else changes.

/** The blind evidence tier's value string. A mode that applies here and whose
 *  number does not exist prints this and NO number anywhere beside it. */
export const NOT_MEASURED = "not measured";

/**
 * The short leg's own bands, as adverse COIN moves.
 *
 * `marginRatio` (1/L_h) and `openMargin` (m0) always exist — they are set by
 * the two hedge dials and nothing else. `maintenanceMargin`, `liqMove` and
 * `trimMove` exist only where `coinMaxLeverage` is in hand.
 *
 * ⚠ `marginRatio` IS NOT THE ESCROW. 1/L_h is the short's margin as a
 * fraction of ITS OWN NOTIONAL (33.3% at L_h 3); the escrow `1 − f_b` is
 * margin AND reserve as a fraction of THE DEPOSIT (32.58% at the shipped
 * pair). At the shipped composition both round to `33%` and they are
 * different quantities in different frames. Whoever prints one names its
 * frame in the same breath — see `liquidation-lines.ts`, which is the only
 * caller that prints both.
 */
export interface ShortLegBands {
  /** 1/L_h — margin as a fraction of the short's own notional. */
  marginRatio: number;
  /** m0 = 1/L_h + r — what the unified account opens holding, per unit of
   *  short notional. */
  openMargin: number;
  /** MM, snapped up to the venue grid. Null without `coinMaxLeverage`. */
  maintenanceMargin: number | null;
  /** x_liq: the adverse coin move at which the venue closes the short. */
  liqMove: number | null;
  /** x_trim: the adverse coin move at which the defender trims it first. */
  trimMove: number | null;
}

/**
 * THE ONE DERIVATION for the short leg. Every surface that states what the
 * perp short holds, or what closes it, reaches the numbers through here.
 *
 * `coinMaxLeverage` is optional on purpose: absent is the shipped canvas and
 * present is `compile.ts`. Both are legal inputs and neither is an error.
 */
export function shortLegBands(
  hedgeLeverage: number | null | undefined,
  reserveFraction: number | null | undefined,
  coinMaxLeverage?: number | null,
): ShortLegBands | null {
  if (!finite(hedgeLeverage) || !(hedgeLeverage > 0)) return null;
  if (!finite(reserveFraction) || reserveFraction < 0) return null;
  const marginRatio = 1 / hedgeLeverage;
  const openMargin = marginRatio + reserveFraction;
  const blind: ShortLegBands = {
    marginRatio,
    openMargin,
    maintenanceMargin: null,
    liqMove: null,
    trimMove: null,
  };
  if (!finite(coinMaxLeverage) || !(coinMaxLeverage > 0)) return blind;

  const bands = deriveHlMarginBands(coinMaxLeverage);
  // A move is only a distance while it is positive. A short opened at or under
  // a band is already inside it, and printing a negative "distance" would be a
  // measurement of a cushion that is not there — the same rule
  // `liquidationDistanceAtHf` applies to an HF at or below 1.
  const moveTo = (band: number): number | null => {
    const x = (openMargin - band) / (1 + band);
    return Number.isFinite(x) && x > 0 ? x : null;
  };
  return {
    ...blind,
    maintenanceMargin: bands.maintenanceMargin,
    liqMove: moveTo(bands.maintenanceMargin),
    // MM + 3pp: the W11 defender floor, read from the ladder rather than
    // respelled as `mm + 0.03` — the offsets have one owner.
    trimMove: moveTo(bands.safetyFloor),
  };
}

/**
 * THE COIN'S MAINTENANCE MARGIN, RECOVERED FROM THE LADDER THE RECORD ALREADY
 * PUBLISHES (2026-09-02).
 *
 * ── THE ABSENCE THAT WAS NOT AN ABSENCE ───────────────────────────────────
 * `Short's own liquidation · not measured` shipped on every hedged vault,
 * because `ProjectedCandidate` drops `hl.coins[coin].maxLeverage` and MM is a
 * function of it. But MM is ALSO a function of two fields the record does
 * publish: `deriveHlMarginBands` puts every edge at MM plus a FIXED ADDITIVE
 * offset, so `restore − 0.18` and `fastTrim − 0.015` are each MM exactly. The
 * field was never missing. It was unpublished, and its consequences were.
 *
 * ── WHY BOTH EDGES, AND WHY DISAGREEMENT IS A REFUSAL AND NOT AN AVERAGE ──
 * The two writers of `marginTrimPct` do not agree on WHICH edge they write:
 * `seeds.ts` writes `fastTrim` (MM + 1.5pp) and `pricing-params.ts` writes
 * `safetyFloor` (MM + 3pp). A single-edge inversion would therefore be right
 * on one path and 1.5pp wrong on the other, silently, in a number a depositor
 * sizes against. Asking BOTH edges to pin the same MM turns that ambiguity
 * into a self-check: where they agree the recovery is proven by two
 * independent fields; where they do not, the record genuinely cannot say and
 * the caller prints `not measured` exactly as before. Measured over the eight
 * published records: four agree (2.00%, 5.00%, 2.00%, 5.00%) and two disagree
 * (11.50% against 10.00%) — and those two are the records whose 13/28 edges
 * came from the backfill rather than from a coin's own ladder.
 *
 * Returns a COIN MAX LEVERAGE rather than the margin itself, so the caller
 * hands it to `shortLegBands` and the whole derivation keeps ONE owner. The
 * round trip is exact: `snapUp25(1 / (2 · (1 / (2·mm))))` is `mm` for any mm
 * already on the 25 bps grid, which every published edge is by construction.
 */
export function coinMaxLeverageFromMarginRule(
  trimBelowPct: number | null | undefined,
  restorePct: number | null | undefined,
): number | null {
  if (!finite(trimBelowPct) || !finite(restorePct)) return null;
  const mmFromRestore = restorePct / 100 - BAND_OFFSETS.restore;
  const mmFromFastTrim = trimBelowPct / 100 - BAND_OFFSETS.fastTrim;
  // Float dust only: both terms are grid multiples, so a real disagreement is
  // a whole bucket wide and a tolerance far under one bucket cannot hide it.
  if (Math.abs(mmFromRestore - mmFromFastTrim) > BPS_BUCKET / 100) return null;
  if (!(mmFromRestore > 0) || !(mmFromRestore < 1)) return null;
  return 1 / (2 * mmFromRestore);
}

/**
 * `33.3%` — the short's margin as a fraction of its own notional. The label
 * beside it must carry the word `notional` or the word `ratio`.
 *
 * ONE DECIMAL, AND THE DECIMAL IS THE POINT. Two things force it, and both are
 * about a reader meeting two numbers one section apart:
 *
 *  · the register reads this same quantity through `axes.shortMargin`, which
 *    prints `pct(v, 1)`, and renders it directly beneath the verdict. Two
 *    precisions of one number, adjacent, is the reader's problem and not the
 *    formatter's.
 *  · at the shipped composition the deposit-denominated escrow (`1 − f_b` =
 *    32.58%) and this ratio (1/3 = 33.3%) BOTH rounded to `33%` at 0 dp. They
 *    answer different questions and they move differently. The day they stop
 *    rounding together is the day a reader who learned them as one number is
 *    wrong, so they stop rounding together now.
 */
export function shortMarginValue(b: ShortLegBands | null): string | null {
  if (!b) return null;
  return pct(b.marginRatio, 1);
}

/** `+45% coin move`, or `not measured`. The `+` is the DIRECTION a short is
 *  hurt in, not a sign on a magnitude: this leg is closed by an up move. */
export function coinMoveValue(x: number | null | undefined): string {
  if (!finite(x) || x <= 0) return NOT_MEASURED;
  return `${coinMoveMagnitude(x) ?? NOT_MEASURED} coin move`;
}

/**
 * THE SAME QUANTITY WITH THE NOUN REMOVED — `+45%`, or null.
 *
 * Not a second spelling: it is the FIRST HALF of the string above, exported so
 * a surface that already carries the noun in a column of its own does not
 * print it twice. `coinMoveValue` is now built from this, so the digits can
 * never drift between the two forms.
 *
 * The structured risk table is the caller: its reading cell holds ONE quantity
 * and its denominator cell holds `adverse HYPE move`, so `+45% coin move`
 * beside `adverse HYPE move` would say `move` twice and put a noun in the
 * number column — the exact mixing this table exists to end.
 */
export function coinMoveMagnitude(x: number | null | undefined): string | null {
  if (!finite(x) || x <= 0) return null;
  return `+${pct(x, 0)}`;
}
