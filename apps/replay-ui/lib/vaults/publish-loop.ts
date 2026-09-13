/**
 * Publish adapter: turns the composer's publish draft + a connected wallet
 * into a POST /api/loops call.
 *
 * The draft carries the composer's actual choices (candidate id + target
 * leverage from the graph, name from the Review card, cadence from the
 * server's demo default). Before the POST, the wallet is prompted to sign
 * an EIP-712 `LoopPublish` intent; loop-server refuses the request if the
 * signature does not recover to the strategist address the body claims,
 * which is what stops the shared bearer from being usable by anyone but
 * the strategist. `signPublishIntent` is a factory injected from the UI so
 * this module stays framework-agnostic (Node-only tests never touch wagmi).
 */

import type { Address } from "viem";

import {
  loopPublishTypedData,
  type IntentDomain,
  type LoopPublishIntent,
  type LoopPublishTypedData,
} from "@priime-demo/loop-deploy";

import { createLoop, LoopValidationError, type CreateLoopInput } from "./live-source";

/**
 * Strike cadence for the loop, seconds.
 *
 * 60 is the floor loop-server enforces (`cronField` + `cronFromSeconds` in
 * `packages/loop-deploy/src/config.ts`). The composer only exposes an
 * auto-compound cadence today (a rebalance interval, not a strike
 * interval); when the canvas grows a strike-cadence dial, this constant
 * moves onto the draft.
 */
const DEFAULT_CRON_SECONDS = 60;

export interface PublishInput {
  /** User-picked vault name from the Review card. */
  name: string;
  /** Connected wallet address. Becomes the strategist (exit key) on chain. */
  strategist: string;
  /** Composer candidate id (liquidity-source module `candidateId` param). */
  candidateId: string;
  /** Target leverage the composer's safety-buffer slider settled on. */
  targetLeverage: number;
  /**
   * Every OTHER knob the composer tuned, string-encoded. Passed to
   * loop-server verbatim and merged into the workflow's `componentConfig`
   * on IPFS, so the operators re-execute EXACTLY what the user picked. The
   * shape is a flat map by design: each key is a stable name the WASM
   * component reads (risk_preset, hf_target_bps, compound_cadence_hours,
   * exit_route_id, ...), each value the string form the composer stored it
   * in. Absent -> `{}`, which loop-server treats as no extra knobs.
   */
  strategyParams?: Record<string, string>;
  /** EIP-712 domain the client and server both hash against. */
  intentDomain: IntentDomain;
  /**
   * Prompt the connected wallet to sign a typed-data payload and return the
   * `0x`-prefixed secp256k1 signature. In production this wraps wagmi's
   * `signTypedData`; a test double can return a precomputed signature so
   * the test never opens a wallet.
   */
  signTypedData: (payload: LoopPublishTypedData) => Promise<`0x${string}`>;
}

export interface PublishResult {
  loopId: string;
  handler: string;
}

/** Turn the composer's inputs into a real deployment. */
export async function publishLoopToServer(input: PublishInput): Promise<PublishResult> {
  const intent: LoopPublishIntent = {
    strategist: input.strategist as Address,
    name: input.name,
    candidateId: input.candidateId,
    cronSeconds: DEFAULT_CRON_SECONDS,
    targetLeverage: input.targetLeverage,
    signedAt: Math.floor(Date.now() / 1000),
  };
  const signature = await input.signTypedData(loopPublishTypedData(intent, input.intentDomain));
  const body: CreateLoopInput = {
    name: input.name,
    strategist: input.strategist,
    cronSeconds: DEFAULT_CRON_SECONDS,
    candidateId: input.candidateId,
    targetLeverage: input.targetLeverage,
    signedAt: intent.signedAt,
    signature,
    strategyParams: input.strategyParams ?? {},
  };
  const { loop } = await createLoop(body);
  if (loop.handlerAddress === null) {
    throw new Error("loop deployed without a handler address; check loop-server logs");
  }
  return { loopId: loop.id, handler: loop.handlerAddress };
}

export { LoopValidationError };
