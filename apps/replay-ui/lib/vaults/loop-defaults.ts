/**
 * Demo defaults for the "Create loop" form. Everything below matches the
 * pinned Base fork (`deploy/fork.config.json`) so the user only needs to name
 * their loop; the market plumbing is fixed.
 *
 * Kept in sync by hand for now. If we ever open the market selection to the
 * UI, this file gets fetched from a server-side route the way opportunities
 * already are.
 */

export const DEFAULT_STRATEGIST = "0x976EA74026E726554dB657fA54763abd0C3a0aa9";

export interface LoopMarketDefaults {
  marketId: string;
  lltv: string;
  usdeAddress: string;
  oracleAddress: string;
  irmAddress: string;
  morphoAddress: string;
  poolAddress: string;
  twapWindowSecs: number;
  inputsBlockLag: number;
  /** Human label for the read-only market row on the form. */
  marketLabel: string;
}

export const DEMO_MARKET: LoopMarketDefaults = {
  marketId: "0x54cf9be57fdfa6457a660991907434ff9d295c465a603a50126ff647d50b7354",
  lltv: "915000000000000000",
  usdeAddress: "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34",
  oracleAddress: "0xF4b17C79492d68775e22e8Dd0a2Bb22854A39A47",
  irmAddress: "0x46415998764C29aB2a25CbeA6254146D50D22687",
  morphoAddress: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
  poolAddress: "0x15BC08D2E2B405afeD3fB872DCd2d962BcCfB7e0",
  twapWindowSecs: 1800,
  inputsBlockLag: 2,
  marketLabel: "Morpho Blue USDe/USDC, 91.5% LLTV, Base",
};

export const DEFAULT_CRON_SECONDS = 10;
