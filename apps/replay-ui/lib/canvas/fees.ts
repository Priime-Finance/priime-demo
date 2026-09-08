/**
 * THE HOUSE FEES, AS ONE OWNER (2026-08-24, planner ruling R1).
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
 *
 * The docs promise, verbatim, that the fee is a TERM inside the record:
 *
 *   "Every vault itemizes the economics of a depositor's yield in its record:
 *    gross yield (positive), funding or borrow (positive or negative),
 *    slippage (negative), compute fee (negative)."
 *
 * Before this file the product published a venue-cost-only number under the
 * label "net, after costs" and charged 20% of the yield nowhere on any screen.
 * The alternative fix (relabel every headline "before the 20% compute fee")
 * contradicts the published sentence above, so the fee is applied INSIDE the
 * number and printed as its own term beside it.
 *
 * ── THE IDENTITY, ONE OWNER, EXACT ORDERING (R1) ──────────────────────────
 *
 *     venueNet  = repriceAtLeverage(row, appliedL, comp).economics.netApy
 *     afterFee  = venueNet > 0 ? venueNet * (1 - HOUSE_FEES.computeOnYield) : venueNet
 *     published = afterFee + compoundDelta(afterFee, comp.compound)
 *
 * The ordering is not cosmetic. Compounding the AFTER-fee yield is what a
 * depositor's capital actually does — the house takes its cut at harvest, and
 * only the remainder is re-deposited — so compounding the pre-fee number and
 * charging the fee afterwards would over-state the vault by the compound of a
 * dollar the depositor never held.
 *
 * ── THE BOUNDARY: LANE, NOT MARKET ROW ────────────────────────────────────
 *
 * A Browse-markets row is a VENUE FACT and stays pre-fee: it is the answer to
 * "what does this market pay", a question about Aave and Hyperliquid, not
 * about Priime. A lane, a review sheet, a directory card and a published
 * record are PRODUCT numbers and carry the fee. `mock-quote.ts` names both
 * sides: `venueNetApy()` is the pre-fee accessor for market surfaces,
 * `composedNetApy()` is the published number.
 *
 * ── NO REBATE ON A NEGATIVE LANE ──────────────────────────────────────────
 *
 * The fee is charged on YIELD, at harvest. A lane modeling below zero harvests
 * nothing, so the fee term is zero there and the loss is not softened by a
 * share of itself. That is also what keeps the fee safe to insert into every
 * downstream gate: multiplying a positive by (1 − fee) stays positive, so
 * `review-gating`'s `netApy <= 0` refusal cannot newly trip, and the breakeven
 * leverage of R4 is fee-invariant because (1 − fee) x 0 = 0.
 *
 * ── THE SETTLEMENT FEE IS NOT AN APY ──────────────────────────────────────
 *
 * A settlement fee is a ONE-TIME charge on principal (zero in this demo since
 * the 2026-09-08 ruling; the machinery stays so a schedule that charges one
 * again prints it from the same owner). Amortizing it into an
 * annualized rate would require a holding-period assumption the product does
 * not have and the depositor has not made. It appears in `feeRows()` and in no
 * arithmetic in this codebase. `fee-identity.test.ts` pins that.
 */

import { DEMO_SCOPE } from "@/lib/demo-scope";

/**
 * The house's own schedule, as published on https://priime.finance/docs:
 * "Compute fee: 20% of yield, charged at harvest." and "2% settlement fee on
 * deposits. No management fee on idle capital and no fee on principal at
 * withdrawal."
 *
 * These two numbers are the source of every fee string and every fee term in
 * the product. A surface that spells `0.2` or `0.02` itself is the second
 * owner this file exists to prevent.
 *
 * ⚠ HANDOFF, PO-4 (2026-09-02): the sentence quoted above is the PUBLISHED
 * doc's, and its last clause ("no fee on principal at withdrawal") still
 * advertises an exit this product does not offer. `feeRows()` below no longer
 * prints it; priime.finance/docs is a different repository and still does.
 * That page is the remaining copy of the overclaim.
 */
/* FOUNDER RULING 2026-09-08: in this demo the compute fee is 10% of yield and
   there is NO settlement fee. The published docs on priime.finance still say
   20% and 2%; that site and the data room are out of scope by the same ruling,
   so the demo's schedule is its own and this line is the one place it is set.
   A zero settlement fee removes its row from `feeRows()` and its line from the
   deposit rail rather than printing a `0%` charge. */
export const HOUSE_FEES = { computeOnYield: 0.1, settlementOnDeposit: 0 } as const;

/**
 * THE FEE TERM ITSELF, as an APY fraction and as a POSITIVE MAGNITUDE — the
 * quantity a caption subtracts and a record itemizes.
 *
 * Positive-magnitude rather than signed because every caller that prints it
 * already owns the operator: the derivation caption writes `− compute fee
 * 1.13%` with the U+2212 from `format.ts`, and a signed term would print the
 * glyph twice. Callers that need it signed negate it at the call site.
 *
 * Zero on a non-positive lane (no rebate, see the header) and zero on a
 * non-finite input, so a caller that lost its number cannot be handed a fee
 * for it.
 */
export function computeFeeTerm(venueNet: number): number {
  if (typeof venueNet !== "number" || !Number.isFinite(venueNet)) return 0;
  return venueNet > 0 ? venueNet * HOUSE_FEES.computeOnYield : 0;
}

/**
 * The yield AFTER the compute fee and BEFORE compounding — `afterFee` in the
 * R1 identity, and the value the compound step must be evaluated at.
 *
 * Defined as `venueNet − computeFeeTerm(venueNet)` rather than as
 * `venueNet * 0.8` so that the printed term and the applied fee are provably
 * the same object: a caption showing `− compute fee X` and a headline showing
 * `venueNet − X` cannot disagree, because there is one subtraction.
 */
export function applyComputeFee(venueNet: number): number {
  if (typeof venueNet !== "number" || !Number.isFinite(venueNet)) return venueNet;
  return venueNet - computeFeeTerm(venueNet);
}

/**
 * THE CAPTION UNDER A PUBLISHED HEADLINE NUMBER.
 *
 * It names WHICH costs are inside the number, because "net, after costs" was
 * true and still unreadable once the fee identity landed: a depositor could
 * not tell from it whether Priime's own cut had already been taken. The
 * percentage is read off `HOUSE_FEES`, so the caption cannot drift away from
 * the arithmetic that produced the number it sits under.
 *
 * It lives HERE, beside the rate it quotes, because two surfaces print it —
 * the review sheet a depositor approves and the record they land on — and the
 * two must be one sentence rather than two paraphrases (S1, 2026-08-24,
 * census F5).
 */
export function apyCaption(): string {
  return `net of venue costs and the ${Math.round(HOUSE_FEES.computeOnYield * 100)}% compute fee`;
}

/**
 * THE FOUR SCHEDULE ROWS, VERBATIM AND IN THIS ORDER. Byte-identical wherever
 * they are printed: the review sheet and the published record render the SAME
 * strings from the SAME call, so a reader comparing what they were shown
 * before publishing against what the record says is comparing two copies of
 * one sentence rather than two paraphrases.
 *
 * Every row is the QUANTITY, never a reassurance about it: `none on idle
 * capital` states what is charged, and no row characterizes the schedule as
 * fair, low, or competitive.
 *
 * ── THE FOURTH ROW PRICED AN ACTION THAT DOES NOT EXIST ───────────────────
 *
 * PO-4 (recette 2026-09-02). It read `Withdrawal fee · none on principal`, on
 * every review sheet and every published record, and the product has no exit:
 * `/withdraw` on the build host is a 308 to a different vault on a different
 * chain, the portfolio card's only keys are `Deposit more` and `View vault`,
 * and nothing in `lib/vaults/**` or `components/vaults/**` redeems a position.
 * A price on an action is a claim the action is available — that is what a fee
 * schedule IS — so the row read as an exit priced at zero rather than as an
 * exit that cannot be initiated. `railsArmed()` is the product's own answer to
 * whether anything here executes, and it returns false unconditionally.
 *
 * The other three rows survive unchanged because each attaches to something
 * this product actually does: the compute fee is INSIDE every published number
 * (`applyComputeFee` above), the settlement fee is charged on the deposit the
 * rail offers, and the management row states what holding costs. The
 * withdrawal row attached to nothing.
 *
 * So the row states the fact instead of the price. It stays a row rather than
 * disappearing: a schedule that simply omits the exit answers the depositor's
 * question with silence, and silence is what let the priced version read as
 * coverage in the first place. The label is the ACTION, because there is no
 * fee to name.
 *
 * WHEN THE EXIT SHIPS, this row becomes a price again, here, once — and the
 * copilot's two quotations of it follow on the same edit, as they do now.
 *
 * A fresh array on every call so no surface can mutate the schedule for
 * another.
 */
export function feeRows(record?: FeeRecordRef | null): { label: string; value: string }[] {
  return [
    {
      label: "Compute fee",
      value: `${Math.round(HOUSE_FEES.computeOnYield * 100)}% of yield, at harvest`,
    },
    /* Present only while the schedule charges it (founder, 2026-09-08: it
       does not). A row reading `0% of each deposit` is a price on nothing. */
    ...(HOUSE_FEES.settlementOnDeposit > 0
      ? [
          {
            label: "Settlement fee",
            value: `${Math.round(HOUSE_FEES.settlementOnDeposit * 100)}% of each deposit`,
          },
        ]
      : []),
    { label: "Management fee", value: "none on idle capital" },
    {
      label: "Withdrawal",
      value: isAttestedRecord(record) ? WITHDRAWAL_ATTESTED_LINE : "no exit rail on a modeled record",
    },
  ];
}

/**
 * THE EXIT SHIPPED ON ONE RECORD (docs/plans/LATEST_UI_PORT_SPEC.md A.3 #23).
 * The live vault in this build redeems a position at the attested share value
 * and charges nothing on principal, so its row is a price again, here, once.
 * Every other record keeps the fact above: it has no exit rail.
 *
 * A record is the live one by its slug (`DEMO_SCOPE.liveSlug`) or by its
 * stage (`attested`, which only that record carries).
 */
export const WITHDRAWAL_ATTESTED_LINE = "at the attested share value, no fee on principal";

/** What the schedule needs to know about a record: nothing more than these two. */
export interface FeeRecordRef {
  slug?: string | null;
  stage?: string | null;
}

function isAttestedRecord(record: FeeRecordRef | null | undefined): boolean {
  if (!record) return false;
  return record.slug === DEMO_SCOPE.liveSlug || record.stage === "attested";
}

/**
 * THE WITHDRAWAL ROW'S VALUE, for the surfaces that owe a depositor the same
 * answer somewhere other than the schedule — the deposit rail's position
 * panel, which is where someone holding a position looks for the way out.
 *
 * Read out of `feeRows()` by label rather than declared twice, the same idiom
 * `hedge-econ.ts` uses for the compute row: one string, one owner, and a
 * surface cannot answer the exit question differently from the record.
 */
export function withdrawalLine(record?: FeeRecordRef | null): string {
  return feeRows(record).find((r) => r.label === "Withdrawal")?.value ?? "";
}

/**
 * THE SETTLEMENT FEE IN DOLLARS (2026-09-02, inline run).
 *
 * ── WHY THE SCHEDULE OWNS THIS AND NOT THE CALLER ─────────────────────────
 *
 * The header above states the law that governs the 2%: it is a ONE-TIME
 * charge on principal, it may never be amortized into an annualized rate, and
 * `fee-identity.test.ts` pins that no APY owner so much as spells
 * `settlementOnDeposit`. Nothing in the product had ever needed it as a
 * QUANTITY, because no surface had a holding period to charge it over.
 *
 * The review sheet's inline run does. Its dials supply a deposit and a
 * horizon, so it prints dollars, and the moment a dollar figure exists the
 * exclusion loses its justification: `feeRows()` prints `Settlement fee · 2%
 * of each deposit` roughly 200px above, and a gain figure gross of it is a
 * number the same card contradicts. Measured on the four shipped templates at
 * the $25,000 seed, gross and net disagree about the DIRECTION of the answer
 * at 30, 90 and 180 days on every family, and on the loop at one year the
 * gross figure overstates the whole first-year gain by about nine times.
 *
 * So the charge gets one owner, HERE, beside the schedule row that announces
 * it, and the run reads it rather than spelling the rate. That keeps the law
 * intact in both directions: the fee is still absent from every rate, and the
 * one surface that may apply it to a principal cannot drift from the row a
 * reader was shown.
 *
 * Zero on a non-positive or non-finite deposit: there is no fee on a deposit
 * that was not made, and a caller that lost its number may not be handed a
 * charge for it.
 */
export function settlementFeeUsd(depositUsd: number): number {
  if (typeof depositUsd !== "number" || !Number.isFinite(depositUsd) || depositUsd <= 0) return 0;
  return depositUsd * HOUSE_FEES.settlementOnDeposit;
}

/**
 * The principal that is actually deployed: the deposit less the charge above.
 *
 * Defined as a SUBTRACTION of `settlementFeeUsd` rather than as
 * `deposit * 0.98`, for the reason `applyComputeFee` gives twenty lines up: a
 * panel printing `− $500` beside an ending value must be printing the same
 * object it subtracted, and one subtraction is how that is guaranteed rather
 * than asserted.
 */
export function depositAfterSettlement(depositUsd: number): number {
  if (typeof depositUsd !== "number" || !Number.isFinite(depositUsd)) return depositUsd;
  return depositUsd - settlementFeeUsd(depositUsd);
}

/**
 * The settlement row's value, for a surface that owes a reader the same
 * sentence somewhere other than the schedule. Read out of `feeRows()` by
 * label rather than declared twice, the idiom `withdrawalLine()` already
 * uses: one string, one owner.
 */
export function settlementLine(): string {
  return feeRows().find((r) => r.label === "Settlement fee")?.value ?? "";
}
