/**
 * Unified cross-venue discovery list (UX_ITERATION_3 §1; ranking reworked
 * per recette P1-8; catalog projection reworked per recette build item 6).
 *
 * Pure projection from the /api/canvas/opportunities payload to ONE ranked
 * list across all connected venues. Venue is a CHIP on each row, never a
 * gate before the list. ECON-M holds verbatim: hedged (A) and unhedged (N1)
 * stay separate sections, never interleaved — the two arrays never mix.
 *
 * Ranking is by ACTIONABILITY first (P1-8): rows on launchable venues rank
 * above venue-blocked rows unconditionally — a dead card must never sit
 * above the only market that can actually launch. Within each actionability
 * group: headline APY desc, nulls last. Per-venue honesty (stale, snapshot
 * provenance) rides on every row.
 *
 * ── The catalog has to be SHOPPABLE (build item 6, fixes B2/B3/B4/B7/B8) ──
 *
 * Everything below this line exists because the list could be read but not
 * shopped. Four things were missing and each one is derived here, once, at
 * projection time, so no surface can derive a fifth version of it:
 *
 *  B2/B3 — `bestApy` / `bestL`. The scan quotes ONE leverage: its own L0,
 *      which is the old house ceiling. The lane never builds there (the
 *      dial's default is 0.8 × a house cap that is now trim-bound), and on
 *      the rows where the marginal spread `s = cy − bo` is negative the
 *      model is monotone DECREASING in leverage, so the quoted number is the
 *      value at the WORST reachable setting. Repricing is AFFINE in L, so
 *      the optimum is always a corner: TWO evaluations, never a search.
 *
 *  B4  — shared resources. The Aave scan and the Morpho scan quote the same
 *      HL perp book seconds apart and disagree; on the fixture two Morpho
 *      Blue rows quote the same `venue:borrow:WETH` key 2.56x apart. Rows
 *      that draw on ONE resource now print ONE number, the group MIN, which
 *      is the fail-safe `vaultCapacity` already applies to lanes.
 *
 *  B7  — `dominatedBy`. Same pair, two venues, one strictly worse on both
 *      APY and capacity. Venue sections meant the two cards were never
 *      adjacent, so the loser looked like a choice.
 *
 *  B8  — `ltDiscriminator`. E-mode duplicates render pixel-identical: same
 *      pair, same venue chip, same class chip. On a negative-spread row the
 *      LOWER-lt row is the better one, so "they look the same" is not a
 *      cosmetic complaint.
 *
 * WHAT THIS FILE DOES NOT DO: it does not re-derive economics. `bestApy` is
 * `composedNetApy(repriceAtLeverage(row, L))` — the same two functions the
 * lane header calls — and the reachable leverage range comes from
 * `deriveLeverageBounds`, the same descriptor the risk dial writes through.
 * If those move, this moves with them.
 */

/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion, @typescript-eslint/non-nullable-type-assertion-style --
 * Kit-verbatim file, ported from build.priime.finance eb6d33a. The findings
 * are the typed presets reading kit idioms; not rewriting kit logic to satisfy
 * lint, per the integration's own directive (the RackCanvas.tsx precedent). */

import { acceptsDeposits, capacityResourceKey } from "./capacity";
import { depositRoomUsd, perpBookIndex, reconcileHedgeFunding } from "./perp-books";
import { F_B } from "@/lib/model-constants";
import { composedNetApy, mockQuote, repriceAtLeverage } from "./mock-quote";
import { lev, pct } from "./format";
import { breakevenStopFor, landingLeverage } from "./leverage-stops";
import { leverageModuleInstalls } from "./leverage-module";
import { descriptorFor } from "./modules";
import { deriveLeverageBounds, PRODUCT_MIN_LEVERAGE, type RiskPreset } from "./param-schema";
import {
  screeningApr,
  VENUE_LABELS,
  type CanvasVenueId,
  type ProjectedCandidate,
  type ProjectedVenue,
} from "./opportunities";
/* templates.ts imports `buildUnifiedList` back (the catalog-pick seed). The
   cycle is inert by construction, by the same argument graph-ops already
   carries for the same pair of files: neither module calls the other at
   EVALUATION time — templates' top level is family models and object
   literals, this file's is constants and function declarations — so
   `TEMPLATE_CANDIDATES` is only ever read from inside `modeledRows`. The rows
   and the family fact are imported rather than re-spelled here: re-deriving a
   row's family from its venue name is the E1 anti-pattern that
   `familiesForCandidate` exists to delete. */
import { familiesForCandidate, TEMPLATE_CANDIDATES } from "./templates";
import { FAMILY_REQUIRED_GROUPS, type LaneFamily } from "./graph-ops";
import type { ModuleKey } from "./types";

/** The winner a dominated row points at. Carries what the card needs to say
 *  so the surface never has to re-look-up the winner and re-derive its APY. */
export interface DominanceRef {
  id: string;
  pair: string;
  venue: CanvasVenueId;
  venueLabel: string;
  bestApy: number;
  capacityUsd: number;
}

export interface UnifiedRow extends ProjectedCandidate {
  /** Chip text for the row (VENUE_LABELS of the row's venue). */
  venueLabel: string;
  /** The owning doc's pin — a pick stores THIS venue's contentHash. */
  contentHash: string;
  /** Owning doc older than 24h: row renders the stale register. */
  stale: boolean;
  /** Owning doc served from snapshot: re-verifies before launch. */
  snapshot: boolean;

  // ── Catalog projection (build item 6) ──────────────────────────────────
  //
  // Optional ONLY because `UnifiedRow` is constructed by hand in fixtures
  // owned by other files. `buildUnifiedList` populates every one of them on
  // every row it emits; a surface reading them off a row that came out of
  // this file may treat them as present.

  /** The best APY reachable on this row at any leverage the dial can land
   *  on, at the default composition. Null only when the row is unpriced. */
  bestApy?: number | null;
  /** The leverage `bestApy` is quoted at, already on the 0.25 dial grid and
   *  never above the scan's own L0. */
  bestL?: number | null;
  /** true when the optimum sits at the BOTTOM of the reachable range, i.e.
   *  the marginal spread is negative and leverage costs this market money. */
  bestAtFloor?: boolean;
  /** `bestApy < 0`: negative at EVERY reachable setting. Nothing to build. */
  neverPositive?: boolean;

  /** The resource this row's capacity is drawn from (`capacityResourceKey`). */
  capacityKey?: string;
  /** How many catalog rows draw on that one resource. */
  capacitySharedCount?: number;
  /** What THIS row's own scan quoted, before the group min was applied. Equal
   *  to the displayed capacity unless `capacityReconciled` is true. */
  capacityScanUsd?: number | null;
  /** true when a co-tenant of the same resource quoted it lower and this
   *  row's displayed capacity was rewritten down to that quote. */
  capacityReconciled?: boolean;

  /** Set when another row shares this row's pair AND venue: the one thing
   *  that tells the two cards apart. Null when the row is unambiguous. */
  ltDiscriminator?: string | null;
  /** A row on the same pair that is strictly better on BOTH APY and
   *  capacity, and no less actionable. Null when this row is not dominated. */
  dominatedBy?: DominanceRef | null;
}

export interface UnifiedList {
  hedged: UnifiedRow[];
  unhedged: UnifiedRow[];
}

export type VenueFilter = "all" | ReadonlySet<CanvasVenueId>;
export type ClassFilter = "both" | "hedged" | "unhedged";

type SourcedVenue = ProjectedVenue & { source?: string };

/**
 * The preset the catalog derives the reachable ceiling at.
 *
 * A lane's stops no longer write the preset at all (2026-08-22): the preset is
 * the user's own Advanced control and the leverage stops read whatever it
 * holds. `standard` is the descriptor default, so it is the ceiling every
 * untouched lane reaches. A hand-tuned `aggressive` preset reaches slightly
 * higher, which can only make `bestApy` an understatement on a positive-spread
 * row, and understating is the correct direction for a shopping number.
 */
export const CATALOG_PRESET: RiskPreset = "standard";

/** Below this an APY difference is float noise, not a preference. */
const APY_EPS = 1e-9;

/** `capacityResourceKey`'s prefix for a Hyperliquid perp book (`hl:ETH`). One
 *  spelling, beside the one place that has to take a key apart again. */
const PERP_BOOK_KEY_PREFIX = "hl:";

/** The f_b every stored HL bound is denominated in — the scan's own constant,
 *  the same one `capacity.ts` reads and `perp-books.ts` multiplies back out.
 *  Converting the book's NOTIONAL back to deposit dollars at this constant is
 *  the exact inverse of the division the scanners performed. */
const SCAN_FB = F_B;

/**
 * The APY margin that makes one row genuinely better than another: one basis
 * point. Two E-mode duplicates of the same pair price within 1e-6 of each
 * other at the same reachable leverage; calling the second one "dominated"
 * over that is a claim the model cannot support. The `lt` chip tells those
 * two apart; dominance is reserved for a gap a user would act on.
 */
const DOMINANCE_APY_MARGIN = 1e-4;

// ── Shared-resource reconciliation (B4) ───────────────────────────────────

/**
 * THE GROUPING KEY THE CARDS SHARE A NUMBER UNDER (recette F7, quant W2-01).
 *
 * `capacityResourceKey` keys borrow liquidity by venue + debt symbol, which is
 * right on a POOLED venue (every Aave borrower of WETH draws on one pool) and
 * wrong on an ISOLATED one: Morpho Blue markets each carry their own lender
 * book, so two markets borrowing WETH share nothing, and pooling them floored
 * the launchable cbETH card's own $518,528 to wstETH's $427,020 — "shared by
 * 2" over a lender they do not share. The payload states the isolation: every
 * Morpho Blue candidate id ends in the MARKET's own key, and two rows share a
 * lender book only when that key is the same.
 *
 * So on an isolated venue, every venue-local group (borrow or collateral) is
 * refined BY MARKET. The `hl:` book keys are untouched — the perp book really
 * is one book however many markets short it.
 *
 * FOLDED (C-H4, 2026-08-23): the refinement now lives in capacity.ts
 * `venueLocalKey`, the one owner of the keying rules, so the lane side
 * (`laneResources` / `vaultCapacity`) un-pools isolated markets by the same
 * derivation. This export survives as the card-side alias of that owner.
 */
export function cardResourceKey(c: ProjectedCandidate): string {
  return capacityResourceKey(c);
}

export interface ResourceGroup {
  /** The lowest capacity any row quoted for this resource. */
  minUsd: number;
  /** The highest — kept so a surface can say how far the scans disagreed. */
  maxUsd: number;
  /** How many catalog rows draw on it. */
  count: number;
}

/**
 * Every capacity quote in the payload, grouped by the resource it is drawn
 * from. Built over ALL venues before any filter runs: what a perp book can
 * absorb is a fact about the book, not about which venue chips are lit, so a
 * filter must never move a printed capacity.
 */
export function capacityLedger(venues: readonly ProjectedVenue[]): Map<string, ResourceGroup> {
  const ledger = new Map<string, ResourceGroup>();
  for (const v of venues) {
    for (const c of [...v.hedged, ...v.unhedged]) {
      const usd = c.economics?.capacityUsd;
      if (typeof usd !== "number" || !Number.isFinite(usd)) continue;
      const key = cardResourceKey(c);
      const g = ledger.get(key);
      if (g) {
        g.minUsd = Math.min(g.minUsd, usd);
        g.maxUsd = Math.max(g.maxUsd, usd);
        g.count += 1;
      } else {
        ledger.set(key, { minUsd: usd, maxUsd: usd, count: 1 });
      }
    }
  }
  /* ══ THE PERP BOOK'S BOUND COMES FROM THE FILE THAT OWNS IT ══════════════
     (2026-08-23, the sixth venue.)

     A perp book is measured by every scan that shorts it, and there are now
     SIX of them. Before this line the catalog took its own minimum over the
     rows keyed to a book while `perp-books.ts` — whose docblock says outright
     that the book's short-notional bound is "THE ONE FACT THIS FILE OWNS" —
     took the tightest over every row that measured one, and the funding canvas
     read that. Two owners of one quantity, agreeing today by construction and
     free to part tomorrow. This makes it ONE read.

     WHAT IT DOES TO THE SHIPPED CATALOG, stated rather than discovered: adding
     the funding document moves twelve of the thirty-four existing rows, and
     one of them is launchable. `morpho-blue-hyperevm:kHYPE/WHYPE` prints
     $10,514 of deposit room where it printed $19,391 — a 46% fall — because
     the funding scan measured the same HYPE book at $31,542 top-of-book on the
     thin side where the lending scan read $58,173. Eleven more ETH-book rows
     move `shared by 11` to `shared by 12`.

     THE DIRECTION IS THE ARGUMENT. Both reads are real reads of one thin book
     minutes apart, and the tighter one is the one already in the payload. A
     catalog that knows a tighter measurement and prints the looser one is
     advertising room it has been told does not exist, which is strictly worse
     for a depositor than a conservative number on a market that can be built.
     `capacity.ts` ratified exactly this tie-break for exactly this reason
     ("the fail-safe read is the minimum"); the funding scan did not introduce
     the rule, it made a second reading of six books exist for the first time.

     `Math.min` rather than an assignment: the book index is a strict superset
     of the readers this loop saw, so it can only be equal or tighter, and the
     `min` is provably inert on the committed catalog
     (`capacity-reconciliation.test.ts`). Keeping it means a future divergence
     can only ever tighten a printed capacity, never loosen one. */
  const books = perpBookIndex(venues);
  for (const [key, g] of ledger) {
    if (!key.startsWith(PERP_BOOK_KEY_PREFIX)) continue;
    const reading = books.get(key.slice(PERP_BOOK_KEY_PREFIX.length));
    const room = reading ? depositRoomUsd(reading, SCAN_FB) : null;
    if (room !== null) g.minUsd = Math.min(g.minUsd, room);
  }
  return ledger;
}

/**
 * THE SUPPLY LADDER (shadow-price A4): how many dollars this catalog can
 * absorb, at what rate, for the marginal dollar.
 *
 * Weights add across lanes but ROOM DOES NOT: two lanes shorting the same
 * perp are one book. So the useful question is not "what does the best market
 * pay" but "how much money can be placed above a given rate", and that is a
 * property of the RESOURCE GROUPS rather than of the row list.
 *
 * This is a permanently-true catalog fact stated ONCE IN CHROME, which is
 * where the ratified staleness ruling puts facts of that shape. It is
 * deliberately NOT the per-lane sub-floor notification that was rejected: a
 * notification about something the user cannot act on is noise, while the
 * same fact in chrome is orientation, and it changes the largest decision
 * they make, which is whether to build here at all and how big to plan for.
 */
export interface LadderRung {
  /** Dollars this resource group can absorb (its binding capacity). */
  usd: number;
  /** The best composed net APY any member of the group reaches. */
  apy: number;
  /** How many catalog rows draw on this one resource. */
  count: number;
}

export function supplyLadder(rawVenues: readonly ProjectedVenue[]): LadderRung[] {
  // One p25 register per book (F3): the ladder's rates come off the same
  // reconciled rows the cards print.
  const venues = reconcileHedgeFunding(rawVenues);
  const ledger = capacityLedger(venues);
  const best = new Map<string, number>();
  for (const v of venues) {
    for (const c of [...v.hedged, ...v.unhedged]) {
      const usd = c.economics?.capacityUsd;
      if (typeof usd !== "number" || !Number.isFinite(usd)) continue;
      const b = deriveBest(c as UnifiedRow, CATALOG_PRESET);
      const apy = b?.apy;
      if (typeof apy !== "number" || !Number.isFinite(apy)) continue;
      const key = cardResourceKey(c);
      const prev = best.get(key);
      if (prev === undefined || apy > prev) best.set(key, apy);
    }
  }
  const rungs: LadderRung[] = [];
  for (const [key, g] of ledger) {
    const apy = best.get(key);
    if (apy === undefined) continue;
    rungs.push({ usd: g.minUsd, apy, count: g.count });
  }
  // Richest rate first: a builder reads down until the room runs out.
  return rungs.sort((a, b) => b.apy - a.apy);
}

/** Total room at or above a rate. The cumulative read the chrome line uses. */
export function roomAbove(rungs: readonly LadderRung[], apy: number): number {
  return rungs.reduce((sum, r) => (r.apy >= apy ? sum + r.usd : sum), 0);
}

/**
 * Rewrite every candidate's capacity to the minimum its resource group was
 * quoted at.
 *
 * WHY MIN: `vaultCapacity` already takes the min within a resource group for
 * exactly this reason — book depth does not move 2.66x in six seconds, so one
 * of the two scans is wrong and we cannot tell which. The catalog was the only
 * surface that had not been told. Taking the min can only understate.
 *
 * Exported so the LANE side can be reconciled at lift time from the same
 * function (see the handoff note at the bottom of this file): a lane reprices
 * from the raw payload via `catalogRow`, so until the lift applies this, the
 * card and the lane can still print two capacities for one book.
 */
export function reconcileSharedCapacity<T extends ProjectedVenue>(venues: T[]): T[] {
  const ledger = capacityLedger(venues);
  const fix = (c: ProjectedCandidate): ProjectedCandidate => {
    const e = c.economics;
    if (!e || !Number.isFinite(e.capacityUsd)) return c;
    const g = ledger.get(cardResourceKey(c));
    if (!g || g.minUsd >= e.capacityUsd) return c;
    return { ...c, economics: { ...e, capacityUsd: g.minUsd } };
  };
  return venues.map((v) => ({ ...v, hedged: v.hedged.map(fix), unhedged: v.unhedged.map(fix) }));
}

// ── Best reachable APY (B2, B3) ───────────────────────────────────────────

export interface BestPoint {
  apy: number;
  leverage: number;
  /** The optimum is the bottom of the range: leverage is yield-NEGATIVE here. */
  atFloor: boolean;
}

/**
 * The leverage range a user can actually land this row on.
 *
 * `deriveLeverageBounds` is the descriptor the dial writes through, so its
 * `max` is already `min(houseMax(lt, preset), scanL)` floored to the 0.25
 * grid. Two extra clamps on top:
 *
 *  • Both ends are re-capped at the scan's own L0. `deriveLeverageBounds`
 *    floors its max UP to the 1.5 product floor when a market's ceiling is
 *    below it, which is right for the dial (that market is not loopable and
 *    the validator says so) and wrong here: repricing a row whose scan L is
 *    1.05 at 1.5 asks the affine model to extrapolate past the basis-sizing
 *    cap the N1 path applied, and that cap is not projected. The recette
 *    caught it printing −4.13% for a syrupUSDC row that prices at +2.90%.
 *
 *  • A row with no `lt` gets no house-cap derivation at all. The only
 *    leverage we can prove is safe on it is the one the scan already priced.
 */
export function reachableLeverage(
  row: ProjectedCandidate,
  preset: RiskPreset = CATALOG_PRESET,
): { lo: number; hi: number } | null {
  const scanL = row.economics?.loopLeverage;
  if (typeof scanL !== "number" || !Number.isFinite(scanL) || scanL <= 0) return null;
  const lt = typeof row.lt === "number" && row.lt > 0 ? row.lt : null;
  const b = lt === null ? null : deriveLeverageBounds(lt, preset, scanL);
  const lo = Math.min(b ? b.min : scanL, scanL);
  const hi = Math.min(b ? b.max : scanL, scanL);
  return { lo, hi: Math.max(lo, hi) };
}

/**
 * The best APY this row reaches, and where.
 *
 * `composedNetApy(repriceAtLeverage(row, L), cls === "A")` is affine in L —
 * the slope is `f_b·(cy − bo)`, constant in L — so the maximum over a closed
 * interval is at one of its two ends. Two evaluations, no search, no
 * sampling. Ties go to the LOWER leverage: same money, less liquidation risk.
 *
 * The composition is the default one (hedge installed on a class-A row,
 * nothing else), which is what the card advertises and what `installDefaults`
 * puts on the lane. A lane that then adds or ejects a module reprices itself
 * through the same two functions.
 */
export function deriveBest(
  row: ProjectedCandidate,
  preset: RiskPreset = CATALOG_PRESET,
): BestPoint | null {
  const range = reachableLeverage(row, preset);
  if (!range) return null;
  const hasHedge = row.cls === "A";
  const evalAt = (L: number): { apy: number; leverage: number } | null => {
    const priced = repriceAtLeverage(row, L);
    const apy = composedNetApy(priced, hasHedge);
    if (apy === null || !Number.isFinite(apy)) return null;
    const eff = priced.economics?.loopLeverage;
    return { apy, leverage: typeof eff === "number" && Number.isFinite(eff) ? eff : L };
  };
  const low = evalAt(range.lo);
  const high = range.hi > range.lo + 1e-9 ? evalAt(range.hi) : null;
  if (!low && !high) return null;
  if (!high) return { apy: low!.apy, leverage: low!.leverage, atFloor: false };
  if (!low) return { apy: high.apy, leverage: high.leverage, atFloor: false };
  const takeHigh = high.apy > low.apy + APY_EPS;
  const pick = takeHigh ? high : low;
  return { apy: pick.apy, leverage: pick.leverage, atFloor: !takeHigh };
}

// ── Row construction ──────────────────────────────────────────────────────

function toRows(
  cs: ProjectedCandidate[],
  v: SourcedVenue,
  ledger: Map<string, ResourceGroup>,
  preset: RiskPreset,
): UnifiedRow[] {
  return cs.map((c) => {
    const key = cardResourceKey(c);
    const group = ledger.get(key);
    const scanUsd = c.economics?.capacityUsd ?? null;
    const reconciled =
      c.economics && group && typeof scanUsd === "number" && group.minUsd < scanUsd
        ? { ...c, economics: { ...c.economics, capacityUsd: group.minUsd } }
        : c;
    const best = deriveBest(reconciled, preset);
    return {
      ...reconciled,
      // B3: a null `apyRiskAdj` is not an absent rate. See `screeningApr`.
      headlineApr: screeningApr(reconciled),
      venueLabel: VENUE_LABELS[c.venue] ?? c.venue,
      contentHash: v.contentHash,
      stale: v.stale,
      snapshot: v.source === "snapshot",
      bestApy: best ? best.apy : null,
      bestL: best ? best.leverage : null,
      bestAtFloor: best ? best.atFloor : false,
      neverPositive: best ? best.apy < 0 : false,
      capacityKey: key,
      // An unpriced row quotes no capacity, so it is not a tenant of the
      // resource and must not inflate the co-tenant count of rows that are.
      capacitySharedCount: c.economics ? (group?.count ?? 1) : 0,
      capacityScanUsd: scanUsd,
      capacityReconciled: reconciled !== c,
      ltDiscriminator: null,
      dominatedBy: null,
    };
  });
}

/** `lt` as a chip, trailing zeros stripped: 0.93 → "LT 93%", 0.945 → "LT 94.5%". */
export function ltChip(lt: number | null | undefined): string | null {
  if (typeof lt !== "number" || !Number.isFinite(lt) || lt <= 0) return null;
  const pct = lt * 100;
  const s = pct.toFixed(2).replace(/\.?0+$/, "");
  return `LT ${s}%`;
}

/**
 * B8: two rows on the same pair AND the same venue render pixel-identical —
 * same pair, same venue chip, same class chip, and after reconciliation often
 * the same capacity. The E-mode `lt` is the only thing that differs, and on a
 * negative-spread row the lower-lt row is the BETTER one, so the discriminator
 * has to be on the card, not in a hidden id suffix. Rows that are already
 * unambiguous get nothing: a chip on every row discriminates nothing.
 */
function markLtDiscriminator(rows: UnifiedRow[]): void {
  const seen = new Map<string, UnifiedRow[]>();
  for (const r of rows) {
    const k = `${r.venue}|${r.pair}`;
    const g = seen.get(k);
    if (g) g.push(r);
    else seen.set(k, [r]);
  }
  for (const g of seen.values()) {
    if (g.length < 2) continue;
    for (const r of g) r.ltDiscriminator = ltChip(r.lt);
  }
}

/**
 * B7: strict domination on the same pair.
 *
 * Pareto, on the two axes a user shops on: the winner is no worse on EITHER
 * APY or capacity and better on at least one. A row that trades APY away for
 * capacity is a real choice and is never marked — which is why the live
 * cbETH/WETH case only fires once the shared ETH book has been reconciled.
 * Before reconciliation the Aave row appeared to offer 4.9x the capacity of
 * the Morpho row; afterwards the two draw on one book at one size and the
 * 1.08pp APY gap is the only difference left, and it is a strict loss.
 *
 * Two guards on top:
 *
 *  • same class only. ECON-M keeps hedged and unhedged in separate sections;
 *    a cross-class comparison would be comparing two different machines.
 *
 *  • the winner may not be LESS actionable than the loser. Pointing a
 *    launchable row at a venue-blocked one advises a market the rail cannot
 *    build. (The reverse is allowed and is the live case: an Aave row
 *    dominated by the Morpho row that can actually launch.)
 *
 * When several rows dominate, the best-APY one wins, so the pointer is stable
 * under re-scan rather than depending on payload order.
 */
function markDominance(rows: UnifiedRow[]): void {
  const byPair = new Map<string, UnifiedRow[]>();
  for (const r of rows) {
    const k = `${r.cls}|${r.pair}`;
    const g = byPair.get(k);
    if (g) g.push(r);
    else byPair.set(k, [r]);
  }
  const capOf = (r: UnifiedRow) => r.economics?.capacityUsd ?? null;
  for (const g of byPair.values()) {
    if (g.length < 2) continue;
    for (const loser of g) {
      const lApy = loser.bestApy;
      const lCap = capOf(loser);
      if (typeof lApy !== "number" || typeof lCap !== "number") continue;
      let winner: UnifiedRow | null = null;
      for (const w of g) {
        if (w === loser) continue;
        const wApy = w.bestApy;
        const wCap = capOf(w);
        if (typeof wApy !== "number" || typeof wCap !== "number") continue;
        if (!w.launchable && loser.launchable) continue;
        // no worse on either axis…
        if (wApy < lApy - DOMINANCE_APY_MARGIN || wCap < lCap) continue;
        // …and meaningfully better on at least one
        if (!(wApy > lApy + DOMINANCE_APY_MARGIN || wCap > lCap)) continue;
        if (winner === null || wApy > (winner.bestApy as number)) winner = w;
      }
      loser.dominatedBy = winner
        ? {
            id: winner.id,
            pair: winner.pair,
            venue: winner.venue,
            venueLabel: winner.venueLabel,
            bestApy: winner.bestApy as number,
            capacityUsd: capOf(winner) as number,
          }
        : null;
    }
  }
}

/** Headline APY desc; rows without a headline sink to the bottom. */
function byHeadlineDesc(a: UnifiedRow, b: UnifiedRow): number {
  const ah = typeof a.headlineApr === "number" ? a.headlineApr : -Infinity;
  const bh = typeof b.headlineApr === "number" ? b.headlineApr : -Infinity;
  return bh - ah;
}

/**
 * BEST REACHABLE APY desc, headline breaking ties; unpriced rows sink (P-H4,
 * 2026-08-24 — the DiscoverPanel handoff, landed at the owner).
 *
 * The list used to rank by `headlineApr` — the market at ITS OWN maximum
 * leverage, a number the catalog card itself stopped printing under recette
 * item 7 — and the panel re-sorted by `bestApy` locally, so the LIST's order
 * (which the copilot context is built and cap-trimmed from) and the PANEL's
 * order were two rankings of one catalog: the copilot's top-20 screen was not
 * the top-20 the user was looking at. One comparator at the owner closes both:
 * the panel's local sort is deleted and the context inherits this order.
 *
 * EXPORTED for the panel's demoted groups, which sort by the same rule.
 */
export function byBestReachable(a: UnifiedRow, b: UnifiedRow): number {
  const av = typeof a.bestApy === "number" ? a.bestApy : -Infinity;
  const bv = typeof b.bestApy === "number" ? b.bestApy : -Infinity;
  if (bv !== av) return bv - av;
  return byHeadlineDesc(a, b);
}

/** Actionability first (P1-8): launchable rows always outrank venue-blocked
 *  rows; the best REACHABLE APY breaks ties within each group (P-H4). */
function byActionabilityThenHeadline(a: UnifiedRow, b: UnifiedRow): number {
  if (a.launchable !== b.launchable) return a.launchable ? -1 : 1;
  return byBestReachable(a, b);
}

/** Split a ranked section into the selectable rows and the venue-blocked
 *  rows (rendered demoted, collapsed, non-selectable). */
export function splitByActionability(rows: UnifiedRow[]): {
  actionable: UnifiedRow[];
  blocked: UnifiedRow[];
} {
  return {
    actionable: rows.filter((r) => r.launchable),
    blocked: rows.filter((r) => !r.launchable),
  };
}

/** How many actionable rows the user's floor hides (P1-8 floor hint). */
export function hiddenByFloorCount(rows: UnifiedRow[], floorApr: number): number {
  return rows.filter(
    (r) => r.launchable && typeof r.headlineApr === "number" && r.headlineApr < floorApr,
  ).length;
}

/**
 * The row shape the absence routing reads: a projected candidate, plus the
 * catalog projection's own `neverPositive` where the caller has been through
 * `buildUnifiedList`. Widened off `UnifiedRow` (2026-08-24) so the LANE side
 * — which holds a raw `ProjectedCandidate` and no venue-doc provenance — can
 * ask the same one owner whether its pinned row is an absence. On a raw row
 * `neverPositive` is simply absent, which reads as "not ruled negative", and
 * the lane's own netApy gate already refuses the negative case there.
 */
export type AbsenceRow = ProjectedCandidate & { neverPositive?: boolean };

/** Negative at every reachable leverage: nothing to build here at any dial
 *  position. The surface collapses these into the dead group. */
export function isNeverPositive(r: AbsenceRow): boolean {
  return r.neverPositive === true;
}

/**
 * NOTHING TO HOLD (2026-08-23) — a measured book with no asset behind it.
 *
 * The funding scanner shortlists a PERP BOOK and then looks for a spot leg to
 * hold against the short. On 20 of the 24 books on the committed document it
 * finds none, and the row comes through with `spotLeg: null`,
 * `collateralYieldApy: 0`, `pair` set to the perp coin, and
 * `yield_source_integrity` failing with "a book with no spot leg cannot clear
 * the screen". Four of those rows print the IDENTICAL 6.876404%, because that
 * headline is not a market at all: it is `f_b · (0.1095 − 0.0075)`, the
 * administered ceiling, four times.
 *
 * There is no asset, so there is no deposit, so there is no APY. The row is
 * still worth publishing — the funding measurement is real and it is the whole
 * point of scanning 1,151 markets — but it is worth publishing as an ABSENCE.
 *
 * GUARDED ON THE FUNDING SCANNER'S OWN `spotLeg` FIELD so it can never fire on
 * a loop row. Looking for the leg is the funding scanner's defining act, so
 * every row it prices carries the field — as `null` exactly when no leg was
 * found — while no loop scanner emits it at all. It was guarded on
 * `fundingWindowDays` before F3: the one-register reconciliation now copies
 * the book's window onto the LOOP rows priced from it, so the window stopped
 * discriminating scanner provenance and the leg field is the fact that does.
 */
export function hasNoSpotLeg(r: AbsenceRow): boolean {
  const e = r.economics;
  return !!e && e.spotLeg !== undefined && !e.spotLeg;
}

/**
 * THE FOUR ABSENCES, AND WHICH ONE BINDS — one owner for the panel's routing.
 *
 * `null` means the row is live: it can be picked. Anything else names the
 * group it belongs in, and the ORDER OF THE TESTS IS THE RULING:
 *
 *  1 · NO ECONOMICS. A row the scan could not price has no capacity to judge
 *      and no sign to judge; every test below would be answering a question
 *      about numbers the row does not carry.
 *  2 · CAPACITY. A row that can take no deposit is not an economic judgement
 *      at all, and one live row (Dolomite WBERA/sWBERA) is both zero-capacity
 *      and never-positive. Filing it under "cannot be deposited into" states
 *      the binding fact; filing it under the sign would invite the reader to
 *      go looking for a leverage that fixes it.
 *  3 · NO SPOT LEG, BEFORE THE SIGN. A missing asset is the harder fact and it
 *      outranks the sign — the alternative splits ONE absence across two
 *      groups on the sign of a number that cannot exist, so twelve leg-less
 *      books would print an absent headline while eight more printed a
 *      confident −36% for markets that are equally un-depositable.
 *  4 · THE SIGN. jitoSOL lands here and correctly so: it HAS a registered leg,
 *      named on the card, on Solana, credited zero because that chain is not a
 *      rail. The market exists and the model scores it below zero.
 *
 * IT LIVES HERE AND NOT IN THE PANEL because the law it has to satisfy —
 * every scanned row renders in exactly one place — is swept over the whole
 * fixture catalog in a test, and vitest cannot import a `.tsx` (the Next
 * tsconfig keeps `jsx: "preserve"`). It is the same argument `rack-row.ts`
 * and `leverage-module.ts` already carry for the same move.
 */
export type AbsenceKind = "neg" | "noLeg" | "cap" | "unmeasured";

export function discoverAbsence(r: AbsenceRow): AbsenceKind | null {
  if (!r.economics) return "unmeasured";
  if (!acceptsDeposits(r)) return "cap";
  if (hasNoSpotLeg(r)) return "noLeg";
  if (isNeverPositive(r)) return "neg";
  return null;
}

/**
 * WHAT ONE PRESS ON THIS ROW DOES — the one owner of the picker's routing and
 * of the review gate's eyes-open demotion class (funding launch rail, design
 * ruling 3, 2026-08-24). Three answers:
 *
 *  · `"launch"`   — the compile rail exists behind this venue: the press pins
 *                   and the lane can request launch.
 *  · `"eyesOpen"` — rail-absent but FULLY MEASURED (an absence-free row on a
 *                   venue outside `LAUNCHABLE_VENUES`): the press PINS, with
 *                   the venue verdict visible; the lane composes, reaches
 *                   review, and publishes as a modeled design carrying that
 *                   verdict. The funding carries, the stable loops on Morpho
 *                   Ethereum and Aave v3 Base, and the priced Dolomite rows
 *                   all land here.
 *  · an `AbsenceKind` — measurement-absent: screen-only until measured, and
 *                   the press answers with the binding absence.
 *
 * The ORDER is the ruling: an absence outranks the rail question, because a
 * row with nothing measured has nothing to compose whichever venue it is on.
 */
export type PressClass = "launch" | "eyesOpen" | AbsenceKind;

export function pressClass(r: AbsenceRow & { launchable: boolean }): PressClass {
  const absence = discoverAbsence(r);
  if (absence !== null) return absence;
  return r.launchable ? "launch" : "eyesOpen";
}

// ── THE PICKER'S TWO NUMBERS (2026-08-24) ─────────────────────────────────
//
// A catalog row prints ONE APY at ONE leverage, and on part of the live
// catalog that one number is true only of the lane the reader does not have.
//
// ── THE DEFECT, MEASURED ON THE LIVE PAYLOAD (block 50387055 / 25274369) ──
//
// `aave-v3-base syrupUSDC/GHO@e11` prints `4.4% at 1.00x`, because the rack
// WITHHOLDS the leverage module on a market whose slope is non-positive and a
// loop lane with no `safety-buffer` prices at `PRODUCT_MIN_LEVERAGE` (THE
// MODULE RULING, leverage-module.ts). That is honest about a fresh
// market-first pick. It is not the whole market: the dial's own default for
// this row is 2.25x, `RackCanvas.onSelectMarket` writes exactly that number
// into any lane that ALREADY holds the module (RackCanvas.tsx:1926), and the
// composition models −19.4% there — at or below zero, which is one of the two
// numeric clauses `deriveReviewGate` refuses a publish on. Same row, same
// scan, same block: one leverage builds and one leverage is a dead primary
// action, and the catalog said nothing.
//
// Six live rows are in that state today (five Aave ETH pairs plus
// syrupUSDC/GHO). The Dolomite rows are the same shape one venue over.
//
// ── THE RULE ──────────────────────────────────────────────────────────────
//
// A market has exactly TWO leverages worth quoting, and they are both already
// owned elsewhere: the bottom of the reachable range (`reachableLeverage().lo`
// = `PRODUCT_MIN_LEVERAGE`) and the dial's own default for the market
// (`landingLeverage`, the ONE landing derivation). `seatedLeverage` below is
// always one of the two. When exactly ONE of them is publishable, the row
// carries both numbers, lower leverage first, and the reader learns the
// market's leverage behaviour before pressing.
//
// When both are publishable the market is well behaved and one number is the
// whole story. When neither is, the row is an absence and `discoverAbsence`
// has already filed it in a group whose own sentence says so — two failing
// numbers there would teach nothing the group bar does not already say.
//
// NO ADJECTIVE, EVER. The label is the quantity: two rates, each welded to the
// leverage it holds at, through `format.ts`'s own two glyphs. Nothing here
// grades a market.
//
// PRE-FEE, DELIBERATELY. A Browse-markets row is a VENUE fact, and the house
// compute fee is a product term that applies at the lane (planner ruling R1's
// boundary rule). These two numbers are the venue's, exactly as the headline
// beside them already is.

/**
 * THE ECONOMIC CEILING A CATALOG ROW IS SEATED UNDER (planner ruling R4).
 *
 * A card is priced with NO composition — `frameAt` calls `mockQuote` with none
 * and `composedNetApy(cand, row.cls === "A")` — so the hedge decision here is
 * the market's own class, exactly as the headline beside it is priced. Same
 * two reads `composedTerms` takes for the short leg, so the ceiling belongs to
 * the frame the card actually prints. Null on every row with a positive
 * leverage slope, where `netCarry(L)` never crosses zero.
 */
function breakevenCeiling(row: ProjectedCandidate): number | null {
  return breakevenStopFor(row, row.cls === "A", null);
}

/**
 * The leverage a fresh pick lands on, and the leverage every card quotes its
 * APY at. ONE owner: `DiscoverPanel` imports it rather than mirroring it.
 *
 * ⚠ THE PREDICATE IS THE RACK'S OWN. `bestAtFloor` looks like the answer and
 * is not (`card-lane-parity.test.ts` case 3 finds rows where the rack withholds
 * the control while `bestAtFloor` is false). `leverageModuleInstalls` is the
 * function the rack itself calls, and `pricingParamsFor` prices a loop lane
 * holding no `safety-buffer` at `PRODUCT_MIN_LEVERAGE`.
 */
export function seatedLeverage(
  row: ProjectedCandidate,
  preset: RiskPreset = CATALOG_PRESET,
): number {
  // The rack will withhold the leverage control here, so the lane prices at
  // the floor. Quote what will be BUILT, never what could be requested.
  if (!leverageModuleInstalls(row)) return PRODUCT_MIN_LEVERAGE;
  const d = descriptorFor("safety-buffer", "targetLeverage");
  const structuralMax = typeof d?.max === "number" ? d.max : Infinity;
  const descriptorDefault = typeof d?.default === "number" ? d.default : 3;
  const lt = typeof row.lt === "number" && row.lt > 0 ? row.lt : null;
  // No lt means nothing is written and the plate keeps the descriptor's own
  // default — which is what the lane will be priced at.
  if (lt === null) return descriptorDefault;
  return Math.min(
    structuralMax,
    landingLeverage(lt, preset, row.economics?.loopLeverage ?? null, breakevenCeiling(row)),
  );
}

/**
 * The dial's OWN default for this market — the number
 * `RackCanvas.onSelectMarket` writes into a lane that holds the leverage
 * module, whether or not this pick would seat one.
 *
 * Null on a market with no liquidation threshold: a funding book has no debt
 * leg, so it has no dial, and inventing one would advertise a control the
 * market does not have.
 */
export function dialDefaultLeverage(
  row: ProjectedCandidate,
  preset: RiskPreset = CATALOG_PRESET,
): number | null {
  const lt = typeof row.lt === "number" && row.lt > 0 ? row.lt : null;
  if (lt === null) return null;
  const d = descriptorFor("safety-buffer", "targetLeverage");
  const structuralMax = typeof d?.max === "number" ? d.max : Infinity;
  /* THE R4 CEILING, BECAUSE THIS FUNCTION'S WHOLE CLAIM IS "the number
     RackCanvas.onSelectMarket writes" (S1, 2026-08-24). That write now carries
     `breakevenStopFor` as its 4th argument, so a default derived here without
     it would name a leverage the canvas no longer writes: the card would quote
     `−6.7% at the 1.75x default` for a dial whose default is 1.25x. One
     landing, one derivation, both ends. */
  return Math.min(
    structuralMax,
    landingLeverage(lt, preset, row.economics?.loopLeverage ?? null, breakevenCeiling(row)),
  );
}

/** One market, priced at one leverage, with the two facts a publish turns on. */
export interface PricedFrame {
  /** The leverage the model LANDED on, after every clamp. */
  leverage: number;
  /** `composedNetApy` at that leverage. Null when the row is unpriced. */
  apy: number | null;
  /** The repriced candidate can absorb one minimum deposit AT this leverage.
   *  Held separately from `publishable` because the two gate clauses are two
   *  different facts and a test must be able to feed each one to the gate. */
  acceptsDeposit: boolean;
  /**
   * This frame could be published.
   *
   * It mirrors, and may only ever mirror, the two clauses in
   * `deriveReviewGate` (`review-gating.ts`) that refuse a lane on its NUMBERS
   * rather than on its graph: `acceptsDeposits === false`, and
   * `netApy <= 0`. `picker-dual-number.test.ts` asserts the agreement against
   * `deriveReviewGate` itself, so a change to either threshold fails there
   * rather than drifting quietly here.
   */
  publishable: boolean;
}

/** Price one row at one leverage, through the same door the card's headline
 *  and the lane's own quote both come out of. */
export function frameAt(
  row: ProjectedCandidate,
  leverage: number,
  preset: RiskPreset = CATALOG_PRESET,
): PricedFrame {
  const q = mockQuote({ row, blockNumber: 0 }, leverage, preset);
  const cand = q.ok === true ? q.candidate : null;
  const apy = composedNetApy(cand, row.cls === "A");
  const takesDeposit = acceptsDeposits(cand);
  return {
    leverage: cand?.economics?.loopLeverage ?? leverage,
    apy,
    acceptsDeposit: takesDeposit,
    publishable: takesDeposit && typeof apy === "number" && apy > 0,
  };
}

/** Below this two leverages are one leverage. The dial's grid is 0.25. */
const LEVERAGE_EPS = 1e-9;

/**
 * BOTH NUMBERS, or none — the ratified shape:
 *
 *   `12.0% at 1.00x · −18.0% at the 2.75x default`
 *
 * Lower leverage first, because that is the frame a fresh pick lands on
 * wherever the two disagree. Null when one number is the whole story.
 */
export function dualLeverageLine(
  row: ProjectedCandidate,
  preset: RiskPreset = CATALOG_PRESET,
): string | null {
  const range = reachableLeverage(row, preset);
  const dialL = dialDefaultLeverage(row, preset);
  if (!range || dialL === null) return null;
  if (dialL <= range.lo + LEVERAGE_EPS) return null;
  const low = frameAt(row, range.lo, preset);
  const high = frameAt(row, dialL, preset);
  if (typeof low.apy !== "number" || typeof high.apy !== "number") return null;
  // Both build, or neither does: the row is not carrying a hidden dead frame.
  if (low.publishable === high.publishable) return null;
  return `${pct(low.apy)} at ${lev(low.leverage)} · ${pct(high.apy)} at the ${lev(high.leverage)} default`;
}

/**
 * WHY A ROW CARRIES NO ECONOMICS, in three words, for the capacity slot.
 *
 * On an unpriced row the first failed gate is the only thing the row knows —
 * there is no capacity, no APY and no spread to say anything else with. This
 * does NOT contradict the panel's `DO NOT render failedGates` note: that note
 * is about PRICED rows, where three identical cbETH cards carry the identical
 * gate list and it discriminates nothing. Here it is the entire content.
 *
 * Live on production today with no funding venue deployed: three Dolomite
 * rows (WBERA/iBGT, iBERA/iBGT, sWBERA/iBGT) return `economics: null` with
 * `firstFailedGate: "caps_fail_closed"` and were being deleted from the panel
 * outright.
 */
export function unmeasuredReason(r: UnifiedRow): string {
  if (r.firstFailedGate === "market_sanity") return "no funding history";
  if (r.firstFailedGate === "caps_fail_closed") return "venue caps unread";
  return "not priced";
}

export function buildUnifiedList(
  rawVenues: SourcedVenue[],
  opts: { venueFilter?: VenueFilter; classFilter?: ClassFilter; preset?: RiskPreset } = {},
): UnifiedList {
  const vf = opts.venueFilter ?? "all";
  const cf = opts.classFilter ?? "both";
  const preset = opts.preset ?? CATALOG_PRESET;

  // ONE p25 REGISTER PER BOOK (F3): before anything is derived, every loop
  // row's hedge credit is re-based onto the funding venue's own min-window
  // rate for the book it shorts, exactly (see `reconcileHedgeFunding`). The
  // cards, the ranking, `bestApy` and the dominance pointers all read the
  // reconciled rows, so the catalog prices one book at one rate.
  const venues = reconcileHedgeFunding(rawVenues);

  // Ledger, best-APY and dominance are all derived over the WHOLE payload
  // before any filter is applied: a venue chip changes what is shown, never
  // what is true. Filtering first would let a capacity, a dominance pointer
  // or a discriminator chip change under the user as they toggle a filter.
  const ledger = capacityLedger(venues);
  const built = venues.flatMap((v) => [
    ...toRows(v.hedged, v, ledger, preset).map((r) => ({ r, hedgedSection: true })),
    ...toRows(v.unhedged, v, ledger, preset).map((r) => ({ r, hedgedSection: false })),
  ]);
  const all = built.map((x) => x.r);
  markLtDiscriminator(all);
  markDominance(all);

  const shown = (r: UnifiedRow) => vf === "all" || vf.has(r.venue);
  const hedged =
    cf === "unhedged"
      ? []
      : built
          .filter((x) => x.hedgedSection && shown(x.r))
          .map((x) => x.r)
          .sort(byActionabilityThenHeadline);
  const unhedged =
    cf === "hedged"
      ? []
      : built
          .filter((x) => !x.hedgedSection && shown(x.r))
          .map((x) => x.r)
          .sort(byActionabilityThenHeadline);
  return { hedged, unhedged };
}

// ── THE MODELED GROUP (P0-7) ──────────────────────────────────────────────
//
// D2, in one sentence: three of the four products were dead ends, and the
// module list was never the cause — the CATALOG was. `DN_LP_CANDIDATE` and
// `COLLAR_CANDIDATE` were reachable only by exact id through
// `templateCatalogHit`, i.e. only from a `?template=` link, so a lane that
// pressed `Auto center` or `Covered call` could pin NOTHING that would price.
// Every hand-authored row enters the panel here — the two template rows and,
// since 2026-09-03, the six treasury issuer rows, which is what makes the
// issuer a choice a builder presses rather than one the catalog already made
// (founder ruling H-6). The list is read from `TEMPLATE_CANDIDATES`, so a
// seventh row arrives without this file being edited.
//
// THREE RULES THIS PROJECTION HOLDS, and each one is a rule about honesty
// rather than about layout:
//
//  1. THEY ARE THEIR OWN GROUP AND ARE NEVER SORTED AMONG SCAN ROWS. A
//     modeled number and a scanned number are two different claims; ranking
//     them against each other would put the collar's 11.8% above every live
//     market on the strength of a model with no venue behind it.
//
//  2. THEY CARRY THE TEMPLATE'S OWN PIN (`contentHash: "template"`), so a
//     market picked BY HAND here and the same market SEEDED by
//     `?template=dn-lp` write byte-identical liquidity-source params. That
//     equality is the acceptance criterion of this item, and it is a property
//     of the row rather than of the surface that renders it.
//
//  3. THEY STATE THE COMPOSITION THEIR NUMBER IS PRICED AT (`pricedWith`),
//     derived from `FAMILY_REQUIRED_GROUPS` so a fourth family cannot leave
//     it stale. The family models price the LP with its hedge and the collar
//     with both option legs; a card that printed the number without naming
//     the legs would be advertising a machine the lane does not hold yet,
//     which is the "advertised = composed" rule read backwards.

/** A hand-authored row, projected for the catalog. The two extra fields are
 *  facts the family model already owns; nothing here is re-derived. */
export interface ModeledRow extends UnifiedRow {
  /** The one lane family this market can be priced on. Read from the row's
   *  own `economics.terms.family` through `familiesForCandidate`. */
  family: LaneFamily;
  /** The modules the printed number is priced WITH, and — the same fact seen
   *  from the other side — the modules a lane must seat before it can
   *  publish on this market. `FAMILY_REQUIRED_GROUPS` minus the source. */
  pricedWith: ModuleKey[];
}

/** The pin a hand-authored row stores. `buildTemplatePortfolio` writes the
 *  same literal, which is what makes a by-hand pick and a template seed one
 *  composition rather than two that resemble each other. */
export const MODELED_CONTENT_HASH = "template";

/**
 * The hand-authored rows a lane can actually price, in family-declaration
 * order.
 *
 * `families` is the lane's surviving families (`committedFamilies`), and an
 * empty or absent list means the lane has expressed nothing yet, so it is
 * offered every modeled row — the blank lane's own ruling, applied to the
 * catalog: refuse only what is arithmetically impossible.
 *
 * NOT ranked by APY. Two rows from two families have no common frame to be
 * ranked in, and the order they are declared in is the same order §4D gives
 * their anchor modules in the shelf, so the two surfaces read alike.
 */
export function modeledRows(families?: readonly LaneFamily[] | null): ModeledRow[] {
  const want = families && families.length > 0 ? new Set(families) : null;
  const rows: ModeledRow[] = [];
  for (const c of TEMPLATE_CANDIDATES) {
    const fams = familiesForCandidate(c);
    const family = fams[0];
    if (!family) continue;
    if (want && !fams.some((f) => want.has(f))) continue;
    const hasHedge = c.cls === "A";
    const best = deriveBest(c);
    rows.push({
      ...c,
      family,
      pricedWith: FAMILY_REQUIRED_GROUPS[family]
        .flat()
        .filter((k) => k !== "liquidity-source"),
      headlineApr: screeningApr(c),
      venueLabel: VENUE_LABELS[c.venue] ?? c.venue,
      contentHash: MODELED_CONTENT_HASH,
      // A modeled row has no scan behind it, so it can be neither stale nor a
      // snapshot: both flags are statements about a document that does not
      // exist here, and `false` is the only true value either can take.
      stale: false,
      snapshot: false,
      bestApy: best ? best.apy : null,
      bestL: best ? best.leverage : null,
      // An LP and a collar are unlevered by construction (`loopLeverage: 1`),
      // so the reachable range is a single point: there is no floor to be at.
      bestAtFloor: false,
      neverPositive: best ? best.apy < 0 : false,
      capacityKey: capacityResourceKey(c, hasHedge),
      // ONE tenant, stated rather than counted: these rows are not in the
      // payload the ledger is built over. ⚠ the dn-LP lane really does hold
      // an ETH perp short as well as its pool position, and `capacityKey`
      // reports only the pool — that is D-CAPACITY, and it is P0-10's
      // `laneResources`, not a number this projection may invent.
      capacitySharedCount: 1,
      capacityScanUsd: c.economics?.capacityUsd ?? null,
      capacityReconciled: false,
      /* NEITHER DISCRIMINATES, and the reason changed on 2026-09-03 without
         the values changing.
         `ltDiscriminator` names the liquidation threshold that separates two
         rows on ONE market. Every hand-authored row carries `lt: null` — an
         LP, an option pair and an issuer share have no liquidation threshold
         at all — so there is nothing here to separate rows by.
         `dominatedBy` is null for the same reason it is null on every scan
         row in `toRows`: this projection states what a row IS and the
         dominance sweep is a separate owner. It is worth writing down that
         the question is now REAL on this list — the treasury family ships
         six rows and they differ by rate, by capacity and by settlement
         window — where before there was one row per family and the answer was
         empty by construction. */
      ltDiscriminator: null,
      dominatedBy: null,
    });
  }
  return rows;
}

/** Find the venue doc that owns a candidate id (selection pin lookups). */
export function venueDocForCandidate(
  venues: SourcedVenue[],
  candidateId: string,
): SourcedVenue | null {
  if (!candidateId) return null;
  return (
    venues.find((v) =>
      v.hedged.concat(v.unhedged).some((c) => c.id === candidateId),
    ) ?? null
  );
}

/*
 * HANDOFF (owners of the catalog lift and the Discover card):
 *
 *  1. The LANE still reprices from the raw payload (`catalogRow(opp, id)` in
 *     mock-quote), so it does not see the reconciled capacity. Apply
 *     `reconcileSharedCapacity(venues)` once at lift time (catalog-store /
 *     opportunities-client) and both surfaces read one number for one book.
 *
 *  2. `__tests__/opportunities.test.ts` asserts `headlineApr === apyRiskAdj`
 *     on every N1 row of the per-doc projection. That assertion IS defect B3
 *     written down as an expectation. When that file's owner is ready, move
 *     `screeningApr` into `projectV2Candidate` and update the assertion; the
 *     catalog result is identical either way.
 *
 *  3. CLOSED (C-H4, 2026-08-23): the isolated-market refinement folded into
 *     capacity.ts `venueLocalKey`, so cards AND lanes un-pool Morpho Blue
 *     markets through one owner; `cardResourceKey` above is now an alias.
 */
