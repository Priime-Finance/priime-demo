import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";

import {
  INTENT_MAX_AGE_SECONDS,
  INTENT_MAX_SKEW_SECONDS,
  StaleIntentError,
  UnauthorizedIntentError,
  loopPauseTypedData,
  loopPublishTypedData,
  verifyLoopPause,
  verifyLoopPublish,
  type IntentDomain,
  type LoopPauseIntent,
  type LoopPublishIntent,
} from "@priime-demo/loop-deploy";

/**
 * The intent-signing seam. Two rules keep it useful:
 *
 *   1. A signature that recovers to the strategist address must be accepted.
 *      A signature that recovers to any other address must be rejected.
 *   2. A signature outside the freshness window must be rejected, whether
 *      the sender is legitimate or not, so a leaked signature ages out on
 *      its own.
 *
 * Both rules are verified below against a real secp256k1 sign / recover
 * round trip; nothing here mocks the crypto path.
 */

const STRATEGIST_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const OTHER_KEY = "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba" as const;
const strategist = privateKeyToAccount(STRATEGIST_KEY);
const other = privateKeyToAccount(OTHER_KEY);

const domain: IntentDomain = {
  chainId: 8453,
  verifyingContract: "0x23d382E3c6b1625B0021d5ef291DBd12995cDf00",
};

const NOW = 1_800_000_000;

describe("verifyLoopPublish", () => {
  it("accepts a signature from the strategist and returns the recovered address", async () => {
    const intent: LoopPublishIntent = {
      strategist: strategist.address,
      name: "my loop",
      candidateId: "morpho-blue-base:8453:USDe-USDC:0x54cf9be5",
      cronSeconds: 60,
      targetLeverage: 2.5,
      signedAt: NOW,
    };
    const sig = await strategist.signTypedData(loopPublishTypedData(intent, domain));
    const recovered = await verifyLoopPublish(intent, sig, domain, NOW);
    expect(recovered.toLowerCase()).toBe(strategist.address.toLowerCase());
  });

  it("rejects a signature from someone other than the strategist", async () => {
    const intent: LoopPublishIntent = {
      strategist: strategist.address,
      name: "my loop",
      candidateId: "morpho-blue-base:8453:USDe-USDC:0x54cf9be5",
      cronSeconds: 60,
      targetLeverage: 2.5,
      signedAt: NOW,
    };
    // Signed by the wrong key. The typed data body still says strategist,
    // but recover will land on `other.address`.
    const sig = await other.signTypedData(loopPublishTypedData(intent, domain));
    await expect(verifyLoopPublish(intent, sig, domain, NOW)).rejects.toBeInstanceOf(UnauthorizedIntentError);
  });

  it("rejects a signature harvested outside the freshness window", async () => {
    const intent: LoopPublishIntent = {
      strategist: strategist.address,
      name: "my loop",
      candidateId: "morpho-blue-base:8453:USDe-USDC:0x54cf9be5",
      cronSeconds: 60,
      targetLeverage: 2.5,
      signedAt: NOW - INTENT_MAX_AGE_SECONDS - 1,
    };
    const sig = await strategist.signTypedData(loopPublishTypedData(intent, domain));
    await expect(verifyLoopPublish(intent, sig, domain, NOW)).rejects.toBeInstanceOf(StaleIntentError);
  });

  it("rejects a signature signed in the future beyond skew", async () => {
    const intent: LoopPublishIntent = {
      strategist: strategist.address,
      name: "my loop",
      candidateId: "morpho-blue-base:8453:USDe-USDC:0x54cf9be5",
      cronSeconds: 60,
      targetLeverage: 2.5,
      signedAt: NOW + INTENT_MAX_SKEW_SECONDS + 1,
    };
    const sig = await strategist.signTypedData(loopPublishTypedData(intent, domain));
    await expect(verifyLoopPublish(intent, sig, domain, NOW)).rejects.toBeInstanceOf(StaleIntentError);
  });

  it("rejects a signature from another chain (domain scoping)", async () => {
    const intent: LoopPublishIntent = {
      strategist: strategist.address,
      name: "my loop",
      candidateId: "morpho-blue-base:8453:USDe-USDC:0x54cf9be5",
      cronSeconds: 60,
      targetLeverage: 2.5,
      signedAt: NOW,
    };
    // Sign for a different chain; verify against `domain`.
    const foreignDomain: IntentDomain = { chainId: 1, verifyingContract: domain.verifyingContract };
    const sig = await strategist.signTypedData(loopPublishTypedData(intent, foreignDomain));
    await expect(verifyLoopPublish(intent, sig, domain, NOW)).rejects.toBeInstanceOf(UnauthorizedIntentError);
  });
});

describe("verifyLoopPause", () => {
  it("returns the recovered address on a fresh signature so the caller can compare it to the loop record", async () => {
    const intent: LoopPauseIntent = { loopId: "loop-abcd1234", signedAt: NOW };
    const sig = await strategist.signTypedData(loopPauseTypedData(intent, domain));
    const recovered = await verifyLoopPause(intent, sig, domain, NOW);
    expect(recovered.toLowerCase()).toBe(strategist.address.toLowerCase());
  });

  it("rejects a pause signature that names a different loop id than the one signed", async () => {
    const signedIntent: LoopPauseIntent = { loopId: "loop-abcd1234", signedAt: NOW };
    const sig = await strategist.signTypedData(loopPauseTypedData(signedIntent, domain));
    const attackerIntent: LoopPauseIntent = { loopId: "loop-victim99", signedAt: NOW };
    const recovered = await verifyLoopPause(attackerIntent, sig, domain, NOW);
    // Signature is over a different loopId; recovery lands somewhere else.
    expect(recovered.toLowerCase()).not.toBe(strategist.address.toLowerCase());
  });

  it("rejects a pause signature outside the freshness window", async () => {
    const intent: LoopPauseIntent = { loopId: "loop-abcd1234", signedAt: NOW - INTENT_MAX_AGE_SECONDS - 1 };
    const sig = await strategist.signTypedData(loopPauseTypedData(intent, domain));
    await expect(verifyLoopPause(intent, sig, domain, NOW)).rejects.toBeInstanceOf(StaleIntentError);
  });
});
