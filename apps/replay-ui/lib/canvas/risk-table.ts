/**
 * THE RISK TABLE — the derivation layer behind the structured risk table.
 *
 * ══ WHY THIS FILE EXISTS ═══════════════════════════════════════════════════
 *
 * `RegisterEntry` offers an author exactly ONE prose field (`why`) and one
 * opaque string slot (`entryValue`). So every fact a value cannot carry — the
 * denominator, the binding resource, the as-of, the counterparty, the
 * consequence — had to be written as a sentence, and every row therefore ended
 * with an italic line. That regularity is the whole complaint: a reader who
 * sees one explain-clause under every row knows a machine wrote it, and a
 * reader who sees `1.00` in the same column as `$451K`, `33.3%`, `structural`
 * and `44829957` cannot decode any of them.
 *
 * The fix is not shorter sentences. It is TYPED COLUMNS, so an author is never
 * handed a slot that only takes prose:
 *
 *   mechanism   a plain noun phrase, no verb about us
 *   reading     ONE quantity, with its own denominator and its own state
 *   consequence a clause, lower case, no terminal stop, hard cap 48 chars
 *   response    what is WRITTEN to happen, with the arming state on it
 *   asOfBlock   the provenance every measured figure already carried and no
 *               renderer ever printed (the standing quant law, closed)
 *   coverage    the per-class watch state, on counterparty rows
 *
 * ══ THE KEPT SET ═══════════════════════════════════════════════════════════
 *
 * A row earns its place iff it changes what a depositor DOES: deposit, size
 * differently, wait, or walk. A row that is merely true is cut. `KEPT_ROW_IDS`
 * is that list, and `validateRiskRow` DROPS anything outside it — so a
 * producer cannot grow a row back by writing one, the way the register grew a
 * block number into a mechanism.
 *
 * ══ ONE OWNER, TWO PRODUCERS ═══════════════════════════════════════════════
 *
 * Two surfaces produce a table: a canvas LANE (loop, dn-LP, collar) and a
 * published RECORD (all four, and funding has no lane at all). Every row TYPE
 * that both can emit is built by ONE helper here, taking primitives — a
 * number, a noun, a field path — so the funding family and the loop family
 * cannot invent two spellings of one dial the way `refillsFunded` ("1.00") and
 * `reserveFraction` ("15%") did for one reserve.
 *
 * ══ WHAT THIS FILE MAY NOT DO ══════════════════════════════════════════════
 *
 * It computes no quantity. Every figure arrives through `format.ts`,
 * `capacity.ts`, `liquidation.ts`, `hedge-econ.ts` or the axis registry, and
 * every string literal here is digit-free (the register's gate (d), extended
 * to this file in `__tests__/risk-table.test.ts`). There is no probability
 * anywhere and no severity ranking: the sections are what is at stake, never
 * how likely.
 */

/* eslint-disable @typescript-eslint/restrict-template-expressions --
 * Kit-verbatim file, ported from build.priime.finance eb6d33a. The findings
 * are the typed presets reading kit idioms; not rewriting kit logic to satisfy
 * lint, per the integration's own directive (the RackCanvas.tsx precedent). */

import { readAxis, type AxisLane } from "./axes";
import { capacityBindingLabel, fmtCapacityUsd, isModeledBinding } from "./capacity";
import { escrowShare } from "./hedge-econ";
import { ARROW, band, blockStamp, carry, pct, ppMag } from "./format";
import { venueLabel } from "./labels";
import {
  adverseMoveValue,
  coinMaxLeverageFromMarginRule,
  coinMoveMagnitude,
  driftBeforeTrim,
  liquidationDistance,
  NOT_MEASURED,
  shortLegBands,
  shortMarginValue,
} from "./liquidation";
import { liquidationLinesOfLane } from "./liquidation-lines";
import { RESERVE_MIN_FRACTION } from "./modules";
import {
  collarModel,
  issuerRedemptionTerms,
  settlementWindowValue,
  treasuryAsOfNote,
  treasuryIssuerFacts,
  fastestExitRoute,
  type CollarDials,
} from "./templates";
import type { DependencyRow, DependencyState } from "./exogenous";

/* ⟦UNIT⟧ The only numeric literal in this file that is not 0 or 1, and it
   never reaches a reader. Several dials are stored as PERCENT numbers (a
   `rangePct` of 8, a `deltaBandPct` of 4) while every formatter here takes a
   fraction, so one conversion constant is declared once, by name, rather than
   spelled `/ 100` at six call sites. */
const PERCENT = 100;
/* ⟦/UNIT⟧ */

const finite = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

// ══ THE SHAPE ══════════════════════════════════════════════════════════════

/**
 * The families the product can publish. `funding` is here as a peer and not as
 * a special case: it produces the SAME row shapes from the SAME helpers, which
 * is what closes the gap where it was the only family with no statement of
 * what can be closed against a depositor.
 *
 * `treasury` is a peer for the same reason (2026-09-03, confirmed). It falls
 * through every OTHER family's branch on purpose: it borrows nothing, holds
 * no short and writes no option, so the loop, dn-LP and collar arms have
 * nothing true to say about it and each one is correctly silent. What it adds
 * is the register's first TIME-VALUED reading — the window between asking to
 * leave and holding dollars, which no other family has because no other
 * family asks a transfer agent for permission.
 */
export type RiskFamily = "loop" | "dnlp" | "collar" | "funding" | "treasury";

/**
 * Five sections, in render order, and each is a plain noun for WHAT IS AT
 * STAKE. Never ordered by severity, which would be a ranking claim across
 * mechanisms nobody can rank without probabilities this product does not have.
 */
export type RiskSection = "forced-exit" | "exit" | "principal" | "yield" | "counterparty";

export const RISK_SECTION_ORDER: readonly RiskSection[] = [
  "forced-exit",
  "exit",
  "principal",
  "yield",
  "counterparty",
];

export const RISK_SECTION_HEADING: Record<RiskSection, string> = {
  "forced-exit": "Forced exits",
  exit: "Exit",
  principal: "Principal",
  yield: "Yield",
  counterparty: "Counterparties",
};

/** The table's own title. Deliberately not "Liquidation lines": the reclaim
 *  readout already owns that noun for the leg COUNT, and two blocks wearing
 *  one noun is the collision the register was built to refuse. */
export const RISK_TABLE_TITLE = "Risk register";

/**
 * FOUR STATES OF A READING, and the render layer branches on this and nothing
 * else. It never inspects the string, which is how `not measured` stopped
 * being a string test and started being data.
 *
 *  · `measured`     a number read from a field, at a block. Carries a
 *                   denominator and a field path.
 *  · `stated`       a fact the composition states exactly — `none`, a debt
 *                   symbol, the identity `100%` an unhedged deposit carries.
 *                   Exact, but nothing was READ, so it carries no as-of.
 *  · `no-threshold` no level exists to watch. This is where the word the
 *                   register used to print in the NUMBER column belongs: a
 *                   tier is not a measurement.
 *  · `unmeasured`   a quantity exists here and nothing reads it. Never
 *                   dropped, never rounded to a reassuring zero, never behind
 *                   a disclosure.
 */
export type RiskReadingState = "measured" | "stated" | "no-threshold" | "unmeasured";

export interface RiskReading {
  state: RiskReadingState;
  /** The quantity alone, already carrying its unit. Null on `no-threshold`
   *  and on `unmeasured` — an absence carries no number, by schema. */
  value: string | null;
  /** THE DENOMINATOR, as a noun. Never null on `measured`: a figure without
   *  the frame it is a fraction OF is the defect this column exists to close
   *  (33.3% of the short's notional and 32.6% of the deposit were one number
   *  to a reader for as long as neither said which). On `unmeasured` it names
   *  what WOULD have measured it. */
  denominator: string | null;
  /** The one field the value came from. Non-null iff `measured`. */
  fieldPath: string | null;
  /**
   * THE QUANTITY THIS ROW WOULD HAVE READ, as a bare noun, on an `unmeasured`
   * reading that consents to being COLLAPSED with its neighbours. Null
   * everywhere else, and null is the safe default: a section only collapses
   * when every one of its rows carries one.
   *
   * ⚠ IT EXISTS BECAUSE ONE ABSENCE WAS STATED FOUR TIMES. On a published
   * hedged-loop record the whole Yield group is unmeasured, and it said so
   * once per row — `the borrow rate is not published on this record`,
   * `lower-quartile APR, not published on this record`, `no guard floor
   * published on this record` — over a footer that already printed
   * `3 readings not taken`. Three near-identical captions and a count is a
   * group that says "we did not look" four times and nothing else. The noun
   * here is what lets `assembleRiskTable` say it ONCE, naming all three.
   */
  quantity: string | null;
  /**
   * TRUE WHERE THIS FIGURE IS THE PRODUCT'S OWN MODEL, not a venue reading.
   *
   * ⚠ IT IS ON THE READING AND NOT ONLY ON THE TABLE, and that is the fix.
   * The footer carried one `modeled` boolean for the whole card, which is a
   * claim about the card rather than about a number: a collar printed
   * `12.2 actions/yr` under a footer saying "Modeled at one flat volatility"
   * and a dn-LP printed `1,600 actions/yr` under a footer that said nothing,
   * so one modeled figure read as a measurement because the row beside it was
   * one. Marked HERE, at the source, no surface can print a modeled figure
   * bare: `readingStamp` is the only route a value's provenance takes to a
   * reader and it reads this field.
   */
  modeled: boolean;
}

/**
 * THE WRITTEN RESPONSE. `armed` is false on every row of every vault today
 * (`railsArmed` returns false unconditionally), and it travels ON THE ROW
 * rather than being implied by a banner, so no renderer can print a trigger
 * as something that happens.
 */
export interface RiskResponse {
  /** What fires it. */
  trigger: string;
  /** How often we look. Null on a surface holding no published cadence. */
  cadence: string | null;
  /** Whether the rail behind it actuates. Watchers detect; actuation is not
   *  shipped, so this is false everywhere and is data, not prose. */
  armed: boolean;
}

/** The per-class watch state, on counterparty rows only. `unread` is the
 *  honest reading of a class whose signal list is empty — it may NEVER read
 *  `clear`, which is the false verdict that shipped when three classes with
 *  three different states were collapsed into one word. */
export type RiskCoverage = "clear" | "failing" | "stale" | "unread";

/** Which outside party a counterparty row belongs to, and why it is on this
 *  lane at all. One route sentence per party, not per class. */
export interface RiskParty {
  id: string;
  label: string;
  because: string;
}

export interface RiskRow {
  id: RiskRowId;
  section: RiskSection;
  /** Column 1. A plain noun phrase, decoded at zero cost. */
  mechanism: string;
  reading: RiskReading;
  /** The consequence, as a CLAUSE: lower case, no terminal stop, 48 chars.
   *  Null wherever the mechanism already says it — an author who cannot say
   *  it in 48 characters does not have a row, they have two. */
  consequence: string | null;
  response: RiskResponse | null;
  /** The block the reading was taken at. Null where nothing was read. */
  asOfBlock: number | null;
  coverage: RiskCoverage | null;
  party: RiskParty | null;
}

/**
 * ONE STATEMENT OF AN ABSENCE, AT GROUP LEVEL — the collapse.
 *
 * A group whose rows are unmeasured is a group that says "we did not look"
 * once per row. On a published hedged-loop record the Yield group said it
 * three times, in three near-identical captions, over a footer already
 * printing `3 readings not taken`: one absence, four statements, and a heading
 * promising how the yield dies that delivered nothing but the confession.
 *
 * The rows stay on the block — `tableRows` is what every gate and every count
 * reads, so the footer still says `3 readings not taken` and no invariant is
 * measured against a shorter table than the one that exists. `shown` is what
 * a renderer walks. What changes is how many times a reader is told the same
 * thing: once.
 *
 * ══ ⚠ IT FOLDS THE UNMEASURED SUBSET NOW, NOT ONLY A WHOLLY-BLIND GROUP ════
 * (G7 major, 2026-09-02.) All-or-nothing left two walls standing, both
 * photographed:
 *
 *  · the canvas counterparty section, where NINE consecutive class rows read
 *    the identical `not measured / nothing on this lane reads it` on the dn-LP
 *    lane. Withholding the orphan imperatives (correct, and the ruling before
 *    this one) had removed the only varying content in them, so the wall got
 *    MORE uniform, not less;
 *  · `aerodrome-rangekeeper`'s Yield group, where two adjacent rows each ended
 *    in a `…published on this record` tail and a third, MEASURED row (the LP
 *    range) blocked the fold for both of them.
 *
 * A measured row is information the fold would delete; an unmeasured one
 * beside it is not. So the measured rows keep their places and the unmeasured
 * ones fold behind them, and the group's absence is stated once whether the
 * group is wholly blind or partly.
 */
export interface RiskSectionAbsence {
  /** The quantities the group would have read, named once, in the mechanism
   *  column's voice. */
  mechanism: string;
  /** Where the reading IS taken, so the absence names a place rather than
   *  shrugging. It sits in the reading column's denominator slot, which is the
   *  slot whose job is already "what WOULD have measured it". */
  denominator: string;
}

export interface RiskSectionBlock {
  section: RiskSection;
  heading: string;
  /** EVERY row of the group. The footer's counts, `tableRows` and every gate
   *  read this, so a fold is never a deletion. */
  rows: RiskRow[];
  /**
   * The rows a RENDERER walks: `rows` minus whatever `absence` folded. Equal
   * to `rows` wherever `absence` is null, and empty on a wholly-blind group.
   * It exists so the renderers hold no predicate of their own — a component
   * that decides which rows an absence covers is a second owner of the fold.
   */
  shown: RiskRow[];
  /** Non-null iff two or more unmeasured rows here named their own quantity
   *  and agreed on where the reading would come from. Null on every group with
   *  fewer than two, which is the safe direction. */
  absence: RiskSectionAbsence | null;
}

/**
 * THE FOOTER, which retires four rows across four families and one disclosure
 * widget. `scan-vintage` (loop), `funding-print` (funding), `feed-age` (loop)
 * and the scan party row were all as-of statements wearing a mechanism's
 * clothes; they collapse into one line here. The blind-spot COUNT survives —
 * a table claiming to measure everything would be a completeness claim — but
 * the drawer does not, because a state behind a chevron is a state a
 * depositor never sees.
 */
export interface RiskFooter {
  /** `block 41,563,811`, or null where the record pins none. */
  asOf: string | null;
  /** What the record does say about its vintage where it pins no block.
   *  Never empty in place of an absent stamp: the absence is stated. */
  asOfNote: string | null;
  /** Readings taken, out of rows that could carry one. */
  measured: number;
  readable: number;
  /** The parties nothing on this lane reads, as one product-level line, or
   *  null when the overlay is placed and the parties are rows of their own. */
  unwatched: string | null;
  /** True where a figure in this table is a model assumption rather than a
   *  venue reading (the collar's capacity, its flat-vol premium). */
  modeled: boolean;
}

/**
 * THE ARMING STATE, promoted out of the row list and onto the table.
 *
 * It is not a property of any market, it carries identical words on every
 * vault by construction, and it is the ONE fact that makes the response
 * column honest. As a row it sat at the weight of a mechanism under a verdict;
 * as the table's own header it governs every response cell beneath it.
 */
export interface RiskArming {
  label: string;
  value: string;
  note: string;
}

export interface RiskTable {
  family: RiskFamily;
  title: string;
  arming: RiskArming | null;
  sections: RiskSectionBlock[];
  footer: RiskFooter;
}

// ══ THE KEPT SET ═══════════════════════════════════════════════════════════

/**
 * Every row this product may print, and nothing else. The list IS the ruling:
 * each id below survived the test "does it change what a depositor does", and
 * every id that did not is named in the tombstone under it so nobody
 * re-derives one from first principles a second time.
 */
export type FixedRiskRowId =
  // ── Forced exits: what a third party can close, and at what move ────────
  | "borrow-leg"
  | "deposit-line"
  | "trim-fires"
  | "escrow"
  | "short-margin"
  | "short-line"
  | "short-trim"
  | "position-whole"
  | "price-carried"
  | "upside-sold"
  | "floor-level"
  | "floor-venue"
  // ── Exit: what stands between the position and the door ─────────────────
  | "exit-capacity"
  | "margin-reserve"
  | "settlement-window"
  // ── Principal: acts and still loses ─────────────────────────────────────
  | "venue-freeze"
  | "short-reflexive"
  | "two-venues"
  | "delta-band"
  // ── Yield: takes the yield, not the capital ─────────────────────────────
  | "carry-spread"
  | "funding-p25"
  | "funding-guard"
  | "range-width"
  | "roll-cost";

/** A counterparty row is one per CLASS, and the class list is derived, so its
 *  ids are a namespace rather than an enumeration. */
export type RiskRowId = FixedRiskRowId | `${typeof EXO_ROW_PREFIX}${string}`;

export const EXO_ROW_PREFIX = "exo:";

export const KEPT_ROW_IDS: ReadonlySet<FixedRiskRowId> = new Set<FixedRiskRowId>([
  "borrow-leg",
  "deposit-line",
  "trim-fires",
  "escrow",
  "short-margin",
  "short-line",
  "short-trim",
  "position-whole",
  "price-carried",
  "upside-sold",
  "floor-level",
  "floor-venue",
  "exit-capacity",
  "margin-reserve",
  "settlement-window",
  "venue-freeze",
  "short-reflexive",
  "two-venues",
  "delta-band",
  "carry-spread",
  "funding-p25",
  "funding-guard",
  "range-width",
  "roll-cost",
]);

/**
 * ⚠ TOMBSTONE — the rows the kept set REFUSES, and the reason each was cut.
 * Reported here rather than deleted silently, because "we already considered
 * that" is the only defence a table has against growing back.
 *
 *   pair-gap        Restated the deposit line and the trim, verbatim, one
 *                   screen below them. Two rows now hold those two facts.
 *   scan-vintage    An as-of stamp wearing a mechanism's clothes. The footer.
 *   funding-print   The same defect on the funding family, behind a chevron.
 *   feed-age        Also an as-of, and it carried a REACTION against an
 *                   unmeasured trigger — an action on a thing nobody reads.
 *   declared-blind  Byte-identical on every vault with the pair swapped. A
 *                   product-level statement belongs at product level: the
 *                   footer's `unwatched` line.
 *   exo-scan        A fact about us, not about the money, and the third print
 *                   of one vintage claim.
 *   flat-vol        A qualifier on the number above it, which is what the
 *                   word `modeled` is for. `footer.modeled`.
 *   bridge          A count of the rows printed immediately beneath it.
 *   main-risk       A full prose paragraph in a value cell, under a severity
 *                   ranking (`Main`) this product refuses to make.
 */

/**
 * THE LEGACY ROWS THIS TABLE REFUSES, AS DATA.
 *
 * Every id below is a `RegisterEntry` the two legacy producers still emit and
 * this table will never contain. It is a registry rather than a comment for
 * two reasons: a test asserts the table emits none of them (so a row cannot
 * creep back under a new name), and the change that swaps the renderer deletes
 * exactly this list from `register.ts` and `funding-register.ts` — mechanically,
 * with nothing left to judge.
 *
 * ⚠ WHY THEY ARE STILL IN THE PRODUCERS, AND IT IS NOT TIMIDITY. They were
 * deleted, the suite was run, and the register's OWN ratified gate (b) failed:
 * without `pair-gap`'s `lt`-derived cushion, three `aave-v3-base` pairs —
 * weETH/WETH, cbETH/WETH, wstETH/WETH — produce CHARACTER-IDENTICAL registers,
 * because the catalog carries two markets per venue+pair and no other legacy
 * row separates them. Deleting `feed-age` moves `exogenous-counters`' two
 * published blind-spot integers, and deleting `funding-print` removes the only
 * vintage statement the three funding pages have until this table renders.
 * Softening any of those gates to admit the deletion would be re-pinning a
 * ratified invariant to fit a change, which is the move this codebase refuses
 * by name. The legacy grammar needs these rows; the table does not; the two
 * facts are compatible for exactly as long as both renderers exist.
 */
export const RETIRED_BY_RISK_TABLE: ReadonlySet<string> = new Set([
  /* The cushion and the trim, restated one screen under the verdict that
     states them. Two rows here, each with its own denominator. */
  "pair-gap",
  /* An as-of under a mechanism heading, carrying a REACTION against a trigger
     it had just said nothing reads. The footer's coverage line. */
  "feed-age",
  /* A raw block height in the money column, filed under "takes the yield". The
     footer's as-of stamp. */
  "scan-vintage",
  /* The same defect on the funding family, behind a chevron. */
  "funding-print",
  /* Byte-identical on every vault with the pair swapped: a product-level
     statement rendered as a per-vault measurement. The footer's one line. */
  "declared-blind",
  /* A qualifier on the number above it, which is what the word `modeled` is
     for. `footer.modeled`. */
  "flat-vol",
  /* The funding family's only closability statement, and it was the fourth row
     of the third group because that family had no verdict at all. Now the
     first section, in three rows. */
  "short-closed",
]);

/**
 * THE SCHEMA, as a list of what is wrong. Empty means the row may render, and
 * a failing row is DROPPED rather than repaired — the runtime half of the
 * gate, so "a wrong row cannot ship" is a property of this function rather
 * than a promise about whoever edits it next.
 */
export function validateRiskRow(row: RiskRow): string[] {
  const bad: string[] = [];
  if (!isKeptRowId(row.id)) bad.push(`id is not in the kept set: ${row.id}`);
  if (row.mechanism.trim().length === 0) bad.push("mechanism is empty");
  const r = row.reading;
  if (r.state === "measured") {
    if (!r.value) bad.push("measured with no value");
    if (!r.denominator) bad.push("measured with no denominator");
    if (!r.fieldPath) bad.push("measured with no fieldPath");
  }
  if (r.state === "stated") {
    if (!r.value) bad.push("stated with no value");
    if (!r.denominator) bad.push("stated with no denominator");
  }
  if (r.state === "unmeasured") {
    if (r.value !== null) bad.push("unmeasured carries a value");
    if (!r.denominator) bad.push("unmeasured with nothing named as absent");
  } else if (r.quantity !== null) {
    /* The collapse noun answers "what did we fail to read"; a reading that was
       taken has nothing to name. */
    bad.push(`${r.state} carries a collapse quantity`);
  }
  if (r.state === "no-threshold" && r.value !== null) bad.push("no-threshold carries a value");
  if (r.state !== "measured" && r.fieldPath !== null) bad.push(`${r.state} carries a fieldPath`);
  if (r.state !== "measured" && row.asOfBlock !== null) bad.push(`${r.state} carries an as-of`);
  /* A PROVENANCE IS A CLAIM ABOUT A NUMBER. `modeled` beside an absence says
     the product modelled a thing it just said it does not read. */
  if (r.modeled && r.value === null) bad.push("modeled with no figure to qualify");
  /* THE RESPONSE IS AN ACTION OR IT IS NOT A RESPONSE. `33.3%` shipped in the
     slot whose documented job is OUR clock in the race — a margin ratio
     offered as the answer to a capacity bound, and the same characters as the
     Measure of a different row two rows down. A trigger with no word in it is
     a quantity somebody moved into an action column. */
  if (row.response !== null) {
    const t = row.response.trigger;
    if (t.trim().length === 0) bad.push("response with no trigger");
    else if (!ACTION_WORD.test(t)) bad.push(`response is a bare quantity, not an action: ${t}`);
  }
  if (row.consequence !== null) {
    const c = row.consequence;
    if (c.length > CONSEQUENCE_MAX) bad.push(`consequence over ${CONSEQUENCE_MAX}: ${c}`);
    if (/[.!?]$/.test(c)) bad.push(`consequence ends in a stop: ${c}`);
    if (/^[A-Z]/.test(c)) bad.push(`consequence opens upper case: ${c}`);
  }
  if (row.coverage !== null && row.section !== "counterparty") {
    bad.push("coverage outside a counterparty row");
  }
  if (row.section === "counterparty" && row.coverage === null) {
    bad.push("counterparty row with no coverage");
  }
  if (row.coverage === "clear" && row.reading.state !== "measured") {
    /* `clear` IS A MEASUREMENT. It shipped beside a class with an empty
       signal list, which told a depositor the venue was clear on a queued
       governance proposal nothing reads. */
    bad.push("clear coverage on a reading nothing took");
  }
  return bad;
}

/** A clause, not a sentence. The cap is mechanical because review is not. */
export const CONSEQUENCE_MAX = 48;

/**
 * What makes a trigger an ACTION rather than a level: a STANDALONE word of two
 * letters or more — one not glued to a number.
 *
 * ⚠ THE "STANDALONE" HALF IS THE WHOLE RULE. A first cut asked only for two
 * letters, and `4.24pp` passed it on the unit `pp` — which is precisely one of
 * the two bare quantities that shipped in the response column. A unit is part
 * of a number, not a verb. `margin 6.5% → 23%` passes on `margin`; `33.3%`,
 * `4.24pp`, `$19.3K` and `1.00` all fail.
 *
 * Exported so the legacy entry schema enforces the SAME rule rather than
 * growing a second opinion about what an action is.
 */
export const RESPONSE_ACTION_WORD = /(?:^|[^0-9A-Za-z.$])[A-Za-z]{2,}/;
const ACTION_WORD = RESPONSE_ACTION_WORD;

export function isKeptRowId(id: string): id is RiskRowId {
  return KEPT_ROW_IDS.has(id as FixedRiskRowId) || id.startsWith(EXO_ROW_PREFIX);
}

// ══ THE ROW HELPERS — one per kept id, primitives in, one shape out ════════
//
// Both producers call these. A row type that exists on two families is built
// in exactly one place, which is the whole reason the reserve stops being a
// share on one page and a count on another.

const SECTION_OF: Record<FixedRiskRowId, RiskSection> = {
  "borrow-leg": "forced-exit",
  "deposit-line": "forced-exit",
  "trim-fires": "forced-exit",
  escrow: "forced-exit",
  "short-margin": "forced-exit",
  "short-line": "forced-exit",
  "short-trim": "forced-exit",
  "position-whole": "forced-exit",
  "price-carried": "forced-exit",
  "upside-sold": "forced-exit",
  "floor-level": "forced-exit",
  "floor-venue": "forced-exit",
  "exit-capacity": "exit",
  "margin-reserve": "exit",
  /* ⚠ A ROW WITH NO `SECTION_OF` ENTRY GETS `section: undefined` AND LANDS
     NOWHERE. The union above and `KEPT_ROW_IDS` both accept it, the builder
     returns it, and `assembleRiskTable` drops it into a section that does not
     exist — so the row is emitted, counted, and invisible. Three places, one
     id, every time. */
  "settlement-window": "exit",
  "venue-freeze": "principal",
  "short-reflexive": "principal",
  "two-venues": "principal",
  "delta-band": "principal",
  "carry-spread": "yield",
  "funding-p25": "yield",
  "funding-guard": "yield",
  "range-width": "yield",
  "roll-cost": "yield",
};

function row(
  id: FixedRiskRowId,
  mechanism: string,
  reading: RiskReading,
  extra: {
    consequence?: string | null;
    response?: RiskResponse | null;
    asOfBlock?: number | null;
  } = {},
): RiskRow {
  return {
    id,
    section: SECTION_OF[id],
    mechanism,
    reading,
    consequence: extra.consequence ?? null,
    response: extra.response ?? null,
    asOfBlock: reading.state === "measured" ? (extra.asOfBlock ?? null) : null,
    coverage: null,
    party: null,
  };
}

const measured = (
  value: string,
  denominator: string,
  fieldPath: string,
  modeled = false,
): RiskReading => ({
  state: "measured",
  value,
  denominator,
  fieldPath,
  modeled,
  quantity: null,
});

const stated = (value: string, denominator: string, modeled = false): RiskReading => ({
  state: "stated",
  value,
  denominator,
  fieldPath: null,
  modeled,
  quantity: null,
});

/** `quantity` is the bare noun for what is missing, and supplying it is how a
 *  row consents to being folded into its group's one absence line. Omit it and
 *  the row always states its own absence, which is the safe direction. */
const unmeasured = (denominator: string, quantity: string | null = null): RiskReading => ({
  state: "unmeasured",
  value: null,
  denominator,
  fieldPath: null,
  modeled: false,
  quantity,
});

const noThreshold = (denominator: string): RiskReading => ({
  state: "no-threshold",
  value: null,
  denominator,
  fieldPath: null,
  modeled: false,
  quantity: null,
});

/** The one absence word the product owns, re-exported so a renderer never
 *  mints a second spelling of it beside a first. */
export const RISK_NOT_MEASURED = NOT_MEASURED;

/** The one word the product uses for a figure its own model produced. The
 *  capacity noun (`modeled option open interest`) already spells it this way,
 *  and a second spelling on the same page is how one state comes to read as
 *  two. */
export const RISK_MODELED_WORD = "modeled";

/**
 * THE AS-OF, PER ROW, IN THE PRODUCT'S OWN GRAMMAR — `modeled · block 41,563,811`.
 *
 * `blockNumber` was set on every measured entry the register ever produced and
 * NO renderer printed it; the one path a block took to a reader was the
 * `scan-vintage` row's VALUE, a raw `41563811` in the same mono column as
 * `$19.3K`, while the Parameters panel 400px away printed the identical number
 * as `block 41,563,811`. This is that stamp, on the row that owns it, in
 * `DockReadouts`' own spelling.
 *
 * Null where there is nothing to stamp: a `stated` fact was not read at a
 * block and an absence has no vintage, so neither wears a provenance it does
 * not have.
 */
export function readingStamp(row: RiskRow): string | null {
  const modeled = row.reading.modeled ? RISK_MODELED_WORD : null;
  const block = row.asOfBlock === null ? null : blockStamp(row.asOfBlock);
  const parts = [modeled, block].filter((s): s is string => typeof s === "string" && s.length > 0);
  return parts.length > 0 ? parts.join(STAMP_SEP) : null;
}

/** The product's own separator between a stamp's two halves. */
const STAMP_SEP = " · ";

const NONE = "none";

// ── Forced exits ──────────────────────────────────────────────────────────

/** `Borrow · WHYPE` / `Borrow · none`. The single fact everything below it
 *  depends on, and on three of four families the answer is `none`. */
export function borrowLegRow(debtSymbol: string | null, borrows: boolean): RiskRow {
  return row(
    "borrow-leg",
    "Borrow",
    borrows && debtSymbol
      ? stated(debtSymbol, "borrowed against the deposit")
      : stated(NONE, "the deposit carries no debt"),
  );
}

/**
 * `Deposit liquidation line · 29% · adverse wstETH/WETH move`.
 *
 * The strongest deposit-or-walk fact the product owns, and until now it was an
 * unlabelled headline sentence that could not be compared with the next
 * vault's. As a row it sits in the same column across every record.
 */
export function depositLineRow(args: {
  borrows: boolean;
  distanceValue: string | null;
  pairNoun: string;
  fieldPath: string;
  block: number | null;
}): RiskRow {
  if (!args.borrows) {
    return row("deposit-line", "Deposit liquidation line", stated(NONE, "no borrow leg to liquidate"));
  }
  if (!args.distanceValue) {
    return row(
      "deposit-line",
      "Deposit liquidation line",
      unmeasured("the venue threshold is not published on this record"),
    );
  }
  return row(
    "deposit-line",
    "Deposit liquidation line",
    measured(args.distanceValue, `adverse ${args.pairNoun} move`, args.fieldPath),
    { asOfBlock: args.block },
  );
}

/** `Trim fires · 3.65pp · of that move, before the line`. */
export function trimFiresRow(drift: string, fieldPath: string, block: number | null): RiskRow {
  return row("trim-fires", "Trim fires", measured(drift, "of that move, before the line", fieldPath), {
    consequence: "a gap prices in one block",
    asOfBlock: block,
  });
}

/**
 * `Deposit held as perp margin · 32.6% · of the deposit, as margin and reserve`.
 *
 * ONE DECIMAL, NOT ZERO, and it is a correctness fix rather than taste. The
 * verdict note printed this at 0 dp (`33%`) one line above a `33.3%` margin
 * ratio, and they are DIFFERENT QUANTITIES IN DIFFERENT FRAMES: this is a
 * fraction of the DEPOSIT and carries the reserve, that is a fraction of the
 * SHORT'S OWN NOTIONAL and does not. They round together at the shipped
 * composition and they will not round together forever.
 */
export function escrowRow(escrowFraction: string, fieldPath: string, block: number | null): RiskRow {
  return row(
    "escrow",
    "Deposit held as perp margin",
    measured(escrowFraction, "of the deposit, as margin and reserve", fieldPath),
    { consequence: "that share is not in the strategy", asOfBlock: block },
  );
}

/** `Short margin · 33.3% · of the short's own notional`. The word `own` is
 *  load-bearing and it is in the DENOMINATOR, where it belongs, rather than
 *  in a label doing a column's job. */
export function shortMarginRow(args: {
  marginRatio: string;
  fieldPath: string;
  block: number | null;
  response: RiskResponse | null;
}): RiskRow {
  return row(
    "short-margin",
    "Short margin",
    measured(args.marginRatio, "of the short's own notional", args.fieldPath),
    { response: args.response, asOfBlock: args.block },
  );
}

/**
 * `Short's own liquidation · +41% · adverse HYPE move`, or the absence.
 *
 * MANDATORY, ON EVERY HEDGED FAMILY, MEASURED OR NOT. Deleting it on the
 * blind path lets a reader infer the short has no liquidation line, which is
 * the opposite of true — and it is the walk trigger for the hedged leg, so it
 * is the last row that may live behind a disclosure.
 */
export function shortLineRow(args: {
  move: string | null;
  coin: string | null;
  fieldPath: string;
  block: number | null;
  /**
   * The absence, in the SURFACE's own words — and they are the surface's
   * REASON, not a noun swap.
   *
   * It read `the coin's maintenance margin is not published on this record` on
   * both surfaces, which was wrong twice. On the CANVAS there is no record: a
   * builder is composing a lane, and the reason the figure is missing is that
   * the projection drops `hl.coins[coin].maxLeverage`. On a RECORD the ladder
   * IS published and the figure is still missing, because MM is only
   * recoverable where the ladder's two edges agree on it
   * (`coinMaxLeverageFromMarginRule`) — on `aerodrome-rangekeeper` and
   * `btc-carry-collector` they disagree, which is a fact about the ladder and
   * not about publication.
   *
   * Neither wording ends in the five words the fold's absence ends in, which
   * is deliberate: `aerodrome-rangekeeper` printed THREE `…published on this
   * record` tails on one screen, and two absences that are genuinely different
   * facts must not read as one sentence said twice.
   */
  absence?: string | null;
}): RiskRow {
  const label = "Short's own liquidation";
  if (!args.move || args.move === NOT_MEASURED || !args.coin) {
    return row(
      "short-line",
      label,
      unmeasured(args.absence ?? "the coin's maintenance margin is not carried by the scan"),
    );
  }
  return row("short-line", label, measured(args.move, `adverse ${args.coin} move`, args.fieldPath), {
    asOfBlock: args.block,
  });
}

/** `Short trims · +37% · adverse HYPE move`. Only where the band is provable:
 *  it is the row that says the reaction fires before the line. */
export function shortTrimRow(args: {
  move: string;
  coin: string;
  fieldPath: string;
  block: number | null;
}): RiskRow {
  return row("short-trim", "Short trims", measured(args.move, `adverse ${args.coin} move`, args.fieldPath), {
    asOfBlock: args.block,
  });
}

/** The funding family's whole position, named once. It closes the gap where
 *  three vault pages carried no statement at all of what can be closed. */
export function positionWholeRow(coin: string, venue: string): RiskRow {
  return row(
    "position-whole",
    "The position",
    stated(`one ${coin} short on ${venue}`, "the venue can close it whole"),
  );
}

/** An unhedged deposit carries the collateral's price outright. The identity
 *  is DERIVED (`pct(1, 0)`), never typed: an unhedged lane's exposure is one
 *  by construction, and a typed `100%` would be the first number in this file
 *  that no field produced. */
export function priceCarriedRow(collateral: string): RiskRow {
  return row(
    "price-carried",
    `${collateral} price, carried whole`,
    stated(pct(1, 0), `of the ${collateral} price move`),
    { consequence: "nothing here shorts the deposit" },
  );
}

/** The collar's whole trade, and it renders FIRST on that family instead of
 *  fourth in the third group. */
export function upsideSoldRow(args: {
  pair: string;
  strike: string;
  fieldPath: string;
  block: number | null;
}): RiskRow {
  return row(
    "upside-sold",
    `${args.pair} above the written strike`,
    measured(args.strike, "above spot at open", args.fieldPath),
    { consequence: "upside above it belongs to the buyer", asOfBlock: args.block },
  );
}

/** The floor's LEVEL, which a depositor sizes against. */
export function floorLevelRow(args: {
  pair: string;
  floor: string;
  fieldPath: string;
  block: number | null;
}): RiskRow {
  return row(
    "floor-level",
    `The ${args.pair} floor`,
    measured(args.floor, "below spot at open", args.fieldPath),
    { asOfBlock: args.block },
  );
}

/** The floor's COUNTERPARTY, which a depositor walks on. Two facts, two rows:
 *  as one sentence the level read as if it were guaranteed by arithmetic. */
export function floorVenueRow(): RiskRow {
  return row("floor-venue", "The floor is an option position", noThreshold("no level to watch"), {
    consequence: "it holds to the option venue only",
  });
}

// ── Exit ──────────────────────────────────────────────────────────────────

/**
 * `Unwinding kHYPE/WHYPE through the HYPE perp book · $8.7K · room left of $19.3K`.
 *
 * THREE CORRECTIONS TO THE ROW IT REPLACES, each measurable:
 *  · the BINDING moves out of a prose sentence and into the mechanism, where
 *    a noun belongs;
 *  · the figure is what is LEFT, not the gross book. `hype-funding-harvest`
 *    publishes $11.6K against its own $21K average ticket: one average deposit
 *    is 1.8x the whole book, and the gross number hides that;
 *  · the response cell is DELIBERATELY EMPTY. It printed `33.3%` — a margin
 *    ratio, offered as our clock in a race against a capacity bound. A ceiling
 *    is not a race and a ratio is not a response to one.
 */
export function exitCapacityRow(args: {
  marketNoun: string;
  bindingNoun: string;
  grossUsd: number | null;
  heldUsd: number | null;
  fieldPath: string;
  block: number | null;
  /** True where the binding's dollar figure is the product's assumed book
   *  rather than a venue scan (`isModeledBinding`). The collar's $1M option
   *  open interest is the only one today, and it printed bare. */
  modeled?: boolean;
}): RiskRow | null {
  if (!finite(args.grossUsd)) {
    return row(
      "exit-capacity",
      `Unwinding ${args.marketNoun} through ${args.bindingNoun}`,
      unmeasured("this record publishes no capacity"),
      { consequence: "past it the exit crosses the book" },
    );
  }
  const held = finite(args.heldUsd) ? args.heldUsd : null;
  const remaining = held !== null ? args.grossUsd - held : null;
  const usable = remaining !== null && remaining > 0 ? remaining : args.grossUsd;
  const denominator =
    remaining !== null && remaining > 0
      ? `room left of ${fmtCapacityUsd(args.grossUsd)}`
      : "deposit room at this composition";
  return row(
    "exit-capacity",
    `Unwinding ${args.marketNoun} through ${args.bindingNoun}`,
    measured(fmtCapacityUsd(usable), denominator, args.fieldPath, args.modeled ?? false),
    { consequence: "past it the exit crosses the book", asOfBlock: args.block },
  );
}

/**
 * `Refilling the HYPE short's margin · 15% · of short notional · funds 1 refill, then manual`.
 *
 * ONE ROW REPLACING TWO SPELLINGS OF ONE DIAL. The loop family printed this as
 * a bare refill COUNT (`1.00`, in a column that also held `$451K` and
 * `44829957`) and the funding family printed the identical value as a SHARE
 * (`15%`). Both are true readings of `reserveFraction` = 0.15; neither is
 * complete. The share is the reading, the count is the consequence, and the
 * count is rounded to a whole refill because two decimals on a dial with a
 * 0.05 step is false precision about a thing you cannot have a fraction of.
 *
 * `then manual` is the one honest actuation statement the register carried and
 * it survives verbatim in meaning: after the reserve is spent, a person acts.
 */
export function marginReserveRow(args: {
  coin: string;
  reserveFraction: number;
  fieldPath: string;
  block: number | null;
  response: RiskResponse | null;
}): RiskRow {
  const refills = Math.round(args.reserveFraction / RESERVE_MIN_FRACTION);
  const consequence =
    refills >= 1
      ? `funds ${refills} refill${refills === 1 ? "" : "s"}, then manual`
      : "funds no full refill, then manual";
  return row(
    "margin-reserve",
    `Refilling the ${args.coin} short's margin`,
    measured(pct(args.reserveFraction, 0), "of short notional", args.fieldPath),
    { consequence, response: args.response, asOfBlock: args.block },
  );
}

/**
 * `Leaving the BlackRock USD Institutional Digital Liquidity Fund through the
 * Circle USDC contract · same day · on the fastest route the issuer publishes`.
 *
 * THE REGISTER'S FIRST TIME-VALUED READING, and the one row on a treasury
 * lane that no other family has a version of. Every other exit row in this
 * section answers "how much can leave"; this one answers "how long does
 * leaving take", which on an issuer share is not a market question at all —
 * it is a term in a document, and the term differs by issuer by up to five
 * business days across the six rows the product ships.
 *
 * The reading is `stated`, not `measured`, and that is the honest state
 * rather than a hedge: `measured` in this file means a figure read from a
 * scan at a block, and no chain read exists for a transfer agent's cut-off.
 * What stands behind it is the issuer's own document, which is why the route
 * carries its `source` and why `notPublished` on the same terms names, one by
 * one, what the issuer does not say (founder ruling H-7).
 */
export function settlementWindowRow(args: {
  fundName: string;
  routeLabel: string;
  value: string;
}): RiskRow {
  return row(
    "settlement-window",
    `Leaving ${args.fundName} through ${args.routeLabel}`,
    stated(args.value, "on the fastest route the issuer publishes"),
    /* 47 of the 48 characters a clause is allowed, and both halves earn
       their place: the weight is stuck AND it is still paid, which is the
       exact shape a settlement leg has and the reason the wait is priced
       rather than weighted. */
    { consequence: "capital in the window earns but cannot be moved" },
  );
}

// ── Principal ─────────────────────────────────────────────────────────────

/** The row that stops the exit row above from reading as the whole of the
 *  exit problem. `structural` leaves the number column and becomes what it
 *  always was: the absence of a level. */
export function venueFreezeRow(venue: string, marketNoun: string): RiskRow {
  /* ⚠ OUT OF THE not-X-but-Y FRAME (G7, 2026-09-02). `stops the exit, not the
     position` is a rhetorical tic on a risk surface, and it made a reader
     parse a negation to find the second fact. Two facts, stated as two. */
  return row("venue-freeze", `${venue} freezing ${marketNoun}`, noThreshold("no level to watch"), {
    consequence: "the exit stops, the position stays",
  });
}

/**
 * The short leg, named with its venue, and NO CLAUSE (G7 minor, 2026-09-02).
 *
 * It carried `restoring margin sells into the move`, which is one of the
 * phrases the founder pasted back at us. The clause survived the deletion pass
 * on a technicality: `KILLED` banned the sentence WITH its full stop, and the
 * clause form has none, so an accidental punctuation carve-out was the only
 * thing keeping it alive. That is not a decision anybody made, so it is made
 * now: the row states the venue and the state, `KILLED` bans the clause form
 * as well as the sentence, and the reflexive-sale fact lives in the
 * `margin-reserve` row, whose reading is the reserve that funds the refill.
 */
export function shortReflexiveRow(coin: string, hedgeVenue: string): RiskRow {
  return row("short-reflexive", `The ${coin} short on ${hedgeVenue}`, noThreshold("no level to watch"));
}

/** Two legs, two venues. Kept only because the consequence is stated: as
 *  "they settle separately" it was true, interesting and decision-inert. */
export function twoVenuesRow(coin: string | null, pool: string): RiskRow {
  return row(
    "two-venues",
    coin ? `The ${pool} leg and the ${coin} perp leg` : `The ${pool} leg and the perp leg`,
    noThreshold("no level to watch"),
    { consequence: "lose the perp leg and the pool is unhedged" },
  );
}

/**
 * `Delta left unhedged between rebalances · ±4.0% · of position notional`.
 *
 * NEW, and it earns its row on the sizing test: a product sold as
 * delta-neutral holds up to 4% directional exposure by design on the loop and
 * dn-LP families and 0.5% on funding. An eight-fold difference in residual
 * delta between two vaults on one shelf changes how a depositor sizes, and it
 * was printed one panel away from the register or not at all.
 */
export function deltaBandRow(args: {
  bandPct: number;
  fieldPath: string;
  block: number | null;
}): RiskRow {
  return row(
    "delta-band",
    "Delta left unhedged between rebalances",
    measured(band(args.bandPct / PERCENT, 1), "of position notional", args.fieldPath),
    { consequence: "that much stays directional", asOfBlock: args.block },
  );
}

// ── Yield ─────────────────────────────────────────────────────────────────

/** The carry inverting: nothing liquidates, the lane stops paying. The second
 *  half of that sentence is what the section heading says, so it is not
 *  repeated as a clause. */
export function carrySpreadRow(args: {
  collateral: string;
  debt: string;
  spread: string | null;
  fieldPath: string;
  block: number | null;
}): RiskRow {
  const mechanism = `${args.debt} borrow cost against ${args.collateral} yield`;
  if (!args.spread) {
    return row(
      "carry-spread",
      mechanism,
      unmeasured("the borrow rate is not published on this record", "borrow cost"),
    );
  }
  return row("carry-spread", mechanism, measured(args.spread, "spread per turn", args.fieldPath), {
    asOfBlock: args.block,
  });
}

/**
 * The funding rate the short collects, as a MEASUREMENT.
 *
 * The denominator says `lower-quartile APR` and not `p25`: a plain noun
 * decoded at zero cost beats a statistician's abbreviation in a column a
 * depositor reads once, and it keeps the one digit out of a string literal.
 *
 * ⚠ SPLIT FROM THE GUARD ON PURPOSE. One register id printed a positive p25
 * measurement (`+10.9%`) on a canvas loop lane and a negative floor SETTING
 * (`−5.0%`) on a funding record, under one label about funding turning
 * negative — two quantities of opposite sign in one cell, with no column
 * saying which. They are two rows now, and each cell names its own frame.
 */
export function fundingP25Row(args: {
  coin: string;
  value: string | null;
  fieldPath: string;
  block: number | null;
  /**
   * ⚠ THE SURFACE SUPPLIES THE ABSENCE, AND THERE IS NOW ONE SPELLING OF IT
   * PER SURFACE (G7 major, 2026-09-02). This dial is unpublished on every
   * record, and the product spelled that one state two ways on one product:
   * `measured on the canvas, absent from this record` where the Yield group
   * folded (the hedged loop records) and `lower-quartile APR, not published on
   * this record` where it did not (the dn-LP and the three funding records).
   * Two spellings of one state is the thing this file refuses everywhere else.
   *
   * The record adapter passes its own absence — the SAME string the fold uses
   * — so a row and the group above it cannot disagree and no two families
   * disagree either. The default is the CANVAS's, and it carries no record
   * noun: a builder composing a lane has published nothing, so `on this
   * record` was a noun leaking from one surface onto the other.
   */
  absence?: string | null;
}): RiskRow {
  const mechanism = `Funding on ${args.coin}`;
  if (!args.value) {
    return row(
      "funding-p25",
      mechanism,
      unmeasured(args.absence ?? "lower-quartile APR, not published for this market", "funding APR"),
    );
  }
  return row("funding-p25", mechanism, measured(args.value, "lower-quartile APR at the pinned block", args.fieldPath), {
    asOfBlock: args.block,
  });
}

/**
 * The guard floor, as a SETTING, with what it does beside it.
 *
 * The unmeasured branch is a finding, not a fallback: `fundingFloorApr` is
 * null on every hedged LOOP record while every funding record carries one, so
 * a loop depositor's short collects funding with no automated exit when
 * funding inverts and nothing on the page said so. The absence is the row.
 */
export function fundingGuardRow(args: {
  coin: string;
  floor: string | null;
  fieldPath: string;
  block: number | null;
  response: RiskResponse | null;
}): RiskRow {
  const mechanism = `Funding on ${args.coin} turning negative`;
  if (!args.floor) {
    return row(
      "funding-guard",
      mechanism,
      unmeasured("no guard floor published on this record", "funding floor"),
      { consequence: "the carry stops, nothing exits" },
    );
  }
  return row(
    "funding-guard",
    mechanism,
    measured(args.floor, "APR floor, published setting", args.fieldPath),
    {
      consequence: "the carry stops, the deposit stays",
      response: args.response,
      asOfBlock: args.block,
    },
  );
}

/**
 * `Price leaving the WETH/USDC LP range · ±8% · of spot; outside it fees stop`.
 *
 * THE VALUE IS THE FIX. This row's own field path is `auto-center.rangePct` and
 * it printed the ACTION-COUNT axis against it — `1,600 actions/yr`, a recenter
 * frequency answering a question about how far price can travel. The unit did
 * not match the claim.
 */
export function rangeWidthRow(args: {
  pool: string;
  rangePct: number;
  fieldPath: string;
  block: number | null;
}): RiskRow {
  return row(
    "range-width",
    `Price leaving the ${args.pool} range`,
    measured(band(args.rangePct / PERCENT, 1), "of spot; outside it fees stop", args.fieldPath),
    { asOfBlock: args.block },
  );
}

/**
 * The roll cost, PRICED. It printed `12.2 actions/yr` under a mechanism that
 * says the roll pays a spread, and the prose asserted a cost the value never
 * carried. Either the cost prints or the row does not exist; the model owns
 * the number (`collarModel`'s own `Roll execution` leg), so it prints.
 */
export function rollCostRow(args: {
  pair: string;
  costApr: string | null;
  fieldPath: string;
  block: number | null;
}): RiskRow {
  const mechanism = `Each roll of the ${args.pair} collar pays the spread`;
  if (!args.costApr) {
    return row(
      "roll-cost",
      mechanism,
      unmeasured("the roll cost is not priced on this record", "roll cost"),
    );
  }
  /* MODELED AT THE SOURCE. The number is `collarModel`'s own `Roll execution`
     leg at one flat volatility, not a quote from an option venue, so the
     provenance travels with the figure instead of as a footer sentence a
     reader may never reach. */
  return row(
    "roll-cost",
    mechanism,
    measured(args.costApr, "APR, roll execution", args.fieldPath, true),
    { asOfBlock: args.block },
  );
}

// ── Counterparties ────────────────────────────────────────────────────────

/**
 * ONE ROW PER CLASS, EACH WITH ITS OWN COVERAGE STATE.
 *
 * The register comma-joined three class NAMES into one label, space-joined
 * three ACT sentences into one ~130-character cell (which starved the action
 * track badly enough to earn a named layout constant), and collapsed three
 * DIFFERENT coverage states into one word — so a depositor was told the venue
 * was `clear` while `Contract upgrade` sat behind no gate at all. One row per
 * class closes the false verdict, the caveat sentence that was patching it in
 * prose, and the layout hack, in one move.
 *
 * `clear` MAY ONLY APPEAR BESIDE A CLASS WHOSE SIGNAL LIST IS NON-EMPTY, and
 * `validateRiskRow` refuses the row otherwise.
 */
export function counterpartyRows(rows: readonly DependencyRow[], block: number | null = null): RiskRow[] {
  const out: RiskRow[] = [];
  for (const dep of rows) {
    const failingSet = new Set(dep.failing);
    for (const k of dep.classes) {
      const read = dep.tier === "measured" && k.signal.length > 0;
      const failing = k.signal.filter((g) => failingSet.has(g));
      const coverage: RiskCoverage = !read ? "unread" : failing.length > 0 ? "failing" : "clear";
      out.push({
        id: `${EXO_ROW_PREFIX}${dep.id}:${classSlug(k.name)}`,
        section: "counterparty",
        mechanism: k.name,
        reading: read
          ? measured(
              coverageWord(coverage),
              `read by the scan at this block`,
              "lane.candidate.failedGates",
            )
          : /* ⚠ THE CLASS NAME IS THE FOLD NOUN (G7 major, 2026-09-02). Nine
               consecutive rows of the dn-LP lane read the IDENTICAL `not
               measured / nothing on this lane reads it`, and this row could
               not fold because it named no quantity. It names one now, so
               `sectionAbsence` states the absence once and lists what it
               covers — the class, or the party where every class of that party
               is unread. The consent gate is unchanged: the noun is here
               because this producer thought about the fold, not by default. */
            unmeasured("nothing on this lane reads it", k.name),
        consequence: null,
        /* ⚠ NO WRITTEN RESPONSE ON A CLASS NOTHING READS (G7 major, 2026-09-02).
           Seven of the ten class rows on the canvas read `not measured ·
           nothing on this lane reads it` and each still carried an imperative
           — `Hold cross-chain actions until it clears.`, `Refuse the price
           until the read lands.` A rule whose trigger nothing reads has no
           input and no output; it is not a response, it is a sentence about
           a response. It is withheld exactly as a bare-quantity response is
           already withheld by `validateRiskRow`, and the footer's count then
           distinguishes the classes that HAVE a trigger from the ones that
           cannot: `7 readings not taken · 3 written responses`, where it used
           to say ten. The rule is not lost — it returns the moment something
           reads the class. */
        response: read ? { trigger: k.act, cadence: null, armed: false } : null,
        asOfBlock: read ? block : null,
        coverage,
        party: { id: dep.id, label: dep.party, because: dep.because },
      });
    }
  }
  return out;
}

/** The state word, in the reading slot, for a class the scan actually read.
 *  `stale` is the derivation's own fourth state and it maps straight through. */
function coverageWord(c: RiskCoverage): string {
  return c;
}

/** A class name as an id fragment. Lower case, hyphenated, digit-free by
 *  construction because every class name is. */
function classSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");
}

/** The exogenous derivation's own state word, mapped onto this table's. One
 *  absence word reaches a reader, never two spellings of one state. */
export function coverageFromDependencyState(s: DependencyState): RiskCoverage {
  if (s === "clear") return "clear";
  if (s === "failing") return "failing";
  if (s === "stale") return "stale";
  return "unread";
}

// ══ THE TABLE ══════════════════════════════════════════════════════════════

/** The dependencies no vault here watches, said ONCE, at product level. It
 *  was byte-identical on every vault with only the pair swapped, which is the
 *  definition of a statement that is not about this vault. */
export const UNWATCHED_LINE =
  "Not watched: feed age, oracle, bridge, stablecoin and RPC health.";

/** What a funding record says about its vintage. It pins no block — verified
 *  on all three seeds — and the absence is stated rather than left blank. */
export const NO_BLOCK_NOTE = "Priced from one read of the venue funding table. No block pinned.";

/** The same law for every other family: a record priced from the product's own
 *  model rather than from a scan pins no block either, and a blank stamp would
 *  let a reader take the figures above it for a live reading. */
export const MODELED_NO_BLOCK_NOTE = "Priced from the product's own model. No block pinned.";

export function armingFor(armed: boolean): RiskArming | null {
  if (armed) return null;
  return {
    label: "Automations",
    value: "compiled, not armed",
    note: "Watchers read. Nothing acts.",
  };
}

export interface RiskTableFacts {
  family: RiskFamily;
  armed: boolean;
  /** True where the overlay is placed and the parties are rows of their own. */
  partiesAreRows: boolean;
  /** Where the surface pins no block at all, what it does say instead. */
  asOfNote?: string | null;
  modeled?: boolean;
  /**
   * WHERE A QUANTITY THIS SURFACE CANNOT READ IS ACTUALLY READ — the second
   * half of a collapsed group's one line, supplied by the surface because only
   * the surface knows what it is NOT. A record knows the canvas measures what
   * the record dropped; the canvas has nowhere to point and passes nothing, so
   * no group collapses there and every row states its own absence as before.
   */
  absenceElsewhere?: string | null;
}

/**
 * THE COLLAPSE, AND ITS FIVE CONDITIONS.
 *
 * Every one of them is a refusal to fold a row that still has something
 * distinct to say. What is folded is the group's UNMEASURED SUBSET; a measured
 * row is never touched and never moves.
 *
 *   1 · two foldable rows or more — one row is already one statement;
 *   2 · the reading `unmeasured` — a figure is information a fold deletes;
 *   3 · the row naming its own `quantity` — the noun is the row's consent, so
 *       a producer that has not thought about the fold does not get folded;
 *   4 · NO WRITTEN RESPONSE on any folded row. A rule a depositor can read is
 *       the one thing in this table that is not a reading, and folding it away
 *       would hide it while the footer went on counting it;
 *   5 · two DISTINCT nouns or more, and somewhere for the absence to point:
 *       either the rows AGREE on their own denominator (then that agreed
 *       sentence IS the absence, said once) or the surface supplies where the
 *       reading is taken. Without one of the two, `not measured` on its own is
 *       the shrug this table refuses.
 *
 * ⚠ 5 HAS TWO ARMS ON PURPOSE, AND THE FIRST IS THE NEW ONE. The Yield group's
 * rows can end in DIFFERENT near-identical captions, so there is nothing to
 * reuse and the surface must supply the one sentence (`absenceElsewhere`). The
 * counterparty section is the opposite shape: every unread class already ends
 * in the SAME sentence — `nothing on this lane reads it` — and that sentence
 * is not a shrug, it is the finding. Reusing it states one absence once;
 * inventing a second spelling beside it is the defect one section over.
 *
 * ⚠ THE NOUN OF A COUNTERPARTY ROW IS ITS PARTY WHERE THE PARTY IS WHOLLY
 * UNREAD, and its class otherwise. On a lane that reads nothing, the six party
 * names are the only differentiating content on eleven rows and they survive
 * the fold; on a lane that reads SOME classes of a party, naming that party as
 * unread would be false — `The venue` is read on `Partner pause` and blind on
 * `Contract upgrade` — so the class name is the honest noun there.
 *
 * ⚠ AND THE TWO KINDS OF NOUN DO NOT SHARE A CONJUNCTION (G7 minor, re-review
 * #4). On the leveraged-loop lane with the exogenous module placed, the fold
 * read `The bridge, Contract upgrade, the hedge venue and the scan`: three
 * PARTIES, lowered because they are stored sentence-initial, and one risk
 * CLASS, stored capitalised for the mechanism column, arriving upper case in
 * the middle of a lower-case list. A reader parses the run as counterparties
 * and hits an event. Two fixes, both here: the class noun is lowered the way
 * the party noun is, and it is said WHOSE class it is (`the venue's contract
 * upgrade`) — which is also the honest reading, since the class is folded
 * precisely because that party is partly read. `sectionAbsence` then keeps the
 * two runs apart rather than comma-joining them into one list, and says the
 * owner ONCE per party (`the venue's contract upgrade and escrow freeze`,
 * never the owner twice in one run).
 */
type FoldNoun =
  | { kind: "party"; noun: string }
  | { kind: "class"; owner: string | null; noun: string };

function foldableNoun(r: RiskRow, whollyUnreadParties: ReadonlySet<string>): FoldNoun | null {
  if (r.reading.state !== "unmeasured") return null;
  if (r.response !== null) return null;
  const party = r.party;
  /* The party label is stored sentence-initial (`The bridge`) because it heads
     a subtitle row. Inside the fold's list it is one noun among several, so it
     is lowered here and `sentenceOpen` lifts the list's own first letter —
     the same discipline the Yield nouns already keep. */
  if (party && whollyUnreadParties.has(party.id)) {
    return { kind: "party", noun: sentenceLower(party.label) };
  }
  const q = r.reading.quantity;
  if (!q) return null;
  /* A class is an EVENT, not a party, so it is never left standing in a run of
     parties: it wears its owner, and `sectionAbsence` prints that owner once
     however many of its classes fold. The Yield group has no parties at all
     and falls through to the bare lowered noun, which is what it has always
     printed. */
  return { kind: "class", owner: party ? sentenceLower(party.label) : null, noun: sentenceLower(q) };
}

/** `the venue` → `the venue's`. Only the six `PARTY_LABEL` strings reach it,
 *  and the plural arm is there so a party named later cannot print `s's`. */
function possessive(label: string): string {
  return label.endsWith("s") ? `${label}'` : `${label}'s`;
}

/** The parties in this group with NOT ONE readable row. Their label may stand
 *  in for their classes in the fold; a party with any reading may not. */
function whollyUnreadPartiesOf(rows: readonly RiskRow[]): Set<string> {
  const all = new Set<string>();
  const read = new Set<string>();
  for (const r of rows) {
    const id = r.party?.id;
    if (!id) continue;
    all.add(id);
    if (r.reading.state !== "unmeasured" || r.response !== null) read.add(id);
  }
  for (const id of read) all.delete(id);
  return all;
}

function sectionAbsence(
  rows: readonly RiskRow[],
  elsewhere: string | null,
): { absence: RiskSectionAbsence; shown: RiskRow[] } | null {
  const parties = whollyUnreadPartiesOf(rows);
  const folded: RiskRow[] = [];
  const partyNouns: string[] = [];
  /* Classes keyed by owner, in first-seen order, so one party's two folded
     classes read `the venue's contract upgrade and escrow freeze` rather than
     naming the venue twice in one run. `""` is the ownerless bucket the Yield
     group uses. */
  const byOwner = new Map<string, string[]>();
  const dens = new Set<string>();
  let classCount = 0;
  for (const r of rows) {
    const n = foldableNoun(r, parties);
    if (!n) continue;
    folded.push(r);
    if (n.kind === "party") {
      if (!partyNouns.includes(n.noun)) partyNouns.push(n.noun);
    } else {
      const key = n.owner ?? "";
      const bucket = byOwner.get(key) ?? [];
      if (!bucket.includes(n.noun)) {
        bucket.push(n.noun);
        classCount++;
      }
      byOwner.set(key, bucket);
    }
    dens.add(r.reading.denominator ?? "");
  }
  const classNouns = [...byOwner.entries()].map(([owner, ns]) =>
    owner.length > 0 ? `${possessive(owner)} ${listAnd(ns)}` : listAnd(ns),
  );
  // The count is DISTINCT NOUNS, not phrases: two classes of one party are two
  // things folded away even though they share one owner and one phrase.
  if (folded.length < 2 || partyNouns.length + classCount < 2) return null;
  /* THE ROWS' OWN SENTENCE WHERE THEY ALL SHARE ONE, the surface's otherwise.
     A shared denominator is already the group's one true statement of where
     the reading would have come from; a fold that discarded it to print a
     different sentence would be the second spelling this whole ruling is
     about. */
  const shared = dens.size === 1 ? [...dens][0] : "";
  const denominator = shared.length > 0 ? shared : elsewhere;
  if (!denominator) return null;
  const foldedIds = new Set(folded.map((r) => r.id));
  return {
    absence: { mechanism: sentenceOpen(listRuns(partyNouns, classNouns)), denominator },
    shown: rows.filter((r) => !foldedIds.has(r.id)),
  };
}

/** `a, b and c`. The product's own list grammar, so a collapsed group reads
 *  like the unwatched line rather than like a serialised array. */
function listAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** Parties first, then classes, and NEVER comma-joined into one run: a list
 *  that mixes who with what reads as a list of who until it does not. Either
 *  run alone is just `listAnd`, which is every case the Yield group sees. */
function listRuns(partyNouns: readonly string[], classNouns: readonly string[]): string {
  if (partyNouns.length === 0) return listAnd(classNouns);
  if (classNouns.length === 0) return listAnd(partyNouns);
  return `${listAnd(partyNouns)}, and ${listAnd(classNouns)}`;
}

/** The mechanism column opens upper case on every other row and this one is a
 *  mechanism. The nouns are stored lower case so they read correctly INSIDE
 *  the list, and the first letter is lifted here rather than at each author. */
function sentenceOpen(text: string): string {
  return text.length === 0 ? text : text[0].toUpperCase() + text.slice(1);
}

/** The inverse, for a noun that is stored sentence-initial and lands mid-list.
 *  `The bridge` is a subtitle; `the bridge` is an item. */
function sentenceLower(text: string): string {
  return text.length === 0 ? text : text[0].toLowerCase() + text.slice(1);
}

/**
 * WHICH SURFACE IS ASKING, ANSWERED ONCE.
 *
 * `absenceElsewhere` is non-null on a published record and null on the canvas,
 * and it is already the input every producer carries, so it is the surface
 * flag rather than a second one. A row whose absence is EXACTLY the fold's
 * absence passes nothing and takes `absenceElsewhere` itself, which is what
 * makes the row and the fold above it say one sentence. A row with its own
 * record wording passes that wording as `whenRecord`.
 */
function recordAbsence(elsewhere: string | null | undefined, whenRecord?: string): string | null {
  if (!elsewhere) return null;
  return whenRecord ?? elsewhere;
}

/** The record's own reason for the short line's absence, and it is NOT the
 *  fold's sentence — a different fact, in different words, so the two read as
 *  two findings rather than one repeated. See `shortLineRow.absence`. */
const SHORT_LINE_ABSENT_ON_RECORD =
  "the coin's maintenance margin is not derivable from the published ladder";

/**
 * Group, drop and stamp. A section with no rows does not render: an empty
 * heading claims a class exists here and we found nothing in it, which is a
 * completeness claim nobody can make.
 */
export function assembleRiskTable(rows: readonly RiskRow[], facts: RiskTableFacts): RiskTable {
  const kept = rows.filter((r) => validateRiskRow(r).length === 0);
  const sections: RiskSectionBlock[] = [];
  for (const s of RISK_SECTION_ORDER) {
    const inSection = kept.filter((r) => r.section === s);
    if (inSection.length === 0) continue;
    const fold = sectionAbsence(inSection, facts.absenceElsewhere ?? null);
    sections.push({
      section: s,
      heading: RISK_SECTION_HEADING[s],
      rows: inSection,
      shown: fold ? fold.shown : inSection,
      absence: fold ? fold.absence : null,
    });
  }
  /* THE OLDEST BLOCK, and it is stated as the table's stamp rather than as a
     row. Every measured figure already carried this and no renderer printed
     it; where two rows disagree the older one is the one the table can stand
     behind. */
  const blocks = kept
    .map((r) => r.asOfBlock)
    .filter((b): b is number => finite(b) && b > 0);
  const asOf = blocks.length > 0 ? blockStamp(Math.min(...blocks)) : null;
  const readable = kept.filter(
    (r) => r.reading.state === "measured" || r.reading.state === "unmeasured",
  ).length;
  const measuredCount = kept.filter((r) => r.reading.state === "measured").length;
  return {
    family: facts.family,
    title: RISK_TABLE_TITLE,
    arming: armingFor(facts.armed),
    sections,
    footer: {
      asOf,
      /* A STAMP IS NEVER BLANK. Where no row could be read at a block the
         footer says so in the surface's own words, because an empty stamp is
         indistinguishable from a stamp the reader has not scrolled to. */
      asOfNote: asOf === null ? (facts.asOfNote ?? MODELED_NO_BLOCK_NOTE) : null,
      measured: measuredCount,
      readable,
      unwatched: facts.partiesAreRows ? null : UNWATCHED_LINE,
      modeled: facts.modeled ?? false,
    },
  };
}

/** True where a figure in this lane's table is a MODEL ASSUMPTION rather than
 *  a venue reading. The collar's capacity is the only one today, and the word
 *  `modeled` belongs on the number rather than in a row of its own — which is
 *  what retires the flat-vol entry. */
export function laneModeled(lane: AxisLane): boolean {
  return isModeledBinding(lane.candidate?.economics?.capacityBinding);
}

/**
 * THE CANVAS ENTRY POINT — one call for the dock, mirroring
 * `lib/vaults/risk-table.ts` `riskTableForVault` for the record.
 *
 * Both surfaces must move together or they diverge further than they already
 * have: the dock concatenated the why and the reaction onto one italic line
 * while the vault page put the reaction in its own cell after an arrow, which
 * is exactly what happens when a model offers one prose field and each
 * component invents its own table. The shape is here; neither renders it its
 * own way.
 */
export function riskTableForLane(
  input: RiskLaneInput,
  dependencies: readonly DependencyRow[] = [],
): RiskTable {
  const parties = counterpartyRows(dependencies, input.blockNumber);
  return assembleRiskTable([...laneRiskRows(input), ...parties], {
    family: input.family,
    armed: input.armed,
    partiesAreRows: parties.length > 0,
    modeled: laneModeled(input.lane),
    /* A treasury lane pins no block, and the footer's fallback sentence for
       that state says the figures were priced from the product's own model.
       On this family that is false: the rate and the capacity denominator are
       measured fund readings with a date on them. Null on every other row, so
       nothing else moves. */
    asOfNote: treasuryAsOfNote(input.lane.candidate?.id),
  });
}

/** Every row of a table, flattened. The gates read this, so a claim hidden in
 *  a section nobody renders does not count as said. */
export function tableRows(t: RiskTable): RiskRow[] {
  return t.sections.flatMap((s) => s.rows);
}

/** Everything one row says, as one string. The copy gates read this. */
export function rowLine(r: RiskRow): string {
  return [
    r.mechanism,
    r.reading.value ?? "",
    r.reading.denominator ?? "",
    r.consequence ?? "",
    r.response?.trigger ?? "",
    r.response?.cadence ?? "",
  ]
    .filter((s) => s.length > 0)
    .join(" · ");
}

// ══ THE MARGIN RULE, ONE OWNER ═════════════════════════════════════════════

/**
 * `margin 6.5% → 23%` — the written response on the two rows that have one.
 *
 * Both edges are the ones the instrument card and the Parameters panel already
 * print from the same automation object, so the table cannot disagree with the
 * page above it. Extracted here because BOTH producers state it and a second
 * copy is how two families come to spell one rule two ways.
 */
export function marginRuleResponse(args: {
  trimBelowPct: number | null | undefined;
  restorePct: number | null | undefined;
  cadence: string | null;
  armed: boolean;
}): RiskResponse | null {
  if (!finite(args.trimBelowPct) || !finite(args.restorePct)) return null;
  return {
    trigger: `margin ${dialPct(args.trimBelowPct)} ${ARROW} ${dialPct(args.restorePct)}`,
    cadence: args.cadence,
    armed: args.armed,
  };
}

/** A ladder edge stored as a PERCENT number, printed through the one
 *  formatter that may emit `%`. Whole edges print whole. */
function dialPct(v: number): string {
  return pct(v / PERCENT, Number.isInteger(v) ? 0 : 1);
}

/** `close the short after 3 periods under it`. */
export function guardResponse(args: {
  periods: number | null | undefined;
  cadence: string | null;
  armed: boolean;
}): RiskResponse | null {
  if (!finite(args.periods) || args.periods < 1) return null;
  return {
    trigger: `close the short after ${args.periods} period${args.periods === 1 ? "" : "s"} under it`,
    cadence: args.cadence,
    armed: args.armed,
  };
}

// ══ THE LANE PRODUCER (loop, dn-LP, collar) ════════════════════════════════

/**
 * What a lane-backed surface hands the derivation.
 *
 * `published` carries the dials a RECORD states that the lane projection drops
 * on the floor — the delta band, the margin ladder, the held TVL. They are
 * published fields, not guesses, and routing them here rather than widening
 * the projection keeps `store.ts` the one author of what a lane IS.
 */
export interface RiskLaneInput {
  lane: AxisLane;
  family: Exclude<RiskFamily, "funding">;
  blockNumber: number | null;
  armed: boolean;
  cadence?: { leverage?: string | null; hedge?: string | null };
  /** The record's own trim drift, where a record owns this lane. Absent means
   *  a live canvas lane and the preset derivation stands; `null` means the
   *  record cannot prove one, and no trim row renders. */
  trimDrift?: number | null;
  /**
   * WHERE A DIAL THIS SURFACE CANNOT READ IS ACTUALLY READ, in the surface's
   * own noun — the same string the surface hands `assembleRiskTable` as
   * `absenceElsewhere`. Supplied, never derived: a row that spelled its own
   * absence one way while the fold above it spelled the same absence another
   * way is the defect this closes. Absent means the canvas, whose rows carry a
   * record-free default.
   */
  absenceElsewhere?: string | null;
  published?: {
    deltaBandPct?: number | null;
    marginTrimBelowPct?: number | null;
    marginRestorePct?: number | null;
    fundingDeallocPeriods?: number | null;
    heldUsd?: number | null;
  };
}

export function laneRiskRows(input: RiskLaneInput): RiskRow[] {
  const lane = input.lane;
  const c = lane.candidate;
  if (!c) return [];
  const block = input.blockNumber;
  const pub = input.published ?? {};
  const hedged = lane.placed.includes("hedge");
  const borrows = liquidationLinesOfLane(lane).some((l) => l.kind === "borrow");
  const coin = c.hlCoin;
  const venue = venueLabel(c.venue);
  const out: RiskRow[] = [];

  // ── Forced exits ────────────────────────────────────────────────────────

  out.push(borrowLegRow(c.debtSymbol, borrows));

  const distance = liquidationDistance(c.lt, lane.appliedLeverage);
  out.push(
    depositLineRow({
      borrows,
      distanceValue: borrows ? adverseMoveValue(distance) : null,
      pairNoun: c.collateralSymbol && c.debtSymbol ? `${c.collateralSymbol}/${c.debtSymbol}` : c.pair,
      fieldPath: "lane.candidate.lt",
      block,
    }),
  );

  if (borrows) {
    const drift =
      input.trimDrift !== undefined
        ? input.trimDrift
        : driftBeforeTrim(lane.preset, lane.appliedLeverage, c.lt);
    if (finite(drift) && drift > 0) {
      out.push(trimFiresRow(ppMag(drift, 2), "lane.candidate.lt", block));
    }
  }

  const hedgeDials = lane.comp?.hedge ?? null;
  const marginRule = marginRuleResponse({
    trimBelowPct: pub.marginTrimBelowPct,
    restorePct: pub.marginRestorePct,
    cadence: input.cadence?.hedge ?? null,
    armed: input.armed,
  });

  if (hedged && hedgeDials) {
    const es = escrowShare(c, lane.comp);
    if (es && es.fb > 0 && es.fb < 1) {
      out.push(escrowRow(pct(1 - es.fb, 1), "lane.comp.hedge.hedgeLeverage", block));
    }
    const bands = shortLegBands(
      hedgeDials.hedgeLeverage,
      hedgeDials.reserveFraction,
      coinMaxLeverageFromMarginRule(pub.marginTrimBelowPct, pub.marginRestorePct),
    );
    if (bands) {
      const ratio = shortMarginValue(bands);
      if (ratio) {
        out.push(
          shortMarginRow({
            marginRatio: ratio,
            fieldPath: "lane.comp.hedge.hedgeLeverage",
            block,
            response: marginRule,
          }),
        );
      }
      out.push(
        shortLineRow({
          move: coinMoveMagnitude(bands.liqMove),
          coin,
          fieldPath: "lane.comp.hedge.hedgeLeverage",
          block,
          absence: recordAbsence(input.absenceElsewhere, SHORT_LINE_ABSENT_ON_RECORD),
        }),
      );
      if (finite(bands.trimMove) && coin) {
        out.push(
          shortTrimRow({
            move: coinMoveMagnitude(bands.trimMove) ?? NOT_MEASURED,
            coin,
            fieldPath: "lane.comp.hedge.hedgeLeverage",
            block,
          }),
        );
      }
    }
  }

  if (!hedged && input.family === "loop") out.push(priceCarriedRow(c.collateralSymbol));

  if (input.family === "collar") {
    const strike = readAxis("upsideCap", lane)?.text ?? null;
    if (strike) {
      out.push(
        upsideSoldRow({
          pair: c.pair,
          strike,
          fieldPath: "lane.params.covered-call.strikePct",
          block,
        }),
      );
    }
    const floor = readAxis("downsideFloor", lane)?.text ?? null;
    if (floor) {
      out.push(
        floorLevelRow({
          pair: c.pair,
          floor,
          fieldPath: "lane.params.protective-put.floorPct",
          block,
        }),
      );
      out.push(floorVenueRow());
    }
  }

  // ── Exit ────────────────────────────────────────────────────────────────

  const cap = readAxis("capacity", lane);
  const capValue = cap && typeof cap.value === "number" ? cap.value : null;
  const exit = exitCapacityRow({
    marketNoun: c.pair,
    bindingNoun: capacityBindingLabel(c, hedged),
    grossUsd: capValue,
    heldUsd: pub.heldUsd ?? null,
    fieldPath: "lane.candidate.economics.capacityUsd",
    block,
    /* The collar's book is an assumption (`COLLAR_CAPACITY_BINDING`), and the
       binding noun already says so; the figure now says so too, so a surface
       that prints the number without the noun cannot print it bare. */
    modeled: laneModeled(lane),
  });
  if (exit) out.push(exit);

  /* THE TREASURY FAMILY'S OWN EXIT ROW. Guarded on the ROW carrying issuer
     terms, not on `input.family`: a lane whose family says treasury but whose
     pinned row publishes no routes has nothing to state, and a lane pinned to
     an issuer row states its window whatever the graph currently calls it.
     The terms travel on the row (`economics.terms.redemption`), so this reads
     one owner rather than deriving a settlement window from a venue name. */
  const redemption = issuerRedemptionTerms(c.id);
  const issuer = treasuryIssuerFacts(c.id);
  if (redemption && issuer) {
    /* The route a lane leaves by unless the builder picks another, resolved
       once: two calls would be two chances to disagree about which route the
       row is describing. */
    const route = fastestExitRoute(redemption);
    out.push(
      settlementWindowRow({
        fundName: issuer.fundName,
        routeLabel: route.label,
        value: settlementWindowValue(route),
      }),
    );
  }

  if (hedged && hedgeDials && finite(hedgeDials.reserveFraction) && coin) {
    out.push(
      marginReserveRow({
        coin,
        reserveFraction: hedgeDials.reserveFraction,
        fieldPath: "lane.comp.hedge.reserveFraction",
        block,
        response: marginRule,
      }),
    );
  }

  // ── Principal ───────────────────────────────────────────────────────────

  out.push(
    venueFreezeRow(
      venue,
      input.family === "dnlp" ? `the ${c.pair} pool` : `the ${c.collateralSymbol} market`,
    ),
  );

  if (hedged && coin) {
    const hedgeVenue = readAxis("offChainVenues", lane)?.text ?? null;
    if (hedgeVenue) out.push(shortReflexiveRow(coin, hedgeVenue));
  }

  if (input.family === "dnlp") out.push(twoVenuesRow(coin, c.pair));

  const bandPct = deltaBandOf(lane, pub.deltaBandPct);
  if (hedged && finite(bandPct)) {
    out.push(deltaBandRow({ bandPct, fieldPath: "lane.comp.hedge.deltaBandPct", block }));
  }

  // ── Yield ───────────────────────────────────────────────────────────────

  if (input.family === "loop" && borrows) {
    const e = c.economics;
    out.push(
      carrySpreadRow({
        collateral: c.collateralSymbol,
        debt: c.debtSymbol,
        spread: e ? carry(e.collateralYieldApy, e.borrowApyMarginal) : null,
        fieldPath: "lane.candidate.economics.borrowApyMarginal",
        block,
      }),
    );
  }

  if (hedged && coin) {
    const p25 = c.economics?.fundingP25Apr;
    out.push(
      fundingP25Row({
        coin,
        value: finite(p25) ? pct(p25, 1) : null,
        fieldPath: "lane.candidate.economics.fundingP25Apr",
        block,
        absence: recordAbsence(input.absenceElsewhere),
      }),
    );
    const guard = readAxis("guardTrigger", lane)?.text ?? null;
    out.push(
      fundingGuardRow({
        coin,
        floor: guard,
        fieldPath: "lane.params.hedge.fundingFloorApr",
        block,
        response: guardResponse({
          periods: pub.fundingDeallocPeriods,
          cadence: input.cadence?.hedge ?? null,
          armed: input.armed,
        }),
      }),
    );
  }

  if (input.family === "dnlp") {
    const rangePct = laneNumber(lane, "auto-center", "rangePct");
    if (finite(rangePct)) {
      out.push(
        rangeWidthRow({
          pool: c.pair,
          rangePct,
          fieldPath: "lane.params.auto-center.rangePct",
          block,
        }),
      );
    }
  }

  if (input.family === "collar") {
    out.push(
      rollCostRow({
        pair: c.pair,
        costApr: collarRollCost(lane),
        fieldPath: "lane.params.covered-call.rollDays",
        block,
      }),
    );
  }

  return out;
}

/** The band the lane runs, from the composition where it carries one and from
 *  the record's own published dial otherwise. One quantity, two carriers,
 *  never a descriptor default standing in for either. */
function deltaBandOf(lane: AxisLane, published: number | null | undefined): number | null {
  const fromComp = lane.comp?.hedge?.deltaBandPct;
  const n = typeof fromComp === "string" ? Number(fromComp) : fromComp;
  if (finite(n)) return n;
  const fromParams = laneNumber(lane, "hedge", "deltaBandPct");
  if (finite(fromParams)) return fromParams;
  return finite(published) ? published : null;
}

function laneNumber(lane: AxisLane, key: string, field: string): number | null {
  const raw = (lane.params as Record<string, Record<string, unknown> | undefined>)[key]?.[field];
  const n = typeof raw === "string" ? Number(raw) : raw;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/**
 * The collar's roll cost, from the model's own `Roll execution` leg. The leg
 * carries the cost as a NEGATIVE apr because it is a subtraction inside the
 * net; the row prints the magnitude, because the mechanism already says it is
 * paid. Null on an off-grid dial, exactly as `collarModel` is.
 */
function collarRollCost(lane: AxisLane): string | null {
  const strikePct = laneString(lane, "covered-call", "strikePct");
  const floorPct = laneString(lane, "protective-put", "floorPct");
  const rollDays = laneString(lane, "covered-call", "rollDays");
  if (!strikePct || !floorPct || !rollDays) return null;
  const dials: CollarDials = { strikePct, floorPct, rollDays };
  const leg = collarModel(dials)?.legs.find((l) => l.label.startsWith(ROLL_LEG));
  if (!leg || !finite(leg.apr)) return null;
  return pct(Math.abs(leg.apr), 1);
}

/** The model's own label for the roll leg. Matched, never retyped as a
 *  number: the leg is the owner of the cost and this is how it is found. */
const ROLL_LEG = "Roll execution";

function laneString(lane: AxisLane, key: string, field: string): string | null {
  const raw = (lane.params as Record<string, Record<string, unknown> | undefined>)[key]?.[field];
  if (typeof raw === "string" && raw.length > 0) return raw;
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return null;
}

// ══ THE FUNDING PRODUCER, from primitives ══════════════════════════════════

/**
 * A funding lane holds no collateral/debt pair, no candidate and no
 * projection, so it is fed primitives — but every row it emits is built by the
 * SAME helper the lane producer calls. That is what makes the render layer
 * branch on data and never on the family.
 */
export interface RiskFundingInput {
  marketNoun: string;
  coin: string;
  venue: string;
  armed: boolean;
  cadence: string | null;
  hedgeLeverage: number | null;
  reserveFraction: number | null;
  deltaBandPct: number | null;
  marginTrimBelowPct: number | null;
  marginRestorePct: number | null;
  fundingFloorApr: number | null;
  fundingDeallocPeriods: number | null;
  capacityUsd: number | null;
  heldUsd: number | null;
  blockNumber: number | null;
  /** The surface's own absence sentence — see `RiskLaneInput.absenceElsewhere`.
   *  This producer is reached only from a published record today, and it still
   *  takes the string rather than assuming: a producer that hard-codes which
   *  surface it is on is the thing that let `on this record` reach the canvas. */
  absenceElsewhere?: string | null;
}

export function fundingRiskRows(input: RiskFundingInput): RiskRow[] {
  const block = input.blockNumber;
  const out: RiskRow[] = [];
  const marginRule = marginRuleResponse({
    trimBelowPct: input.marginTrimBelowPct,
    restorePct: input.marginRestorePct,
    cadence: input.cadence,
    armed: input.armed,
  });

  // ── Forced exits. The family had none at all, on a position that IS a
  //    perp short, and the fact that it can be closed against a depositor
  //    was the fourth row of the third group.
  out.push(borrowLegRow(null, false));
  out.push(
    depositLineRow({
      borrows: false,
      distanceValue: null,
      pairNoun: input.marketNoun,
      fieldPath: "record.liqLtv",
      block,
    }),
  );
  out.push(positionWholeRow(input.coin, input.venue));

  const bands = shortLegBands(
    input.hedgeLeverage,
    input.reserveFraction,
    coinMaxLeverageFromMarginRule(input.marginTrimBelowPct, input.marginRestorePct),
  );
  if (bands) {
    const ratio = shortMarginValue(bands);
    if (ratio) {
      out.push(
        shortMarginRow({
          marginRatio: ratio,
          fieldPath: "record.automations.hedge.leverage",
          block,
          response: marginRule,
        }),
      );
    }
    out.push(
      shortLineRow({
        move: coinMoveMagnitude(bands.liqMove),
        coin: input.coin,
        fieldPath: "record.automations.hedge.leverage",
        block,
        absence: recordAbsence(input.absenceElsewhere, SHORT_LINE_ABSENT_ON_RECORD),
      }),
    );
    if (finite(bands.trimMove)) {
      out.push(
        shortTrimRow({
          move: coinMoveMagnitude(bands.trimMove) ?? NOT_MEASURED,
          coin: input.coin,
          fieldPath: "record.automations.hedge.leverage",
          block,
        }),
      );
    }
  } else {
    out.push(
      shortLineRow({
        move: null,
        coin: input.coin,
        fieldPath: "record.liqLtv",
        block,
        absence: recordAbsence(input.absenceElsewhere, SHORT_LINE_ABSENT_ON_RECORD),
      }),
    );
  }

  // ── Exit ────────────────────────────────────────────────────────────────
  const exit = exitCapacityRow({
    marketNoun: input.marketNoun,
    bindingNoun: `the ${input.coin} perp book at ${input.venue}`,
    grossUsd: input.capacityUsd,
    heldUsd: input.heldUsd,
    fieldPath: "record.capacityUsd",
    block,
  });
  if (exit) out.push(exit);

  if (finite(input.reserveFraction)) {
    out.push(
      marginReserveRow({
        coin: input.coin,
        reserveFraction: input.reserveFraction,
        fieldPath: "record.automations.hedge.reserveFraction",
        block,
        response: marginRule,
      }),
    );
  }

  // ── Principal ───────────────────────────────────────────────────────────
  out.push(venueFreezeRow(input.venue, `the ${input.coin} book`));
  out.push(shortReflexiveRow(input.coin, input.venue));
  if (finite(input.deltaBandPct)) {
    out.push(
      deltaBandRow({
        bandPct: input.deltaBandPct,
        fieldPath: "record.automations.hedge.deltaBandPct",
        block,
      }),
    );
  }

  // ── Yield ───────────────────────────────────────────────────────────────
  out.push(
    fundingP25Row({
      coin: input.coin,
      value: null,
      fieldPath: "record.automations.hedge.fundingFloorApr",
      block,
      absence: recordAbsence(input.absenceElsewhere),
    }),
  );
  out.push(
    fundingGuardRow({
      coin: input.coin,
      floor: finite(input.fundingFloorApr) ? pct(input.fundingFloorApr, 1) : null,
      fieldPath: "record.automations.hedge.fundingFloorApr",
      block,
      response: guardResponse({
        periods: input.fundingDeallocPeriods,
        cadence: input.cadence,
        armed: input.armed,
      }),
    }),
  );

  return out;
}
