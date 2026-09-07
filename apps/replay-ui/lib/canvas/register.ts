/**
 * THE RISK REGISTER, and the reclaim readout (REACTIVE_PRODUCT_LAW §3, §5.2).
 *
 * ══ WHAT THIS FILE IS FOR ══════════════════════════════════════════════════
 *
 * L6 retires the liquidation line as a headline: `deriveHfBands` places the
 * trim at `target − presetSpread` and `presetSpread` is strictly positive on
 * all three presets, so the trim fires strictly before the line on every
 * market at every setting, by construction. A surface printing that line as
 * "the risk" is describing a machine with the automations removed.
 *
 * What replaces it is not a softer sentence. It is the enumeration the founder
 * asked for: on a reactive system, risk is what DEFEATS the reaction. Every
 * threat is a race (L7) and both clocks are named or the missing one is
 * declared missing. Every entry names a mechanism, never a residual (L8), and
 * a threat that cannot be measured is named and never sized (L11).
 *
 * ══ THE FOUR GATES, AND HOW EACH IS ACTUALLY ENFORCED ══════════════════════
 *
 * (a) SCHEMA. `validateEntry` is run by `registerFor` on every entry it is
 *     about to return, and a failing entry is DROPPED rather than repaired.
 *     A surface that cannot prove its arithmetic prints nothing, and so does
 *     an entry. `measured` must carry a `fieldPath` that RESOLVES in the
 *     block-pinned payload; `blind` must carry no `value`; `defeats:
 *     "reaction"` must carry a non-null `reaction`.
 *
 * (b) THE COPY-PASTE TEST. Enforced in `__tests__/register.test.ts` over the
 *     whole fixture catalog.
 *
 *     ⚠ CORRECTION TO §3.1(b), and it is a fact about the catalog rather than
 *     a softening of the rule. §3.1 asks that "no produced line is
 *     character-identical across two rows". That is not reachable, and the
 *     reason is in the data: `lib/canvas/fixtures/aave-v3-base.json` carries
 *     TWO `weETH/WETH` rows and TWO `cbETH/WETH` rows — same venue, same
 *     symbols, different markets. No sentence built from the row's own nouns
 *     can separate them, so a literal pairwise gate would force a market id
 *     into human copy purely to satisfy a test. What the gate exists to catch
 *     is the WALL: a line that says the same thing on every vault forever. So
 *     the enforced form is NON-CONSTANCY per entry id across the catalog,
 *     which fails on exactly the wall and nothing else, plus the whole-
 *     register distinctness that the catalog does support.
 *
 * (c) THE HEDGE-WORD GREP. `HEDGE_WORDS` is exported so the test greps the
 *     produced strings rather than the source, which is the half that matters:
 *     a caveat assembled from two template halves is still a caveat.
 *
 * (d) NO NUMERIC LITERAL. Enforced two ways, because the source grep alone is
 *     both too weak and too strong. Too strong, because `xs.length > 0` and
 *     `pct(d, 0)` are numeric literals that never reach a reader; too weak,
 *     because a number can arrive as a digit inside a string. So:
 *       · SOURCE: no digit may appear inside any string or template literal in
 *         this file, and no numeric literal other than 0 and 1 (emptiness and
 *         singularity) may appear in code.
 *       · OUTPUT: strip every payload-derived substring from a produced entry
 *         and assert no digit survives. That is the direct proof of "every
 *         number arrives through a field path", and it is the one a future
 *         edit cannot talk its way around.
 *
 * ══ WHAT THIS FILE MAY NOT DO ══════════════════════════════════════════════
 *
 * It computes nothing. Every value is `readAxis` (the axis registry), a
 * formatter from `format.ts`, `capacity.ts`, `liquidation.ts` or
 * `hedge-econ.ts`, or a field read straight off the payload. `fundingP25Apr`
 * is reached only through `hedgeEconomics`, which is its sole accessor (R3).
 * There is no probability anywhere, by ratified ban, and that is why the
 * register is a list of races rather than a model.
 */

import { AXIS_RENDERERS, readAxis, type AxisId, type AxisLane } from "./axes";
import { capacityBindingLabel, isModeledBinding } from "./capacity";
import {
  controlId,
  dominates,
  rendersOn,
  settingLaneAt,
  settingLanes,
  type Control,
  type DominanceKind,
  type DominanceOptions,
} from "./dominance";
import { blockStamp, carry, lev, pct, ppMag } from "./format";
import { EVEN_FLOOR, hedgeEconomics } from "./hedge-econ";
import { venueLabel } from "./labels";
import { driftBeforeTrim, NOT_MEASURED } from "./liquidation";
import { liquidationLinesOfLane, verdictKey } from "./liquidation-lines";
import { MODULE_DEFS } from "./modules";
/* THE TABLE OWNS THE SHAPE. This file imports the clause cap and the
   action rule rather than restating them, so the legacy entries and the
   structured table cannot form two opinions about what a clause is or what
   makes a trigger an action. */
import {
  CONSEQUENCE_MAX,
  RESPONSE_ACTION_WORD as RESPONSE_IS_ACTION,
  RISK_MODELED_WORD,
  riskTableForLane,
  type RiskFamily,
  type RiskTable,
} from "./risk-table";
/* ONE OWNER for the dependency set. This file renders it; it derives nothing
   about a route, exactly as it derives nothing about a price. */
import { dependenciesOf, NO_SIGNAL_LINE as EXOGENOUS_NO_SIGNAL, watchViewOf } from "./exogenous";
import { handAuthoredTerms } from "./templates";
import type { ParamValue } from "./types";

/* ⟦TOLERANCE⟧ The only numeric literal in this file that is not 0 or 1, and
   it never reaches a reader. It is the identity tolerance the `hedge-econ`
   precedent set: a reclaim block whose stated cost does not equal the cost the
   pricing path produces renders nothing and the control comes back (L10). It
   is declared here, alone, so the numeric-literal gate can prove it is the
   only one. */
const IDENTITY_EPS = 1e-9;
/* ⟦/TOLERANCE⟧ */

const finite = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

// ══ THE ENTRY ══════════════════════════════════════════════════════════════

/**
 * What the mechanism defeats. Three, and the order below is the render order.
 *
 * Never ordered by severity, which would be a ranking claim across mechanisms
 * we cannot rank without probabilities we do not have.
 */
export type Defeats = "reaction" | "position" | "yield";

/**
 * The evidence tier (L11). There is no fourth tier and no unlabelled entry.
 * The tier is what lets the register grow without rotting: when a field starts
 * crossing the projection, one `blind` entry is promoted to `measured` in one
 * place and nothing else changes.
 */
export type EvidenceTier = "measured" | "structural" | "blind";

export interface RegisterEvidence {
  tier: EvidenceTier;
  /** Required on `measured`, forbidden elsewhere. Must resolve in the payload. */
  fieldPath?: string;
  /** The block the payload was pinned at (L12). Every claim inherits it. */
  blockNumber?: number;
  /** The rendered value. Forbidden on `blind` — an absence carries no number. */
  value?: string;
}

/**
 * OUR clock in the race (L7). `trigger` is what fires it; `cadence` is how
 * often we look, and it is null on a surface that cannot prove it — the canvas
 * holds no published check cadence, the vault page does. A null cadence prints
 * the trigger alone rather than a cadence nobody published.
 */
export interface RegisterReaction {
  trigger: string;
  cadence: string | null;
}

/**
 * THE ENTRY, WITH THE TABLE'S TYPED COLUMNS ON IT (2026-09-02).
 *
 * ══ WHAT CHANGED AND WHY IT HAD TO ═════════════════════════════════════════
 *
 * The founder's words: "this is way too wordy and I hate the AI slop aspect of
 * it. those info could be displayed but must be displayed as structured table
 * and not a wordy paragraph." He was right about the MECHANISM and not only
 * the tone. This model offered an author exactly ONE prose field (`why`) and
 * one opaque string slot (`entryValue`), so every fact a value could not carry
 * — the denominator, the binding resource, the as-of, the consequence — had to
 * be written as a SENTENCE. That is why every row ended in an italic line, and
 * a reader who sees one explain-clause under every row knows a machine wrote
 * it.
 *
 * The fix is not shorter sentences. `lib/canvas/risk-table.ts` owns the shape
 * — mechanism, reading (value + denominator + state + modeled), consequence,
 * response, as-of — and it is the surface's one source. This interface now
 * carries the same columns so the legacy producers emit the TABLE ROW SHAPE:
 * a renderer reading `consequence`/`denominator` gets the table's content
 * whether or not it has swapped, and no producer is handed a slot that only
 * takes prose.
 *
 * ⚠ `why` IS NO LONGER AUTHORED. Every hand-typed sentence in this file was
 * deleted; `why` is now assigned from `consequence` by `entry()` and carries a
 * CLAUSE, not a paragraph. It survives as a field only because two renderers
 * still read it (`ComposePanel`, `AutomationsSection`'s fallback), and it goes
 * when they do. The ONE exception is a promoted counterparty row, where `why`
 * carries the party's route line — the single fact no column on this table can
 * hold, and it travels in `party.because` alongside so a swapped renderer
 * reads it as data.
 */
export interface RegisterEntry {
  /** Stable across rows. The copy-paste gate groups on it. */
  id: string;
  /** Column 1. A mechanism, never a residual. */
  mechanism: string;
  /**
   * The clause a renderer that has not swapped still reads. DERIVED — see the
   * note above. Never write it directly; write `consequence`.
   */
  why: string;
  /** The consequence, as a CLAUSE: lower case, no terminal stop, hard cap
   *  `CONSEQUENCE_MAX`. Null wherever the mechanism or the section heading
   *  already says it — an author who cannot say it in 48 characters does not
   *  have a row, they have two. */
  consequence: string | null;
  /** THE DENOMINATOR, as a noun: what the value in `evidence.value` is a
   *  fraction, a count or a distance OF. `1.00` in a column that also held
   *  `$451K` and `44829957` was undecodable without the sentence beside it;
   *  `1.00 · refills the reserve funds` is not. On an absence it names what
   *  WOULD have measured it. */
  denominator: string | null;
  /** True where the figure is the product's own model rather than a venue
   *  reading, so no surface can print a modeled figure bare. */
  modeled?: boolean;
  /** The outside party a promoted counterparty row belongs to, and the route
   *  line that says why it is on this lane. Mirrors `RiskRow.party`. */
  party?: { id: string; label: string; because: string };
  defeats: Defeats;
  reaction: RegisterReaction | null;
  evidence: RegisterEvidence;
}

/**
 * THE ONE CONSTRUCTOR, and the reason the prose cannot come back.
 *
 * `why` is not a parameter. It is assigned from the clause, so there is no
 * slot on this function an author can put a sentence into, and the four
 * sentences the founder quoted back at us cannot be re-typed without adding a
 * field to this signature.
 */
export function registerEntry(e: Omit<RegisterEntry, "why">): RegisterEntry {
  return { ...e, why: e.party ? e.party.because : (e.consequence ?? "") };
}

/** The local name, so the producers below read as a list of rows rather than
 *  a list of calls. Exported under its full name because the SECOND producer
 *  (`lib/vaults/funding-register.ts`) builds entries too, and a second
 *  constructor is a second place a sentence could get back in. */
const entry = registerEntry;

/** The payload an entry is produced from, and the object `fieldPath` resolves
 *  against. Everything measured in the register is a field on this. */
export interface RegisterInput {
  lane: AxisLane;
  /** `ProjectedVenue.blockNumber`. Null before a market is pinned. */
  blockNumber: number | null;
  /** False until the launch rail is live. Drives the register's BLOCKING
   *  state (§3.6), which is a state and not an entry — see `armingState`. */
  railsReady: boolean;
  /**
   * The family the producers run, when the caller knows it and the candidate
   * cannot say.
   *
   * ⚠ THIS EXISTS FOR THE PUBLISHED RECORD, and its absence was a live defect
   * rather than a gap: `familyOf` reads `handAuthoredTerms`, which only the
   * two TEMPLATE rows carry, so every projection of a record answered "loop".
   * A delta-neutral LP vault therefore rendered the loop register — a pair
   * gap, a lending freeze and a borrow-side exit — on a position that holds no
   * borrow at all, and lost its own range-exit entry. The record knows its
   * family (`VaultRecord.strategy`); the candidate projected from it cannot.
   */
  family?: RegisterFamily;
  /** Published check cadences, where the surface holds them. */
  cadence?: {
    leverage?: string | null;
    hedge?: string | null;
    compound?: string | null;
  };
  /**
   * The drift before the trim, as a fraction, where the surface holds the
   * PUBLISHED bands — the vault page. On a record the drift's owner is
   * `store.deleverageDrift` over the record's own bands, and the Parameters
   * foot and the risk rows print that same derivation; before this field the
   * register re-derived the quantity from the preset over unrounded bands and
   * one page printed two spellings of one drift, a hundredth apart. Three
   * states, the record reader's own: a value is the owner's; `null` means the
   * record cannot prove it (print none); ABSENT means a live canvas lane, and
   * the preset derivation stands.
   */
  trimDrift?: number | null;
}

// ══ THE VALUE SLOT LAW (§3.3) ══════════════════════════════════════════════

/** `structural` prints itself; `blind` prints the owner's own absence string;
 *  `measured` prints the parameter through its own formatter. The value slot
 *  never prints a signed quantity: every register entry is bad news, and a
 *  sign glyph beside it double-counts the direction the noun already carries. */
export function entryValue(e: RegisterEntry): string {
  if (e.evidence.tier === "blind") return NOT_MEASURED;
  if (e.evidence.tier === "structural") return STRUCTURAL_WORD;
  return e.evidence.value ?? NOT_MEASURED;
}

const STRUCTURAL_WORD = "structural";

/** Everything one entry says, as one string. The copy-paste gate and the
 *  numeric-residue gate both read this, so a claim hidden in a field nobody
 *  renders does not count as said. */
export function entryLine(e: RegisterEntry): string {
  const r = e.reaction;
  return [
    e.mechanism,
    entryValue(e),
    /* THE DENOMINATOR IS PART OF WHAT THE ROW SAYS, so the copy-paste gate
       reads it. It is also what carries a row's distinctness now that the
       sentences are gone: `declared-blind` said one constant thing with the
       market name inside a sentence, and it says the same fact with the market
       name in the column where a frame belongs. */
    e.denominator ?? "",
    e.consequence ?? "",
    e.party?.because ?? "",
    r?.trigger ?? "",
    r?.cadence ?? "",
  ]
    .filter((s) => s.length > 0)
    .join(" · ");
}

// ══ THE SCHEMA GATE (L7 / gate a) ══════════════════════════════════════════

/** Resolve a dot path against the payload. Returns `undefined` when any hop
 *  is missing, which is exactly what "does not resolve" means. */
export function resolveFieldPath(input: RegisterInput, path: string): unknown {
  let cur: unknown = input;
  for (const hop of path.split(".")) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[hop];
  }
  return cur;
}

/**
 * The schema, as a list of what is wrong. Empty means the entry may render.
 *
 * `registerFor` DROPS a failing entry rather than repairing it. That is the
 * runtime half of the build gate, and it is what makes "a wrong entry cannot
 * compile" a property of this function rather than a promise about the person
 * editing it next.
 */
export function validateEntry(e: RegisterEntry, input: RegisterInput): string[] {
  const bad: string[] = [];
  if (e.mechanism.length === 0) bad.push("mechanism is empty");
  /* ⚠ `why is empty` IS GONE, DELIBERATELY. It was the rule that made a
     sentence mandatory on every row, which is how the register came to end
     every row with an italic line. What is mandatory now is the FRAME: a value
     with no denominator is the defect the founder read as prose. */
  if (e.denominator !== null && e.denominator.length === 0) bad.push("denominator is empty");
  if (e.evidence.value !== undefined && e.denominator === null) {
    bad.push("a value with no denominator");
  }
  if (e.consequence !== null) {
    const c = e.consequence;
    if (c.length === 0) bad.push("consequence is empty");
    if (c.length > CONSEQUENCE_MAX) bad.push(`consequence over ${CONSEQUENCE_MAX}: ${c}`);
    if (/[.!?]$/.test(c)) bad.push(`consequence ends in a stop: ${c}`);
    if (/^[A-Z]/.test(c)) bad.push(`consequence opens upper case: ${c}`);
  }
  if (e.modeled === true && e.evidence.value === undefined) {
    bad.push("modeled with no figure to qualify");
  }
  if (e.defeats === "reaction" && e.reaction === null) {
    bad.push("defeats:reaction with no reaction");
  }
  if (e.reaction !== null && e.reaction.trigger.length === 0) bad.push("reaction with no trigger");
  /* A RESPONSE IS AN ACTION OR IT IS NOT A RESPONSE. `33.3%` shipped in the
     slot whose documented job is OUR clock in the race, against a capacity
     bound, in the same characters as the Measure of a row two below it. One
     owner for the rule, in `risk-table.ts`, so the table and the legacy shape
     cannot disagree about what an action is. */
  if (e.reaction !== null && !RESPONSE_IS_ACTION.test(e.reaction.trigger)) {
    bad.push(`reaction is a bare quantity, not an action: ${e.reaction.trigger}`);
  }
  const ev = e.evidence;
  if (ev.tier === "measured") {
    if (!ev.fieldPath) bad.push("measured with no fieldPath");
    else if (resolveFieldPath(input, ev.fieldPath) === undefined) {
      bad.push(`measured fieldPath does not resolve: ${ev.fieldPath}`);
    }
    if (!ev.value || ev.value.length === 0) bad.push("measured with no value");
  } else {
    if (ev.fieldPath) bad.push(`${ev.tier} carries a fieldPath`);
  }
  if (ev.tier === "blind" && ev.value !== undefined) bad.push("blind carries a value");
  return bad;
}

// ══ THE HEDGE-WORD LIST (L8 / gate c) ══════════════════════════════════════

/**
 * A caveat is a claim with no referent, and a claim with no referent cannot be
 * checked, updated or acted on. An enumerated mechanism can be all three.
 * Exported so the gate greps the PRODUCED strings, not the source.
 */
export const HEDGE_WORDS: readonly RegExp[] = [
  /\bmay\b/i,
  /\bmight\b/i,
  /\bcould result\b/i,
  /\bno guarantee\b/i,
  /\bpast performance\b/i,
  /\bnot financial advice\b/i,
  /\brisk of loss\b/i,
  /\buse at your own risk\b/i,
];

export function hedgeWordHits(s: string): string[] {
  return HEDGE_WORDS.filter((re) => re.test(s)).map((re) => re.source);
}

// ══ GROUPS AND HEADINGS ════════════════════════════════════════════════════

/** 24 characters, inside the `.mt-sec-h` budget. Coherence argued for "What
 *  outruns the cascade"; accuracy overruled it, because three of the failure
 *  classes take the yield and leave the capital. `Outruns` survives as the
 *  first group heading, which is where it is true. */
export const REGISTER_TITLE = "What would have to break";

/**
 * The liquidation verdict's section head, and it lives beside the register's
 * because the two are a PAIR and neither reads right without the other's
 * altitude: *What can be closed* → *What would have to break*. One states which
 * legs a third party can take and at what move; the next enumerates what could
 * outrun our reaction to them, and the verdict's bridge sentence hands over the
 * count of that enumeration. 18 characters, inside the same `.mt-sec-h` budget
 * `REGISTER_TITLE` is measured against.
 *
 * ⚠ IT IS NOT A HEADLINE AT THE TOP OF THE PANEL. The reclaim readout already
 * opens on `Liquidation lines · one, the perp short` — the leg COUNT, at
 * headline altitude. A second headline-weight block opening on the same count
 * is the collision this placement exists to refuse, and the bridge sentence
 * would name a tally the reader meets a section later.
 */
export const VERDICT_TITLE = "What can be closed";

export const DEFEATS_ORDER: readonly Defeats[] = ["reaction", "position", "yield"];

export const GROUP_HEADING: Record<Defeats, string> = {
  reaction: "Faster than we act",
  position: "Acts and still loses",
  yield: "Takes the yield, not the capital",
};

/** `measured` first, `structural`, `blind` last. A measured mode outranks a
 *  named absence. Declared as an ORDER rather than as a rank table: a table
 *  of hand-written positions is a set of typed numbers, and this file does not
 *  hold any. */
const TIER_ORDER: readonly EvidenceTier[] = ["measured", "structural", "blind"];
const tierRank = (t: EvidenceTier): number => TIER_ORDER.indexOf(t);

// ══ THE BLOCKING STATE (§3.6), which is a STATE and not an ENTRY ═══════════

/**
 * The one amber row, when the rails are not armed.
 *
 * It is deliberately NOT a register entry. It is not a property of the market,
 * it carries the same words on every vault by construction, and §3.6 already
 * models it as a state with `role="status"`. Making it an entry would have
 * been the wall's first brick, and it would have had to be exempted from the
 * copy-paste gate on its first day — which is how exemptions start.
 */
export interface ArmingState {
  label: string;
  value: string;
}

export function armingState(input: RegisterInput): ArmingState | null {
  if (input.railsReady) return null;
  return { label: "Automations compile in shadow", value: "not armed" };
}

// ══ SMALL READERS, each pointed at exactly one owner ═══════════════════════

const axisText = (id: AxisId, lane: AxisLane): string | null => readAxis(id, lane)?.text ?? null;

function placed(lane: AxisLane, key: keyof typeof MODULE_DEFS): boolean {
  return lane.placed.includes(key);
}

function hasBorrowLeg(lane: AxisLane): boolean {
  return liquidationLinesOfLane(lane).some((l) => l.kind === "borrow");
}

export type RegisterFamily = "loop" | "dnlp" | "collar";

function familyOf(lane: AxisLane): RegisterFamily {
  const t = lane.candidate ? handAuthoredTerms(lane.candidate) : null;
  if (t?.family === "collar") return "collar";
  if (t?.family === "dn-lp") return "dnlp";
  return "loop";
}

/**
 * The trim's own trigger, in the unit the quantity actually has.
 *
 * ⚠ `ppMag(d, 2)`, NOT `pct(d, 0)`, and both halves of that are a fix.
 * `driftBeforeTrim` is a DIFFERENCE of two distances, so it is percentage
 * POINTS, and R2 ratified that `pp` means points while `%` means a rate.
 * And the live drifts run from 0.04pp to 5.12pp: at 0 dp the smallest of them
 * prints `0%`, which is not a rounding of a small number, it is the claim
 * that we trim on no move at all — the loudest possible falsehood about the
 * reaction, in the sentence whose whole job is to describe it. `PlateControls`
 * already reached this conclusion for the preset cells; this is the same call.
 */
function trimTrigger(input: RegisterInput): string | null {
  const lane = input.lane;
  // The record's own derivation wins where the caller carries it (see
  // `RegisterInput.trimDrift`); a live lane derives from its preset.
  const d =
    input.trimDrift !== undefined
      ? input.trimDrift
      : driftBeforeTrim(lane.preset, lane.appliedLeverage, lane.candidate?.lt);
  /* ⚠ A RESPONSE IS AN ACTION, NEVER A LEVEL (G7, 2026-09-02). This returned
     `4.24pp` — a bare distance in the column whose documented job is OUR clock
     in the race. A reader met the same characters as a Measure two rows down
     and nothing said which was which. The quantity is unchanged and it now
     arrives with the verb it belongs to and the frame it is measured in. */
  return finite(d) ? `trim ${ppMag(d, 2)} before the line` : null;
}

/**
 * The hedge's defence, as what it DOES.
 *
 * ⚠ IT USED TO RETURN THE SHORT'S MARGIN RATIO — `33.3%`, a naked percentage
 * offered as our response to a capacity bound, printed on the founder's own
 * lane as the reaction of two different rows while the same characters stood
 * as the Measure of a third and as the verdict block's `Short margin ratio`.
 * A ratio is not a response and a ceiling is not a race. What the lane can
 * actually prove it does is refill the short's margin out of the reserve it
 * holds for exactly that, so the trigger states that and claims no level the
 * canvas does not publish (a record DOES publish the ladder, and states it as
 * `margin 6.5% → 23%` through `marginRuleResponse`, the one owner of that
 * spelling).
 */
function marginTrigger(lane: AxisLane): string | null {
  return placed(lane, "hedge") ? MARGIN_ACTION : null;
}

/** The canvas's own written margin response. No level, because the canvas
 *  holds no published ladder — an unpublished edge printed as a trigger is a
 *  threshold nobody set. */
const MARGIN_ACTION = "refill the short's margin from the reserve";

/**
 * The reaction this lane can prove, preferring the leg the mechanism races.
 * Null means the lane runs no automation that answers this mechanism, and an
 * entry with `defeats: "reaction"` and no reaction is dropped by the schema —
 * which is correct: a race with only one clock is not a race we may state.
 */
function reactionFor(
  input: RegisterInput,
  prefer: "trim" | "margin",
): RegisterReaction | null {
  const lane = input.lane;
  const trim = trimTrigger(input);
  const margin = marginTrigger(lane);
  const order = prefer === "trim" ? [trim, margin] : [margin, trim];
  const cadences = prefer === "trim"
    ? [input.cadence?.leverage ?? null, input.cadence?.hedge ?? null]
    : [input.cadence?.hedge ?? null, input.cadence?.leverage ?? null];
  for (let i = 0; i < order.length; i += 1) {
    const t = order[i];
    if (t) return { trigger: t, cadence: cadences[i] ?? null };
  }
  return null;
}

// ══ THE PRODUCERS ══════════════════════════════════════════════════════════

type Draft = RegisterEntry | null;

function loopEntries(input: RegisterInput): Draft[] {
  const lane = input.lane;
  const c = lane.candidate;
  if (!c) return [];
  const pair = c.pair;
  const collateral = c.collateralSymbol;
  const debt = c.debtSymbol;
  const coin = c.hlCoin;
  const venue = venueLabel(c.venue);
  const hedged = placed(lane, "hedge");
  const borrow = hasBorrowLeg(lane);
  const block = input.blockNumber ?? undefined;
  const out: Draft[] = [];

  // ── Faster than we act ──────────────────────────────────────────────────

  /* The gap. The one entry that only exists where the mechanism exists: on a
     lane with no borrow leg there is no pair-move liquidation, so this is
     absent rather than greyed. An unavailable entry is absence, never a
     greyed row — a greyed row asserts a risk exists here and we are choosing
     not to show you the number.

     ⚠ RETIRED BY THE STRUCTURED TABLE, NOT YET DELETABLE (2026-09-02). It is
     in `RETIRED_BY_RISK_TABLE` and `lib/canvas/risk-table.ts` refuses to emit
     it: the row carries the cushion in its value and the trim in its
     sentence, which is what the table states as two rows with two
     denominators (`Deposit liquidation line` and `Trim fires`), and `4.24pp`
     appeared seven times on one published page partly because of it.
     IT MAY NOT LEAVE THIS FILE UNTIL THE LEGACY RENDERER DOES, and the
     register's own gate (b) is what proves it: deleted here, THREE catalog
     pairs — weETH/WETH, cbETH/WETH and wstETH/WETH on `aave-v3-base` — produce
     character-identical registers, because this row's `lt`-derived cushion is
     the only thing separating two markets that share a venue and a pair. The
     deletion belongs in the same change that swaps the renderer. */
  const cushion = axisText("cushion", lane);
  const drift = trimTrigger(input);
  if (borrow && cushion && drift) {
    out.push(
      entry({
        id: "pair-gap",
        mechanism: `${collateral} gapping against ${debt}`,
        /* THE TRIM MOVED OUT OF THE SENTENCE AND INTO THE RESPONSE COLUMN,
           where our own clock belongs, and the cushion's frame moved into the
           denominator. What is left is the one fact neither column can hold:
           the mechanism prices in a single block, which is why a cushion and a
           trim distance do not settle the race between them. */
        consequence: "a gap prices in one block",
        denominator: `adverse ${pair} move to the line`,
        defeats: "reaction",
        reaction: reactionFor(input, "trim"),
        evidence: { tier: "measured", fieldPath: "lane.candidate.lt", blockNumber: block, value: cushion },
      }),
    );
  }

  /* The exit. `capacity` is the deposit room the binding resource allows, and
     the same number read the other way is how much has to cross that resource
     on the way out. One quantity, two directions, one owner. */
  const cap = axisText("capacity", lane);
  if (cap) {
    out.push(
      entry({
        id: "exit-at-cap",
        /* THE BINDING IS A NOUN, so it belongs in the mechanism and in the
           denominator, not in a sentence. `The exit crosses the kHYPE market
           on Morpho Blue.` said nothing the two columns cannot. */
        mechanism: `Unwinding ${pair} through ${capacityBindingLabel(c, hedged)}`,
        consequence: "past it the exit crosses the book",
        denominator: "deposit room at this composition",
        modeled: isModeledBinding(c.economics?.capacityBinding),
        defeats: "reaction",
        reaction: reactionFor(input, hedged ? "margin" : "trim"),
        evidence: {
          tier: "measured",
          fieldPath: "lane.candidate.economics.capacityUsd",
          blockNumber: block,
          value: cap,
        },
      }),
    );
  }

  /* Feed age, blind. It renders ANYWAY: deleting it would let a reader infer
     that the feed is checked, which is the opposite of what we know. An
     honest absence outranks a silent one, and no number appears anywhere in
     the entry, including line 2.

     ⚠ RETIRED BY THE STRUCTURED TABLE (2026-09-02), and the honest-absence
     argument is kept rather than overturned. The row was right that a reader
     must not be allowed to infer the feed is checked; it was wrong twice
     about HOW. It stated a VINTAGE under a mechanism heading, and — schema
     legal and indefensible — it carried a REACTION (`4.24pp · every block`)
     against a trigger it had just said nothing reads. The table states the
     same absence in its coverage footer, in the open, with no reaction and
     nothing behind a chevron. Deleting it here before the renderer swaps
     would move `exogenous-counters`' two published blind-spot counts, so it
     goes with the renderer. */
  out.push(
    entry({
      id: "feed-age",
      mechanism: `Feed age behind ${pair}`,
      /* ⚠ THE PLUMBING CONFESSION IS DELETED. `The scan checks kHYPE. That
         result never crosses to here.` is a statement about a module boundary
         inside our own code: nothing a depositor does — deposit, size, wait,
         walk — differs on reading it. The absence itself is the row, and it is
         stated in the one column that exists to name what WOULD have measured
         a thing nothing reads. */
      consequence: null,
      denominator: "nothing on this lane reads it",
      /* ⚠ IT STOPS BEING FILED UNDER `reaction`, AND THAT IS THE FIX TO THE
         LEDE. `reactionEntryCount` is published as `Four things could reach
         24% before the trim does.` — and the fourth of those four was this
         row, which reads `not measured`. A thing nothing reads was being
         counted as a thing that could reach the liquidation line: the absence
         rounded into a hazard count. Under `position` it sits with the other
         unactioned dependency rows, the count states only what is read, and
         the skip bar still counts it, which is where an absence belongs.

         AND IT CARRIES NO REACTION. `4.24pp · every block` shipped against a
         trigger this row had just said nothing reads — a level we would act at
         if we could read the thing we cannot read. */
      defeats: "position",
      reaction: null,
      evidence: { tier: "blind" },
    }),
  );

  /* Refills. `reserveFraction` is not idle margin, it is how many refills the
     short survives without intervention (C2), and it is defaulted to its
     floor. Reading it here is the register's half of that reframe. */
  const refills = hedged ? axisText("refillsFunded", lane) : null;
  if (refills && coin) {
    out.push(
      entry({
        id: "refills",
        mechanism: `Refilling the ${coin} short on ${pair}`,
        /* ⚠ THE FOUNDER QUOTED THIS ROW BACK AT US. It read `The reserve funds
           that many refills. Then someone has to act.` — a sentence whose
           first half is the value's UNIT, printed to the left of the value it
           belongs to, and whose second half is the only fact in it. `1.00` was
           undecodable without the sentence, which is the whole complaint. The
           unit is in the denominator now; what is left is the clause. */
        consequence: "then a person acts",
        denominator: "refills the reserve funds",
        defeats: "reaction",
        reaction: reactionFor(input, "margin"),
        evidence: {
          tier: "measured",
          fieldPath: "lane.comp.hedge.reserveFraction",
          blockNumber: block,
          value: refills,
        },
      }),
    );
  }

  // ── Acts and still loses ────────────────────────────────────────────────

  /* The margin defence goes directional. Trimming a short into a rally is
     what saves the leg and it is also a sale into the move that caused it.
     ⚠ THE VENUE NAMED IS THE HEDGE'S, NOT THE LOOP'S (G7 nit, 2026-08-24).
     This line read `On ${venue}` — the lending venue — so the kHYPE page
     attributed the short's forced sale to Morpho Blue while the leg lives on
     the perp venue. The spelling comes through the axis registry's own
     `offChainVenues` reader (the one owner of "which off-chain venue a hedged
     lane holds"), matching the funding-class register's discipline. */
  /* ⚠ THE RATIO IS A READING, NOT A RESPONSE, AND THIS IS WHERE THAT SPLIT
     GOT MADE. One accessor used to serve both slots, which is exactly how
     `33.3%` came to stand as the Measure of this row AND as the reaction of
     two rows above it on one screen. The value reads the axis; the response
     comes from `marginTrigger`, which now returns an action. */
  const margin = hedged ? axisText("shortMargin", lane) : null;
  const hedgeVenue = hedged ? axisText("offChainVenues", lane) : null;
  if (hedged && margin && coin && hedgeVenue) {
    out.push(
      entry({
        id: "short-directional",
        /* ⚠ THE SECOND SENTENCE THE FOUNDER QUOTED, AND ITS LAST FRAGMENT IS
           GONE TOO (G7 minor, 2026-09-02). `On ${hedgeVenue}, restoring margin
           sells into the move.` first lost its opening (the venue is a noun
           and belongs in the mechanism, which is also the G7 correction that
           stopped this row attributing a perp sale to the lending venue) and
           then lost its stop, surviving as a clause on a technicality:
           `KILLED` banned the string WITH the full stop. Punctuation is not a
           ruling. The clause form is banned now, in both producers, and the
           row states the venue, the pair and the reading. */
        mechanism: `The ${coin} short on ${hedgeVenue}, hedging ${pair}`,
        consequence: null,
        denominator: "of the short's own notional",
        defeats: "position",
        reaction: null,
        evidence: {
          tier: "measured",
          fieldPath: "lane.comp.hedge.hedgeLeverage",
          blockNumber: block,
          value: margin,
        },
      }),
    );
  }

  /* The venue freeze. True by the shape of the venue, carries no number, and
     it is the entry that stops the exit row above from reading as the whole
     of the exit problem. */
  out.push(
    entry({
      id: "venue-freeze",
      mechanism: `${venue} freezing the ${collateral} market`,
      /* THE CLAUSE SURVIVES, and here is the fact it carries that no column
         can: the position is not closed by this, only the door is. Rewritten
         out of the not-X-but-Y frame the review flagged as a rhetorical tic on
         a risk surface — same two facts, stated as two. */
      consequence: "the exit stops, the position stays",
      denominator: "no level to watch",
      defeats: "position",
      reaction: null,
      evidence: { tier: "structural" },
    }),
  );

  /* An unhedged lane holds its collateral's price outright. Stated as a
     mechanism rather than as an absence of a module, because the module list
     is above and this is what the money does. */
  if (!hedged) {
    out.push(
      entry({
        id: "unhedged-price",
        mechanism: `${collateral} price, carried whole`,
        consequence: "nothing here shorts the deposit",
        /* THE DENOMINATOR IS THE FIX THE REVIEW ASKED FOR. This is the single
           most decision-changing row on an unhedged family and its Measure
           column held the word `structural`, which is an evidence TIER. The
           frame is what the deposit is exposed to, and the structured table
           states the identity itself (`100% · of the ${collateral} price
           move`) because an unhedged lane's exposure is one by construction. */
        denominator: `of the ${collateral} price move`,
        defeats: "position",
        reaction: null,
        evidence: { tier: "structural" },
      }),
    );
  }

  // ── Takes the yield, not the capital ────────────────────────────────────

  /* The carry inverting. Nothing liquidates; the lane stops paying. This is
     the entry that makes the group heading true rather than decorative. */
  const e = c.economics;
  const spread = e ? carry(e.collateralYieldApy, e.borrowApyMarginal) : null;
  if (borrow && spread) {
    out.push(
      entry({
        id: "carry-inverts",
        mechanism: `${debt} borrow cost against ${collateral} yield`,
        /* `Nothing liquidates. The lane stops paying.` is the GROUP HEADING
           (`Takes the yield, not the capital`) restated one line below itself.
           A clause that repeats a column or a heading is the slop tell. */
        consequence: null,
        denominator: "spread per turn",
        defeats: "yield",
        reaction: null,
        evidence: {
          tier: "measured",
          fieldPath: "lane.candidate.economics.borrowApyMarginal",
          blockNumber: block,
          value: spread,
        },
      }),
    );
  }

  /* Funding. `hedgeEconomics` is the sole accessor of the p25 rate (R3), and
     the value carries no verb, because a term whose sign flips per row must
     never carry one. */
  const h = hedged ? hedgeEconomics(c, lane.comp) : null;
  const guard = axisText("guardTrigger", lane);
  if (h && coin && guard) {
    out.push(
      entry({
        id: "funding-inverts",
        mechanism: `Funding on ${coin} turning negative`,
        /* ⚠ THE SENTENCE HELD A SECOND QUANTITY, AND THAT WAS THE BUG. The
           value is the lower-quartile funding rate the short COLLECTS; the
           `${guard}` inside the sentence was the guard FLOOR, a published
           setting of the opposite sign. Two quantities, one cell, no column
           saying which. The floor is its own row on the structured table
           (`funding-guard`); here the cell states one quantity and its frame.
           The guard's response travels in the response column, where it is
           the same decoded action on every family. */
        consequence: "the carry stops, the deposit stays",
        denominator: "lower-quartile APR at the pinned block",
        defeats: "yield",
        reaction: null,
        evidence: {
          tier: "measured",
          fieldPath: "lane.candidate.economics.fundingP25Apr",
          blockNumber: block,
          value: pct(h.fundingApr),
        },
      }),
    );
  }

  /* The vintage (L12). Every claim inherits the vintage of the data that
     produced it, and the block is the only stamp that cannot drift.

     ⚠ RETIRED BY THE STRUCTURED TABLE (2026-09-02). L12 is satisfied BETTER
     without it: this row inherited nothing, it printed a raw `41563811` in the
     same monospace column as `$19.3K`, and on a published loop record it was
     the ONLY open row its group had — so the heading promised a class of loss
     and delivered a timestamp. `RegisterEvidence.blockNumber` was already set
     on every measured entry and no renderer printed it; the table prints it
     once, as its own stamp, in the Parameters panel's own spelling. It leaves
     with the renderer. */
  if (finite(input.blockNumber)) {
    out.push(
      entry({
        id: "scan-vintage",
        mechanism: `${pair} was priced once, at one block`,
        /* The sentence restated the mechanism with the tense changed. The
           block is an AS-OF, and every measured row above already carries it
           in `evidence.blockNumber`; the structured table prints it once, as
           the table's own stamp, and this row leaves with the renderer. */
        consequence: null,
        denominator: "block the record was priced at",
        defeats: "yield",
        reaction: null,
        evidence: {
          tier: "measured",
          fieldPath: "blockNumber",
          blockNumber: block,
          value: String(input.blockNumber),
        },
      }),
    );
  }

  return out;
}

function dnLpEntries(input: RegisterInput): Draft[] {
  const lane = input.lane;
  const c = lane.candidate;
  if (!c) return [];
  const coin = c.hlCoin;
  const pool = c.pair;
  const actions = axisText("actionCount", lane);
  const cap = axisText("capacity", lane);
  const out: Draft[] = [];

  if (actions) {
    out.push(
      entry({
        id: "range-exit",
        /* ⚠ THE LABEL NOW NAMES THE QUANTITY THE VALUE ACTUALLY IS. The row
           asked how far price can travel and answered `1,600 actions/yr` — a
           recenter FREQUENCY against a question about distance, with the unit
           mismatched to the claim. The frequency is a real, decision-changing
           reading (it is the cost of holding this width), so the mechanism is
           renamed to it rather than the value being thrown away. The structured
           table splits the two: `range-width` states the distance in the width
           dial's own unit. */
        mechanism: `Recentering ${pool} as price leaves the range`,
        consequence: "out of range the fees stop",
        denominator: "at this range width",
        modeled: true,
        defeats: "yield",
        reaction: null,
        evidence: {
          tier: "measured",
          fieldPath: "lane.params.auto-center.rangePct",
          blockNumber: input.blockNumber ?? undefined,
          value: actions,
        },
      }),
    );
  }

  if (cap) {
    out.push(
      entry({
        id: "recenter-at-cap",
        mechanism: `Recentering ${pool} through ${capacityBindingLabel(c, placed(lane, "hedge"))}`,
        consequence: "past it the exit crosses the book",
        denominator: "deposit room at this composition",
        modeled: isModeledBinding(c.economics?.capacityBinding),
        defeats: "reaction",
        reaction: reactionFor(input, "margin"),
        evidence: {
          tier: "measured",
          fieldPath: "lane.candidate.economics.capacityUsd",
          blockNumber: input.blockNumber ?? undefined,
          value: cap,
        },
      }),
    );
  }

  out.push(
    entry({
      id: "two-venues",
      mechanism: coin
        ? `The ${pool} leg and the ${coin} perp leg`
        : `The ${pool} leg and the perp leg`,
      /* `They settle separately, on separate venues.` was true, interesting
         and decision-inert: the mechanism already says two legs and two
         venues. What changes a decision is what the depositor is left holding
         when one of them goes. */
      consequence: "lose the perp leg and the pool is unhedged",
      denominator: "no level to watch",
      defeats: "position",
      reaction: null,
      evidence: { tier: "structural" },
    }),
  );

  return out;
}

function collarEntries(input: RegisterInput): Draft[] {
  const lane = input.lane;
  const c = lane.candidate;
  if (!c) return [];
  const pair = c.pair;
  const strike = axisText("upsideCap", lane);
  const floor = axisText("downsideFloor", lane);
  const rolls = axisText("actionCount", lane);
  const out: Draft[] = [];

  if (strike) {
    out.push(
      entry({
        id: "upside-sold",
        mechanism: `${pair} ending above the written strike`,
        consequence: "upside above it belongs to the buyer",
        denominator: "above spot at open",
        defeats: "position",
        reaction: null,
        evidence: {
          tier: "measured",
          fieldPath: "lane.params.covered-call.strikePct",
          blockNumber: input.blockNumber ?? undefined,
          value: strike,
        },
      }),
    );
  }

  if (floor) {
    out.push(
      entry({
        id: "floor-is-a-venue",
        mechanism: `The ${pair} floor is an option position`,
        /* `It holds to the option venue and to nothing else.` was flourish
           wrapped around one fact: the counterparty. Stated as the clause it
           is. */
        consequence: "it holds to the option venue only",
        denominator: "below spot at open",
        defeats: "position",
        reaction: null,
        evidence: {
          tier: "measured",
          fieldPath: "lane.params.protective-put.floorPct",
          blockNumber: input.blockNumber ?? undefined,
          value: floor,
        },
      }),
    );
  }

  if (rolls) {
    out.push(
      entry({
        id: "roll-cost",
        mechanism: `Each roll of the ${pair} collar pays the spread`,
        /* `Expected total return is minus the roll cost.` restates the
           mechanism and the group heading. And the value is a roll FREQUENCY,
           not a cost, so the label is named to the quantity: the structured
           table prices the cost itself off `collarModel`'s own roll leg. */
        consequence: null,
        denominator: "at this roll tenor",
        modeled: true,
        defeats: "yield",
        reaction: null,
        evidence: {
          tier: "measured",
          fieldPath: "lane.params.covered-call.rollDays",
          blockNumber: input.blockNumber ?? undefined,
          value: rolls,
        },
      }),
    );
  }

  /* The family's own blind spot, stated as a mechanism rather than omitted.
     It is the entry that stops the printed premium from reading as income. */
  out.push(
    entry({
      id: "flat-vol",
      mechanism: `Priced at one flat volatility`,
      /* The sentence was a qualifier on the number above it, which is what the
         word `modeled` is for — and the structured table now carries that word
         on the figure itself rather than in a row of its own. */
      consequence: null,
      denominator: "no term structure to check it against",
      defeats: "yield",
      reaction: null,
      evidence: { tier: "structural" },
    }),
  );

  return out;
}

// ══ THE DECLARED BLIND ROW (W2-C5) ═════════════════════════════════════════

/**
 * THE DEPENDENCIES NO PRIIME VAULT WATCHES, SAID ONCE, ON EVERY LANE.
 *
 * ── WHY IT IS AN ENTRY AND NOT A PLATE ────────────────────────────────────
 * `/loop` advertises four modules keeping "the position and its dependencies
 * in check, every block", and Exogenous Risk has no shelf plate, no scanner
 * and no payload. The two ways to close that are to build a plate — a module
 * that would have to claim a measurement nothing produces — or to say the
 * absence out loud. §L11 already ratified the second: a threat that cannot be
 * measured is NAMED and never SIZED. So this is one row, in the family every
 * lane already renders, and no new module.
 *
 * ── WHY `blind`, AND WHY THE VALUE SLOT SAYS `not measured` ───────────────
 * The evidence tier IS the claim. `blind` is the tier whose whole contract is
 * "named, no number, and the reader can count them without reading them"
 * (`skipBarLabel`). It carries no `value` by schema, so `entryValue` prints
 * the one absence string the product owns. A row that printed a bespoke
 * absence word beside `not measured` on the row above it would be a second
 * spelling of one state, which is the defect this file exists to refuse — so
 * the "not watched by this vault" half of the ruling is stated in line 2,
 * where a sentence belongs, and the slot keeps the owner's word.
 *
 * ── WHY `position`, NOT `reaction` ────────────────────────────────────────
 * `reactionEntryCount` is the bridge count the liquidation verdict publishes.
 * Filing a constant row under `reaction` would raise that count by one on
 * EVERY vault, which is a change to a sentence about the automations rather
 * than an addition to the register. Under `position` it sits beside
 * `venue-freeze` and `two-venues` — the unactioned dependency rows the lane
 * already prints — and claims nothing about our clock.
 *
 * ── WHY LINE 2 NAMES THE PAIR ─────────────────────────────────────────────
 * Gate (b), the wall test: a row that says the same characters on every vault
 * forever is chrome, and `armingState` is a STATE precisely because it could
 * not pass. This row can: the dependency set is the product's, the sentence is
 * about THIS lane's market, and the name is the only token a blind entry may
 * interpolate (gate (d) strips exactly the payload's nouns before asserting no
 * digit survives — which is why the venue label, carrying `v3`, is not used
 * here the way `venue-freeze` uses it).
 */
export const DECLARED_BLIND_ID = "declared-blind";

/** Line 1. The four dependencies, in the ratified order. */
export const DECLARED_BLIND_MECHANISM = "Oracle, bridge, stablecoin and RPC health";

/**
 * The row, for one market name. Exported by name because a second register
 * producer exists (`lib/vaults/funding-register.ts`, record-built) and a
 * second COPY of this sentence would be the wall arriving by the back door.
 */
export function declaredBlindEntry(marketName: string): RegisterEntry | null {
  if (marketName.length === 0) return null;
  return entry({
    id: DECLARED_BLIND_ID,
    mechanism: DECLARED_BLIND_MECHANISM,
    /* ⚠ THE SENTENCE IS GONE, AND THE TWO FACTS IN IT ARE BOTH STILL SAID.
       `Not watched by this vault. Their state never crosses into kHYPE/WHYPE.`
       restated the `not measured` already standing in the value column, and
       then named the market inside a sentence. The absence is the VALUE (this
       is a blind entry, so `entryValue` prints the one absence word the
       product owns) and the market is the DENOMINATOR — which on an unmeasured
       reading is the column that names what WOULD have measured it. That is
       also what keeps the row off the wall: the frame moves per market, the
       way the sentence used to, without a sentence. */
    consequence: null,
    denominator: `nothing on this lane reads them into ${marketName}`,
    defeats: "position",
    reaction: null,
    evidence: { tier: "blind" },
  });
}

// ══ THE PROMOTION (2026-08-26) ═════════════════════════════════════════════

/**
 * THE DECLARED BLIND ROW, PROMOTED — one row per outside party this lane's
 * capital route actually has.
 *
 * ── WHAT CHANGED, AND WHAT DID NOT ────────────────────────────────────────
 * The row above says four dependencies are not watched, on every lane, as one
 * sentence. That is the honest answer for a lane with no watcher and it stays
 * exactly as it is. What the module adds is not a second taxonomy and not a
 * new claim: it is the SAME fact at higher resolution, because the canvas can
 * derive WHICH parties a given route has and the constant sentence cannot.
 *
 * ── WHY THE COUNT MOVES IN BOTH DIRECTIONS, AND WHY THAT IS RIGHT ─────────
 * A party the scan reads a quantity on is promoted out of the skip register
 * and into an open group. A party NOTHING reads stays blind and is named
 * individually — so a lane that traded one blind row for two has published a
 * truer number, not a worse one. `skipBarLabel` is the counter and it is
 * derived, so neither direction can be gamed.
 *
 * ── WHY `position`, AND WHY THE REACTION IS NOT A CLOCK ───────────────────
 * Same ruling as the row it promotes. `reactionEntryCount` is published in a
 * sentence about the AUTOMATIONS; filing these under `reaction` would raise
 * that count on every watched lane, which is an edit to an existing claim.
 * Under `position` they sit beside `venue-freeze` and `two-venues` — the
 * unactioned dependency rows the lane already prints.
 *
 * The `reaction` slot still carries the DESIGNED response, with a null
 * cadence, and it is present on exactly the parties the builder's own control
 * has answered. A party that is named and no more carries no reaction, which
 * is what makes the control a control rather than a decoration: move the line
 * and the register moves with it.
 */
export function exogenousEntries(input: RegisterInput): RegisterEntry[] {
  const lane = input.lane;
  if (!lane.placed.includes("exogenous-risk")) return [];
  const view = watchViewOf(lane);
  const out: RegisterEntry[] = [];
  for (const row of view.rows) {
    const answered = view.answered.has(row.id);
    const acts = row.classes.map((k) => k.act).join(" ");
    /* ⚠ THE ABSENCE TRAVELS WITH THE ROW (gate fix, 2026-08-27).
       A party can be MEASURED on one of its classes and read on none of the
       others: the venue is gated on `Partner pause` and `Parameter change` and
       on nothing at all for `Contract upgrade`. The row publishes ONE evidence
       value for all of them, so `Partner pause, Parameter change, Contract
       upgrade · clear` let a reader take `clear` as a verdict on a queued
       governance proposal we do not read. The dock already prints the
       absence beside the class; the register did not, and the register is the
       artifact a depositor keeps. Same sentence, same owner, one place more. */
    /* ⚠ THE APPENDED CAVEAT IS DELETED, AND THE FACT IT CARRIED IS STATED AS
       DATA INSTEAD. `Nothing on this lane reads a queued proposal.` was prose
       patching a FALSE VERDICT: three classes with three different coverage
       states were collapsed into one word (`clear`), and rather than splitting
       the row the product appended a sentence saying the word was wrong for
       one of them. The structured table emits ONE ROW PER CLASS, each with its
       own coverage, so the caveat has nothing left to patch. It is read here
       only to decide the denominator, which names the unread classes as the
       thing that would have measured this row. */
    const gaps = row.unsignalled
      .map((f) => EXOGENOUS_NO_SIGNAL[f])
      .filter((s): s is string => typeof s === "string" && s.length > 0);
    out.push(entry({
      id: `${EXOGENOUS_ID_PREFIX}${row.id}`,
      mechanism: row.classes.map((k) => k.name).join(", "),
      /* THE ONE JUSTIFIED SURVIVOR, AND IT IS NAMED. `because` is the ROUTE
         line — why this outside party is on this lane's capital route at all —
         and no column on this table holds it: the mechanism is the class set,
         the value is a coverage state, the denominator is the frame, the
         response is the written act. It travels typed, in `party`, so a
         swapped renderer reads it as data rather than as the italic line under
         every row, and `entry()` is what puts it in the legacy slot. */
      party: { id: row.id, label: row.party, because: row.because },
      consequence: null,
      denominator:
        row.tier === "measured"
          ? gaps.length > 0
            ? PARTLY_READ
            : `read by the scan at this block`
          : `nothing on this lane reads it`,
      defeats: "position",
      reaction: answered ? { trigger: acts, cadence: null } : null,
      evidence:
        row.tier === "measured"
          ? {
              tier: "measured",
              /* THE FIELD THE STATE CAME FROM. A row whose party is read
                 through the scanner's own gates resolves here; a record and a
                 hand-authored row carry no gates, come back `blind` from the
                 derivation, and take the branch below — which is why nothing
                 in this file has to know the difference. */
              fieldPath: "lane.candidate.failedGates",
              blockNumber: input.blockNumber ?? undefined,
              value: row.state,
            }
          : { tier: "blind" },
    }));
  }
  return out;
}

/** THE FRAME OF A PARTY THE SCAN READ ON SOME OF ITS CLASSES AND ON NONE OF
 *  THE OTHERS. It is the one claim the appended caveat sentence was making,
 *  and it belongs in the frame column because `clear` beside a class with an
 *  empty signal list is a false verdict, not a missing sentence. The
 *  structured table removes the need for it entirely by emitting one row per
 *  class, each with its own coverage. */
export const PARTLY_READ = "read by the scan, except where nothing reads it";

/** Every promoted row shares this prefix, so a surface can find them without
 *  a second list of ids to keep in step with the derivation. */
export const EXOGENOUS_ID_PREFIX = "exo-";

// ══ THE REGISTER ═══════════════════════════════════════════════════════════

/**
 * Every entry this lane earns, ordered, schema-checked, with failures dropped.
 *
 * Empty before a market is pinned — nothing is priced, so nothing can be
 * defeated, and the heading does not render either. An empty group heading
 * claims a class exists here and we found nothing in it, which we cannot
 * prove.
 */
export function registerFor(input: RegisterInput): RegisterEntry[] {
  const candidate = input.lane.candidate;
  if (!candidate) return [];
  const fam = input.family ?? familyOf(input.lane);
  const drafts: Draft[] = [
    ...(fam === "collar"
      ? collarEntries(input)
      : fam === "dnlp"
        ? dnLpEntries(input)
        : loopEntries(input)),
    /* Every family, exactly once, appended rather than repeated inside the
       three producers: one sentence, one owner. `sortEntries` files it.

       PROMOTED, NEVER DUPLICATED (2026-08-26). A lane holding the watcher
       states the same fact per party instead of once for four; a lane without
       it is byte for byte what it was. The branch is exclusive, so exactly one
       of the constant sentence and its higher-resolution form reaches the
       register and there is no second spelling to keep in step.

       ⚠ AND "BY CONSTRUCTION" WAS THE WRONG WORD FOR IT (recette 2026-08-27,
       track 1). This block used to claim the two could "never both render",
       and that read as a property of the product when it was only ever a
       property of THIS TERNARY. `lane.placed` is built by two different
       authors — the canvas graph, and `placedKeysOf` projecting a published
       record — and the second one had never heard of the overlay. So a record
       that carried `Also installed · Exogenous risk` in its module list took
       the else branch here, and the vault page printed the constant sentence
       and the watcher's name on one screen, four lines apart. Both authors now
       answer the same question; the exclusivity below is what this line does,
       not a guarantee about what every caller hands it. `placed` is an input,
       and an input can be wrong. */
    ...(input.lane.placed.includes("exogenous-risk")
      ? exogenousEntries(input)
      : [declaredBlindEntry(candidate.pair)]),
  ];

  const kept: RegisterEntry[] = [];
  for (const d of drafts) {
    if (!d) continue;
    if (validateEntry(d, input).length > 0) continue;
    kept.push(d);
  }
  return sortEntries(kept);
}

// ══ THE STRUCTURED TABLE, FROM A CANVAS LANE (2026-09-02) ══════════════════

/**
 * THE ONE CALL THE DOCK MAKES, mirroring `riskTableForVault` for a record.
 *
 * ── WHY IT IS HERE AND NOT IN `risk-table.ts` ─────────────────────────────
 * `riskTableForLane` is pure canvas and knows nothing about the exogenous
 * OVERLAY: whether the parties are rows of their own or one product-level
 * footer line is a placement question, and this file is already the one owner
 * of that ternary (`registerFor` branches on the same `placed` key, and the
 * record path asks `placedKeysOf` the same question). Putting the branch in
 * two places is how the vault page came to print the constant sentence four
 * lines under the watcher's own name.
 *
 * ── WHY IT EXISTS AT ALL ──────────────────────────────────────────────────
 * The dock and the vault page must move TOGETHER or they diverge further than
 * they already had: the dock concatenated the why and the reaction onto one
 * italic line while the vault page put the reaction in its own cell after an
 * arrow. Two renderers, one prose field, two invented tables. One call per
 * surface, one shape, and neither renderer decides what a row says.
 */
export function riskTableForRegisterInput(input: RegisterInput): RiskTable | null {
  const lane = input.lane;
  if (!lane.candidate) return null;
  const family: Exclude<RiskFamily, "funding"> = input.family ?? familyOf(lane);
  return riskTableForLane(
    {
      lane,
      family,
      blockNumber: input.blockNumber,
      /* `armingState` is the one owner of "is anything armed", and it answers
         with a STATE rather than a boolean because it is rendered as one. A
         null state is an armed rail. */
      armed: armingState(input) === null,
      cadence: { leverage: input.cadence?.leverage ?? null, hedge: input.cadence?.hedge ?? null },
      ...(input.trimDrift !== undefined ? { trimDrift: input.trimDrift } : {}),
    },
    lane.placed.includes("exogenous-risk") ? dependenciesOf(lane) : [],
  );
}

/**
 * THE AS-OF, ON A LEGACY ENTRY, IN THE PRODUCT'S OWN GRAMMAR.
 *
 * `evidence.blockNumber` has been set on every measured entry this file has
 * ever produced and NO renderer printed it — the one route a block took to a
 * reader was the `scan-vintage` row's VALUE, a raw `41563811` in the same mono
 * column as `$19.3K`, while the Parameters panel 400px away printed the same
 * integer as `block 41,563,811`. `readingStamp` does this for a table row;
 * this is the same stamp for the shape the two renderers still read, so a
 * surface cannot print a figure with no vintage and cannot print a modeled
 * figure bare.
 */
export function entryStamp(e: RegisterEntry): string | null {
  const modeled = e.modeled === true ? RISK_MODELED_WORD : null;
  const block =
    e.evidence.tier === "measured" && finite(e.evidence.blockNumber)
      ? blockStamp(e.evidence.blockNumber)
      : null;
  const parts = [modeled, block].filter((x): x is string => typeof x === "string" && x.length > 0);
  return parts.length > 0 ? parts.join(STAMP_SEP) : null;
}

/** The product's own separator between a stamp's two halves. */
const STAMP_SEP = " · ";

/**
 * THE ORDER, EXPORTED (recette 2026-09-02, DEF-02).
 *
 * The vault page renders two register classes through one set of components,
 * and the tier order above is part of that grammar rather than a detail of
 * this file: `measured` outranks `structural` outranks `blind`, inside each
 * group. The funding producer used to hand-order its own short list, which
 * read correctly while every one of its rows was written by hand; it now
 * appends a DERIVED set of per-party rows whose tiers depend on what the scan
 * read, and a hand-written push order cannot place those. One sort, one owner,
 * rather than a second implementation of the same law one file over.
 */
export function sortEntries(entries: RegisterEntry[]): RegisterEntry[] {
  const groupRank = (d: Defeats) => DEFEATS_ORDER.indexOf(d);
  return [...entries].sort((a, b) => {
    const g = groupRank(a.defeats) - groupRank(b.defeats);
    if (g !== 0) return g;
    return tierRank(a.evidence.tier) - tierRank(b.evidence.tier);
  });
}

export interface RegisterGroup {
  defeats: Defeats;
  heading: string;
  entries: RegisterEntry[];
}

/** The open rows, grouped. Blind entries are excluded: they go behind the skip
 *  bar, because a reader can count our blind spots without reading them, which
 *  is the strongest possible form of not estimating them. */
export function registerGroups(entries: readonly RegisterEntry[]): RegisterGroup[] {
  const out: RegisterGroup[] = [];
  for (const d of DEFEATS_ORDER) {
    const rows = entries.filter((e) => e.defeats === d && e.evidence.tier !== "blind");
    if (rows.length === 0) continue;
    out.push({ defeats: d, heading: GROUP_HEADING[d], entries: rows });
  }
  return out;
}

/** The skip register's members. */
export function blindEntries(entries: readonly RegisterEntry[]): RegisterEntry[] {
  return entries.filter((e) => e.evidence.tier === "blind");
}

/** `3 things this vault does not measure`. Null below one, because a bar
 *  stating that we measure everything is a completeness claim. */
export function skipBarLabel(entries: readonly RegisterEntry[]): string | null {
  const n = blindEntries(entries).length;
  if (n < 1) return null;
  return `${n} thing${n === 1 ? "" : "s"} this vault does not measure`;
}

/**
 * The bridge count the liquidation verdict consumes.
 *
 * Supplied to `liquidationVerdict`, never derived there: two files must not
 * compute one number, and the count moves per market and per composition,
 * which is deliberate — a bridge line that always says the same thing is
 * chrome.
 */
export function reactionEntryCount(entries: readonly RegisterEntry[]): number {
  /* ⚠ AN ABSENCE IS NOT A HAZARD (G7, 2026-09-02). This counted every entry
     filed under `reaction` regardless of what was READ, and the verdict
     published the total as `Four things could reach 24% before the trim does.`
     On a loop record the fourth of those four was `Feed age behind
     kHYPE/WHYPE`, whose own cell reads `not measured` — a thing nothing reads,
     counted as a thing that could reach the liquidation line. That is the
     standing quant law inverted: the absence rounded INTO the number instead
     of being stated as absent. The count states what is read; the skip bar
     states the rest, and it already did. */
  return entries.filter((e) => e.defeats === "reaction" && e.evidence.tier !== "blind").length;
}

// ══ THE RECLAIM READOUT (L10 / §5.2) ═══════════════════════════════════════

/**
 * WHEN A CONTROL RENDERS, AND WHEN THE PRODUCT TOOK THE DECISION.
 *
 * `dominates` returns five kinds and only one of them is a removal:
 *
 *   · `trades`      the control earns its keep. It renders; no reclaim.
 *   · `dominated`   the product chose. THIS is the removal, and it is the
 *                   only state that owes the reclaim contract.
 *   · `tied`        every setting reads identically. Nothing was chosen
 *                   because there was nothing to choose, and a runner-up
 *                   readout would invent a cost of zero. L5, not L10.
 *   · `single`      the market offers one setting. Never was a control.
 *   · `unpriceable` fewer than two settings read at all. Nothing is known.
 *
 * So `controlRemoved` is the reclaim's precondition and `controlRenders` is
 * its complement on the only pair where both are meaningful.
 */
export function controlVerdictKind(
  control: Control,
  lane: AxisLane,
  opts: DominanceOptions = {},
): DominanceKind | null {
  if (!rendersOn(control, lane)) return null;
  return dominates(control, lane, opts).kind;
}

export function controlRenders(control: Control, lane: AxisLane, opts: DominanceOptions = {}): boolean {
  return controlVerdictKind(control, lane, opts) === "trades";
}

export function controlRemoved(control: Control, lane: AxisLane, opts: DominanceOptions = {}): boolean {
  return controlVerdictKind(control, lane, opts) === "dominated";
}

export interface ReclaimRow {
  label: string;
  value: string;
}

export interface Reclaim {
  control: string;
  /** The four rows, in order: verdict, setting, next best, first defeat. */
  rows: ReclaimRow[];
  /** The axis the product optimised. Null is not renderable — L10 requires it. */
  objective: AxisId;
  /** The setting the product pressed. */
  setting: ParamValue;
  /** The runner-up, and its signed cost in the objective's own unit. The
   *  load-bearing half: without it, deleting a control is indistinguishable
   *  from hiding it. */
  runnerUp: { value: ParamValue; delta: number } | null;
  /** True when the winner sits at an end of the offered range. A builder who
   *  reads `corner` learns the shape of the problem, which no adjective
   *  teaches. */
  corner: boolean;
}

/**
 * WHAT REPLACES A REMOVED CONTROL.
 *
 * Four lines, in this order, in the vacated space: the liquidation verdict,
 * the setting with its objective, the runner-up with its signed cost, and the
 * first defeat entry. It is a readout, not prose, not a disclosure.
 *
 * ⚠ IT PROVES ITS OWN ARITHMETIC OR IT RENDERS NOTHING. `dominates` reports
 * the runner-up's cost; this recomputes the same difference from the axis
 * registry over the two settings' own lanes and returns null if they disagree
 * beyond `IDENTITY_EPS`. A reclaim block that cannot prove its own arithmetic
 * renders nothing and the control comes back — which is the whole reason the
 * caller must treat `null` as "render the control", never as "render nothing".
 */
export function reclaim(
  control: Control,
  input: RegisterInput,
  opts: DominanceOptions = {},
): Reclaim | null {
  const lane = input.lane;
  if (!controlRemoved(control, lane, opts)) return null;

  const verdict = dominates(control, lane, opts);
  if (verdict.winner === null) return null;
  const runner = verdict.runnerUp;
  if (!runner) return null;

  const settings = settingLanes(control, lane);
  const laneOf = (v: ParamValue): AxisLane | null =>
    settings.find((x) => Object.is(x.value, v))?.lane ?? null;
  const winnerLane = laneOf(verdict.winner);
  const runnerLane = laneOf(runner.value);
  if (!winnerLane || !runnerLane) return null;

  /* THE OBJECTIVE IS DERIVED FROM THE SWEEP, NOT ASSERTED BY THE DESCRIPTOR.
     A descriptor's `objective` / `defaultRationale` is a claim about the
     DEFAULT (L3/L4); the reclaim block is a claim about what the sweep just
     chose on THIS market, and those are different sentences. Publishing the
     descriptor's field would let the readout name an axis the winner is not
     in fact best on, which is the authority claim L10 exists to stop. So:
     the axis the winner is UNIQUELY best on, with the descriptor's own
     declaration used only to break the tie. */
  const objective = winningAxis(control, verdict.compared, winnerLane, settings);
  if (!objective) return null;

  /* THE COST IS ON netApy, ALWAYS, AND IT IS RECOMPUTED HERE.
     `dominates` reports `deltaNetApy`; this reads the same two lanes through
     the axis registry and refuses the block if the two disagree beyond the
     tolerance. Same shape as `hedge-econ`'s identity assert and for the same
     reason: a surface that cannot prove its arithmetic prints nothing. */
  const best = numAxis("netApy", winnerLane);
  const next = numAxis("netApy", runnerLane);
  if (!finite(best) || !finite(next)) return null;
  const delta = best - next;
  if (Math.abs(runner.deltaNetApy - delta) > IDENTITY_EPS) return null;

  const values = settings.map((s) => s.value);
  const idx = values.findIndex((v) => Object.is(v, verdict.winner));
  const corner = idx === 0 || idx === values.length - 1;

  const rows: ReclaimRow[] = [];
  /* ⚠ ROWS 1 AND 4 DESCRIBE `winnerLane`, NEVER THE INPUT LANE (audit fix,
     2026-08-22). Every row of this block is a statement about the machine the
     product SHIPPED, which is this lane at the setting the sweep just chose —
     rows 2 and 3 were already written that way and these two were not.

     It is a correctness fix, not a tidy-up, and the canvas is where it bites.
     The sweep has to be entered on a lane that HOLDS the control (`rendersOn`
     refuses a control whose module is not placed), so the caller hands over a
     counterfactual lane carrying the module at its descriptor default — which
     on a loop is a LEVERED lane. Reading the liquidation lines off that lane
     published `two, the lending leg and the perp short` for a vault the
     product had just decided to ship at 1.00x with no borrow leg at all: a
     verdict naming MORE legs than the graph holds, which L9 forbids in the
     same breath as naming fewer. Read at the winner the same lane answers
     `one, the perp short`, which is what the record carries.

     Row 4 has the identical defect one step further on: the register of a
     levered lane opens with a pair-gap entry that exists only because of the
     borrow leg, so the block would name a defeater of an automation the
     shipped vault does not run. */
  const lines = liquidationLinesOfLane(winnerLane);
  rows.push({ label: "Liquidation lines", value: VERDICT_ROW[verdictKey(lines)] });
  rows.push({
    label: settingLabel(control),
    value: [renderSetting(control, verdict.winner), corner ? "corner" : null, objectiveLine(objective)]
      .filter((s): s is string => typeof s === "string" && s.length > 0)
      .join(" · "),
  });
  /* THE RUNNER-UP CARRIES WHAT IT BUYS AS WELL AS WHAT IT COSTS. Without the
     second half the row is a punishment rather than a comparison, and a
     builder cannot see why anyone would have pressed the other cell.

     Two details that are corrections rather than taste:

     · THE COST IS WITHHELD BELOW `EVEN_FLOOR`. `0.0pp less` is not a fact —
       the cost prints one decimal of pp, so anything under half a hundredth
       of a point rounds to a zero that reads as a measurement. That is
       `hedge-econ`'s own ruling on its own hero, and it bites here on every
       control the sweep decided on an axis OTHER than net APY, which is where
       the APY difference is near zero by construction.

     · THE SECOND CLAUSE IS THE AXIS THE DECISION TURNED ON. Where the
       objective is net APY the reader already has the cost, so the clause
       names the other compared axis (§5.2's `26% adverse pair move`); where
       the objective is something else, the clause names the objective itself,
       because a cost with no reading of the thing it bought is half a trade. */
  const alt =
    objective === "netApy"
      ? verdict.compared.find((a) => a !== "netApy")
      : objective;
  rows.push({
    label: "Next best",
    value: [
      renderSetting(control, runner.value),
      Math.abs(delta) >= EVEN_FLOOR ? costLine(delta) : "",
      altReading(alt, runnerLane),
    ]
      .filter((s) => s.length > 0)
      .join(" · "),
  });
  const first = registerFor({ ...input, lane: winnerLane }).find((e) => e.defeats === "reaction");
  if (first) {
    rows.push({ label: "Defeats the reaction", value: `${first.mechanism} · ${entryValue(first)}` });
  }

  return {
    control: controlId(control),
    rows,
    objective,
    setting: verdict.winner,
    runnerUp: { value: runner.value, delta },
    corner,
  };
}

/**
 * THE READOUT WHILE THE MODULE IS HELD (design ruling 2026-08-23).
 *
 * ── THE DISAPPEARANCE ─────────────────────────────────────────────────────
 * `ComposePanel` rendered the reclaim block only where the leverage module
 * was ABSENT (`if (!scanRow || nodeFor(lane.loop, "safety-buffer")) return
 * null`). So on a dominated market the sentence that explains the corner was
 * on screen right up to the press that seated the module, and gone the moment
 * he was staring at the dial it explains. The founder's screenshot is the
 * three stops with NO DEBT lit and no readout under them.
 *
 * ── WHAT RENDERS INSTEAD ──────────────────────────────────────────────────
 * The same four rows `reclaim` owns, with rows 2 and 3 re-pointed at the
 * position the lane actually holds:
 *
 *     Liquidation lines   one, the perp short
 *     Corner              no debt · the highest modeled net APY here
 *     You hold            2.00x · 1.2pp less · 42% adverse pair move …
 *     Defeats the reaction …
 *
 * `Corner` is the sweep's winner under its cushion word (`no debt` at the
 * floor, through the cushion axis's own renderer). `You hold` is the lane at
 * `held`, priced through the same `laneFrom` path every setting lane is, so
 * the cost is the difference of two numbers the model produced and not a
 * third derivation. Below `EVEN_FLOOR` the cost is withheld, exactly as the
 * runner-up row withholds it.
 *
 * NULL WHERE `reclaim` IS NULL. On a trading market the control renders and
 * this renders nothing, which is the rule: a readout that explains a corner
 * may not appear where there is no corner. And the winner is still the
 * sweep's, never the held value: a lane holding the module AT the corner gets
 * `You hold · no debt · at the corner`, and the tip layer says the rest.
 */
export function reclaimHeld(
  control: Control,
  input: RegisterInput,
  held: ParamValue,
  opts: DominanceOptions = {},
): Reclaim | null {
  const base = reclaim(control, input, opts);
  if (!base) return null;
  const lane = input.lane;
  const verdict = dominates(control, lane, opts);
  const winner = verdict.winner;
  if (winner === null) return null;
  const settings = settingLanes(control, lane);
  const winnerLane = settings.find((x) => Object.is(x.value, winner))?.lane ?? null;
  if (!winnerLane) return null;
  /* The held lane: on a stop it IS one of the setting lanes; off the ladder
     it is BUILT the same way, through the sweep's own constructor at the held
     position (`settingLaneAt`). Either way the arithmetic is the sweep's. */
  const heldLane =
    settings.find((x) => Object.is(x.value, held))?.lane ??
    /* OFF THE LADDER, BUILT NOT SEARCHED (S1, 2026-08-24). This fallback used
       to call `settingLanes` again and search its output for the held value —
       but that output is the ENUMERATED settings, so a held position the
       control does not offer was never in it and the whole readout returned
       null. R4's economic ceiling made that reachable: the dial now stops at
       the breakeven, and a lane still holding a higher number is exactly the
       reader the `You hold` row exists for. `settingLaneAt` constructs the
       lane at any position through the sweep's own constructor. */
    settingLaneAt(control, lane, held).lane;
  if (!heldLane) return null;

  const best = numAxis("netApy", winnerLane);
  const mine = numAxis("netApy", heldLane);
  if (!finite(best) || !finite(mine)) return null;
  const delta = best - mine;
  const atCorner = Object.is(held, winner) || Math.abs(delta) < IDENTITY_EPS;
  const alt =
    base.objective === "netApy" ? verdict.compared.find((a) => a !== "netApy") : base.objective;

  /* The verdict row stays first and the defeat row stays last; only the two
     middle rows are re-pointed. Destructured by position rather than indexed,
     so this file keeps its no-numerals discipline. */
  const [lines, , , ...tail] = base.rows;
  const cornerWord = readAxis("cushion", winnerLane)?.text ?? renderSetting(control, winner);
  const corner: ReclaimRow = {
    label: "Corner",
    value: [cornerWord, objectiveLine(base.objective)].join(" · "),
  };
  const holding: ReclaimRow = {
    label: "You hold",
    value: [
      renderSetting(control, held),
      atCorner ? "at the corner" : Math.abs(delta) >= EVEN_FLOOR ? costLine(delta) : "",
      atCorner ? "" : altReading(alt, heldLane),
    ]
      .filter((s) => s.length > 0)
      .join(" · "),
  };
  return { ...base, rows: [lines, corner, holding, ...tail] };
}

/** The runner-up's reading on the other compared axis, with the axis's own
 *  noun attached. A bare `$656K` beside a leverage is a number with no
 *  referent, which is the shape a caveat has. */
function altReading(axis: AxisId | undefined, lane: AxisLane): string {
  if (!axis) return "";
  const r = readAxis(axis, lane);
  if (!r) return "";
  return `${r.text} ${AXIS_RENDERERS[axis].label.toLowerCase()}`;
}

function numAxis(id: AxisId, lane: AxisLane): number | null {
  const r = readAxis(id, lane);
  return r && typeof r.value === "number" ? r.value : null;
}

/**
 * The axis the winner is uniquely best on, out of the axes the sweep actually
 * COMPARED. Where the winner is not uniquely best on any of them there is no
 * objective to publish and the block renders nothing, which is L10's own
 * failure mode rather than a softer sentence.
 */
function winningAxis(
  control: Control,
  compared: readonly AxisId[],
  winnerLane: AxisLane,
  settings: readonly { value: ParamValue; lane: AxisLane }[],
): AxisId | null {
  const declared = declaredObjective(control);
  const order = [
    ...compared.filter((a) => a === declared),
    ...compared.filter((a) => a === "netApy" && a !== declared),
    ...compared.filter((a) => a !== declared && a !== "netApy"),
  ];
  for (const axis of order) {
    const def = AXIS_RENDERERS[axis];
    if (def.direction === "neither") continue;
    const mine = numAxis(axis, winnerLane);
    if (!finite(mine)) continue;
    let unique = true;
    for (const s of settings) {
      if (s.lane === winnerLane) continue;
      const other = numAxis(axis, s.lane);
      if (!finite(other)) continue;
      const better = def.direction === "higher" ? other > mine : other < mine;
      if (better || other === mine) {
        unique = false;
        break;
      }
    }
    if (unique) return axis;
  }
  return null;
}

/** What the DESCRIPTOR claims about its own default. A tie-break here, never
 *  published on its own. */
function declaredObjective(control: Control): AxisId | null {
  if (control.kind === "install") return null;
  const d = MODULE_DEFS[control.module].params.find((p) => p.field === control.field);
  return d?.objective ?? d?.defaultRationale ?? null;
}

/** The verdict row's four states, keyed on the leg array and nothing else. */
const VERDICT_ROW: Record<ReturnType<typeof verdictKey>, string> = {
  none: "none",
  "short-only": "one, the perp short",
  "borrow-only": "one, the lending leg",
  "borrow-and-short": "two, the lending leg and the perp short",
};

function settingLabel(control: Control): string {
  if (control.kind === "install") return MODULE_DEFS[control.module].name;
  const d = MODULE_DEFS[control.module].params.find((p) => p.field === control.field);
  return d?.friendlyLabel ?? control.field;
}

/**
 * A setting, in the unit its descriptor declares.
 *
 * A leverage prints through `format.lev`, because `3` and `3.00x` are one
 * quantity in two spellings and the plate 200px away prints the second one.
 * Everything else prints its stored value: the reclaim block states what was
 * WRITTEN, and a re-rendered value is a second owner.
 */
function renderSetting(control: Control, v: ParamValue): string {
  if (typeof v === "boolean") return v ? "installed" : "not installed";
  if (control.kind === "param") {
    const d = MODULE_DEFS[control.module].params.find((p) => p.field === control.field);
    if (d?.unit === "x" && typeof v === "number") return lev(v);
  }
  return String(v);
}

/** "the highest modeled net APY here". No first person plural: `Set to` is
 *  agentless and true; `We set` invites `why did you` and makes an objective
 *  sound like a preference. */
function objectiveLine(axis: AxisId): string {
  return OBJECTIVE_LINE[axis] ?? readAxisLabel(axis);
}

const OBJECTIVE_LINE: Partial<Record<AxisId, string>> = {
  netApy: "the highest modeled net APY here",
  capacity: "the most deposit room here",
  cushion: "the largest cushion here",
  actionCount: "the fewest actions a year here",
  shortMargin: "the most short margin here",
  refillsFunded: "the most funded refills here",
  downsideFloor: "the highest floor here",
  upsideCap: "the highest cap here",
  reactionWindow: "the widest reaction window here",
  driftBeforeTrim: "the earliest trim here",
};

function readAxisLabel(axis: AxisId): string {
  return `the best ${axis} here`;
}

/**
 * The cost of the next best, in points of modeled net APY.
 *
 * ONE UNIT, ALWAYS, and it is the objective's: `ppMag` is the magnitude form,
 * so the number sits in the slot and the direction sits in the word (`1.6pp
 * less`). A − glyph beside `less` would double-count the direction the word
 * already carries, which is the same discipline the register's value slot runs
 * under. `pp` means percentage points and `%` means a rate, everywhere (R2).
 */
function costLine(delta: number): string {
  if (!finite(delta)) return "";
  return `${ppMag(Math.abs(delta), 1)} less`;
}
