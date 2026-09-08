/**
 * The model constants the canvas kit reads, with their provenance.
 *
 * build.priime.finance keeps these on the strategy-factory scanner and the v4
 * launch config, neither of which travels here (docs/plans/LATEST_UI_PORT_SPEC.md
 * A.1: the scanner, the v4 config and the bridge stay behind). The kit's own modules
 * import from this file instead, so every number below is a copied value with
 * the line it was read from, never a re-derivation. Change one only against
 * its source.
 *
 * Sources are the autoloop-frontend working tree at eb6d33a, read 2026-09-07.
 */

// ── strategy-factory, simulate.ts ───────────────────────────────────────

/** simulate.ts:27, f_h = 1/(L_h+1) = 0.25, f_b = 0.75. */
export const HL_LEVERAGE = 3;
/** simulate.ts:28. The scan's flat escrow share: the loop keeps 3/4 of a deposit. */
export const F_B = HL_LEVERAGE / (HL_LEVERAGE + 1);
/** simulate.ts:31. Static execution drag on equity APR (rebalance slippage +
 *  HL resize + amortized open costs, conservative composite). */
export const EXEC_DRAG_APR = 0.0075;
/** simulate.ts:33. Economic floor on deposit APY (capacityModel bound E). */
export const ECON_FLOOR_APY = 0.08;
/** simulate.ts:37. Minimum viable capacity to be worth operating. */
export const MIN_CAPACITY_USD = 100_000;
/** simulate.ts:48-60. The curated underlying map the same-underlying gate
 *  reads; copied entry for entry. An unmapped symbol fails the gate. */
export const UNDERLYING_MAP: Record<string, string> = {
  WBERA: "BERA",
  iBERA: "BERA",
  oriBGT: "BERA",
  sWBERA: "BERA",
  iBGT: "BERA",
  WETH: "ETH",
  wstETH: "ETH",
  weETH: "ETH",
  WBTC: "BTC",
  cbBTC: "BTC",
  LBTC: "BTC",
};

// ── strategy-factory, simulate-v2.ts ────────────────────────────────────

/** simulate-v2.ts:44. Execution drag on an unhedged (class N1) lane. */
export const EXEC_DRAG_UNHEDGED = 0.004;
/** simulate-v2.ts:47. Maximum current depeg the stable gate tolerates. */
export const DEPEG_MAX_CUR = 0.005;

// ── v4, launch-config.ts ────────────────────────────────────────────────

/** launch-config.ts:205, LAUNCH_PARAMS.HEDGE_DRIFT_REGROW_EDGE. W11 regrows
 *  the short to target when drift is at or below minus this. */
export const HEDGE_DRIFT_REGROW_EDGE = 0.04;
/** launch-config.ts:147, LAUNCH_PARAMS.KILL_SWITCH_CEILING_APR. */
export const KILL_SWITCH_CEILING_APR = -10;
/** launch-config.ts:94. The house minimum hedged deposit. */
export const MIN_HEDGED_DEPOSIT_USD = 50;

// ── lib/bridge/bera-to-hyperevm.ts ─────────────────────────────────────────

/** bera-to-hyperevm.ts:35. */
export const BERACHAIN_ID = 80094;
/** bera-to-hyperevm.ts:38. LiFi's identifier for HL native (Spot + Perp). NOT HyperEVM. */
export const HYPERLIQUID_LIFI_CHAIN_ID = 1337;
/** bera-to-hyperevm.ts:41. */
export const HYPEREVM_ID = 999;
