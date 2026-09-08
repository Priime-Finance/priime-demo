/**
 * THE FUNDING ROW, AS A CARD (2026-08-23) — one owner for the three strings a
 * funding market puts on the catalog card, and the reason it is in `lib/`
 * rather than in the panel that renders it.
 *
 * `single-owner.test.ts` refuses any component that so much as spells
 * `fundingP25Apr`: the accessor must hand back a string with the unit already
 * welded on, so a surface cannot pick the wrong glyph because it never holds
 * the number. The rule is not decoration — `tips.ts` once printed a funding
 * cost as `7.7%` above a body quoting an actual 8.7% rate, and the two numbers
 * wore the same unit while measuring different things. So the strings are
 * derived here and the panel prints them.
 *
 * ── THE IDENTITY THIS FILE RENDERS ────────────────────────────────────────
 *
 * A loop card prints `carry +0.72pp · borrow 1.65%` because those two terms
 * times leverage produce its headline. A funding row's headline is produced by
 * a different, equally short identity, and the scanner already writes it out
 * verbatim in its `marginal_rates_carry` gate:
 *
 *   net APY on deposit 7.6961% = 67.4157% escrow x (spot 1.9716% +
 *                                funding 10.1943% − drag 0.7500%)
 *
 * `spread`/`borrow` is a LENDING identity. Run on a funding row it prints the
 * spot leg against a structurally-zero borrow and NEVER the funding
 * percentile, which is the entire revenue — `PUMP 6.9% · carry +0.00pp ·
 * borrow 0.00%`, and `wstETH 1.9% · carry +2.38pp`, a headline BELOW its own
 * stated carry. Those are the same defect twice.
 *
 * NOTHING HERE IS RE-DERIVED. Every term is a projected field, `pct()` is the
 * one formatter, and `escrowShare` is the one f_b accessor. The line
 * reconciles at 1 dp because the scanner's own arithmetic does: kHYPE
 * 10.2 + 2.0 − 0.8 = 11.4 = `netCarryOnEquityApy`, and 67% of that is the
 * 7.7% headline.
 */

/* eslint-disable @typescript-eslint/prefer-optional-chain, eqeqeq --
 * Kit-verbatim file, ported from build.priime.finance eb6d33a. The findings
 * are the typed presets reading kit idioms; not rewriting kit logic to satisfy
 * lint, per the integration's own directive (the RackCanvas.tsx precedent). */

import { MINUS, pct } from "./format";
import { escrowShare } from "./hedge-econ";
import type { ProjectedCandidate } from "./opportunities";

/** A funding row is one the FUNDING SCANNER priced. The discriminating fact is
 *  the scanner's own `spotLeg` field: looking for the leg is its defining act,
 *  so every row it prices carries the field (as `null` exactly when no leg was
 *  found), and no loop scanner emits it at all. NOT keyed on
 *  `fundingWindowDays` any more (F3, 2026-08-23): the one-register
 *  reconciliation copies the book's window onto the LOOP rows priced from it,
 *  and a loop row carrying the book's window must keep its loop-card grammar. */
export function isFundingRow(c: ProjectedCandidate | null | undefined): boolean {
  return c?.economics != null && c.economics.spotLeg !== undefined;
}

/**
 * THE REVENUE LINE. `funding 10.19% over 30d + spot 1.97% − drag 0.75%`.
 *
 * FOUR RULES, each of them a rule about honesty rather than about layout:
 *
 *  · THE FUNDING TERM CARRIES ITS OWN SIGN, so a negative book reads
 *    `funding −52.64% over 180d` and the reader is told which way it runs.
 *
 *  · THE WINDOW RIDES ON THAT TERM and never gets a line of its own. Eight
 *    characters, no verb, welded to the number it qualifies — the `LT 93%`
 *    relationship applied to a rate instead of a pair. The published figure is
 *    `min(p25 over 30d, 90d, 180d, 365d)`, and a reader who cannot see WHICH
 *    window won cannot tell a book that is boringly positive over a year from
 *    one that is positive over a quarter and was p25 −55.5% over the year
 *    before it. Across the 24 committed rows the rule picked
 *    {30d: 10, 90d: 2, 180d: 10, 365d: 2}, so it discriminates on nearly every
 *    row. What the card does NOT say is that the number is the minimum of four
 *    windows, or that it is a p25 — those belong to the plate and the review.
 *
 *  · `spot` IS THE CREDITED FIGURE (`collateralYieldApy`), never
 *    `spotLeg.apy`. On jitoSOL the two differ — 5.10% named, 0% credited,
 *    because Solana is not a rail — and the credited one is the one inside the
 *    headline. The term is OMITTED at zero rather than printed as `spot 0.0%`,
 *    so a book with no leg reads `funding 10.95% over 30d − drag 0.75%`.
 *
 *  · `drag` OCCUPIES THE SLOT `borrow` OCCUPIES on a loop card: the structural
 *    cost term, in the scanner's own word. `borrow 0.00%` never appears on a
 *    funding card, because there is no borrow.
 *
 * The operators are literal `+` and `−` (U+2212, per `format.ts`), not the
 * ` · ` separator: this line is arithmetic and must read as arithmetic.
 *
 * ── AND IT IS 2 dp, WHICH IS THE SAME SLOT'S EXISTING GRAMMAR ────────────
 * `.mt-econ` line one already prints `carry +0.71pp · borrow 1.65%` under a
 * 1 dp headline, so two decimals here is the register the slot has, not a new
 * one. It is also the only precision at which the line CLOSES.
 *
 * MEASURED at 1 dp over the 24 committed books: 11 of them failed to
 * reconcile, always by exactly one unit in the last place. The drag is the
 * culprit and it is a constant — 0.75% prints as `0.8%`, half a last digit
 * high on EVERY row — so the printed sum runs 0.05pp light and flips the last
 * digit wherever the true total sits near a boundary. `PUMP` read
 * `funding 10.9% − drag 0.8%` against a headline of 6.9%: 10.9 − 0.8 = 10.1,
 * times the 67% escrow is 6.8%, and the card failed third-grade arithmetic on
 * the one surface whose entire premise is that the numbers reconcile. That is
 * the defect `format.ts`'s self-consistency law exists to name.
 */
const TERM_DP = 2;

export function fundingRevenueLine(c: ProjectedCandidate | null | undefined): string | null {
  const e = c?.economics;
  // BOTH guards: the funding-scanner provenance (`isFundingRow`) AND a window
  // to publish. A reconciled LOOP row carries the book's window but keeps the
  // lending identity (`carry · borrow`), so provenance must gate first.
  if (!isFundingRow(c) || !e || e.fundingWindowDays == null) return null;
  const out: string[] = [`funding ${pct(e.fundingP25Apr, TERM_DP)} over ${e.fundingWindowDays}d`];
  if (e.collateralYieldApy > 0) out.push(`+ spot ${pct(e.collateralYieldApy, TERM_DP)}`);
  const drag = e.executionDragApr;
  if (typeof drag === "number" && Number.isFinite(drag) && drag !== 0) {
    out.push(`${MINUS} drag ${pct(Math.abs(drag), TERM_DP)}`);
  }
  return out.join(" ");
}

/**
 * THE RATE AND ITS WINDOW, ALONE — `10.19% p25 over 30d` — for the surfaces
 * that need the funding fact without the full revenue identity: the review
 * sheet's `Funding` row and the published record's params (funding launch
 * rail, 2026-08-24). Same fields, same welding rule as `fundingRevenueLine`:
 * the window rides on the number it qualifies and never gets a line of its
 * own, and `p25` names what the number is. Null off the funding scanner or
 * with no window to publish — a caller renders nothing rather than a rate
 * with its provenance stripped.
 */
export function fundingRateLine(c: ProjectedCandidate | null | undefined): string | null {
  const e = c?.economics;
  if (!isFundingRow(c) || !e || e.fundingWindowDays == null) return null;
  return `${pct(e.fundingP25Apr, TERM_DP)} p25 over ${e.fundingWindowDays}d`;
}

/**
 * f_b, IN THE SLOT THE LEVERAGE OCCUPIES. `67% of each dollar`.
 *
 * `.mt-lev` is the slot the CSS defines as "welded to the number it
 * qualifies", and `ModeledRowBody` already overloads it with the non-leverage
 * word `modeled`. A funding market has no leverage dial — the module ruling
 * withholds it, because `repriceAtLeverage` returns a `loopLeverage <= 1` row
 * untouched — so printing `at 1.00x` there would advertise a control that does
 * not exist. What the slot does have to say is the escrow: two thirds of each
 * deposited dollar reaches the position and the rest sits as margin and
 * reserve, which is the single largest thing separating the headline from the
 * arithmetic on the line below it.
 *
 * The phrase is lifted verbatim from `FundingCanvas`'s own escrow line so the
 * rack and the funding canvas name f_b with ONE set of words.
 *
 * A row in `Nothing to hold` prints NEITHER this nor a headline: the escrow of
 * a dollar that cannot be placed qualifies nothing. That is the panel's call
 * (`RowBody.noDeposit`), not this function's — the market's escrow is a fact
 * whether or not a given group renders it.
 */
export function fundingEscrowLine(c: ProjectedCandidate | null | undefined): string | null {
  if (!isFundingRow(c)) return null;
  const fb = escrowShare(c)?.fb;
  if (typeof fb !== "number" || !Number.isFinite(fb)) return null;
  return `${pct(fb, 0)} of each dollar`;
}

/**
 * THE ESCROW, ONCE PER GROUP (recette F16, design D2).
 *
 * At the default dials every priced funding card carries the identical escrow
 * — "67% of each dollar", verbatim on all four — and a constant occupying a
 * per-card RESULT slot is the defect that got two gauges cut on 2026-08-22: a
 * slot that never moves is not an instrument. So when the catalog's priced
 * funding rows all share one escrow share, the fact moves to the GROUP intro,
 * stated once, and the per-card slot goes quiet. Should book margins ever
 * make the share vary by card, this returns null and the per-card line — now
 * an instrument again — comes back on its own.
 *
 * Only rows whose card would actually print the line are counted: a funding
 * row with no spot leg prints neither a headline nor an escrow (the escrow of
 * a dollar that cannot be placed qualifies nothing).
 */
export function fundingEscrowIntro(
  rows: readonly (ProjectedCandidate | null | undefined)[],
): string | null {
  const lines = new Set<string>();
  for (const c of rows) {
    if (!isFundingRow(c) || !c?.economics?.spotLeg) continue;
    const line = fundingEscrowLine(c);
    if (line) lines.add(line);
  }
  if (lines.size !== 1) return null;
  const [line] = lines;
  return `Every funding carry here places ${line} in the book; margin and reserve hold the rest.`;
}

/**
 * TWO LEGS, TWO CHAINS — what `.mt-meta`'s two chips say on a funding row.
 *
 * The venue chip is the "where" slot, and every other entry in `VENUE_LABELS`
 * is `Protocol · Chain`. `Hyperliquid · funding` is the only one that puts a
 * PRODUCT word where the chain goes, and it is the only venue whose rows have
 * two wheres: the card said "Hyperliquid" over wstETH, which is custodied on
 * Ethereum, and over stLINK, also Ethereum.
 *
 * `.mt-meta` already renders exactly two chips and already carries a ratified
 * rule for replacing the second one (`ltDiscriminator` displaces the class
 * pill; never three pills). Same slot, same rule. The class pill goes with the
 * venue chip on that precedent and for a stronger reason than the LT case: the
 * card now literally names the short, so `hedged` is a restatement of it.
 *
 * ⚠ THE TWO CHIPS WRAP TO TWO LINES, AND THE DESIGN'S WIDTH ARITHMETIC WAS
 * WRONG. It computed the pair against a 296px content box. MEASURED in a
 * rendered dock at 1512px viewport: `.mt-meta` is `grid-column: 1`, so it gets
 * 179px beside the escrow line and 230px beside a loop row's `at 3.00x`, while
 * the widest live pair (`kHYPE · Hyperliquid L1` 127px + `short HYPE ·
 * Hyperliquid` 137px + 8px gap) needs 272px. No spelling of the escrow line
 * fixes it — `67%` alone still leaves 239px — so the chips do not fit in this
 * slot at ANY wording. They are left to wrap: one leg per line loses nothing
 * and reads cleanly, and the alternatives are a new CSS rule (which the design
 * forbade outright) or dropping a chain name (which is the defect this closes).
 * Flagged for the design team rather than decided here.
 *
 * THE UNCREDITED LEG IS THE CASE THAT DECIDES WHETHER THIS IS HONEST. jitoSOL
 * keeps its chip — `jitoSOL · Solana` — while `spot` is absent from the
 * revenue line, because the scanner wrote `reachable: false`. So the card says:
 * this leg exists, it is on Solana, and it contributes nothing to the number.
 * That is the scanner's own note rendered as two glyphs instead of a sentence.
 *
 * A book with NO registered leg returns the short chip alone. There is no
 * asset to name, and naming one would be the defect.
 */
export function fundingLegChips(c: ProjectedCandidate | null | undefined): string[] | null {
  if (!isFundingRow(c) || !c) return null;
  const chips: string[] = [];
  const leg = c.economics?.spotLeg;
  if (leg) chips.push(`${leg.symbol} · ${leg.chain}`);
  if (c.hlCoin) chips.push(`short ${c.hlCoin} · Hyperliquid`);
  return chips.length > 0 ? chips : null;
}
