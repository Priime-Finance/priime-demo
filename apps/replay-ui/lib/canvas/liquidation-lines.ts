/**
 * THE LIQUIDATION VERDICT, WHOLE.
 *
 * ══ THE RULING THIS IMPLEMENTS ═════════════════════════════════════════════
 *
 * "Is this liquidation-free" has a provable answer, because a liquidation line
 * is a STRUCTURAL property of a position and not a probabilistic one. A borrow
 * leg exists iff the lane borrows. A perp short exists iff the hedge is
 * installed. No model, no distribution, no scan freshness — the graph answers
 * it, exactly, every time.
 *
 * So the product owes the verdict. And the half that is easy to miss:
 *
 *   > A CLASS-A VAULT HOLDS TWO LIQUIDATABLE POSITIONS.
 *
 * The lending leg, AND the Hyperliquid short at `hedgeLeverage`. The default
 * machine on most live rows is `source + hedge + compound` at L = 1: no
 * borrow, no health factor, no lending liquidation line — and a perp short. A
 * surface printing "no liquidation" there would be making a FALSE CLAIM in the
 * loudest place on the page, on the composition we recommend most often.
 *
 * Hence the shape of this file. `liquidationLinesOfLane()` counts the legs —
 * ONE derivation, from the lane's placed modules, its PRICED leverage and its
 * market. The rendered verdict is composed from ONE CLAIM PER LEG, and a verdict naming fewer legs than the array holds cannot be built:
 * `liquidationVerdict` returns null instead, and a surface that cannot prove
 * its arithmetic prints nothing.
 *
 * ══ THE COLLISION HAZARD, CLOSED BY DELETION ═══════════════════════════════
 *
 * At the shipped hedge composition (`L_h` 3, `r` 0.15) two DIFFERENT
 * quantities both round to `33%`:
 *
 *   • the escrow, `1 − f_b` = 32.58%, margin AND reserve as a fraction of
 *     THE DEPOSIT — the frame a depositor is standing in;
 *   • the short's margin ratio, `1/L_h` = 33.3%, margin as a fraction of THE
 *     SHORT'S OWN NOTIONAL — the frame the venue's ladder is stated in.
 *
 * They move differently (the escrow carries the reserve, the ratio does not)
 * and they answer different questions. For a while both printed HERE, held
 * apart by a rounding difference and by careful naming. Then only the escrow
 * did. As of the second ruling of 2026-09-02, NEITHER DOES: both are risk
 * table rows — `escrow` at `of the deposit, as margin and reserve` and
 * `short-margin` at `of the short's own notional` — each with a denominator
 * column doing the work a word smuggled into a label used to do, and each with
 * an as-of this file has never held. Two quantities that can collide cannot
 * collide across two blocks when NEITHER of them is printed twice.
 *
 * ══ THREE DELIBERATE DEVIATIONS FROM THE DRAFTED COPY ══════════════════════
 *
 * Each one is a correctness fix, recorded so it is not "restored".
 *
 *  1 · "holds 33% of the deposit as margin" → RETIRED WHOLE. The first fix
 *      was the words: `1 − f_b` is margin (22.47% of deposit) PLUS the idle
 *      reserve (10.11%), so calling all of it margin decomposed a true total
 *      into a false part, and it became "as margin and reserve". The second
 *      fix retired the clause: with its figure gone to the `escrow` row, what
 *      was left was that row's own sentence minus its number. See the
 *      collision note above and `SHORT_CLAIM` below.
 *
 *  2 · "No liquidation line on the lending leg" → "on the deposit".
 *      Three families reach this string and two of them (dn-LP, collar) have
 *      no lending leg at all, so "the lending leg" would assert a leg that
 *      does not exist in order to say it is empty. "On the deposit" is true
 *      on all three and reads identically on the loop.
 *
 *  3 · "We trim at 19%" → "We trim 3.65pp before that" → RETIRED WHOLE with
 *      the headline that carried it (see the figure ruling below). Both
 *      corrections were right while the sentence existed: the trim fires at a
 *      SMALL pair move, and `pct(drift, 0)` printed `We trim at 0%.` on 18 of
 *      the 467 fixture lane blocks. The quantity kept every other owner it had
 *      — `RiskStops`'s caption, the register's trim trigger, the vault's
 *      `deleverageDriftLine` and the table's `trim-fires` row, all at
 *      `ppMag(d, 2)` — and this block simply stopped being one of them.
 *
 * ══ ⚠ THE BLOCK CARRIES NO FIGURE AT ALL (G7 re-review #4, 2026-09-02) ═════
 *
 * The short CLAIM was made figure-free one ruling ago and the HEADLINE ABOVE
 * IT WAS NOT, so the same defect went on shipping one line higher. Measured on
 * the rendered card, khype-boost-loop at 1440, by line:
 *
 *    2  This liquidates if kHYPE loses 24% against WHYPE. We trim 4.24pp
 *       before that.
 *    6  Three things could reach 24% before the trim does.
 *   18  Deposit liquidation line · 24% · adverse kHYPE/WHYPE move
 *   24  Trim fires · 4.24pp · of that move, before the line
 *
 * 24% three times and 4.24pp twice, sixteen lines apart, in ONE screenshot.
 * steady-eth-loop is the same card at 29% and 3.65pp. And `depositLineRow`'s
 * own docblock says what happened: that row was authored to REPLACE "an
 * unlabelled headline sentence that could not be compared with the next
 * vault's", and the sentence it replaced was never retired when it landed.
 *
 * SO THE SEAM IS STRUCTURAL NOW RATHER THAN CAREFUL. The block states WHICH
 * LEGS CAN BE CLOSED and states nothing else: ONE FIGURE-FREE CLAIM PER LEG,
 * in the capital order the legs are counted in. The level, the trim and the
 * cushion live in the table rows — `deposit-line`, `trim-fires` — each with a
 * denominator column and an as-of stamp a sentence cannot carry. A block that
 * cannot reach a formatter cannot re-grow a second printing of a row.
 *
 * THREE THINGS WENT WITH THE FIGURE, each named so it is not restored:
 *
 *  · THE BRIDGE. `Three things could reach 24% before the trim does.` was the
 *    THIRD printing of the cushion, and its count named a total no column on
 *    the screen marks — the sections are Forced exits / Exit / Principal /
 *    Yield, and nothing says which three rows it counts. The verdict still
 *    hands the reader to the register: it sits directly above it on both
 *    surfaces, pinned by the wiring gate, so it does that by ADJACENCY rather
 *    than by reprinting a number. `VerdictContext` went with it — there is no
 *    second argument any more, so no count and no drift can be handed in.
 *  · THE `cushion` / `drift` DERIVATION, dead weight the moment the sentence
 *    stopped printing them, exactly the way `escrowShare`, `lev` and `pct`
 *    already went. `borrowClaim` was a function reading four fields to build
 *    one constant; it is `BORROW_CLAIM`.
 *  · THE NO-BORROW SENTENCE. `No borrow. No liquidation line on the deposit.`
 *    was the `short-only` headline, and it sat five lines above `Borrow ·
 *    none · the deposit carries no debt` and `Deposit liquidation line ·
 *    none · no borrow leg to liquidate`. One absence, FOUR statements, one
 *    screen — verbatim the defect the previous ruling closed on the `none`
 *    key, surviving here only because this family keys `short-only`. An
 *    absence is stated ONCE, and the two rows state it with denominators. So
 *    the block claims the leg it HOLDS and says nothing about the leg it does
 *    not: on `short-only` the whole block IS the short claim.
 *
 * ⚠ AND THE GUARD WENT TOO, WHICH IS A REVERSAL. `borrowClaim` returned null
 * wherever `liquidationDistance` could not answer, and a null claim nulled the
 * WHOLE verdict — deleting the short's claim with it — because "a partial
 * verdict is the defect". That was right while the claim quoted a number: a
 * claim that cannot state its level had nothing left to say. A figure-free
 * claim has nothing to fail at. Leg existence is STRUCTURAL (the first
 * paragraph of this file), so a held leg is claimable on every lane, always,
 * and the block no longer blanks on a market whose threshold the record does
 * not publish. `deposit-line` says that, in the column, in the row's own
 * words.
 *
 * ══ WHAT THIS FILE IS NOT ══════════════════════════════════════════════════
 *
 * It is not the risk register. The register enumerates what DEFEATS the
 * reaction; this states which legs can be closed. It states no level, no move
 * and no count, so there is no number for the two files to disagree about and
 * no argument by which one could be handed the other's.
 */

/* NO FORMATTER AND NO DISTANCE FUNCTION ANY MORE — no `escrowShare`, `lev` or
   `pct` (they fed the short claim's opening figure), and as of re-review #4 no
   `ppMag`, `adverseMoveValue`, `driftBeforeTrim` or `liquidationDistance`
   either (they fed the headline's level and trim, and the bridge's third
   printing of the cushion). All of those quantities are table rows — `escrow`,
   `short-margin`, `deposit-line`, `trim-fires` — each with its own denominator
   and as-of. A file that cannot reach a formatter cannot re-grow a second
   printing of a row. `shortLegBands` survives as a GUARD and prints nothing:
   see the note at its call site. */
import { shortLegBands } from "./liquidation";
import { PRODUCT_MIN_LEVERAGE } from "./param-schema";
import type { AxisLane } from "./axes";
import type { ProjectedCandidate } from "./opportunities";
import type { ModuleKey } from "./types";

const finite = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

// ── The legs ──────────────────────────────────────────────────────────────

/** The two positions in this product that a third party can close. There is
 *  no third member, and adding one is a protocol change, not a copy change. */
export type LiquidationLegKind = "borrow" | "short";

export interface LiquidationLine {
  kind: LiquidationLegKind;
  /** How the leg is named to a reader. The verdict must contain it. */
  label: string;
}

const LEG_LABEL: Record<LiquidationLegKind, string> = {
  borrow: "the lending leg",
  short: "the perp short",
};

/**
 * THE COUNT. `borrow` iff the lane actually borrows; `short` iff the hedge is
 * installed. Ascending by capital order (the borrow is upstream of the hedge),
 * which is also the order the verdict names them in.
 *
 * BORROW EXISTENCE IS TWO CONDITIONS, NOT ONE. The leverage module must be
 * PLACED and its leverage must exceed `PRODUCT_MIN_LEVERAGE`. Both halves earn
 * their keep:
 *
 *  · `L > 1` alone is not enough, because a lane that never placed the module
 *    has no stored leverage and the descriptor default would answer for it.
 *    That is the phantom `?? 3` in a new coat: on a dn-LP or collar lane,
 *    which cannot hold a `safety-buffer` at all, it would invent a borrow leg
 *    and then invent a liquidation line for it.
 *  · placement alone is not enough, because `PRODUCT_MIN_LEVERAGE = 1` is a
 *    REACHABLE dial position. A lane holding the module at L = 1 borrows
 *    nothing, `hfTargetBpsFor` returns the cap, and `liquidationDistance`
 *    answers `unlevered`. There is no line to state.
 */
/**
 * THE MARKET'S HALF OF THE BORROW LEG (2026-08-23).
 *
 * A borrow leg needs somewhere to borrow. `lt` is the liquidation threshold
 * the venue publishes for the pair, and `opportunities.ts` `borrowsNothing()`
 * nulls it on a row with no debt ("a spot-class row has no debt, so it has no
 * liquidation threshold at all"), which makes `lt === null` the row's own
 * statement that there is no lending leg to close.
 *
 * ⚠ THIS CLAUSE CARRIES MORE WEIGHT SINCE THE CLAIM WENT FIGURE-FREE
 * (re-review #4). It used to be belt-and-braces: the claim quoted the pair's
 * liquidation distance, `liquidationDistance` answered null at EVERY leverage
 * on a zero-debt row, so a leg counted here without this clause blanked the
 * whole block instead of claiming anything. There is no arithmetic left to
 * fail: a counted borrow leg is now claimed unconditionally, in words. So
 * this read is the ONLY thing standing between a zero-debt funding row and
 * the sentence `The lending leg can be closed against you.` printed over a
 * position that has no lending leg at all.
 *
 * NULL CANDIDATE KEEPS THE PRIOR ANSWER. A lane with no market pinned has not
 * been told anything about a debt market, and absence of data is not evidence
 * of absence of a leg — the same three-valued discipline `leverageModuleVerdict`
 * keeps for `unknown`. Such a lane holds whatever legs its modules hold and is
 * claimed for them; nothing about the market is asserted either way.
 */
function marketCanBorrow(c: ProjectedCandidate | null | undefined): boolean {
  if (!c) return true;
  return finite(c.lt) && c.lt > 0;
}

function linesFrom(
  placed: readonly ModuleKey[],
  leverage: number | null | undefined,
  candidate: ProjectedCandidate | null | undefined,
): LiquidationLine[] {
  const out: LiquidationLine[] = [];
  if (
    placed.includes("safety-buffer") &&
    finite(leverage) &&
    leverage > PRODUCT_MIN_LEVERAGE &&
    marketCanBorrow(candidate)
  ) {
    out.push({ kind: "borrow", label: LEG_LABEL.borrow });
  }
  if (placed.includes("hedge")) out.push({ kind: "short", label: LEG_LABEL.short });
  return out;
}

/**
 * THE ONE ENTRY. There is no second one.
 *
 * A priced lane holds `appliedLeverage`, which is the leverage the MODEL
 * landed on after `repriceAtLeverage` capped the dial at the scan's own L0.
 * That is the leverage every number on the surface is quoted at, so it is the
 * leverage the legs must be counted at: a borrow leg claimed at a leverage
 * nothing priced is a leg on a different lane.
 *
 * ── WHAT USED TO SIT BESIDE THIS, AND WHY IT IS GONE (2026-08-23) ─────────
 * `liquidationLines(loop)` read the STORED dial off the graph and answered
 * without the market. It was called from no production file — only from its
 * own test, which existed to check it against this one. On the funding venue
 * the two disagreed:
 *
 *   hyperliquid-funding:999:khype:HYPE   graph ["borrow","short"]
 *                                        lane  ["short"]
 *
 * on a row with `lt: null` and `borrowApyMarginal: 0`, i.e. a position that
 * cannot be liquidated on a lending leg it does not have. Two derivations of
 * the most dangerous number on the card, disagreeing, one of them unreachable
 * from the product. So the count keeps ONE owner, and it is the one that holds
 * both the priced leverage and the market.
 *
 * The docblock that licensed the second entry said "Nothing about the market
 * enters, because leg EXISTENCE is not a property of the market." On a row
 * with no debt market, leg existence is EXACTLY a property of the market. That
 * sentence is retired with the function it justified.
 */
export function liquidationLinesOfLane(lane: AxisLane): LiquidationLine[] {
  return linesFrom(lane.placed, lane.appliedLeverage, lane.candidate);
}

// ── The verdict ───────────────────────────────────────────────────────────

/** The four states of the leg array. The rendered verdict is keyed on this
 *  and on nothing else — no market, no venue, no family branch. */
export type LiquidationVerdictKey = "none" | "short-only" | "borrow-only" | "borrow-and-short";

export function verdictKey(lines: readonly LiquidationLine[]): LiquidationVerdictKey {
  const b = lines.some((l) => l.kind === "borrow");
  const s = lines.some((l) => l.kind === "short");
  if (b && s) return "borrow-and-short";
  if (b) return "borrow-only";
  if (s) return "short-only";
  return "none";
}

/** One leg, claimed in words, with the leg it speaks for attached. The set of
 *  `leg` values here IS the set of legs the verdict names. */
export interface LegClaim {
  leg: LiquidationLegKind;
  text: string;
}

/**
 * ⚠ THERE IS NO `rows` FIELD, AND THAT IS THE RULING OF 2026-09-02.
 *
 * This block used to carry two `VerdictRow`s — `Short margin ratio` and
 * `Short's own liquidation` — and the risk table carries the same two facts
 * as `short-margin` and `short-line`, each with its own denominator, its own
 * field path and its own as-of. Two printings of one number is bad. The two
 * printings DISAGREEING is what made it blocking:
 *
 *   khype-boost-loop   verdict `Short's own liquidation · not measured`
 *                      table   `Short's own liquidation · +41% · adverse HYPE move`
 *   steady-eth-loop    verdict `not measured` · table `+45%`
 *
 * The table derives the coin's maintenance margin from the record's published
 * margin ladder (`lib/vaults/risk-table.ts`, `published.marginTrimBelowPct` /
 * `marginRestorePct`); this file never receives that ladder, so it answered
 * `not measured` about a quantity the same page had already measured eight
 * rows below. A depositor reading top-down learned the short has no measured
 * liquidation line and then read that it is +41%.
 *
 * So the verdict states WHICH LEGS CAN BE CLOSED, in words, and the table
 * states AT WHAT LEVEL, with the denominator and the as-of. One reading, one
 * owner. The invariant is enforced by
 * `lib/canvas/__tests__/liquidation-verdict-wiring.test.ts`, which now asserts
 * the stronger thing: this block prints no liquidation reading at all, and the
 * table's `short-line` row carries the derived value.
 */
export interface LiquidationVerdict {
  key: LiquidationVerdictKey;
  /** The loud line: the FIRST leg's claim, in capital order. It carries no
   *  figure, and re-review #4 is the ruling that took the last one out. */
  headline: string;
  /** The second line: the second leg's claim, or null where the position
   *  holds one leg. Never an absence, never an explanation. */
  note: string | null;
  /** Exactly one entry per leg the graph holds. Never fewer, and — since the
   *  block is composed FROM this array — never a claim without a leg. */
  claims: LegClaim[];
}

/* ⚠ THERE IS NO `VerdictContext` AND NO SECOND ARGUMENT (re-review #4).
   It carried `reactionEntryCount` for the bridge and `trimDrift` for the
   headline's trim clause, and both sentences are retired. A block whose only
   input is the lane cannot be handed a number to print, which is the same
   discipline as dropping the formatter imports: the invariant is enforced by
   the signature rather than by review. */

/**
 * The borrow leg, claimed. ONE SENTENCE, NO FIGURE, NO BRANCH — the same
 * shape as `SHORT_CLAIM` below, and now for the same reason.
 *
 * ⚠ THIS WAS A FUNCTION AND IT IS A CONSTANT (re-review #4, 2026-09-02). It
 * read `This liquidates if kHYPE loses 24% against WHYPE. We trim 4.24pp
 * before that.` — and sixteen lines below it the table read `Deposit
 * liquidation line · 24% · adverse kHYPE/WHYPE move` and `Trim fires ·
 * 4.24pp · of that move, before the line`. Two quantities, each printed
 * twice, on one screen. The rows carry a denominator column and an as-of
 * stamp; the sentence carried neither, and `depositLineRow` was authored to
 * replace it. So the level and the trim have ONE owner, and it is the table.
 *
 * WHAT IS LEFT IS WHAT THE TABLE CANNOT SAY: that a third party can close
 * this leg. Eight words, on the loudest line of the block. The noun is
 * `LEG_LABEL.borrow` verbatim, so the claim and the leg cannot drift apart
 * and the naming gate can read the label off the leg it is checking.
 *
 * ⚠ AND IT NO LONGER GUARDS. The old function returned null wherever the pair
 * or `liquidationDistance` was unstatable, and that nulled the whole verdict
 * including the short's claim. A sentence with no figure has nothing to fail
 * at, and leg existence is structural, so a held borrow leg is claimed on
 * every lane. Where the level is unknown the TABLE says so, in the row, with
 * its own words (`the venue threshold is not published on this record`).
 */
const BORROW_CLAIM = "The lending leg can be closed against you.";

/**
 * The short leg, claimed. ONE SENTENCE, NO FIGURE, NO BRANCH.
 *
 * ⚠ THE CLOSING CLAUSE IS UNCONDITIONAL, AND NEVER A MOVE (ruling 2026-09-02).
 * It used to gain a second half — `That leg closes on a 41% move in HYPE.` —
 * wherever `bands.liqMove` was finite. That is the short's own liquidation, in
 * prose, one screen above the `short-line` row that states the same figure
 * with its denominator and its as-of. A second printing in a sentence is still
 * a second printing, and it is the one shape a row-level gate cannot see.
 *
 * ⚠ AND NEITHER IS THE OPENING A FIGURE ANY MORE (G7 major, 2026-09-02, the
 * same ruling applied to the third row of the same collision). The claim used
 * to open in one of two ways, and each one was a second printing of a table
 * row eight lines below it:
 *
 *   khype-boost-loop   claim `holds 33% of the deposit as margin and reserve`
 *                      table `Deposit held as perp margin · 32.6% ·
 *                             of the deposit, as margin and reserve`
 *   aerodrome…keeper   claim `runs at 3.00x on its own margin`
 *                      table `Short margin · 33.3% · of the short's own notional`
 *
 * The first pair is one quantity at two precisions — the escrow row moved to
 * 1 dp precisely because "two precisions of one number adjacent is the
 * reader's problem and not the formatter's", and this 0 dp was never moved
 * with it. The second is one dial in two frames, which a reader has to invert
 * to reconcile. Both are the shape the parent ruling closes: THE TABLE'S
 * NUMBER CARRIES THE DENOMINATOR AND THE AS-OF; THE CLAIM'S JOB IS WHICH LEGS
 * CAN BE CLOSED, and it still does that job without the figure.
 *
 * With the figure gone the branch goes with it. It existed only to pick WHICH
 * number to print (`escrowShare` returns `f_b = 1` on hand-authored family
 * rows, so those fell through to the dial), and two figure-free spellings of
 * one state is the defect one section over.
 *
 * AND THE PROSE AROUND THE FIGURE GOES TOO, for the same reason the figure
 * did. `holds part of the deposit as margin and reserve` is the `escrow` row's
 * own sentence with the number taken out — `Deposit held as perp margin ·
 * 32.6% · of the deposit, as margin and reserve`, four words apart, in the
 * denominator column. Restating a row in words one screen above it is the same
 * defect as restating its number; the only thing this block holds that the
 * table does not is THAT THE LEG CAN BE CLOSED, so that is all it says. Eight
 * words, on the loudest line about the position a depositor cannot see.
 */
const SHORT_CLAIM = "The perp short can be closed against you.";

/**
 * THE VERDICT. Null wherever a leg the graph holds cannot state a number, and
 * null wherever the composed claims name fewer legs than the array holds.
 *
 * The second guard is structurally unreachable from the code below, and it
 * stays: it is the runtime half of the build gate, and it is what makes "a
 * verdict naming fewer legs than the array holds fails" a property of this
 * function rather than a promise about the person editing it next.
 *
 * ══ ⚠ AND NULL ON `none`, WHICH REVERSES A RULING (G7 major, 2026-09-02) ═══
 *
 * `none` is the key with NO borrow leg and NO short leg, and it reached two
 * published records: `stable-yield-router` (unhedged loop) and
 * `dao-treasury-collar`. On both, the whole block was one sentence —
 * `No borrow. No liquidation line on the deposit.` — and five lines below it
 * the table said the same absence twice more, with denominators the sentence
 * does not carry:
 *
 *   Borrow                    · none · the deposit carries no debt
 *   Deposit liquidation line  · none · no borrow leg to liquidate
 *
 * One absence, three statements, one screen, against a copy law that says an
 * absence is stated ONCE. On `stable-yield-router` that sentence was the
 * block's ENTIRE content, so the block carried nothing the table did not, and
 * it was the only prose left on the card.
 *
 * The old ruling here was "a section a reader sees on one composition and not
 * on another teaches that its absence means something, and it does not". The
 * counter-evidence is already in the product: the funding family renders no
 * verdict block at all (`registerInputForVault` returns null on those three
 * records, pinned as a carry-forward in the wiring gate) and its card is the
 * cleanest of the six — because its table's own `The position · one HYPE short
 * on Hyperliquid · the venue can close it whole` row says what can be closed,
 * with a denominator. A block that repeats two rows is not teaching a reader
 * anything by being present.
 *
 * SO: the block renders iff the position holds a leg to claim. Every other key
 * — `borrow-only`, `short-only`, `borrow-and-short` — keeps it, which is what
 * the ratified gate pins, and the suppression lives HERE rather than in the
 * two renderers so both surfaces cannot drift on it.
 *
 * ══ ⚠ AND THE BLOCK IS NOW COMPOSED FROM `claims`, NOTHING ELSE ════════════
 *
 * `headline` and `note` are `claims[0]` and `claims[1]`, in the capital order
 * `linesFrom` counts in (borrow upstream of short). That is not a tidy-up: it
 * is what makes "one figure-free claim per leg AND NOTHING ELSE" a property of
 * the composition rather than a promise. There is no branch that can write a
 * sentence about a leg the position does not hold, so the `short-only` key
 * cannot restate the no-borrow absence the `borrow-leg` and `deposit-line`
 * rows already carry WITH their denominators, and no key can print a level.
 */
export function liquidationVerdict(lane: AxisLane): LiquidationVerdict | null {
  const lines = liquidationLinesOfLane(lane);
  const key = verdictKey(lines);
  if (key === "none") return null;
  const claims: LegClaim[] = [];

  if (lines.some((l) => l.kind === "borrow")) {
    claims.push({ leg: "borrow", text: BORROW_CLAIM });
  }

  if (lines.some((l) => l.kind === "short")) {
    const h = lane.comp?.hedge;
    /* NO `coinMaxLeverage` ARGUMENT ANY MORE. The only two things it fed were
       the retired rows and the retired closing move; the margin ratio and the
       escrow, which is all this block still states, need neither. The coin's
       maintenance margin has one owner now and it is `lib/vaults/risk-table.ts`,
       which derives it from the record's own published margin ladder. */
    /* THE DIAL IS STILL READ, AND IT IS THE LAST GUARD IN THIS FILE. Nothing
       printed here reads it, and after re-review #4 nothing printed here reads
       ANY figure — so this is the one remaining refusal: a lane whose hedge
       carries no leverage and no reserve fraction has not been priced, and
       claiming a perp short on an unpriced hedge would be claiming a position
       the lane has not been shown to hold. Existence, not arithmetic, which is
       the same test `marketCanBorrow` applies to the borrow leg. */
    const bands = shortLegBands(h?.hedgeLeverage, h?.reserveFraction);
    if (!bands) return null;
    claims.push({ leg: "short", text: SHORT_CLAIM });
  }

  const named = new Set(claims.map((c) => c.leg));
  if (lines.some((l) => !named.has(l.kind)) || named.size !== lines.length) return null;
  // Unreachable while every key with a leg pushes a claim, and it stays for
  // the same reason the naming guard above it does.
  if (claims.length === 0) return null;

  return { key, headline: claims[0].text, note: claims[1]?.text ?? null, claims };
}

/** Everything the verdict says, as one string. The naming gate reads this,
 *  so a leg named only in a field nobody renders does not count as named. */
export function verdictText(v: LiquidationVerdict): string {
  return [v.headline, v.note]
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .join(" ");
}
