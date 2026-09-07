/**
 * Market catalog: every collateral the loop-server can honestly deploy.
 *
 * A catalog entry is a candidate the composer surfaces AND a market the
 * on-chain workflow (deployed by `deploy/vault-service.sh`) can attest. The
 * user picks a candidate; the deployer looks the addresses up here.
 *
 * The composer's `candidateId` shape is
 *   "morpho-blue-<chainSlug>:<chainId>:<pair-slug>:<marketId-prefix8>"
 * (see `apps/replay-ui/lib/canvas/opportunities.ts`); we key the catalog on
 * that string so the seam between the two sides has no translation layer.
 *
 * Growing the demo means either
 *   (a) running `vault-service.sh` per market and registering the workflow
 *       against the new entry's `chainKey`, or
 *   (b) teaching `vault-service.sh` to register N workflows in one shot and
 *       filling in `workflowId` per catalog row.
 * Neither exists today; the catalog has one entry.
 */

export interface MarketSpec {
  /** Composer id: primary key here and on `apps/replay-ui/lib/canvas`. */
  candidateId: string;
  /** WAVS chain key the aggregator submits on. */
  chainKey: string;
  /** Human label for logs and error surfaces. */
  label: string;
  /** Morpho Blue market id (bytes32, lowercased). */
  marketId: string;
  /** Market LLTV, 1e18 scale, as a decimal string. */
  lltv: string;
  /** Collateral token (18 decimals assumed by vault-nav). */
  usdeAddress: string;
  /** Morpho market oracle. */
  oracleAddress: string;
  /** Morpho IRM. */
  irmAddress: string;
  /** Morpho Blue core. */
  morphoAddress: string;
  /** TWAP pool for min(par, TWAP) collateral pricing. */
  poolAddress: string;
  /** TWAP window seconds. Component floors the effective window at 300. */
  twapWindowSecs: number;
  /** Blocks behind the trigger-time block to pin reads (reorg depth). */
  inputsBlockLag: number;
}

/**
 * USDe/USDC on Morpho Blue · Base. Addresses match the workflow
 * `deploy/vault-service.sh` deploys against the local anvil fork of Base at
 * block 49911282. `chainKey` is the fork's WAVS id (evm:31337); the real
 * Base run bumps this to evm:8453 alongside a fresh workflow deploy.
 */
export const USDE_USDC_MORPHO_BASE: MarketSpec = {
  candidateId: "morpho-blue-base:8453:USDe-USDC:0x54cf9be5",
  chainKey: "evm:31337",
  label: "USDe/USDC on Morpho Blue · Base (91.5% LLTV)",
  marketId: "0x54cf9be57fdfa6457a660991907434ff9d295c465a603a50126ff647d50b7354",
  lltv: "915000000000000000",
  usdeAddress: "0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34",
  oracleAddress: "0xf4b17c79492d68775e22e8dd0a2bb22854a39a47",
  irmAddress: "0x46415998764c29ab2a25cbea6254146d50d22687",
  morphoAddress: "0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb",
  poolAddress: "0x15bc08d2e2b405afed3fb872dcd2d962bccfb7e0",
  twapWindowSecs: 1800,
  inputsBlockLag: 2,
};

const MARKET_CATALOG: Record<string, MarketSpec> = {
  [USDE_USDC_MORPHO_BASE.candidateId]: USDE_USDC_MORPHO_BASE,
};

/** Every market the server can currently deploy. */
export function listMarkets(): readonly MarketSpec[] {
  return Object.values(MARKET_CATALOG);
}

/** Look up a candidate. Returns null if the id is not in the catalog. */
export function lookupMarket(candidateId: string): MarketSpec | null {
  return MARKET_CATALOG[candidateId] ?? null;
}
