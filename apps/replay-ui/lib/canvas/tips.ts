/**
 * CANVAS TIPS — the pure rules engine (TIP_SPEC 2026-08-21, §B/§C).
 *
 * The header rail says WHAT IS TRUE. The canvas tip stack says WHAT TO DO
 * NEXT, and it can do it. `.rail-guide` is deleted (R1): two voices saying
 * the same sentence, one passive in chrome and one actionable on canvas, is
 * exactly what the founder objected to.
 *
 * ── THE USEFULNESS BAR (merge gate) ──────────────────────────────────────
 * Every entry in this catalog — including the twentieth one somebody adds in
 * six months — must satisfy at least ONE of:
 *   (a) it unblocks Review and publish;
 *   (b) accepting it changes modeled portfolio APY by >= 25bps;
 *   (c) it states a fact the canvas does not display anywhere else.
 * Anything failing all three is rejected. Rejected by name and NOT to be
 * re-proposed: no-compound, allocation-tilt, second-loop, sub-floor,
 * wallet-connect, "switch to the top-ranked market", congratulations /
 * streaks / greetings / onboarding tours / "did you know" / emoji, any tip
 * whose action is "dismiss", "gates 14/17 failing", "this lane models a
 * negative APY", "your leverage is near the house max".
 *
 * ── HARD RULINGS THIS FILE ENFORCES ──────────────────────────────────────
 * R4  A tip NEVER picks a market for the user. An `apply` may only ever run
 *     a dispatch that is ARITHMETICALLY DETERMINED by state the user already
 *     chose. Choosing a different market is a curation act and is always a
 *     `reveal` that opens the dock's market list.
 * R6  Catalog staleness is chrome, never a tip. No tip string may contain
 *     "live", "fresh", "current", "now", "today", "right now" or "as of".
 *     The only scoped survivor is `quote-fell-back`, which fires only where
 *     a live re-quote actually exists and actually failed.
 * A3  Every number a tip prints comes out of `publishedNetApy` /
 *     `candidateApy` / `hedgeValue` / `ok.candidate.economics` — the same
 *     functions the header calls. Tip and header must be incapable of
 *     disagreeing. Never a parallel calculation.
 *     A3b · THE FRAME (C6, 2026-08-24, ruling R1). `lane.netApy` is the lane
 *     header, which is `publishedNetApy` — the PRODUCT number, the house's
 *     20% compute fee inside it. `lane.stops[].netApy` is now the same frame:
 *     `leverage-stops.ts`, `axes.ts`, `dominance.ts` and this file moved
 *     together, because B8 below SUBTRACTS a stop from the header and a delta
 *     between two frames is a number tracing to no formula. Before the move
 *     that subtraction mixed a pre-fee stop with a post-fee header and
 *     `ppMag(delta)` printed the difference of two different questions. See
 *     `__tests__/one-frame.test.ts`.
 *
 * PURITY (C2): no React import, no side effects, no `Date.now()`. Everything
 * time-dependent (hysteresis, quiet gate, caps, dismissal, oscillation mute)
 * lives in components/canvas/useTips.ts. Separating "what is true" from
 * "what is shown right now" is the only way those rules stay testable.
 *
 * COPY BUDGET (C15, asserted in __tests__/tips.test.ts): title <= 52 chars
 * and <= 8 words, body <= 96 chars and <= 14 words, no em dashes, none of
 * the forbidden vocabulary. At 296px wide with 15px padding the measure is
 * 266px ~ 46 chars of Hanken 11.5px, so the 96-char body cap IS the two-line
 * clamp: any clamped tip is a copy bug and fails CI. (The spec's prose says
 * "<= 5 words"; its own catalog copy runs to 8 — "Loop 1 holds 72%, the
 * router caps 60%" — so the WORD cap is set at the catalog's real maximum
 * and the CHAR cap, which is the one the layout actually enforces, is hard.)
 *
 * NUMBER TOKENS: backticks in a title/body wrap a mono tabular numeral —
 * `5.42%`, `2.4x`, `$4.1M`, `49,411,780`. The unit lives INSIDE the token so
 * a number never breaks across the mono/sans boundary. Backticks are never
 * part of the copy and are stripped before every budget assertion.
 */

/* eslint-disable @typescript-eslint/prefer-optional-chain --
 * Kit-verbatim file, ported from build.priime.finance eb6d33a. The findings
 * are the typed presets reading kit idioms; not rewriting kit logic to satisfy
 * lint, per the integration's own directive (the RackCanvas.tsx precedent). */

import { LAUNCHABLE_VENUES, isTemplateVenue, type CanvasVenueId } from "./opportunities";
/* `composedNetApy` and `repriceAtLeverage` were imported here and called
   nowhere (C6, 2026-08-24). Dropped rather than left: this file must not hold
   a venue-frame pricer, because every APY it reasons about is `lane.netApy`,
   the header's own PRODUCT number, handed in by `RackCanvas` (A3b). */
import { catalogRow } from "./mock-quote";
import { FAMILY_REQUIRED, nodeFor, type LaneFamily } from "./graph-ops";
import { nodeId } from "./ids";
import { bestStop, type LeverageStopView } from "./leverage-stops";
// R3 (2026-08-22): the tip layer no longer reads a hedge quantity. B7 and B13
// render from ONE `hedgeEconomics` object per lane — the same object the plate
// hero, the balance bar and the ledger render from — so the tip and the plate
// are structurally incapable of quoting two different numbers for one hedge.
// That is the founder's screenshot, closed at the source rather than at the
// two call sites that happened to disagree.
import { hedgeEconomics, hedgeHeroParts, hedgeTipBody, type Segment } from "./hedge-econ";
import { capacityResourceKey, fmtCapacityUsd, vaultCapacity } from "./capacity";
import { lev, pct as fmtPct, pp as fmtPp } from "./format";
import { PRODUCT_MIN_LEVERAGE } from "./param-schema";
import { pricingParamsFor } from "./pricing-params";
import { buildUnifiedList, deriveBest, type UnifiedRow } from "./unified-list";
import type {
  LoopGraph,
  LoopId,
  ModuleKey,
  PortfolioGraph,
  PortfolioValidationResult,
} from "./types";
import type { RepriceFailureKind } from "./reprice-state";
import type { OpportunitiesPayload, RepriceData } from "@/components/canvas/types";

// ── Shape (C1) ────────────────────────────────────────────────────────────

export type TipKind = "block" | "tune" | "note";
export type TipMode = "apply" | "reveal";

/**
 * `actionId` is an ENUM, never a function. Every gate — dedupe, hysteresis,
 * dismissal, mute — keys off `Tip.id`, so ids must never be random or
 * index-based.
 */
export type TipActionId =
  | "install-defaults"
  | "add-module"
  | "remove-hedge"
  /** Eject the named `moduleKey`. The generic form `remove-hedge` should have
   *  been (2026-08-23); `remove-hedge` survives for its two block/tune tips. */
  | "remove-module"
  | "add-hedge"
  | "set-leverage"
  | "clamp-allocation"
  | "requote"
  | "open-swap"
  | "focus-module";

export interface TipAction {
  label: string;
  mode: TipMode;
  actionId: TipActionId;
  /** The lane the dispatch targets (portfolio-scope tips name it here). */
  loopId: LoopId | null;
  moduleKey?: ModuleKey;
  /** `clamp-allocation` only: the bps the reducer is asked to write. */
  bps?: number;
  /** `set-leverage` only: the leverage the reducer is asked to write. The tip
   *  NAMES this number in its own copy, so the card and the dispatch cannot
   *  describe two different positions — which is exactly what happened while
   *  the action was called `risk-safer` and translated an adjective at the
   *  far end. */
  leverage?: number;
  /** Past-tense receipt line (E5). Fraunces italic, one line, no period. */
  receipt: string;
}

export interface Tip {
  /** Condition-derived and stable: "hedge-mismatch:loop_2". */
  id: string;
  kind: TipKind;
  rank: number;
  /** null = portfolio scope. */
  loopId: LoopId | null;
  /** Dock-suppression and hover/dart targeting. */
  moduleKey?: ModuleKey;
  /** The lane's own name, clamped; omitted entirely at portfolio scope. */
  kicker?: string;
  /** Full lane name for the `title` attribute when the kicker is clamped. */
  kickerFull?: string;
  title: string;
  body: string;
  /** Fraunces-italic provenance line. Only on tips making a market claim. */
  stamp?: string;
  action: TipAction | null;
  /** Hashes the inputs the tip is ABOUT (C8). */
  causeSig: string;
  /** Board-scoped selector for the hover ring and the dart (E2/E5b). */
  targetSel: string | null;
  /** Lane order, for the C3 tiebreak after rank and firstSeenAt. */
  laneIndex: number;
  /**
   * THE STACKED-CARD SAFETY FLAG (P0, 2026-08-22).
   *
   * `TipStack` quiets every card below the first by omitting its BODY — and
   * renders the action key unconditionally. On a tip whose body carries the
   * DISCLOSURE of what pressing that key sells (B7's remove branch: "Ejecting
   * leaves you 1.0x long BERA"), that is a one-click unpriced risk transfer
   * with the price rendered nowhere. Stacking is not an edge case either: it
   * is the DEFAULT for a rank-200 tune the moment any block is also true.
   *
   * `consequential` marks the tips where the body is the price of the key.
   * When such a tip is stacked, the stack downgrades its key to REVEAL —
   * focus the module, where the same disclosure is permanent — instead of
   * hiding the disclosure and keeping the apply. Never the other way round:
   * suppressing the CARD would take the block's slot away for no reason.
   */
  consequential?: boolean;
}

export const TIP_RANK = {
  spineIncomplete: 100,
  familyIncomplete: 105,
  classConflict: 110,
  duplicateMarket: 115,
  marketNeverPositive: 118,
  noMarket: 120,
  hedgeMismatch: 200,
  venueDominated: 205,
  leverageYieldNegative: 210,
  sharedFundingStream: 230,
  allocOverCap: 240,
  venueNotLaunchable: 300,
  leverageHeldAtNoDebt: 305,
  fundingShare: 310,
  quoteFellBack: 320,
} as const;

/**
 * THE RANK BANDS ARE A CONTRACT, NOT A CONVENTION (§(d) ordering rule 1).
 *
 *   100–149  block   unblocks Review, or states a fact that makes the vault wrong
 *   200–299  tune    accepting it changes modeled APY by >= 25bps
 *   300–399  note    states a fact, no APY claim
 *
 * Kind precedence is the ONE ordering property C3 says must never move, and
 * it is enforced today only by everyone picking ranks in the same spirit. The
 * test asserts every emitted tip's rank sits inside its own kind's band, so
 * the next contributor who picks a rank by feel inverts kind precedence in CI
 * instead of on a founder's screen.
 */
export const TIP_RANK_BANDS: Record<TipKind, readonly [number, number]> = {
  block: [100, 149],
  tune: [200, 299],
  note: [300, 399],
};

/** R6. Asserted over every string in the catalog by the test contract. */
export const FORBIDDEN_TIP_WORDS: readonly string[] = [
  "live",
  "fresh",
  "current",
  "now",
  "today",
  "right now",
  "as of",
];

// ── Context (C2) ──────────────────────────────────────────────────────────

/** The pricing params RackCanvas already derives per lane. */
export interface TipLanePricing {
  venue: string;
  candidateId: string;
  launchableVenue: boolean;
  targetLeverage: number;
}

/**
 * One lane, exactly as `RackCanvas.laneComputed` already computes it. Declared
 * structurally so RackCanvas hands its own array straight in.
 */
export interface TipLane {
  loop: LoopGraph;
  p: TipLanePricing;
  ok: (RepriceData & { ok: true }) | null;
  graphOk: boolean;
  classCoherent: boolean;
  laneReviewable: boolean;
  netApy: number | null;
  leverageYieldNegative: boolean;
  family: LaneFamily;
  /** The leverage stops this lane's market offers, from `laneLeverageStops`.
   *  The tip quotes its counterfactual off these, which is the same view model
   *  the dock control renders and the same path the button applies. */
  stops: LeverageStopView[];
}

export interface TipContext {
  lanes: TipLane[];
  portfolio: PortfolioGraph;
  validation: PortfolioValidationResult;
  ltByLoop: Record<LoopId, number | null>;
  oppData: OpportunitiesPayload | null;
  /** Set only where a LIVE reprice request answered with a failure. */
  repriceFail: Record<LoopId, RepriceFailureKind | null>;
  houseFloor: number;
  /**
   * TIP COEXISTENCE (COMPOSE_PANEL_SPEC §7). Lanes whose compose card is
   * VISIBLE right now: dock open, not collapsed, scope null or scoped to that
   * lane.
   *
   * B7's ADD branch is suppressed for those lanes — the add bay states the
   * identical sentence permanently, next to the control that acts on it, and
   * a transient card repeating a standing affordance is noise.
   *
   * The REMOVE branch is NOT gated: an installed module costing 12.6pp is
   * genuine news, not a repeat of an affordance, and "remove the hedge to
   * earn 11.2pp more" is not something a user would ever think to try.
   *
   * When the dock is COLLAPSED this is empty and the tip is the only voice,
   * which is exactly when it should fire.
   *
   * The rank is deliberately unchanged and the tip is deliberately not made
   * sticky: it was already emitting the right sentence and it did not stop
   * the founder asking. The reason was structural — a permanent surface
   * contradicting it — and the fix was to FIX THE PLATE.
   */
  composeVisibleLoopIds?: LoopId[];
}

// ── Formatting helpers (all pure) ─────────────────────────────────────────

/**
 * Mono tabular numeral token. The unit lives inside; never a bare number.
 *
 * `n` is the ONLY thing this file may own about numbers: it is a MARKUP
 * wrapper, not a rounding law. Everything inside it comes from `format.ts`.
 * R5 grep (2026-08-22): `pct` and `usd` here were full private re-derivations
 * — the very ones `format.ts`'s docblock says it collapsed, still standing —
 * and they had already drifted on the sign glyph, emitting an ASCII hyphen
 * where the ratified law is U+2212. Delegating leaves every positive string
 * byte-identical and fixes the negatives.
 */
const n = (s: string) => `\`${s}\``;
const pct = (x: number, dp = 2) => n(fmtPct(x, dp));

/**
 * THE UNIT LAW, AND THE COPY DECISION IT FORCED (R2, closed 2026-08-22).
 *
 * This file used to define `pp` with a `%` glyph, so one card could print
 * `The hedge costs 7.7% here` above a body quoting an actual 8.7% funding
 * RATE. Two different quantities, one glyph, one screen — the mechanical
 * cause of the reported defect. `format.pp` is now the only source of the
 * digits.
 *
 * `format.pp` is ALWAYS SIGNED (`+7.7pp`), which reads wrong beside a verb:
 * "costs +7.7pp" states the sign twice and states it inconsistently, since
 * the verb already said the money leaves. The prior wave left the violation
 * standing rather than take that call. The call, taken:
 *
 *   · after a verb that carries the direction — `costs`, `pays`, `more`,
 *     `cheaper` — the magnitude is UNSIGNED: `costs 7.7pp`, `2.2pp more`.
 *   · standing alone in a value slot, it is SIGNED: `+2.2pp`, `−12.6pp`.
 *
 * One law, two forms, and which form applies is decided by the copy the
 * token sits in — never by the caller's convenience. `ppMag` is the
 * after-a-verb form and it is `format.pp` with the sign glyph removed, so the
 * DIGITS can never drift from the ledger's; `ppSigned` is the standing-alone
 * form and is `format.pp` verbatim.
 *
 * A LEVEL is still a `%` and still goes through `pct`. Where two levels fit
 * the budget, print the levels rather than the difference (B7's ADD branch).
 */
export const ppSigned = (x: number) => n(fmtPp(x));
export const ppMag = (x: number) => {
  const s = fmtPp(Math.abs(x));
  return n(s.startsWith("+") ? s.slice(1) : s);
};

/** Lane names are user-editable free text: clamp to 18, end ellipsis. */
export function clampLaneLabel(label: string): string {
  return label.length > 18 ? `${label.slice(0, 17)}…` : label;
}

/**
 * C17: a truncated market name is a lie about which market. Tip copy names
 * markets by PAIR only, and a pair over 22 chars drops to "this market".
 */
export function pairToken(pair: string): string {
  return !pair || pair.length > 22 ? "this market" : pair;
}

/** The pair as a copy token: mono when it IS a pair, plain when it degraded
 *  to "this market" — a mono run around three English words is a number token
 *  wrapped round something that is not a number. */
const pairTok = (pair: string) => {
  const t = pairToken(pair);
  return t === "this market" ? t : n(t);
};

/**
 * `hedge-econ`'s pre-split prose, rendered into this file's backtick markup.
 *
 * The hedge module authors its copy as `Segment[]` because the panel needs the
 * mono runs as real spans; the tip layer carries copy as one string with
 * backticks. This is a TRANSCRIPTION, not a second authoring: the words and
 * the numbers are `hedge-econ`'s, in `hedge-econ`'s order, and the budget
 * tests read the result.
 */
function segmentsToCopy(segs: Segment[]): string {
  return segs.map((s) => (s.mono ? n(s.text) : s.text)).join("");
}

/** Whole days between two payload timestamps. Never a clock read. */
function daysBetween(nowMs: number, thenMs: number): number {
  return Math.max(0, Math.floor((nowMs - thenMs) / 86_400_000));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** UTC so server and client render the same string. */
function scanDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function venueDoc(opp: OpportunitiesPayload | null, venue: string) {
  return opp?.venues.find((v) => v.venue === venue) ?? null;
}

/** "modeled · scanned 12d ago" — the provenance stamp (D6). */
function stampFor(ctx: TipContext, venue: string): string {
  const doc = venueDoc(ctx.oppData, venue);
  if (!doc || !ctx.oppData) return "modeled";
  const d = daysBetween(ctx.oppData.nowMs, doc.generatedAtMs);
  return d <= 0 ? "modeled" : `modeled · scanned ${n(`${d}d`)} ago`;
}

function srcParam(loop: LoopGraph, field: string): string {
  return String(nodeFor(loop, "liquidity-source")?.data.params[field] ?? "");
}

function hasHedgeModule(loop: LoopGraph): boolean {
  return !!nodeFor(loop, "hedge");
}

const plateSel = (loopId: LoopId, key: ModuleKey) => `[data-node-id="${nodeId(loopId, key)}"]`;
const laneSel = (loopId: LoopId) => `[data-loop-id="${loopId}"]`;

/**
 * The catalog, projected ONCE per payload.
 *
 * `market-never-positive` and `venue-dominated` are both claims about the
 * CATALOG, not about the lane, and `unified-list` already owns every one of
 * them: `bestApy` / `bestL` / `neverPositive` (the two-evaluation corner
 * solution, since net APY is affine in L) and `dominatedBy` (same pair, no
 * worse on capacity, no less launchable, meaningfully better APY). Re-deriving
 * either here would be a second model of the same fact and would let a tip
 * disagree with the Discover row it is pointing at — which is the class of
 * defect this whole wave exists to close.
 *
 * The WeakMap is a cache, not state: it is keyed on the payload object, so a
 * new payload projects afresh and a dropped payload is collected. `deriveTips`
 * stays observationally pure (C2) — same input object, same output, no clock,
 * no mutation anything else can see.
 */
const projected = new WeakMap<OpportunitiesPayload, UnifiedRow[]>();
function allRows(opp: OpportunitiesPayload | null): UnifiedRow[] {
  if (!opp) return [];
  const cached = projected.get(opp);
  if (cached) return cached;
  const list = buildUnifiedList(opp.venues);
  const rows = [...list.hedged, ...list.unhedged];
  projected.set(opp, rows);
  return rows;
}

/**
 * A stacked `consequential` tip's key, downgraded to a reveal (P0).
 *
 * The copy lives HERE and not in `TipStack` for the same reason all the other
 * copy does: it is user-visible prose under the C15 budget and the R6
 * vocabulary ban, and a string authored in a component is a string no test
 * reads. Returns null when there is nothing to reveal, and the caller then
 * leaves the key exactly as the catalog wrote it.
 */
export function revealForm(tip: Tip): TipAction | null {
  const a = tip.action;
  if (!a || a.mode === "reveal" || !a.loopId || !a.moduleKey) return null;
  return {
    label: REVEAL_LABELS[a.moduleKey] ?? "Show the module",
    mode: "reveal",
    actionId: "focus-module",
    loopId: a.loopId,
    moduleKey: a.moduleKey,
    receipt: "",
  };
}

const REVEAL_LABELS: Partial<Record<ModuleKey, string>> = {
  hedge: "Show the hedge",
  "safety-buffer": "Show the leverage",
  "liquidity-source": "Show the market",
  "auto-compound": "Show compounding",
};

/**
 * C15 — DOES THE TIPS KEY HAVE A SUBJECT? (founder, 2026-08-27: "no need for
 * tips button when no notification yet, it should only appear when at least
 * one notification triggered".)
 *
 * The same law the undo key already obeys in the nav row beside it: a control
 * nobody can act on is not an affordance. On a blank canvas C14 returns zero
 * candidates, so the key sat there lit with nothing behind it.
 *
 * TWO terms, and the second is not decoration:
 *
 *   `shownCount > 0` — the layer spoke. This is the founder's clause.
 *
 *   `muted && candidateCount > 0` — the layer WOULD speak but the master mute
 *      is holding it. This is the existing badge condition, verbatim: the key
 *      already renders ` N` in exactly this state to mean "N tips are waiting,
 *      unmute to see them". It is not a second rule, it is the rule that was
 *      already written.
 *
 * The second term is what keeps the fix from being worse than the bug. Under
 * master mute EVERY tip hard-stops (useTips C9), so `shownCount` can never
 * leave zero while muted — and the mute is PERSISTED, in the same `panels` key
 * RackCanvas writes to localStorage. Driven and confirmed 2026-08-27: mute,
 * blank the canvas, reload, and `aria-pressed` comes back `false` with zero
 * candidates. On the first clause alone the key would never mount again, in
 * that session or any later one, and the master mute is THE ONLY recovery path
 * out of a C8 session dismissal and a C7 oscillation mute. Losing the key loses
 * the recovery with it.
 *
 * The caller LATCHES this for the session (`useTips().everFired`) rather than
 * re-evaluating it per frame, for two reasons:
 *
 *   1. Dismissals and mutes OUTLIVE the condition that raised them. A tip
 *      oscillation-muted on lane 1 that then goes false leaves a mute in the map
 *      with zero candidates on screen; if the key unmounted there, bringing the
 *      condition back would be the only way to reach the recovery. Latched, the
 *      key is reachable the whole time the state it recovers can exist.
 *   2. Unmuting calls `reset()`, which clears every session map. An unlatched
 *      condition would drop both terms on that exact click and the key would
 *      vanish out from under the cursor for the 900ms of hysteresis before the
 *      first card came back.
 *
 * Note what is NOT here: a bare `candidateCount > 0`. Unmuted, a candidate can
 * be true and still correctly silent — mid-hysteresis, quiet-gated, C12
 * dock-suppressed, over the `tune` show cap. Mounting the key for those is the
 * founder's complaint again in a narrower window.
 */
export function hasTipSubject(shownCount: number, muted: boolean, candidateCount: number): boolean {
  return shownCount > 0 || (muted && candidateCount > 0);
}

// ── The catalog (§B) ──────────────────────────────────────────────────────

/**
 * Every candidate tip that is TRUE right now, sorted by rank. Unfiltered:
 * caps, dismissal, hysteresis and the quiet gate are `useTips()`'s job.
 */
export function deriveTips(ctx: TipContext): Tip[] {
  const out: Tip[] = [];
  // C14: the blank canvas shows ZERO tips. GhostSlot, the dock's Discover
  // mode and the rail meter already serve it; a card telling you to do the
  // one thing the empty canvas is visibly asking for is the canonical
  // cute-and-useless tip.
  if (ctx.lanes.length === 0) return out;
  const anyMarket = ctx.lanes.some((l) => !!l.p.candidateId);
  if (!anyMarket) return out;

  const orchOn = ctx.portfolio.orchestrator.enabled && ctx.portfolio.loops.length >= 2;
  const allocBps = ctx.portfolio.orchestrator.allocationsBps;

  ctx.lanes.forEach((lane, laneIndex) => {
    const loopId = lane.loop.id;
    const label = clampLaneLabel(lane.loop.label);
    const base = {
      loopId,
      laneIndex,
      kicker: label,
      kickerFull: lane.loop.label,
    };
    const cid = lane.p.candidateId;
    const hit = catalogRow(ctx.oppData, cid);
    const perLoop = ctx.validation.perLoop[loopId];
    const classConflict = !!perLoop?.issues.some((i) => i.code === "unhedged-class-forbids-hedge");

    // ── B3 · class-conflict — rank 110 (block) ──
    // The single clearest upgrade over the deleted guide line, which printed
    // this validator's message verbatim with no way out.
    if (classConflict) {
      out.push({
        ...base,
        id: `class-conflict:${loopId}`,
        kind: "block",
        rank: TIP_RANK.classConflict,
        moduleKey: "hedge",
        title: "This market has no perp to hedge",
        body: "Ejecting the hedge reprices the lane.",
        action: {
          label: "Remove the hedge",
          mode: "apply",
          actionId: "remove-hedge",
          loopId,
          moduleKey: "hedge",
          receipt: "Hedge removed",
        },
        causeSig: `cid:${cid}`,
        targetSel: plateSel(loopId, "hedge"),
      });
    }

    // ── B1 · spine-incomplete — rank 100 (block) ──
    if (cid && !lane.graphOk && lane.family === "loop" && !classConflict) {
      out.push({
        ...base,
        id: `spine-incomplete:${loopId}`,
        kind: "block",
        rank: TIP_RANK.spineIncomplete,
        title: `${label} has no spine yet`,
        body: "The defaults compose leverage, safety and compounding.",
        action: {
          label: "Install the defaults",
          mode: "apply",
          actionId: "install-defaults",
          loopId,
          receipt: `Defaults installed on ${label}`,
        },
        causeSig: `cid:${cid}`,
        targetSel: laneSel(loopId),
      });
    }

    // ── B2 · family-incomplete — rank 105 (block) ──
    if (cid && !lane.graphOk && lane.family !== "loop") {
      const missing = FAMILY_REQUIRED[lane.family].find((k) => !nodeFor(lane.loop, k));
      const copy = missing ? FAMILY_COPY[missing] : undefined;
      if (missing && copy) {
        out.push({
          ...base,
          id: `family-incomplete:${loopId}`,
          kind: "block",
          rank: TIP_RANK.familyIncomplete,
          moduleKey: missing,
          title: copy.title,
          body: copy.body,
          action: {
            label: copy.key,
            mode: "apply",
            actionId: "add-module",
            loopId,
            moduleKey: missing,
            receipt: copy.receipt,
          },
          causeSig: `cid:${cid}|missing:${missing}`,
          targetSel: laneSel(loopId),
        });
      }
    }

    // ── B4 · duplicate-market — rank 115 (block) ──
    if (
      ctx.validation.issues.some((i) => i.code === "duplicate-market" && i.loopId === loopId)
    ) {
      out.push({
        ...base,
        id: `duplicate-market:${loopId}`,
        kind: "block",
        rank: TIP_RANK.duplicateMarket,
        moduleKey: "liquidity-source",
        title: "Two loops, one market",
        body: "Reallocating inside one market is not diversification.",
        action: {
          label: "Show markets",
          mode: "reveal",
          actionId: "open-swap",
          loopId,
          receipt: "",
        },
        causeSig: `cid:${cid}`,
        targetSel: plateSel(loopId, "liquidity-source"),
      });
    }

    // ── B5 · no-market — rank 120 (block) ──
    // The "another lane already has one" clause is what keeps this off a
    // blank canvas.
    if (!cid && ctx.lanes.some((o) => o.loop.id !== loopId && !!o.p.candidateId)) {
      out.push({
        ...base,
        id: `no-market:${loopId}`,
        kind: "block",
        rank: TIP_RANK.noMarket,
        moduleKey: "liquidity-source",
        title: `${label} has no market`,
        body: "Every loop prices from its own market.",
        action: {
          label: "Show markets",
          mode: "reveal",
          actionId: "open-swap",
          loopId,
          receipt: "",
        },
        causeSig: `lane:${loopId}`,
        targetSel: laneSel(loopId),
      });
    }

    // ── ADD-1 · market-never-positive — rank 118 (block) ──
    // Two live rows are negative at EVERY reachable leverage under both
    // compositions, clear the capacity filter, and are publishable in three
    // clicks. The canvas states this nowhere: the Discover card prints the
    // value at the row's own scan leverage (which on a negative-spread row is
    // the value at the WORST setting) and the lane prints one number at one
    // dial position. `deriveBest` is the owner of "best reachable", so this
    // card and the Discover dead group cannot disagree.
    //
    // `block`, therefore undismissable, therefore its action is a REVEAL:
    // there is no leverage that fixes this lane, an apply would be theatre,
    // and leaving a market is a curation act (R4).
    const best = hit && lane.family === "loop" ? deriveBest(hit.row) : null;
    if (cid && best && best.apy < 0) {
      out.push({
        ...base,
        id: `market-never-positive:${loopId}`,
        kind: "block",
        rank: TIP_RANK.marketNeverPositive,
        moduleKey: "liquidity-source",
        title: "No leverage models a positive return",
        body: `Best here is ${pct(best.apy)} at ${n(lev(best.leverage))}.`,
        stamp: stampFor(ctx, lane.p.venue),
        action: {
          label: "Show markets",
          mode: "reveal",
          actionId: "open-swap",
          loopId,
          receipt: "",
        },
        causeSig: `cid:${cid}|best:${best.apy.toFixed(4)}`,
        targetSel: plateSel(loopId, "liquidity-source"),
      });
    }

    const cand = lane.ok?.candidate ?? null;
    const hasHedge = hasHedgeModule(lane.loop);

    // ── B7 · hedge-mismatch — rank 200 (tune) ──
    //
    // R3, 2026-08-22: every quantity on this card now comes off ONE
    // `hedgeEconomics` object. It proves its own decomposition against the two
    // APY functions the lane header itself calls and returns null rather than
    // print an unprovable number, so the failure mode is a blank card, never a
    // confident wrong one. `tipEligible` IS the guard the two branches used to
    // spell out by hand (priced, model-shaped, |net| >= MATERIAL_DELTA) — one
    // threshold, one unit, one file, so the panel and the tip can no longer
    // disagree about whether a delta is worth mentioning.
    //
    // Gated on A1: the hedge's value is SIGNED. A blanket "add the hedge"
    // would be actively wrong on three Dolomite rows, so this is
    // bidirectional and never phrased as a warning in either direction.
    //
    // The `family === "loop"` guard STAYS, and here is why: on a dn-lp lane
    // `hedgelessApy` takes the hand-authored fork and returns a fee APR with
    // no LVR term, so the model rewards deleting delta-neutrality by +2.6pp. A
    // hedge tip on that family would be the product paying the user to break
    // the strategy. It comes off when the dn-lp dials price, not before.
    /* THE COMPOSITION, FROM ITS OWNER (C6, 2026-08-24). `pricingParamsFor` is
       the same call `RackCanvas`, the plate and the compose dock make on this
       lane's graph, so all four hold ONE hedge object rather than four objects
       that happen to agree at one decimal place. */
    const hEcon =
      lane.family === "loop" ? hedgeEconomics(cand, pricingParamsFor(lane.loop)) : null;
    let hedgeMismatchHere = false;
    if (hEcon?.tipEligible) {
      // §7 — the ADD branch stands down while the compose card offers the
      // identical sentence permanently. The REMOVE branch below never does.
      const composeShows = (ctx.composeVisibleLoopIds ?? []).includes(loopId);
      if (!hasHedge && hEcon.product.netPp > 0 && !composeShows) {
        hedgeMismatchHere = true;
        out.push({
          ...base,
          id: `hedge-mismatch:${loopId}`,
          kind: "tune",
          rank: TIP_RANK.hedgeMismatch,
          moduleKey: "hedge",
          title: "This market prices a funding leg",
          // TWO LEVELS, not a difference: where both endpoints fit the budget
          // the levels are strictly more informative and they carry no unit
          // ambiguity at all. Both are RATES, so both wear `%`.
          //
          // ⚠ CLOSED (C6, 2026-08-24). These endpoints used to be VENUE-frame
          // fields on a product surface — the carried Wave 2 residual. The fix
          // was not to apply the fee here: that would have been a fourth owner
          // of R1's ordering beside `RackCanvas.composedPair` and
          // `ComposePanel`'s eject announcement, and the plate 200px away would
          // still have printed the venue number. `HedgeEconomics` carries BOTH
          // frames now, the bare fields are gone, and every product surface
          // takes `product` — which is `publishedNetApy` on both endpoints, so
          // the number here is the number the lane header prints after the key.
          body: `Modeled ${pct(hEcon.product.withApy)} with the hedge, ${pct(hEcon.product.withoutApy)} without.`,
          stamp: stampFor(ctx, lane.p.venue),
          action: {
            label: "Add the hedge",
            mode: "apply",
            actionId: "add-hedge",
            loopId,
            moduleKey: "hedge",
            receipt: "Hedge added",
          },
          causeSig: `cid:${cid}|hedge:0`,
          targetSel: plateSel(loopId, "hedge"),
        });
      } else if (hasHedge && hEcon.product.netPp < 0) {
        hedgeMismatchHere = true;
        // The title is the plate hero, CHARACTER-IDENTICAL: same verb, same
        // digits, same unit, from the same function. That is the structural
        // guarantee that the photographed bug (a plate and a tip disagreeing
        // about one hedge) cannot recur on this pair of surfaces.
        const hero = hedgeHeroParts(hEcon);
        out.push({
          ...base,
          id: `hedge-mismatch:${loopId}`,
          kind: "tune",
          rank: TIP_RANK.hedgeMismatch,
          moduleKey: "hedge",
          title: `The hedge ${hero.verb} ${n(hero.value)} here`,
          // RETIRED: "The margin escrow costs more than the funding pays."
          // It was a hand-written restatement of arithmetic the rule sentence
          // now performs with the actual numbers in it — and it said nothing
          // about what pressing the key SELLS. `hedgeTipBody` carries the
          // exposure disclosure FIRST, in degradation order, so a long symbol
          // costs the reader the teaching clause and never the disclosure.
          body: segmentsToCopy(hedgeTipBody(hEcon, true, hit?.row.collateralSymbol ?? "")),
          stamp: stampFor(ctx, lane.p.venue),
          // The body is the price of this key: stacked, it downgrades to a
          // reveal rather than offering the trade with the price hidden.
          consequential: true,
          action: {
            label: "Remove the hedge",
            mode: "apply",
            actionId: "remove-hedge",
            loopId,
            moduleKey: "hedge",
            receipt: "Hedge removed",
          },
          causeSig: `cid:${cid}|hedge:1`,
          targetSel: plateSel(loopId, "hedge"),
        });
      }
    }

    // ── ADD-2 · venue-dominated — rank 205 (tune) ──
    // The same pair exists on two venues with identical collateral yield and
    // identical perp coin, and the entire difference is the marginal borrow
    // rate — a number printed on NO surface in the product, while Discover
    // renders venues as separate collapsible sections so the two cards are
    // never adjacent. `dominatedBy` is the owner of the comparison: same pair,
    // no worse on capacity, no less launchable, meaningfully better APY.
    //
    // Ranked BELOW hedge-mismatch on purpose: fix the composition of the
    // market the user chose before suggesting they leave it. And a reveal,
    // never an apply — R4 forbids the product picking the trade.
    const rows = allRows(ctx.oppData);
    const thisRow = cid ? rows.find((r) => r.id === cid) : undefined;
    const lead = thisRow?.dominatedBy ?? null;
    if (lane.family === "loop" && thisRow && lead && (!lane.p.launchableVenue || LAUNCHABLE_VENUES.has(lead.venue))) {
      // The borrow-rate clause is only legal when BOTH sides quote a marginal
      // borrow rate. A missing one used to read as zero, which would print
      // "4.3pp cheaper to borrow there" off a single row — a fabricated
      // comparison. Absent it, the card falls back to the APY gap, which is
      // the quantity `dominatedBy` is defined on and therefore always present.
      const leadBo = rows.find((r) => r.id === lead.id)?.economics?.borrowApyMarginal;
      const thisBo = thisRow.economics?.borrowApyMarginal;
      const dbo =
        typeof leadBo === "number" && typeof thisBo === "number" ? thisBo - leadBo : null;
      const gap = lead.bestApy - (thisRow.bestApy ?? 0);
      out.push({
        ...base,
        id: `venue-dominated:${loopId}`,
        kind: "tune",
        rank: TIP_RANK.venueDominated,
        moduleKey: "liquidity-source",
        title: `${pairTok(thisRow.pair)} models ${pct(lead.bestApy)} elsewhere`,
        // Both clauses state a rate DIFFERENCE, so both wear `pp`, unsigned
        // behind the comparative that already carries the direction.
        body:
          dbo !== null && dbo >= 0.0005
            ? `Same pair, ${ppMag(dbo)} cheaper to borrow there.`
            : `Same pair, ${ppMag(gap)} more modeled there.`,
        stamp: stampFor(ctx, lead.venue),
        action: {
          label: "Show markets",
          mode: "reveal",
          actionId: "open-swap",
          loopId,
          receipt: "",
        },
        causeSig: `cid:${cid}|lead:${lead.id}`,
        targetSel: plateSel(loopId, "liquidity-source"),
      });
    }

    // ── B8 · a better leverage is reachable — rank 210 (tune) ──
    //
    // `netApy(L)` is AFFINE in L with slope `f_b·(cy − bo)`, so the optimum
    // over the dial's own bounds is always a CORNER, and on 13 of 15 live
    // depositable rows that slope is negative and the corner is the bottom
    // one. This card names the leverage that corner sits at.
    //
    // ⚠ IT USED TO NAME AN ADJECTIVE. The action was `risk-safer`, the label
    // said "Set risk to safer", and the receipt said "Risk set to safer" —
    // three strings about a word that meant a different position on every
    // market, attached to a button that wrote a number. The tip now states
    // the number it applies, quotes its delta at that number, and the reducer
    // writes that same number: one quantity, end to end.
    if (
      lane.family === "loop" &&
      !!nodeFor(lane.loop, "safety-buffer") &&
      cand &&
      lane.netApy !== null &&
      lane.stops.length > 1
    ) {
      const best = bestStop(lane.stops);
      /* DOWNWARD ONLY, and this is a product rule, not an arithmetic one.
         A stop BELOW the lane's leverage that models MORE yield is strictly
         dominant: more cushion and more yield, no trade to weigh, which is
         what makes a one-click fix unambiguously correct. A stop ABOVE it is
         a TRADE — cushion for yield — and the dock control now prints both
         sides of that trade permanently. A card pressing the user up the
         ladder would be the canvas arguing for more risk, against the same
         ruling that stopped defaults landing on the top stop (P1-4). */
      const lower = best !== null && best.leverage < lane.p.targetLeverage - 1e-6;
      /* ONE FRAME ON BOTH ENDPOINTS (C6, 2026-08-24). `best.netApy` is a
         `laneLeverageStops` cell and `lane.netApy` is the lane header; both
         are `publishedNetApy`, so this difference is a product-frame pp a
         reader can reproduce by subtracting two things on screen. It is also
         what the button applies, at the leverage it names. */
      const delta = best !== null && best.netApy !== null ? best.netApy - lane.netApy : null;
      if (best !== null && lower && delta !== null && delta > 0) {
        const large = delta >= 0.05;
        out.push({
          ...base,
          id: `leverage-yield-negative:${loopId}`,
          kind: "tune",
          rank: TIP_RANK.leverageYieldNegative,
          moduleKey: "safety-buffer",
          // R2: `delta` is a rate DIFFERENCE, so it wears `pp`. The
          // comparative `more` carries the direction, so it is unsigned.
          title: large
            ? `${lev(best.leverage)} models ${ppMag(delta)} more here`
            : "Leverage is not buying yield here",
          body: "Borrow costs more at the margin than the collateral earns.",
          stamp: stampFor(ctx, lane.p.venue),
          action: {
            label: `Set ${lev(best.leverage)}`,
            mode: "apply",
            actionId: "set-leverage",
            loopId,
            moduleKey: "safety-buffer",
            leverage: best.leverage,
            receipt: `${label} set to ${lev(best.leverage)}`,
          },
          causeSig: `cid:${cid}|lev:${lane.p.targetLeverage}|to:${best.leverage}`,
          targetSel: plateSel(loopId, "safety-buffer"),
        });
      }
    }

    // ── B8b · the leverage module held at no debt — rank 305 (note) ──
    //
    // DERIVED STATE, not a market claim: the lane HOLDS `safety-buffer` and
    // its dial sits at the product floor. At `L = 1` the module's whole
    // contribution is zero on every axis it declares (THE MODULE RULING), so
    // the lane with the plate and the lane without it are one machine. The
    // plate is the only thing on screen saying otherwise, and this card states
    // the fact (clause c) and offers the one-key exit the plate never had.
    //
    // NOTE, not tune: accepting it moves the modeled APY by exactly nothing,
    // which is the point. It fires only where the eject is legal — the hedge
    // holds the loop's required group — so the key can never strand a lane.
    if (
      lane.family === "loop" &&
      !!nodeFor(lane.loop, "safety-buffer") &&
      !!nodeFor(lane.loop, "hedge") &&
      cand &&
      lane.p.targetLeverage <= PRODUCT_MIN_LEVERAGE + 1e-9
    ) {
      out.push({
        ...base,
        id: `leverage-held-at-no-debt:${loopId}`,
        kind: "note",
        rank: TIP_RANK.leverageHeldAtNoDebt,
        moduleKey: "safety-buffer",
        title: "Dynamic leverage holds no debt here",
        body: "Remove it: same machine, one plate fewer.",
        action: {
          label: "Remove it",
          mode: "apply",
          actionId: "remove-module",
          loopId,
          moduleKey: "safety-buffer",
          receipt: "Dynamic leverage removed",
        },
        causeSig: `cid:${cid}|lev:${lane.p.targetLeverage}`,
        targetSel: plateSel(loopId, "safety-buffer"),
      });
    }

    // ── B9 · capacity-below-floor — RETIRED 2026-08-22 ──
    //
    // The merge gate's fourth clause, executed for the first time: A TIP WHOSE
    // FACT IS DISPLAYED BY A SHIPPED SURFACE IS RETIRED IN THE SAME PR THAT
    // SHIPS THE SURFACE. B9's only claim to the bar was clause (c), "states a
    // fact the canvas does not display anywhere else" — its action was a
    // reveal, so it never had clause (b). That clause evaporated when the lane
    // capacity line shipped: `ComposePanel` now prints
    // `<fmtCapacityUsd(laneCap)> capacity · <capacityBindingLabel(cand)>` on
    // the lane, and `PublishFlow` prints the same pair in Review. The card was
    // repeating, transiently and one formatter away, what two permanent
    // surfaces state.
    //
    // This is the mechanism that keeps the catalog at thirteen instead of
    // drifting to thirty. Do not re-add it; add the number to a surface.

    // ── B12 · venue-not-launchable — rank 300 (note) ──
    // The quant ranked this a blocker; the PO ranked it a dismissible note.
    // The PO wins on KIND (20 of 23 hedged rows sit on non-launchable venues,
    // and an undismissable card over a browsing user is a nag), the quant
    // wins on COPY. R4 forbids auto-swapping to the best launchable row.
    if (cid && !lane.p.launchableVenue && !isTemplateVenue(lane.p.venue)) {
      out.push({
        ...base,
        id: `venue-not-launchable:${loopId}`,
        kind: "note",
        rank: TIP_RANK.venueNotLaunchable,
        moduleKey: "liquidity-source",
        title: "This venue is modeled only",
        body: "Publishing runs on Morpho Blue.",
        action: {
          label: "Show what can launch",
          mode: "reveal",
          actionId: "open-swap",
          loopId,
          receipt: "",
        },
        causeSig: `cid:${cid}`,
        targetSel: plateSel(loopId, "liquidity-source"),
      });
    }

    // ── B13 · funding-is-the-income — rank 310 (note) ──
    //
    // REWRITTEN from ledger fields only (R3). Two defects, both closed:
    //
    //  (1) It divided by `econ.netApyOnDepositApy` while the dock's
    //      Composition card divided the same concept by the COMPOSED lane APY
    //      — 94% here, 88% two inches away, two answers to one question. The
    //      denominator is the hedge ledger's own `withApy`, the composed lane
    //      APY that ledger is built on, so the tip cannot disagree with it
    //      (A3). The numerator is `fundingPp`,
    //      which IS f_b·f off the same ledger the plate prints.
    //
    //  (2) It stated a share and stopped. On a vault whose income is
    //      nine-tenths one rate, the decision-relevant number is where that
    //      rate takes the lane to zero, and it existed on no surface:
    //      f0 = f − netApy/f_b. One subtraction over fields already in hand.
    //
    // The `<= 1.5` upper bound is GONE: a share over 100% is the interesting
    // case, not a filter reason. `grossCarry > 0` is new and is the guard
    // against firing for the wrong reason — on a degenerate row there is no
    // loop carry at all, so "most of this is funding" is trivially true and
    // says nothing about a choice anyone made.
    //
    // MUTUAL EXCLUSION (§(d) rule 4): `hedge-mismatch` DOMINATES. If the model
    // says the hedge should come off, the product must not say in the same
    // breath that funding is most of the income. The per-module cap catches
    // this at display time; suppressing it here catches it at derivation time,
    // which is where the contradiction actually lives.
    //
    // HONEST LIMIT: no funding-persistence or negative-streak copy. The
    // `funding.hours` / `longestNegativeStreakHours` fields exist on
    // HlCoinSnapshot but are dropped by projectV2Candidate, so any streak
    // line today would be fabricated.
    if (
      hasHedge &&
      !hedgeMismatchHere &&
      hEcon &&
      hEcon.state === "priced" &&
      hEcon.grossCarry > 0 &&
      lane.netApy !== null &&
      lane.netApy > 0
    ) {
      /* ⚠ BOTH OF THESE ARE COMPUTED INSIDE ONE FRAME, AND IT IS THE HEDGE
         LEDGER'S (C6, 2026-08-24, ruling R1).

         `fundingPp`, `fundingApr` and `fb` are venue-ledger fields on ONE
         `hedgeEconomics` object, whose own identity check asserts its
         difference equals its itemization — the compute fee is not one of
         those items, so that object stays on the venue frame by ruling. Its
         `withApy` is the composed lane APY it is built from, so all four
         terms below come out of the same object and the same frame.

         Dividing by `lane.netApy` instead — the PRODUCT number since Wave 1 —
         mixed a pre-fee numerator with a post-fee denominator. MEASURED on
         the committed fixtures: the plain kHYPE row sits at 76% of the venue
         APY and printed 95% against the published one, crossing the 0.8 gate
         it should not have crossed; the funding-heavy row read 91% and
         printed over 100%, flipping the card to "Funding is the whole return
         here" on a lane where a fifth of the rest is a house fee rather than
         a loss.

         THE SHARE IS FRAME-INVARIANT WHEN IT IS TAKEN IN ONE FRAME. The fee
         scales every term of a positive lane by the same factor, so
         `fundingPp / withApy` is the same fraction of the published number as
         of the venue one — which is why the body may quote it against
         `lane.netApy`, the figure in the header, without lying.

         THE ZERO-CROSSING IS NOT. `published` is zero exactly where the venue
         core is zero (the fee is charged on yield and there is none at the
         crossing), so `f0` must be solved on the venue core. Solving it on the
         published number moved the printed kill point away from the rate the
         lane actually zeroes at. */
      /* The frame is NAMED at every read since C6 closed the hedge-econ
         residual: `venue` here, and the paragraph above is the argument for
         it. Both terms of the ratio and both terms of the crossing come out of
         the same `venue` object, so neither can quietly pick up a fee the
         other does not carry. */
      const share = hEcon.venue.fundingPp / hEcon.venue.withApy;
      const zeroAt = hEcon.fundingApr - hEcon.venue.withApy / hEcon.fb;
      if (share >= 0.8) {
        const whole = share >= 1;
        out.push({
          ...base,
          id: `funding-share:${loopId}`,
          kind: "note",
          rank: TIP_RANK.fundingShare,
          moduleKey: "hedge",
          title: whole ? "Funding is the whole return here" : "Most of this is funding",
          body: whole
            ? `The rest nets negative, and funding zeroes at ${pct(zeroAt)}.`
            : `${pct(share, 0)} of the modeled ${pct(lane.netApy)}, and it zeroes at ${pct(zeroAt)} funding.`,
          stamp: stampFor(ctx, lane.p.venue),
          action: {
            label: "Show the hedge",
            mode: "reveal",
            actionId: "focus-module",
            loopId,
            moduleKey: "hedge",
            receipt: "",
          },
          causeSig: `cid:${cid}`,
          targetSel: plateSel(loopId, "hedge"),
        });
      }
    }

    // ── B14 · quote-fell-back — rank 320 (note) ──
    // The honesty backstop, and the ONLY surviving staleness surface (R6).
    // The no-failure-states policy is right, and it means a rail failure
    // silently drops the user onto an old catalog while the hero number
    // keeps looking current. State the pin, not a warning.
    const fail = ctx.repriceFail[loopId] ?? null;
    const doc = venueDoc(ctx.oppData, lane.p.venue);
    if (
      LAUNCHABLE_VENUES.has(lane.p.venue as CanvasVenueId) &&
      fail !== null &&
      lane.ok !== null &&
      doc?.stale === true
    ) {
      out.push({
        ...base,
        id: `quote-fell-back:${loopId}`,
        kind: "note",
        rank: TIP_RANK.quoteFellBack,
        moduleKey: "liquidity-source",
        title: `Quoted from the ${scanDate(doc.generatedAtMs)} scan`,
        body: `Block ${n(doc.blockNumber.toLocaleString("en-US"))}.`,
        stamp: "modeled",
        action: {
          label: "Re-quote",
          mode: "apply",
          actionId: "requote",
          loopId,
          receipt: "Re-quote sent",
        },
        causeSig: `cid:${cid}|block:${doc.blockNumber}`,
        targetSel: plateSel(loopId, "liquidity-source"),
      });
    }
  });

  // ── B10 · shared-funding-stream — rank 230 (tune, portfolio scope) ──
  // Two economic facts in one card. (i) validatePortfolio's duplicate-market
  // only catches identical candidateIds, so weETH/WETH + wstETH/WETH passes
  // as "diversified" while being one trade in two coats. (ii) Capacity is
  // NOT additive: capC and capD are per-COIN, so when capacityBinding is an
  // HL bound the portfolio's room is the MIN over the group, not the sum.
  const byCoin = new Map<string, LoopId[]>();
  for (const lane of ctx.lanes) {
    const coin = srcParam(lane.loop, "hlCoin");
    if (!coin) continue;
    byCoin.set(coin, [...(byCoin.get(coin) ?? []), lane.loop.id]);
  }
  for (const [coin, ids] of byCoin) {
    if (ids.length < 2) continue;
    const lowest = [...ids].sort((a, b) => (allocBps[a] ?? 0) - (allocBps[b] ?? 0))[0];
    const two = ids.length === 2;
    const venue = ctx.lanes.find((l) => l.loop.id === lowest)?.p.venue ?? "";
    // KEY ON THE RESOURCE, NOT THE COIN (§(d) B10 change). The coin is what
    // makes the FUNDING claim true — one perp, one funding stream — and it is
    // the right grouping for that half. It is NOT what makes the CAPACITY
    // claim true: two lanes can share a coin while binding on separate venue
    // borrow books, and "the same book caps them both" is then simply false.
    // The capacity clause is therefore earned by `capacityResourceKey`, and
    // its number comes from `vaultCapacity` through `fmtCapacityUsd`, so it
    // equals the Review card and the lane line exactly rather than being a
    // third opinion.
    const group = ctx.lanes.filter((l) => ids.includes(l.loop.id));
    const keys = group.map((l) =>
      l.ok?.candidate ? capacityResourceKey(l.ok.candidate, hasHedgeModule(l.loop)) : null,
    );
    const oneBook = keys.every((k) => k !== null && k === keys[0]);
    const cap = oneBook
      ? vaultCapacity(
          ctx.lanes.map((l) => ({
            candidate: l.ok?.candidate ?? null,
            hasHedge: hasHedgeModule(l.loop),
            allocationBps: ctx.lanes.length === 1 ? 10000 : (allocBps[l.loop.id] ?? 0),
          })),
        )
      : null;
    out.push({
      id: "shared-funding-stream",
      kind: "tune",
      rank: TIP_RANK.sharedFundingStream,
      loopId: null,
      laneIndex: ctx.lanes.length,
      title: two ? `Both loops hedge the ${n(coin)} perp` : `${n(String(ids.length))} loops hedge the ${n(coin)} perp`,
      body: cap
        ? `One funding stream, and one book caps the vault at ${n(fmtCapacityUsd(cap.usd))}.`
        : `One funding stream feeds ${two ? "both loops" : "every loop"}.`,
      stamp: stampFor(ctx, venue),
      action: {
        label: "Show other streams",
        mode: "reveal",
        actionId: "open-swap",
        loopId: lowest,
        receipt: "",
      },
      causeSig: `coins:${[...ids].sort().join(",")}`,
      targetSel: laneSel(lowest),
    });
    break; // one shared-stream card, ever
  }

  // ── B11 · alloc-over-cap — rank 240 (tune, portfolio scope) ──
  // The dial is clamped [35,80] but nothing enforces it against the
  // allocation vector; validatePortfolio only checks the sum. A compiled
  // artifact that contradicts its own rule from block one.
  //
  // SCHEDULED RETIREMENT, and the condition is written down: when
  // `validatePortfolio` gains the `targetWeight <= maxWeight` check that
  // `validateOrchestrator` already encodes, this tip goes. A dismissible card
  // is the wrong enforcement for an invariant the compiler should hold. It is
  // NOT retired in this pass, because that check does not exist yet and
  // removing the card today would leave the cap enforced by nothing at all.
  //
  // ONE DEFECT FIXED WHILE IT LIVES: at N lanes the cap is only satisfiable
  // when capPct >= 100/N, so at two lanes the dial's bottom positions are
  // structurally infeasible — the apply clamps one lane, `setAllocation`
  // largest-remainders the violation onto the other, the card re-fires there,
  // and two accepts later the oscillation mute has silenced the only surface
  // reporting the violation for the session. An infeasible cap now emits
  // nothing rather than a key that moves the problem.
  if (orchOn) {
    const capPct = Number(ctx.portfolio.orchestrator.params.maxConcentrationPct ?? 60);
    // The denominator is the count of loops the ALLOCATION VECTOR spans, not
    // the launch-shaped count the recette names: `orch-alloc-sum` requires
    // `allocationsBps` to cover every loop and sum to 10000, so an incomplete
    // lane still carries weight and still has to fit under the cap. Using the
    // launch-shaped count would suppress the card on the two-lane draft where
    // exactly one lane has a spine, which is the common case.
    const feasible = capPct >= 100 / Math.max(1, ctx.portfolio.loops.length);
    const over = !feasible
      ? undefined
      : ctx.lanes
      .map((l) => ({ id: l.loop.id, label: clampLaneLabel(l.loop.label), pct: (allocBps[l.loop.id] ?? 0) / 100 }))
      .filter((x) => x.pct > capPct)
      .sort((a, b) => b.pct - a.pct)[0];
    if (over) {
      out.push({
        id: "alloc-over-cap",
        kind: "tune",
        rank: TIP_RANK.allocOverCap,
        loopId: null,
        laneIndex: ctx.lanes.length,
        title: `${over.label} holds ${n(`${Math.round(over.pct)}%`)}, the router caps ${n(`${capPct}%`)}`,
        body: "The published rule and the split disagree.",
        action: {
          label: `Bring it to ${n(`${capPct}%`)}`,
          mode: "apply",
          actionId: "clamp-allocation",
          loopId: over.id,
          bps: Math.round(capPct * 100),
          receipt: `${over.label} brought to ${capPct}%`,
        },
        causeSig: `alloc:${ctx.lanes.map((l) => allocBps[l.loop.id] ?? 0).join(",")}|cap:${capPct}`,
        targetSel: ".rk-orch",
      });
    }
  }

  // C3: rank ascending, then lane order. NEVER by recency — a newly-true
  // `tune` must never displace an unresolved `block`, and reshuffling under
  // the cursor is how a user accepts the wrong thing.
  return out.sort((a, b) => a.rank - b.rank || a.laneIndex - b.laneIndex);
}

const FAMILY_COPY: Partial<Record<ModuleKey, { title: string; body: string; key: string; receipt: string }>> = {
  "auto-center": {
    title: "Add the range module",
    body: "A delta-neutral LP needs its range before it prices.",
    key: "Add the range",
    receipt: "Range added",
  },
  "covered-call": {
    title: "Add the call leg",
    body: "A collar writes the call that funds its floor.",
    key: "Add the call",
    receipt: "Call leg added",
  },
  "protective-put": {
    title: "Add the put floor",
    body: "A collar needs the floor the call premium buys.",
    key: "Add the put",
    receipt: "Put floor added",
  },
};

// ── Copy-budget introspection (used by the CI contract, C15) ──────────────

/** Strip the mono number tokens: backticks are markup, never copy. */
export function plainCopy(s: string): string {
  return s.replace(/`/g, "");
}

export const TIP_TITLE_MAX_CHARS = 52;
export const TIP_TITLE_MAX_WORDS = 8;
export const TIP_BODY_MAX_CHARS = 96;
export const TIP_BODY_MAX_WORDS = 14;
export const TIP_ACTION_LABEL_MAX_CHARS = 22;

/** Every user-visible string on a tip, for the budget and vocabulary tests. */
export function tipStrings(t: Tip): string[] {
  return [t.title, t.body, t.stamp ?? "", t.action?.label ?? "", t.action?.receipt ?? "", t.kicker ?? ""].filter(
    Boolean,
  );
}
