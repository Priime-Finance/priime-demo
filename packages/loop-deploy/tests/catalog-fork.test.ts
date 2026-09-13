import { describe, expect, it } from "vitest";

import {
  USDE_USDC_MORPHO_BASE,
  USDE_USDC_MORPHO_BASE_FORK,
  listMarketsForChainId,
  lookupMarket,
} from "../src/catalog.ts";

describe("catalog fork variant", () => {
  it("makes the Base fork's chainId (31337) resolvable to at least one market", () => {
    /* Without a fork-flavoured catalog entry `POST /loops` on the fork
       always 400s: the loop-server's `chainKey` is `evm:31337` (default
       from `env.ts`) but the only Base-flavoured market advertised
       `evm:8453`, so `resolveLoopConfig` rejected before touching a
       contract. This test pins that the fork slug is listed under the
       fork's chain id. */
    const fork = listMarketsForChainId(31337);
    expect(fork.length).toBeGreaterThan(0);
    expect(fork.map((m) => m.chainKey)).toContain("evm:31337");
  });

  it("keeps the fork market's chainKey aligned with loop-server's default", () => {
    /* `env.ts::readEnv` defaults `chainKey: `evm:${chainId}`` when
       `CHAIN_KEY` is unset. Any catalog entry the composer surfaces on
       the fork MUST advertise the same string, or `deployer.ts::createLoop`
       throws `is not deployable on this server's chain`. */
    expect(USDE_USDC_MORPHO_BASE_FORK.chainKey).toBe("evm:31337");
    expect(USDE_USDC_MORPHO_BASE_FORK.chainId).toBe(31337);
  });

  it("mirrors every contract address from the real Base entry", () => {
    /* The fork inherits every deployed contract from the pinned Base
       block. Composing against a fork-shape catalog with different
       addresses would silently point the vault at a nonexistent oracle
       or router. Pin each shared field so a future edit to the Base
       entry never leaves the fork behind. */
    expect(USDE_USDC_MORPHO_BASE_FORK.marketId).toBe(USDE_USDC_MORPHO_BASE.marketId);
    expect(USDE_USDC_MORPHO_BASE_FORK.lltv).toBe(USDE_USDC_MORPHO_BASE.lltv);
    expect(USDE_USDC_MORPHO_BASE_FORK.usdeAddress).toBe(USDE_USDC_MORPHO_BASE.usdeAddress);
    expect(USDE_USDC_MORPHO_BASE_FORK.oracleAddress).toBe(USDE_USDC_MORPHO_BASE.oracleAddress);
    expect(USDE_USDC_MORPHO_BASE_FORK.irmAddress).toBe(USDE_USDC_MORPHO_BASE.irmAddress);
    expect(USDE_USDC_MORPHO_BASE_FORK.morphoAddress).toBe(USDE_USDC_MORPHO_BASE.morphoAddress);
    expect(USDE_USDC_MORPHO_BASE_FORK.poolAddress).toBe(USDE_USDC_MORPHO_BASE.poolAddress);
    expect(USDE_USDC_MORPHO_BASE_FORK.swapRouter).toBe(USDE_USDC_MORPHO_BASE.swapRouter);
    expect(USDE_USDC_MORPHO_BASE_FORK.poolFee).toBe(USDE_USDC_MORPHO_BASE.poolFee);
  });

  it("keeps the fork slug distinct from the real Base slug", () => {
    /* Same market on two chains still needs distinct candidateIds so
       `MARKET_CATALOG` (keyed by candidateId) does not collapse them
       onto the same entry. The chain segment in the slug carries the
       distinction. */
    expect(USDE_USDC_MORPHO_BASE_FORK.candidateId).not.toBe(USDE_USDC_MORPHO_BASE.candidateId);
    expect(lookupMarket(USDE_USDC_MORPHO_BASE_FORK.candidateId)?.chainKey).toBe("evm:31337");
    expect(lookupMarket(USDE_USDC_MORPHO_BASE.candidateId)?.chainKey).toBe("evm:8453");
  });
});
