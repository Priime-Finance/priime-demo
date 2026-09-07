/**
 * HEDGE ECONOMICS — the single owner (hedge spec R3, 2026-08-22).
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
 * The founder's screenshot showed one screen making three different claims
 * about one hedge: a plate hero, a dock readout and a tip, each formatted by
 * a private helper, each reading `fundingP25Apr` / `F_B` / the drag constants
 * directly, none of them able to see the others. Two of them were also
 * wearing the wrong unit (a rate difference printed with a `%`).
 *
 * R3 settles it: this module is the ONLY place in the app permitted to read
 * `fundingP25Apr`, `F_B`, `EXEC_DRAG_APR` or `EXEC_DRAG_UNHEDGED` for a hedge
 * purpose. `PlateScreen`, tips B7/B13, `LanePanel`'s composition card,
 * `ModulePanel` and the published asset page all render from ONE returned
 * object per lane. No surface formats `netPp` itself.
 *
 * Grep rule (enforceable, and the one rule that would have prevented the
 * reported defect): the identifier `fundingP25Apr` may appear in
 * `mock-quote.ts`, `hedge-econ.ts` and `templates.ts` and NOWHERE under
 * `components/`.
 *
 * ── THE ARITHMETIC, ONCE ──────────────────────────────────────────────────
 * With G = L·cy − (L−1)·bo the loop's GROSS carry at the applied leverage:
 *
 *   withApy    = f_b · (G + f − DRAG_HEDGED)        (simulate-v2.ts:259-260)
 *   withoutApy = G − DRAG_UNHEDGED                  (simulate-v2.ts:345-351)
 *   ─────────────────────────────────────────────────────────────────────
 *   withApy − withoutApy = −(1−f_b)·G  +  f_b·f  +  (DRAG_U − f_b·DRAG_H)
 *                          ╰ escrow ╯    ╰ fund ╯   ╰──── drag delta ────╯
 *
 * Three terms, exactly, and they sum to the number the lane header moves by
 * when the hedge key is pressed. That identity is what the plate, the bar,
 * the ledger, the sentence, the tip and the arrow are all views of.
 *
 * G is computed from the DIRECT fields (`grossCarry`), never backed out as
 * `netCarry − f + DRAG_H`. Both are exact today; the direct form has no
 * funding dependency and stays correct if that field is ever re-based.
 *
 * ── THE ASSERT IS THE DESIGN, NOT PARANOIA ────────────────────────────────
 * `hedgeEconomics` proves its own decomposition against the two APY
 * functions the lane header itself calls, and returns `null` — prints
 * nothing — when it cannot. The live landmine it defuses:
 * `economics.netApyWithRewards` computes the reward overlay with `fB = F_B`
 * for class A but `fB = 1` for class N1 (simulate-v2.ts:263 vs :373). Today
 * `candidateApy`/`hedgelessApy` both EXCLUDE rewards, so the identity holds.
 * The moment anyone points the lane header at the nicer number, the with-side
 * gains rewards and the without-side does not, the hedge value silently goes
 * wrong by (1−F_B)/F_B · rewardApy, and no test fails. With the assert the
 * plate goes blank instead of lying.
 *
 * ── UNITS ─────────────────────────────────────────────────────────────────
 * Every number in `HedgeEconomics` is a RATE FRACTION (0.077 = 7.7pp), like
 * every other number in the canvas model. The `Pp` suffixes name what the
 * term MEANS (a percentage-point contribution), not how it is stored. Only
 * `format.ts` turns them into glyphs, and only `pp()` may emit `pp`.
 */

/* eslint-disable @typescript-eslint/array-type, @typescript-eslint/prefer-optional-chain --
 * Kit-verbatim file, ported from build.priime.finance eb6d33a. The findings
 * are the typed presets reading kit idioms; not rewriting kit logic to satisfy
 * lint, per the integration's own directive (the RackCanvas.tsx precedent). */

import { EXEC_DRAG_UNHEDGED, UNDERLYING_MAP } from "@/lib/model-constants";
import { feeRows } from "./fees";
import { ARROW, lev, MATERIAL_DELTA, MINUS, pct } from "./format";
import {
  candidateApy,
  composedTerms,
  fbForComposition,
  grossCarry,
  hedgeDialsFor,
  hedgelessApy,
  type LaneComposition,
} from "./mock-quote";
import { isTemplateVenue, type ProjectedCandidate } from "./opportunities";

/**
 * ── f_b HAS EXACTLY ONE DERIVATION (R5, 2026-08-22) ───────────────────────
 *
 * The spec was written against `F_B = 0.75` and `EXEC_DRAG_APR = 0.0075`,
 * two flat constants. Both stopped being constants on 2026-08-22: A2 made
 * f_b a function of the hedge dials (`fB(L_h, r)`, 0.6742 at the shipped
 * composition) and A13 made the hedged drag a function of the delta band
 * (`execDragApr(band)`). A hedge module that reads the old constants would
 * describe a lane that nobody priced.
 *
 * The first pass at that fixed the constant by INVERTING f_b out of the
 * row's own economics. That is correct — and it quietly created a SECOND
 * derivation, which is the same class of defect the founder photographed:
 * `hedge-econ` inverted 0.6742 out of a repriced row while `capacity.ts`
 * divided by the flat 0.75 and an un-repriced catalog row implied 0.75. One
 * screen, one lane, "25% escrowed" here and "33% escrowed" there.
 *
 * R5 settles it, and `escrowShare` below is the settlement — the ONE
 * function in the app that answers "what is f_b on this lane", used by this
 * module and by `capacity.ts` and by nothing else:
 *
 *   • composition known  →  `fB(L_h, r)` IS the truth. The dials define it.
 *   • composition absent →  the row's implied `netApyOnDepositApy /
 *                           netCarryOnEquityApy` is the truth, because that
 *                           ratio is exactly the f_b whichever function
 *                           priced the row multiplied through.
 *
 * The path taken is REPORTED (`fbSource`), so a surface holding two objects
 * can see that they disagree instead of printing both. Mixing the two on one
 * screen is the bug; either one alone is a fact.
 *
 * The hedged drag stays an inversion in every case, `dragHedged = G + f −
 * netCarryOnEquityApy`, because it has no composition-side twin here: the
 * band lives in `execDragApr` and the row already carries the result.
 *
 * `EXEC_DRAG_UNHEDGED` stays an import because it is what `hedgelessApy`
 * itself charges the without-side; reading it here is reading the other
 * endpoint's own number, not a second model.
 */

/** Which derivation produced f_b. Two objects on one screen carrying
 *  different values here must never both be rendered. */
export type FbSource = "composition" | "row";

export interface EscrowShare {
  /** f_b — the share of each deposited dollar that reaches the loop leg. */
  fb: number;
  source: FbSource;
}

/**
 * THE f_b accessor. See the R5 block above.
 *
 * `comp` is the lane's composition (`pricingParamsFor(loop)`). Pass it
 * wherever the lane is known; omit it only when all you hold is an
 * un-repriced catalog row.
 *
 * A composition with `hedge: null` is still a KNOWN composition: a class-A
 * row is priced through the escrow whether or not the module is installed
 * (`repriceAtLeverage` calls `fBFor(comp)` unconditionally on class A), so
 * the descriptor defaults are the honest answer and the source is still
 * `composition`. Whether the lane RUNS the hedge is a separate question,
 * asked with `hasHedge` at the call site, never inferred from here.
 *
 * Null means there is nothing honest to say: no economics, or an inverted
 * ratio outside (0, 1], which is not an escrow multiply.
 */
export function escrowShare(
  c: ProjectedCandidate | null | undefined,
  comp?: LaneComposition | null,
): EscrowShare | null {
  const e = c?.economics;
  if (!c || !e) return null;
  // Class N1 has no perp leg and no HL margin, so nothing is escrowed and the
  // model runs f_b = 1 outright (simulate-v2.ts:351). Same for a hand-authored
  // template row, whose `fundingP25Apr` IS its whole hedge cost.
  if (c.cls !== "A" || isTemplateVenue(c.venue)) return { fb: 1, source: "row" };

  if (comp !== undefined && comp !== null) {
    // R5 grep: NOT re-derived here. `fbForComposition` is the one function
    // that turns a composition into f_b, and it is the same one
    // `repriceAtLeverage` prices the row with, so the accessor and the
    // pricer cannot drift. This block used to hold a copy of those three
    // lines and the copies HAD drifted (0.10 vs 0.15 on the missing-dial
    // default).
    const fb = fbForComposition(comp);
    return finite(fb) && fb > 0 && fb <= 1 ? { fb, source: "composition" } : null;
  }

  const netCarry = e.netCarryOnEquityApy;
  if (!finite(netCarry) || Math.abs(netCarry) < 1e-12) return null;
  const fb = e.netApyOnDepositApy / netCarry;
  return finite(fb) && fb > 0 && fb <= 1 ? { fb, source: "row" } : null;
}

/**
 * The hero floor, 0.05pp. Below it the plate says `about even` rather than
 * `costs 0.0pp`, because `costs 0.0pp` is not a fact: the hero prints one
 * decimal of pp, so anything under half a hundredth of a point rounds to a
 * zero that reads as a measurement. sWBERA/oriBGT sits at f* 8.28% against
 * f 8.70% and will genuinely oscillate sign between scans.
 *
 * This is NOT the materiality floor. `MATERIAL_DELTA` (0.5pp, format.ts) is
 * the one threshold that decides whether a surface SPEAKS. This one only
 * decides which of three words the hero uses.
 */
export const EVEN_FLOOR = 0.0005;

/** Rounding-plug tolerance, 0.02pp. Beyond it the ledger prints nothing. */
const PLUG_TOLERANCE_PP = 0.02;

/** The identity tolerance. Float noise only; a real disagreement blanks. */
const IDENTITY_EPS = 1e-9;

/**
 * A reconciled ledger row. Display STRINGS, not raw numbers, because the
 * rounding plug means the printed escrow figure is derived from the other
 * three printed figures and no caller may re-derive it.
 *
 * Five columns, not two: `label │ sign │ integer │ .fraction+unit │
 * annotation`. Right-aligning whole tokens aligns the `pp` and misaligns the
 * decimal points by one character, which is the clearest tell of an
 * undesigned table. The integer cell is 3ch so a degenerate row (G = −135%)
 * still aligns.
 */
export interface LedgerRow {
  key: "funding" | "escrow" | "execution" | "fee" | "net";
  /** `funding leg` / `margin escrow` / `execution` / `compute fee` / `hedge, net`. */
  label: string;
  /** U+002B or U+2212. Every row explicitly signed, positives included. */
  sign: string;
  /** Integer part, unsigned. `14`. Right-aligned in a 3ch cell. */
  int: string;
  /** Fraction plus unit, left-aligned so the decimal points line up. `.05pp`. */
  frac: string;
  /** `75% of 8.7%` / `25% of capital`. Empty when the row has none. */
  annotation: string;
  /**
   * Three weight steps, and they point at WHY rather than at a verdict:
   * the total is ink 600, the largest-magnitude component is ink 500, the
   * other two are muted 400. On iBERA the ink row is `margin escrow`; on
   * kHYPE it is `funding leg`. No colour on any row — green is bound to
   * armed/modeled/live, and a hedge that costs money is the correct price
   * of neutrality, not an error.
   */
  emphasis: "total" | "dominant" | "muted";
}

/**
 * Which of the eleven plate states this lane is in, collapsed to the three
 * that change the arithmetic's availability. Surfaces branch on this, never
 * on a null check against a number.
 */
/**
 * ── TWO FRAMES, BOTH NAMED (C6 residual, 2026-08-24, planner ruling R1) ────
 *
 * THE DEFECT THIS SHAPE CLOSES, quoted from the Wave 2 seam report: "`tips.ts`
 * prints 'Modeled X with the hedge, Y without' from two VENUE APYs on a
 * product surface, and the same object feeds the hedge plate hero, the balance
 * bar and the ledger." Wave 1 had already moved the LANE HEADER to the product
 * frame, so one hedge carried two numbers inches apart, and the two attempts to
 * patch it (`applyComputeFee` spelled at `RackCanvas.composedPair` and again at
 * `ComposePanel`'s eject announcement) were second and third owners of the
 * ordering rather than a fix.
 *
 * The settlement is NOT "pick a frame". Both frames are real and each has a
 * surface that owns it:
 *
 *   VENUE   what this market pays at these dials, venue costs only. It is the
 *           frame the itemization below decomposes, the frame the identity
 *           assert proves, and the frame `contributions.ts` sums a ladder in
 *           (that ladder reconstructs `composedNetApy` and the fee is not one
 *           of its terms — it is what the house takes from the total).
 *   PRODUCT R1's published identity applied to BOTH endpoints, through
 *           `composedTerms`, so `product.withApy` is byte-identical to the
 *           `publishedNetApy` the lane header prints. What a depositor gets.
 *
 * So both are carried, both are named, and the bare `withApy` / `withoutApy` /
 * `netPp` fields are GONE. That deletion is the enforcement: a reader can no
 * longer take an unframed number by accident, because there is no unframed
 * number to take. Every call site now spells the frame it owns and the
 * typechecker fails the ones that do not. `venue-frame-on-product-surface.test.ts`
 * pins the direction of each one.
 */
export interface HedgeFrame {
  /** The lane's modeled APY with the short leg installed. */
  withApy: number;
  /** The same lane without it. The arrow's other endpoint. */
  withoutApy: number;
  /** `withApy − withoutApy`. What the hedge is WORTH, signed, in this frame. */
  netPp: number;
}

/** The venue frame, plus the three terms it decomposes into. */
export interface VenueFrame extends HedgeFrame {
  /** −(1−f_b)·G. TRUE value; the display plug lives in `rows`. */
  escrowPp: number;
  /** +f_b·f. */
  fundingPp: number;
  /**
   * DRAG_UNHEDGED − f_b·dragHedged. The term whose entire job is to be
   * visibly negligible, which is why the ledger prints 2 dp: at 1 dp it
   * reads `−0.2pp`, a 23% overstatement of the smallest term.
   */
  dragPp: number;
}

export type HedgeState =
  /** Fully modeled: hero, sub-line, bar, breakeven, ledger, tip all legal. */
  | "priced"
  /** No funding number. The module is armed; it has nothing to quote yet. */
  | "unpriced"
  /** G ≤ 0: the loop's borrow exceeds its collateral yield, so the escrow
   *  term arrives POSITIVE (parking capital avoids a loss). The hedge still
   *  states its net and its funding leg, which are real; what is withheld is
   *  the breakeven and the bar. Revised 2026-08-22: this used to blank the
   *  whole hedge, which hid +7.4pp of real funding income on kHYPE. */
  | "degenerate";

export interface HedgeEconomics {
  /** G at the lane's APPLIED leverage. */
  grossCarry: number;
  /** Welds G to its L (Frame M). G is meaningless without it. */
  leverage: number;
  /**
   * 1 − f_b, at the composition this row was priced at. The fraction of
   * deposit that sits as HL margin instead of working in the loop. Its
   * companion (1−f_b)/f_b is the breakeven multiplier, and stating the
   * capital fraction is what makes the multiplier non-arbitrary — which is
   * why the panel gloss names the fraction and the sub-line names f*.
   */
  escrowFraction: number;
  /**
   * WHERE THE ESCROW SITS, per deposited dollar, from the dials: `f_b / L_h`
   * is the short's margin and `r · f_b` the idle reserve held against it; the
   * two sum to `escrowFraction` exactly (f_b·(1 + 1/L_h + r) = 1). Known only
   * when a composition was passed — on the row path the ratio is inverted out
   * of the economics and the dials behind it are not recoverable. Null then.
   */
  escrowSplit: { margin: number; reserve: number } | null;
  /**
   * f_b itself, and WHICH derivation produced it (R5). A surface holding two
   * `HedgeEconomics` objects whose `fbSource` differs is holding two
   * different models of one lane and must render at most one of them. No
   * surface may re-derive f_b; `escrowShare` is the only door.
   */
  fb: number;
  fbSource: FbSource;
  /**
   * THE VENUE FRAME and its three terms. `venue.netPp` is their sum, and it is
   * `hedgeValue(c)` — proven by the identity assert, not asserted by comment.
   *
   * READ THIS ONE only where the surface is describing the MARKET: the
   * `contributions.ts` ladder that reconstructs `composedNetApy`, tip B13's
   * funding share and its zero-crossing, and this module's own arithmetic. A
   * lane header, a plate, a tip title, an add bay or a receipt is a PRODUCT
   * surface and takes `product`.
   */
  venue: VenueFrame;
  /**
   * THE PRODUCT FRAME — R1's published identity on both endpoints, evaluated
   * by `composedTerms`, its one owner, so the fee-then-compound ordering is
   * spelled in exactly one place in the codebase. `product.withApy` IS the
   * `publishedNetApy` the lane header prints for the composed lane, and
   * `product.withoutApy` is what that header would read after an eject.
   *
   * Every hero, bar, ledger total, tip title, tip body, add-bay triple and
   * receipt in the product renders from HERE.
   */
  product: HedgeFrame;
  /**
   * THE BRIDGE BETWEEN THE FRAMES, as a signed term: `product.netPp −
   * venue.netPp`. It is the house's own cut of what the hedge contributes, and
   * it is the FOURTH row of the ledger, so the itemized column still adds to
   * the total the hero prints.
   *
   * It is NOT simply `−0.20 × venue.netPp`. The fee is charged per composition
   * on a non-negative yield, so where one endpoint models below zero and the
   * other above it the two endpoints are taxed differently and this term can
   * arrive POSITIVE: the fee takes more from the alternative than from the
   * hedged lane, and the hedge is worth more after fees than before. Deriving
   * it as a residual rather than as a multiply is what keeps that case honest.
   */
  feePp: number;
  /** The market's p25 funding. 0 when unpriced. */
  fundingApr: number;
  /**
   * THE WINDOW THAT PERCENTILE WON OVER (C-H6, 2026-08-24), straight off the
   * row's own `fundingWindowDays`. The published figure is the MINIMUM of the
   * four measured windows, and a reader who cannot see which window won
   * cannot tell a book that is boringly positive over a year from one that is
   * positive over a quarter — the same argument the catalog card already
   * carries. Null where the row publishes no window (a market the funding
   * register never measured, and every template row); nothing is invented.
   */
  fundingWindowDays: number | null;
  /**
   * f* — the funding rate at which the hedge exactly pays for itself:
   *   f* = G·(1−f_b)/f_b  −  dragDelta/f_b
   *
   * At the shipped composition (L_h 3, reserve 0.15 ⇒ f_b 0.6742) the escrow
   * multiplier is 0.4833, up from G/3 under the old flat 0.75 — which is the
   * whole reason the constant had to die. Null when degenerate or template.
   * Degrades correctly: as G → 0, f* → the drag term alone, which is
   * exactly right — with no loop carry to forfeit, any funding above the
   * drag delta pays.
   *
   * ⚠ FRAME-INVARIANT, AND THAT IS WHY IT HAS NO FRAME (C6). f* is the funding
   * rate at which the hedge is worth exactly nothing, and at that rate the two
   * endpoints are EQUAL — so they carry equal fees and `product.netPp` crosses
   * zero at the same f as `venue.netPp`. Solving it on the venue terms is
   * therefore not a frame choice, it is the only derivation, and applying the
   * fee to it would move a published threshold away from the rate the lane
   * actually zeroes at. Same argument as tip B13's `zeroAt`.
   */
  requiredFundingApr: number | null;
  /** G ≤ 0. */
  degenerate: boolean;
  /** See `HedgeState`. */
  state: HedgeState;
  /**
   * `template` = a hand-authored row (templates.ts). No breakeven and no
   * bar; whether its venue terms are real depends on `authored` below.
   */
  shape: "model" | "template";
  /**
   * TRUE where the venue terms were STATED by the row's own family model
   * (`terms.hedge`, FB-1) rather than derived here — the dn-lp shape, whose
   * hedge has real escrow, funding and drag terms. FALSE on a bare template
   * row, where `fundingP25Apr` is the whole authored hedge cost and
   * `fundingApr` therefore may NOT wear the word "funding" on a surface.
   * Always false on shape `model`.
   */
  authored: boolean;
  /**
   * The hero's verb, and it speaks about the PRODUCT frame — the number the
   * hero prints beside it. A hedge worth +0.6pp before the house's cut and
   * +0.48pp after it says `pays` either way; one worth exactly the fee says
   * `even`, which is the honest word for a hedge whose whole contribution the
   * house takes.
   */
  verb: "costs" | "pays" | "even" | "none";
  /**
   * |product.netPp| ≥ MATERIAL_DELTA. THE one threshold, in ONE unit, in one
   * file. It was two: `LanePanel` thresholded `deltaPts` at 0.5 while tip B7
   * thresholded the raw value at 0.005 — same quantity, two units, two
   * literals, two files, and nothing stopping them from drifting apart.
   *
   * Taken on the PRODUCT frame because materiality asks "is this worth telling
   * the depositor about", and the depositor's number is the post-fee one. A
   * hedge worth 0.55pp of venue yield and 0.44pp to them is below the floor,
   * and a card that fires anyway is offering a move the reader cannot see.
   */
  material: boolean;
  /** Whether the balance bar may render at all (a flat instrument never does). */
  showBar: boolean;
  /** The full guard for tips B7 add/remove: material, priced, class A, non-degenerate. */
  tipEligible: boolean;
  /** Reconciled display strings. Empty on a degenerate lane. */
  rows: LedgerRow[];
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const round2 = (v: number): number => Number(v.toFixed(2));

/**
 * The hedge decomposition a hand-authored row states for itself (FB-1,
 * 2026-09-01): `templates.ts` `terms.hedge`, written by the same family model
 * that priced the lane total, so the plate and the header describe one
 * machine by construction. The dn-lp hedge has no generic derivation here —
 * its funding rides half the position and its escrow forfeits LP carry, not
 * loop carry — which is why the old template branch (three zero terms against
 * a real `withApy − withoutApy`) failed the identity assert and blanked the
 * plate on the one template lane whose market card advertises the hedge.
 *
 * Read STRUCTURALLY, the way `mock-quote.hedgelessApy` reads
 * `terms.hedgelessApy`: importing `templates.ts` here would close the
 * templates → capacity → hedge-econ import cycle. Null unless all four
 * fields are finite — a partial decomposition proves nothing, and the
 * identity assert would blank on it anyway.
 */
interface AuthoredHedge {
  /** p25 funding the short leg earns, annualized on its own notional. */
  fundingP25Apr: number;
  /** Venue-frame terms on deposit; sum to `netApy − hedgelessApy` exactly. */
  fundingPp: number;
  escrowPp: number;
  dragPp: number;
}

function authoredHedge(e: NonNullable<ProjectedCandidate["economics"]>): AuthoredHedge | null {
  const t = (e as { terms?: { hedge?: Partial<AuthoredHedge> | null } }).terms?.hedge;
  if (!t) return null;
  return finite(t.fundingP25Apr) && finite(t.fundingPp) && finite(t.escrowPp) && finite(t.dragPp)
    ? {
        fundingP25Apr: t.fundingP25Apr,
        fundingPp: t.fundingPp,
        escrowPp: t.escrowPp,
        dragPp: t.dragPp,
      }
    : null;
}

/**
 * The ONE entry point. Null means "this surface has nothing honest to say
 * about a hedge here" — not an error, and never a reason for a caller to
 * fall back to reading the economics itself.
 *
 * Null when: no candidate, no economics, the row is not class A (a class-N1
 * market has no perp and therefore no plate and no ghost), a required field
 * is non-finite, the decomposition fails its own identity, or the ledger
 * plug lands outside tolerance.
 *
 * `comp` is the lane's composition. Pass it wherever the lane is known —
 * then `fB(L_h, r)` is the f_b of record and `fbSource` reads `composition`.
 * Omit it and the row's own implied ratio is used instead (`fbSource: "row"`).
 *
 * WHAT PASSING A COMPOSITION COSTS, deliberately: the identity assert runs
 * against `candidateApy` and `hedgelessApy`, which read the row's OWN
 * economics. If the composition's f_b is not the f_b the row was priced at —
 * an un-repriced catalog row handed a lane's dials — the identity misses by
 * `(fb_comp − fb_row)·netCarry`, which is 4.5pp at 0.75 against 0.6742, and
 * this returns null. That is the design, not a bug to soften: a caller
 * holding a row and a composition that disagree has no single honest number
 * to print, so it prints none. Reprice the row first (`repriceAtLeverage(row,
 * L, comp)`) and the two agree exactly.
 */
export function hedgeEconomics(
  c: ProjectedCandidate | null | undefined,
  comp?: LaneComposition | null,
): HedgeEconomics | null {
  const e = c?.economics;
  if (!c || !e) return null;
  // Class N1 has no perp market, so there is no hedge to describe. The
  // Compose panel lists `Dynamic hedge` as incompatible there and gives the
  // reason; nothing on the plate.
  if (c.cls !== "A") return null;

  const leverage = e.loopLeverage;
  if (!finite(leverage) || leverage <= 0) return null;
  if (!finite(e.collateralYieldApy) || !finite(e.borrowApyMarginal)) return null;

  const withApy = candidateApy(c);
  const withoutApy = hedgelessApy(c);
  if (!finite(withApy) || !finite(withoutApy)) return null;

  const template = isTemplateVenue(c.venue);
  const shape: "model" | "template" = template ? "template" : "model";
  const rawFunding = e.fundingP25Apr;
  // A hand-authored row that STATES its own decomposition (FB-1). Where it is
  // present the three venue terms below are its, the row is PRICED, and
  // `fundingApr` is the short leg's own p25 rate.
  const authored = template ? authoredHedge(e) : null;

  // State 10: no funding number. Template rows additionally treat an exact 0
  // as absent — a hand-authored row with a zero hedge cost is a row whose
  // author declined to model one, not a row that measured zero. A row whose
  // family model authored the decomposition outright is priced regardless of
  // the generic field, which the dn-lp deliberately leaves null (E3).
  const unpriced = template
    ? authored === null && (!finite(rawFunding) || rawFunding === 0)
    : !finite(rawFunding);
  const fundingApr = finite(rawFunding) ? rawFunding : (authored?.fundingP25Apr ?? 0);
  // The window the percentile won over (C-H6). Only the row's own field;
  // absent means null and every consumer prints its pre-window string.
  const rawWindow = e.fundingWindowDays;
  const fundingWindowDays =
    !template && finite(rawWindow) && rawWindow > 0 ? rawWindow : null;

  const g = grossCarry(c, leverage);
  if (!finite(g)) return null;

  // f_b, through the ONE accessor (R5). `escrowShare` picks the composed
  // `fB(L_h, r)` when a composition is in hand and the row's implied ratio
  // when it is not, and says which. Anything outside (0, 1] is not an escrow
  // multiply and this module says nothing.
  const netCarry = e.netCarryOnEquityApy;
  if (!finite(netCarry) || Math.abs(netCarry) < 1e-12) return null;
  const share = escrowShare(c, comp);
  if (!share) return null;
  const fb = share.fb;
  const escrowFraction = 1 - fb;
  const dials = share.source === "composition" ? hedgeDialsFor(comp) : null;
  const escrowSplit =
    dials && !template
      ? { margin: fb / dials.hedgeLeverage, reserve: dials.reserveFraction * fb }
      : null;

  // The hedged lane's execution drag, likewise inverted rather than
  // re-derived from the band: netCarry = G + f − dragHedged.
  //
  // It is bounded BELOW by the unhedged floor, by construction: the model
  // charges a hedged lane the loop-side cost every lane pays plus a
  // strictly positive rebalance term (`execDragApr` = EXEC_DRAG_UNHEDGED +
  // (band ratio)²·rest). A row whose economics imply a hedged lane executing
  // more cheaply than an unhedged one is a row this module will not read.
  const dragHedged = g + fundingApr - netCarry;
  if (!template && dragHedged < EXEC_DRAG_UNHEDGED - 1e-12) return null;

  // The three terms. A template row with an AUTHORED decomposition (FB-1)
  // takes it whole — the family model already split its hedge into the same
  // three-term grammar, and it is the split the lane total was priced with.
  // A bare template row keeps the old shape: no escrow and no drag, the
  // authored `fundingP25Apr` is the entire hedge cost. Either way the
  // identity below still has to hold.
  const escrowPp = template ? (authored?.escrowPp ?? 0) : -escrowFraction * g;
  const fundingPp = template ? (authored ? authored.fundingPp : fundingApr) : fb * fundingApr;
  const dragPp = template ? (authored?.dragPp ?? 0) : EXEC_DRAG_UNHEDGED - fb * dragHedged;
  const netPp = escrowPp + fundingPp + dragPp;

  // THE ASSERT. A surface that cannot prove its own arithmetic prints
  // nothing. Run on TRUE values, BEFORE the display plug — the spec's
  // interface comment calls escrowPp "already rounding-plugged", but a 2 dp
  // plug carries up to 2e-4 of error and would fail a 1e-9 identity every
  // time. The assert is explicitly "the design", so it wins: escrowPp stays
  // true and the plug lives only in `rows`.
  //
  // WHAT IT CATCHES, precisely. On the `row` path f_b and dragHedged are both
  // inverted out of `economics`, so the decomposition is self-consistent with
  // those fields by construction and the assert's job is to catch the two
  // endpoints DRIFTING AWAY from them. On the `composition` path f_b comes
  // from the dials instead, so the assert additionally proves that the row in
  // hand was actually priced at those dials — it is what makes threading a
  // composition safe rather than a second, unverified model.
  //
  // The live landmine on both paths: point `candidateApy`
  // at `netApyWithRewards` and withApy stops equalling the
  // `netApyOnDepositApy` this module decomposed, by (1−f_b)/f_b · rewardApy,
  // and the plate blanks instead of printing a hedge value that is wrong by
  // a third of the reward overlay. It equally catches `hedgelessApy` being
  // re-based off `G − EXEC_DRAG_UNHEDGED`, and a template row whose venue
  // classification disagrees between the two files.
  if (Math.abs(netPp - (withApy - withoutApy)) > IDENTITY_EPS) return null;

  /* ── THE PRODUCT FRAME (C6, 2026-08-24, planner ruling R1) ────────────────
     Both endpoints through `composedTerms`, the ONE owner of R1's ordering
     (`afterFee = venueNet − computeFeeTerm(venueNet)`, then the compound step
     re-evaluated on the after-fee base). Not `applyComputeFee` spelled here:
     that would drop the compound step and make `product.withApy` disagree with
     the `publishedNetApy` the lane header prints on any lane running
     auto-compound — a different number for one lane, which is the whole defect.

     `composedTerms(c, true, comp)` takes the hedged composition and
     `composedTerms(c, false, comp)` the ejected one; on a class-A row their
     `core` fields ARE `withApy` and `withoutApy` by construction, which is
     asserted immediately below rather than trusted. A caller passing no `comp`
     gets `compoundDelta(x, null) === 0`, so the product frame degrades to the
     fee alone and never invents a compound step nobody dialled.

     Null out rather than fall back: an object that cannot state the depositor's
     own number has nothing to put on a product surface, and every surface here
     already renders nothing on null. */
  const pWith = composedTerms(c, true, comp);
  const pWithout = composedTerms(c, false, comp);
  if (!pWith || !pWithout) return null;
  if (
    Math.abs(pWith.core - withApy) > IDENTITY_EPS ||
    Math.abs(pWithout.core - withoutApy) > IDENTITY_EPS
  ) {
    return null;
  }
  if (!finite(pWith.published) || !finite(pWithout.published)) return null;
  const productNetPp = pWith.published - pWithout.published;
  /* The bridge term, as a RESIDUAL. See `feePp`: a multiply would be wrong
     wherever the two endpoints straddle zero and are therefore taxed at
     different effective rates. */
  const feePp = productNetPp - netPp;

  const degenerate = g <= 0;
  const state: HedgeState = degenerate ? "degenerate" : unpriced ? "unpriced" : "priced";

  // f*: solve netPp = 0 for f. Only meaningful where there is an escrow to
  // out-earn, so null on a degenerate row (nothing to forfeit) and on a
  // template row (no escrow term at all).
  const requiredFundingApr =
    degenerate || template ? null : (escrowFraction * g - dragPp) / fb;

  /* THE VERB SPEAKS ON A DEGENERATE ROW (revised 2026-08-22, founder caught it).
     `degenerate` used to blank the hero, on the reasoning that a POSITIVE
     escrow term on a loop whose borrow exceeds its collateral yield is an
     artifact rather than a feature. That reasoning is right about the escrow
     and wrong about the hedge. Measured on kHYPE at 2.00x: cy 1.84%, bo 4.16%,
     so G is −0.47pp and the row is degenerate, yet the hedge is worth
     +7.43pp of which roughly +7.38pp is `f_b · f`, REAL funding income, and
     only about +0.05pp is the escrow artifact. Blanking the hero threw away
     99% real income to hide 1% artifact, on the one market where the ledger
     itself says funding IS the strategy.
     So: the net is stated (the identity assert above already proved it), the
     BREAKEVEN is still withheld (f* is meaningless with nothing to forfeit),
     the bar stays off (its left-is-cost semantic inverts here), and the escrow
     row is annotated rather than celebrated. */
  /* ⚠ THE VERB AND THE FLOOR SPEAK ABOUT THE PRODUCT FRAME (C6). They sit
     beside the hero's digits, and those digits are the depositor's number. */
  const verb: HedgeEconomics["verb"] =
    unpriced
      ? "none"
      : Math.abs(productNetPp) < EVEN_FLOOR
        ? "even"
        : productNetPp < 0
          ? "costs"
          : "pays";

  const material = Math.abs(productNetPp) >= MATERIAL_DELTA;

  const rows = unpriced
    ? []
    : buildLedger({
        template,
        authored: authored !== null,
        escrowPp,
        fundingPp,
        dragPp,
        feePp,
        netPp: productNetPp,
        fundingApr,
        fb,
        degenerate,
      });
  // The plug failed its own tolerance. Same law as the identity: print
  // nothing rather than a column that does not add.
  if (!unpriced && rows.length === 0) return null;

  return {
    grossCarry: g,
    leverage,
    escrowFraction,
    escrowSplit,
    fb,
    fbSource: share.source,
    venue: { escrowPp, fundingPp, dragPp, netPp, withApy, withoutApy },
    product: {
      withApy: pWith.published,
      withoutApy: pWithout.published,
      netPp: productNetPp,
    },
    feePp,
    fundingApr,
    fundingWindowDays,
    requiredFundingApr,
    degenerate,
    state,
    shape,
    authored: authored !== null,
    verb,
    material,
    showBar: state === "priced" && shape === "model", // never degenerate: see the verb note
    tipEligible: state === "priced" && shape === "model" && material,
    rows,
  };
}

/**
 * The ledger, reconciled.
 *
 * ROUNDING PLUG INTO ESCROW. Print `total`, `funding` and `drag` at their
 * true rounded values, then DERIVE `escrow = printedTotal − printedFunding −
 * printedDrag`. Escrow is the largest term on every non-degenerate row and
 * its figure appears on no other surface, so the plug can create no
 * cross-surface mismatch. Plugging into `execution` was rejected: it is a
 * modeled constant (exactly −0.1625pp on every model row) and a constant
 * that wobbles by row is a new small lie.
 *
 * Row order is FIXED — funding, escrow, execution, compute fee — never sorted
 * by magnitude. Sorting makes the layout jump between markets and turns "which
 * term wins" into a position cue competing with the weight cue.
 *
 * ── THE TOTAL IS THE PRODUCT FRAME, SO THE FEE IS A ROW (C6, 2026-08-24) ───
 *
 * The `net` row is what the hero prints, and the hero prints the depositor's
 * number. Three venue terms cannot sum to a post-fee total, so the house's own
 * cut of the hedge's contribution takes the fourth row and the column adds
 * again. It is exactly the itemization the docs promise: "gross yield, funding
 * or borrow, slippage, compute fee (negative)".
 *
 * It is emitted only where it rounds to something. A lane whose hedge
 * contributes nothing for the house to take gets three rows, not a row of
 * zeroes, for the same reason `costs 0.0pp` was rejected as a hero.
 */
function buildLedger(a: {
  template: boolean;
  /** The template row carries its own decomposition (FB-1): the column is
   *  the full four-term one, but the f_b annotations are LOOP grammar (the
   *  authored escrow is not `1 − f_b` of anything) and stay off it. */
  authored: boolean;
  escrowPp: number;
  fundingPp: number;
  dragPp: number;
  /** `product.netPp − venue.netPp`, signed. The house's cut of the hedge. */
  feePp: number;
  /** THE PRODUCT-FRAME net. The hero's number, and this column's total. */
  netPp: number;
  fundingApr: number;
  fb: number;
  /** G <= 0: the escrow term is a LOSS AVOIDED, not a return earned. */
  degenerate?: boolean;
}): LedgerRow[] {
  const fundingPrinted = round2(a.fundingPp * 100);
  const netPrinted = round2(a.netPp * 100);
  const FEE_LABEL = "compute fee";
  /* THE PUBLISHED SCHEDULE'S OWN WORDS, READ RATHER THAN RESPELLED. `fees.ts`
     is the single owner of the fee strings and its `Compute fee` row is what
     the review sheet and every record print; taking the value from there is
     what makes this annotation byte-identical to them instead of a fourth
     paraphrase. Empty if that row ever moves — an annotation is optional and
     a stale one is not. */
  const FEE_ANNOTATION = feeRows().find((r) => r.label === "Compute fee")?.value ?? "";

  if (a.template && !a.authored) {
    /* The authored cost IS the hedge, so there is no escrow and no drag: the
       fee is the ONLY thing between the funding leg and the total, and it
       takes the plug so the two printed figures reconcile exactly. */
    const feePlug = round2(netPrinted - fundingPrinted);
    if (Math.abs(feePlug - round2(a.feePp * 100)) > PLUG_TOLERANCE_PP) return [];
    return [
      cell("funding", "funding leg", fundingPrinted, "", "dominant"),
      ...(feePlug === 0 ? [] : [cell("fee", FEE_LABEL, feePlug, "", "muted")]),
      cell("net", "hedge, net", netPrinted, "", "total"),
    ];
  }

  const dragPrinted = round2(a.dragPp * 100);
  const feePrinted = round2(a.feePp * 100);
  const escrowPlug = round2(netPrinted - fundingPrinted - dragPrinted - feePrinted);
  if (Math.abs(escrowPlug - round2(a.escrowPp * 100)) > PLUG_TOLERANCE_PP) return [];

  // The eye should land on WHY, so the largest-magnitude component carries
  // the ink. Compared on TRUE values, not on the plugged display figure.
  const mags: Array<[LedgerRow["key"], number]> = [
    ["funding", Math.abs(a.fundingPp)],
    ["escrow", Math.abs(a.escrowPp)],
    ["execution", Math.abs(a.dragPp)],
    ["fee", Math.abs(a.feePp)],
  ];
  const dominant = mags.reduce((best, x) => (x[1] > best[1] ? x : best))[0];
  const w = (k: LedgerRow["key"]): LedgerRow["emphasis"] => (k === dominant ? "dominant" : "muted");

  return [
    cell(
      "funding",
      "funding leg",
      fundingPrinted,
      a.authored ? "" : `${pct(a.fb, 0)} of ${pct(a.fundingApr)}`,
      w("funding"),
    ),
    /* THE ESCROW ANNOTATION FLIPS WITH THE SIGN OF G.
       Normally the escrow is a cost: capital parked as margin forfeits the
       loop's carry, so `33% of capital` names what is given up. When G <= 0
       the loop's carry is NEGATIVE, so parking capital AVOIDS a loss and the
       term arrives positive. Printing `33% of capital` beside a positive
       figure would read as the escrow earning something, which is the exact
       artifact this row must not celebrate. Same number, honest noun.
       On an AUTHORED row (FB-1) both f_b glosses stay off: the family model's
       escrow forfeits LP carry at its own deployed share, and `1 − a.fb` here
       is the loop accessor's answer, not that share. */
    cell(
      "escrow",
      "margin escrow",
      escrowPlug,
      a.authored
        ? ""
        : a.degenerate
          ? `${pct(1 - a.fb, 0)} of capital, out of a losing loop`
          : `${pct(1 - a.fb, 0)} of capital`,
      w("escrow"),
    ),
    cell("execution", "execution", dragPrinted, "", w("execution")),
    /* THE HOUSE'S OWN CUT. The annotation is the SCHEDULE, byte-identical to
       the `Compute fee` value `fees.feeRows()` prints on the review sheet and
       on every record, so a reader meets one sentence rather than two
       paraphrases of one charge.
       It is NOT `20% of what the hedge adds`, which was written first and is
       false on the case this term exists for: where the two endpoints straddle
       zero only one of them is taxed, and the figure is then 20% of a single
       endpoint rather than 20% of the difference. Measured on the iBERA
       fixture, where the hedge SUBTRACTS 12.58pp of venue yield, this term
       arrives at +2.52pp — the house taking less because the depositor earns
       less — and no "of what the hedge adds" phrasing is true beside it.
       Suppressed at zero: a row of zeroes is not a measurement. */
    ...(feePrinted === 0
      ? []
      : [cell("fee", FEE_LABEL, feePrinted, FEE_ANNOTATION, w("fee"))]),
    cell("net", "hedge, net", netPrinted, "", "total"),
  ];
}

/**
 * Split an already-rounded pp figure into the five-column cells. The sign is
 * U+2212 MINUS, never a hyphen-minus: a hyphen sits short and low and is
 * plainly visible as wrong in a signed column. A space between sign and
 * number belongs on this surface ONLY.
 */
function cell(
  key: LedgerRow["key"],
  label: string,
  valuePp: number,
  annotation: string,
  emphasis: LedgerRow["emphasis"],
): LedgerRow {
  const abs = Math.abs(valuePp);
  const fixed = abs.toFixed(2);
  const dot = fixed.indexOf(".");
  return {
    key,
    label,
    // A rounded −0.00 is a positive zero on screen; it takes the plus.
    sign: valuePp < 0 && abs >= 0.005 ? MINUS : "+",
    int: fixed.slice(0, dot),
    frac: `${fixed.slice(dot)}pp`,
    annotation,
    emphasis,
  };
}

// ── The plate ──────────────────────────────────────────────────────────────

/**
 * The `.hm-val` hero: `costs 7.7pp` | `pays 7.6pp` | `about even` | `—`.
 *
 * The hero is the NET, and its magnitude is CHARACTER-IDENTICAL to the tip
 * title on the same screen — the only structural guarantee that the reported
 * bug (a plate and a tip disagreeing about one hedge) cannot recur there.
 * `25% escrowed` was rejected for this slot: the escrow fraction moves
 * only with the hedge dials, so that slot would print the same twelve
 * characters on every lane and every market at a fixed composition, in a rack where the leverage, the band, the minimum and
 * the pair name all move with the build. The escrow figure lives in the
 * ledger and in the bar's ink length instead.
 *
 * Render as two spans so the digits do not slide sideways when the sign
 * flips: `<i class="hm-verb">costs</i><span class="hm-num">7.7pp</span>`.
 * `hedgeHeroParts` gives you exactly that split.
 */
export function hedgeHero(h: HedgeEconomics | null): string {
  const p = hedgeHeroParts(h);
  return p.verb ? `${p.verb} ${p.value}` : p.value;
}

/**
 * The hero, pre-split for the fixed-width verb cell that kills the wobble.
 *
 * ⚠ PRODUCT FRAME (C6). The hero is the number a builder reads beside the lane
 * header, and the lane header has been the depositor's post-fee number since
 * Wave 1. Printing `venue.netPp` here gave one hedge two numbers on one screen
 * — the founder's original screenshot, in a new frame.
 */
export function hedgeHeroParts(h: HedgeEconomics | null): { verb: string; value: string } {
  if (!h || h.verb === "none") return { verb: "", value: "—" };
  if (h.verb === "even") return { verb: "", value: "about even" };
  // 1 dp, unsigned: the verb carries the sign, so a glyph would say it twice.
  return { verb: h.verb, value: `${(Math.abs(h.product.netPp) * 100).toFixed(1)}pp` };
}

/**
 * The `.hm-sb` sub-line: `funding 8.7% p25 · needs 18.9%`.
 *
 * Register is ACTUAL first, REQUIRED second — here is what you get, here is
 * what you would need — so the gap lands last. `needs`, never `breakeven`,
 * never `requires`, never `f*` or `G/3`; no surface prints a formula.
 *
 * `p25` is welded to the funding number and ABSENT from `needs`, because
 * that threshold is spot-derived. The asymmetry carries the time-base
 * caveat; do not tidy it into symmetry and do not add a sentence explaining
 * it.
 *
 * Budget: `.hm-sb` is 8px mono uppercase at .1em ≈ 5.6px/char inside 216px,
 * so the hard ceiling is 38 characters and the safe budget is 34. The
 * three-digit case (`funding 128% p25 · needs 119%`, 29 chars) is why the
 * line drops to 0 dp at or above 100% — the ONLY adaptive precision in the
 * product, and never inside a column.
 */
export function hedgeSubline(h: HedgeEconomics | null): string {
  if (!h) return DEFAULT_SUBLINE;
  /* DEGENERATE: state the funding, name the negative carry, withhold the
     breakeven. "no loop carry to hedge" was a REFUSAL, and it was refusing on
     the market where the funding leg is the entire product. `needs` is still
     absent because f* is meaningless with nothing to forfeit; what replaces it
     is the fact that explains the whole row. Budget: 8px mono at .1em inside
     216px gives a 34-char safe budget, and "funding 11.0% p25 · loop at a loss"
     is 34. Three-digit funding drops to 0 dp, as elsewhere on this line. */
  if (h.degenerate) {
    const f = Math.abs(h.fundingApr) >= 1 ? pct(h.fundingApr, 0) : pct(h.fundingApr);
    return `funding ${f} p25 · loop at a loss`;
  }
  if (h.state === "unpriced") return DEFAULT_SUBLINE;
  if (h.shape === "template") {
    /* An AUTHORED template hedge (FB-1) states its actual funding, in the
       loop line's own grammar minus the `needs` clause — the hedge is
       structural on this family, so there is no breakeven decision to price.
       `delta-neutral` names the job, as the idle line does. Budget: 32 chars
       at one decimal, 0 dp at or above 100% like the line below. A bare
       template row's `fundingApr` is an all-in COST, not a funding rate, and
       keeps the old provenance line. */
    if (!h.authored) return "modeled hedge cost";
    const f = Math.abs(h.fundingApr) >= 1 ? pct(h.fundingApr, 0) : pct(h.fundingApr);
    return `funding ${f} p25 · delta-neutral`;
  }
  if (h.requiredFundingApr === null) return DEFAULT_SUBLINE;
  const big = Math.abs(h.fundingApr) >= 1 || Math.abs(h.requiredFundingApr) >= 1;
  /* THE WINDOW JOINS THE PERCENTILE (C-H6, 2026-08-24): `funding 10.9% p25
     over 30d · needs 0.3%`. It comes only from the row's own
     `fundingWindowDays` — the register's noun, the same field the catalog
     card and the published record read — so the three surfaces publish ONE
     window per book. Field absent → the string is byte-identical to before;
     nothing is invented. The window costs 9 characters against the line's
     38-character hard ceiling, so where it would overflow the line drops to
     0 dp — the SAME adaptive-precision rule this line already carries for
     three-digit rates, extended to the one other case that breaks the budget. */
  const w = h.fundingWindowDays;
  const req = h.requiredFundingApr;
  const line = (dp: number) =>
    `funding ${pct(h.fundingApr, dp)} p25${w !== null ? ` over ${w}d` : ""} · needs ${pct(req, dp)}`;
  const out = line(big ? 0 : 1);
  return w !== null && out.length > 38 ? line(0) : out;
}

/**
 * The idle / no-quote / unpriced sub-line. The module is armed and is
 * removing delta; nothing about the hedge failed, so the badge stays
 * `neutral` and the line describes the JOB rather than a missing number.
 */
export const DEFAULT_SUBLINE = "delta-neutral · margin auto-managed";

/**
 * THE PLATE'S ESCROW CAPTION — the fraction of deposit the hedge holds out of
 * the loop, which is the quantity the hero's magnitude is mostly made of
 * (`escrowPp = −(1−f_b)·G`).
 *
 * It printed `25% of deposit held as margin` on every hedged lane forever: the
 * row's implied ratio off a server candidate priced at the scan's flat `F_B`,
 * while the ledger beside it said `33% of capital` at the lane's dials. Now it
 * reads the lane's composition and names BOTH dials that make it: at
 * (L_h 3, r 0.15) the escrow is 32.6% of deposit — 22.5% as the short's margin
 * plus 10.1% as the reserve held against it — and `33% of deposit in margin +
 * reserve` is what the founder sees. The reserve clause drops when the reserve
 * dial is off. Without a composition (no lane, only a row) the caption says
 * only what it can prove: the fraction, held out of the loop.
 *
 * Not the short's own margin ratio (`1/L_h`, the register's `shortMargin`
 * axis, 33.3% at L_h 3): that is margin over the short's NOTIONAL; this is
 * escrow over DEPOSIT. They collide at two decimals on the shipped dials and
 * are different facts, which is why this line says `of deposit`.
 *
 * Null where the plate has nothing to caption: a template row, an unpriced or
 * degenerate one (a degenerate row says nothing about the hedge in either
 * direction), or an escrow of zero.
 */
export function hedgeEscrowCaption(h: HedgeEconomics | null): string | null {
  if (!h || h.shape !== "model" || h.state !== "priced" || !(h.escrowFraction > 0)) return null;
  const share = pct(h.escrowFraction, 0);
  if (!h.escrowSplit) return `${share} of deposit held out of the loop`;
  return h.escrowSplit.reserve >= 0.005
    ? `${share} of deposit in margin + reserve`
    : `${share} of deposit as margin`;
}

/**
 * The muted line a degenerate lane gets in the module panel, under the
 * caption and instead of the ledger. `borrow costs more than collateral
 * earns` was rejected at 39 characters: it overflows the sub-line budget,
 * and `earns` is banned from the hedge branch outright.
 */
export const DEGENERATE_NOTE = "borrow exceeds collateral yield";

/**
 * The panel caption. Gross carry is a CAPTION, not a ledger row: a reader
 * adding it into the column gets 59.0%, not −7.68. It is also a rate among
 * pp deltas. Left-aligned above the block, welded to its leverage, muted
 * mono, no value in the number column.
 *
 * This is the only surface in the product permitted to print G, precisely
 * because it appears here as the EXPLANATION OF A COST rather than as a
 * headline yield. Do not introduce "gross carry" as a headline noun
 * anywhere.
 */
export function hedgeCaption(h: HedgeEconomics | null): { label: string; value: string } | null {
  if (!h || h.shape === "template") return null;
  return { label: "gross loop carry", value: `${pct(h.grossCarry)} at ${lev(h.leverage)}` };
}

// ── The balance bar ────────────────────────────────────────────────────────

/**
 * Geometry for the balance bar that replaces the pinned green dot (a glow
 * where the law says hairline, in a colour with no semantic content, on an
 * instrument that has never moved because `bands.margin` is always null).
 *
 * Cost grows LEFT from centre, revenue grows RIGHT, both the same neutral
 * ink at the same height. Colour is not the discriminator; side of zero is —
 * left-is-cost needs no legend, survives greyscale and survives
 * colour-vision deficiency. The tick is the plate's ENTIRE blue budget, and
 * it is genuine punctuation; a 60px blue funding segment would quietly make
 * blue mean "good".
 *
 * Both sides normalise by max(|cost|,|rev|) so the longer one always reaches
 * an end, and each term's own sign picks its side, so negative funding draws
 * to the LEFT and the reading still works.
 *
 * All three numbers are percentages of the bar's full width, ready for
 * `width:` / `left:` — the caller does no arithmetic.
 */
export function hedgeBar(
  h: HedgeEconomics | null,
): { costPct: number; revPct: number; tickPct: number } | null {
  if (!h || !h.showBar) return null;
  /* ⚠ THE FEE IS ON THE COST SIDE, AND THAT IS WHAT MAKES THE TICK LEGAL (C6).
     The tick sits at the NET, the hero prints the net, and the hero is the
     product frame — so the bar's two segments must sum to the product net or
     the tick lands somewhere the segments do not explain. `feePp` is the term
     that closes that gap: it is the house's cut of the hedge's contribution, a
     charge the depositor pays, so it grows the cost segment. Where it arrives
     positive (the endpoints straddle zero and the alternative is taxed harder)
     it shortens the cost segment instead, which is the same arithmetic and
     still reconciles. */
  const cost = h.venue.escrowPp + h.venue.dragPp + h.feePp;
  const rev = h.venue.fundingPp;
  const max = Math.max(Math.abs(cost), Math.abs(rev));
  if (!(max > 0)) return null;
  const span = 40;
  return {
    costPct: (Math.abs(cost) / max) * span,
    revPct: (Math.abs(rev) / max) * span,
    tickPct: clamp(50 + (h.product.netPp / max) * span, 8, 92),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ── The prose ──────────────────────────────────────────────────────────────

/**
 * Fraction words from `1 − f_b`. DERIVED, never hardcoded: the escrow
 * fraction is a function of the hedge dials since A2, so a literal "A
 * quarter" would be false at the shipped composition (1 − 0.6742 = 32.6%).
 *
 * When the fraction lands within half a point of a word English actually
 * has, the word wins — that music is the reason the sentence is in Fraunces
 * italic. When it does not, the gloss states the percentage rather than
 * rounding to a nearby word: "about a third" of a depositor's capital is a
 * three-point lie about where their money is, and this is the one sentence
 * in the product whose whole job is to be exact about that.
 */
function fractionWord(f: number): string {
  const table: Array<[number, string]> = [
    [0.5, "Half"],
    [1 / 3, "A third"],
    [0.3, "Three tenths"],
    [0.25, "A quarter"],
    [0.2, "A fifth"],
    [1 / 6, "A sixth"],
    [0.1, "A tenth"],
  ];
  for (const [v, word] of table) if (Math.abs(f - v) < 5e-3) return word;
  return pct(f, 0);
}

/**
 * The Fraunces italic gloss — the only italic on the panel, and the only
 * sentence in the product containing the word *instead*. It names the
 * counterfactual the whole decomposition rests on and states the diagnosis
 * (capital efficiency, not the funding leg) in one clause.
 *
 * Present ONLY when escrow is the dominant term. The capital fraction and
 * the breakeven multiplier are the two faces of (1−f_b)/f_b; naming the
 * fraction here is what makes the multiplier non-arbitrary, which is why no
 * third line states the multiplier as a formula. No surface prints one.
 */
export function hedgeGloss(h: HedgeEconomics | null): string | null {
  if (!h || h.shape !== "model" || h.state !== "priced") return null;
  if (!h.rows.some((r) => r.key === "escrow" && r.emphasis === "dominant")) return null;
  const word = fractionWord(h.escrowFraction);
  return `${word} of your capital sits as margin instead of earning the loop's ${pct(h.grossCarry)} carry.`;
}

/**
 * The rule sentence: `Pays above 18.9% funding. This market prints 8.7%.`
 *
 * Rendered in Hanken 500 with the two numbers as inline mono tokens, reusing
 * `.rk-tip-b` + `.rk-tip-n` verbatim, so the panel and the tip are not
 * merely word-identical but PIXEL-identical. Use `hedgeSentenceParts` to get
 * that split; this returns the flat string for anywhere that cannot host
 * spans (aria-label, copy, tests).
 *
 * Empty when there is no breakeven to state (degenerate, template, unpriced)
 * — a caller renders nothing rather than a clause with a hole in it.
 */
export function hedgeSentence(h: HedgeEconomics | null): string {
  return hedgeSentenceParts(h)
    .map((s) => s.text)
    .join("");
}

export interface Segment {
  text: string;
  /** True = a `.rk-tip-n` mono numeral token. */
  mono: boolean;
}

export function hedgeSentenceParts(h: HedgeEconomics | null): Segment[] {
  const s = ruleClauses(h);
  return s ? [...s.magnitude, ...s.teaching] : [];
}

/**
 * The rule sentence, pre-split at its own clause boundary so the tip
 * formatter can drop the teaching half without re-authoring the copy.
 */
function ruleClauses(h: HedgeEconomics | null): { magnitude: Segment[]; teaching: Segment[] } | null {
  if (!h || h.requiredFundingApr === null || h.state !== "priced") return null;
  return {
    magnitude: [
      { text: "Pays above ", mono: false },
      { text: pct(h.requiredFundingApr), mono: true },
      { text: " funding.", mono: false },
    ],
    teaching: [
      { text: " This market prints ", mono: false },
      { text: pct(h.fundingApr), mono: true },
      { text: ".", mono: false },
    ],
  };
}

/**
 * The tip body, in DEGRADATION ORDER: disclosure, then magnitude, then
 * teaching. Whatever sits last is what a long pair name eats first, so the
 * order of the clauses IS the priority — encoded, not left in a comment.
 *
 * `.rk-tip` is 296px with 15px padding, body 11.5px Hanken clamped to two
 * lines that CLIP SILENTLY. Mono runs are `.92em` and therefore wider per
 * character than the surrounding sans, so adding a number costs more than
 * adding a word: sans ≈ 5.75px, mono ≈ 6.35px, two lines = 532px, safe
 * budget 505px. Above a 5-character symbol the trailing teaching clause
 * drops; the disclosure NEVER does.
 *
 * `Ejecting leaves` / `Adding takes`, not `Ejecting it leaves` — the `it `
 * costs 17px, which pushes the three-digit-funding case to 507px, and the
 * two directions read as parallel gerunds without it. `you`, not `the lane`:
 * the 1.0x exposure is the builder's, and the possessive is the point.
 */
export function hedgeTipBody(
  h: HedgeEconomics | null,
  hasHedge: boolean,
  collateralSymbol: string,
): Segment[] {
  if (!h || h.state !== "priced") return [];
  const rule = ruleClauses(h);
  if (!rule) return [];
  const sym = underlyingOf(collateralSymbol);
  const disclosure: Segment[] = hasHedge
    ? [
        { text: "Ejecting leaves you ", mono: false },
        { text: NET_EXPOSURE, mono: true },
        { text: ` long ${sym}. `, mono: false },
      ]
    : [{ text: "Adding takes the lane neutral. ", mono: false }];
  // Degradation order, executed: the teaching clause is the only thing a
  // long symbol may cost the reader. The disclosure and the magnitude stay.
  return sym.length <= 5
    ? [...disclosure, ...rule.magnitude, ...rule.teaching]
    : [...disclosure, ...rule.magnitude];
}

/**
 * Net underlying delta per deposit dollar on a class-A lane: L − (L−1) =
 * exactly 1.0, independent of leverage. A constant, not a computation,
 * because class A is same-underlying by construction (`UNDERLYING_MAP` plus
 * the `same_underlying` gate).
 */
export const NET_EXPOSURE = "1.0x";

/** The underlying a collateral symbol resolves to, for exposure copy. */
function underlyingOf(symbol: string): string {
  return UNDERLYING_MAP[symbol] ?? symbol;
}

// ── The key, and its arrow ─────────────────────────────────────────────────

/**
 * The counterfactual's two endpoints, always in press order: where the lane
 * is now, and where the key would put it. Both are RATES, so both print with
 * `pct()` and a `%`; only the plate hero and the ledger speak in `pp`.
 *
 * `<HedgeArrow>` renders as a CHILD of the key, never a sibling — that makes
 * "a net delta is legal only welded to the control that causes it" a fact
 * about the component tree rather than a rule someone has to remember. The
 * net is banned at hero weight in the lane header, the Review card, the
 * Compose panel and the published asset page.
 */
export function hedgeArrow(
  h: HedgeEconomics | null,
  hasHedge: boolean,
): { from: number; to: number } | null {
  if (!h || h.state === "degenerate") return null;
  /* ⚠ PRODUCT FRAME (C6). Both endpoints are where the LANE HEADER will read
     before and after the press, so they are the depositor's numbers or they
     are a promise the header does not keep. This is also why the fee is not
     applied at the call site any more: `RackCanvas.composedPair` and
     `ComposePanel`'s eject announcement each spelled `applyComputeFee` on
     these two fields, which was two more owners of R1's ordering and neither
     of them carried the compound step. */
  const p = h.product;
  return hasHedge
    ? { from: p.withApy, to: p.withoutApy }
    : { from: p.withoutApy, to: p.withApy };
}

/** The arrow as one mono run: `48.1% → 55.8%`. U+2192, ordinary spaces. */
export function hedgeArrowText(h: HedgeEconomics | null, hasHedge: boolean): string | null {
  const a = hedgeArrow(h, hasHedge);
  return a ? `${pct(a.from)} ${ARROW} ${pct(a.to)}` : null;
}

/**
 * The two-line eject key.
 *
 * A one-click key that quotes a yield gain and says nothing about what is
 * sold to get it is an unpriced risk transfer sold as a yield gain. The
 * exposure goes in the same breath as the gain, at annotation weight, with
 * no warning word. This is also why the panel does NOT carry
 * `Without it the loop is 1.0x long BERA` as prose: it is a consequence of
 * pressing a key, so it belongs on the key.
 *
 * Title authored sentence-case; `.pc-eject--hedge` uppercases in CSS, the
 * same discipline as `.hm-sb`. The exposure clause is model-only: on a
 * hand-authored template row the leverage identity that makes 1.0x a
 * constant does not apply.
 */
export function hedgeKey(
  h: HedgeEconomics | null,
  hasHedge: boolean,
  collateralSymbol: string,
): { title: string; detail: string } | null {
  const arrow = hedgeArrowText(h, hasHedge);
  if (!h || !arrow) return null;
  const clause = hasHedge
    ? h.shape === "model"
      ? ` · ${NET_EXPOSURE} long ${underlyingOf(collateralSymbol)}`
      : ""
    : " · takes it delta-neutral";
  return {
    title: hasHedge ? "Remove the hedge" : "Add the hedge",
    detail: `${arrow}${clause}`,
  };
}
