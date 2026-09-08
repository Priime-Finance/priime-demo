/**
 * THE LEVERAGE BAY (design ruling 2026-08-23) — what the dock shelf says about
 * `Dynamic leverage` on a lane that has pinned a market, in the one grammar
 * the hedge bay already speaks: bay → capsule → readout.
 *
 * ── THE TRAP THIS CLOSES ──────────────────────────────────────────────────
 * On a market whose leverage slope is not positive the shelf offered the
 * module FIRST, labelled `required to launch a loop lane`, UNPRICED. Pressing
 * it seated the landing leverage, the lane dropped (8.1% → 6.9%), and the one
 * sentence that explained the corner vanished the moment the plate appeared.
 * The founder's reading — "adding leverage does not create more APY, seems
 * weird" — was the arithmetic, stated correctly, in the wrong place and with
 * no mechanism beside it.
 *
 * ── WHAT THE BAY NOW CARRIES, AND WHERE EACH PIECE COMES FROM ─────────────
 *
 *   TRIPLE      `−1.2pp modeled · 8.1% → 6.9%`
 *               from = `publishedNetApy` at `PRODUCT_MIN_LEVERAGE` (no debt),
 *               to   = `publishedNetApy` at `landingLeverage`, the SAME number
 *               `addModule` seats when the key is pressed, so the bay promises
 *               exactly what the press delivers. Both ends through
 *               `repriceAtLeverage` on the UNREPRICED scan row — the repriced
 *               candidate carries the lane's current leverage as its ceiling
 *               and would collapse the landing onto 1.00x.
 *
 *   MECHANISM   `Borrows WHYPE at 3.66% to hold kHYPE at 1.97%.`
 *               `economics.borrowApyMarginal` and `collateralYieldApy` through
 *               `pct`, the two rates the sign is made of. This sentence IS the
 *               answer to "why does more leverage give less" — it puts the
 *               borrow rate next to the yield it is borrowed against, in the
 *               place he presses. No risk prose, no adjective.
 *
 * The REGISTER (gray dashed `.cpz-bay--neg` with `Add anyway`, or tan with a
 * blue target) is the sign of the triple, which is `leverageModuleVerdict`'s
 * own verdict: negative where the market ruled the module dominated, positive
 * where leverage buys yield. One derivation decides both, so the colour and
 * the number cannot disagree.
 *
 * PURE, in lib, so the claim "the triple's `to` is what the press seats" is
 * swept over the fixture catalog in a test rather than believed.
 */

import type { ProjectedCandidate } from "./opportunities";
import { publishedNetApy, repriceAtLeverage, type LaneComposition } from "./mock-quote";
import { landingLeverage } from "./leverage-stops";
import { PRODUCT_MIN_LEVERAGE, type RiskPreset } from "./param-schema";
import { isHandAuthored } from "./types";
import { pct } from "./format";

export interface LeverageBayTriple {
  /** Modeled net APY with no borrow leg. */
  from: number;
  /** Modeled net APY at the leverage the press seats. */
  to: number;
  /** That leverage, from the ONE landing derivation. */
  landing: number;
}

/**
 * The two endpoints of the press, or null where nothing can be promised.
 *
 * Null when: no scan row, a hand-authored row (no loop arithmetic), no debt
 * market (`lt === null`, the landing is undefined), or a landing that IS the
 * floor — on those rows the module seats at no debt, contributes nothing, and
 * a triple reading `0.0pp · 4.4% → 4.4%` would be a number about nothing.
 */
export function leverageBayTriple(
  scanRow: ProjectedCandidate | null | undefined,
  hasHedge: boolean,
  comp: LaneComposition | null | undefined,
  preset: RiskPreset,
): LeverageBayTriple | null {
  if (!scanRow?.economics || isHandAuthored(scanRow.economics)) return null;
  const lt = scanRow.lt;
  if (typeof lt !== "number" || !Number.isFinite(lt) || lt <= 0 || lt >= 1) return null;
  const landing = landingLeverage(lt, preset, scanRow.economics.loopLeverage ?? null);
  if (!(landing > PRODUCT_MIN_LEVERAGE + 1e-9)) return null;
  /* THE SAME FRAME THE HEADER PRINTS (S1, 2026-08-24). Both endpoints read
     `publishedNetApy`, the product number, because the lane header this bay
     sits under now reads it too — a bay promising `8.1% → 6.9%` above a
     header that then shows 5.5% would be two spellings of one quantity. The
     REGISTER is unaffected: the fee is monotone and sign-preserving on both
     endpoints, so `sign(to − from)` still equals `sign(cy − bo)`, which is
     what `leverageModuleVerdict` rules on. */
  const from = publishedNetApy(repriceAtLeverage(scanRow, PRODUCT_MIN_LEVERAGE, comp), hasHedge, comp);
  const to = publishedNetApy(repriceAtLeverage(scanRow, landing, comp), hasHedge, comp);
  if (from === null || to === null || !Number.isFinite(from) || !Number.isFinite(to)) return null;
  return { from, to, landing };
}

/**
 * `Borrows WHYPE at 3.66% to hold kHYPE at 1.97%.`
 *
 * Reads the REPRICED candidate happily: neither rate moves under
 * `repriceAtLeverage`, so the lane's own held candidate answers even when the
 * catalog row has gone (the same invariance `verdictRow` rests on). Null
 * before a market is pinned, on a hand-authored row, and on a market with no
 * debt leg — there is nothing borrowed to name.
 */
export function leverageMechanism(cand: ProjectedCandidate | null | undefined): string | null {
  const e = cand?.economics;
  if (!cand || !e || isHandAuthored(e)) return null;
  if (cand.lt === null || !cand.debtSymbol) return null;
  if (!Number.isFinite(e.borrowApyMarginal) || !Number.isFinite(e.collateralYieldApy)) return null;
  /* TWO DECIMALS, like `format.carry()` and for its reason: the live spreads
     run to hundredths of a point (kHYPE 1.9716% against 3.596%), and one
     decimal prints `2.0%` against `3.6%` — true, but not the number the sign
     was taken on. */
  return `Borrows ${cand.debtSymbol} at ${pct(e.borrowApyMarginal, 2)} to hold ${cand.collateralSymbol} at ${pct(e.collateralYieldApy, 2)}.`;
}
