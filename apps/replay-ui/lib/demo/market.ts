/**
 * The one market the demo composes on: the USDe/USDC recursive loop on Morpho
 * Blue, Base. Same id the scan carries in its `ineligible` list and the same
 * id `lib/demo-scope.ts` pins as HERO_MARKET_ID, so the composed vault and the
 * attested vault name the same market.
 *
 * The scan snapshot carries no economics row for it (the v1 gate excludes the
 * market because Morpho pays no supply APY on USDe collateral, so its carry is
 * incentive-paid). The row below supplies the row's own inputs: the liquidation
 * threshold, the scan-shaped ceiling and the modeled capacity, all typed, plus
 * the two RATES, which are measured and come from the capture's last aligned
 * day through `demoMarketRates` (see the block on it below). It states no APY of its own. Every number a surface prints is
 * `publishedNetApy(repriceAtLeverage(row, L), false)` from the one owner in
 * `lib/canvas/mock-quote.ts`, at the leverage the surface builds at, with the
 * house fee inside.
 *
 * Scan-shaped on purpose (`economics.model` absent): `defaultInstallChain`
 * returns nothing on a hand-authored row, and this row must seat Dynamic
 * leverage and Auto-compound on `Install defaults`.
 */

import { EXEC_DRAG_UNHEDGED } from "@/lib/model-constants";
import { repriceAtLeverage } from "@/lib/canvas/mock-quote";
import type { ProjectedCandidate } from "@/lib/canvas/opportunities";
import { routerLastAlignedDay } from "@/lib/canvas/router-history";
import { HERO_MARKET_ID } from "@/lib/demo-scope";

export const DEMO_MARKET_ID = HERO_MARKET_ID;

/**
 * The leverage the live vault is seated at on publish and the leverage the
 * hero record prices at. Founder call J.1 (docs/plans/LATEST_UI_PORT_SPEC.md):
 * 2.50x today; the dial reaches the 3.25x ceiling on stage regardless. One
 * constant, one edit.
 */
export const HERO_SEED_LEVERAGE = 2.5;

/** The market's liquidation LTV, the public chain parameter. */
const DEMO_LIQ_LTV = 0.915;
/** The scan-shaped ceiling: the house maximum at this LTV on the standard preset. */
const DEMO_LOOP_LEVERAGE = 3.25;
const DEMO_CAPACITY_USD = 10_000_000;

/**
 * ══ THE ROW'S TWO RATES ARE MEASURED, NOT TYPED (router lane, item 1) ══════
 *
 * This row used to carry `0.044` and `0.035` as literals, captured months
 * before the router was built. They publish 4.3% at the seed leverage, and the
 * router prices the SAME lane at 3.1% from the last aligned day of the capture
 * (`loopRewardPct` 4.75, `loopBorrowPct` 5.0869). Two frames 300px apart in
 * one viewport: the canvas would say the loop leads the floor by 1.30pp while
 * the router instrument says +0.10pp and sits watching. Annotating the two
 * frames was rejected; welding them is the fix.
 *
 * So the row reads the LAST ALIGNED DAY through `routerLastAlignedDay()`,
 * which is the same object `loopRowForDay` substitutes into on every other day
 * of the replay: today's row IS the replay's last tick. That accessor exists
 * so three callers cannot each pick their own last day, and this is one of the
 * three. No figure is typed here and no second copy of the pair exists.
 *
 * ⚠ The import is a CYCLE by construction (router-history reads
 * `demoMarketCandidate` to build the same row for the other 88 days) and it is
 * safe in both directions because neither module touches the other's bindings
 * while it is initialising: this function runs at call time, and
 * `router-history`'s own module body reads only `templates.ts`. `demoMarketRates`
 * is exported so a test can assert the substitution rather than infer it.
 */
export function demoMarketRates(): {
  readonly date: string;
  readonly collateralYieldApy: number;
  readonly borrowApyMarginal: number;
} {
  const day = routerLastAlignedDay();
  if (!day) throw new Error("router history has no aligned day: the demo row has no rates");
  return {
    date: day.date,
    collateralYieldApy: day.loopRewardApr,
    borrowApyMarginal: day.loopBorrowApy,
  };
}

export function demoMarketCandidate(): ProjectedCandidate {
  const rates = demoMarketRates();
  const inputs: ProjectedCandidate = {
    id: DEMO_MARKET_ID,
    venue: "morpho-blue-base",
    cls: "N1",
    pair: "USDe/USDC",
    collateralSymbol: "USDe",
    debtSymbol: "USDC",
    hlCoin: null,
    eligible: true,
    eligibleWithRewards: true,
    lt: DEMO_LIQ_LTV,
    // Filled by the reprice below; never a typed figure.
    headlineApr: null,
    score: null,
    scoreN1: null,
    apyRiskAdj: null,
    economics: {
      // Filled by the reprice below; never typed figures.
      netApyOnDepositApy: 0,
      netCarryOnEquityApy: 0,
      loopLeverage: DEMO_LOOP_LEVERAGE,
      targetLtv: 1 - 1 / DEMO_LOOP_LEVERAGE,
      capacityUsd: DEMO_CAPACITY_USD,
      capacityBinding: "modeled",
      fundingP25Apr: null,
      collateralYieldApy: rates.collateralYieldApy,
      borrowApyMarginal: rates.borrowApyMarginal,
      executionDragApr: EXEC_DRAG_UNHEDGED,
    },
    firstFailedGate: null,
    failedGates: [],
    gatesPassed: 0,
    gatesTotal: 0,
    launchable: true,
  };
  /* The row's own numbers at its own ceiling, from the one owner: the scan
     would have written `netApyOnDepositApy` at `loopLeverage`, so the row
     states exactly what the reprice at that leverage says and nothing else. */
  const priced = repriceAtLeverage(inputs, DEMO_LOOP_LEVERAGE);
  const net = priced.economics?.netApyOnDepositApy ?? null;
  return { ...priced, headlineApr: net };
}
