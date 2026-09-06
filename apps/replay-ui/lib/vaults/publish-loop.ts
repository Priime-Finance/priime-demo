/**
 * Publish adapter: turns the composer's publish draft + a connected wallet
 * into a POST /api/loops call.
 *
 * Market mapping today: the loop server backend only supports one Morpho
 * Blue market (USDe/USDC on Base, 91.5% LLTV) because that is the vault
 * vault-service.sh brought up. The composer's canvas displays whatever the
 * live opportunity catalog serves, which is a separate story used for the
 * design surface. Until we teach vault-nav more markets, publish deploys
 * against the fixed configuration below regardless of which candidate the
 * canvas has surfaced. Documented; not hidden.
 */

import { createLoop, LoopValidationError, type CreateLoopInput } from "./live-source";

/** The one market the backend can attest today. */
const DEMO_MARKET = {
  marketId: "0x54cf9be57fdfa6457a660991907434ff9d295c465a603a50126ff647d50b7354",
  lltv: "915000000000000000",
  usdeAddress: "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34",
  oracleAddress: "0xF4b17C79492d68775e22e8Dd0a2Bb22854A39A47",
  irmAddress: "0x46415998764C29aB2a25CbeA6254146D50D22687",
  morphoAddress: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
  poolAddress: "0x15BC08D2E2B405afeD3fB872DCd2d962BcCfB7e0",
  twapWindowSecs: 1800,
  inputsBlockLag: 2,
} as const;

/** Cron cadence in seconds. Matches deploy/fork.config.json's cron. */
const DEMO_CRON_SECONDS = 10;

export interface PublishInput {
  /** User-picked vault name from the Review card. */
  name: string;
  /** Connected wallet address. Becomes the strategist (exit key) on chain. */
  strategist: string;
}

export interface PublishResult {
  loopId: string;
  handler: string;
}

/** Turn the composer's inputs into a real deployment. */
export async function publishLoopToServer(input: PublishInput): Promise<PublishResult> {
  const body: CreateLoopInput = {
    name: input.name,
    strategist: input.strategist,
    cronSeconds: DEMO_CRON_SECONDS,
    ...DEMO_MARKET,
  };
  const { loop } = await createLoop(body);
  if (loop.handlerAddress === null) {
    throw new Error("loop deployed without a handler address; check loop-server logs");
  }
  return { loopId: loop.id, handler: loop.handlerAddress };
}

export { LoopValidationError };
