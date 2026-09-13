/**
 * Caller identity for the mutating loop-server routes.
 *
 * The bearer token authenticates the FRONTEND, not the caller. Anyone who
 * has the token can hit the loop-server; the bearer alone does not answer
 * the question "does this caller own the strategist address they claim?".
 * This module answers that: every mutating request carries an EIP-712
 * signature over an intent, and the loop-server recovers the signer and
 * compares it to the strategist.
 *
 * Two intents:
 *
 *   `LoopPublish`: strategist attests that THIS wallet wants to deploy a
 *   vault with THIS `candidateId`, `targetLeverage`, and cadence. Recovered
 *   signer must equal the `strategist` field the same body carries. No
 *   caller can nominate a foreign strategist address to hold the exit key.
 *
 *   `LoopPause`: strategist attests that THIS wallet wants the workflow
 *   for a specific loop id removed. Recovered signer must equal the
 *   `strategist` on the persisted loop record. No caller can pause a loop
 *   they do not own, so a bearer holder cannot grief every published vault.
 *
 * The domain binds the signature to a specific chain and to the deployed
 * service manager, so a signature harvested from one deployment cannot be
 * replayed on another. The intent carries a `signedAt` unix-seconds field
 * inside a bounded window so a signature harvested a long time ago cannot
 * be replayed after the strategist's threat model changed.
 */

import { recoverTypedDataAddress, type Address } from "viem";

/** Domain the signature is bound to. */
export interface IntentDomain {
  chainId: number;
  /** Loop-server's shared service manager address. */
  verifyingContract: Address;
}

/** EIP-712 domain object the client and server both hash. */
export interface Eip712Domain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: Address;
}

/** Publish intent. Every field is a signed commitment for a fresh deploy. */
export interface LoopPublishIntent {
  strategist: Address;
  name: string;
  candidateId: string;
  cronSeconds: number;
  targetLeverage: number;
  /** Unix seconds when the strategist signed. Bounded window on the server. */
  signedAt: number;
}

/** Pause intent. Referenced by loop id and time. */
export interface LoopPauseIntent {
  loopId: string;
  /** Unix seconds when the strategist signed. Bounded window on the server. */
  signedAt: number;
}

/** How stale a signature can be. 5 minutes: past enough to survive slow wallets, short enough that a leaked signature ages out inside a coffee break. */
export const INTENT_MAX_AGE_SECONDS = 300;
/** How far in the future a signature can be. 60 seconds: a small clock-skew allowance, not a legitimate signing window. */
export const INTENT_MAX_SKEW_SECONDS = 60;

const PUBLISH_TYPES = {
  LoopPublish: [
    { name: "strategist", type: "address" },
    { name: "name", type: "string" },
    { name: "candidateId", type: "string" },
    { name: "cronSeconds", type: "uint32" },
    { name: "targetLeverage", type: "uint32" },
    { name: "signedAt", type: "uint64" },
  ],
} as const;

const PAUSE_TYPES = {
  LoopPause: [
    { name: "loopId", type: "string" },
    { name: "signedAt", type: "uint64" },
  ],
} as const;

/** Wagmi-shaped typed-data body for a publish intent. Client passes this to `signTypedData`; server passes the same shape into `recoverTypedDataAddress`. */
export interface LoopPublishTypedData {
  domain: Eip712Domain;
  types: typeof PUBLISH_TYPES;
  primaryType: "LoopPublish";
  message: {
    strategist: Address;
    name: string;
    candidateId: string;
    cronSeconds: number;
    targetLeverage: number;
    signedAt: bigint;
  };
}

/** Wagmi-shaped typed-data body for a pause intent. */
export interface LoopPauseTypedData {
  domain: Eip712Domain;
  types: typeof PAUSE_TYPES;
  primaryType: "LoopPause";
  message: {
    loopId: string;
    signedAt: bigint;
  };
}

/** Encode `targetLeverage` at fixed 4-decimal precision so the signed integer matches a client that saw `2.5` in the composer. */
export function encodeTargetLeverage(targetLeverage: number): number {
  if (!Number.isFinite(targetLeverage) || targetLeverage <= 0) {
    throw new Error(`targetLeverage must be a positive finite number, got ${String(targetLeverage)}`);
  }
  return Math.round(targetLeverage * 10_000);
}

/** Wrap the domain in the EIP-712 shape wagmi/viem expects. */
function domainOf({ chainId, verifyingContract }: IntentDomain): Eip712Domain {
  return {
    name: "PriimeLoopServer",
    version: "1",
    chainId,
    verifyingContract,
  };
}

/** The typed-data payload the client signs for a publish. */
export function loopPublishTypedData(intent: LoopPublishIntent, domain: IntentDomain): LoopPublishTypedData {
  return {
    domain: domainOf(domain),
    types: PUBLISH_TYPES,
    primaryType: "LoopPublish",
    message: {
      strategist: intent.strategist,
      name: intent.name,
      candidateId: intent.candidateId,
      cronSeconds: intent.cronSeconds,
      targetLeverage: encodeTargetLeverage(intent.targetLeverage),
      signedAt: BigInt(intent.signedAt),
    },
  };
}

/** The typed-data payload the client signs for a pause. */
export function loopPauseTypedData(intent: LoopPauseIntent, domain: IntentDomain): LoopPauseTypedData {
  return {
    domain: domainOf(domain),
    types: PAUSE_TYPES,
    primaryType: "LoopPause",
    message: { loopId: intent.loopId, signedAt: BigInt(intent.signedAt) },
  };
}

/** Raised when a signed intent's `signedAt` is outside the accepted window. */
export class StaleIntentError extends Error {
  readonly signedAt: number;
  readonly nowSeconds: number;
  constructor(signedAt: number, nowSeconds: number) {
    super(
      `signed intent is outside the accepted window (signedAt=${signedAt}, now=${nowSeconds}, allowed [-${INTENT_MAX_AGE_SECONDS}s, +${INTENT_MAX_SKEW_SECONDS}s])`,
    );
    this.name = "StaleIntentError";
    this.signedAt = signedAt;
    this.nowSeconds = nowSeconds;
  }
}

/** Raised when a signature does not recover to the address the intent claimed. */
export class UnauthorizedIntentError extends Error {
  readonly expected: Address;
  readonly recovered: Address;
  constructor(expected: Address, recovered: Address) {
    super(`signature recovers to ${recovered}, expected ${expected}`);
    this.name = "UnauthorizedIntentError";
    this.expected = expected;
    this.recovered = recovered;
  }
}

/** Verify freshness. Throws `StaleIntentError` on a signed-at outside the window. */
export function assertFreshIntent(signedAt: number, nowSeconds: number): void {
  if (!Number.isInteger(signedAt)) {
    throw new StaleIntentError(signedAt, nowSeconds);
  }
  const delta = nowSeconds - signedAt;
  if (delta > INTENT_MAX_AGE_SECONDS || delta < -INTENT_MAX_SKEW_SECONDS) {
    throw new StaleIntentError(signedAt, nowSeconds);
  }
}

/** Recover the signer of a publish intent. Throws `UnauthorizedIntentError` when the recovered address does not equal `intent.strategist`. */
export async function verifyLoopPublish(
  intent: LoopPublishIntent,
  signature: `0x${string}`,
  domain: IntentDomain,
  nowSeconds: number,
): Promise<Address> {
  assertFreshIntent(intent.signedAt, nowSeconds);
  const recovered = await recoverTypedDataAddress({
    ...loopPublishTypedData(intent, domain),
    signature,
  });
  if (recovered.toLowerCase() !== intent.strategist.toLowerCase()) {
    throw new UnauthorizedIntentError(intent.strategist, recovered);
  }
  return recovered;
}

/** Recover the signer of a pause intent. Callers compare the return value against the loop record's persisted strategist. */
export async function verifyLoopPause(
  intent: LoopPauseIntent,
  signature: `0x${string}`,
  domain: IntentDomain,
  nowSeconds: number,
): Promise<Address> {
  assertFreshIntent(intent.signedAt, nowSeconds);
  return await recoverTypedDataAddress({
    ...loopPauseTypedData(intent, domain),
    signature,
  });
}
