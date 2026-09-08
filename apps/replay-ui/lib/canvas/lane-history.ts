/**
 * THE TWO LANES' MEASURED HISTORIES, read for the vault page's instruments.
 *
 * The router reads its rates from `router-history.ts`; the two position-level
 * cards on the same page read here. Both series are captures with a source a
 * reader can go and re-fetch, both are stated by date, and neither is typed:
 * the rows live in `lane-history-data.ts`, which a generator writes from the
 * source JSONs and nobody edits by hand.
 *
 * ── THE RESERVE'S UNBORROWED LIQUIDITY (the Redemption route card) ────────
 * DefiLlama's `tvlUsd` on a lending pool is SUPPLIED MINUS BORROWED, which is
 * exactly the amount an Aave v3 withdraw can take out atomically. It is not
 * the reserve's size: on 2026-09-08 `yields.llama.fi/lendBorrow` read
 * totalSupplyUsd 183,648,434 and totalBorrowUsd 165,483,671 for the same
 * pool, a difference of 18,164,763 against the chart's 18,643,434 the day
 * before. So the card names it what it is, unborrowed liquidity, and never
 * `supply`.
 *
 * ── THE COLLATERAL'S PRICE (the Dynamic leverage card) ────────────────────
 * The loop's health factor moves with the collateral against the loan, so
 * the card draws the pair's MEASURED drift over the window against the trim
 * trigger the record publishes. The Morpho market's oracle type is not
 * published by the API (`oracle.type: Unknown`, 0xF4b17C79…), so the strip is
 * labelled as the pair's market price on Base and not as the oracle's read;
 * what it shows is how far the pair actually moved, in the same unit the
 * foot prints the trigger in.
 */

import {
  COLLATERAL_PRICE_BY_DAY,
  LANE_HISTORY_CAPTURED_AT,
  RESERVE_LIQUIDITY_BY_DAY,
  type CollateralPriceRow,
  type ReserveLiquidityRow,
} from "./lane-history-data";

export { LANE_HISTORY_CAPTURED_AT };
export type { CollateralPriceRow, ReserveLiquidityRow };

/** The venue whose reserve the liquidity series describes. */
export const RESERVE_LIQUIDITY_VENUE = "treasury-ausdc-base";

/** The pair whose price the drift series describes. */
export const COLLATERAL_PRICE_PAIR = "USDe/USDC";

/** The two sources, as a reader can go and re-fetch them. */
export const LANE_HISTORY_SOURCES = {
  reserveLiquidity: {
    provider: "DefiLlama yields",
    pool: "7e0661bf-8cf3-45e6-9424-31916d4c7b84",
    url: "https://yields.llama.fi/chart/7e0661bf-8cf3-45e6-9424-31916d4c7b84",
    label: "Aave v3 Base, USDC reserve, unborrowed liquidity (tvlUsd, supplied minus borrowed), daily",
  },
  collateralPrice: {
    provider: "DefiLlama coins",
    coin: "base:0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34",
    url: "https://coins.llama.fi/chart/base:0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34?span=92&period=1d",
    label: "USDe on Base, USD price, daily, confidence 0.99",
  },
} as const;

/** The reserve's unborrowed liquidity, USD, oldest first. */
export function reserveLiquiditySeries(): number[] {
  return RESERVE_LIQUIDITY_BY_DAY.map((r) => r.usd);
}

/** The last measured day. */
export function reserveLiquidityLatest(): ReserveLiquidityRow | null {
  return RESERVE_LIQUIDITY_BY_DAY[RESERVE_LIQUIDITY_BY_DAY.length - 1] ?? null;
}

/** The thinnest day in the window: the one an exit would have crossed. */
export function reserveLiquidityLow(): ReserveLiquidityRow | null {
  let low: ReserveLiquidityRow | null = null;
  for (const r of RESERVE_LIQUIDITY_BY_DAY) if (low === null || r.usd < low.usd) low = r;
  return low;
}

/** One day of the pair's drift, as a fraction of the window's first price. */
export interface CollateralDriftPoint {
  readonly date: string;
  /** `price / firstPrice - 1`. Negative is adverse for a loop long the collateral. */
  readonly drift: number;
}

export interface CollateralDrift {
  /** Every day, oldest first, in the window's own order. */
  readonly points: readonly CollateralDriftPoint[];
  /** The most adverse day, the minimum drift. */
  readonly worst: CollateralDriftPoint;
  readonly from: string;
  readonly to: string;
  readonly days: number;
}

/**
 * The pair's drift over the window against its first day: what a position
 * opened at target on day one would have seen, day by day, in the unit the
 * trim trigger is stated in.
 */
export function collateralDrift(): CollateralDrift | null {
  const first = COLLATERAL_PRICE_BY_DAY[0];
  const last = COLLATERAL_PRICE_BY_DAY[COLLATERAL_PRICE_BY_DAY.length - 1];
  if (!first || !last || COLLATERAL_PRICE_BY_DAY.length < 2 || !(first.price > 0)) return null;
  const points = COLLATERAL_PRICE_BY_DAY.map((r) => ({ date: r.date, drift: r.price / first.price - 1 }));
  let worst = points[0];
  if (!worst) return null;
  for (const p of points) if (p.drift < worst.drift) worst = p;
  return { points, worst, from: first.date, to: last.date, days: points.length };
}
