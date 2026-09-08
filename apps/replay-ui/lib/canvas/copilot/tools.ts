/**
 * Copilot tool surface (IT4_COPILOT_SPEC §2).
 *
 * COPILOT_TOOLS is the verbatim, stable-order tool list ([propose_portfolio,
 * explain_market, compare] — reordering invalidates the prompt cache). The
 * validators below are the server-side authority: model output is data, never
 * trusted. Every candidateId is re-checked against the LIVE opportunities set
 * (the same server-loaded venues the context was built from), the strategy and
 * the hedge are forced from the row, allocations repaired or rejected, and the
 * authoritative row snapshot (incl. the owning venue doc contentHash pin) is
 * embedded.
 *
 * ── WHAT THE MODEL MAY DECIDE, AND WHAT IT MAY ONLY NAME (2026-08-24) ─────
 *
 * It may decide: which markets, how many lanes, the split between them, and a
 * leverage on a loop lane. It may NAME the strategy, and naming it is how the
 * user's own word reaches the card, but a market carries exactly one strategy
 * and the row is what says which. Every other correction was already forced
 * here; the strategy is the one that was missing, which is why a treasury
 * collar used to apply as a levered loop on an options market.
 *
 * ── D2 (2026-08-24): THE SERVER CLAMPS, AND THE MODEL STOPPED DOING IT ────
 *
 * Asked for 9x on cbETH/WETH (Morpho Blue Base, bounded at 3.50x), the model
 * PRE-CLAMPED to 3.5 in its own tool call and narrated the correction in its
 * rationale. The seat landed correctly and the card explained itself, so this
 * looked like a working turn. It was not one: the payload carried `notes: []`,
 * so the deterministic clamp below never fired, and the correction the release
 * gate pins has still never run in production.
 *
 * The `leverage` description was the cause. It read "between 1 and the market's
 * own ceiling in <canvas_context>", which is an instruction to pre-clamp, and
 * the model followed it exactly.
 *
 * THE RULING: THE SERVER CLAMPS. Four reasons, and none of them is that model
 * prose was wrong on this turn:
 *
 *  1. ONE OWNER. Two owners for one correction is one too many, and on this
 *     turn only the un-tested one fired. They can silently disagree, and
 *     nothing anywhere would catch it.
 *  2. THE TESTED PATH BECOMES THE REAL PATH. The clamp note is exercised only
 *     by a test that forces a refusal the production model never produced. A
 *     branch proven in a fixture and unproven in the wild is exactly the gap a
 *     release gate exists to close.
 *  3. PROSE IS DROPPABLE, A NOTE IS NOT. `sanitizeModelProse` falls the
 *     rationale back to the EMPTY STRING on any house-rule hit. A rationale
 *     carrying the only statement of the correction can therefore vanish,
 *     leaving a card seated at 3.50x with nothing explaining where the user's
 *     9x went. `notes` is rendered verbatim and cannot be dropped.
 *  4. IT IS PINNABLE. No test that does not call the model can assert the
 *     model said something. Every test can assert a non-empty `notes`.
 *
 * So the description now asks for the LITERAL request and says so twice, and
 * `copilot-literal-leverage.test.ts` pins both halves: the schema asks for the
 * verbatim number, and a literal out-of-range request produces the clamped seat
 * AND a non-empty `notes`.
 */

import { seatedLeverage, type UnifiedRow } from "@/lib/canvas/unified-list";
import type { StrategyKind } from "@/lib/vaults/store";
import { STRATEGY_LABEL } from "@/lib/canvas/graph-ops";
import { snapToLeverageGrid } from "@/lib/canvas/leverage-stops";
import { deriveLeverageBounds, PRODUCT_MIN_LEVERAGE } from "@/lib/canvas/param-schema";
import { leverageModuleInstalls } from "@/lib/canvas/leverage-module";
import { lev } from "@/lib/canvas/format";
import {
  defaultSelFor,
  laneEconomicsFor,
  seatBoundsFor,
  seatedComposition,
  strategyForRow,
  type LaneEconomics,
} from "./lane-frame";

// ── Wire payload types (§3.2 / §3.3) ──────────────────────────────────────

export interface ProposalLoopSnapshot {
  venue: string;
  venueLabel: string;
  pair: string;
  /**
   * The scan's own class letter. It stays on the SNAPSHOT because
   * `buildPortfolioFromProposal` writes it into the `liquidity-source` param,
   * exactly as a hand pick does. It never reaches the model — the context
   * ships `kind` ("delta-neutral" / "unhedged"), which are the words the card
   * prints — and it must never reach a rendered string either.
   */
  cls: "A" | "N1";
  hlCoin: string | null;
  lt: number | null;
  /** The scan's own L0 for this row. It is the CEILING a stored leverage is
   *  capped at (A4) — above it the number moves and nothing reprices — so the
   *  blueprint carries it rather than the client re-deriving one. */
  loopLeverage: number | null;
  /** Owning venue doc pin — the same pin the canvas stores on pick. */
  contentHash: string;
  launchable: boolean;
  stale: boolean;
  snapshot: boolean;
}

/**
 * ⚠ `headlineAprPct` WAS HERE AND IT IS NOT COMING BACK (D1, 2026-08-24).
 *
 * It was the scan's `screeningApr` at the scan's own `L0` — a number no
 * shipped surface prints any more, at a leverage the rack frequently withholds
 * the module for. On `dolomite-berachain:ibera-wbera` it read −0.48% against a
 * product number of +16.31%: not a fee error, a FRAME error and a LEVERAGE
 * error at once, and one that flips the sign. A field that is wrong in the
 * sign cannot be repaired by subtracting a fifth of it. Everything that wants
 * a number takes `LaneEconomics`, which states both frames at the leverage the
 * lane is actually seated at.
 */

/**
 * Everything a REPLAY needs to seat a lane, and nothing the CARD prints.
 *
 * `buildPortfolioFromProposal` takes this shape rather than the full payload,
 * so the two other blueprint sources — the template deep links and the demo
 * seed — can hand it a lane to seat without also having to carry the card's
 * economics block.
 */
export interface ProposalSeat {
  candidateId: string;
  /** Which strategy this lane is, from `graph-ops.STRATEGIES`. Absent reads as
   *  `"loop"`. Never counted in prose here: a count beside the union is the
   *  second spelling that let a fifth strategy arrive uncovered. */
  strategy?: StrategyKind;
  leverage: number | null;
  leverageModule: boolean;
  hedge: boolean;
  compound: boolean;
  snapshot: ProposalLoopSnapshot;
}

/**
 * The seating half of a blueprint: what APPLY replays onto the canvas.
 *
 * The four presentation fields are optional and IGNORED by the replay. They
 * are declared so a full `ProposalPayload` (and the template and demo seeds,
 * which build one) satisfies this shape without a cast: what seats a lane and
 * what a card prints are two different jobs, and only the first one is here.
 */
export interface SeatedProposal {
  loops: readonly ProposalSeat[];
  allocationsBps: readonly number[];
  proposalId?: string;
  title?: string;
  rationale?: string;
  notes?: string[];
}

export interface ProposalPayload {
  proposalId: string;
  title: string;
  rationale: string;
  loops: {
    candidateId: string;
    /**
     * WHICH OF THE FOUR STRATEGIES THIS LANE IS (2026-08-24).
     *
     * Server-forced from the row through `strategyForRow`: a market carries
     * exactly one strategy and the model may name it but never choose it. It
     * is on the wire because the replay seats a DIFFERENT MODULE CHAIN per
     * strategy, and before this field the replay seated the loop chain
     * unconditionally — so a treasury collar applied as a levered loop on an
     * options market, which is not a machine that exists.
     */
    strategy: StrategyKind;
    /**
     * The loop's target leverage.
     *
     * ⚠ THIS WAS AN ADJECTIVE (`riskStop: "safer" | "balanced" | "max"`) until
     * 2026-08-22. The enum taught the model three words that named a different
     * position on every market, the validator coerced anything unrecognised to
     * the middle one, and the blueprint card then TITLE-CASED the word and
     * printed it as the lane's risk. A leverage is the quantity the lane
     * actually stores and publishes, and it is checkable.
     *
     * ALWAYS A NUMBER once the validator has run (2026-08-24). It used to be
     * null when the model declined to choose, and `apply.ts` then resolved the
     * null through the three-argument `landingLeverage` — without the
     * breakeven ceiling `seatedLeverage` carries — so on a market whose carry
     * crosses zero inside the dial's range the card priced one leverage and
     * APPLY seated another. The validator holds the live row, so it writes the
     * rack's own landing here and both sides read one number.
     *
     * The type stays nullable because the REPLAY also serves the template and
     * demo seeds, which may still name none.
     */
    leverage: number | null;
    /**
     * WHETHER THE LANE HOLDS THE LEVERAGE MODULE AT ALL (2026-08-23).
     *
     * `leverageModuleInstalls(row)` verbatim, decided HERE because the
     * validator is the one place the live row is in hand, and carried on the
     * wire because `apply.ts` replays the payload with no row to ask. Before
     * this field, `apply.ts` seated `safety-buffer` on EVERY blueprint lane
     * and wrote the forced `1.0` into it: the plate sat, three stops rendered,
     * NO DEBT lit — THE MODULE RULING applied to the templates and never to
     * the copilot. False means ABSENT, not defaulted: the lane is the
     * unlevered machine and `leverage` above is moot.
     */
    leverageModule: boolean;
    hedge: boolean;
    compound: boolean;
    snapshot: ProposalLoopSnapshot;
    /**
     * THE CARD'S ONLY SOURCE OF NUMBERS (2026-08-24, ruling D2).
     *
     * The blueprint card used to take its APY from the compile route,
     * which prices through the live scan and therefore answers for two Morpho
     * venues and nothing else. A funding lane came back with a NULL blend and
     * an honest violation that the APPLY gate did not read, so APPLY stayed
     * unlocked over a card with no number on it. Worse, the compile route was
     * a SECOND OWNER of a quantity the canvas already owns: the rack has never
     * priced a non-Morpho lane through it.
     *
     * The economics are computed server-side, from the live row already in
     * hand, through the one function `laneEconomicsFor`, at the composition
     * this lane will actually be seated with. The card renders them and blends
     * them with the payload's own allocations, so no fetch is needed to show a
     * number and the number is the one the lane header prints after APPLY.
     */
    lane: LaneEconomics;
  }[];
  /** Normalized: length == loops.length, sum 10000 (single loop: [10000]). */
  allocationsBps: number[];
  /** Server corrections, rendered verbatim on the card. */
  notes: string[];
}

/**
 * One market, as the explain and compare cards render it.
 *
 * The whole `LaneEconomics` block, at the market's DEFAULT selection, plus the
 * two words the card prints for the class. One shape for the market card and
 * the blueprint lane, so the two cards cannot disagree about one row: the four
 * fields this replaced (`capacityUsd`, `loopLeverage`, `eligible`,
 * `firstFailedGate`) were all scan-frame facts, and two of them were internal
 * ids with no place on a user surface at all.
 */
export interface ExplainRow extends ProposalLoopSnapshot {
  id: string;
  kind: "delta-neutral" | "unhedged";
  lane: LaneEconomics;
}

export interface ExplainPayload {
  row: ExplainRow;
}

export interface ComparePayload {
  rows: ExplainRow[]; // 2..4, order as requested
}

// ── Tool definitions (verbatim JSON, §2.1–2.3) ────────────────────────────

export const COPILOT_TOOLS = [
  {
    name: "propose_portfolio",
    description:
      "Propose a complete portfolio blueprint for the user to review. The client renders it as a blueprint card with a single APPLY key; nothing changes until the user applies it. Use ONLY candidate ids present in the <canvas_context> opportunities lists. One lane per distinct candidate id; never repeat a candidate. A delta-neutral market must have hedge true; an unhedged market must have hedge false. Every lane must name a strategy, and only a market whose own strategy matches may carry it. A market carrying an absence reason cannot be proposed. allocationsBps is parallel to loops and must sum to exactly 10000; pass null for a single loop.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description:
            "Short blueprint title, at most 60 characters, e.g. 'Two-lane delta-neutral on Base'. Never grade the risk in the title",
        },
        rationale: {
          type: "string",
          description:
            "One or two sentences on why this shape, in the honest modeled-only register. State no APY or percentage; the card prints each lane's own number.",
        },
        loops: {
          type: "array",
          items: {
            type: "object",
            properties: {
              candidateId: {
                type: "string",
                description: "Exact id of a candidate present in <canvas_context>",
              },
              strategy: {
                type: "string",
                enum: ["loop", "funding", "dnlp", "collar", "treasury"],
                description:
                  "Which of the five strategies this lane is. It must match the strategy the market in <canvas_context> names; the server corrects a mismatch and states the correction on the card.",
              },
              leverage: {
                type: ["number", "null"],
                description:
                  "The leverage the user asked for, verbatim, whatever its size. Do not compare it to the market's bounds and do not reduce it yourself. The server seats it, and where the request is above the market's own ceiling the server clamps it and states the correction on the card, so a user asking for 9x on a market bounded at 3.50x must arrive here as 9 and not as 3.5. 1 means supply with no borrow leg. null when the user named no leverage, which takes the market's own default. On a market where borrowing costs more at the margin than the collateral earns, every setting above 1 models less yield and less cushion than 1, so the server sets this loop to 1, removes the leverage module, and states that correction too. Only the loop strategy has a leverage at all.",
              },
              hedge: {
                type: "boolean",
                description:
                  "Hedge module on. Must be true for a delta-neutral market and false for an unhedged one",
              },
              compound: {
                type: "boolean",
                description: "Auto-compound module on",
              },
            },
            required: ["candidateId", "strategy", "leverage", "hedge", "compound"],
            additionalProperties: false,
          },
        },
        allocationsBps: {
          type: ["array", "null"],
          items: { type: "integer" },
          description:
            "Capital split in basis points, parallel to loops, summing to exactly 10000. null when there is a single loop.",
        },
      },
      required: ["title", "rationale", "loops", "allocationsBps"],
      additionalProperties: false,
    },
  },
  {
    name: "explain_market",
    description:
      "Surface one market as a structured detail card in the chat. Use when the user asks about a single specific market. candidateId must be an exact id present in <canvas_context>.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        candidateId: { type: "string", description: "Exact candidate id from <canvas_context>" },
      },
      required: ["candidateId"],
      additionalProperties: false,
    },
  },
  {
    name: "compare",
    description:
      "Surface a side-by-side comparison card for two to four markets. Every candidateId must be an exact id present in <canvas_context>.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        candidateIds: {
          type: "array",
          items: { type: "string" },
          description: "Two to four exact candidate ids from <canvas_context>",
        },
      },
      required: ["candidateIds"],
      additionalProperties: false,
    },
  },
] as const;

// ── Server-side validation (§2.4 — never trust the model) ─────────────────

export type LiveRow = UnifiedRow;

function snapshotOf(row: LiveRow): ProposalLoopSnapshot {
  return {
    venue: row.venue,
    venueLabel: row.venueLabel,
    pair: row.pair,
    cls: row.cls,
    hlCoin: row.hlCoin,
    lt: row.lt,
    loopLeverage: row.economics?.loopLeverage ?? null,
    contentHash: row.contentHash,
    launchable: row.launchable,
    stale: row.stale,
    snapshot: row.snapshot,
  };
}

export function explainRowOf(row: LiveRow): ExplainRow {
  return {
    ...snapshotOf(row),
    id: row.id,
    kind: row.cls === "A" ? "delta-neutral" : "unhedged",
    lane: laneEconomicsFor(row, defaultSelFor(row)),
  };
}

export type ProposalValidation =
  | { ok: true; payload: ProposalPayload }
  | { ok: false; reason: string; unknownIds: string[] };

interface RawProposalLoop {
  candidateId?: unknown;
  strategy?: unknown;
  leverage?: unknown;
  hedge?: unknown;
  compound?: unknown;
}

interface RawProposalInput {
  title?: unknown;
  rationale?: unknown;
  loops?: unknown;
  allocationsBps?: unknown;
}

function newProposalId(): string {
  return "prop_" + crypto.randomUUID().slice(0, 8);
}

/** Largest-remainder repair of an off-by-small integer vector to sum 10000. */
function repairAllocations(alloc: number[]): number[] {
  const sum = alloc.reduce((s, x) => s + x, 0);
  if (sum === 10000) return alloc;
  const scaled = alloc.map((x) => (x / sum) * 10000);
  const floors = scaled.map((x) => Math.floor(x));
  let remainder = 10000 - floors.reduce((s, x) => s + x, 0);
  const order = scaled
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => (b.frac !== a.frac ? b.frac - a.frac : a.i - b.i));
  const out = [...floors];
  for (const { i } of order) {
    if (remainder <= 0) break;
    out[i] += 1;
    remainder -= 1;
  }
  return out;
}

/**
 * Validate a propose_portfolio tool input against the LIVE rows.
 *
 * Rules in order: shape → unknown ids → duplicates → ABSENCE REFUSAL →
 * allocations reject; then strategy forcing, leverage narrowing and clamping,
 * hedge forcing, and the snapshot + economics embedding. Refusals come before
 * corrections because a market that cannot be built is not a lane to correct.
 *
 * IT IS ALSO WHERE THE CARD IS PRICED (2026-08-24). This is the one place the
 * live row is in hand, so it is where a blueprint's economics are computed,
 * through `laneEconomicsFor`, at the dials the replay will seat. Before that
 * the card fetched the compile route for a number, which answered for two
 * Morpho venues and returned a null blend and an unread violation for
 * everything else.
 */
export function validateProposal(
  input: RawProposalInput,
  liveRows: Map<string, LiveRow>,
): ProposalValidation {
  const notes: string[] = [];

  // 1. Shape
  const loops = Array.isArray(input.loops) ? (input.loops as RawProposalLoop[]) : null;
  if (!loops || loops.length < 1 || loops.length > 4) {
    return { ok: false, reason: "malformed proposal", unknownIds: [] };
  }
  for (const l of loops) {
    if (!l || typeof l !== "object" || typeof l.candidateId !== "string") {
      return { ok: false, reason: "malformed proposal", unknownIds: [] };
    }
  }
  const rawAlloc = input.allocationsBps;
  if (rawAlloc !== null && rawAlloc !== undefined) {
    if (!Array.isArray(rawAlloc) || rawAlloc.some((x) => typeof x !== "number" || !Number.isFinite(x) || !Number.isInteger(x) || x < 0)) {
      return { ok: false, reason: "malformed proposal", unknownIds: [] };
    }
  }

  // 2. candidateIds must exist in the live opportunities set
  const unknownIds = loops
    .map((l) => String(l.candidateId))
    .filter((id) => !liveRows.has(id));
  if (unknownIds.length > 0) {
    return { ok: false, reason: "unknown market id(s); the scan may have moved", unknownIds };
  }

  // 3. No duplicates
  const ids = loops.map((l) => String(l.candidateId));
  if (new Set(ids).size !== ids.length) {
    return { ok: false, reason: "two lanes on the same market", unknownIds: [] };
  }

  /* 3b. THE ABSENCE REFUSAL (2026-08-24).
     ------------------------------------------------------------------
     A market missing a MEASUREMENT cannot be pinned by hand, so it cannot be
     proposed either, and the refusal states the measured reason rather than a
     generic one. This is what stops a blueprint on a funding book with no spot
     leg: twenty of the twenty-four books on the committed document have none,
     and seven of them print the IDENTICAL 6.876404% headline, which is not a
     market at all — it is `f_b · (0.1095 − 0.0075)`, the administered ceiling,
     seven times. A proposal there would be a vault on nothing.

     ⚠ THIS IS NOT THE LAUNCH-RAIL QUESTION. A fully measured market on a
     rail-less venue PINS, composes, reaches review and publishes as a modeled
     design wearing its verdict. Only a missing measurement refuses. */
  for (const l of loops) {
    const row = liveRows.get(String(l.candidateId))!;
    const reason = laneEconomicsFor(row, defaultSelFor(row)).absenceReason;
    if (reason !== null) {
      return { ok: false, reason: `${row.pair}: ${reason}`, unknownIds: [] };
    }
  }

  // 4. Allocations
  let allocationsBps: number[];
  if (loops.length === 1) {
    // null required; coerce [10000] → null-equivalent
    if (rawAlloc !== null && rawAlloc !== undefined) {
      const arr = rawAlloc as number[];
      if (!(arr.length === 1 && arr[0] === 10000)) {
        return { ok: false, reason: "allocations must sum to 10000 bps", unknownIds: [] };
      }
    }
    allocationsBps = [10000];
  } else {
    if (!Array.isArray(rawAlloc) || rawAlloc.length !== loops.length) {
      return { ok: false, reason: "allocations must sum to 10000 bps", unknownIds: [] };
    }
    const arr = rawAlloc as number[];
    const sum = arr.reduce((s, x) => s + x, 0);
    if (sum === 10000) {
      allocationsBps = arr;
    } else if (sum >= 9990 && sum <= 10010) {
      allocationsBps = repairAllocations(arr);
      notes.push("allocations repaired to sum 10000 bps");
    } else {
      return { ok: false, reason: "allocations must sum to 10000 bps", unknownIds: [] };
    }
  }

  // 5–7. Coercions + snapshot embedding
  const outLoops = loops.map((l) => {
    const row = liveRows.get(String(l.candidateId))!;
    /* The leverage is CLAMPED, never coerced to a named position. The old
       branch silently replaced anything it did not recognise with the middle
       adjective; a number out of range is repaired to the market's own bound
       and the repair is stated in the notes the card renders verbatim. */
    let leverage: number | null = null;
    /* THE MODULE RULING REACHES THE COPILOT (P0-D, 2026-08-22).
       ------------------------------------------------------------------
       L3: a default is a control the product already pressed, and the
       copilot is one of the four paths that press it. Where the market's
       leverage slope is not positive the optimum is `L = 1` on all three of
       the module's declared axes at once, so every setting above it is one
       the rack itself would not offer, and a blueprint proposing one would be
       the product recommending what the product refuses.

       It is written EXPLICITLY rather than left null. `apply.ts` resolves a
       null through `landingLeverage`, which returns `floorToGrid(0.8 · max)`
       — a fraction of a ceiling, and on these markets a dominated one. Null
       here would seat a levered lane the rack would not build, which is the
       disagreement this item exists to close, and it would do it silently.

       Note only when the MODEL named something else: resolving a null is the
       product choosing, not a correction to the model, and the reclaim
       readout is where a product choice states its objective and runner-up. */
    /* STRATEGY FORCING (2026-08-24). A market carries exactly ONE strategy and
       the row is what says which. The model may name it — naming it is how the
       user's own word reaches the card — but it may not choose it, so a
       mismatch is corrected and the correction is stated. */
    const strategy = strategyForRow(row);
    if (typeof l.strategy === "string" && l.strategy !== strategy) {
      notes.push(
        `${row.pair}: built as a ${STRATEGY_LABEL[strategy]} lane, which is the strategy this market carries`,
      );
    }
    /* LEVERAGE NARROWING. Only the loop strategy has a dial at all: a funding
       carry, a delta-neutral LP, a treasury collar and a treasury floor borrow
       nothing, and `repriceAtLeverage` refuses to move a row whose L is 1
       anyway. No note — a strategy with no dial is not a correction to
       anything. The predicate is `strategy !== "loop"`, so the fifth strategy
       needed no new branch here and gained the narrowing for free. */
    const leverageModuleAbsent = !leverageModuleInstalls(row) || strategy !== "loop";
    if (strategy !== "loop") {
      leverage = PRODUCT_MIN_LEVERAGE;
    } else if (leverageModuleAbsent) {
      leverage = PRODUCT_MIN_LEVERAGE;
      if (typeof l.leverage === "number" && Number.isFinite(l.leverage) && l.leverage > PRODUCT_MIN_LEVERAGE + 1e-6) {
        notes.push(
          /* Same formatter as the seat note below, for the same reason: two
             notes on one card may not print one quantity two ways. Guarded
             identically, since `l.leverage` is the model's number. */
          `${row.pair}: leverage ${l.leverage > 0 ? lev(l.leverage) : String(l.leverage)} set to ${lev(PRODUCT_MIN_LEVERAGE)}, borrowing costs more at the margin than the collateral earns`,
        );
      }
    } else if (typeof l.leverage === "number" && Number.isFinite(l.leverage)) {
      /* THE CLAMP IS THE DIAL'S OWN CEILING (B2, 2026-08-24).
         ----------------------------------------------------------------
         This read `deriveLeverageBounds(lt, "standard", L0).max` directly,
         which is ONE of the two derivations a leverage bound has in this
         product — `descriptorsFor("safety-buffer", ctx)` is the other, and it
         is the one `PlateControls` actually renders the slider from. Two
         owners of one ceiling is how a blueprint comes to seat a leverage the
         plate beside it will not offer, and how the copilot came to call a
         landing a ceiling in the first place. `seatBoundsFor` reads the
         descriptor, so the blueprint and the dial admit the same range by
         construction. The old call survives only as the fallback for a row
         the descriptor cannot narrow. */
      const lt = typeof row.lt === "number" && row.lt > 0 ? row.lt : null;
      const raw = snapToLeverageGrid(l.leverage);
      const bounds = seatBoundsFor(row);
      const ceiling =
        bounds?.max ??
        (lt === null
          ? null
          : deriveLeverageBounds(lt, "standard", row.economics?.loopLeverage ?? null).max);
      const capped = ceiling === null ? raw : Math.min(raw, ceiling);
      leverage = Math.max(PRODUCT_MIN_LEVERAGE, capped);
      if (Math.abs(leverage - l.leverage) > 1e-6) {
        /* THE CORRECTION NOTE THE CARD PRINTS VERBATIM. It never fired in the
           2026-08-24 walk because the model never asked for anything the
           server refused; `copilot-clamp-note.test.ts` forces the refusal so
           the note is a tested behaviour rather than an unexercised branch. */
        /* THE CORRECTION IS PRODUCT COPY NOW, SO IT PRINTS LIKE PRODUCT COPY
           (gate, 2026-08-24). D2's whole point is that this note stops being an
           unexercised branch and starts reaching users, and the string it was
           about to reach them with printed `3.5` where every leverage on the
           same card prints `3.50x`, beside the machine verb `clamped`. Two
           renderings of one quantity inside one card is the D5 defect with a
           server owner, so both numbers go through `lev`, the product's own
           formatter, and the verb is the one the card already uses.

           ⚠ `lev` returns an em dash on a non-positive input and an em dash in
           a user-visible string is a house-rule break, so the REQUEST — the one
           number here the model chose and the server did not — falls back to
           its own digits. The seat cannot take that branch: it is
           `Math.max(PRODUCT_MIN_LEVERAGE, ...)` two lines up. */
        const asked = l.leverage > 0 ? lev(l.leverage) : String(l.leverage);
        notes.push(`${row.pair}: leverage ${asked} seated at ${lev(leverage)}`);
      }
    } else {
      /* THE LANDING IS WRITTEN, NOT LEFT NULL (2026-08-24).
         ----------------------------------------------------------------
         A null used to travel to `apply.ts`, which resolves it through
         `landingLeverage(lt, preset, L0)` — the THREE-argument call, with no
         breakeven ceiling. `seatedLeverage` is the rack's own landing and it
         carries `breakevenStopFor` as a fourth argument, so on a market whose
         carry crosses zero inside the dial's range the two answered different
         leverages: the card priced the row at the seated one and APPLY seated
         the unclamped one. Measured on the fixture catalog as a 4bp gap on
         `aave-v3-base weETH/WETH`, which is small and is a number the product
         quotes and then does not deliver.

         The number is decided HERE because this is the one place the live row
         is in hand, and `seatedLeverage` needs the row to find the ceiling.
         No note: choosing the market's own landing is the product choosing,
         not a correction to the model. */
      leverage = seatedLeverage(row);
    }
    /* HEDGE FORCING, WIDENED BY THE STRATEGY (2026-08-24).
       A funding carry and a delta-neutral LP ARE their hedge: the short is the
       leg that makes them delta-neutral, and the hand-authored LP figure is
       priced with it. A treasury collar's protection is its option pair, and a
       perp leg on it is refused by the graph validator. The loop keeps the
       class rule, which is the market's own fact about whether a perp exists.

       A TREASURY FLOOR REFUSES THE HEDGE FOR THE SAME REASON THE COLLAR DOES,
       and it is refused HERE rather than left to the `cls` branch below. The
       hand-authored treasury rows carry `cls: "N1"`, so the class rule would
       reach the same boolean today — but by an accident of the row rather than
       a fact about the lane, and it would print `hedge removed to match its
       class` on a lane whose chain has no hedge slot to remove it from. The
       chain is `{liquidity-source, redemption-route}`; `seatedModulesFor` will
       never seat a hedge on it, so a `true` here is a composition the replay
       cannot build and `composedHere` would then refuse to price. */
    let hedge = l.hedge === true;
    if (strategy === "funding" || strategy === "dnlp") {
      if (!hedge) {
        notes.push(`${row.pair}: hedge enabled to match a ${STRATEGY_LABEL[strategy]} lane`);
      }
      hedge = true;
    } else if (strategy === "collar" || strategy === "treasury") {
      if (hedge) {
        notes.push(`${row.pair}: hedge removed to match a ${STRATEGY_LABEL[strategy]} lane`);
      }
      hedge = false;
    } else {
      if (row.cls === "A" && !hedge) {
        hedge = true;
        notes.push(`${row.pair}: hedge enabled to match its class`);
      }
      if (row.cls === "N1" && hedge) {
        hedge = false;
        notes.push(`${row.pair}: hedge removed to match its class`);
      }
    }
    const compound = l.compound === true;
    return {
      candidateId: row.id,
      strategy,
      leverage,
      /* THE MODULE RULING, on the wire. The same predicate that forced the
         leverage above: where the slope is not positive the module is absent,
         and `apply.ts` seats nothing rather than a plate at 1.0. */
      leverageModule: !leverageModuleAbsent,
      hedge,
      compound,
      snapshot: snapshotOf(row),
      /* THE CARD'S NUMBERS, computed HERE because this is the one place the
         live row is in hand, at the dials the replay will actually seat
         (`proposalLoopComposition` is the single owner of those dials, and
         `compileBodyFromProposal` reads the same one). */
      lane: laneEconomicsFor(
        row,
        { leverage, leverageModule: !leverageModuleAbsent, hedge, compound },
        seatedComposition({ hedge, compound }),
      ),
    };
  });

  return {
    ok: true,
    payload: {
      proposalId: newProposalId(),
      title: typeof input.title === "string" ? input.title.slice(0, 60) : "Portfolio blueprint",
      rationale: typeof input.rationale === "string" ? input.rationale : "",
      loops: outLoops,
      allocationsBps,
      notes,
    },
  };
}

export type ExplainValidation =
  | { ok: true; payload: ExplainPayload }
  | { ok: false; reason: string; unknownIds: string[] };

export function validateExplain(
  input: { candidateId?: unknown },
  liveRows: Map<string, LiveRow>,
): ExplainValidation {
  const id = typeof input.candidateId === "string" ? input.candidateId : "";
  const row = liveRows.get(id);
  if (!row) return { ok: false, reason: "unknown market id", unknownIds: id ? [id] : [] };
  return { ok: true, payload: { row: explainRowOf(row) } };
}

export type CompareValidation =
  | { ok: true; payload: ComparePayload }
  | { ok: false; reason: string; unknownIds: string[] };

export function validateCompare(
  input: { candidateIds?: unknown },
  liveRows: Map<string, LiveRow>,
): CompareValidation {
  const raw = Array.isArray(input.candidateIds)
    ? input.candidateIds.filter((x): x is string => typeof x === "string")
    : [];
  const ids = [...new Set(raw)];
  const unknownIds = ids.filter((id) => !liveRows.has(id));
  if (unknownIds.length > 0) return { ok: false, reason: "unknown market id", unknownIds };
  if (ids.length < 2 || ids.length > 4) {
    return { ok: false, reason: "compare takes two to four markets", unknownIds: [] };
  }
  return { ok: true, payload: { rows: ids.map((id) => explainRowOf(liveRows.get(id)!)) } };
}
