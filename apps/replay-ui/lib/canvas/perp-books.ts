/**
 * THE PERP BOOK, AS THE SCANNER ACTUALLY MEASURED IT (P0-2, 2026-08-22).
 *
 * ── THE DEFECT THIS CLOSES ──────────────────────────────────────────────
 * `FUNDING_VENUES` hand-types a `capacityUsd` per market, dated 2026-08-19,
 * and multiplies an equally hand-typed `openInterestUsd` by a `maxOiShare`
 * dial to produce a second bound. Neither number has ever been measured.
 * Against the live catalog on 2026-08-22T17:22Z, on the SAME books, the same
 * minute:
 *
 *     HYPE   hand-typed $40,000,000   measured $6,096 of deposit room
 *     ETH    hand-typed $54,000,000   measured $955,238
 *
 * 6,562x and 56.5x, both in the direction that flatters us. Every rack row
 * that shorts these books binds on `HL book depth` — the exact limit the
 * funding canvas does not model at all.
 *
 * ── THE ONE FACT THIS FILE OWNS ─────────────────────────────────────────
 * The book's SHORT NOTIONAL bound, which is leverage-independent and is
 * therefore the only figure two different products can share. Net delta on a
 * class-A lane is 1.0x of equity and equity is `f_b · deposit`, so short
 * notional per deposited dollar is exactly f_b, with no L in it. The scan
 * stores its HL bounds already divided: `capacityUsd = notional / F_B`
 * (`capacity.ts:70-86`). So this file multiplies that constant back out ONCE,
 * and every consumer divides by ITS OWN f_b.
 *
 * That is why a reading carries notional and never deposit dollars. A funding
 * lane at (3, 0.15) has f_b = 0.674157 while the scan stored at F_B = 0.75;
 * handing it the rack's deposit figure directly would understate the same
 * book by 10.1% for no reason other than whose dials were read.
 *
 * ── WHY ONLY HYPERLIQUID ────────────────────────────────────────────────
 * `hlCoin` names a Hyperliquid book. The Aster ETH book and the Avantis ETH
 * book are different books with different depth, and borrowing Hyperliquid's
 * measurement for them would be fabricating a number for a venue nobody
 * scanned. `readingFor` therefore refuses any venue but Hyperliquid, and an
 * unmeasured market prints no capacity rather than a friendly one.
 */

/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion, eqeqeq --
 * Kit-verbatim file, ported from build.priime.finance eb6d33a. The findings
 * are the typed presets reading kit idioms; not rewriting kit logic to satisfy
 * lint, per the integration's own directive (the RackCanvas.tsx precedent). */

import { F_B } from "@/lib/model-constants";
import { isTemplateVenue, type ProjectedCandidate, type ProjectedVenue } from "./opportunities";

/** The venue whose books `hlCoin` names. Nothing else may read these bounds. */
export const MEASURED_PERP_VENUE_ID = "hyperliquid";

/** The venue whose rows state a funding carry's CREDITED spot leg. */
export const FUNDING_VENUE_ID = "hyperliquid-funding";

/**
 * An HL-side binding states the BOOK's limit. Every other binding states a
 * lending-market limit that is tighter than the book and says nothing about
 * it, so reading `capacityUsd` off such a row would understate the book by
 * whatever the collateral cap happened to be.
 */
function bindsOnPerpBook(c: ProjectedCandidate): boolean {
  return (c.economics?.capacityBinding ?? "").startsWith("HL ");
}

export interface PerpBookReading {
  coin: string;
  /** SHORT NOTIONAL the measured book absorbs. Leverage-independent. */
  boundNotionalUsd: number;
  /**
   * THE BOOK'S FUNDING PERCENTILE OF RECORD (recette F3, ratified rule D1).
   *
   * The funding venue's own `min(p25 over 30/90/180/365d)` wherever that venue
   * priced this book, a loop row's scan rate only where it did not. Ownership
   * is by PROVENANCE, never by which row happened to measure the tightest
   * notional: before this, the loop scan credited the kHYPE hedge at 0.1095
   * (90d) while the funding venue's min-window rule priced the same HYPE book
   * at 0.102212 (30d), and one book carried two funding registers five clicks
   * apart.
   */
  fundingP25Apr: number | null;
  /** The window the rate of record is published over (the min-window pick).
   *  Null when the rate came from a loop scan, which publishes no window. */
  fundingWindowDays: number | null;
  /** True when the funding venue's own row set the rate. Only such a reading
   *  may overwrite a loop row's hedge credit (`reconcileHedgeFunding`). */
  fundingOwned: boolean;
  /**
   * The CREDITED spot-leg yield for a funding carry on this book, from the
   * funding venue's own row, or null when no funding venue has scanned it.
   *
   * ⚠ CREDITED, NOT NAMED. The scanner can name a leg it cannot reach: jitoSOL
   * is recorded as `{symbol:"jitoSOL", apy:0.051, reachable:false}` with
   * `collateralYieldApy: 0`, because Solana is not a rail. The number here is
   * always the one the row was PRICED on, never the one it was labelled with.
   */
  spotYieldApr: number | null;
  /** Verbatim from the rows that stated it, e.g. `HL book depth`. */
  bindingLabel: string;
  /** Catalog rows that bound on this book. */
  rowCount: number;
}

export type PerpBookIndex = ReadonlyMap<string, PerpBookReading>;

/**
 * Every perp book the catalog measured, keyed by coin.
 *
 * Rows binding on the same book state the SAME `capacityUsd`, because they
 * were all divided by the same constant: on the live catalog all eight
 * HL-bound ETH rows state 955238 exactly. Where they disagree the tightest
 * wins, which is the reading that cannot overstate.
 */
export function perpBookIndex(venues: readonly ProjectedVenue[]): PerpBookIndex {
  const out = new Map<string, PerpBookReading>();
  for (const v of venues) {
    for (const c of [...(v.hedged ?? []), ...(v.unhedged ?? [])]) {
      const coin = c.hlCoin;
      if (!coin || !bindsOnPerpBook(c)) continue;
      const cap = c.economics?.capacityUsd;
      if (typeof cap !== "number" || !Number.isFinite(cap) || cap <= 0) continue;
      const notional = cap * F_B;
      const p25 = c.economics?.fundingP25Apr;
      const hasP25 = typeof p25 === "number" && Number.isFinite(p25);
      const isFundingVenue = c.venue === FUNDING_VENUE_ID;
      const prev = out.get(coin);
      const tighter = !prev || notional < prev.boundNotionalUsd;

      /* THE RATE AND THE BOUND HAVE DIFFERENT OWNERS (F3, 2026-08-23).
         The BOUND is a fail-safe minimum, so the tightest measurement wins it.
         The RATE is the D1 min-window rule, so the funding venue's own row
         wins it BY PROVENANCE — before this, the rate rode along with whoever
         won the notional contest, and a loop scan's 90d p25 could silently
         repossess a book the funding venue had already priced at its 30d
         minimum. Loop rows still fill the rate in (window unstated) on the
         books the funding venue has not priced. */
      const ownsNow = isFundingVenue && hasP25;
      let fundingP25Apr: number | null;
      let fundingWindowDays: number | null;
      let fundingOwned: boolean;
      if (ownsNow) {
        fundingP25Apr = p25 as number;
        const w = c.economics?.fundingWindowDays;
        fundingWindowDays = typeof w === "number" && Number.isFinite(w) ? w : null;
        fundingOwned = true;
      } else if (prev?.fundingOwned) {
        fundingP25Apr = prev.fundingP25Apr;
        fundingWindowDays = prev.fundingWindowDays;
        fundingOwned = true;
      } else if (tighter && hasP25) {
        fundingP25Apr = p25 as number;
        fundingWindowDays = null;
        fundingOwned = false;
      } else {
        fundingP25Apr = prev?.fundingP25Apr ?? (hasP25 ? (p25 as number) : null);
        fundingWindowDays = prev?.fundingWindowDays ?? null;
        fundingOwned = prev?.fundingOwned ?? false;
      }

      out.set(coin, {
        coin,
        boundNotionalUsd: tighter ? notional : prev!.boundNotionalUsd,
        fundingP25Apr,
        fundingWindowDays,
        fundingOwned,
        /* ONLY the funding venue is authoritative about a funding carry's spot
           leg. A LENDING row's `collateralYieldApy` is its own collateral's
           yield (cbETH at 2.5%), which has nothing to do with what a carry on
           that coin's book could hold. */
        spotYieldApr:
          isFundingVenue && typeof c.economics?.collateralYieldApy === "number"
            ? c.economics.collateralYieldApy
            : (prev?.spotYieldApr ?? null),
        bindingLabel: tighter ? (c.economics?.capacityBinding ?? "HL book") : prev!.bindingLabel,
        rowCount: (prev?.rowCount ?? 0) + 1,
      });
    }
  }
  return out;
}

/**
 * ONE p25 REGISTER PER BOOK, applied to the LOOP rows (recette F3, quant Q-1).
 *
 * The loop scanners credit a hedge at their own trailing p25 (a 90d read with
 * no published window) while the funding venue prices the SAME book under the
 * ratified D1 rule, `min(p25 over 30/90/180/365d)`, and publishes which window
 * won. Two registers for one book put "8.2%" on the kHYPE loop card and
 * "7.7%" on the funding card five clicks away — the flagship headline 0.5pp
 * optimistic against the product's own honesty rule.
 *
 * This rewrites every loop row that shorts a book the FUNDING VENUE has
 * priced (`fundingOwned` — a reading whose rate merely came from another loop
 * row proves nothing and rewrites nothing) so the whole catalog prices the
 * hedge credit off the one owner:
 *
 *   · `fundingP25Apr`      → the owner's min-window rate
 *   · `fundingWindowDays`  → the owner's window, so the lane side can publish
 *                            "over Nd" exactly as the funding card does
 *   · `netCarryOnEquityApy` and `netApyOnDepositApy` → shifted EXACTLY:
 *       the class-A identity is netCarry = G + f − drag and netApy = f_b ·
 *       netCarry, so Δf moves netCarry by Δf and netApy by f_b·Δf, with f_b
 *       recovered from the row's own netApy/netCarry ratio — the same
 *       inversion `escrowShare`'s row path performs. NOTHING ELSE MOVES, so
 *       the row stays self-consistent for every downstream inversion
 *       (`statedFb`, `hedge-econ`'s identity assert) by construction.
 *
 * A row whose f_b cannot be recovered (|netCarry| ~ 0, or a ratio outside
 * (0, 1]) is left exactly as scanned: a partial rewrite would be a lie.
 *
 * ⚠ ROUTING GUARD: the copied `fundingWindowDays` must NOT flip the row into
 * the funding-card grammar. `isFundingRow` and `hasNoSpotLeg` key on the
 * funding scanner's own `spotLeg` field (which loop scanners never emit),
 * never on the window — see funding-card.ts / unified-list.ts.
 *
 * Callers: `loadAllVenues` applies it at the API boundary (QNT-1), so the
 * served payload is itself single-register and every raw consumer reads one
 * truth; `buildUnifiedList` and `supplyLadder` apply it to every card
 * surface, and RackCanvas re-applies it at the lift (where the live-rail
 * shell row rides along beside the payload's venues). The re-runs are safe
 * BY IDEMPOTENCE: on an already-reconciled catalog the owner's rate equals
 * the row's, the rewrite branch never fires, and no published number moves
 * (pinned by one-register-boundary.test.ts).
 */
export function reconcileHedgeFunding<T extends ProjectedVenue>(venues: readonly T[]): T[] {
  const books = perpBookIndex(venues);
  let owned = false;
  for (const r of books.values()) if (r.fundingOwned) owned = true;
  if (!owned) return [...venues];

  const fix = (c: ProjectedCandidate): ProjectedCandidate => {
    const e = c.economics;
    if (!e || c.cls !== "A" || !c.hlCoin) return c;
    if (c.venue === FUNDING_VENUE_ID || isTemplateVenue(c.venue)) return c;
    const reading = books.get(c.hlCoin);
    if (!reading || !reading.fundingOwned || reading.fundingP25Apr === null) return c;
    const oldF = e.fundingP25Apr;
    if (typeof oldF !== "number" || !Number.isFinite(oldF)) return c;
    const newF = reading.fundingP25Apr;
    if (newF === oldF) {
      // Same rate, so no arithmetic moves — but the owner's window is still
      // the book's window, and the row may now publish it.
      if (reading.fundingWindowDays == null || e.fundingWindowDays != null) return c;
      return { ...c, economics: { ...e, fundingWindowDays: reading.fundingWindowDays } };
    }
    const netCarry = e.netCarryOnEquityApy;
    const netApy = e.netApyOnDepositApy;
    if (!Number.isFinite(netCarry) || Math.abs(netCarry) < 1e-9) return c;
    const fb = netApy / netCarry;
    if (!Number.isFinite(fb) || fb <= 0 || fb > 1) return c;
    const newCarry = netCarry + (newF - oldF);
    const newApy = fb * newCarry;
    return {
      ...c,
      // A class-A row's headline IS its net APY on deposit; it moves with it.
      headlineApr: typeof c.headlineApr === "number" ? newApy : c.headlineApr,
      economics: {
        ...e,
        fundingP25Apr: newF,
        fundingWindowDays: reading.fundingWindowDays,
        netCarryOnEquityApy: newCarry,
        netApyOnDepositApy: newApy,
      },
    };
  };
  return venues.map((v) => ({ ...v, hedged: v.hedged.map(fix), unhedged: v.unhedged.map(fix) }));
}

/**
 * The reading for one market, or null when nobody measured that book.
 *
 * ── THE COVERAGE PROBLEM THIS FILE USED TO HAVE, AND WHO FIXED IT ────────
 * Every bound here comes off a catalog row, and until 2026-08-23 every
 * catalog row was a LENDING market. So a book was measurable only where some
 * lending pair happened to short it, and funding coverage was a byproduct of
 * the lending catalog rather than a property of the book. Two consequences,
 * both observed:
 *
 *   · SOL is on the funding shelf and in no lending market we scan, so no
 *     rack row shorted its book and no measurement of it existed at all.
 *   · BTC became measurable only because the carry-engine rule stopped
 *     requiring the collateral to accrue, which admitted
 *     `aave-v3-base:8453:lbtc-cbbtc@e4` — and exactly ONE row carried it.
 *     If that row's binding ever moved off `HL ` (a tighter collateral cap, a
 *     thinner borrow leg) BTC would silently return to unmeasured and the
 *     funding BTC lane would stop publishing, with nothing saying why.
 *
 * The `hyperliquid-funding` venue scans perp books FOR THEIR OWN SAKE and
 * emits one spot-class row per book, binding on `HL open interest` or `HL
 * book depth` by construction. Every book it prices therefore lands in this
 * index on a row that exists because the book exists, not because a lending
 * pair happened to reference it. All four Hyperliquid markets on the funding
 * shelf (ETH, BTC, HYPE, SOL) are covered by that scan.
 *
 * Null is still the honest answer and must stay reachable: a book outside
 * that scan's shortlist, or one whose funding history has not been archived
 * yet, has no measurement and prints none.
 */
export function readingFor(
  books: PerpBookIndex | null | undefined,
  venueId: string,
  coin: string,
): PerpBookReading | null {
  if (!books || venueId !== MEASURED_PERP_VENUE_ID) return null;
  return books.get(coin) ?? null;
}

/**
 * Deposit dollars a lane at THIS escrow share can put behind the measured
 * book. The inverse of the division the scan stored, at the caller's own f_b.
 */
export function depositRoomUsd(reading: PerpBookReading, escrowShare: number): number | null {
  if (!Number.isFinite(escrowShare) || escrowShare <= 0) return null;
  return Math.floor(Number((reading.boundNotionalUsd / escrowShare).toPrecision(12)));
}
