/**
 * THE LEVERAGE STOPS — what replaced the risk dial's adjectives.
 *
 * ══ WHAT WAS DELETED, AND WHY ══════════════════════════════════════════════
 *
 * `risk-dial.ts` shipped three stops named Safer / Balanced / Max, mapped to
 * fractions (0.6 / 0.8 / 1.0) of a privately re-derived house ceiling. Founder
 * ruling 2026-08-22 killed the adjectives; MEASUREMENT killed the second
 * derivation underneath them. Three findings, any one sufficient:
 *
 *  1 · THE STOPS WERE A SECOND OWNER OF THE LEVERAGE DIAL'S OWN BOUNDS.
 *      `deriveLeverageBounds(lt, preset, scanMax)` already returns
 *      {min, default, max} per market. Measured on the live catalog, the Max
 *      stop equalled that `max` on 15 of 15 depositable rows and the Balanced
 *      stop equalled that `default` on 12 of 15 — the other 3 disagreed by
 *      exactly one notch, because the stops took 0.8 of the RAW ceiling while
 *      the dial took 0.8 of the GRID-FLOORED one. One quantity, two files,
 *      disagreeing on 20% of the catalog.
 *
 *  2 · THE ADJECTIVE NAMED A DIFFERENT POSITION ON EVERY MARKET. "Balanced"
 *      was 1.75x to 2.75x across the live rows, a 32.7% cushion on one market
 *      and a 42.9% cushion on another. Ten points of depeg is the entire
 *      distance between "has never happened" and "happened in June 2022".
 *
 *  3 · THE LADDER WAS FLOORED AT 1.5x. `netApy(L)` is affine with slope
 *      `f_b·(cy − bo)`, negative on 13 of 15 depositable rows, so the optimum
 *      is the BOTTOM corner — and since A2 the bottom corner is L = 1, a plain
 *      supply position with no borrow leg, which the preset ladder could not
 *      express at all.
 *
 * ══ WHAT REPLACED THEM ═════════════════════════════════════════════════════
 *
 * The stops are now POSITIONS ON THE LEVERAGE DIAL'S OWN DERIVED BOUNDS, read
 * from the single owner, and each one is LABELLED BY THE ADVERSE PAIR MOVE IT
 * SURVIVES (`liquidation.ts`) rather than by a word. The label therefore moves
 * per market, which is precisely the property an adjective cannot have, and a
 * depositor can check it: they cannot check "Balanced", they can check "33%".
 *
 * The trade is stated beside it, as three absolute modeled APYs on ONE market.
 * Not a per-notch exchange rate: `d(net)/d(distance)` was rejected by the
 * shadow-price panel because one notch is 15.9pp of distance on Morpho against
 * 40.0pp on Dolomite, so the rate is not comparable. Three absolute values on
 * one row are a within-row comparison and none of that applies.
 *
 * A stop whose modeled APY is LOWER than the stop to its left renders exactly
 * that. On 7 of 15 live rows the top stop gives up cushion AND yield, and a
 * control that hid it would be making the adjective's false promise in digits.
 */

/* eslint-disable @typescript-eslint/non-nullable-type-assertion-style --
 * Kit-verbatim file, ported from build.priime.finance eb6d33a. The findings
 * are the typed presets reading kit idioms; not rewriting kit logic to satisfy
 * lint, per the integration's own directive (the RackCanvas.tsx precedent). */

import {
  composedTerms,
  execDragFor,
  publishedNetApy,
  repriceAtLeverage,
  type LaneComposition,
} from "./mock-quote";
import { applyComputeFee } from "./fees";
import { escrowShare, EVEN_FLOOR } from "./hedge-econ";
import { ppMag } from "./format";
import { liquidationDistance, type LiqDistance } from "./liquidation";
import { getDef } from "./modules";
import {
  breakevenLeverage,
  breakevenStop,
  deriveLeverageBounds,
  LEVERAGE_GRID,
  type RiskPreset,
} from "./param-schema";
import { isHandAuthored } from "./types";
import { EXEC_DRAG_UNHEDGED } from "@/lib/model-constants";
import type { ProjectedCandidate } from "./opportunities";

/**
 * The descriptor snap graph-ops applies when a leverage is written via
 * updateParam. Mirrored here so a stored value is compared on the same grid
 * the reducer will put it on.
 *
 * This rounds to NEAREST, which is correct for a value a user dragged.
 * Bound-derived values arrive already floored by `deriveLeverageBounds`, so
 * the snap is an identity on them and cannot push one above its ceiling.
 */
export function snapToLeverageGrid(v: number): number {
  const d = getDef("safety-buffer").params.find((p) => p.field === "targetLeverage");
  const min = typeof d?.min === "number" ? d.min : 1;
  const max = typeof d?.max === "number" ? d.max : 5;
  const step = typeof d?.step === "number" ? d.step : LEVERAGE_GRID;
  const c = Math.min(max, Math.max(min, v));
  return Number(Math.min(max, min + Math.round((c - min) / step) * step).toFixed(6));
}

/**
 * THE BREAKEVEN CEILING, READ OFF THE ROW (R4, 2026-08-24).
 *
 * The ONE place `param-schema`'s `CarryTerms` are lifted from a candidate, so
 * the four terms are read from the same fields `repriceAtLeverage` charges and
 * from nowhere else. Returns the grid stop the dial may go up to, or null when
 * there is no economic ceiling to impose.
 *
 * Three null branches, each of which is a fact rather than a fallback:
 *
 *  · NO ECONOMICS. Nothing to solve. The dial already renders nothing on an
 *    unpinned market.
 *
 *  · A HAND-AUTHORED ROW. `dnLpModel` and `collarModel` are not loop
 *    arithmetic: their number is one figure at one composition, `loopLeverage`
 *    is 1 by construction and `repriceAtLeverage` refuses to move them. There
 *    is no `netCarry(L)` to cross zero.
 *
 *  · NO DEBT LEG. The same read `leverageModuleVerdict` and `notchMove` take
 *    (`lt === null && borrowApyMarginal === 0`): with nothing to borrow, `b`
 *    is structurally zero rather than free, `b > y` is unreachable, and the
 *    formula would be answering a question the market does not pose.
 *
 * `hasHedge` decides the short leg's two terms exactly as `composedTerms`
 * does — the funding credit and the hedged exec drag arrive together with the
 * leg, and a lane that ejected the hedge is priced on the model's unhedged
 * branch (`hedgelessApy`), which charges `EXEC_DRAG_UNHEDGED` and no funding.
 */
export function breakevenStopFor(
  candidate: ProjectedCandidate | null | undefined,
  hasHedge: boolean,
  comp?: LaneComposition | null,
): number | null {
  const e = candidate?.economics;
  if (!candidate || !e || isHandAuthored(e)) return null;
  if (candidate.lt === null && e.borrowApyMarginal === 0) return null;
  const shortLeg = hasHedge && candidate.cls === "A";
  const L = breakevenLeverage({
    collateralYieldApy: e.collateralYieldApy,
    borrowApyMarginal: e.borrowApyMarginal,
    fundingApr: shortLeg ? (e.fundingP25Apr ?? 0) : 0,
    // The one band resolver (QNT-2): the ceiling is solved at the same drag
    // `repriceAtLeverage` charges this lane, never at a re-read of the dial.
    execDragApr: shortLeg ? execDragFor(comp) : EXEC_DRAG_UNHEDGED,
  });
  return L === null ? null : breakevenStop(L);
}

/**
 * The leverages the control offers on this market, ascending, deduplicated.
 *
 * ONE OWNER: every level is a member of `deriveLeverageBounds`, never a
 * fraction computed here. `scanMaxLeverage` is the row's own
 * `economics.loopLeverage` and belongs in the ceiling rather than a footnote
 * (A4): above it the dial moves the stored number while nothing reprices.
 *
 * DEDUPLICATION IS A DISPLAY RULE WITH TEETH. On a market whose ceiling sits
 * at or under the product floor, all three members collapse to one value —
 * and a segmented control with three keys and one outcome is not an
 * instrument. The caller renders a single readout instead, because this
 * returns a single level.
 */
export function leverageStopLevels(
  liqLtv: number,
  preset: RiskPreset,
  scanMaxLeverage?: number | null,
  /** `breakevenStopFor(...)` — the economic ceiling (R4). Optional and
   *  additive: omitted reproduces the bounds that shipped exactly. */
  breakevenStopLeverage?: number | null,
): number[] {
  const b = deriveLeverageBounds(liqLtv, preset, scanMaxLeverage, breakevenStopLeverage);
  const out: number[] = [];
  for (const v of [b.min, b.default, b.max]) {
    const s = snapToLeverageGrid(v);
    if (!out.some((x) => Math.abs(x - s) < 1e-6)) out.push(s);
  }
  return out.sort((a, z) => a - z);
}

/**
 * The leverage a fresh pick lands on: the dial's own default for this market.
 *
 * This is the ONE landing derivation. The catalog card, the copilot's
 * blueprint compile and the lane all call it with the same arguments, so a
 * card can never quote a leverage the lane will not store.
 */
export function landingLeverage(
  liqLtv: number,
  preset: RiskPreset,
  scanMaxLeverage?: number | null,
  /** `breakevenStopFor(...)` — the economic ceiling (R4). A caller holding the
   *  market's economics passes it and lands on a leverage that models above
   *  zero; a caller that does not gets exactly the landing that shipped. */
  breakevenStopLeverage?: number | null,
): number {
  return snapToLeverageGrid(
    deriveLeverageBounds(liqLtv, preset, scanMaxLeverage, breakevenStopLeverage).default,
  );
}

/** One rendered cell: the leverage it applies, the cushion it holds, and the
 *  modeled net APY at that position on THIS lane's composition, in the PRODUCT
 *  frame (`publishedNetApy`, the house's own compute fee inside it) — the same
 *  frame as the lane header the cells sit under. */
export interface LeverageStopView {
  leverage: number;
  /** Null when the market's own threshold is unknown: the cell prints nothing
   *  rather than a number it cannot prove. */
  distance: LiqDistance | null;
  /** Null when the lane is unpriced. The whole trade row is then withheld —
   *  never three cells with one dash, which invites a comparison between a
   *  number and an absence. */
  netApy: number | null;
}

export interface LeverageStopInput {
  liqLtv: number | null;
  preset: RiskPreset;
  scanMaxLeverage?: number | null;
  candidate: ProjectedCandidate | null;
  hasHedge: boolean;
  comp?: LaneComposition | null;
}

/**
 * The control's whole view model, computed in lib so a component never holds
 * the arithmetic. Empty when the market is unpinned: before an `lt` exists
 * there is no ceiling, no cushion and no APY, so the control does not render
 * at all and its slot shows the ghost that names what it waits on.
 */
export function laneLeverageStops(input: LeverageStopInput): LeverageStopView[] {
  const { liqLtv, preset, scanMaxLeverage, candidate, hasHedge, comp } = input;
  if (typeof liqLtv !== "number" || !Number.isFinite(liqLtv) || liqLtv <= 0) return [];
  /* THE ECONOMIC CEILING IS APPLIED HERE AND NOWHERE ELSE (R4, 2026-08-24).
     This is the one entry point that already holds the lane's candidate and
     composition, so the control inherits the ceiling with no call site
     changing: `RackCanvas` threads the same object into `ComposePanel`.
     `deriveLeverageBounds` floors the result at `PRODUCT_MIN_LEVERAGE`, so the
     list never empties and 1.00x is always offered — a market that subtracts
     at every leverage is refused by the review gate, which states the number,
     not by a dial that silently has no cells. */
  const cap = breakevenStopFor(candidate, hasHedge, comp);
  return leverageStopLevels(liqLtv, preset, scanMaxLeverage, cap).map((leverage) => {
    const priced = candidate ? repriceAtLeverage(candidate, leverage, comp) : null;
    // The distance is read off the leverage the MODEL landed on, not the one
    // requested: `repriceAtLeverage` caps at the scan's own L0, and a cushion
    // quoted at a leverage nothing priced is a cushion for a different lane.
    const applied = priced?.economics?.loopLeverage ?? leverage;
    return {
      leverage,
      distance: liquidationDistance(liqLtv, applied),
      /* THE PRODUCT FRAME (C6, 2026-08-24 — the carried S1 residual, closed).
         `ComposePanel` renders one of these per stop directly under a lane
         header that prints `publishedNetApy`, so a venue-frame cell here put
         pre-fee numbers beside a post-fee one on ONE row. S1 moved this line
         alone in a seam pass and reverted on evidence: the stops are one
         member of a FAMILY that shares a frame by invariant — `axes.ts`
         (`laneNetApy`), `dominance.ts` (which reads that axis) and `tips.ts`
         (which subtracts a stop from the lane header). Moving one member
         alone is exactly the defect `one-frame.test.ts` exists to prevent, so
         the four moved together and the invariant was restated to assert the
         PRODUCT frame. See `__tests__/one-frame.test.ts`, section "the family
         shares the product frame".

         Nothing about the CONTROL changes: the fee is a positive scaling on a
         positive lane and identity on a non-positive one, so the ordering of
         the stops, `bestStop`'s argmax and every `netApy <= 0` gate are
         fee-invariant. What changes is that a depositor reading a cell reads
         the number the product would pay them. */
      netApy: priced ? publishedNetApy(priced, hasHedge, comp) : null,
    };
  });
}

/** Index of the stop the stored leverage sits on, or −1 when it sits between
 *  them. There is no "Custom" CELL: with the cushions printed, a reader can
 *  see their own value in the caption sitting between two lit-able numbers,
 *  so the axis explains an off-ladder position without needing a word for it. */
export function matchStopIndex(stops: LeverageStopView[], storedLeverage: number | null): number {
  if (typeof storedLeverage !== "number" || !Number.isFinite(storedLeverage)) return -1;
  const s = snapToLeverageGrid(storedLeverage);
  return stops.findIndex((x) => Math.abs(x.leverage - s) < 1e-6);
}

/** The stop with the highest modeled APY, or null when nothing is priced or
 *  nothing beats the rest. Used by the tip layer, which must quote a target
 *  through the same path the button applies. */
export function bestStop(stops: LeverageStopView[]): LeverageStopView | null {
  let best: LeverageStopView | null = null;
  for (const s of stops) {
    if (s.netApy === null) continue;
    if (best === null || s.netApy > (best.netApy as number)) best = s;
  }
  return best;
}

/**
 * WHAT ONE NOTCH OF THE DIAL IS WORTH ON THIS MARKET.
 *
 * `netCarry(L)` is affine in L with slope `f_b·(cy − bo)`, so one dial step of
 * VENUE yield is `LEVERAGE_GRID · f_b · (cy − bo)` exactly.
 * `escrowShare` is the sole f_b accessor and it reads the lane's OWN repriced
 * candidate, so the figure moves with the hedge dials the way the lane's APY
 * does — and f_b is 1 where the lane holds no short, the same branch
 * `composedTerms` and `laneCapacityUsd` take.
 *
 * ══ IT IS A DELTA BETWEEN TWO CELLS, SO IT WEARS THE CELLS' FRAME ══════════
 *
 * (C6, 2026-08-24.) This line renders inches from the capsule whose three
 * cells a reader can subtract. Those cells are `publishedNetApy` — the
 * PRODUCT number — so a venue-frame notch here is a contradiction the reader
 * can do in their head. MEASURED on the committed fixtures at the shipped
 * dials: kHYPE/WHYPE printed `each 0.25x adds 0.16pp here` while the cells it
 * sits under differ by 0.127pp per notch, and cbETH/WETH `0.10pp` against
 * 0.083pp. At the two decimals this string prints, those are different
 * characters.
 *
 * THE FEE IS CHARGED ON YIELD, so a notch of yield is worth `1 − fee` of
 * itself to the depositor wherever the lane's own yield is positive, and
 * worth the whole of itself where it is not — `computeFeeTerm` is zero on a
 * non-positive lane, at both ends of the step, so nothing is taken out of the
 * difference. The scale is READ OFF `applyComputeFee` rather than restating
 * the rate, so a change to the schedule moves this with it.
 *
 * The scale is applied, not the whole published number recomputed, because
 * both call sites hand this an ALREADY-REPRICED candidate (`ok.candidate`)
 * whose own `loopLeverage` is the lane's position: re-repricing it one grid
 * step up would be capped there and silently return zero (FRAME M, the hazard
 * `laneLeverageStops`' call site is documented against). Reading rates and
 * scaling touches no ceiling. The residual is the compound step, which this
 * closed form never carried and still does not: measured, that leaves 0.127pp
 * against a compounding lane's true 0.134pp, inside the same 2dp.
 *
 * ONE OWNER (2026-08-22). `Lane.tsx` computed this inline while
 * `ComposePanel` printed a CATEGORY sentence for the same fact — "leverage is
 * yield-negative in this market today", which stated the sign of a derivative,
 * said nothing about its size, and used the word `today` that `tips.ts` bans
 * from every string it asserts over. Both surfaces read this now.
 *
 * BOTH DIRECTIONS. A gate on the negative case is what left the two live rows
 * where leverage actually pays with nothing on screen at all.
 *
 * THE `EVEN_FLOOR` GATE: below `hedge-econ`'s ratified floor a pp figure is
 * not a measurement, and the line stands down rather than narrate noise. It
 * is applied to the VENUE step and deliberately not to the printed one —
 * `leverageModuleVerdict` decides a module's EXISTENCE off this function's
 * null branch, and a house fee may not delete a market's control. The ruling
 * and the measurement behind it are at the gate itself.
 */
export interface NotchMove {
  /** True when a turn of leverage subtracts. The caller picks the register:
   *  amber is the narration class and it belongs to a cost, never to a gain. */
  costs: boolean;
  /** `each 0.25x costs 1.42pp here`. Two decimals, like `format.carry()` and
   *  for its reason: the live per-notch moves cluster between 0.13pp and
   *  0.40pp, and one decimal rounds four distinct markets onto three
   *  characters. */
  text: string;
}

export function notchMove(
  candidate: ProjectedCandidate | null | undefined,
  /**
   * Whether the LANE runs the short leg. Not defaulted: the escrow only exists
   * where the short does. This took `escrowShare(candidate, comp).fb` regardless,
   * so on a hedgeless lane it priced the notch at the hedged 0.6742 — "each
   * 0.25x costs 0.32pp" beside a reclaim that correctly said "1.7pp less" for
   * four notches at f_b = 1 (4 × 0.32 = 1.28, not 1.7). With no short there is
   * no margin and no reserve; every deposited dollar reaches the loop, and the
   * slope is `(cy − bo)` whole.
   */
  hasHedge: boolean,
  comp?: LaneComposition | null,
): NotchMove | null {
  const e = candidate?.economics;
  const fb = hasHedge ? escrowShare(candidate, comp)?.fb : 1;
  if (!e || typeof fb !== "number") return null;
  /* NO DEBT LEG MEANS NO DIAL TO PRICE (cleanup 2026-08-24). On a row with no
     debt market `bo` is structurally 0 — nothing to borrow, not free borrowing
     — so the slope degenerates into "does the spot leg pay anything" and this
     printed "each 0.25x adds 0.33pp here" on a committed funding lane, a
     promise `repriceAtLeverage` refuses to deliver (its guard returns a
     `loopLeverage <= 1` row untouched). `leverageModuleVerdict` already rules
     the module ABSENT on exactly this read (leverage-module.ts:118); the two
     render sites (Lane.tsx, ComposePanel.tsx) call THIS function directly, so
     the guard lives here — one owner, both surfaces go quiet in every funding
     lane state. Same read, same order: `lt === null` (borrowsNothing), not
     `debtSymbol === ""`, and the `bo === 0` half keeps a real lending market
     with a momentarily zero marginal rate on the slope test. */
  if (candidate?.lt === null && e.borrowApyMarginal === 0) return null;
  const venueStep = LEVERAGE_GRID * fb * (e.collateralYieldApy - e.borrowApyMarginal);
  /* ⚠ THE GATE IS ON THE VENUE STEP, AND THAT IS A RULING (C6, 2026-08-24).
     `leverageModuleVerdict` (leverage-module.ts:119) decides whether the
     `safety-buffer` module EXISTS on a market from this function returning
     null. That decision must answer "does borrowing pay on this market",
     which is a fact about Aave and Morpho — it must NOT move when Priime
     changes its own fee schedule. Gating on the after-fee step would let the
     house's take delete a market's leverage module: raise the fee and more
     markets lose the control. MEASURED when the gate was briefly on the
     after-fee step: `morpho-blue-ethereum wstETH/WETH` flipped from
     `installs` to `absent`, taking one bay off the shelf and one row out of
     `installDefaults`, for no reason a depositor could point at.

     So the NULL BRANCH is byte-identical to what shipped, and only the number
     in the string moves. The narrow band this opens — a venue step in
     [0.050pp, 0.063pp), where the after-fee step is under `EVEN_FLOOR` while
     the venue step is over it — prints a true figure at two decimals rather
     than standing the line down. A small measurement is not noise; a wrong
     one is. */
  if (!Number.isFinite(venueStep) || Math.abs(venueStep) < EVEN_FLOOR) return null;
  /* THE PRINTED FIGURE IS THE PRODUCT FRAME. `core` is the lane's own
     pre-compound venue yield — `composedTerms` READS the candidate it is
     handed and never reprices it, so this is safe on the repriced candidate
     both call sites pass. Positive core: the depositor keeps
     `applyComputeFee(core)/core` of every notch. Non-positive core: the fee is
     zero at both ends of the step and the notch reaches them whole. */
  const core = composedTerms(candidate, hasHedge, comp)?.core ?? null;
  const keep = core !== null && core > 0 ? applyComputeFee(core) / core : 1;
  const d = venueStep * keep;
  if (!Number.isFinite(d)) return null;
  return {
    costs: d < 0,
    text: `each ${LEVERAGE_GRID}x ${d < 0 ? "costs" : "adds"} ${ppMag(d, 2)} here`,
  };
}
