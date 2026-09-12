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
 * CHAIN-INDEXED: each entry declares its chain id explicitly. The loop-server
 * validates on publish that the picked entry's chain id matches the chain the
 * server is deploying against (its own `chainKey`), so a Sepolia loop-server
 * cannot be tricked into deploying against a mainnet-flavoured candidateId
 * and vice versa.
 *
 * Growing the demo means either
 *   (a) running `vault-service.sh` per market and registering the workflow
 *       against the new entry's `chainKey`, or
 *   (b) teaching `vault-service.sh` to register N workflows in one shot and
 *       filling in `workflowId` per catalog row.
 * Neither exists today; the catalog has one entry per chain.
 */

export interface MarketSpec {
  /** Composer id: primary key here and on `apps/replay-ui/lib/canvas`. */
  candidateId: string;
  /** Priime chain key the aggregator submits on. */
  chainKey: string;
  /** Chain id the entry is for, derived from `chainKey` for filtering. */
  chainId: number;
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
  /** Uniswap V3 router used for USDC<->USDe swaps in strategy plans. */
  swapRouter: string;
  /** Pool tick spacing (Uniswap V3 uses Uniswap V3 fee tier (500 = 0.05%)). */
  poolFee: number;
}

/**
 * USDe/USDC on Morpho Blue  -  Base. Addresses match the workflow
 * `deploy/vault-service.sh` deploys against the local anvil fork of Base at
 * block 49911282. `chainKey` is the fork's Priime id (evm:31337); the real
 * Base run bumps this to evm:8453 alongside a fresh workflow deploy.
 */
export const USDE_USDC_MORPHO_BASE: MarketSpec = {
  candidateId: "morpho-blue-base:8453:USDe-USDC:0x54cf9be5",
  chainKey: "evm:8453",
  chainId: 8453,
  label: "USDe/USDC on Morpho Blue  -  Base (91.5% LLTV)",
  marketId: "0x54cf9be57fdfa6457a660991907434ff9d295c465a603a50126ff647d50b7354",
  lltv: "915000000000000000",
  usdeAddress: "0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34",
  oracleAddress: "0xf4b17c79492d68775e22e8dd0a2bb22854a39a47",
  irmAddress: "0x46415998764c29ab2a25cbea6254146d50d22687",
  morphoAddress: "0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb",
  poolAddress: "0x15bc08d2e2b405afed3fb872dcd2d962bccfb7e0",
  twapWindowSecs: 1800,
  inputsBlockLag: 2,
  swapRouter: "0x2626664c2603336E57B271c5C0b26F421741e481",
  poolFee: 500,
};

/**
 * USDe/USDC on our permissionless Morpho market  -  Ethereum Sepolia. The
 * chain-11155111 counterpart to the mainnet entry above. Tokens (Ethena's
 * USDe, Circle's USDC) are REAL canonical testnet deployments; Morpho Blue,
 * the AdaptiveCurveIRM and the ChainlinkOracleV2Factory are Morpho's own
 * real Sepolia deployments (docs.morpho.org). The one thing WE deployed is
 * the `MorphoChainlinkOracleV2` instance below (all-zero feed slots, so its
 * `price()` returns the constant 1e24 = 1:1 rate  -  Morpho's own factory
 * pattern for stable pairs) plus a `createMarket` call against Morpho Blue.
 * Both landed on Sepolia via `deploy/sepolia-setup.sh` on 2026-09-09; the
 * addresses below are the resulting on-chain contracts.
 *
 * `poolAddress` is left blank pending the swap-route decision (see
 * `sepolia.config.json:swap_route._comment`).
 */
export const USDE_USDC_MORPHO_SEPOLIA: MarketSpec = {
  candidateId: "morpho-blue-sepolia:11155111:USDe-USDC:0xee461cf8",
  chainKey: "evm:11155111",
  chainId: 11155111,
  label: "USDe/USDC on Morpho Blue  -  Ethereum Sepolia (91.5% LLTV)",
  marketId: "0xee461cf86148c9e0e17c2bca906a4e7ff62bab1ff3334d20e82dd9672a899cb3",
  lltv: "915000000000000000",
  usdeAddress: "0x9458caaca74249abbe9e964b3ce155b98ec88ef2",
  oracleAddress: "0x1fc32d70b1b6f85c4dbc2f0626c9e558bd2a1be2",
  irmAddress: "0x8c5ddcd3f601c91d1bf51c8ec26066010acaba7c",
  morphoAddress: "0xd011ee229e7459ba1ddd22631ef7bf528d424a14",
  poolAddress: "",
  twapWindowSecs: 1800,
  inputsBlockLag: 2,
  swapRouter: "0x0000000000000000000000000000000000000000",
  poolFee: 500,
};

const MARKET_CATALOG: Record<string, MarketSpec> = {
  [USDE_USDC_MORPHO_BASE.candidateId]: USDE_USDC_MORPHO_BASE,
  [USDE_USDC_MORPHO_SEPOLIA.candidateId]: USDE_USDC_MORPHO_SEPOLIA,
};

/** Every market the server can currently deploy. */
export function listMarkets(): readonly MarketSpec[] {
  return Object.values(MARKET_CATALOG);
}

/** Markets the server can deploy against the given chain id. */
export function listMarketsForChainId(chainId: number): readonly MarketSpec[] {
  return Object.values(MARKET_CATALOG).filter((m) => m.chainId === chainId);
}

/** Look up a candidate. Returns null if the id is not in the catalog. */
export function lookupMarket(candidateId: string): MarketSpec | null {
  return MARKET_CATALOG[candidateId] ?? null;
}
