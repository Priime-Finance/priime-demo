/**
 * Journal reader: pulls the NavUpdated log stream off a handler contract,
 * decodes the tx that carried each envelope, and emits Journals.
 *
 * The heavy lifting is in `buildJournal` (pure). This module only owns the
 * viem plumbing and the ABI shapes needed to reach on-chain state.
 */

import type { Journal } from "@priime-demo/journal-schema";
import {
  createPublicClient,
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  http,
  keccak256,
  parseAbi,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import { buildJournal, type JournalBuildInput } from "./journal.ts";

/** Minimal handler ABI: the NavUpdated event and the handleSignedEnvelope selector. */
const HANDLER_ABI = parseAbi([
  "event NavUpdated(bytes20 indexed eventId, uint256 nav, uint256 inputsBlock, uint256 updateCount, bytes32 configHash, uint32 leverageBps, uint32 ltvBps, uint32 reserveBps, uint32 supplyApyBps, uint32 hoursSinceUpdate)",
  "function handleSignedEnvelope((bytes20 eventId, bytes12 ordering, bytes payload) envelope, (address[] signers, bytes[] signatures, uint32 referenceBlock) signatureData) external",
  "function asset() external view returns (address)",
]) satisfies Abi;

const ERC20_META_ABI = parseAbi([
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
]) satisfies Abi;

export interface JournalReaderOptions {
  rpcUrl: string;
  chainId: number;
  chainKey: string;
  managerAddress: string;
  componentDigest: string;
  /** Quorum config surfaced by the deployer at bring-up. */
  quorumThreshold: number;
  quorumTotal: number;
  /** Where to start scanning for NavUpdated logs. Defaults to earliest. */
  fromBlock?: bigint;
}

/**
 * Per-strike observations decoded from the payload. Every operator computes
 * these deterministically from chain state at `inputs_block`, so identical
 * bytes across the quorum are the "cannot lie about observations" property.
 */
export interface Observations {
  leverageBps: number;
  ltvBps: number;
  reserveBps: number;
  supplyApyBps: number;
  hoursSinceUpdate: number;
}

/**
 * The Journal for a strike plus the per-strike observations. Observations
 * live alongside the Journal rather than inside it because the v1 Journal
 * schema is frozen; new attested fields ride as an off-schema companion
 * that the UI consumes without waiting for a schema bump.
 */
export type StrikeRecord = Journal & { observations: Observations };

export interface JournalReader {
  /** Latest N strikes for a handler, newest first. */
  readJournals(vaultAddress: string, limit: number): Promise<StrikeRecord[]>;
}

/**
 * payload = abi.encode(
 *   address handler, uint256 nav, uint256 inputsBlock, bytes32 configHash,
 *   uint32 leverageBps, uint32 ltvBps, uint32 reserveBps,
 *   uint32 supplyApyBps, uint32 hoursSinceUpdate
 * ).
 *
 * Only the first three fields drive `Journal` today (the handler binding
 * check, the attested nav, and the inputs_block cross-check); the rest ride
 * as event fields for downstream verifiers and the UI. Declaring the full
 * tuple here keeps the payload-decode aligned with the vault's decoder, so
 * any mismatch fails decoding rather than silently reading stale bytes.
 */
const PAYLOAD_TUPLE = [
  { type: "address", name: "handler" },
  { type: "uint256", name: "nav" },
  { type: "uint256", name: "inputsBlock" },
  { type: "bytes32", name: "configHash" },
  { type: "uint32", name: "leverageBps" },
  { type: "uint32", name: "ltvBps" },
  { type: "uint32", name: "reserveBps" },
  { type: "uint32", name: "supplyApyBps" },
  { type: "uint32", name: "hoursSinceUpdate" },
] as const;

/** Envelope tuple as WAVS signs it. */
const ENVELOPE_TUPLE = [
  { type: "bytes20" },
  { type: "bytes12" },
  { type: "bytes" },
] as const;

interface NavUnit {
  asset: string;
  decimals: number;
}

/** Build a JournalReader against a running RPC. */
export function makeJournalReader(options: JournalReaderOptions): JournalReader {
  const client: PublicClient = createPublicClient({ transport: http(options.rpcUrl) });
  // Handler => nav unit. Dynamic keys (unknown until a POST /loops lands),
  // string keys, one entry per loop; a plain object works.
  const navUnitCache: Record<string, NavUnit> = Object.create(null) as Record<string, NavUnit>;
  const navUpdatedEvent = HANDLER_ABI.find(
    (e): e is Extract<(typeof HANDLER_ABI)[number], { type: "event" }> =>
      e.type === "event" && e.name === "NavUpdated",
  );
  if (navUpdatedEvent === undefined) throw new Error("handler abi is missing NavUpdated");

  const readNavUnit = async (vault: Address): Promise<NavUnit> => {
    const key = vault.toLowerCase();
    const cached = navUnitCache[key];
    if (cached !== undefined) return cached;
    const asset = (await client.readContract({
      address: vault,
      abi: HANDLER_ABI,
      functionName: "asset",
    })) as Address;
    const [decimals, symbol] = await Promise.all([
      client.readContract({ address: asset, abi: ERC20_META_ABI, functionName: "decimals" }) as Promise<number>,
      client.readContract({ address: asset, abi: ERC20_META_ABI, functionName: "symbol" }) as Promise<string>,
    ]);
    const unit: NavUnit = { asset: symbol, decimals: Number(decimals) };
    navUnitCache[key] = unit;
    return unit;
  };

  return {
    async readJournals(vaultAddress: string, limit: number): Promise<StrikeRecord[]> {
      const vault = vaultAddress.toLowerCase() as Address;
      // Some RPCs (Base fork on anvil) cap eth_getLogs at 10k blocks. Default
      // to a rolling window ending at head; callers with a wider need set
      // fromBlock explicitly.
      const head = await client.getBlockNumber();
      const from = options.fromBlock ?? (head > 9_999n ? head - 9_999n : 0n);
      const logs = await client.getLogs({
        address: vault,
        event: navUpdatedEvent,
        fromBlock: from,
        toBlock: head,
      });
      // Newest first, bounded.
      const picked = logs.slice(-Math.max(1, limit)).reverse();
      const unit = await readNavUnit(vault);

      const strikes: StrikeRecord[] = [];
      for (const log of picked) {
        const args = log.args as { eventId?: Hex; nav?: bigint; inputsBlock?: bigint };
        if (log.transactionHash === null || args.eventId === undefined || args.nav === undefined || args.inputsBlock === undefined) {
          continue;
        }

        const [tx, receipt] = await Promise.all([
          client.getTransaction({ hash: log.transactionHash }),
          client.getTransactionReceipt({ hash: log.transactionHash }),
        ]);
        const block = await client.getBlock({ blockHash: receipt.blockHash });

        let envelope: { eventId: Hex; ordering: Hex; payload: Hex };
        let signatureData: { signers: readonly Address[]; signatures: readonly Hex[]; referenceBlock: number };
        try {
          const call = decodeFunctionData({ abi: HANDLER_ABI, data: tx.input });
          if (call.functionName !== "handleSignedEnvelope") continue;
          const [e, s] = call.args as [
            { eventId: Hex; ordering: Hex; payload: Hex },
            { signers: readonly Address[]; signatures: readonly Hex[]; referenceBlock: number },
          ];
          envelope = e;
          signatureData = s;
        } catch {
          // Envelope delivered via a router (multicall, batcher) is not
          // supported yet; skipping rather than crashing the reader.
          continue;
        }

        const [
          payloadHandler,
          payloadNav,
          payloadInputsBlock,
          ,
          leverageBps,
          ltvBps,
          reserveBps,
          supplyApyBps,
          hoursSinceUpdate,
        ] = decodeAbiParameters(PAYLOAD_TUPLE, envelope.payload);
        if (payloadHandler.toLowerCase() !== vault) continue;
        if (payloadInputsBlock !== args.inputsBlock) {
          throw new Error(
            `inputs_block mismatch: payload ${payloadInputsBlock.toString()}, event ${args.inputsBlock.toString()}`,
          );
        }

        const envelopeBytes = encodeAbiParameters(
          ENVELOPE_TUPLE,
          [envelope.eventId, envelope.ordering, envelope.payload],
        );
        const resultHash = keccak256(envelopeBytes);

        const input: JournalBuildInput = {
          chainId: options.chainId,
          chainKey: options.chainKey,
          managerAddress: options.managerAddress,
          vaultAddress: vault,
          componentDigest: options.componentDigest,
          navAsset: unit.asset,
          navDecimals: unit.decimals,
          quorumThreshold: options.quorumThreshold,
          quorumTotal: options.quorumTotal,
          eventId: envelope.eventId,
          inputsBlock: args.inputsBlock,
          navFinal: payloadNav,
          payload: envelope.payload,
          resultHash,
          acceptedSigners: [...signatureData.signers],
          signatures: [...signatureData.signatures],
          attestationTxHash: log.transactionHash,
          attestationBlockNumber: receipt.blockNumber,
          attestationTimestamp: Number(block.timestamp),
        };
        const observations: Observations = {
          leverageBps,
          ltvBps,
          reserveBps,
          supplyApyBps,
          hoursSinceUpdate,
        };
        strikes.push({ ...buildJournal(input), observations });
      }
      return strikes;
    },
  };
}
