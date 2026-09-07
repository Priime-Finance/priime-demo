/**
 * THE ROUTER'S TWO RATE HISTORIES, AS CAPTURED, AND THE TWO PUBLISHED SERIES
 * DERIVED FROM THEM THROUGH THE PRODUCT'S OWN OWNERS.
 *
 * Captured 2026-09-07T15:26:46.090Z. Three daily series, three sources, all
 * of them public and all of them named:
 *
 *   aaveUsdcSupplyPct  Aave v3 Base, USDC reserve, supply APY, daily.
 *                      DefiLlama yields, pool 7e0661bf-8cf3-45e6-9424-31916d4c7b84
 *                      https://yields.llama.fi/chart/7e0661bf-8cf3-45e6-9424-31916d4c7b84
 *                      92 points, 2026-06-08 to 2026-09-07.
 *   loopRewardPct      The USDe incentive on Morpho Base, apyReward, daily.
 *                      DefiLlama yields, pool 2d3b68a8-33d3-47e0-a4c0-0bafef4b01d5
 *                      https://yields.llama.fi/chart/2d3b68a8-33d3-47e0-a4c0-0bafef4b01d5
 *                      apyBase is 0 on every point: USDe collateral earns no
 *                      native rate on Morpho, so the loop's whole collateral
 *                      yield is this incentive. 89 points, 2026-06-11 to
 *                      2026-09-07, and it is ZERO on the first 42 of them.
 *   loopBorrowPct      The loop market's borrow APY, daily. Morpho Blue API,
 *                      https://blue-api.morpho.org/graphql, chainId 8453,
 *                      marketId 0x54cf9be57fdfa6457a660991907434ff9d295c465a603a50126ff647d50b7354
 *                      (USDe/USDC at LLTV 0.915, the market lib/demo/market.ts
 *                      pins). 95 daily points, 2026-06-05 to 2026-09-07.
 *
 * ── GAPS ARE STATED, NEVER INTERPOLATED ──────────────────────────────────
 * The three series do not start on the same day. `ROUTER_HISTORY` is the
 * UNION of the dates, 95 rows, with `null` on every field a source does not
 * publish for that day; `ROUTER_HISTORY_GAPS` lists those six days by name.
 * `ROUTER_HISTORY_ALIGNED` is the 89-day intersection, every field present,
 * and it is the only window the replay reads. Nothing is carried forward and
 * nothing is averaged into a hole.
 *
 * ── THE DUPLICATE THE CAPTURE CARRIES, AND WHICH POINT WINS ──────────────
 * The Morpho borrow array holds 96 entries for 95 dates: 2026-09-07 appears
 * twice, at 4.0106 and at 5.0869. The raw response
 * (scratchpad morpho-market-history.json) shows why: the first entry is
 * x = 1788795213, the capture instant, and the second is x = 1788739200,
 * midnight UTC, which is where every other point in the series sits. The
 * daily series therefore keeps the MIDNIGHT point, so all 95 rows are on one
 * clock, and the capture-instant read is exposed separately as
 * `ROUTER_BORROW_SPOT_PCT`. It is not used by any comparison: the Aave series
 * has no intraday point, and comparing an intraday loop against a midnight
 * floor compares two clocks. The gap between them is 1.08pp of borrow, which
 * is 1.62pp of published loop APY at HERO_SEED_LEVERAGE, so this is not a
 * rounding matter.
 *
 * ── THE TWO PUBLISHED SERIES HAVE ONE OWNER EACH ─────────────────────────
 * `loopPublishedApyByDay(L)` prices the demo's own row with that day's
 * incentive as `collateralYieldApy` and that day's borrow as
 * `borrowApyMarginal`, then runs it through `repriceAtLeverage` and
 * `publishedNetApy` from lib/canvas/mock-quote.ts. It is the same call the
 * lane header, the review sheet and the record make, so no surface can
 * disagree with the chart.
 *
 * `floorPublishedApyByDay()` prices the treasury issuer row the SAME way the
 * shipped row is priced: `treasuryModel` (lib/canvas/templates.ts) takes one
 * input, `facts.apyMean30d`, and that input is fed the day's Aave supply APY.
 * The row is then run through `publishedNetApy`, which is where the 20%
 * compute fee enters (`applyComputeFee` in lib/canvas/fees.ts, one
 * subtraction, one owner). `apyMean30d` is a 30-day MEAN and a daily supply
 * APY is a spot reading: feeding a spot number into a field named for a mean
 * is stated here rather than hidden, and it is the honest choice because the
 * router compares two lanes DAY BY DAY and a trailing mean on one side only
 * would lag the other by a fortnight.
 *
 * No surface retypes any figure in this file. The published-today pair is
 * `routerPublishedToday()`.
 */

import { pct } from "@/lib/canvas/format";
import { publishedNetApy, repriceAtLeverage } from "@/lib/canvas/mock-quote";
import type { ProjectedCandidate } from "@/lib/canvas/opportunities";
import {
  TREASURY_CANDIDATES,
  issuerRedemptionTerms,
  treasuryIssuerFacts,
  treasuryIssuerRegisterFor,
  treasuryModel,
  type HandAuthoredCandidate,
} from "@/lib/canvas/templates";
import { HERO_SEED_LEVERAGE, demoMarketCandidate } from "@/lib/demo/market";

/** The capture instant, verbatim from the capture file's `capturedAt`. */
export const ROUTER_HISTORY_CAPTURED_AT = "2026-09-07T15:26:46.090Z";

/** The three sources, as a reader can go and re-fetch them. */
export const ROUTER_HISTORY_SOURCES = {
  aaveUsdcSupply: {
    provider: "DefiLlama yields",
    pool: "7e0661bf-8cf3-45e6-9424-31916d4c7b84",
    url: "https://yields.llama.fi/chart/7e0661bf-8cf3-45e6-9424-31916d4c7b84",
    label: "Aave v3 Base, USDC reserve, supply APY",
  },
  loopReward: {
    provider: "DefiLlama yields",
    pool: "2d3b68a8-33d3-47e0-a4c0-0bafef4b01d5",
    url: "https://yields.llama.fi/chart/2d3b68a8-33d3-47e0-a4c0-0bafef4b01d5",
    label: "USDe incentive on Morpho Base, apyReward",
  },
  loopBorrow: {
    provider: "Morpho Blue API",
    endpoint: "https://blue-api.morpho.org/graphql",
    marketId: "0x54cf9be57fdfa6457a660991907434ff9d295c465a603a50126ff647d50b7354",
    chainId: 8453,
    label: "USDe/USDC borrow APY, Morpho Blue Base",
  },
} as const;

/**
 * The capture-instant borrow read, 2026-09-07T15:26:46Z. Kept OUT of the
 * daily series (see the header) and exposed so a surface that wants to say
 * "the market is at X right now" can, without moving the comparison.
 */
export const ROUTER_BORROW_SPOT_PCT = 4.0106;

/** One day. Percent, exactly as the sources publish it; `null` is a measured
 *  absence and never a zero. */
export interface RouterHistoryRow {
  readonly date: string;
  readonly aaveUsdcSupplyPct: number | null;
  readonly loopRewardPct: number | null;
  readonly loopBorrowPct: number | null;
}

/** The union of the three series' dates, 95 rows, oldest first. */
export const ROUTER_HISTORY: readonly RouterHistoryRow[] = [
  { date: "2026-06-05", aaveUsdcSupplyPct: null, loopRewardPct: null, loopBorrowPct: 3.2786 },
  { date: "2026-06-06", aaveUsdcSupplyPct: null, loopRewardPct: null, loopBorrowPct: 3.2934 },
  { date: "2026-06-07", aaveUsdcSupplyPct: null, loopRewardPct: null, loopBorrowPct: 3.3011 },
  { date: "2026-06-08", aaveUsdcSupplyPct: 3.1814, loopRewardPct: null, loopBorrowPct: 4.3992 },
  { date: "2026-06-09", aaveUsdcSupplyPct: 3.142, loopRewardPct: null, loopBorrowPct: 3.3178 },
  { date: "2026-06-10", aaveUsdcSupplyPct: 3.1891, loopRewardPct: null, loopBorrowPct: 3.3363 },
  { date: "2026-06-11", aaveUsdcSupplyPct: 3.2185, loopRewardPct: 0, loopBorrowPct: 0.9206 },
  { date: "2026-06-12", aaveUsdcSupplyPct: 3.1232, loopRewardPct: 0, loopBorrowPct: 5.1735 },
  { date: "2026-06-13", aaveUsdcSupplyPct: 3.1171, loopRewardPct: 0, loopBorrowPct: 3.3819 },
  { date: "2026-06-14", aaveUsdcSupplyPct: 3.1751, loopRewardPct: 0, loopBorrowPct: 5.115 },
  { date: "2026-06-15", aaveUsdcSupplyPct: 3.1959, loopRewardPct: 0, loopBorrowPct: 6.0694 },
  { date: "2026-06-16", aaveUsdcSupplyPct: 3.1808, loopRewardPct: 0, loopBorrowPct: 5.6586 },
  { date: "2026-06-17", aaveUsdcSupplyPct: 3.2379, loopRewardPct: 0, loopBorrowPct: 5.4926 },
  { date: "2026-06-18", aaveUsdcSupplyPct: 3.1351, loopRewardPct: 0, loopBorrowPct: 5.1592 },
  { date: "2026-06-19", aaveUsdcSupplyPct: 3.1364, loopRewardPct: 0, loopBorrowPct: 5.2365 },
  { date: "2026-06-20", aaveUsdcSupplyPct: 3.0814, loopRewardPct: 0, loopBorrowPct: 4.5528 },
  { date: "2026-06-21", aaveUsdcSupplyPct: 3.0843, loopRewardPct: 0, loopBorrowPct: 5.5432 },
  { date: "2026-06-22", aaveUsdcSupplyPct: 3.0991, loopRewardPct: 0, loopBorrowPct: 4.9804 },
  { date: "2026-06-23", aaveUsdcSupplyPct: 3.0962, loopRewardPct: 0, loopBorrowPct: 4.4135 },
  { date: "2026-06-24", aaveUsdcSupplyPct: 3.1413, loopRewardPct: 0, loopBorrowPct: 3.3993 },
  { date: "2026-06-25", aaveUsdcSupplyPct: 3.1751, loopRewardPct: 0, loopBorrowPct: 3.4116 },
  { date: "2026-06-26", aaveUsdcSupplyPct: 3.1482, loopRewardPct: 0, loopBorrowPct: 3.5037 },
  { date: "2026-06-27", aaveUsdcSupplyPct: 3.1546, loopRewardPct: 0, loopBorrowPct: 3.4876 },
  { date: "2026-06-28", aaveUsdcSupplyPct: 3.1581, loopRewardPct: 0, loopBorrowPct: 3.4944 },
  { date: "2026-06-29", aaveUsdcSupplyPct: 3.1806, loopRewardPct: 0, loopBorrowPct: 3.491 },
  { date: "2026-06-30", aaveUsdcSupplyPct: 3.2252, loopRewardPct: 0, loopBorrowPct: 6.3306 },
  { date: "2026-07-01", aaveUsdcSupplyPct: 3.1644, loopRewardPct: 0, loopBorrowPct: 3.5235 },
  { date: "2026-07-02", aaveUsdcSupplyPct: 3.1206, loopRewardPct: 0, loopBorrowPct: 3.5493 },
  { date: "2026-07-03", aaveUsdcSupplyPct: 3.1422, loopRewardPct: 0, loopBorrowPct: 5.7979 },
  { date: "2026-07-04", aaveUsdcSupplyPct: 3.085, loopRewardPct: 0, loopBorrowPct: 5.4803 },
  { date: "2026-07-05", aaveUsdcSupplyPct: 3.1396, loopRewardPct: 0, loopBorrowPct: 4.2551 },
  { date: "2026-07-06", aaveUsdcSupplyPct: 3.0926, loopRewardPct: 0, loopBorrowPct: 4.7376 },
  { date: "2026-07-07", aaveUsdcSupplyPct: 3.0807, loopRewardPct: 0, loopBorrowPct: 3.7839 },
  { date: "2026-07-08", aaveUsdcSupplyPct: 3.1195, loopRewardPct: 0, loopBorrowPct: 7.4733 },
  { date: "2026-07-09", aaveUsdcSupplyPct: 3.1436, loopRewardPct: 0, loopBorrowPct: 3.5662 },
  { date: "2026-07-10", aaveUsdcSupplyPct: 3.0578, loopRewardPct: 0, loopBorrowPct: 3.6218 },
  { date: "2026-07-11", aaveUsdcSupplyPct: 3.0514, loopRewardPct: 0, loopBorrowPct: 4.9332 },
  { date: "2026-07-12", aaveUsdcSupplyPct: 3.1195, loopRewardPct: 0, loopBorrowPct: 4.7444 },
  { date: "2026-07-13", aaveUsdcSupplyPct: 3.1468, loopRewardPct: 0, loopBorrowPct: 3.661 },
  { date: "2026-07-14", aaveUsdcSupplyPct: 3.0142, loopRewardPct: 0, loopBorrowPct: 3.7829 },
  { date: "2026-07-15", aaveUsdcSupplyPct: 3.0253, loopRewardPct: 0, loopBorrowPct: 5.0604 },
  { date: "2026-07-16", aaveUsdcSupplyPct: 3.0234, loopRewardPct: 0, loopBorrowPct: 4.755 },
  { date: "2026-07-17", aaveUsdcSupplyPct: 3.0656, loopRewardPct: 0, loopBorrowPct: 5.0688 },
  { date: "2026-07-18", aaveUsdcSupplyPct: 3.1021, loopRewardPct: 0, loopBorrowPct: 4.8644 },
  { date: "2026-07-19", aaveUsdcSupplyPct: 3.1028, loopRewardPct: 0, loopBorrowPct: 4.3331 },
  { date: "2026-07-20", aaveUsdcSupplyPct: 2.9816, loopRewardPct: 0, loopBorrowPct: 4.395 },
  { date: "2026-07-21", aaveUsdcSupplyPct: 2.703, loopRewardPct: 0, loopBorrowPct: 4.3952 },
  { date: "2026-07-22", aaveUsdcSupplyPct: 2.7196, loopRewardPct: 0, loopBorrowPct: 3.753 },
  { date: "2026-07-23", aaveUsdcSupplyPct: 3.4094, loopRewardPct: 4.5, loopBorrowPct: 5.18 },
  { date: "2026-07-24", aaveUsdcSupplyPct: 3.3988, loopRewardPct: 4.5, loopBorrowPct: 4.2431 },
  { date: "2026-07-25", aaveUsdcSupplyPct: 3.5322, loopRewardPct: 4.5, loopBorrowPct: 4.8532 },
  { date: "2026-07-26", aaveUsdcSupplyPct: 3.4855, loopRewardPct: 4.5, loopBorrowPct: 4.8835 },
  { date: "2026-07-27", aaveUsdcSupplyPct: 3.4534, loopRewardPct: 4.5, loopBorrowPct: 3.6579 },
  { date: "2026-07-28", aaveUsdcSupplyPct: 3.5422, loopRewardPct: 4.5, loopBorrowPct: 4.749 },
  { date: "2026-07-29", aaveUsdcSupplyPct: 3.5236, loopRewardPct: 4.5, loopBorrowPct: 3.6751 },
  { date: "2026-07-30", aaveUsdcSupplyPct: 3.4382, loopRewardPct: 4.5, loopBorrowPct: 4.849 },
  { date: "2026-07-31", aaveUsdcSupplyPct: 3.5467, loopRewardPct: 4.5, loopBorrowPct: 4.2371 },
  { date: "2026-08-01", aaveUsdcSupplyPct: 3.547, loopRewardPct: 4.5, loopBorrowPct: 5.1402 },
  { date: "2026-08-02", aaveUsdcSupplyPct: 3.4823, loopRewardPct: 4.5, loopBorrowPct: 4.8645 },
  { date: "2026-08-03", aaveUsdcSupplyPct: 3.4565, loopRewardPct: 4.5, loopBorrowPct: 4.8119 },
  { date: "2026-08-04", aaveUsdcSupplyPct: 3.3331, loopRewardPct: 4.5, loopBorrowPct: 4.6817 },
  { date: "2026-08-05", aaveUsdcSupplyPct: 3.3443, loopRewardPct: 4.4605, loopBorrowPct: 4.8482 },
  { date: "2026-08-06", aaveUsdcSupplyPct: 3.3655, loopRewardPct: 4.4687, loopBorrowPct: 3.6032 },
  { date: "2026-08-07", aaveUsdcSupplyPct: 3.2648, loopRewardPct: 4.4384, loopBorrowPct: 4.7329 },
  { date: "2026-08-08", aaveUsdcSupplyPct: 3.3834, loopRewardPct: 4.3567, loopBorrowPct: 3.917 },
  { date: "2026-08-09", aaveUsdcSupplyPct: 3.4467, loopRewardPct: 4.2865, loopBorrowPct: 4.2782 },
  { date: "2026-08-10", aaveUsdcSupplyPct: 3.5826, loopRewardPct: 4.2673, loopBorrowPct: 3.8852 },
  { date: "2026-08-11", aaveUsdcSupplyPct: 3.6021, loopRewardPct: 4.3163, loopBorrowPct: 4.8803 },
  { date: "2026-08-12", aaveUsdcSupplyPct: 3.6364, loopRewardPct: 4.1643, loopBorrowPct: 4.2606 },
  { date: "2026-08-13", aaveUsdcSupplyPct: 3.589, loopRewardPct: 4.5, loopBorrowPct: 4.6694 },
  { date: "2026-08-14", aaveUsdcSupplyPct: 3.5006, loopRewardPct: 4.5, loopBorrowPct: 3.9694 },
  { date: "2026-08-15", aaveUsdcSupplyPct: 3.5536, loopRewardPct: 4.5, loopBorrowPct: 4.2569 },
  { date: "2026-08-16", aaveUsdcSupplyPct: 3.5644, loopRewardPct: 4.5, loopBorrowPct: 5.4532 },
  { date: "2026-08-17", aaveUsdcSupplyPct: 3.9418, loopRewardPct: 4.5, loopBorrowPct: 5.3299 },
  { date: "2026-08-18", aaveUsdcSupplyPct: 3.5216, loopRewardPct: 4.5, loopBorrowPct: 3.7577 },
  { date: "2026-08-19", aaveUsdcSupplyPct: 3.4625, loopRewardPct: 4.5, loopBorrowPct: 5.2199 },
  { date: "2026-08-20", aaveUsdcSupplyPct: 3.4486, loopRewardPct: 4.5, loopBorrowPct: 5.1886 },
  { date: "2026-08-21", aaveUsdcSupplyPct: 3.3316, loopRewardPct: 4.5, loopBorrowPct: 5.2249 },
  { date: "2026-08-22", aaveUsdcSupplyPct: 3.1574, loopRewardPct: 4.5, loopBorrowPct: 5.1638 },
  { date: "2026-08-23", aaveUsdcSupplyPct: 3.1687, loopRewardPct: 4.5, loopBorrowPct: 5.2389 },
  { date: "2026-08-24", aaveUsdcSupplyPct: 3.2264, loopRewardPct: 4.5, loopBorrowPct: 5.2369 },
  { date: "2026-08-25", aaveUsdcSupplyPct: 3.0933, loopRewardPct: 4.5, loopBorrowPct: 5.2316 },
  { date: "2026-08-26", aaveUsdcSupplyPct: 3.0402, loopRewardPct: 4.5, loopBorrowPct: 5.2587 },
  { date: "2026-08-27", aaveUsdcSupplyPct: 3.4047, loopRewardPct: 4.75, loopBorrowPct: 5.3592 },
  { date: "2026-08-28", aaveUsdcSupplyPct: 3.4747, loopRewardPct: 4.75, loopBorrowPct: 3.9192 },
  { date: "2026-08-29", aaveUsdcSupplyPct: 3.4411, loopRewardPct: 4.75, loopBorrowPct: 5.2392 },
  { date: "2026-08-30", aaveUsdcSupplyPct: 3.3873, loopRewardPct: 4.75, loopBorrowPct: 4.7637 },
  { date: "2026-08-31", aaveUsdcSupplyPct: 3.4135, loopRewardPct: 4.75, loopBorrowPct: 3.9536 },
  { date: "2026-09-01", aaveUsdcSupplyPct: 4.3508, loopRewardPct: 4.75, loopBorrowPct: 3.927 },
  { date: "2026-09-02", aaveUsdcSupplyPct: 3.6925, loopRewardPct: 4.75, loopBorrowPct: 5.2631 },
  { date: "2026-09-03", aaveUsdcSupplyPct: 3.6885, loopRewardPct: 4.75, loopBorrowPct: 5.091 },
  { date: "2026-09-04", aaveUsdcSupplyPct: 3.8419, loopRewardPct: 4.75, loopBorrowPct: 5.3349 },
  { date: "2026-09-05", aaveUsdcSupplyPct: 3.8508, loopRewardPct: 4.75, loopBorrowPct: 5.1783 },
  { date: "2026-09-06", aaveUsdcSupplyPct: 3.7028, loopRewardPct: 4.75, loopBorrowPct: 5.1565 },
  { date: "2026-09-07", aaveUsdcSupplyPct: 3.7136, loopRewardPct: 4.75, loopBorrowPct: 5.0869 },];

/**
 * The six days a source does not cover, named. Three at the head where only
 * the Morpho borrow series reaches back, and three more where the incentive
 * series has not started.
 */
export const ROUTER_HISTORY_GAPS: readonly { readonly date: string; readonly missing: readonly string[] }[] = [
  { date: "2026-06-05", missing: ["aaveUsdcSupplyApy", "loopRewardApr"] },
  { date: "2026-06-06", missing: ["aaveUsdcSupplyApy", "loopRewardApr"] },
  { date: "2026-06-07", missing: ["aaveUsdcSupplyApy", "loopRewardApr"] },
  { date: "2026-06-08", missing: ["loopRewardApr"] },
  { date: "2026-06-09", missing: ["loopRewardApr"] },
  { date: "2026-06-10", missing: ["loopRewardApr"] },
];

/** A day on which all three sources published. */
export interface RouterHistoryAlignedRow {
  readonly date: string;
  readonly aaveUsdcSupplyApy: number;
  readonly loopRewardApr: number;
  readonly loopBorrowApy: number;
}

/** Percent to fraction. The ONE conversion in this file, so the table above
 *  stays byte-comparable with the capture and nothing downstream divides. */
function frac(pct: number): number {
  return pct / 100;
}

/**
 * The 89 days all three sources cover, 2026-06-11 to 2026-09-07, contiguous.
 * Derived by intersection rather than by slicing, so a future re-capture with
 * a hole in the middle loses that day instead of silently shifting the axis.
 */
export const ROUTER_HISTORY_ALIGNED: readonly RouterHistoryAlignedRow[] = ROUTER_HISTORY.flatMap((r) =>
  r.aaveUsdcSupplyPct !== null && r.loopRewardPct !== null && r.loopBorrowPct !== null
    ? [
        {
          date: r.date,
          aaveUsdcSupplyApy: frac(r.aaveUsdcSupplyPct),
          loopRewardApr: frac(r.loopRewardPct),
          loopBorrowApy: frac(r.loopBorrowPct),
        },
      ]
    : [],
);

/** One day of a derived series. */
export interface RouterApyPoint {
  readonly date: string;
  readonly apy: number;
}

// ── The loop lane's published series ──────────────────────────────────────

/**
 * The demo's own row with one day's two rates substituted.
 *
 * ONLY the two measured inputs move. The liquidation threshold, the
 * scan-shaped ceiling, the class and the capacity are the row's own and stay
 * exactly where lib/demo/market.ts put them, so this is the same market on
 * every day of the replay and not 89 different ones.
 */
export function loopRowForDay(day: RouterHistoryAlignedRow): ProjectedCandidate {
  const row = demoMarketCandidate();
  const e = row.economics;
  if (!e) return row;
  return {
    ...row,
    economics: { ...e, collateralYieldApy: day.loopRewardApr, borrowApyMarginal: day.loopBorrowApy },
  };
}

/**
 * The loop lane's PUBLISHED APY on every aligned day, at leverage `L`.
 *
 * `publishedNetApy(repriceAtLeverage(row, L), false)`: the reprice is the
 * model's own affine arithmetic at the lane's leverage, and `publishedNetApy`
 * is where the house compute fee lands. `false` is `hasHedge`: this row is
 * class N1 and can seat no perp leg, so the argument cannot move the number,
 * and it is passed explicitly rather than defaulted.
 *
 * Null is impossible on an aligned row (the economics are present by
 * construction), so a null would be a broken owner and the day is dropped
 * rather than filled with a zero.
 */
export function loopPublishedApyByDay(L: number = HERO_SEED_LEVERAGE): readonly RouterApyPoint[] {
  return ROUTER_HISTORY_ALIGNED.flatMap((day) => {
    const apy = publishedNetApy(repriceAtLeverage(loopRowForDay(day), L), false);
    return apy === null ? [] : [{ date: day.date, apy }];
  });
}

// ── The floor lane's published series ─────────────────────────────────────

/** The issuer row R1 names: Aave v3 Base, USDC reserve, the treasury family. */
export const ROUTER_FLOOR_CANDIDATE_ID = "template:treasury-floor:treasury-ausdc-base:ausdc";

/** The shipped row, found by id rather than by index. */
const FLOOR_ROW: HandAuthoredCandidate | null =
  TREASURY_CANDIDATES.find((c) => c.id === ROUTER_FLOOR_CANDIDATE_ID) ?? null;

/**
 * The floor row priced at one day's Aave supply APY, THROUGH `treasuryModel`.
 *
 * `treasuryModel` is the owner of the mapping from an issuer's one published
 * rate to a family model, and it is exported, so the day's rate is fed to it
 * as `facts.apyMean30d` and every field below is one of ITS outputs. The
 * private `treasuryCandidate` maps those outputs onto the row; that mapping
 * is reproduced here and PINNED: `router-backtest.test.ts` asserts that
 * calling this with the issuer's own `apyMean30d` returns the shipped
 * `TREASURY_CANDIDATES` row field for field. If the private mapping ever
 * changes, that assertion fails rather than this file drifting.
 */
export function floorRowForRate(apy: number): HandAuthoredCandidate | null {
  const facts = treasuryIssuerFacts(ROUTER_FLOOR_CANDIDATE_ID);
  const redemption = issuerRedemptionTerms(ROUTER_FLOOR_CANDIDATE_ID);
  if (!FLOOR_ROW || !facts || !redemption) return null;
  /* ⚠ THE REGISTER TRAVELS WITH THE ROW. This rebuilds the issuer from its
     parts to price it on a measured day, and the reserve's own capacity
     binding and leg label live on the issuer, not in the family's model. A
     rebuild that dropped them printed `the fund's outstanding tokenized
     shares` and `Issuer rate, 30-day mean` back onto a lending pool on every
     surface the router serves. */
  const register = treasuryIssuerRegisterFor(ROUTER_FLOOR_CANDIDATE_ID);
  const fit = treasuryModel({
    venue: "treasury-ausdc-base",
    token: "aUSDC",
    facts: { ...facts, apyMean30d: apy },
    redemption,
    ...(register ? { register } : {}),
  });
  return {
    ...FLOOR_ROW,
    headlineApr: fit.netApy,
    apyRiskAdj: fit.netApy,
    economics: {
      ...FLOOR_ROW.economics,
      terms: { ...FLOOR_ROW.economics.terms, hedgelessApy: fit.hedgelessApy, legs: fit.legs },
      netApyOnDepositApy: fit.netApy,
      netCarryOnEquityApy: fit.netCarry,
      collateralYieldApy: fit.netApy,
      capacityUsd: fit.capacityUsd,
      capacityBinding: fit.capacityBinding,
    },
  };
}

/**
 * The floor lane's PUBLISHED APY on every aligned day.
 *
 * Unlevered by construction (`loopLeverage` 1 on the row), so there is no
 * reprice to run: the only thing between the issuer rate and the published
 * number is the compute fee, and `publishedNetApy` is the one place it is
 * applied.
 */
export function floorPublishedApyByDay(): readonly RouterApyPoint[] {
  return ROUTER_HISTORY_ALIGNED.flatMap((day) => {
    const apy = publishedNetApy(floorRowForRate(day.aaveUsdcSupplyApy), false);
    return apy === null ? [] : [{ date: day.date, apy }];
  });
}

/**
 * THE MEASURED DAY, as chrome prints it: `Sep 7, 2026`.
 *
 * Derived from the last aligned row's own `date`, never typed, and read in UTC
 * because UTC midnight is the clock all three sources publish on (see the
 * duplicate-point note in the header). Every surface that says when the pair
 * was measured says it with this string.
 */
export const ROUTER_MEASURED_ON: string = (() => {
  const day = ROUTER_HISTORY_ALIGNED[ROUTER_HISTORY_ALIGNED.length - 1];
  if (!day) return "";
  return new Date(`${day.date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
})();

/**
 * THE LAST ALIGNED DAY, the one every "today" on every surface reads.
 *
 * Exported because three owners need the same day and none of them may pick
 * its own: `routerPublishedToday` below, `floorRowToday` beside it, and
 * `loopRowForDay` in this module, which substitutes a day's two
 * loop rates into the demo row so the canvas and the router price one lane.
 */
export function routerLastAlignedDay(): RouterHistoryAlignedRow | null {
  return ROUTER_HISTORY_ALIGNED[ROUTER_HISTORY_ALIGNED.length - 1] ?? null;
}

/**
 * THE FLOOR LANE'S ROW AS THE DEMO SERVES IT, priced at the last aligned day's
 * Aave supply APY.
 *
 * The shipped `TREASURY_CANDIDATES` row carries its own `apyMean30d`,
 * 3.70119% captured 2026-09-03, and this capture reads 3.71% on 2026-09-07.
 * Both are honest and they are four days apart, which is 0.01pp of published
 * APY: invisible at the canvas's one decimal and visible at the router
 * instrument's two. So the catalog serves THIS row, the capture's own, and the
 * dock card, the lane, the published record and the instrument all read one
 * number. `lib/canvas/catalog-server.ts` is the consumer.
 */
export function floorRowToday(): HandAuthoredCandidate | null {
  const day = routerLastAlignedDay();
  return day ? floorRowForRate(day.aaveUsdcSupplyApy) : null;
}

/**
 * The pair a surface prints as "today", on ONE clock: the last aligned day.
 *
 * Not the capture instant. The Aave series publishes one point per day and
 * the loop's midnight point is the only borrow reading on the same clock, so
 * this is the only comparison of two numbers rather than of two calendars.
 */
export function routerPublishedToday(L: number = HERO_SEED_LEVERAGE): {
  readonly date: string;
  readonly loop: number | null;
  readonly floor: number | null;
} | null {
  const day = routerLastAlignedDay();
  if (!day) return null;
  return {
    date: day.date,
    loop: publishedNetApy(repriceAtLeverage(loopRowForDay(day), L), false),
    floor: publishedNetApy(floorRowToday(), false),
  };
}

/**
 * THE DEMO ROW'S TWO RATES, AS A RECORD'S PARAMETERS PRINT THEM.
 *
 * Design item 22, and it lives HERE because it is a claim about a
 * MEASUREMENT: the labels, the precision and the provenance row all describe
 * the capture this module owns, and both writers (`lib/vaults/hero.ts` for the
 * seeded record, `RackCanvas` for a publish) render the same three rows by
 * calling this rather than by spelling them twice.
 *
 * THE LABEL SAYS `typed` BECAUSE THE VALUE IS (G3, 2026-09-07). It briefly
 * said `measured`, for as long as `lib/demo/market.ts` substituted the
 * capture's own last aligned day into the row. That substitution is reverted:
 * the row's two rates are typed inputs again, captured before the router, and
 * a parameters table that called them measured would be naming the wrong
 * source for the number beside it.
 *
 * WHAT IS STILL MEASURED, AND STILL SAID: the third row. The capture exists,
 * the router reads it day by day, and the date and provider are its own. So
 * the rates read `typed` and the provenance row points at the measured series
 * they are NOT drawn from, which is the two-labels ruling written into one
 * three-row table.
 *
 * Two decimals, because the pair is a difference the reader is meant to be
 * able to take: 1 dp collapses 4.40% and 3.50% into rates nothing stated.
 */
export function typedRateRows(
  collateralYieldApy: number,
  borrowApyMarginal: number,
): { label: string; value: string }[] {
  return [
    { label: "Collateral yield, typed", value: pct(collateralYieldApy, 2) },
    { label: "Borrow rate, typed", value: pct(borrowApyMarginal, 2) },
    {
      label: "Measured series",
      value: `${ROUTER_MEASURED_ON} · ${ROUTER_HISTORY_SOURCES.loopReward.provider}`,
    },
  ];
}
