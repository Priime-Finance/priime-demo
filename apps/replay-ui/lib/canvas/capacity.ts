/**
 * Deposit capacity — the single source for the catalog filter, the composed
 * arithmetic, the formatter and the copy map (CAPACITY_SPEC §1).
 *
 * R0.1: every capacity figure on every surface comes out of THIS file,
 * reading the lane's REPRICED candidate (`laneComputed[].ok.candidate`),
 * never a raw catalog row. Two surfaces printing the same dollar must be
 * structurally incapable of printing different strings, which is why
 * `vaultCapacity` takes the lane inputs and does the per-lane rescale and
 * the resource grouping itself rather than trusting a caller to pre-compute.
 *
 * Nothing else in the feature computes capacity.
 *
 * ── f_b IS NOT DERIVED HERE (R5, 2026-08-22) ──────────────────────────────
 * This file used to divide by the flat `F_B = 0.75` while `hedge-econ.ts`
 * inverted 0.6742 out of the same lane's economics. One screen, one lane,
 * "25% escrowed" on the plate and "33% escrowed" in capacity: the exact
 * defect class the founder photographed, reintroduced by fixing only half of
 * it. Every f_b in this file now comes from `escrowShare`, the one accessor,
 * which reports which derivation it took.
 */

/* eslint-disable @typescript-eslint/non-nullable-type-assertion-style, @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/prefer-string-starts-ends-with --
 * Kit-verbatim file, ported from build.priime.finance eb6d33a. The findings
 * are the typed presets reading kit idioms; not rewriting kit logic to satisfy
 * lint, per the integration's own directive (the RackCanvas.tsx precedent). */

import { F_B } from "@/lib/model-constants";
import { escrowShare } from "./hedge-econ";
import type { LaneComposition } from "./mock-quote";
import { VENUE_LABELS, type ProjectedCandidate } from "./opportunities";
import { MIN_DEPOSIT_USD, PRODUCT_MIN_LEVERAGE } from "./param-schema";
import {
  COLLAR_CAPACITY_BINDING,
  DN_LP_DEFAULT_DIALS,
  DN_LP_MODEL,
  dnLpDeployedShare,
  handAuthoredTerms,
} from "./templates";

/**
 * The display floor: ONE minimum deposit, `param-schema`'s (B10).
 *
 * The floor is a statement about ABSORBABILITY — can this market take one
 * minimum deposit — not a re-run of the house `MIN_CAPACITY_USD` gate, which
 * would delete kHYPE/WHYPE, the market the live round trip was proven on.
 * So it is not merely CONSISTENT with the minimum deposit; it IS the minimum
 * deposit, and re-typing the number here is what let four of them coexist.
 * `minDepositUsd(bands, f_b)` can only raise the floor above this, and a
 * market that cannot absorb the base floor cannot absorb a raised one either,
 * so this stays the catalog-side gate.
 *
 * LEVERAGE INVARIANCE: all four capacity bounds are non-negative numerators
 * over strictly positive functions of L, so a zero is leverage-invariant, and
 * `repriceAtLeverage` caps L at the scan's own L0 — the WORST case for the
 * two L-dependent bounds (debt borrow ∝ 1/(L−1), collateral cap ∝ 1/L).
 * So the predicate is evaluated ONCE, at catalog L0. It never needs
 * re-running on a dial move and it never flickers.
 *
 * COMPOSITION INVARIANCE holds for the same reason: the composition enters
 * capacity only as the strictly positive multiplier `stated/running` below,
 * so it cannot turn a positive capacity into a zero or a zero into a
 * positive. The gate is safe to evaluate on the raw catalog row.
 */
export const MIN_VIABLE_CAPACITY_USD = MIN_DEPOSIT_USD;

export function acceptsDeposits(c: ProjectedCandidate | null | undefined): boolean {
  const v = c?.economics?.capacityUsd;
  // The typeof guard is load-bearing: it sweeps the rows shipping
  // `economics: null`, which carry neither an APY nor a capacity.
  return typeof v === "number" && Number.isFinite(v) && v >= MIN_VIABLE_CAPACITY_USD;
}

/** The scan's HL-side bindings — leverage-independent, and venue-independent. */
const HL_BINDINGS: ReadonlySet<string> = new Set(["HL book depth", "HL OI", "HL open interest"]);

/** The dn-LP family's binding, as `templates.ts` writes it. Named here because
 *  `capacityBindingLabel` has to turn it into a noun and a raw key is not one. */
const POOL_RANGE_BINDING = "share of pool liquidity in range";

/**
 * The f_b every stored HL bound is denominated in.
 *
 * `simulate.ts:210-211` and `simulate-v2.ts:248-249` state capC (OI) and capD
 * (book depth) as `bound_notional / F_B`, converting a SHORT NOTIONAL limit
 * into deposit dollars: net delta on a class-A lane is 1.0x of equity and
 * equity is `f_b · deposit`, so short notional per deposited dollar is f_b —
 * with no L in it, which is why the HL bounds are leverage-independent and
 * must never be rescaled with the risk dial.
 *
 * `repriceAtLeverage` deliberately leaves the two HL bounds untouched, so a
 * REPRICED candidate carries its venue-side bound at the lane's f_b and its
 * HL bound still at this constant. That asymmetry is a fact about the
 * pipeline, not an assumption: `laneCapacityUsd` reads the stated basis per
 * binding rather than assuming one for the whole row.
 */
const SCAN_FB = F_B;

/**
 * Kill float noise before flooring. `capacityUsd` is an integer and the
 * rescale multiplier is frequently an exact ratio (0.75, or f_b/f_b = 1), so
 * a product that is mathematically an integer can land 1e-11 below it and
 * floor a whole dollar down. Twelve significant digits is far past anything
 * a book-depth snapshot means and far short of the noise.
 */
function floorUsd(v: number): number {
  return Math.floor(Number(v.toPrecision(12)));
}

/**
 * The f_b a STORED venue-side capacity was divided by, recovered exactly.
 *
 * `escrowShare`'s row path inverts f_b out of `netApyOnDepositApy /
 * netCarryOnEquityApy`, and the catalog projection ROUNDS both of those to
 * six decimals (`opportunities.ts:114`). On a raw scan row the inversion
 * therefore returns 0.7499958 where the scan actually divided by exactly
 * `F_B` — 4.2e-6 of error, economically nothing, but enough to floor a whole
 * dollar off a capacity whose true product lands on an integer (ezETH/wstETH:
 * $7,791 becomes $7,790). A REPRICED row's rates are not re-rounded and
 * invert exactly, so this correction is needed for exactly one value: the
 * scan's own constant.
 *
 * This is NOT a second derivation of f_b — `escrowShare` remains the only
 * one, and its result is what is returned in every other case. It is the
 * recovery of an exact DIVISOR from a rounded quotient, and it may only fire
 * inside the error that rounding can itself produce:
 *
 *   |Δf_b| ≤ (δA + f_b·δC) / |C|,  δ = 5e-7  ⇒  1.5e-5 at the live rates
 *
 * The composed f_b sits 0.0758 away from `SCAN_FB`, five thousand times that
 * bound, so this can never mistake one for the other. It is also inert on the
 * `composition` path, which is exact by construction.
 */
function statedFb(c: ProjectedCandidate): number | null {
  const share = escrowShare(c);
  if (!share || !isPositive(share.fb)) return null;
  if (share.source !== "row") return share.fb;
  const netCarry = c.economics?.netCarryOnEquityApy;
  if (!isPositive(Math.abs(netCarry ?? 0))) return share.fb;
  const tol = (5e-7 * (1 + share.fb)) / Math.abs(netCarry as number);
  return Math.abs(share.fb - SCAN_FB) <= tol ? SCAN_FB : share.fb;
}

/**
 * Whether this lane actually holds a perp short right now. A class-A row
 * whose hedge module has been ejected does not, and a class-N1 row never did.
 * The single predicate behind the resource key, the label and the rescale, so
 * those three can never disagree about it (B5/B6 were three call sites each
 * deciding separately).
 */
function hasShortLeg(c: ProjectedCandidate, hasHedge: boolean): boolean {
  return c.cls === "A" && hasHedge;
}

/**
 * The venue-local resource a lane draws on. Borrow and collateral bounds are
 * venue-local, so they key by venue + symbol; the perp book is not (see
 * `PERP_BOOK_KEY`).
 *
 * B6: a lane with NO SHORT LEG may not key to a perp book. Charging weight to
 * a book it does not touch understated a hedged + hedge-ejected ETH pair's
 * vault capacity by 2.0x — the two lanes were made to share one resource that
 * only one of them uses. Such a lane re-keys to the venue-local collateral
 * pool, which is the resource it certainly DOES draw on. We cannot say which
 * venue-side bound would bind instead (the scan reports only the winner), and
 * the conservative read is that it shares with any genuinely
 * collateral-bound lane on the same venue and symbol.
 */
function venueLocalKey(c: ProjectedCandidate): string {
  const b = c.economics?.capacityBinding ?? "";
  const base =
    b === "debt borrow liquidity"
      ? `${c.venue}:borrow:${c.debtSymbol}`
      : `${c.venue}:collat:${c.collateralSymbol}`;
  /* C-H4 (recette F7, quant W2-01): an ISOLATED-market venue's markets each
     carry their own lender book, so two markets borrowing the same symbol
     share nothing. The payload states the isolation: every Morpho Blue
     candidate id ends in the MARKET's own key, and two rows share a book
     only when that key is the same. Pooled venues keep the venue+symbol key
     unchanged. This is the ONE owner of the keying rule — the card grouping
     (`cardResourceKey` in unified-list.ts) is an alias of the derivation. */
  if (!ISOLATED_MARKET_VENUES.test(c.venue)) return base;
  const marketId = c.id.split(":").pop() || c.pair;
  return `${base}:${marketId}`;
}

/** Venues whose markets are isolated lender books (see `venueLocalKey`). */
const ISOLATED_MARKET_VENUES = /^morpho-blue-/;

/**
 * THE PERP BOOK IS THE COIN, NOT THE LIMIT THAT WAS MEASURED (P0-10).
 *
 * The key used to embed the binding NAME — `hl:HL book depth:ETH`,
 * `hl:HL OI:ETH`, `hl:HL open interest:ETH` — so ONE ETH book wore three
 * group identities and a vault holding a depth-bound lane beside an OI-bound
 * lane split them into two pools and printed the sum of a resource it holds
 * once. Every fixture row binds on depth, so it never bit; one row binding on
 * OI is all it takes. The hlCoin IS the resource; which limit the scan
 * happened to measure is a fact about the measurement and belongs on the
 * label (`capacityBindingLabel`), never in the identity.
 *
 * The venue stays out for the same reason: the ETH perp book is one book
 * whether the collateral leg sits on Aave Base or Morpho Base.
 */
function perpBookKey(c: ProjectedCandidate): string {
  return `hl:${c.hlCoin ?? "?"}`;
}

/**
 * The short notional a lane puts on the perp book per DEPOSITED dollar, or
 * null when it holds no short or the share cannot be derived.
 *
 * ── WHY THIS IS f_b, AND WHY IT MUST BE THE SAME f_b `laneCapacityUsd` USED ─
 * Net delta on a class-A loop lane is 1.0x of equity and equity is
 * `f_b · deposit`, so short notional per deposited dollar is exactly f_b —
 * which is why the scan states its two HL bounds as `bound_notional / F_B`
 * and why they carry no L.
 *
 * The pairing is load-bearing. `laneCapacityUsd` converts the stored bound
 * into deposit dollars by dividing the notional by `running`; this function
 * multiplies deposit dollars back into notional. Read a DIFFERENT f_b here
 * and the round trip stops closing: the group would recover
 * `bound_notional · (usage / running)` and mis-state a book nobody re-measured
 * — 10.1% low if usage took the composed 0.6742 while `running` took the
 * scan's 0.75. So this reads `escrowShare(c, comp)`, the one accessor, with
 * the same `comp` the capacity was stated at, and nothing else. (R5.)
 *
 * ── THE DELTA-NEUTRAL LP IS THE EXCEPTION, AND IT IS NOT AN EXCEPTION TO f_b ─
 * An LP is HALF exposed at the center, so its short is `lpDeltaShare` of the
 * deployed position rather than all of it: `deployed · 0.5` per deposited
 * dollar against a loop lane's `f_b · 1`. `escrowShare` short-circuits every
 * template venue to `fb: 1` (right for the collar, which has no perp leg at
 * all), so the dn-LP's own owner answers instead — `dnLpDeployedShare` and
 * `DN_LP_MODEL.lpDeltaShare`, at the lane's own hedge dials, which are the
 * same two dials the row was priced at. No arithmetic is re-typed here.
 */
function shortNotionalPerDollar(
  c: ProjectedCandidate,
  hasHedge: boolean,
  comp?: LaneComposition | null,
): number | null {
  if (!hasShortLeg(c, hasHedge)) return null;
  const terms = handAuthoredTerms(c);
  if (terms) {
    if (terms.family !== "dn-lp") return null;
    const lh = comp?.hedge?.hedgeLeverage ?? DN_LP_DEFAULT_DIALS.hedgeLeverage;
    const r = comp?.hedge?.reserveFraction ?? DN_LP_DEFAULT_DIALS.reserveFraction;
    const u = dnLpDeployedShare(lh, r) * DN_LP_MODEL.lpDeltaShare;
    return isPositive(u) ? u : null;
  }
  const share = escrowShare(c, comp);
  return share && isPositive(share.fb) ? share.fb : null;
}

/**
 * EVERY resource a lane draws on, with what it consumes and what it can prove
 * about the pool (§6 D-CAPACITY).
 *
 * `capacityResourceKey` keyed a lane to the ONE bound the scan reported as
 * binding, so every other pool the lane touches was invisible. Inside the
 * loop family that happened to be harmless — one short, one venue leg, one
 * key each. It stops being harmless the moment a vault holds two FAMILIES:
 * a delta-neutral LP lane holds an LP position AND an ETH perp short, reports
 * only the LP bound, and is therefore free to share a book with a loop lane
 * without either of them charging the other. Capacity is a shared-resource
 * MINIMUM, never a sum, and a membership nobody records is a sum.
 *
 * Two things a reader must not conflate:
 *
 *   · `usagePerDollar` is what the lane CONSUMES of that pool per deposited
 *     dollar. Only RATIOS between members matter — the absolute unit cancels
 *     against the reporting lane's own bound — so it is stated in whatever
 *     unit the resource's bound is denominated in.
 *   · `boundUsd` is what the lane can PROVE about the pool: deposit dollars
 *     this lane alone could take before exhausting it, or null when the scan
 *     never measured that pool. A group nobody measured constrains nothing;
 *     it is not treated as a zero.
 *
 * The scan reports only the WINNING bound, so a lane's venue-local
 * memberships beyond its own binding are not recorded here: we know a loop
 * lane draws on both a borrow pool and a supply cap, but we cannot state
 * either usage against a bound nobody measured. That is P2-4's ticket
 * (`capacityBounds`), and it is why this function returns a list rather than
 * the key it replaces.
 */
export interface LaneResource {
  /** The shared pool. Lanes sharing a key draw on ONE pool (§1.4). */
  key: string;
  /** What one deposited dollar of this lane consumes of it. */
  usagePerDollar: number;
  /** Deposit dollars this lane alone could take from it, or null when the
   *  scan never measured this pool. */
  boundUsd: number | null;
}

export function laneResources(
  c: ProjectedCandidate,
  hasHedge = true,
  comp?: LaneComposition | null,
): LaneResource[] {
  const b = c.economics?.capacityBinding ?? "";
  const short = shortNotionalPerDollar(c, hasHedge, comp);
  const bound = laneCapacityUsd(c, hasHedge, comp);

  // The lane's binding — the one pool it can prove a number about. A perp
  // book only when the lane actually holds the short (B6); otherwise the
  // bound is carried on the venue-local pool it certainly does draw on.
  // `short ?? 1` is inert: an underivable f_b is an underivable capacity, so
  // that group carries no bound to weigh anything against.
  if (HL_BINDINGS.has(b) && hasShortLeg(c, hasHedge)) {
    return [{ key: perpBookKey(c), usagePerDollar: short ?? 1, boundUsd: bound }];
  }
  const out: LaneResource[] = [{ key: venueLocalKey(c), usagePerDollar: 1, boundUsd: bound }];
  // …and the book it holds a short on but was not bound by. No number, real
  // membership: it charges weight to whichever lane DID measure that book.
  if (short !== null && c.hlCoin) {
    out.push({ key: perpBookKey(c), usagePerDollar: short, boundUsd: null });
  }
  return out;
}

/**
 * The one pool a lane reports its bound on — the group its capacity FIGURE
 * belongs to.
 *
 * DEPRECATED, and it is a lossy view: a lane draws on more pools than the one
 * the scan reported as binding, and `laneResources` is the whole answer. It
 * survives because three call sites outside this file read a single string
 * (`unified-list.ts:179, 228, 267, 360` for the catalog ledger, `tips.ts:1019`
 * for the shared-book clause), all of which are asking exactly this narrower
 * question. Re-point them at `laneResources` and delete this.
 *
 * ONE OWNER: derived from `laneResources`, never a second copy of the keying
 * rules. That is what makes the three-spellings collapse impossible to
 * half-apply.
 */
export function capacityResourceKey(c: ProjectedCandidate, hasHedge = true): string {
  const res = laneResources(c, hasHedge);
  return (res.find((r) => r.boundUsd !== null) ?? res[0]).key;
}

/**
 * One lane's capacity, COMPOSITION-AWARE.
 *
 * Every bound the scan reports has the shape `numerator / (k(L) · f_b)`, so a
 * stored figure is deposit dollars AT SOME f_b and converts to any other by
 * one multiply:
 *
 *   capacity_at(running) = capacityUsd · stated / running
 *
 * `stated` is the f_b the stored number is denominated in — the scan's
 * constant for an HL bound, the row's own implied ratio for a venue-side
 * bound, since `repriceAtLeverage` re-divides those by the lane's f_b using
 * the same value it multiplies the APY by. `running` is the f_b the lane
 * actually operates at: the composed `fB(L_h, r)` when the hedge is
 * installed, and exactly 1 when it is not, because with no perp margin and no
 * reserve every deposited dollar reaches the loop.
 *
 * THE COUNTERINTUITIVE PART, which is why it is modelled and not assumed:
 * EJECTING THE HEDGE SHRINKS CAPACITY. `running` rises to 1, the multiplier
 * falls to `stated`, and each deposited dollar now lands on the venue whole
 * instead of two thirds of it, so the borrow pool and the supply cap bind
 * that much sooner. At the flat 0.75 that was 25% sooner; at the shipped
 * composition (f_b 0.6742) it is 32.6%. Omitting the rescale overstates an
 * unhedged venue-bound lane by 48%.
 *
 * The HL bound on a hedge-EJECTED lane stops applying entirely — there is no
 * short. The scan reports only the ONE winning bound, so we carry the HL
 * number through unrescaled as a conservative LOWER bound rather than
 * advertise a venue-side headroom nobody measured. Do not "fix" this by
 * dropping it. P2 ticket: have the scanner emit every bound
 * (`capacityBounds`) so this can re-bind to the next real one. The KEY still
 * moves off the perp book (B6) — carrying a number is not the same claim as
 * charging weight to a resource.
 */
export function laneCapacityUsd(
  c: ProjectedCandidate | null | undefined,
  hasHedge: boolean,
  comp?: LaneComposition | null,
): number | null {
  const e = c?.economics;
  if (!c || !e || !Number.isFinite(e.capacityUsd)) return null;
  // A class-N1 row is priced at f_b = 1 on both sides of the conversion, and
  // a zero is invariant under any positive multiplier. Neither needs one.
  if (c.cls !== "A" || e.capacityUsd <= 0) return floorUsd(e.capacityUsd);

  const hl = HL_BINDINGS.has(e.capacityBinding);
  if (hl && !hasShortLeg(c, hasHedge)) {
    /* FUNDING-CLASS ROWS ARE NOT HEDGE-EJECTED LOOPS (cleanup 2026-08-24, I6).
       The unrescaled carry-through below exists for a lending lane whose hedge
       was ejected: a real lane shape with unmeasured venue bounds, where the
       stored HL number is a conservative lower bound. A funding-class row
       (`lt === null` — borrowsNothing) has no venue-side bound at all: the
       book IS the only measured limit and the launch shape always carries the
       short, so "no hedge yet" is a transient composition state, not a lane
       shape. Returning the stored figure there printed the SCAN's 0.75-frame
       number under the same "capacity" noun the card states in the lane frame
       — $10.5K on the compose panel beside $11.6K on the kHYPE card, one
       book, ratio F_B/f_b. One quantity, one number: state the book's room at
       the composition the lane prices at, exactly as the committed lane and
       the catalog card do. */
    if (c.lt === null && !handAuthoredTerms(c)) {
      const running = escrowShare(c, comp)?.fb;
      if (!isPositive(running)) return null;
      return floorUsd(e.capacityUsd * (SCAN_FB / running));
    }
    return floorUsd(e.capacityUsd);
  }

  const stated = hl ? SCAN_FB : statedFb(c);
  const running = hasShortLeg(c, hasHedge) ? escrowShare(c, comp)?.fb : 1;
  // NULL DISCIPLINE: an f_b this file cannot derive is a capacity it cannot
  // state. Partial is a lie, so partial returns nothing.
  if (!isPositive(stated) || !isPositive(running)) return null;
  return floorUsd(e.capacityUsd * (stated / running));
}

function isPositive(v: number | undefined | null): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

export interface CapacityLane {
  /** The lane's REPRICED candidate (`reprice.ok.candidate`), never the raw row. */
  candidate: ProjectedCandidate | null | undefined;
  /** Whether a hedge module is installed on this lane right now. */
  hasHedge: boolean;
  /** The lane's target share; weights normalize across the passed lanes. */
  allocationBps: number;
  /**
   * The lane's composition (`pricingParamsFor(loop)`), so the four bounds
   * move with the hedge dials. Omitted, the lane's own implied f_b is used
   * and capacity is stated exactly as the row was priced.
   */
  comp?: LaneComposition | null;
}

export interface VaultCapacity {
  usd: number;
  /** The binding resource key (`laneResources`). */
  key: string;
  /**
   * How many lanes DRAW ON that one resource — real membership, not how many
   * reported a bound against it. A delta-neutral LP lane bound by its pool
   * still shorts the ETH book, so it counts on the book too; that is the
   * whole point of the group and the sentence beneath it.
   */
  sharedCount: number;
  /** A representative candidate from the binding group, for the label. */
  cand: ProjectedCandidate;
  /** Whether that representative lane holds a short leg — the label needs it. */
  hasHedge: boolean;
}

/**
 * The whole vault's deposit capacity (§1.4).
 *
 *   D_vault = min over resource groups g of [ R_g / Σ_{i∈g} w_i · u_i ]
 *
 * Usages ADD within a shared resource; the tightest resource binds. Two
 * lanes shorting the same ETH perp book draw on ONE book, so neither
 * `Σ capacityUsd` nor `min(C_i / w_i)` is the answer — both overstate a
 * two-lane Morpho-Base vault by 2.00x on live data.
 *
 * P0-10 changed MEMBERSHIP and WEIGHTS, not the formula. A lane now enters
 * every group it touches (`laneResources`) rather than only the one the scan
 * reported as binding, and it enters each one at what it actually consumes
 * there (`u_i`) rather than at a flat 1. Inside one family those two were the
 * same thing — one short and one venue leg per lane, all shorts of the same
 * shape. Across families they are not: a delta-neutral LP lane bound by its
 * pool ALSO shorts the ETH book, at 0.62 of a loop lane's notional per
 * deposited dollar, and used to charge that book nothing at all.
 *
 * WHY MIN WITHIN A GROUP: the live payload quotes the same ETH book at two
 * different sizes from two scans seconds apart (the Aave scan and the Morpho
 * scan disagree). Book depth does not move that far in six seconds. Until the
 * scanners are reconciled (P2 ticket) the fail-safe read is the minimum.
 *
 * A GROUP NOBODY MEASURED CONSTRAINS NOTHING. `R_g` comes from the members
 * that carry a bound; a group holding only usages is skipped rather than
 * treated as a zero, because "we did not measure this book" is not "this book
 * is empty". It still counts in `sharedCount` for the group it does bind.
 *
 * DEGENERACY: one lane at weight 1 returns exactly its own capacity — the
 * `u_i` cancels against its own bound — so one formula answers both halves of
 * the question with no branch.
 *
 * ── THE PORTFOLIO BINDING, STATED (B5, 2026-08-24) ──────────────────────
 * When no two lanes share a resource, every group holds exactly one member,
 * `R_g = C_i · u_i` and `Σ w u = w_i · u_i`, so the `u_i` cancels and the
 * formula above reduces exactly to
 *
 *     portfolioCapacity = min over lanes i of [ laneCapacityUsd(lane_i) / w_i ]
 *
 * which is the identity a two-book funding vault is priced by. It is a
 * reduction of the general form, NOT a second formula: the general form is
 * what must run, because the moment two lanes DO share a book (two lanes on
 * one coin, or an LP lane shorting the same perp a loop lane shorts) their
 * usages add inside one group and `min(C_i / w_i)` overstates the vault by
 * the number of lanes sharing it. Capacity is a shared-resource minimum,
 * never a sum, and never a per-lane minimum that forgets the sharing.
 *
 * The tightest group is a fact about ONE resource and the lanes that draw on
 * it, so the returned `cand` names the lane whose bound binds — see
 * `bindingLaneId`. A record that prints the number without naming that lane
 * sends a reader looking for a market that may not be the largest lane on the
 * page, which is exactly what the two-lane funding record used to do.
 *
 * NULL DISCIPLINE mirrors `portfolioApy`: partial is a lie, so partial
 * returns nothing.
 */
export function vaultCapacity(lanes: CapacityLane[]): VaultCapacity | null {
  const active = lanes.filter((l) => Number.isFinite(l.allocationBps) && l.allocationBps > 0);
  if (active.length === 0) return null;
  const totalBps = active.reduce((s, l) => s + l.allocationBps, 0);
  if (!(totalBps > 0)) return null;

  const groups = new Map<
    string,
    { r: number | null; w: number; n: number; cand: ProjectedCandidate; hasHedge: boolean }
  >();
  for (const l of active) {
    const cand = l.candidate;
    if (!cand) return null;
    const usd = laneCapacityUsd(cand, l.hasHedge, l.comp);
    if (usd === null || !Number.isFinite(usd) || usd <= 0) return null;
    const w = l.allocationBps / totalBps;
    for (const res of laneResources(cand, l.hasHedge, l.comp)) {
      if (!isPositive(res.usagePerDollar)) continue;
      const g = groups.get(res.key) ?? { r: null, w: 0, n: 0, cand, hasHedge: l.hasHedge };
      g.w += w * res.usagePerDollar;
      g.n += 1;
      if (isPositive(res.boundUsd)) {
        // The pool's own size, recovered from the one lane that measured it:
        // deposit dollars back into resource units by that lane's own usage.
        const pool = res.boundUsd * res.usagePerDollar;
        // The representative follows the number: a group's label must describe
        // the lane whose bound actually binds, not whichever arrived first.
        if (g.r === null || pool < g.r) {
          g.r = pool;
          g.cand = cand;
          g.hasHedge = l.hasHedge;
        }
      }
      groups.set(res.key, g);
    }
  }

  let best: VaultCapacity | null = null;
  for (const [key, g] of groups) {
    if (g.r === null || !(g.w > 0)) continue;
    const usd = g.r / g.w;
    if (best === null || usd < best.usd)
      best = { usd, key, sharedCount: g.n, cand: g.cand, hasHedge: g.hasHedge };
  }
  return best === null ? null : { ...best, usd: floorUsd(best.usd) };
}

/**
 * The LANE the vault's capacity binds on (B5).
 *
 * `vaultCapacity` already picks its representative by following the tightest
 * pool rather than whichever lane arrived first, so the answer is simply that
 * candidate's id — the funding canvas seats its own `lane.id` there, the rack
 * seats the catalog row id. It is exported as a named accessor so a record
 * that prints the capacity can name the lane it came from through the same
 * owner, instead of a surface reaching into `cand` and deciding for itself
 * which field identifies a lane.
 */
export function bindingLaneId(cap: VaultCapacity | null | undefined): string | null {
  const id = cap?.cand?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/* `fmtCapacityUsd` MOVED to `./format.ts` and is RE-EXPORTED here, so every
   consumer keeps its import path (2026-09-07, F6's fix at its owner).
   `rule-schema.ts` imported this module for that one formatter, and this
   module reaches `./templates` -> `./graph-ops` -> `./orchestrator` (index),
   whose module body calls back into `rule-schema`. Entering `rule-schema`
   first therefore threw "Cannot access 'CONCENTRATION_BASE_FLOOR_PCT' before
   initialization" at load time, which is a route that throws at runtime rather
   than at build. `format.ts` has no imports at all, so moving the formatter
   there cuts the cycle at its only real edge and costs no caller anything. */
export { fmtCapacityUsd } from "./format";

/**
 * What the capacity is limited BY, in nouns. Never a warning, never a verb.
 *
 * B5: composition-aware. A hedge-ejected class-A lane printed "limited by the
 * ETH perp book" on the lane line and in Review — for a lane with no perp leg
 * — on 12 of 23 priced rows. Such a lane names the venue-local market it does
 * touch instead. It deliberately does NOT name a specific venue-side bound:
 * the scan reported the HL one as the winner and never priced the others, so
 * "the WETH supply cap" would be a measurement we do not have.
 */
export function capacityBindingLabel(
  c: ProjectedCandidate | null | undefined,
  hasHedge = true,
): string {
  const b = c?.economics?.capacityBinding ?? "";
  const coin = c?.hlCoin ?? "the perp";
  const venue = (c && VENUE_LABELS[c.venue]) || c?.venue || "the venue";
  let label: string;
  if (HL_BINDINGS.has(b) && c && !hasShortLeg(c, hasHedge))
    label = `the ${c.collateralSymbol} market on ${venue}`;
  else if (b === "HL book depth") label = `the ${coin} perp book`;
  else if (b === "HL OI" || b === "HL open interest") label = `${coin} perp open interest`;
  else if (
    b === "debt borrow liquidity" &&
    c &&
    (c.economics?.loopLeverage ?? 0) <= PRODUCT_MIN_LEVERAGE
  )
    // P-H1 (F8 label half): a 1.00x lane borrows nothing, so a borrow-pool
    // noun would name a bound the lane does not draw on. Same noun form as
    // the HL-eject branch above: the venue-local market the lane does touch.
    label = `the ${c.collateralSymbol} market on ${venue}`;
  else if (b === "debt borrow liquidity")
    label = `${c?.debtSymbol ?? "debt"} borrow liquidity on ${venue}`;
  else if (b === "collateral supply cap" || b === "collateral cap/concentration")
    label = `the ${c?.collateralSymbol ?? "collateral"} supply cap`;
  else if (b === POOL_RANGE_BINDING)
    /* A NOUN, BECAUSE THE SLOT IS A NOUN SLOT (2026-09-02). This binding had
       no branch, so it fell to the forward-compatible `label = b` case and the
       dn-LP register shipped the raw KEY inside a sentence: "The recenter
       crosses share of pool liquidity in range." — a template slot rendered
       without its article, live on `aerodrome-rangekeeper`. Every other
       binding here resolves to something you can put "crosses" in front of;
       this one now does too. */
    label = `the ${c?.pair ?? "pool"} pool's in-range liquidity`;
  else if (b === COLLAR_CAPACITY_BINDING)
    // QNT-3: `COLLAR_MODEL.optionOpenInterestUsd` is an assumed book, not a
    // scan reading, so the noun names its register wherever the $1M prints.
    label = `modeled ${b}`;
  else label = b; // forward-compatible: an unknown binding prints itself
  return label;
}

/**
 * True when this binding's dollar figure is a model ASSUMPTION rather than a
 * venue scan reading (QNT-3). Record surfaces that print the capacity number
 * without the binding sentence — the directory card, the capacity stat —
 * read this to put the word `modeled` beside the figure.
 */
export function isModeledBinding(b: string | null | undefined): boolean {
  return b === COLLAR_CAPACITY_BINDING || b === MODELED_CAPACITY_BINDING;
}

/**
 * The demo market's binding key (lib/demo/market.ts `capacityBinding`). It is
 * a register, not a venue noun: nothing on the venue binds the $10M, the
 * figure is typed. So it never enters the `limited by …` / `… in …` grammar
 * the venue bindings use; every surface prints the word `modeled` beside the
 * figure instead (docs/plans/LATEST_UI_PORT_SPEC.md E.3, E.7, 2.9).
 */
export const MODELED_CAPACITY_BINDING = "modeled";

/**
 * The Review sub-register. `shared by N loops` is the load-bearing clause:
 * it is the one-line answer to why the vault's capacity is not the sum.
 */
export function capacityBindingSentence(
  c: ProjectedCandidate | null | undefined,
  sharedCount = 1,
  hasHedge = true,
): string {
  if (c?.economics?.capacityBinding === MODELED_CAPACITY_BINDING) return MODELED_CAPACITY_BINDING;
  const label = capacityBindingLabel(c, hasHedge);
  if (!label) return "";
  return `limited by ${label}${sharedCount >= 2 ? `, shared by ${sharedCount} loops` : ""}`;
}

/** Three words, for a row that cannot take a deposit. Dead rows only. */
export function capacityReason(c: ProjectedCandidate | null | undefined): string {
  const e = c?.economics;
  if (!e) return "not priced";
  const b = e.capacityBinding ?? "";
  if (b.includes("borrow")) return "no borrow liquidity";
  if (b.includes("cap")) return "supply cap full";
  return "no capacity";
}
