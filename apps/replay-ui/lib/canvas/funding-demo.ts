/**
 * Funding-rate strategy demo model (/build?strategy=funding).
 *
 * The delta-neutral basis-trade builder: the same canvas grammar as the loop
 * builder (lanes of hardware plates wired into a vault, capital router across
 * lanes), applied to perp funding capture. One lane per perp venue; the
 * router aggregates capacity across venues.
 *
 * DEMO REGISTER: every number here is a modeled snapshot for the investor
 * walkthrough, labeled "modeled" on every surface. Nothing executes. The
 * module grammar (Perp market -> Basis engine -> Funding guard -> Auto
 * compound -> Vault) is the product spec; the numbers are illustrative.
 *
 * ── WHAT THIS FILE OWNS, AND WHAT IT BORROWS (recette item 16) ────────────
 *
 * It owns the funding data table and the basis-trade arithmetic. It borrows
 * EVERY primitive that already has an owner on the loop rack, because a
 * second opinion about the same quantity is exactly the defect class this
 * recette exists to kill:
 *
 *   · `fB(L_h, r)` (mock-quote) — the escrow share. The funding lane's spot
 *     long IS the hedged notional, so the share of a deposited dollar that
 *     reaches it is the rack's f_b, not a private `L/(L+1)`. The old model
 *     carried its own `spotShare · deployed` pair, which disagreed with the
 *     rack by 3.7pp at the shipped dials.
 *   · `compoundDelta(r, dials, tvl)` (mock-quote) — auto-compound's signed
 *     worth. The old model multiplied by a flat 1.015 and shrank a cost line
 *     by 30%, so `cadence` and `minActionUsd` were both dead knobs (F10).
 *   · `vaultCapacity` (capacity.ts) — the shared-resource minimum. The old
 *     model SUMMED lane capacities and printed $84.8M for a portfolio whose
 *     tightest shared resource is $18.6M (F2).
 *   · `MODULE_DEFS` (modules.ts) — every param bound. The guard floor's dial
 *     ran [0, 0.08] while its own preset sat at −0.02, and the margin reserve
 *     ran [0.05, 0.40] against the rack's [0.15, 0.30] for the same
 *     quantity (F9). Nothing here types a bound.
 *   · `fmtCapacityUsd` (capacity.ts) — the one usd magnitude formatter.
 *
 * ── THE ONE MIRROR, AND WHY (handoff) ─────────────────────────────────────
 * `vaultCapacity` is typed on `ProjectedCandidate`, a lending-scan row that a
 * perp venue is not. Rather than restate its group-minimum arithmetic here,
 * `capacityLaneOf` encodes a funding lane AS a class-N1 candidate whose
 * resource key is `fundingResourceKey`, so the arithmetic still has exactly
 * one owner. The encoding depends on two facts about capacity.ts — a class-N1
 * row returns its capacity unrescaled, and a non-HL binding keys as
 * `${venue}:collat:${collateralSymbol}` — and `__tests__/funding-demo.test.ts`
 * carries canaries that fail loudly if either changes. P2 ticket: lift the
 * grouping out of `vaultCapacity` into a `resourceMinimum(items)` primitive
 * both canvases call directly, and delete the encoding.
 */

import { EXEC_DRAG_UNHEDGED } from "@/lib/model-constants";
import { fmtCapacityUsd, vaultCapacity, type CapacityLane } from "./capacity";
import { applyComputeFee } from "./fees";
import { lev, pct } from "./format";
import { compoundDelta, execDragFor, fB } from "./mock-quote";
import { MODULE_DEFS } from "./modules";
// D10's owner. The printed shares are rounded ONCE, by largest remainder, by
// the same function the loop rack's orchestrator prints its shares with.
import { allocationPercents } from "./orchestrator";
import type { CanvasVenueId, ProjectedCandidate } from "./opportunities";
import { shortLegIndexFromPrompt, VENUE_STOPWORDS } from "./prompt-vocabulary";
import { MEASURED_PERP_VENUE_ID, depositRoomUsd, readingFor, type PerpBookIndex } from "./perp-books";

export type FundingModuleKey = "perp-market" | "basis-engine" | "funding-guard" | "auto-compound";

export const FUNDING_SPINE: FundingModuleKey[] = ["perp-market", "basis-engine", "funding-guard", "auto-compound"];

export interface FundingVenue {
  id: string;
  label: string; // "Hyperliquid"
  chain: string; // "HyperEVM"
  /** Top perp markets by volume on this venue (demo menu). */
  markets: FundingMarket[];
}

export interface FundingMarket {
  id: string; // `${venueId}:${coin}`
  coin: string; // "ETH"
  pair: string; // "ETH-USD"
  /**
   * ⚠ FALLBACK ONLY, and labelled as one (QNT-R2-4, 2026-09-02).
   *
   * Hand-typed on 2026-08-19. `fundingP25Of` prefers the scanner's own
   * measurement of this book and reaches this field ONLY where nothing has
   * measured it. Nothing else in this file may read it: the funding leg, the
   * decode, the plate and — since QNT-R2-4 — the guard's stand-down share all
   * go through `fundingP25Of` / `guardStandDownShare`, because a typed number
   * sitting beside its own measured twin is two spellings of one fact.
   */
  fundingP25Apr: number;
  /** Modeled annualized funding, median. NOT a fallback for a measured twin:
   *  the scan publishes no median at all (`funding-table-deletion.test.ts`),
   *  so this is the only median the model has. */
  fundingMedApr: number;
  /** Modeled spot yield on the long leg (staking / lending), 0 if plain spot. */
  spotYieldApr: number;
  /** Open interest on the venue (USD), drives capacity. */
  openInterestUsd: number;
  /** Capacity our strategy can deploy at the cap (USD). */
  capacityUsd: number;
  /** 24h volume (USD). */
  volume24hUsd: number;
  /** Share of the trailing window's HOURLY prints that were positive. */
  positiveShare: number;
}

export interface FundingLane {
  id: string;
  label: string;
  /** True only once the builder has typed a name through the rename
   *  affordance. A minted name (from `laneIdentity`) follows the market on
   *  every repick; a typed one never moves again. The picker used to infer
   *  this from `label.startsWith("Venue")`, which held only for the
   *  marketless placeholder — an auto-seated lane kept its dead
   *  `venue · pair` identity after the builder swapped its market. */
  namedByBuilder: boolean;
  venueId: string;
  marketId: string;
  placed: FundingModuleKey[];
  params: {
    hedgeLeverage: number; // x on the short leg
    marginReserve: number; // share of short notional kept idle
    guardFloorApr: number; // de-risk when funding < floor
    guardWindowH: number; // hours under the floor before the guard fires
    cadence: "6h" | "24h" | "72h";
    minActionUsd: number;
  };
}

export interface FundingPortfolio {
  lanes: FundingLane[];
  allocationsBps: Record<string, number>;
  routerPolicy: "follow-funding" | "manual";
}

/**
 * Demo venues: top-volume perp venues the strategy can run on.
 *
 * Funding stats are grounded in the live Hyperliquid fundingHistory API
 * (trailing window, hourly prints annualized), pulled 2026-08-19:
 *   BTC median 6.8% / p25 0.8% / positive 78% of hours
 *   ETH median 10.0% / p25 1.7% / positive 78% of hours
 *   HYPE median 11.0% / p25 11.0% / positive 92% of hours
 *   SOL median negative in the window (kept in the menu as the honest
 *   counter-example: the guard would park it).
 * Aster and Avantis figures are set relative to the HL prints (smaller
 * venues, thinner books) and carry their own OI/volume snapshots.
 * Spot yield on the long leg: ETH via a liquid staking token ~3.0%,
 * SOL via LST ~6.0%, BTC/BNB plain spot 0%.
 *
 * HANDOFF (F14, data half): the recette also asks for these prints to be
 * refreshed off the loop scan's source, which quotes ETH p25 at 4.26% against
 * the 1.7% below. That refresh needs a live pull, and this wave has no
 * network; inventing the other eight rows to match one live figure would be
 * worse than a stale-but-sourced table. Left as sourced on 2026-08-19, with
 * the pull date on the record.
 */
export const FUNDING_VENUES: FundingVenue[] = [
  {
    id: "hyperliquid",
    label: "Hyperliquid",
    chain: "HyperEVM",
    markets: [
      {
        id: "hyperliquid:ETH",
        coin: "ETH",
        pair: "ETH-USD",
        fundingP25Apr: 0.017,
        fundingMedApr: 0.1,
        spotYieldApr: 0.03,
        openInterestUsd: 1_790_000_000,
        capacityUsd: 54_000_000,
        volume24hUsd: 1_190_000_000,
        positiveShare: 0.78,
      },
      {
        id: "hyperliquid:BTC",
        coin: "BTC",
        pair: "BTC-USD",
        fundingP25Apr: 0.008,
        fundingMedApr: 0.068,
        spotYieldApr: 0,
        openInterestUsd: 2_590_000_000,
        capacityUsd: 78_000_000,
        volume24hUsd: 1_720_000_000,
        positiveShare: 0.78,
      },
      {
        id: "hyperliquid:HYPE",
        coin: "HYPE",
        pair: "HYPE-USD",
        fundingP25Apr: 0.11,
        fundingMedApr: 0.11,
        spotYieldApr: 0,
        openInterestUsd: 1_340_000_000,
        capacityUsd: 40_000_000,
        volume24hUsd: 194_000_000,
        positiveShare: 0.92,
      },
      {
        id: "hyperliquid:SOL",
        coin: "SOL",
        pair: "SOL-USD",
        fundingP25Apr: -0.11,
        fundingMedApr: -0.008,
        spotYieldApr: 0.06,
        openInterestUsd: 377_000_000,
        capacityUsd: 11_000_000,
        volume24hUsd: 141_000_000,
        positiveShare: 0.49,
      },
    ],
  },
  {
    id: "aster",
    label: "Aster",
    chain: "BNB Chain",
    markets: [
      {
        id: "aster:BTC",
        coin: "BTC",
        pair: "BTC-USDT",
        fundingP25Apr: 0.012,
        fundingMedApr: 0.074,
        spotYieldApr: 0,
        openInterestUsd: 920_000_000,
        capacityUsd: 28_000_000,
        volume24hUsd: 2_100_000_000,
        positiveShare: 0.79,
      },
      {
        id: "aster:ETH",
        coin: "ETH",
        pair: "ETH-USDT",
        fundingP25Apr: 0.02,
        fundingMedApr: 0.096,
        spotYieldApr: 0.03,
        openInterestUsd: 540_000_000,
        capacityUsd: 16_000_000,
        volume24hUsd: 1_200_000_000,
        positiveShare: 0.77,
      },
      {
        id: "aster:BNB",
        coin: "BNB",
        pair: "BNB-USDT",
        fundingP25Apr: 0.03,
        fundingMedApr: 0.082,
        spotYieldApr: 0.008,
        openInterestUsd: 210_000_000,
        capacityUsd: 6_000_000,
        volume24hUsd: 480_000_000,
        positiveShare: 0.8,
      },
    ],
  },
  {
    id: "avantis",
    label: "Avantis",
    chain: "Base",
    markets: [
      {
        id: "avantis:ETH",
        coin: "ETH",
        pair: "ETH-USD",
        fundingP25Apr: 0.014,
        fundingMedApr: 0.081,
        spotYieldApr: 0.03,
        openInterestUsd: 92_000_000,
        capacityUsd: 2_800_000,
        volume24hUsd: 210_000_000,
        positiveShare: 0.74,
      },
      {
        id: "avantis:BTC",
        coin: "BTC",
        pair: "BTC-USD",
        fundingP25Apr: 0.006,
        fundingMedApr: 0.059,
        spotYieldApr: 0,
        openInterestUsd: 74_000_000,
        capacityUsd: 2_200_000,
        volume24hUsd: 160_000_000,
        positiveShare: 0.72,
      },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────
// Param bounds — READ from the rack's descriptors, never typed here (F9)
// ─────────────────────────────────────────────────────────────────────────

/** One funding epoch, in hours. Perp venues settle funding on an 8h clock;
 *  the rack's guard counts EPOCHS, this canvas's dial reads hours, and this
 *  is the only conversion between them. */
export const FUNDING_EPOCH_HOURS = 8;

interface Bound {
  min: number;
  max: number;
  step: number;
  default: number;
}

function rackBound(key: keyof typeof MODULE_DEFS, field: string, fallback: Bound): Bound {
  const d = MODULE_DEFS[key]?.params.find((p) => p.field === field);
  const n = (v: unknown, f: number) => (typeof v === "number" && Number.isFinite(v) ? v : f);
  if (!d) return fallback;
  return {
    min: n(d.min, fallback.min),
    max: n(d.max, fallback.max),
    step: n(d.step, fallback.step),
    default: n(d.default, fallback.default),
  };
}

function rackOptionNumbers(key: keyof typeof MODULE_DEFS, field: string, scale: number, fallback: number[]): number[] {
  const d = MODULE_DEFS[key]?.params.find((p) => p.field === field);
  const out = (d?.options ?? [])
    .map((o) => Number(o.value) * scale)
    .filter((v) => Number.isFinite(v) && v > 0);
  return out.length ? out : fallback;
}

function rackOptionStrings(key: keyof typeof MODULE_DEFS, field: string, fallback: string[]): string[] {
  const d = MODULE_DEFS[key]?.params.find((p) => p.field === field);
  const out = (d?.options ?? []).map((o) => String(o.value));
  return out.length ? out : fallback;
}

/**
 * Every dial on this canvas, bounded by the rack module that owns the same
 * quantity. `hedgeLeverage`, `marginReserve`, `guardFloorApr` and
 * `guardWindowH` are the Dynamic-hedge dials under other names; `cadence` and
 * `minActionUsd` are Auto-compound's, field for field.
 *
 * Every bound here now has a twin on the rack. `maxOiShare` was the one that
 * did not, and it is gone (P0-2): it multiplied a hand-typed open interest by
 * a dial to manufacture a capacity nobody had measured, and it was inert on
 * 25 of 25 live cells because the equally hand-typed venue cap always bound
 * first. Deposit room is measured now, or it is not printed.
 */
export const FUNDING_PARAM_BOUNDS = {
  hedgeLeverage: rackBound("hedge", "hedgeLeverage", { min: 1.5, max: 5, step: 0.5, default: 3 }),
  marginReserve: rackBound("hedge", "reserveFraction", { min: 0.15, max: 0.3, step: 0.05, default: 0.15 }),
  guardFloorApr: rackBound("hedge", "fundingFloorApr", { min: -0.15, max: 0, step: 0.01, default: -0.05 }),
  /** Hours, from the rack's `fundingWindowEpochs` options (1 / 3 / 6). */
  guardWindowH: rackOptionNumbers("hedge", "fundingWindowEpochs", FUNDING_EPOCH_HOURS, [8, 24, 48]),
  cadence: rackOptionStrings("auto-compound", "cadence", ["6h", "24h", "72h"]) as FundingLane["params"]["cadence"][],
  minActionUsd: rackBound("auto-compound", "minActionUsd", { min: 5, max: 500, step: 5, default: 25 }),
} as const;

function clampToBound(v: number, b: Bound): number {
  if (!Number.isFinite(v)) return b.default;
  return Math.min(b.max, Math.max(b.min, v));
}

/**
 * THE THREE COUPLED SHORT-LEG BUNDLES — named by the leverage they set, never
 * by an adjective.
 *
 * ⚠ THIS WAS `RISK_PRESETS`, KEYED safer / balanced / max (deleted
 * 2026-08-22). The lane header rendered those three words as a segmented
 * control, and on this canvas they were the worst version of the defect the
 * founder objected to: the bundle moves FOUR parameters at once, and two of
 * them cannot be priced by any surface in the product. A funding lane has no
 * lending liquidation, and `FundingMarket` carries no per-coin `maxLeverage`,
 * so `deriveHlMarginBands` cannot run and the short's own liquidation distance
 * is not computable on this path at all. Under the standing rule that a
 * surface which cannot prove its arithmetic prints nothing, the adjective was
 * hiding two unpriceable parameters behind a risk word.
 *
 * What survives is the bundle itself, as a copilot convenience: a user who
 * types "make every lane safer" gets the 2x short and is told, in numbers,
 * exactly which four values that set. The lane header states the short's own
 * margin ratio — the one exactly measurable risk quantity on this canvas —
 * and the guard plate states the share of the window it stands down for.
 *
 * The guard floor is NEGATIVE-ranged because the rack's `fundingFloorApr` is:
 * a basis trade tolerates short negative spells rather than paying a round
 * trip to dodge every dip, and the 2x bundle tolerates none of it.
 */
export type ShortLegPreset = Pick<
  FundingLane["params"],
  "hedgeLeverage" | "marginReserve" | "guardFloorApr"
>;

export const SHORT_LEG_PRESETS: readonly ShortLegPreset[] = [
  { hedgeLeverage: 2, marginReserve: 0.3, guardFloorApr: 0 },
  { hedgeLeverage: 3, marginReserve: 0.2, guardFloorApr: -0.05 },
  { hedgeLeverage: 4, marginReserve: 0.15, guardFloorApr: -0.1 },
];

/**
 * What a new lane and every seed start at.
 *
 * ⚠ DERIVED FROM THE DIALS, NOT FROM A PRESET INDEX (B2, 2026-08-23).
 *
 * This was `SHORT_LEG_PRESETS[1]`, whose `marginReserve` is 0.20, while the
 * dial's own default (`FUNDING_PARAM_BOUNDS.marginReserve`, itself read off the
 * rack's `hedge.reserveFraction` descriptor) is 0.15. So a new lane seeded at a
 * reserve its own control said was 0.15, and the two escrow shares that follow
 * (0.652174 against 0.674157) divided ONE measured book into two different
 * sizes: $305K on the lane against $295K in the picker, under the identical
 * sentence "in the ETH perp book, shared by 12", 200px apart.
 *
 * A lane must start where its dial says it starts. One owner: the descriptor.
 */
export const FUNDING_LANE_DEFAULTS: ShortLegPreset = {
  hedgeLeverage: FUNDING_PARAM_BOUNDS.hedgeLeverage.default,
  marginReserve: FUNDING_PARAM_BOUNDS.marginReserve.default,
  guardFloorApr: FUNDING_PARAM_BOUNDS.guardFloorApr.default,
};

/** The bundle whose short leverage matches, or the defaults. */
export function shortLegPresetAt(hedgeLeverage: number): ShortLegPreset {
  return (
    SHORT_LEG_PRESETS.find((x) => Math.abs(x.hedgeLeverage - hedgeLeverage) < 1e-9) ??
    FUNDING_LANE_DEFAULTS
  );
}

/**
 * THE SHORT'S OWN MARGIN RATIO, `1/L_h` — the only exactly measurable risk
 * quantity a funding lane carries today, and the one the lane header states in
 * place of the adjective it used to wear.
 *
 * It is NOT a liquidation distance and must never be labelled as one: that
 * needs the venue's maintenance margin (`MM = 1/(2·maxLeverage)`), and
 * `FUNDING_VENUES` carries no `maxLeverage` field. When the scan starts
 * emitting it, `deriveHlMarginBands` is already the owner and this becomes a
 * distance. Until then the honest statement is the ratio itself.
 */
export function shortMarginLine(hedgeLeverage: number): string | null {
  if (!Number.isFinite(hedgeLeverage) || hedgeLeverage <= 0) return null;
  return `${pct(1 / hedgeLeverage, 0)} margin on the short`;
}

export function venueOf(venueId: string): FundingVenue | null {
  return FUNDING_VENUES.find((v) => v.id === venueId) ?? null;
}

export function marketOf(marketId: string): { venue: FundingVenue; market: FundingMarket } | null {
  for (const v of FUNDING_VENUES) {
    const m = v.markets.find((x) => x.id === marketId);
    if (m) return { venue: v, market: m };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// The market's funding, as strings — the ONLY way a surface reaches it
// ─────────────────────────────────────────────────────────────────────────

/** Every funding figure a funding-canvas surface is allowed to print. */
export interface MarketFundingView {
  /** `1.7%` — bare, for a headline slot. A RATE, so the glyph is `%`. */
  p25: string;
  /** `p25 1.7%` — the percentile the lane is PRICED on, labelled. */
  p25Labelled: string;
  /** `med 10.0%` — context, never the headline. */
  medianLabelled: string;
  /** `positive 78% of hours` — the distribution, in words. */
  positiveHours: string;
}

/**
 * THE SOLE ACCESSOR for a perp market's funding, and what
 * `hedge-econ.ts hedgeEconomics()` is to the loop rack (R5, 2026-08-22).
 *
 * `FundingCanvas` read `market.fundingP25Apr` at five call sites and
 * formatted each one itself. Every one of them happened to be correct — all
 * five printed a RATE with a `%`, which is the law. That is the dangerous
 * shape, not a safe one: the loop rack's hedge plate was also correct at each
 * of its call sites, right up until one of them grew a verb, and the screen
 * then claimed a hedge earned 8.7% while a tip beside it said the hedge cost
 * 7.7pp. A raw percentile sitting in a component is the precondition for that
 * bug, so the identifier is banned under `components/` outright and the
 * strings are composed here, once, through `format.ts`.
 *
 * Note what this returns and what it does not: STRINGS, carrying their unit
 * already. A caller cannot choose the wrong glyph because it never holds the
 * number. Geometry that genuinely needs the scalar goes through
 * `guardMarkerPct` below, which returns a CSS percentage — not a rate, and
 * not something any surface would think to print.
 */
/**
 * THE ONE OWNER of a market's funding percentile (P0-2).
 *
 * The scanner's own measurement wherever a rack row shorts this book, the
 * venue table otherwise. Added when `laneEconomics` started reading the
 * measured rate and `laneDecode` did not: for one commit the plate's product
 * and the decode's factors were derived from two different numbers, which is
 * the precise shape of the contradiction the accessor above exists to stop.
 */
export function fundingP25Of(venueId: string, m: FundingMarket, books?: PerpBookIndex | null): number {
  return readingFor(books, venueId, m.coin)?.fundingP25Apr ?? m.fundingP25Apr;
}

/**
 * `priced` is anything that already CARRIES the percentile this market was
 * priced on — a `LaneEconomics`, or a `PerpBookReading`. It is an object and
 * not a number on purpose: a component that holds the scalar is one edit away
 * from formatting it itself, which is the ban `single-owner.test.ts` enforces
 * by grep. Callers hand over what they already have and never spell the field.
 */
export function marketFundingView(
  m: FundingMarket,
  priced?: { fundingP25Apr: number | null; fundingWindowDays?: number | null } | null,
): MarketFundingView {
  const p = priced?.fundingP25Apr ?? m.fundingP25Apr;
  /* THE WINDOW RIDES ON THE LABELLED RATE (F3/D1): a rate priced under the
     min-window rule publishes which window won, in the funding card's own
     eight-character grammar. A rate with no published window states none. */
  const w = priced?.fundingWindowDays;
  const window = typeof w === "number" && Number.isFinite(w) ? ` over ${w}d` : "";
  return {
    p25: pct(p),
    p25Labelled: `p25 ${pct(p)}${window}`,
    medianLabelled: `med ${pct(m.fundingMedApr)}`,
    positiveHours: `positive ${Math.round(m.positiveShare * 100)}% of hours`,
  };
}

/**
 * The guard gauge's marker position, as a CSS percentage of the track.
 *
 * The component asked for the raw percentile purely to place a dot, then did
 * the affine map inline. Where that dot sits relative to the floor is a claim
 * about the market, so it is model arithmetic and it lives with the model.
 * The window is ±0.12 APR around the floor, clamped to [8, 92] so a marker at
 * either extreme stays visibly ON the track instead of merging with an end
 * cap and reading as "no marker".
 */
export function guardMarkerPct(
  m: FundingMarket | null,
  floorApr: number,
  priced?: { fundingP25Apr: number | null } | null,
): number {
  const cur = priced?.fundingP25Apr ?? m?.fundingP25Apr ?? 0;
  return Math.min(92, Math.max(8, 50 + ((cur - floorApr) / 0.12) * 40));
}

// ─────────────────────────────────────────────────────────────────────────
// The funding distribution: how much of the year sits under the floor
// ─────────────────────────────────────────────────────────────────────────

/**
 * Share of the trailing window's hourly prints that landed BELOW `floor`.
 *
 * Built from the three distribution anchors the market table actually
 * carries, and nothing else:
 *
 *   (0, 1 − positiveShare)     share of prints below zero
 *   (p25, 0.25)                a quarter of prints below the p25
 *   (median, 0.50)             half of prints below the median
 *
 * Interpolated linearly between them, with a running max so a snapshot whose
 * anchors disagree (avantis:BTC prints 28% below zero and 25% below a p25
 * ABOVE zero) resolves to the conservative reading rather than a negative
 * density. Below the lowest anchor the tail is carried linearly to zero over
 * one more inter-anchor span — a MODEL, and the reason the guard floor is a
 * live continuous input rather than a switch that only two markets can flip.
 *
 * ⚠ IT TAKES ANCHORS, NOT A MARKET (QNT-R2-4, 2026-09-02). Typed as the three
 * anchor fields rather than as `FundingMarket`, so the p25 handed in can be
 * the MEASURED one. `FundingMarket` still satisfies the shape structurally,
 * which is exactly what keeps the hand table a legal FALLBACK and nothing
 * more. `guardStandDownShare` below is the only door a surface may use, and
 * it is where the measured percentile is substituted for the typed one.
 */
export interface FundingDistributionAnchors {
  fundingP25Apr: number;
  fundingMedApr: number;
  positiveShare: number;
}

export function subFloorShare(d: FundingDistributionAnchors, floor: number): number {
  const span = Math.max(d.fundingMedApr - d.fundingP25Apr, 0.02);
  const raw = [
    { x: Math.min(d.fundingP25Apr, 0) - span, y: 0 },
    { x: 0, y: 1 - d.positiveShare },
    { x: d.fundingP25Apr, y: 0.25 },
    { x: d.fundingMedApr, y: 0.5 },
  ].sort((a, b) => a.x - b.x || a.y - b.y);
  // Running max: a CDF cannot decrease.
  const pts: { x: number; y: number }[] = [];
  let hi = 0;
  for (const p of raw) {
    hi = Math.max(hi, p.y);
    pts.push({ x: p.x, y: hi });
  }
  if (!Number.isFinite(floor)) return pts[pts.length - 1].y;
  if (floor <= pts[0].x) return pts[0].y;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (floor <= b.x) {
      if (b.x - a.x <= 0) return b.y;
      const t = (floor - a.x) / (b.x - a.x);
      return a.y + t * (b.y - a.y);
    }
  }
  return pts[pts.length - 1].y;
}

/**
 * THE GUARD'S STAND-DOWN SHARE, ON THE BOOK THE LANE IS PRICED ON (QNT-R2-4).
 *
 * ── THE DEFECT THIS CLOSES ──────────────────────────────────────────────
 * `subFloorShare` read `FundingMarket.fundingP25Apr` — the hand table dated
 * 2026-08-19 — while the plate 200px away printed the MEASURED percentile
 * through `marketFundingView`. Same lane, same book, two p25s, and they were
 * not close: SOL typed at −11.0% against a measured −5.6% over 365d (1.98x),
 * BTC typed at 0.8% against 0.23% (3.5x). The guard's parked-share badge, its
 * floor dial's reading and the de-risked branch of the model were all derived
 * from the number the screen was NOT showing.
 *
 * LAW 1: the bound is derived. The p25 anchor is now `fundingP25Of`'s answer
 * — the scanner's measurement wherever a rack row shorts the book, the typed
 * table only where nothing has measured it — which is the same accessor
 * `laneEconomics` prices the funding leg with, so the plate and the guard
 * cannot disagree again.
 *
 * ⚠ THE OTHER TWO ANCHORS STAY TYPED, AND THAT IS NOT AN OVERSIGHT. The
 * measured row publishes `fractionNegative` per window and NO median at all —
 * `funding-table-deletion.test.ts` asserts exactly that, field by field — so
 * there is no measurement of the median to prefer. A typed number with no
 * measured twin is a fallback; a typed number sitting beside its own measured
 * twin is the second opinion this rule bans. Only the second kind was here.
 * When the scan starts publishing a median, this function is the one place
 * that has to change.
 */
export function guardStandDownShare(
  venueId: string,
  m: FundingMarket,
  floor: number,
  books?: PerpBookIndex | null,
): number {
  // Through the accessor below, so there is ONE substitution in this file and
  // not two spellings of it: this overload exists for a caller holding a
  // venue and a book index rather than an already-priced lane.
  return guardStandDownShareOf(m, floor, { fundingP25Apr: fundingP25Of(venueId, m, books) }) ?? 0;
}

/**
 * THE SUBSTITUTION ITSELF, for a surface that is already HOLDING the priced
 * lane — and the only door `laneEconomics` and the floor dial use.
 *
 * `priced` is an object and never a number, for `marketFundingView`'s reason:
 * a component that holds the scalar is one edit away from formatting it
 * itself, and `single-owner.test.ts` bans the identifier under `components/`
 * outright. A caller hands over the `LaneEconomics` it already has, so the
 * guard is scored on the EXACT number the lane was priced with rather than on
 * a second read that merely ought to agree.
 */
export function guardStandDownShareOf(
  m: FundingMarket | null,
  floor: number,
  priced?: { fundingP25Apr: number | null } | null,
): number | null {
  if (!m) return null;
  const p = priced?.fundingP25Apr;
  return subFloorShare(
    { ...m, fundingP25Apr: typeof p === "number" && Number.isFinite(p) ? p : m.fundingP25Apr },
    floor,
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Lane economics
// ─────────────────────────────────────────────────────────────────────────

/* THE DRAG HAS ONE OWNER, AND IT IS `mock-quote.execDragFor` (QNT-2,
   2026-09-01; supersedes the F12 register here). F12 closed this file's own
   private pair — `VENUE_COST_APR 35 bp + REBALANCE_COST_APR 25 bp = 60 bp` —
   by adopting the scanner's flat `EXEC_DRAG_APR`. QNT-2 then found the flat
   constant itself was a second owner: a rack-composed lane's RECORD states
   the DERIVED delta band (`publishedModelRecord`) while the flat constant is
   the band-0.5 calibration point, so the record and its own price disagreed
   by 0.19pp on the flagship. An armed lane now pays `execDragFor` at its own
   hedge dials — the same resolver, the same derived band and the same
   reference TVL the rack lane and the frozen record use, which is what keeps
   the rack/canvas identity gate (`funding-launch-rail.test.ts`, 1e-7) closed.
   The identity is unchanged: `net APY on deposit = escrow x (spot + funding
   − drag)`. A lane holding no short pays the model's own hedgeless floor
   `EXEC_DRAG_UNHEDGED`, the same constant `mock-quote`'s unhedged branch
   charges. The CARD stays the scanner's row (flat drag, the catalog
   register): closing that seam means moving the scanner, a separate ticket. */
/** Modeled cost of ONE side of a short round trip (taker + slippage), as a
 *  fraction of the notional moved. Closing and re-arming pays it twice. */
const UNWIND_COST_PER_SIDE = 0.0004;
/**
 * Mean length of a sub-floor funding spell, in hours.
 *
 * Funding oscillates around zero rather than sitting below a floor in one
 * block, which is the whole reason the guard needs a persistence window and
 * not an instant trigger. Spells are modeled as memoryless with a one-day
 * mean, which gives the guard's two live quantities in closed form:
 *
 *   parked share  s = q · exp(−W / SPELL_H)
 *   firings/year  n = (8760 · q / SPELL_H) · exp(−W / SPELL_H)
 *
 * Both fall as the window lengthens: a patient guard confirms less often, so
 * it parks less capital AND pays fewer round trips. That trade is the dial.
 */
const SPELL_HOURS = 24;
const HOURS_PER_YEAR = 8760;

/**
 * What stated this lane's deposit room. `unmeasured` is a real answer and the
 * only honest one for a book no rack row shorts (P0-2).
 */
export type FundingCapacityBinding = "measured book" | "unmeasured";

export interface LaneEconomics {
  /** f_b — the share of a deposited dollar that reaches the hedged notional
   *  (`fB(L_h, r)`, the rack's escrow term). The spot long and the perp short
   *  are both this size, so funding and spot yield both accrue on it. */
  escrowShare: number;
  fundingLegApr: number;
  spotLegApr: number;
  costsApr: number;
  /** Auto-compound's signed worth on the VENUE carry (`compoundDelta`), 0 when
   *  not installed. It is a term of the `netApr` ladder, NOT a figure to print:
   *  the depositor never holds the house's cut, so what the module is worth to
   *  them is `compoundAfterFeeApr` below. */
  compoundApr: number;
  /** THE DEPOSITOR'S RECAPTURE (QNT-R2-1, 2026-09-02) — `compoundDelta` on the
   *  AFTER-FEE carry, i.e. the compound step that is already inside
   *  `publishedApr`. Same split as `ComposedTerms.afterFee` on the loop path,
   *  and for the same reason: R1 takes the house's cut at harvest and only the
   *  remainder is re-deposited, so a surface printing the pre-fee lift beside a
   *  published number states a step that number does not contain. Measured on
   *  the live books that gap is 60.6% (HYPE +0.3401pp against +0.2118pp) and
   *  71.7% (ETH +0.0210pp against +0.0122pp); `compoundDelta` is quadratic in
   *  the rate, so it is never the flat 20% the fee itself is.
   *
   *  ONE FIELD, ONE OWNER: this value was computed here and thrown away, while
   *  the plate hero and the ledger row each read `compoundApr`. Both now read
   *  this, so neither can drift from the number the record publishes.
   *
   *  Exactly 0 in the three cases where there is no figure to state, which is
   *  the same zero-set `compoundApr` carries: the module is not installed, the
   *  book is unmeasured (no size to price a harvest at), or the lane accrues
   *  nothing so `compoundDelta` has nothing to compound. */
  compoundAfterFeeApr: number;
  /** Annualized cost of the guard's exits and re-entries. */
  unwindApr: number;
  /** The lane carrying the basis, guard healthy. */
  armedApr: number;
  /** The lane with the short closed, parked in spot, carrying base cost and
   *  the unwind charge. */
  deRiskedApr: number;
  /** Share of the year below the floor. */
  subFloorShare: number;
  /** Share of the year the guard actually has the lane parked. */
  deRiskedShare: number;
  /** Guard firings a year. */
  guardFires: number;
  /** The window, in funding epochs — what the rack's guard counts. */
  guardEpochs: number;
  /** `(1 − s) · armed + s · de-risked`. THE VENUE FRAME: what Hyperliquid and
   *  the spot leg pay, before the house's own cut. A market card may print
   *  this; a lane, a review sheet or a published record may NOT — they print
   *  `publishedApr`. Same split as `composedNetApy` / `publishedNetApy` on the
   *  loop path (`mock-quote.ts`). */
  netApr: number;
  /** THE PRODUCT NUMBER (planner ruling R1, S1 2026-08-24) — `netApr` with the
   *  20% compute fee taken, in R1's ordering: the fee lands on the CARRY,
   *  BEFORE auto-compound, because the house takes its cut at harvest and only
   *  the remainder is re-deposited. Compounding first and charging after would
   *  overstate the vault by the compound of a dollar the depositor never held;
   *  measured on the loop path that ordering error is worth up to 6.32pp
   *  (`fee-identity.test.ts`), so it is not a rounding argument.
   *
   *  Both branches carry it: the armed branch through `carryApr`, the parked
   *  branch through `deRiskedApr`. A branch modeling at or below zero harvests
   *  nothing and pays no fee — no rebate on a loss. */
  publishedApr: number;
  /** `netApr − publishedApr`: the fee AND the compounding the fee costs, as a
   *  positive magnitude. The one number a derivation ladder subtracts to get
   *  from the venue frame to the published one, so a printed ladder adds up.
   *  It is NOT `computeFeeTerm(netApr)` — those two ladders branch at the
   *  compound step. */
  feeDragApr: number;
  /** The funding percentile this lane was PRICED on. Every surface that
   *  prints a funding rate for this lane reads it from here, never from the
   *  market, so the plate and the decode cannot drift apart. */
  fundingP25Apr: number;
  /** The window that rate is published over (the funding venue's min-window
   *  pick, F3/D1), or null where the rate came from a scan that publishes no
   *  window. Rides beside the rate so a surface can print `p25 10.22% over
   *  30d` exactly as the catalog card does. */
  fundingWindowDays: number | null;
  /** Deposit room at THIS lane's f_b, or null when the book is unmeasured. */
  capacityUsd: number | null;
  capacityBinding: FundingCapacityBinding;
  /** `hl:${coin}` on Hyperliquid — the RACK's own key for the same book. */
  capacityKey: string;
  guardHealthy: boolean;
}

/**
 * The RESOURCE a funding lane's capacity is drawn from (capacity.ts §1.4
 * applied to perp books). Lanes sharing a key draw on ONE pool, so their
 * usages ADD and the tightest one binds the whole vault.
 *
 * An OI-bound lane keys by venue AND coin: the ETH book on Hyperliquid is one
 * book, and two lanes shorting it share it. A venue-cap-bound lane keys by
 * venue alone: the cap is a statement about the venue, and every lane on it
 * draws on the same allowance.
 */
export function fundingResourceKey(venueId: string, coin: string): string {
  return venueId === MEASURED_PERP_VENUE_ID ? `hl:${coin}` : `${venueId}:${coin}`;
}

/**
 * The escrow share at a pair of dials — for a surface that needs the ENDPOINTS
 * of a strip rather than a lane's own value. The same `fB` the lane is priced
 * with, never a second formula.
 */
export function escrowShareAt(hedgeLeverage: number, marginReserve: number): number {
  return fB(
    clampToBound(hedgeLeverage, FUNDING_PARAM_BOUNDS.hedgeLeverage),
    clampToBound(marginReserve, FUNDING_PARAM_BOUNDS.marginReserve),
  );
}

/**
 * ⚠ `FundingMarket.spotYieldApr` and `FundingMarket.capacityUsd` ARE DEAD FOR
 * PRICING. Both are hand-typed, both were measured wrong, and both are now
 * sourced from the scan. They survive only as the shape of the venue table
 * until it is deleted; nothing here reads them.
 */
export function laneEconomics(lane: FundingLane, books?: PerpBookIndex | null): LaneEconomics | null {
  const hit = marketOf(lane.marketId);
  if (!hit) return null;
  const { market } = hit;
  const hasBasis = lane.placed.includes("basis-engine");
  const hasGuard = lane.placed.includes("funding-guard");
  const hasCompound = lane.placed.includes("auto-compound");

  // ── the book ────────────────────────────────────────────────────────────
  // No hedge module, no short: every deposited dollar sits in spot, f_b = 1,
  // and there is no funding to collect. The clamped dials are kept as a
  // composition object so the drag below resolves through the SAME
  // `execDragFor` the rack lane prices with (QNT-2), never a re-read.
  const hedgeDials = hasBasis
    ? {
        hedgeLeverage: clampToBound(lane.params.hedgeLeverage, FUNDING_PARAM_BOUNDS.hedgeLeverage),
        reserveFraction: clampToBound(lane.params.marginReserve, FUNDING_PARAM_BOUNDS.marginReserve),
      }
    : null;
  const escrowShare = hedgeDials ? fB(hedgeDials.hedgeLeverage, hedgeDials.reserveFraction) : 1;
  // NO `Math.max(0, …)`: a carry that costs 0.8% costs 0.8%. Clamping it made
  // a de-risked branch impossible to score honestly, and printed 0.0% on two
  // combinations that were losing money (F8).
  // ── capacity: the MEASURED book, or no number at all (P0-2) ─────────────
  // The hand-typed venue cap and the `maxOiShare` bound both died here. On
  // the live catalog, same books, same minute, they overstated deposit room
  // by 56.5x (ETH: $54,000,000 typed against $955,238 measured) and 6,562x
  // (HYPE: $40,000,000 against $6,096). Deposit room is now the scanner's own
  // short-notional bound divided by THIS lane's f_b, and a book no rack row
  // shorts has no measurement and prints nothing.
  const reading = readingFor(books, lane.venueId, market.coin);
  const capacityBinding: FundingCapacityBinding = reading ? "measured book" : "unmeasured";
  const capacityUsd = reading ? depositRoomUsd(reading, escrowShare) : null;
  const capacityKey = fundingResourceKey(lane.venueId, market.coin);

  // The funding rate is the SCANNER's wherever the scanner measured it. The
  // hand table dated 2026-08-19 reads ETH p25 at 1.70% against a live 4.30%,
  // and its own docblock predicted exactly that drift.
  const fundingP25Apr = fundingP25Of(lane.venueId, market, books);
  const fundingLegApr = hasBasis ? fundingP25Apr * escrowShare : 0;
  /* THE SPOT LEG IS CREDITED ONLY WHERE IT WAS MEASURED (B1, 2026-08-23).
     The venue table hand-types 6.00% for SOL. The scanner's own row for the
     same book credits ZERO, because the only leg it can name is jitoSOL on
     Solana and Solana is not a rail. At the lane's escrow that hand-typed
     figure was worth +3.91pp, so this canvas priced a SOL carry 4.2pp above
     the card the rack prints for the same book five clicks away.
     A yield nobody measured is never credited. Where no funding scan has read
     this book the term is simply absent, which understates rather than
     flatters, and the row still states its funding leg honestly. */
  const spotYieldApr = reading?.spotYieldApr ?? 0;
  const spotLegApr = spotYieldApr * escrowShare;
  /* ONE DRAG OWNER (F12, re-based by QNT-2): `execDragFor` at this lane's
     own hedge dials, charged on the hedged notional exactly as the identity
     states — `escrow x (spot + funding − drag)` — so an armed lane here and
     the same composition on the rack price ONE drag (the rail test's 1e-7
     gate). A lane with no short pays the model's hedgeless floor instead.
     The parked branch below keeps charging the armed figure: it overstates
     a parked lane's cost slightly, which is the conservative direction, and
     a second drag register on one canvas is the defect class F12 escaped. */
  const costsApr = hedgeDials
    ? execDragFor({ hedge: hedgeDials, compound: null }) * escrowShare
    : EXEC_DRAG_UNHEDGED;

  // ── the guard, as an N-epoch persistence term ───────────────────────────
  const floor = clampToBound(lane.params.guardFloorApr, FUNDING_PARAM_BOUNDS.guardFloorApr);
  const windowH = Number.isFinite(lane.params.guardWindowH) && lane.params.guardWindowH > 0
    ? lane.params.guardWindowH
    : FUNDING_PARAM_BOUNDS.guardWindowH[1];
  const guardEpochs = windowH / FUNDING_EPOCH_HOURS;
  /* THE GUARD IS SCORED ON THE BOOK THE LANE IS PRICED ON (QNT-R2-4). This
     read `subFloorShare(market, floor)`, so the parked share, the firing
     count and the whole de-risked branch came off the hand table while the
     funding leg two lines above came off the scanner. One book, one p25. */
  const q =
    hasGuard && hasBasis
      // `fundingP25Apr` is the value this lane's funding leg was priced with,
      // five lines up — the same number, not a second read of the same book.
      ? (guardStandDownShareOf(market, floor, { fundingP25Apr }) ?? 0)
      : 0;
  const persistence = Math.exp(-windowH / SPELL_HOURS);
  const deRiskedShare = q * persistence;
  const guardFires = (HOURS_PER_YEAR * q * persistence) / SPELL_HOURS;
  // Every firing closes the short and re-arms it: two sides, on a notional of
  // f_b per deposited dollar.
  const unwindApr = guardFires * 2 * UNWIND_COST_PER_SIDE * escrowShare;

  // ── the two branches ────────────────────────────────────────────────────
  const carryApr = fundingLegApr + spotLegApr - costsApr;
  // Auto-compound is priced at the size the lane is BUILT for — its modeled
  // capacity — because that is the only size number this model has. A deep
  // book harvests on cadence; a thin one waits for the harvest threshold.
  // An unmeasured book has no size, so whether a harvest clears its gas is
  // unknowable. 0 here is not a claim that compounding is worthless: the lane
  // cannot publish at all, and the decode says the book is unmeasured.
  const compoundApr = hasCompound && capacityUsd !== null
    ? compoundDelta(carryApr, { cadence: lane.params.cadence, minActionUsd: lane.params.minActionUsd }, capacityUsd)
    : 0;
  const armedApr = carryApr + compoundApr;
  // The de-risked lane closed its short. It still holds the spot leg, so it
  // still carries the base cost, and it carries the round trips the guard
  // spent getting in and out.
  const deRiskedApr = spotLegApr - costsApr - unwindApr;

  const netApr = (1 - deRiskedShare) * armedApr + deRiskedShare * deRiskedApr;

  /* ── THE HOUSE'S OWN CUT (S1, 2026-08-24, planner ruling R1) ─────────────
     Before this, `laneEconomics` was the only pricing path in the product
     that published a fee-free number: the loop path took the fee inside
     `composedTerms`, the funding SEEDS took it at the seed boundary, and the
     funding CANVAS took it nowhere — while `VaultDetail` captioned the
     resulting record "net of venue costs and the 20% compute fee". A caption
     naming a fee the arithmetic never charged is a fabricated number, and it
     made a seeded sample and a user-published vault on the SAME book print
     two different figures for one quantity.

     The ordering is R1's, and it is applied per BRANCH rather than to the
     blend, because that is where the compound step lives: the fee comes off
     the carry FIRST, and only the after-fee carry compounds. `applyComputeFee`
     is the single owner of the rate — the 0.20 is spelled nowhere here. */
  const carryAfterFee = applyComputeFee(carryApr);
  /* PUBLISHED, AND PRINTED (QNT-R2-1). This was a local: `publishedApr`
     consumed it and no surface could reach it, so the plate and the ledger
     printed `compoundApr` — the pre-fee lift — beside a published net APY that
     contains this one. It leaves the function now, under a name that says
     which frame it is in. */
  const compoundAfterFee = hasCompound && capacityUsd !== null
    ? compoundDelta(carryAfterFee, { cadence: lane.params.cadence, minActionUsd: lane.params.minActionUsd }, capacityUsd)
    : 0;
  const publishedApr =
    (1 - deRiskedShare) * (carryAfterFee + compoundAfterFee) +
    deRiskedShare * applyComputeFee(deRiskedApr);
  const feeDragApr = netApr - publishedApr;

  const guardHealthy = !hasGuard || !hasBasis || fundingP25Apr >= floor;

  return {
    escrowShare,
    fundingLegApr,
    spotLegApr,
    costsApr,
    compoundApr,
    compoundAfterFeeApr: compoundAfterFee,
    unwindApr,
    armedApr,
    deRiskedApr,
    publishedApr,
    feeDragApr,
    subFloorShare: q,
    deRiskedShare,
    guardFires,
    guardEpochs,
    netApr,
    fundingP25Apr,
    fundingWindowDays: reading?.fundingWindowDays ?? null,
    capacityUsd,
    capacityBinding,
    capacityKey,
    guardHealthy,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// The decode row — printed factors that multiply to the printed product
// ─────────────────────────────────────────────────────────────────────────

export interface LaneDecode {
  factors: { label: string; value: string }[];
  productLabel: string;
  product: string;
  /** The escrow term spelled out, for the caption. */
  escrowNote: string;
}

/**
 * The funding leg, decoded into the terms `laneEconomics` ACTUALLY used.
 *
 * The old row named three factors — the median where the model priced the
 * p25, `× L` where the model applied `L/(L+1)`, and a deployed base that was
 * neither — and 27 of 27 market × preset combinations disagreed with their
 * own decode (F1).
 *
 * SELF-CONSISTENCY: the product is computed from the ROUNDED factors, the
 * same law `format.ts deltaTriple` follows, so parsing the printed strings
 * and multiplying them always reproduces the printed product. The factors
 * carry enough digits that the result never lands more than half a display
 * unit from `fundingLegApr` itself, which the test asserts on all 27.
 */
export function laneDecode(lane: FundingLane, books?: PerpBookIndex | null): LaneDecode | null {
  const hit = marketOf(lane.marketId);
  const e = laneEconomics(lane, books);
  if (!hit || !e) return null;
  // From the ECONOMICS, never from the market: the lane was priced on
  // `e.fundingP25Apr` and the decode must reconcile against that same figure.
  const p25 = pct(e.fundingP25Apr, 2);
  const escrow = pct(e.escrowShare, 1);
  const product = Number(p25.replace("−", "-").replace("%", "")) * Number(escrow.replace("%", "")) / 100;
  return {
    factors: [
      { label: "funding p25", value: p25 },
      { label: "escrow share", value: escrow },
    ],
    productLabel: "funding leg",
    product: pct(product / 100, 1),
    escrowNote: `escrow share f_b = L/(L+1+r·L) at ${lev(lane.params.hedgeLeverage)} short and ${Math.round(lane.params.marginReserve * 100)}% reserve`,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Portfolio — capacity through capacity.ts, never a sum
// ─────────────────────────────────────────────────────────────────────────

/**
 * Encode a funding lane as the shape `capacity.ts vaultCapacity` groups.
 *
 * Class N1 so `laneCapacityUsd` returns the capacity unrescaled (a basis lane
 * has no lending escrow to convert), and a venue-side binding so
 * `capacityResourceKey` keys off `collateralSymbol` — which carries
 * `fundingResourceKey`, the only place the funding grouping is decided.
 */
function capacityLaneOf(lane: FundingLane, e: LaneEconomics, allocationBps: number): CapacityLane | null {
  // An unmeasured book contributes no bound, and a vault holding one cannot
  // state a capacity at all — see `portfolioEconomics`.
  if (e.capacityUsd === null) return null;
  const candidate: ProjectedCandidate = {
    id: lane.id,
    venue: lane.venueId as CanvasVenueId,
    cls: "N1",
    pair: lane.marketId,
    collateralSymbol: e.capacityKey,
    debtSymbol: "",
    hlCoin: null,
    eligible: true,
    eligibleWithRewards: null,
    lt: null,
    headlineApr: e.netApr,
    score: null,
    scoreN1: null,
    apyRiskAdj: null,
    economics: {
      netApyOnDepositApy: e.netApr,
      netCarryOnEquityApy: e.netApr,
      loopLeverage: 1,
      targetLtv: 0,
      capacityUsd: e.capacityUsd,
      capacityBinding: "collateral supply cap",
      fundingP25Apr: null,
      collateralYieldApy: 0,
      borrowApyMarginal: 0,
    },
    firstFailedGate: null,
    failedGates: [],
    gatesPassed: 0,
    gatesTotal: 0,
    launchable: true,
  };
  return { candidate, hasHedge: false, allocationBps };
}

export interface PortfolioEconomics {
  /** THE VENUE FRAME, allocation-weighted. See `LaneEconomics.netApr`. */
  netApr: number | null;
  /** THE PRODUCT NUMBER, allocation-weighted over the lanes' own
   *  `publishedApr` — the SAME weights, so the blend of the published lanes
   *  is the published blend and no surface has to reconstruct it. This is
   *  what the canvas header, the vault node, the router dock, the review
   *  sheet and the published record all print (S1, R1). */
  publishedApr: number | null;
  /** `netApr − publishedApr`, or null when either is. The ladder rung. */
  feeDragApr: number | null;
  /** The tightest SHARED resource, never the sum of the lanes. 0 when the
   *  portfolio states one and it is empty; NULL when a weighted lane shorts a
   *  book nobody measured, which makes the vault's room unknowable rather
   *  than large. */
  capacityUsd: number | null;
  /** The binding resource, and how many lanes draw on it. */
  capacityKey: string | null;
  capacitySharedCount: number;
  perLane: Record<string, LaneEconomics | null>;
}

export function portfolioEconomics(p: FundingPortfolio, books?: PerpBookIndex | null): PortfolioEconomics {
  const perLane: Record<string, LaneEconomics | null> = {};
  const capLanes: CapacityLane[] = [];
  let num = 0;
  let numPub = 0;
  let den = 0;
  let anyUnmeasured = false;
  for (const lane of p.lanes) {
    const e = laneEconomics(lane, books);
    perLane[lane.id] = e;
    if (!e) continue;
    const w = p.allocationsBps[lane.id] ?? 0;
    if (!(w > 0)) continue;
    num += e.netApr * w;
    numPub += e.publishedApr * w;
    den += w;
    const cl = capacityLaneOf(lane, e, w);
    if (cl) capLanes.push(cl);
    else anyUnmeasured = true;
  }
  const cap = capLanes.length ? vaultCapacity(capLanes) : null;
  return {
    netApr: den > 0 ? num / den : null,
    publishedApr: den > 0 ? numPub / den : null,
    feeDragApr: den > 0 ? (num - numPub) / den : null,
    capacityUsd: anyUnmeasured ? null : (cap?.usd ?? 0),
    capacityKey: cap ? cap.cand.collateralSymbol : null,
    capacitySharedCount: cap?.sharedCount ?? 0,
    perLane,
  };
}

/**
 * THE USD MAGNITUDE FORMATTER — one owner, `capacity.ts` `fmtCapacityUsd`.
 *
 * R5 grep (2026-08-22): this file held the second one. It was a real
 * disagreement, not a style split, because the two rounded in OPPOSITE
 * DIRECTIONS on the same job: `fmtCapacityUsd` floors, this one used
 * `toFixed`, which rounds to nearest. `$124,999` of capacity printed `$124K`
 * on a DiscoverPanel row and `$125K` on the funding canvas, and rounding a
 * capacity UP advertises room a vault does not have. Re-exported under the
 * old name so `single-owner.test.ts` can keep asserting they are the same
 * function object.
 */
export const fmtUsd = fmtCapacityUsd;

// ─────────────────────────────────────────────────────────────────────────
// Allocations — largest remainder, ratios preserved
// ─────────────────────────────────────────────────────────────────────────

/**
 * Weights to basis points summing to EXACTLY 10000, by largest remainder.
 *
 * The canvas used to rebuild allocations as an even split on every add and
 * remove, discarding whatever the user had set (F12). This preserves the
 * ratios it is handed and spends the rounding drift on the largest remainders
 * rather than dumping it all on lane one.
 */
export function normalizeAllocationsBps(weights: Record<string, number>, order: string[]): Record<string, number> {
  const ids = order.filter((id) => id in weights);
  if (ids.length === 0) return {};
  const raw = ids.map((id) => (Number.isFinite(weights[id]) && weights[id] > 0 ? weights[id] : 0));
  const total = raw.reduce((a, b) => a + b, 0);
  const exact = total > 0 ? raw.map((w) => (w / total) * 10000) : ids.map(() => 10000 / ids.length);
  const floors = exact.map((v) => Math.floor(v));
  let left = 10000 - floors.reduce((a, b) => a + b, 0);
  const byRemainder = exact
    .map((v, i) => ({ i, r: v - Math.floor(v) }))
    .sort((a, b) => b.r - a.r || a.i - b.i);
  const out: Record<string, number> = {};
  const bump = new Set<number>();
  for (const { i } of byRemainder) {
    if (left <= 0) break;
    bump.add(i);
    left -= 1;
  }
  ids.forEach((id, i) => (out[id] = floors[i] + (bump.has(i) ? 1 : 0)));
  return out;
}

/**
 * ══ THE PRINTED SHARES, ROUNDED ONCE (FUND-ROUTER-PERCENT-SUM) ════════════
 *
 * ── THE DEFECT THIS CLOSES ──────────────────────────────────────────────
 * `normalizeAllocationsBps` above spends its rounding drift by largest
 * remainder so the weights sum to exactly 10000 — and then FOUR surfaces
 * rounded that vector again, one lane at a time: the router's number input
 * (`Math.round(bps / 100)`), the lane header, the router's wire labels and
 * the top-rail venue chip. Rounding is not distributive over a sum, so
 * {4333, 2334, 3333} printed 43 + 23 + 33 = 99% in all four places at once.
 * A property run over 20,000 random 2-to-5-lane vectors missed 100% on 4,941
 * of them, worst case by 2 points.
 *
 * ── ONE OWNER, AND IT IS ALREADY WRITTEN ────────────────────────────────
 * This is D10, and the loop rack fixed it: `orchestrator.allocationPercents`
 * rounds the WHOLE VECTOR by largest remainder and returns integers summing
 * to exactly 100. It was never wired to this canvas, which is the archetype
 * behind half this recette — fixed on the rack, resurrected on the funding
 * sibling. Nothing here re-implements it; this wraps it in the funding
 * portfolio's own vocabulary and adds the STRING, so a surface reads the
 * label rather than welding a `%` to a number of its own.
 */
export function laneSharePercents(p: FundingPortfolio): Record<string, number> {
  return allocationPercents(p.lanes.map((l) => l.id), p.allocationsBps);
}

/** `43%` per lane, off the one rounding above. THE label every surface that
 *  states a lane's share of capital prints — router control, lane header,
 *  router wire, top-rail chip and the published record's lane row. */
export function laneShareLabels(p: FundingPortfolio): Record<string, string> {
  const pcts = laneSharePercents(p);
  const out: Record<string, string> = {};
  // Through `format.pct`, the one owner of the glyph: the integer is already
  // the printed value, so this only welds the `%` on.
  for (const [id, n] of Object.entries(pcts)) out[id] = pct(n / 100, 0);
  return out;
}

/** Add a lane, preserving every existing ratio and giving the newcomer the
 *  average share of the resulting portfolio. */
export function allocationsWithLane(p: FundingPortfolio, newLaneId: string): Record<string, number> {
  const ids = p.lanes.map((l) => l.id);
  const weights: Record<string, number> = {};
  for (const id of ids) weights[id] = p.allocationsBps[id] ?? 0;
  const n = ids.length;
  const mean = n > 0 ? Object.values(weights).reduce((a, b) => a + b, 0) / n : 10000;
  weights[newLaneId] = mean > 0 ? mean : 10000;
  return normalizeAllocationsBps(weights, [...ids, newLaneId]);
}

/** Remove a lane, preserving every surviving ratio. */
export function allocationsWithoutLane(p: FundingPortfolio, laneId: string): Record<string, number> {
  const ids = p.lanes.filter((l) => l.id !== laneId).map((l) => l.id);
  const weights: Record<string, number> = {};
  for (const id of ids) weights[id] = p.allocationsBps[id] ?? 0;
  return normalizeAllocationsBps(weights, ids);
}

/** One share edited by hand: that lane takes its number, the rest keep their
 *  ratios inside what is left. */
export function allocationsWithShare(p: FundingPortfolio, laneId: string, bps: number): Record<string, number> {
  const ids = p.lanes.map((l) => l.id);
  const target = Math.max(0, Math.min(10000, Math.round(bps)));
  const others = ids.filter((id) => id !== laneId);
  const prevRest = others.reduce((s, id) => s + (p.allocationsBps[id] ?? 0), 0);
  const rest = 10000 - target;
  const out: Record<string, number> = { [laneId]: target };
  if (others.length === 0) return { [laneId]: 10000 };
  const shares: Record<string, number> = {};
  for (const id of others) shares[id] = prevRest > 0 ? (p.allocationsBps[id] ?? 0) / prevRest : 1 / others.length;
  const scaled = normalizeAllocationsBps(
    Object.fromEntries(others.map((id) => [id, shares[id]])),
    others,
  );
  /* LARGEST REMAINDER OVER `rest`, same discipline as `normalizeAllocationsBps`
     above. This used to `Math.round` each share and dump the residual on the
     LAST lane, clamped at zero — and when the earlier rounds overshot, that
     clamp swallowed a negative residual and the weights summed to 10001 bps
     (fuzz-found at 5 lanes; the seeded 6-lane portfolio hit it by hand).
     Floors never overshoot, so the leftover is always spendable and the sum
     is exactly `target + rest` = 10000. */
  const exact = others.map((id) => (scaled[id] / 10000) * rest);
  const floors = exact.map((v) => Math.floor(v));
  let left = rest - floors.reduce((a, b) => a + b, 0);
  const byRemainder = exact
    .map((v, i) => ({ i, r: v - Math.floor(v) }))
    .sort((a, b) => b.r - a.r || a.i - b.i);
  const bump = new Set<number>();
  for (const { i } of byRemainder) {
    if (left <= 0) break;
    bump.add(i);
    left -= 1;
  }
  others.forEach((id, i) => (out[id] = floors[i] + (bump.has(i) ? 1 : 0)));
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Installed modules, review gating, lane picking
// ─────────────────────────────────────────────────────────────────────────

const MODULE_PUBLISH_NAME: Record<FundingModuleKey, string> = {
  "perp-market": "Perp market",
  "basis-engine": "Basis engine",
  "funding-guard": "Funding guard",
  "auto-compound": "Auto-compound",
};

const MODULE_PUBLISH_LINE: Record<FundingModuleKey, string> = {
  "perp-market": "Pins the perp venue and market the basis trade runs on",
  "basis-engine": "Spot long and perp short at equal notional, funding collected",
  "funding-guard": "De-risks the short when funding sits under the floor",
  "auto-compound": "Sweeps earned funding back into the position",
};

/**
 * The modules the portfolio ACTUALLY has installed, in spine order.
 *
 * The publish draft used to carry hardcoded arrays, so Review listed a
 * Funding guard the user had ejected and the vault page derived automations
 * for machines that were not there (F4).
 */
export function installedModules(p: FundingPortfolio): {
  names: string[];
  lines: { name: string; line: string }[];
} {
  const lanes = p.lanes.filter((l) => l.marketId !== "");
  const present = new Set<FundingModuleKey>();
  for (const l of lanes) for (const k of l.placed) present.add(k);
  const keys = FUNDING_SPINE.filter((k) => present.has(k));
  const names = keys.map((k) => MODULE_PUBLISH_NAME[k]);
  const lines = keys.map((k) => ({ name: MODULE_PUBLISH_NAME[k], line: MODULE_PUBLISH_LINE[k] }));
  if (lanes.length >= 2) {
    names.push("Capital router");
    lines.push({ name: "Capital router", line: "Rebalances toward the best funding across venues" });
  }
  return { names, lines };
}

export interface FundingPublishFields {
  params: { label: string; value: string }[];
  /** The lane whose dials describe most of the vault — the largest share. */
  lead: FundingLane | null;
  hedgeLeverage: number | null;
  reserveFraction: number | null;
  fundingFloorApr: number | null;
  hlCoin: string | null;
  thresholdUsd: number | null;
  compoundCadenceHours: number | null;
  capacityBinding: string | null;
}

/**
 * The published record's parameter rows and typed fields.
 *
 * `publishDraft.params` used to carry only `{venueName, "ETH-USD · 50%"}`
 * rows, so the guard floor, window, short leverage, margin reserve
 * and cadence never survived publish and four wildly different funding
 * drafts produced BYTE-IDENTICAL vault pages (F3). Every row below is read
 * back by `lib/vaults/store.ts deriveAutomations` and printed by `riskGrade`,
 * so this function is what makes those two honest.
 *
 * It lives here rather than in the canvas component so it can be run against
 * the reader without a DOM.
 */
export function publishFields(p: FundingPortfolio, econ: PortfolioEconomics): FundingPublishFields {
  const lanes = p.lanes.filter((l) => l.marketId !== "");
  const lead =
    [...lanes].sort((a, b) => (p.allocationsBps[b.id] ?? 0) - (p.allocationsBps[a.id] ?? 0))[0] ?? null;
  const leadEcon = lead ? econ.perLane[lead.id] : null;
  const leadHit = lead ? marketOf(lead.marketId) : null;

  /* NO LANE ROWS HERE (S1, 2026-08-24). This function used to open with one
     row per lane labelled by the VENUE alone — `{ label: "Hyperliquid",
     value: "ETH-USD · 65%" }` — which is how a two-lane Hyperliquid vault
     published two rows under one label and lost the second to the record's
     dedupe. `funding-lane-rows.ts` (retired, see git history) owned a lane's identity
     (`Hyperliquid · ETH-USD | 65% of capital`) and `fundingRecordView`
     prepends those rows. Emitting the old shape here as well left TWO
     spellings of one row alive in the tree, kept apart only by `dialRows`
     stripping one of them by string match. One shape, one owner: this
     function now emits the LEAD LANE'S DIALS and nothing else. `dialRows`
     stays as the tripwire — identity on this output, and it still strips a
     legacy prefix if one ever comes back. */
  const params: { label: string; value: string }[] = [];
  if (lead) {
    const epochs = lead.params.guardWindowH / FUNDING_EPOCH_HOURS;
    // R5 grep: a PUBLISH RECORD is the last place a private leverage
    // formatter belongs. `format.lev` is 2 dp; this was 1, and the dial that
    // sets it was a third spelling again.
    params.push({ label: "Short leverage", value: lev(lead.params.hedgeLeverage) });
    params.push({ label: "Margin reserve", value: `${Math.round(lead.params.marginReserve * 100)}% of short` });
    params.push({ label: "Funding floor", value: `${pct(lead.params.guardFloorApr, 1)} apr` });
    // `deriveAutomations` parses the guard's N off a label carrying "dealloc";
    // `riskGrade` then prints "floor X, N periods under it".
    params.push({ label: "Guard dealloc periods", value: `${epochs} epochs under the floor` });
    params.push({ label: "Compound cadence", value: lead.params.cadence });
    params.push({ label: "Harvest threshold", value: `$${lead.params.minActionUsd}` });
    if (leadEcon) {
      params.push({ label: "Escrow share", value: `${pct(leadEcon.escrowShare)} of deposit in the book` });
      params.push({ label: "Guard exits", value: `${leadEcon.guardFires.toFixed(0)} a year, modeled` });
    }
  }

  return {
    params,
    lead,
    hedgeLeverage: lead?.params.hedgeLeverage ?? null,
    reserveFraction: lead?.params.marginReserve ?? null,
    fundingFloorApr: lead?.params.guardFloorApr ?? null,
    hlCoin: leadHit?.market.coin ?? null,
    thresholdUsd: lead?.params.minActionUsd ?? null,
    compoundCadenceHours: lead ? Number.parseInt(lead.params.cadence, 10) : null,
    capacityBinding: leadEcon?.capacityBinding ?? null,
  };
}

/** `limited by …` for the vault's binding resource, from the portfolio's own
 *  capacity key. Never a sum, never a venue the vault does not touch. */
export function capacityBindingLabelFor(econ: PortfolioEconomics): string | null {
  const key = econ.capacityKey;
  if (!key || econ.capacityUsd === null || econ.capacityUsd <= 0) return null;
  // `hl:<coin>` is the RACK's key for the same book (P0-2), so the sentence
  // names the book that was measured rather than an open-interest share that
  // no longer exists.
  const [venueId, coin] = key.split(":");
  if (venueId === "hl") return `limited by the depth of the ${coin} perp book on Hyperliquid`;
  return `limited by the ${coin} book on ${venueOf(venueId)?.label ?? venueId}`;
}

/**
 * Why Review is dark, in one clause, or null when it is lit.
 *
 * The key used to be disabled with no reason at all (F14), and a composition
 * that priced at exactly 0.0% armed it anyway (F8).
 */
export function reviewReason(p: FundingPortfolio, econ: PortfolioEconomics, quoting: boolean): string | null {
  if (quoting) return "pricing the lanes";
  const withMarket = p.lanes.filter((l) => l.marketId !== "");
  if (withMarket.length === 0) return "pick a perp market";
  /* ══ EVERY LANE ON THE RECORD, OR NO RECORD (FUND-PLACEHOLDER-PUBLISH) ══
     A lane with no market is invisible to every published surface —
     `seatedLanes` (retired, see git history) dropped it from the record's rows, `portfolioEconomics`
     skips it (`if (!e) continue`), and the blend renormalises over the
     lanes that priced. It is NOT invisible to the ROUTER: it keeps its share
     of `allocationsBps`. So the unseeded canvas plus one `＋ Add a venue`
     reached Review with a 50/50 split, and the sheet priced the seated lane
     alone: `7.0% modeled net APY` for a vault half of whose capital had
     nowhere to go.

     The rule is the first of the two the recette allowed, and it is the one
     that needs no second sentence anywhere: a composition publishes when
     every lane it shows is a lane the record carries. The alternative —
     dropping the placeholder out of the router — leaves a visible lane at 0%
     and asks the sheet to explain itself. The builder's way out is one click
     either way (seat it from the ghost slot, or `remove`), and the reason
     names the lane so it is obvious which. */
  const unseated = p.lanes.find((l) => l.marketId === "");
  if (unseated) return `pick a perp market on ${unseated.label}`;
  const unbuilt = withMarket.find((l) => !l.placed.includes("basis-engine"));
  if (unbuilt) return `install the basis engine on ${unbuilt.label}`;
  const unpriced = withMarket.find((l) => !econ.perLane[l.id]);
  if (unpriced) return `${unpriced.label} is not priced`;
  if (econ.publishedApr === null) return "no lane carries an allocation";
  // 2 dp here and only here: a composition that loses two basis points prints
  // `−0.0%` at the APY law's one decimal, and a signed zero as the stated
  // reason a key is dark is worse than no reason at all.
  //
  // THE PUBLISHED NUMBER DECIDES (S1, 2026-08-24). The floor asks whether a
  // depositor ends the year ahead, and what a depositor gets is the number
  // AFTER the house's cut — so the gate and the reason both read
  // `publishedApr`, the same figure the key would publish if it lit. On the
  // fee's own sign rule the two frames agree wherever both branches share a
  // sign; where they disagree the venue is positive and the product is not,
  // which is exactly the composition this gate exists to refuse.
  if (econ.publishedApr <= 0) return `this composition prices at ${pct(econ.publishedApr, 2)}, under the deposit floor`;
  // P0-2. An unmeasured book is not a small book: it is a book nobody
  // scanned, and this canvas used to hand it a typed number in the tens of
  // millions. Name the coin, because that is what the builder can change.
  const unmeasured = withMarket.find((l) => econ.perLane[l.id]?.capacityBinding === "unmeasured");
  if (unmeasured) {
    const coin = marketOf(unmeasured.marketId)?.market.coin ?? "that";
    return `we have not measured the ${coin} perp book`;
  }
  if (econ.capacityUsd === null || econ.capacityUsd <= 0) return "no capacity on the binding resource";
  return null;
}

/**
 * The next lane to add: prefer a venue nothing represents yet, then that
 * venue's best unused market.
 *
 * "Add a venue" used to walk the table in order and hand back a fourth
 * Hyperliquid market (F12).
 */
export function nextLanePick(p: FundingPortfolio): { venueId: string; marketId: string } | null {
  const usedMarkets = new Set(p.lanes.map((l) => l.marketId));
  const usedVenues = new Set(p.lanes.filter((l) => l.marketId !== "").map((l) => l.venueId));
  const order = [...FUNDING_VENUES].sort((a, b) => Number(usedVenues.has(a.id)) - Number(usedVenues.has(b.id)));
  for (const v of order) {
    const free = v.markets.filter((m) => !usedMarkets.has(m.id));
    if (free.length === 0) continue;
    const best = [...free].sort((a, b) => b.fundingP25Apr + b.spotYieldApr - (a.fundingP25Apr + a.spotYieldApr))[0];
    return { venueId: v.id, marketId: best.id };
  }
  return null;
}

/**
 * A LANE'S NAME IS `venue · market`, and the ` · ` is the whole fix.
 *
 * ── THE DEFECT THIS CLOSES (recette, 2026-08-27) ────────────────────────
 * FOUR places minted a lane's name from the VENUE ALONE — `demoPortfolio`,
 * the copilot's builder, `FundingCanvas.addLane`, and the market picker's
 * rename-on-first-pick. Every one of them collides the moment two lanes sit
 * on one venue, which is the seeded template's own shape: `?template=
 * funding-carry` opened with TWO lane pickers both reading `Hyperliquid`, so
 * the control whose entire job is to say WHICH lane you are on could not tell
 * them apart, and neither could the dock kicker, the vault plate or the
 * module panel.
 *
 * `funding-lane-rows.laneRowLabel` (retired, see git history) had already reached this ruling for the
 * PUBLISHED RECORD, and for the same reason — two rows under one label were
 * deduped away and the record then priced off a market the reader could not
 * see. It reads this function, so there is ONE spelling of the join.
 *
 * ⚠ TWO CALLERS, ONE JOIN, AND THEY STAY SEPARATE FUNCTIONS. The record's
 * label is re-derived from the lane's venue and market on every read,
 * precisely so a RENAME cannot move it; this one seeds a field the builder
 * owns and may overwrite. Same string on a fresh lane, different masters
 * after that.
 */
export function laneIdentity(venueLabel: string, pair: string): string {
  return pair ? `${venueLabel} · ${pair}` : venueLabel;
}

/**
 * The label a lane carries AFTER the builder swaps its market.
 *
 * ── THE DEFECT THIS CLOSES (recette FUND-LANE-STALE-IDENTITY) ────────────
 * The picker guarded the rename on the STRING — `label.startsWith("Venue")`
 * — which held only for the marketless placeholder. A lane `addLane` had
 * auto-seated as `Aster · ETH-USDT` kept that dead identity on all four
 * surfaces that print it (lane picker, top-rail chip, vault plate, dock
 * kicker) after the builder moved it to Hyperliquid BTC-USD. The guard now
 * reads the FACT: `namedByBuilder`, set only by the rename affordance. A
 * minted name follows the market; a typed one survives every swap.
 */
export function laneLabelOnPick(lane: FundingLane, venueLabel: string, pair: string): string {
  return lane.namedByBuilder ? lane.label : laneIdentity(venueLabel, pair);
}

/**
 * ══ A LANE ID IS MINTED AGAINST THE IDS ALREADY IN PLAY ═══════════════════
 *
 * ── THE DEFECT THIS CLOSES (recette FUND-LANE-ID-COLLISION) ──────────────
 * The sequence was a module-level counter that THREE call sites reset to
 * zero, and one of them — `parseCopilotPrompt`'s build branch — reset it for
 * a portfolio that was only PROPOSED. So: open `?template=funding-carry`
 * (fl_1, fl_2, counter at 2), ask the copilot for a single-venue build (the
 * counter is reset and spends 1 on a lane the canvas is not holding),
 * press `Keep mine`, then `＋ Add a venue` — and the counter, sitting at 1,
 * minted `fl_2` a second time. Two lanes then shared one key in
 * `allocationsBps`, `perLane` and the React tree: both printed 30%, the HYPE
 * lane rendered the Aster lane's economics, Review refused for a book the
 * visible lane does not short, and `remove` on either deleted both.
 *
 * THE FIX IS THE ID SOURCE, not the reset. A counter that any caller may
 * rewind is a counter that will be rewound again; ids are derived from the
 * ids that EXIST, so a mint can only ever go past them. The module counter
 * survives for the one caller that legitimately has no portfolio to look at
 * (a bare `newLane` in a test or a from-scratch seed), it never resets, and
 * it is raised by every derived mint so the two sources cannot cross.
 *
 * ⚠ AND IT STAYS DETERMINISTIC, which is why this is not a uuid. `/build` is
 * a server component: `FundingCanvas` renders on the server and hydrates on
 * the client, and a lane id reaches the DOM (`data-jack="fl_1/perp-market:bus"`).
 * A counter that carried across requests, or a random id, would put two
 * different strings in the two renders. `demoPortfolio` and `emptyPortfolio`
 * mint against an EXPLICIT id list, so a template deep link produces fl_1 /
 * fl_2 on both sides of the wire, every time.
 */
const LANE_ID_RE = /^fl_(\d+)$/;

/** One past the highest `fl_<n>` in `existingIds`. */
export function nextLaneSeq(existingIds: readonly string[]): number {
  let hi = 0;
  for (const id of existingIds) {
    const m = LANE_ID_RE.exec(id);
    if (m) hi = Math.max(hi, Number(m[1]));
  }
  return hi + 1;
}

/** The id a lane added to this set would take. */
export function nextLaneId(existingIds: readonly string[]): string {
  return `fl_${nextLaneSeq(existingIds)}`;
}

/** ⚠ NEVER RESET. See the block above: the reset WAS the bug. */
let laneSeq = 0;

export function newLane(
  venueId: string,
  marketId: string,
  label?: string,
  /** The ids already in play. Every caller that appends to a LIVE portfolio
   *  passes them; omitting them falls back to the module sequence, which is
   *  correct only when there is no portfolio to collide with. */
  existingIds?: readonly string[],
): FundingLane {
  const seq = existingIds ? nextLaneSeq(existingIds) : laneSeq + 1;
  // The two sources never cross: a bare mint after a derived one starts past
  // it, and a derived mint never rewinds the bare one.
  laneSeq = Math.max(laneSeq, seq);
  const v = venueOf(venueId);
  const pair = marketOf(marketId)?.market.pair ?? "";
  return {
    id: `fl_${seq}`,
    /* A SEATED LANE IS NAMED AFTER WHAT IT TRADES. Only a lane with no market
       yet falls back to the sequence number — the one case where the venue
       alone cannot collide, because a nameless lane has nothing to name. */
    label: label ?? (pair ? laneIdentity(v?.label ?? "Venue", pair) : `${v?.label ?? "Venue"} ${seq}`),
    /* Even an explicit `label` here is a MINTED name (the marketless
       placeholder, a seed's product name), never a typed one: only the rename
       affordance may claim the label for the builder. */
    namedByBuilder: false,
    venueId,
    marketId,
    placed: ["perp-market", "basis-engine", "funding-guard", "auto-compound"],
    params: {
      ...FUNDING_LANE_DEFAULTS,
      guardWindowH: FUNDING_PARAM_BOUNDS.guardWindowH[1] ?? 24,
      cadence: "24h",
      minActionUsd: FUNDING_PARAM_BOUNDS.minActionUsd.default,
    },
  };
}

/** Cold start: one empty lane, so the copilot (or the user) visibly builds
 *  the portfolio. The canvas never opens on a fabricated pre-built state. */
export function emptyPortfolio(): FundingPortfolio {
  // An EXPLICIT empty id set, never a counter reset: this is the canvas's
  // first paint on both the server and the client, so the id must be `fl_1`
  // whatever else this module has minted in the process's life.
  const a = newLane("hyperliquid", "", "Venue 1", []);
  a.placed = [];
  return { lanes: [a], allocationsBps: { [a.id]: 10000 }, routerPolicy: "follow-funding" };
}

/** The seeded demo (?seed=1): three venues, three lanes, router live. */
/**
 * The seeded demo, on MEASURED books only (P0-2).
 *
 * It used to seed Hyperliquid ETH, Aster BTC and Avantis ETH. Deposit room is
 * the scanner's now, and no rack row shorts an Aster or an Avantis book, so
 * two of those three lanes could state no capacity — which correctly left the
 * canvas's own default state unable to reach Review. A default that cannot
 * publish is a dead end, and the honest repair is to seed what we measure
 * rather than to soften the rule.
 *
 * Two Hyperliquid books rather than one venue three times: the router still
 * has two lanes to move capital between, and ETH and HYPE are separate books,
 * so the shared-resource minimum is still demonstrated on distinct resources.
 */
export function demoPortfolio(): FundingPortfolio {
  /* NO EXPLICIT LABELS. Both lanes sit on Hyperliquid, so a venue-only name
     gave the template two lane pickers reading the same eight characters.
     `newLane` derives `Hyperliquid · ETH-USD` / `Hyperliquid · HYPE-USD` from
     the market each lane actually trades. */
  // Explicit id sets, for `emptyPortfolio`'s reason: a template deep link
  // must seed fl_1 / fl_2 on the server and on the client alike.
  const a = newLane("hyperliquid", "hyperliquid:ETH", undefined, []);
  const b = newLane("hyperliquid", "hyperliquid:HYPE", undefined, [a.id]);
  return {
    lanes: [a, b],
    allocationsBps: { [a.id]: 6500, [b.id]: 3500 },
    routerPolicy: "follow-funding",
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Copilot intent parser (demo). Deterministic, offline, honest: it reads
// venues / coins / risk words / "ethena" from the prompt and composes the
// portfolio through the same constructors the canvas uses. Unknown prompts
// get an honest "here is what I can do" instead of an invented answer.
// ─────────────────────────────────────────────────────────────────────────

export interface CopilotBuild {
  kind: "build";
  portfolio: FundingPortfolio;
  summary: string;
  steps: string[];
}
export interface CopilotRisk {
  kind: "risk";
  /** The four values the edit writes. The caller applies them verbatim; there
   *  is no adjective to translate at either end. */
  preset: ShortLegPreset;
  summary: string;
}
export interface CopilotExplain {
  kind: "explain";
  summary: string;
}
export interface CopilotUnknown {
  kind: "unknown";
  summary: string;
}
export type CopilotResult = CopilotBuild | CopilotRisk | CopilotExplain | CopilotUnknown;

const VENUE_ALIASES: Record<string, string> = {
  hyperliquid: "hyperliquid",
  hl: "hyperliquid",
  hype: "hyperliquid",
  aster: "aster",
  avantis: "avantis",
  base: "avantis",
};
const COIN_ALIASES: Record<string, string> = {
  eth: "ETH",
  ether: "ETH",
  ethereum: "ETH",
  btc: "BTC",
  bitcoin: "BTC",
  sol: "SOL",
  solana: "SOL",
  hype: "HYPE",
  bnb: "BNB",
};

/* The parser's INPUT vocabulary lives in `prompt-vocabulary.ts` — words the
   product understands and never says. It moved out of this file when the risk
   adjectives were banned from every rendered surface: understanding "make
   every lane safer" is correct, and it must not share a file with the strings
   this module replies with. See that module's docblock. */

/**
 * Best market on a venue for the strategy: highest expected carry at the
 * PRICED percentile (p25 funding + spot yield). It ranked on the median,
 * which is not the number the lane is priced on.
 */
function bestMarket(venueId: string, preferCoin: string | null): FundingMarket | null {
  const v = venueOf(venueId);
  if (!v) return null;
  if (preferCoin) {
    const m = v.markets.find((x) => x.coin === preferCoin);
    if (m) return m;
  }
  const ranked = [...v.markets]
    .filter((m) => m.positiveShare >= 0.7)
    .sort((a, b) => b.fundingP25Apr + b.spotYieldApr - (a.fundingP25Apr + a.spotYieldApr));
  return ranked[0] ?? v.markets[0] ?? null;
}

export function parseCopilotPrompt(
  prompt: string,
  current: FundingPortfolio,
  books?: PerpBookIndex | null,
): CopilotResult {
  const p = prompt.toLowerCase();
  const words = p.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);

  const venues: string[] = [];
  for (const w of words) {
    const v = VENUE_ALIASES[w];
    if (v && !venues.includes(v)) venues.push(v);
  }
  let coin: string | null = null;
  for (const w of words) {
    if (COIN_ALIASES[w] && w !== "hype") {
      coin = COIN_ALIASES[w];
      break;
    }
  }
  const ethena = p.includes("ethena") || p.includes("steth") || p.includes("usde");
  if (ethena && !coin) coin = "ETH";

  /* THE USER'S OWN VOCABULARY IS STILL PARSED — it is an INPUT, and refusing
     to understand "make every lane safer" would be pedantry. What changed is
     that nothing is STORED or RENDERED as a word: the match resolves straight
     to one of the three numeric bundles, and the reply states the four values
     it wrote. */
  /* The user's own vocabulary is an INPUT and is matched in
     `prompt-vocabulary.ts`. It resolves to an index into the numeric bundles;
     no word is stored on a lane and no word is replied. */
  const riskIdx = shortLegIndexFromPrompt(p);
  const risk: ShortLegPreset | null = riskIdx === null ? null : SHORT_LEG_PRESETS[riskIdx];

  // EXPLAIN WINS FIRST (F5). "what is the difference between hyperliquid and
  // aster" names two venues, and the venue-count heuristic used to classify
  // it as a build and replace the whole canvas with it. A question is a
  // question no matter how many nouns it contains.
  const wantsExplain = /\b(explain|what is|what's|whats|why|how does|how do|difference|compare|which)\b/.test(p);
  if (wantsExplain) {
    if (p.includes("guard")) {
      return {
        kind: "explain",
        summary:
          "The funding guard watches the funding print on the lane's market. When funding stays under your floor for the window, it closes the perp short and parks the capital in spot yield, then re-arms once funding recovers. A longer window confirms less often, so the lane parks less and pays fewer round trips; a shorter one reacts sooner and pays for it.",
      };
    }
    /* P0-2. The canvas offers nine markets and can state deposit room for
       the handful we actually scan, so "which books have we scanned" is now
       a first-class question rather than a footnote. Deliberately names no
       coin list: the answer is a RULE, and a hardcoded list goes stale the
       first time the rack picks up another market. */
    if (p.includes("scan") || p.includes("measur") || p.includes("capacity") || p.includes("room")) {
      return {
        kind: "explain",
        summary:
          "Deposit room is the depth our own scanner measured on the perp book a lane would short, divided by that lane's escrow share. We measure a book only where a lending market on the rack already shorts it, which today means Hyperliquid books and no others. Any market outside that states no room at all rather than a friendly number, and it cannot be published.",
      };
    }
    if (p.includes("avantis") && (p.includes("cap") || p.includes("small"))) {
      return {
        kind: "explain",
        summary:
          "We do not scan the Avantis book, so an Avantis lane states no deposit room and cannot be published. Deposit room comes from the depth our own scanner measured, and the only perp books we measure today are the ones a lending market on the rack already shorts.",
      };
    }
    if (venues.length >= 2 || p.includes("difference") || p.includes("compare")) {
      return {
        kind: "explain",
        summary:
          "The venues differ in book depth and funding, and that is what sets a lane's carry. Capacity is a separate question and a harder one: it is the depth we measured, so a venue we do not scan states no room at all rather than a friendly number. Every lane here is priced on the same p25 funding print, so the carry is comparable line for line."
      };
    }
    if (p.includes("apy") || p.includes("yield") || p.includes("return")) {
      return {
        kind: "explain",
        summary:
          "Net APY = funding collected on the hedged notional + spot yield on the long leg (staked ETH earns ~3%), minus venue fees, rebalance costs and the guard's round trips. The hedged notional is the escrow share f_b = L/(L+1+r·L): leverage frees capital into the spot leg, it does not multiply the carry. Priced on the trailing p25 funding print, never realized.",
      };
    }
    return {
      kind: "explain",
      summary:
        "This canvas composes a delta-neutral basis trade: spot long, perp short at equal notional, funding collected, a guard that de-risks when funding flips, and a router that allocates across venues. Ask me to build one over specific venues, or to change the short leverage and the guard floor on every lane.",
    };
  }

  // "make every lane safer" / "switch to max" are risk edits on the existing
  // canvas, never rebuilds: a risk word with no venue named wins.
  // `make` is NOT a build verb: it is the verb of "make every lane safer".
  const buildVerb = /\b(build|create|compose|replicate|deploy|design|set ?up|launch)\b/.test(p);
  const riskOnly = risk !== null && venues.length === 0 && !buildVerb;
  const wantsBuild = !riskOnly && (buildVerb || venues.length >= 2);

  if (risk && !wantsBuild && venues.length === 0) {
    return {
      kind: "risk",
      preset: risk,
      /* The reply IS the four numbers. It used to lead with the adjective and
         then list them, which taught the user that the word was the thing and
         the numbers were its footnote. */
      summary:
        `Every lane to ${lev(risk.hedgeLeverage)} short, ` +
        `${pct(risk.marginReserve, 0)} margin reserve, ` +
        `guard floor at ${pct(risk.guardFloorApr, 0)}.`,
    };
  }

  if (wantsBuild) {
    // An unrecognised venue must reach the unknown branch rather than be
    // silently replaced by all three (F5). A word sitting where a venue name
    // sits, that is not a venue and not filler, is an unknown venue.
    if (venues.length === 0) {
      const named = words.filter(
        (w, i) =>
          i > 0 &&
          /^(over|on|across|using|via|with|between)$/.test(words[i - 1]) &&
          !VENUE_STOPWORDS.has(w) &&
          !COIN_ALIASES[w] &&
          !VENUE_ALIASES[w],
      );
      if (named.length > 0) {
        return {
          kind: "unknown",
          summary: `I do not know ${named[0]}. I can build on Hyperliquid, Aster and Avantis.`,
        };
      }
    }
    const useVenues = venues.length > 0 ? venues : ["hyperliquid", "aster", "avantis"];
    /* ⚠ THIS RESET `laneSeq = 0` AND THAT WAS FUND-LANE-ID-COLLISION. What is
       built here is a PROPOSAL: the canvas may never accept it (`Keep mine`,
       or `Undo` after `Build it`), and rewinding a global counter on its way
       past handed the NEXT real lane an id the canvas was still holding. A
       proposal now mints past the ids in play, so declining it costs nothing
       and accepting it collides with nothing. */
    const taken = current.lanes.map((l) => l.id);
    const lanes: FundingLane[] = [];
    for (const vId of useVenues) {
      const m = bestMarket(vId, coin);
      if (!m) continue;
      /* NO EXPLICIT LABEL (recette 2026-08-27): this passed `v.label`, so
         "build a funding rate strategy on the Hyperliquid books we scan"
         composed three lanes all named `Hyperliquid`. `newLane` names each
         one after the market it picked. */
      const lane = newLane(vId, m.id, undefined, [...taken, ...lanes.map((l) => l.id)]);
      if (risk) lane.params = { ...lane.params, ...risk };
      lanes.push(lane);
    }
    if (lanes.length === 0) {
      return { kind: "unknown", summary: "I could not find any of those venues. I know Hyperliquid, Aster and Avantis, though only Hyperliquid books are ones we have scanned for depth." };
    }
    // Allocation by capacity share, largest remainder, floored so every lane
    // is visible on the router.
    //
    // This MUST see the measured books. Without them every capacity is null,
    // every weight floors to 1, and the router splits capital evenly across
    // books of wildly different depth while still calling itself
    // "allocation by capacity share".
    const weights: Record<string, number> = {};
    for (const l of lanes) weights[l.id] = Math.max(1, laneEconomics(l, books)?.capacityUsd ?? 0);
    const allocationsBps = normalizeAllocationsBps(weights, lanes.map((l) => l.id));
    const portfolio: FundingPortfolio = { lanes, allocationsBps, routerPolicy: "follow-funding" };
    const econ = portfolioEconomics(portfolio, books);
    const steps = lanes.map((l) => {
      const hit = marketOf(l.marketId)!;
      const e = econ.perLane[l.id];
      /* ⚠ `guard armed` DIED HERE (recette 2026-08-27). Nothing on this canvas
         is armed: the whole rack's arming state reads `Automations compile in
         shadow · not armed`, and this line claimed a running actuator inside
         the copilot's own account of what it just composed. What replaces it
         is the DIAL the guard was composed at, in the plate's own spelling
         (`floor 5.0%`) — a number the reader can check against the plate two
         inches away, instead of a state nothing can be in yet. */
      return `${hit.venue.label}: ${hit.market.pair}, spot long + ${lev(l.params.hedgeLeverage)} perp short, guard floor ${pct(l.params.guardFloorApr, 1)}, ${pct((allocationsBps[l.id] ?? 0) / 10000, 0)} of capital, ${e ? `${pct(e.publishedApr)} modeled` : "pricing"}`;
    });
    return {
      kind: "build",
      portfolio,
      summary: `Built a ${ethena ? "Ethena-style " : ""}funding-rate strategy across ${lanes.length} venue${lanes.length > 1 ? "s" : ""}: ${econ.publishedApr !== null ? `${pct(econ.publishedApr)} blended net APY, modeled` : "pricing"}, ${econ.capacityUsd === null ? "and no deposit room stated, because a lane shorts a book we have not scanned" : `${fmtUsd(econ.capacityUsd)} on the binding resource`}. Capital router set to follow funding.`,
      steps,
    };
  }

  return {
    kind: "unknown",
    summary:
      "I can build a funding-rate strategy over venues (try: build an Ethena-style strategy over Hyperliquid, Aster and Avantis), change the short leverage and the guard floor on every lane, or explain a module.",
  };
}
