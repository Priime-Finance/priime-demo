import { describe, expect, it } from "vitest";

import { remapCandidateForChain } from "@/lib/vaults/publish-loop";

describe("remapCandidateForChain", () => {
  it("rewrites the mainnet-Base slug to the fork slug on chain 31337", () => {
    /* The composer hard-codes `HERO_MARKET_ID` at the Base mainnet
       slug. When the connected wallet is on the local fork (chain
       31337), loop-server has a catalog entry with the fork slug and
       matching chain metadata, so the publish body MUST carry the
       fork slug — otherwise `resolveLoopConfig` refuses with "not
       deployable on this server's chain". */
    expect(
      remapCandidateForChain(
        "morpho-blue-base:8453:USDe-USDC:0x54cf9be5",
        31337,
      ),
    ).toBe("morpho-blue-base-fork:31337:USDe-USDC:0x54cf9be5");
  });

  it("is identity on the real Base chain (8453)", () => {
    /* No rewrite on mainnet: the composer's Base slug already matches
       the mainnet catalog entry. Rewriting here would send the fork
       slug to a mainnet loop-server, which has no fork entry, so the
       publish would 400 with "unknown candidate". */
    expect(
      remapCandidateForChain(
        "morpho-blue-base:8453:USDe-USDC:0x54cf9be5",
        8453,
      ),
    ).toBe("morpho-blue-base:8453:USDe-USDC:0x54cf9be5");
  });

  it("is identity for candidates without a per-chain rule", () => {
    // No entry in CANDIDATE_REMAP_BY_CHAIN[11155111], so the slug
    // passes through untouched. Sepolia doesn't advertise the Base
    // hero market.
    expect(
      remapCandidateForChain(
        "morpho-blue-base:8453:USDe-USDC:0x54cf9be5",
        11155111,
      ),
    ).toBe("morpho-blue-base:8453:USDe-USDC:0x54cf9be5");
  });

  it("passes through unknown candidate slugs even on the fork chain", () => {
    // A slug that has no fork counterpart (nothing registered in the
    // remap table for it) passes through, so the server can reject
    // with its own more informative "unknown candidate" error rather
    // than the client silently mangling the slug.
    const unknown = "some-other-venue:31337:PAIR:0xdeadbeef";
    expect(remapCandidateForChain(unknown, 31337)).toBe(unknown);
  });
});
