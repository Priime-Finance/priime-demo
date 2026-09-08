/**
 * THE FUNDING VAULT'S RECORD — every lane it prices off, the venue it names,
 * the funding percentile per book, and the lane its capacity binds on (B5).
 *
 * ── THE DEFECT THIS CLOSES ──────────────────────────────────────────────
 * `publishFields` labels a lane row with the VENUE alone and puts the market
 * in the value: `{ label: "Hyperliquid", value: "ETH-USD · 65%" }`. The
 * seeded funding template is two Hyperliquid lanes (ETH 65% / HYPE 35%), so
 * both rows arrive at the record carrying the SAME label. `VaultDetail`'s
 * Parameters dedupe drops the second, and the record then shows one lane
 * while the capacity sentence underneath it names the book of the lane that
 * was dropped — the vault priced off a market the reader cannot see, and the
 * review sheet rendered two React children under one key on the way there.
 *
 * The lane's identity is `venue · market`, and the ` · ` is load-bearing:
 * `VaultDetail.isLaneRow` exempts a label carrying it from the family rule
 * and dedupes it on the exact full label, so two lanes on ONE venue both
 * survive publish. This module owns those strings.
 *
 * ── WHY IT IS HERE AND NOT IN THE COMPONENT ─────────────────────────────
 * A published record is the product's most durable claim, so the strings on
 * it must be assertable without a DOM. `FundingCanvas.tsx` is `.tsx` and
 * this repo's vitest config cannot import it. So the canvas holds no row
 * arithmetic at all: it calls `fundingRecordView` and hands the result to
 * `PublishFlow`.
 *
 * ── WHAT IT DELIBERATELY DOES NOT OWN ───────────────────────────────────
 * Every number and every unit still comes from its existing owner:
 * `publishFields` for the lead lane's dials, `marketFundingView` for the
 * funding percentile and its window (this file never spells the percentile),
 * `format.pct` for the weight, `portfolioEconomics` for the binding resource.
 * This file composes identities; it derives nothing.
 */

import { pct } from "./format";
import {
  fundingResourceKey,
  laneIdentity,
  laneShareLabels,
  marketFundingView,
  marketOf,
  publishFields,
  venueOf,
  type FundingLane,
  type FundingPortfolio,
  type PortfolioEconomics,
} from "./funding-demo";

export interface ParamRow {
  label: string;
  value: string;
}

/** The lanes a record is published from: a lane with no market is not one. */
export function seatedLanes(p: FundingPortfolio): FundingLane[] {
  return p.lanes.filter((l) => l.marketId !== "");
}

/** The venue's own label, or the lane's fallback name. */
function venueLabelOf(lane: FundingLane): string {
  return venueOf(lane.venueId)?.label ?? lane.label;
}

/** The market pair the lane trades, or an empty string when unseated. */
function pairOf(lane: FundingLane): string {
  return marketOf(lane.marketId)?.market.pair ?? "";
}

/**
 * `Hyperliquid · ETH-USD` — a lane's identity on a review sheet and on a
 * record, one spelling for both. The ` · ` is what makes the row survive the
 * record's dedupe beside a sibling lane on the same venue.
 */
export function laneRowLabel(lane: FundingLane): string {
  /* THE JOIN HAS ONE OWNER (recette 2026-08-27). `funding-demo.newLane` seeds
     a lane's DISPLAY name with the same identity, and the two used to spell
     the ` · ` separately. They stay two functions on purpose — this one
     re-derives on every read so a rename cannot move the record — but they
     agree on a fresh lane by construction now. */
  return laneIdentity(venueLabelOf(lane), pairOf(lane));
}

/**
 * `65% of capital` — the quantity IS the label's value, with no adjective
 * anywhere near it. The share is read off `allocationsBps`, the same field
 * the router and `portfolioEconomics` weight the lanes by, so the row cannot
 * disagree with the arithmetic that produced the APY.
 *
 * ⚠ ROUNDED BY THE VECTOR, NOT BY THE LANE (FUND-ROUTER-PERCENT-SUM). This
 * read `pct(bps / 10000, 0)` on its own lane — a FIFTH independent rounding
 * of a vector `normalizeAllocationsBps` had already rounded once — so a
 * three-lane record could publish rows summing to 99% of capital.
 * `laneShareLabels` is the one owner: largest remainder over the whole
 * vector, integers summing to exactly 100, the same string the router
 * control, the lane header, the router wire and the top-rail chip print.
 */
export function laneRowValue(p: FundingPortfolio, lane: FundingLane): string {
  return `${laneShareLabels(p)[lane.id] ?? pct(0, 0)} of capital`;
}

/** One row per lane the vault prices off, in lane order. */
export function fundingLaneRows(p: FundingPortfolio): ParamRow[] {
  return seatedLanes(p).map((l) => ({ label: laneRowLabel(l), value: laneRowValue(p, l) }));
}

/**
 * The DISTINCT venues the vault touches, in lane order.
 *
 * Two Hyperliquid lanes are one venue. Joining the lane list gave
 * `Hyperliquid + Hyperliquid`, and `store.venueParts` reads a `+` as the
 * signal that a record spans venues — so the seeded two-lane funding vault
 * published `Chain: Cross-venue` for a position that never leaves
 * Hyperliquid L1. The identity is the venue ID, never a string join.
 */
export function distinctVenueLabels(p: FundingPortfolio): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of seatedLanes(p)) {
    if (seen.has(l.venueId)) continue;
    seen.add(l.venueId);
    out.push(venueLabelOf(l));
  }
  return out;
}

/**
 * The record's `Venue` field. One venue prints its own name, which
 * `venueParts` then resolves to `Hyperliquid L1`. Genuinely cross-venue
 * vaults keep the `+` join, which is the signal that resolves to
 * `Cross-venue` — correctly, in that case.
 */
export function fundingVenueField(p: FundingPortfolio): string {
  const labels = distinctVenueLabels(p);
  return labels.length > 0 ? labels.join(" + ") : "Perp venues";
}

/**
 * The review sheet's one-line summary, over the distinct venues.
 *
 * ⚠ `guard armed` DIED HERE (recette 2026-08-27), and this was the worst of
 * its three homes because it is the PUBLISHED RECORD. The record this sentence
 * heads chips `Incubating · modeled` and states, a screen away, `No capital,
 * no armed automation` — one lifecycle, two claims, one scroll apart, and this
 * was the half that was wrong. The whole rack's arming state reads
 * `Automations compile in shadow · not armed`; nothing here is armed.
 *
 * The two branches now describe the same KIND of thing: a composition and the
 * mechanism it runs on, present tense about the DESIGN and silent about
 * execution. The multi-lane branch always did (`router follows the funding`),
 * which is why it needed no edit.
 */
export function fundingSummary(p: FundingPortfolio): string {
  const lanes = seatedLanes(p);
  const labels = distinctVenueLabels(p);
  if (lanes.length === 1) {
    return `Spot long, perp short on ${labels[0] ?? "the venue"}, funding collected, guard set at the lane's floor.`;
  }
  return `Delta-neutral basis across ${labels.join(", ")}, router follows the funding.`;
}

/**
 * `2 lanes` / `1 lane` — the count under a portfolio number, in the noun the
 * number is actually about.
 *
 * The header strip and the portfolio dock both counted `portfolio.lanes` and
 * spelled the noun `venues`, so the seeded two-lane vault — both lanes on
 * Hyperliquid — printed `2 venues` under a capacity that is one book's depth,
 * beside a router card that had it right at `2 lanes`. A count is a claim: if
 * a surface wants a venue count it must dedupe by venue id
 * (`distinctVenueLabels`), and if it is counting lanes it must say lanes.
 */
export function laneCountLabel(n: number): string {
  return `${n} lane${n === 1 ? "" : "s"}`;
}

/**
 * ONE FUNDING PERCENTILE PER BOOK, with the window it is published over.
 *
 * `fundingResourceKey(venueId, coin)` is the book's identity — the same key
 * `portfolioEconomics` groups capacity by — and `perpBookIndex` is keyed by
 * coin, so every lane on one book is priced on one reading by construction.
 * This states that once per book instead of once per lane, so a record can
 * never print two percentiles for one book, and it prints the window beside
 * the rate (`p25 10.2% over 30d`) because a percentile with no window is not
 * a measurement anyone can check.
 *
 * The rate and its window are composed by `marketFundingView`, the sole
 * accessor. This file never holds the scalar.
 */
export function fundingBookRows(p: FundingPortfolio, econ: PortfolioEconomics): ParamRow[] {
  /* ONE COIN ON TWO VENUES IS TWO BOOKS, AND TWO ROWS NEED TWO LABELS. The
     book key is venue-qualified, so ETH on Hyperliquid beside ETH on Aster
     emits two rows — but `Funding · ETH` named them identically, and the
     record's exact-label dedupe (`VaultDetail.isLaneRow`) drops the second:
     the reader sees one percentile where the vault prices off two. The venue
     joins the label exactly when the portfolio holds that coin on 2+ venues;
     the common single-venue record keeps its shorter spelling. */
  const venuesByCoin = new Map<string, Set<string>>();
  for (const lane of seatedLanes(p)) {
    const coin = marketOf(lane.marketId)?.market.coin;
    if (!coin) continue;
    const set = venuesByCoin.get(coin) ?? new Set<string>();
    set.add(lane.venueId);
    venuesByCoin.set(coin, set);
  }
  const seen = new Set<string>();
  const out: ParamRow[] = [];
  for (const lane of seatedLanes(p)) {
    const hit = marketOf(lane.marketId);
    if (!hit) continue;
    const key = fundingResourceKey(lane.venueId, hit.market.coin);
    if (seen.has(key)) continue;
    seen.add(key);
    const crossVenue = (venuesByCoin.get(hit.market.coin)?.size ?? 0) > 1;
    out.push({
      label: crossVenue
        ? `Funding · ${hit.market.coin} · ${venueLabelOf(lane)}`
        : `Funding · ${hit.market.coin}`,
      value: marketFundingView(hit.market, econ.perLane[lane.id]).p25Labelled,
    });
  }
  return out;
}

/**
 * The lane the vault's capacity is priced off.
 *
 * `vaultCapacity` returns the tightest RESOURCE, so the number on the record
 * belongs to one book and the lanes that draw on it — not to the vault's
 * largest lane and not to a sum. `portfolioEconomics.capacityKey` is that
 * resource's key; the lanes reporting it are the binding lanes, and naming
 * them is what lets a reader find, on the same page, the market the capacity
 * came from. Null when no lane states a capacity, which is when the vault
 * publishes no capacity either.
 */
export function bindingLaneLabels(p: FundingPortfolio, econ: PortfolioEconomics): string[] {
  if (!econ.capacityKey) return [];
  return seatedLanes(p)
    .filter((l) => econ.perLane[l.id]?.capacityKey === econ.capacityKey)
    .map((l) => laneRowLabel(l));
}

/**
 * `publishFields` emits its lane rows FIRST, one per seated lane in lane
 * order, then the lead lane's dials. This drops exactly those lane rows and
 * keeps the dials, matching on the strings `publishFields` actually produced
 * rather than on a count — so a shape change there leaves the dial rows
 * intact and fails `funding-lane-rows.test.ts` loudly instead of silently
 * publishing a mislabelled record.
 */
function legacyLaneRowValue(p: FundingPortfolio, lane: FundingLane): string {
  return `${pairOf(lane)} · ${pct((p.allocationsBps[lane.id] ?? 0) / 10000, 0)}`;
}

export function dialRows(p: FundingPortfolio, params: readonly ParamRow[]): ParamRow[] {
  const lanes = seatedLanes(p);
  const legacy = new Set(lanes.map((l) => `${venueLabelOf(l)} ${legacyLaneRowValue(p, l)}`));
  let i = 0;
  while (i < lanes.length && i < params.length && legacy.has(`${params[i].label} ${params[i].value}`))
    i += 1;
  return params.slice(i);
}

export interface FundingRecordView {
  /** The record's Parameters, in reading order. */
  params: ParamRow[];
  /** The record's `Venue` field. */
  venue: string;
  /** The review sheet's summary line. */
  summary: string;
}

/**
 * The whole published shape, in reading order: which lanes, what each book's
 * funding is, how the lead lane is tuned, and which lane the capacity binds
 * on. One function, so the review sheet and the record are the same list.
 */
export function fundingRecordView(
  p: FundingPortfolio,
  econ: PortfolioEconomics,
): FundingRecordView {
  const pub = publishFields(p, econ);
  const binding = bindingLaneLabels(p, econ);
  return {
    params: [
      ...fundingLaneRows(p),
      ...fundingBookRows(p, econ),
      ...dialRows(p, pub.params),
      ...(binding.length > 0
        ? [{ label: "Capacity binding lane", value: binding.join(", ") }]
        : []),
    ],
    venue: fundingVenueField(p),
    summary: fundingSummary(p),
  };
}
