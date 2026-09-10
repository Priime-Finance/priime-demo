/**
 * Publish adapter: turns the composer's publish draft + a connected wallet
 * into a POST /api/loops call.
 *
 * The draft carries the composer's actual choices (candidate id + target
 * leverage from the graph, name from the Review card, cadence from the
 * server's demo default). loop-server resolves the candidate against its
 * market catalog and rejects anything it cannot deploy; the caller renders
 * the resulting issues in the error phase.
 */

import { createLoop, LoopValidationError, type CreateLoopInput } from "./live-source";

/**
 * Strike cadence for the loop, seconds.
 *
 * Kept server-adjacent because the composer only exposes an auto-compound
 * cadence today (a rebalance interval, not a strike interval). When the
 * canvas grows a strike-cadence dial, this constant moves onto the draft.
 */
const DEMO_CRON_SECONDS = 10;

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
    candidateId: input.candidateId,
    targetLeverage: input.targetLeverage,
    strategyParams: input.strategyParams ?? {},
  };
  const { loop } = await createLoop(body);
  if (loop.handlerAddress === null) {
    throw new Error("loop deployed without a handler address; check loop-server logs");
  }
  return { loopId: loop.id, handler: loop.handlerAddress };
}

export { LoopValidationError };
