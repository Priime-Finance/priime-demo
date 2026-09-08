/**
 * THE COPILOT'S ONE CROSSING FROM A ROW TO A NUMBER (2026-08-24, spec §4.1).
 *
 * Everything else in `lib/canvas/copilot/**` reads this module and computes no
 * APY, no capacity and no verdict of its own. That is the whole point of the
 * file: before it, the copilot held three different numbers for one lane —
 * `headlineAprPct` (the scan's own screening APR at the scan's own leverage),
 * `economics.capacityUsd` (the scan's 0.75 escrow frame) and a compile
 * response restated by a private mapper — and none of the three was the number
 * the canvas prints after APPLY.
 *
 * ── THE TWO FRAMES, WELDED TO THEIR SURFACES ─────────────────────────────
 *
 *   marketApy = composedTerms(priced, hedge, comp, placed).core       MARKET
 *   computeFee = ….fee                       = computeFeeTerm(core)
 *   vaultApy  = ….published                  = afterFee + compoundDelta(…)  PRODUCT
 *
 * MARKET answers "what does this venue pay": it is what a Browse-markets row
 * prints, and it may only ever be stated under a label that names the market.
 * PRODUCT answers "what does this vault pay": the house compute fee is already
 * inside it, and it is what the lane header, the review sheet, the directory
 * card and the published record all print.
 *
 * BOTH are evaluated at `seatedLeverage(row)` — the leverage the rack will
 * actually seat — and at the composition actually placed. Never at
 * `economics.loopLeverage`, which is the scan's ceiling, and never at
 * `headlineApr`, which is the scan's screening number at that ceiling. On
 * `dolomite-berachain:ibera-wbera` those two disagree in SIGN, so a fee
 * subtraction could never have repaired the old field.
 *
 * ⚠ `placed` IS LOAD-BEARING. `composedHere` (mock-quote) refuses to price a
 * hand-authored row whose lane does not hold the modules the row's single
 * figure was computed with. Passing it is what stops a half-built collar
 * printing the both-legs number. Never call `composedTerms` from the copilot
 * path without it.
 */

/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion --
 * Kit-verbatim file, ported from build.priime.finance eb6d33a. The findings
 * are the typed presets reading kit idioms; not rewriting kit logic to satisfy
 * lint, per the integration's own directive (the RackCanvas.tsx precedent). */

import type { LoopGraph, ModuleKey } from "@/lib/canvas/types";
import type { ProjectedCandidate } from "@/lib/canvas/opportunities";
import type { StrategyKind } from "@/lib/vaults/store";
import {
  composedTerms,
  repriceAtLeverage,
  type LaneComposition,
} from "@/lib/canvas/mock-quote";
import { capacityBindingLabel, capacityReason, laneCapacityUsd } from "@/lib/canvas/capacity";
import {
  discoverAbsence,
  seatedLeverage,
  unmeasuredReason,
  type AbsenceRow,
  type UnifiedRow,
} from "@/lib/canvas/unified-list";
import { leverageModuleInstalls } from "@/lib/canvas/leverage-module";
import { breakevenStopFor } from "@/lib/canvas/leverage-stops";
import { railVerdictFor } from "@/lib/canvas/funding-launch";
import { fundingRateLine } from "@/lib/canvas/funding-card";
import {
  collarForfeit,
  collarForfeitLine,
  COLLAR_DEFAULT_DIALS,
  familiesForCandidate,
  fundingClassCandidateId,
  laneCollarForfeit,
} from "@/lib/canvas/templates";
import { LAUNCHABLE_VENUES } from "@/lib/canvas/opportunities";
import { descriptorsFor, defaultValueFor } from "@/lib/canvas/modules";
import { lev, pct } from "@/lib/canvas/format";
import { PRODUCT_MIN_LEVERAGE } from "@/lib/canvas/param-schema";

/**
 * The ONE strategy a market can be built on, derived from the row and never
 * taken from the model.
 *
 * The family fact comes first because it is the harder constraint: an LP, a
 * collar or a treasury row carries a hand-authored figure priced at exactly one
 * composition, and no other strategy can reach it. Funding is a STRATEGY INSIDE
 * the loop family (it is a loop lane with no leverage segment), so it is
 * discriminated by the funding scanner's own id prefix, which no other scanner
 * emits.
 *
 * ⚠ `treasury` IS READ FROM THE ROW'S OWN `economics.terms.family`, THROUGH
 * `familiesForCandidate`, AND NEVER FROM A VENUE NAME. The six issuer rows sit
 * on six distinct `treasury-*` venues, so a venue test here would be six tests
 * that all have to be remembered, and the seventh issuer would silently build
 * as a levered loop. That is the E1 anti-pattern this function was written to
 * delete, and adding a fifth strategy is exactly when it would come back.
 *
 * The three non-loop families are listed rather than written as `family !==
 * "loop"`, which would be the derived form and is tempting. `MODEL_FAMILY_TO_LANE`
 * is a `Record` keyed off the model's own family union, and a row whose family
 * has no row in it reads back `undefined`; the negative test would then return
 * `undefined` as a `StrategyKind` and every reader downstream would branch on a
 * strategy that does not exist. The positive list refuses that row into `loop`,
 * which is wrong but is a value, and the coverage suite says so out loud.
 */
export function strategyForRow(row: ProjectedCandidate): StrategyKind {
  const family = familiesForCandidate(row)[0];
  if (family === "dnlp" || family === "collar" || family === "treasury") return family;
  if (fundingClassCandidateId(row.id)) return "funding";
  return "loop";
}

/**
 * The module keys a lane of this strategy seats, in chain order.
 *
 * It MIRRORS `FAMILY_CHAINS` / `FAMILY_REQUIRED_GROUPS` and nothing else in
 * the copilot subsystem may spell a chain: `buildPortfolioFromProposal` seats
 * from here, `laneEconomicsFor` prices with it, and the two therefore cannot
 * describe two different machines.
 *
 * The loop chain is the only one with an optional anchor, because the leverage
 * module is withheld on a market whose slope is not positive — and a loop lane
 * holding the source and a hedge at leverage 1 is a complete, publishable
 * lane, which is exactly the funding shape one row up.
 *
 * The treasury chain is `{liquidity-source, redemption-route}` plus the
 * optional compounder: three steps, not four, because there is no rank-1
 * leverage step on a lane whose whole claim is that it is unlevered, and no
 * perp leg on a lane whose exposure is the issuer's own instrument.
 * `FAMILY_CHAINS.treasury` and `FAMILY_REQUIRED_GROUPS.treasury` are what this
 * mirrors, and the coverage suite reads both back off the seated graph.
 */
export function seatedModulesFor(
  strategy: StrategyKind,
  sel: { leverageModule: boolean; hedge: boolean; compound: boolean },
): ModuleKey[] {
  const out: ModuleKey[] = ["liquidity-source"];
  /* ⚠ EXHAUSTIVE, AND THE `never` IS THE POINT. This was an if/else whose
     final `else` was the COLLAR chain, so a strategy added to the union without
     a branch here did not fail to compile and did not throw: it silently seated
     a covered call and a protective put on a market that has neither, and the
     card beside it priced that composition. The default clause turns the next
     addition into a compile error in this file, which is where the chain is
     spelled. */
  switch (strategy) {
    case "loop":
      if (sel.leverageModule) out.push("safety-buffer");
      if (sel.hedge) out.push("hedge");
      break;
    case "funding":
      out.push("hedge");
      break;
    case "dnlp":
      out.push("auto-center", "hedge");
      break;
    case "collar":
      out.push("covered-call", "protective-put");
      break;
    case "treasury":
      out.push("redemption-route");
      break;
    default: {
      const unhandled: never = strategy;
      throw new Error(`no module chain for strategy ${String(unhandled)}`);
    }
  }
  if (sel.compound) out.push("auto-compound");
  return out;
}

/**
 * THE COMPOSITION A LANE OF THIS SELECTION ACTUALLY SEATS (S2, 2026-08-24).
 *
 * ⚠ THIS IS THE FIELD THAT MADE THE COPILOT PRINT TWO NUMBERS FOR ONE LANE.
 *
 * `laneEconomicsFor` used to default to `CATALOG_COMPOSITION` — `{ hedge: null,
 * compound: null }` — which is the BROWSE-MARKETS composition, a market card
 * with nothing installed on it. The blueprint card, on the other hand, was
 * priced at `proposalLoopComposition({hedge, compound})`, which seats
 * auto-compound. `compoundDelta` is the whole difference, and it is not small:
 * measured on the committed fixture catalog,
 *
 *     kHYPE funding carry     context 6.1569%   card 6.3103%
 *     treasury collar         context 9.4608%   card 9.8602%
 *     delta-neutral LP        context 3.0940%   card 3.1225%
 *
 * (readings as measured 2026-08-24 at the then-shipped models; the models
 * have since moved — QNT-2 re-based the funding drag, the 2026-09-01
 * pool-depth fix moved the dn-lp pair — and the walk-fixes NON-VACUITY test
 * pins the current pairs)
 *
 * and those are the exact pairs the 2026-08-24 acceptance walk caught in the
 * wild ("6.18 pct in the prose, 6.3% on the card"). The model was not inventing a
 * number; it was quoting the number it was given, and the card beside it was
 * priced at a composition the context never described. One message, two net
 * APYs, one lane.
 *
 * The hedge half is INERT and that is worth stating, because it explains why
 * only the compound term ever moved: `hedgeDialsFor(null)` already returns the
 * descriptor's own defaults, so a null hedge and an explicitly-seated hedge
 * price at the same `f_b`. Only `comp.compound` distinguishes the two
 * compositions, and `CATALOG_COMPOSITION` leaves it null.
 *
 * So the composition is DERIVED FROM THE SELECTION rather than passed in, and
 * `laneEconomicsFor` has no catalog-frame default left for a caller to reach
 * by accident. `apply.ts` re-exports this under its shipped name
 * (`proposalLoopComposition`) so the compile body and the replay keep one owner
 * for their dials.
 *
 * ⚠ NO PARAM CONTEXT, DELIBERATELY — see the note above
 * `proposalLoopComposition` in `apply.ts`. `addModule` seats the STRUCTURAL
 * default, so that is the value the applied lane actually runs.
 */
export function seatedComposition(sel: { hedge: boolean; compound: boolean }): LaneComposition {
  return {
    hedge: sel.hedge
      ? {
          hedgeLeverage: numDefault("hedge", "hedgeLeverage"),
          reserveFraction: numDefault("hedge", "reserveFraction"),
        }
      : null,
    compound: sel.compound
      ? { cadence: cadenceDefault(), minActionUsd: numDefault("auto-compound", "minActionUsd") }
      : null,
  };
}

/** The descriptor's own numeric default, structural, exactly as `addModule`
 *  seats it. Absent means a descriptor was deleted, which is a build defect
 *  and not something to paper over with a literal. */
function numDefault(key: ModuleKey, field: string): number {
  const d = defaultValueFor(key, field);
  if (typeof d !== "number" || !Number.isFinite(d)) {
    throw new Error(`no numeric default for ${key}.${field}`);
  }
  return d;
}

/** The compound cadence default, narrowed to the wire union. */
function cadenceDefault(): "6h" | "24h" | "72h" {
  const d = defaultValueFor("auto-compound", "cadence");
  return d === "6h" || d === "72h" || d === "24h" ? d : "24h";
}

/**
 * THE BOUNDS THE DIAL ENFORCES, not a ceiling inferred from a landing (B2,
 * 2026-08-24).
 *
 * The copilot had no ceiling field at all. It held `seatedLeverage` — the
 * leverage a fresh pick LANDS on — and, having nothing else, called it the
 * market's "modeled ceiling". Measured in the wild on wstETH/WETH: the model
 * answered a request for maximum leverage with "its modeled ceiling seats at
 * 2.75x" while the shipped control was `min=1 max=3.75 step=0.25`, and hand-
 * dragging that dial to 3.50x moved the lane header from 1.9% to 2.1%. The
 * claim was false AND it cost the user the yield they had asked for, on a
 * market where the product's own model says leverage adds.
 *
 * The bounds come from `descriptorsFor("safety-buffer", ctx)` — the very
 * descriptor `PlateControls` renders the slider from — so there is no second
 * derivation to drift. Null where the lane has no dial at all: a funding
 * carry, a delta-neutral LP, a treasury collar and a treasury floor borrow
 * nothing, and a market whose slope is not positive has the module withheld
 * entirely. Advertising a
 * range for a control that is not on the plate is the same defect facing the
 * other way.
 */
export interface SeatBounds {
  min: number;
  max: number;
  step: number;
  /** The leverage a fresh pick lands on: the dial's own default here. */
  default: number;
}

export function seatBoundsFor(row: ProjectedCandidate): SeatBounds | null {
  const d = descriptorsFor("safety-buffer", {
    lt: row.lt,
    scanLeverage: row.economics?.loopLeverage ?? null,
    preset: "standard",
  }).find((p) => p.field === "targetLeverage");
  if (
    !d ||
    typeof d.min !== "number" ||
    typeof d.max !== "number" ||
    typeof d.step !== "number" ||
    typeof d.default !== "number"
  ) {
    return null;
  }
  return { min: d.min, max: d.max, step: d.step, default: d.default };
}

/** Below this two leverages are one leverage. The dial's grid is 0.25. */
const LEVERAGE_EPS = 1e-9;
/** Below this an APY difference is not a difference a reader can act on. The
 *  0.05pp threshold is the compose ladder's own materiality test, so a line
 *  appears here exactly where the review sheet prints its two rungs. */
const MATERIAL_PP = 5e-4;

/**
 * BOTH LEVERAGES AND BOTH RATES, IN THE CARD'S OWN FRAME, AT SETTINGS THE DIAL
 * ACTUALLY OFFERS (S1, 2026-08-24; corrected at the gate the same day).
 *
 * ── WHY THE FIRST ATTEMPT AT THIS SENTENCE WAS WITHDRAWN ──────────────────
 *
 * `marketLeverageLine` was structurally null on every proposal the copilot had
 * ever made — `dualLeverageLine` answers only the trap case (one frame
 * publishable, the other not) and NO row of the committed catalog is one — so
 * the copilot could not state both leverages before it seated a row. The first
 * repair generalized the picker's sentence to the ordinary case, pricing both
 * endpoints through `frameAt` at `economics.loopLeverage` against the seat.
 * Swept over the committed catalog that sentence was wrong on both axes:
 *
 *  · THE LEVERAGE IT NAMED WAS NOT ON THE DIAL. `frameAt` clamps to the
 *    market's own ceiling, which is NOT grid-floored, so the line advertised
 *    `3.52x` where `descriptorsFor` caps the control at `3.50x`, `2.87x`
 *    against `2.75x`, `2.31x` against `2.25x`. That is B2's defect — a
 *    leverage the user cannot reach, offered as this market's own — rebuilt
 *    inside the sentence that was meant to close S1. Worse, it fired on 19
 *    rows whose leverage module the product WITHHOLDS ENTIRELY: a lane that
 *    seats 1.00x with no plate on it was told "−73.1% at its own 2.31x".
 *
 *  · THE RATES WERE IN A THIRD FRAME. `frameAt` returns `composedTerms(...)
 *    .total` — hedged, pre-compound, PRE-FEE — while the card one line above
 *    prints `net {published} modeled`. On `dolomite-berachain:ibera-wbera` the
 *    line's own seat endpoint read 20.4% over a card printing the product
 *    number for the same lane at the same leverage. One card, two net APYs for
 *    one lane, which is the exact defect this whole wave exists to close.
 *
 * ── WHAT SHIPS INSTEAD ────────────────────────────────────────────────────
 *
 * The two leverages worth naming are the one the lane SEATS and the one the
 * catalog's own sweep found the optimum at (`bestL`, through `deriveBest` →
 * `reachableLeverage`), and the second is grid-aligned and inside
 * `seatBounds` on every row of the committed catalog because it is one of the
 * two ends of the range the dial itself is derived from. Both rates come out
 * of `composedTerms(...).published` at the lane's own composition — the ONE
 * door `laneEconomicsFor` prices `vaultApy` through — so the seat endpoint of
 * this sentence IS the card's `net` line, to the digit, by construction.
 *
 * Null where the lane holds no leverage dial at all (a funding carry, an LP, a
 * collar, a treasury floor, and any market the module ruling withholds the
 * plate on): there is
 * no second leverage to name, and naming one would advertise a control that is
 * not on the lane. Null where the two settings are one setting, and null where
 * the two rates are closer than the compose ladder's own materiality
 * threshold, so a line appears here exactly where the review sheet would print
 * two rungs.
 *
 * ⚠ `dualLeverageLine` IS DELIBERATELY NOT CONSULTED. It is the picker's
 * ratified copy and it belongs on the picker, whose card headline is the same
 * pre-fee frame it prices in. On the copilot card the headline is the product
 * number, so quoting it here would put two fee frames on one card — the defect
 * above, arriving by the other door. The trap case it answers is covered: a
 * row where one frame is unpublishable and the other is not has two published
 * numbers that differ by far more than the materiality threshold, so this
 * sentence fires there and states both.
 */
export function seatVersusBestLine(
  row: ProjectedCandidate,
  sel: { leverageModule: boolean; hedge: boolean; compound: boolean },
  seatedAt: number,
  publishedAtSeat: number | null,
  comp: LaneComposition,
  placed: readonly ModuleKey[],
): string | null {
  // No plate, no second leverage. This is the 19-row case above.
  if (strategyForRow(row) !== "loop" || !sel.leverageModule) return null;
  const bounds = seatBoundsFor(row);
  const best = (row as UnifiedRow).bestL ?? null;
  if (bounds === null || typeof best !== "number" || !Number.isFinite(best)) return null;
  // Never name a setting the control refuses. Belt to the range's own
  // derivation, which shares `reachableLeverage` with the dial's ceiling.
  if (best < bounds.min - LEVERAGE_EPS || best > bounds.max + LEVERAGE_EPS) return null;
  if (Math.abs(best - seatedAt) <= LEVERAGE_EPS) return null;
  if (publishedAtSeat === null) return null;
  const atBest = composedTerms(repriceAtLeverage(row, best, comp), sel.hedge, comp, placed)
    ?.published;
  if (typeof atBest !== "number" || !Number.isFinite(atBest)) return null;
  if (Math.abs(atBest - publishedAtSeat) < MATERIAL_PP) return null;
  return `${pct(atBest)} at ${lev(best)} · ${pct(publishedAtSeat)} at the ${lev(seatedAt)} this lane seats`;
}

export interface LaneEconomics {
  strategy: StrategyKind;
  /** The leverage the lane is priced AND seated at. */
  seatedLeverage: number;
  /** MARKET frame: `composedTerms(...).core`. What the venue pays. */
  marketApy: number | null;
  /** PRODUCT frame: `composedTerms(...).published`. What the vault pays. */
  vaultApy: number | null;
  /** `composedTerms(...).fee`, a positive magnitude. */
  computeFee: number | null;
  capacityUsd: number | null;
  capacityBinding: string | null;
  /** BOTH leverages and BOTH rates, in the PRODUCT frame, at settings the dial
   *  offers (`seatVersusBestLine`). Its seat endpoint IS `vaultApy` rendered,
   *  so the card's `net` line and this sentence are one number. Null where the
   *  lane holds no leverage dial, where the two settings are one setting, and
   *  where the two rates are inside the ladder's materiality threshold. */
  marketLeverageLine: string | null;
  /** True where borrowing costs more at the margin than the collateral earns,
   *  so the rack withholds the leverage module entirely. */
  leverageSubtracts: boolean;
  /**
   * THE RANGE THE DIAL ACTUALLY OFFERS on this lane, or null where the lane
   * holds no leverage dial at all. `seatedLeverage` above is where a fresh
   * pick LANDS inside this range, never its ceiling (B2).
   */
  seatBounds: SeatBounds | null;
  /**
   * The highest leverage on the grid that still models strictly above zero
   * (`breakevenStopFor`), at THIS composition. Null on a market with no debt
   * leg and on a hand-authored row: there is no `netCarry(L)` to cross zero.
   * This is where leverage stops helping, and it is a leverage, not a rate.
   */
  breakevenLeverage: number | null;
  /** The leverage the catalog's own sweep found the optimum at, on the dial's
   *  grid. `bestApy` is deliberately NOT carried: a third APY invites a third
   *  frame, and the two frames above are the whole vocabulary. */
  bestLeverage: number | null;
  /** The optimum sits at the BOTTOM of the reachable range: leverage costs
   *  this market money at every setting the dial offers. */
  bestAtFloor: boolean;
  /** Negative at EVERY reachable setting. Nothing to build here. */
  neverPositive: boolean;
  /**
   * THE COLLAR'S FORGONE UPSIDE, AS A SENTENCE (QNT-R2-3, closed on the
   * copilot 2026-09-02). Null on every other family.
   *
   * `vaultApy` above is `terms.published`, and on a collar that figure is paid
   * for by the upside sold above the strike: under the flat-IV table the two
   * are ONE number, the `Calls written` leg's own APR. So the quant ledger
   * (2026-08-27) rules that the figure and this line print together or the
   * cash flow lies by omission, on every surface that prints the figure. Five
   * carried it and the copilot did not, which left the one panel that
   * GENERATES PROSE free to print the collar's number bare or to paraphrase a
   * shipped sentence.
   *
   * `collarForfeitLine` is the one spelling and `collarForfeit` the one
   * derivation; nothing here re-words either. Neither the figure nor the
   * sentence is ever re-derived from `vaultApy`.
   */
  upsideForfeitLine: string | null;
  /** `fundingRateLine(row)` VERBATIM (`"{pct} p25 over {days}d"`), or null.
   *  ⚠ NEVER PIN THE RATE. The p25 is a live measurement and it has already
   *  moved once inside this wave (10.19% to 10.22%); the owner is the string's
   *  shape and the function that builds it, never the digits of the day. */
  fundingLine: string | null;
  /** The eyes-open verdict for a measured, rail-less venue; null when launchable. */
  railVerdict: string | null;
  /** The MEASURED refusal when the row is an absence; null when it can be built. */
  absenceReason: string | null;
}

/**
 * Price one row at one selection, in both frames, once.
 *
 * `sel.leverage` is honoured only on a loop lane that actually seats the
 * leverage module. Every other strategy has no dial at all, so it prices at
 * `PRODUCT_MIN_LEVERAGE` — inventing a leverage there would advertise a
 * control the market does not have.
 */
export function laneEconomicsFor(
  row: ProjectedCandidate,
  sel: { leverage: number | null; leverageModule: boolean; hedge: boolean; compound: boolean },
  /**
   * ⚠ DEFAULTS TO THE COMPOSITION THE LANE SEATS, NEVER TO THE CATALOG ONE.
   *
   * This parameter defaulted to `CATALOG_COMPOSITION` and that default is the
   * whole of defect S2 — see `seatedComposition` above for the measured pairs.
   * A caller that knows the lane's real dials (the blueprint validator, a live
   * lane on the rack) still passes them; a caller that does not now gets the
   * composition the selection implies rather than an empty one.
   */
  comp: LaneComposition = seatedComposition(sel),
  /**
   * The lane's ACTUAL module keys, when the caller is describing a lane on the
   * rack rather than a market in the catalog.
   *
   * Absent, the modules are derived from the strategy and the selection, which
   * is right for a catalog row and for a blueprint lane (both are complete by
   * construction). A LIVE lane can be half-built, and only its own node set
   * knows that: `composedHere` is what refuses a hand-authored figure to a lane
   * missing a leg, and it can only refuse what it is shown.
   */
  placedOverride?: readonly ModuleKey[] | null,
  /**
   * THE LANE WHOSE DIALS THE COLLAR'S COMPANION IS READ OFF (QNT-R2-3).
   *
   * Absent, a collar's forgone-upside line is stated at `COLLAR_DEFAULT_DIALS`
   * — which is not a fallback constant but the dials the hand-authored row is
   * PRICED at (`COLLAR_CANDIDATE` is built from them), so the sentence and the
   * `vaultApy` beside it describe one composition. That is the same read
   * `DiscoverPanel` makes for the catalog row, and it is right for every
   * caller that is describing a MARKET: explain, compare, the blueprint card
   * and the demo seed all seat a collar at exactly those dials.
   *
   * A LIVE lane can have been re-dialled, and only its own nodes know that, so
   * `context.ts` passes the graph and the line follows the strike the builder
   * moved. Same shape and same reason as `placedOverride` above.
   */
  collarLane?: LoopGraph | null,
): LaneEconomics {
  const strategy = strategyForRow(row);
  const absence = discoverAbsence(row as AbsenceRow);
  const absenceReason =
    absence === null
      ? null
      : absence === "cap"
        ? capacityReason(row)
        : absence === "noLeg"
          ? "no spot leg to hold against the short"
          : absence === "neg"
            ? "modeled below zero at every reachable leverage"
            : unmeasuredReason(row as UnifiedRow);

  /* THE LEVERAGE, FLOORED AT THE PRODUCT MINIMUM.
     `repriceAtLeverage` returns the row UNTOUCHED for anything below
     `PRODUCT_MIN_LEVERAGE` — silently, at the scan's own ceiling, which is the
     A2 shape: it does not throw and it does not blank, it answers a different
     question. A caller cannot hand this function a leverage that produces that
     answer. */
  const wanted =
    typeof sel.leverage === "number" && Number.isFinite(sel.leverage)
      ? sel.leverage
      : seatedLeverage(row);
  const L =
    strategy === "loop" && sel.leverageModule
      ? Math.max(PRODUCT_MIN_LEVERAGE, wanted)
      : PRODUCT_MIN_LEVERAGE;
  const priced = repriceAtLeverage(row, L, comp);
  const placed = placedOverride ?? seatedModulesFor(strategy, sel);
  const terms = composedTerms(priced, sel.hedge, comp, placed);
  const seated = priced.economics?.loopLeverage ?? L;
  /* THE DIAL EXISTS ONLY WHERE THE PLATE DOES. A strategy with no leverage
     segment, and a market the module ruling withholds the plate on, both
     carry no range at all — quoting one would advertise a control that is not
     on the lane. */
  const hasDial = strategy === "loop" && sel.leverageModule;
  /* Null off the collar family by construction: `laneCollarForfeit` and
     `collarForfeit` both refuse a rack missing a leg and an off-grid dial, so
     a half-built collar states no companion rather than a finished one's. */
  const forfeit =
    strategy === "collar"
      ? collarLane
        ? laneCollarForfeit(collarLane)
        : collarForfeit(COLLAR_DEFAULT_DIALS)
      : null;

  return {
    strategy,
    seatedLeverage: seated,
    marketApy: terms?.core ?? null,
    vaultApy: terms?.published ?? null,
    computeFee: terms?.fee ?? null,
    capacityUsd: laneCapacityUsd(priced, sel.hedge, comp),
    capacityBinding: capacityBindingLabel(priced, sel.hedge) || null,
    /* THE SEAT ENDPOINT IS `vaultApy` ITSELF, handed in rather than re-priced,
       so the sentence and the card's `net` line cannot be two numbers. */
    marketLeverageLine: seatVersusBestLine(
      row,
      sel,
      seated,
      terms?.published ?? null,
      comp,
      placed,
    ),
    leverageSubtracts: !leverageModuleInstalls(row),
    seatBounds: hasDial ? seatBoundsFor(row) : null,
    breakevenLeverage: hasDial ? breakevenStopFor(row, sel.hedge, comp) : null,
    bestLeverage: hasDial ? (row as UnifiedRow).bestL ?? null : null,
    bestAtFloor: (row as UnifiedRow).bestAtFloor === true,
    neverPositive: (row as UnifiedRow).neverPositive === true,
    upsideForfeitLine: forfeit ? collarForfeitLine(forfeit) : null,
    fundingLine: fundingRateLine(row),
    railVerdict: LAUNCHABLE_VENUES.has(row.venue) ? null : railVerdictFor(row.venue),
    absenceReason,
  };
}

/**
 * The selection a market is DESCRIBED at when nobody has composed anything
 * yet: the default install chain, at the leverage the rack would seat.
 *
 * One owner, because the context row and the explain card must describe the
 * same machine — two defaults is how a market card and a blueprint lane came
 * to print two numbers for one row.
 */
export function defaultSelFor(row: ProjectedCandidate): {
  leverage: number | null;
  leverageModule: boolean;
  hedge: boolean;
  compound: boolean;
} {
  const strategy = strategyForRow(row);
  return {
    leverage: null,
    leverageModule: leverageModuleInstalls(row) && strategy === "loop",
    /* A collar's protection IS its option pair, so a perp leg is refused
       there, and a treasury floor lane holds no perp leg at all: its chain is
       the source and the exit route. Both are refused STRUCTURALLY rather than
       through `cls`, so the answer does not change the day a row's class does.
       Everything else takes the market's own class. */
    hedge: strategy === "collar" || strategy === "treasury" ? false : row.cls === "A",
    /* The default install chain ends in auto-compound ON THE FAMILIES THAT
       HAVE ONE. A treasury lane does not: the module's own description is
       "when earned yield loosens the health factor, the leverage module pulls
       it back to target", and this family holds no debt, no health factor and
       no leverage module. Its required groups are the source and the route
       (`STRUCTURAL_MODULES.treasury`), and its yield accrues in the position
       itself, so crediting a compounding lift on top of a supply APY counts
       the same compounding twice.

       IT IS ALSO THE FLOOR LANE'S TWO PUBLISHED NUMBERS (integration). With
       compound seated the market list published the reserve at 2.996% while
       the router published the same lane on the same day at 2.971%, and both
       reached the copilot inside one context block. Refused structurally,
       beside the hedge above, so the answer does not change the day a row's
       class does. */
    compound: strategy !== "treasury",
  };
}
