/**
 * Journal builder: turn on-chain attestation facts into a v1 Journal.
 *
 * Pure. All chain access is done by the caller in `journal-source.ts`; this
 * module only assembles the record. Output is typed as `Journal` from
 * `@priime-demo/journal-schema`, so drift with the frozen contract is a
 * compile error.
 *
 * What we CAN reconstruct from chain data alone:
 *   - the accepted operators (recovered from `SignatureData.signers`)
 *   - the winning result hash and payload (from the envelope in calldata)
 *   - inputs block, NAV final, attestation tx/block/timestamp
 *
 * What we CANNOT reconstruct without an aggregator-side journal:
 *   - rejected operators (their submissions never reach the manager)
 *   - per-operator timestamp before the on-chain landing
 *   - the transition sequence with real per-operator arrival times
 *
 * Consequence: journals emitted here are always `status: "settled"` with
 * `accepted: true` on every listed operator. Sabotage narratives stay in the
 * captured samples until we add an aggregator-side writer. Documented.
 */

import type { Journal, Operator, Transition } from "@priime-demo/journal-schema";

/** Duplicated to avoid a runtime dep on journal-schema's value exports (its
 *  json import path is not resolvable under Node without an assertion). The
 *  frozen v1 contract fixes this string; a change means a v2 package. */
const SCHEMA_VERSION = "1.0.0" as const;
import { createHash } from "node:crypto";

/** WAVS ServiceId derivation for EVM managers. Mirrors ServiceId::hash in
 *  priime-processor/packages/types/src/id/service.rs: `sha256("evm" || chain
 *  key || address bytes)`, printed as lowercase 64-char hex without 0x. */
export function deriveServiceId(chainKey: string, managerAddress: string): string {
  const addressHex = managerAddress.toLowerCase().replace(/^0x/, "");
  if (addressHex.length !== 40) throw new Error(`bad manager address: ${managerAddress}`);
  const chainBytes = Buffer.from(chainKey, "utf8");
  const addressBytes = Buffer.from(addressHex, "hex");
  return createHash("sha256")
    .update(Buffer.from("evm", "utf8"))
    .update(chainBytes)
    .update(addressBytes)
    .digest("hex");
}

/** `<service_id>:<inputs_block>`, matching the sample convention. */
export function deriveStrikeId(serviceId: string, inputsBlock: number | bigint): string {
  return `${serviceId}:${String(inputsBlock)}`;
}

export interface JournalBuildInput {
  chainId: number;
  chainKey: string;
  managerAddress: string;
  vaultAddress: string;
  componentDigest: string;
  navAsset: string;
  navDecimals: number;
  quorumThreshold: number;
  quorumTotal: number;
  /** eventId is 20 bytes in the envelope; the vault indexes it. */
  eventId: string;
  /** Inputs block the operators pinned reads to. */
  inputsBlock: bigint;
  /** Final NAV recorded on chain, as a base-unit bigint. */
  navFinal: bigint;
  /** Raw envelope payload bytes (abi.encode(handler, nav, inputsBlock)). */
  payload: string;
  /** keccak256 of the abi-encoded envelope tuple. What each operator signs. */
  resultHash: string;
  /** Addresses that landed in the winning SignatureData. */
  acceptedSigners: string[];
  /** Signatures in the same order as `acceptedSigners`. */
  signatures: string[];
  /** Attestation tx that carried the envelope on-chain. */
  attestationTxHash: string;
  attestationBlockNumber: bigint;
  attestationTimestamp: number;
}

/** Build a settled Journal from one on-chain attestation. */
export function buildJournal(input: JournalBuildInput): Journal {
  if (input.acceptedSigners.length !== input.signatures.length) {
    throw new Error("acceptedSigners and signatures length mismatch");
  }
  if (input.acceptedSigners.length === 0) {
    throw new Error("cannot build journal with zero accepted signers");
  }

  const serviceId = deriveServiceId(input.chainKey, input.managerAddress);
  const strikeId = deriveStrikeId(serviceId, input.inputsBlock);
  const inputsBlockNum = Number(input.inputsBlock);
  const navFinalStr = input.navFinal.toString();

  const operators: Operator[] = input.acceptedSigners.map((address, i) => ({
    id: address.toLowerCase(),
    result_hash: input.resultHash,
    nav: navFinalStr,
    signature: input.signatures[i]!,
    timestamp: input.attestationTimestamp,
    accepted: true,
    result_payload: input.payload,
  }));

  const transitions: Transition[] = operators.map((op, i) => {
    const cumulative = i + 1;
    return {
      cumulative,
      operator_id: op.id,
      result_hash: op.result_hash,
      reached: cumulative >= input.quorumThreshold,
      timestamp: op.timestamp,
    };
  });

  return {
    schema_version: SCHEMA_VERSION,
    strike_id: strikeId,
    status: "settled",
    service_id: serviceId,
    vault: { chain_id: input.chainId, address: input.vaultAddress.toLowerCase() },
    component_digest: input.componentDigest,
    trigger: { type: "cron", block: inputsBlockNum, tx_hash: null },
    inputs_block: inputsBlockNum,
    nav_unit: { asset: input.navAsset, decimals: input.navDecimals },
    operators,
    quorum: {
      threshold: input.quorumThreshold,
      total: input.quorumTotal,
      reached: true,
      winning_result_hash: input.resultHash,
      transitions,
    },
    attestation: {
      tx_hash: input.attestationTxHash.toLowerCase(),
      chain_id: input.chainId,
      block_number: Number(input.attestationBlockNumber),
      nav_final: navFinalStr,
      timestamp: input.attestationTimestamp,
    },
  };
}

