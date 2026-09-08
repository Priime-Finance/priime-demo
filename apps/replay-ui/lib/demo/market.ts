/**
 * The one market the demo composes on: the USDe/USDC recursive loop on Morpho
 * Blue, Base. Same id the scan carries in its `ineligible` list and the same
 * id `lib/demo-scope.ts` pins as HERO_MARKET_ID, so the composed vault and the
 * attested vault name the same market.
 *
 * The scan snapshot carries no economics row for it (the v1 gate excludes the
 * market because Morpho pays no supply APY on USDe collateral, so its carry is
 * incentive-paid). The row below supplies the TYPED INPUTS only: the two
 * rates, the liquidation threshold, the scan-shaped ceiling and the modeled
 * capacity. It states no APY of its own. Every number a surface prints is
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
 * ══ THE ROW'S TWO RATES ARE TYPED INPUTS, AND THEY SAY SO (G3) ═══════════
 *
 * They were briefly substituted with the capture's last aligned day, to weld
 * the canvas frame to the router frame. That substitution is REVERTED, because
 * it broke the one live workflow the demo is built around: today's measured
 * pair is a 4.75% incentive against a 5.09% borrow, so leverage SUBTRACTS on
 * this row, `Install defaults` withheld Dynamic leverage, and the hero fell to
 * 3.1%. A market row that cannot seat the module the product is about is not a
 * better row, it is a different demo.
 *
 * So the two rates below are TYPED INPUTS, captured before the router existed,
 * and every surface that prints from them labels the number `modeled` at the
 * stored leverage. The MEASURED series lives in `lib/canvas/router-history.ts`
 * and is what the router reads, day by day; every surface that prints the
 * loop's rate FOR A DAY labels it `measured` with that day's date. Two numbers,
 * two questions, two labels, and neither is re-typed to match the other
 * (docs/plans/ROUTER_LANE_PLAN.md, G3).
 */
const DEMO_COLLATERAL_YIELD_APY = 0.044;
const DEMO_BORROW_APY_MARGINAL = 0.035;

export function demoMarketCandidate(): ProjectedCandidate {
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
      collateralYieldApy: DEMO_COLLATERAL_YIELD_APY,
      borrowApyMarginal: DEMO_BORROW_APY_MARGINAL,
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
