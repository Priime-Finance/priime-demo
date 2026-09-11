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

/** Minimal handler ABI: NavUpdated, PlanExecuted, PlanRejected + the two
 *  vault functions the reader decodes calldata for. */
const HANDLER_ABI = parseAbi([
  "event NavUpdated(bytes20 indexed eventId, uint256 nav, uint256 inputsBlock, uint256 updateCount, bytes32 configHash, uint32 leverageBps, uint32 ltvBps, uint32 reserveBps, uint32 supplyApyBps, uint32 hoursSinceUpdate, uint16 breachFlags)",
  "event PlanExecuted(bytes32 indexed planHash, uint256 stepCount)",
  "event PlanRejected(bytes32 indexed planHash, bytes reason)",
  "function handleSignedEnvelope((bytes20 eventId, bytes12 ordering, bytes payload) envelope, (address[] signers, bytes[] signatures, uint32 referenceBlock) signatureData) external",
  "function asset() external view returns (address)",
]) satisfies Abi;

/** Signatures the operator quorum encodes into StrategyPlan step calldatas.
 *  Used purely for pretty-printing steps on the UI; a selector we don't
 *  recognise degrades to raw hex on the client side. */
const STEP_ABI = parseAbi([
  "function approve(address spender, uint256 amount)",
  "function supplyCollateral((address loanToken,address collateralToken,address oracle,address irm,uint256 lltv) marketParams, uint256 assets, address onBehalf, bytes data)",
  "function borrow((address loanToken,address collateralToken,address oracle,address irm,uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver)",
  "function repay((address loanToken,address collateralToken,address oracle,address irm,uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data)",
  "function withdrawCollateral((address loanToken,address collateralToken,address oracle,address irm,uint256 lltv) marketParams, uint256 assets, address onBehalf, address receiver)",
  "function exactInputSingle((address tokenIn,address tokenOut,int24 tickSpacing,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) returns (uint256)",
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
  /**
   * Bit set OR-composed from `BREACH_HF_FLOOR` (1 << 0) and
   * `BREACH_DELEVERAGE` (1 << 1) in the vault-nav component. Non-zero
   * means at least one strategist-configured guard fired on this strike
   * and the vault contract refuses new deposit / redeem requests until a
   * subsequent clean strike clears the flag.
   */
  breachFlags: number;
}
/**
 * One step in the quorum-signed StrategyPlan, labelled for display. `label`
 * comes from decoding the calldata's selector against `STEP_ABI`;
 * unrecognised selectors degrade to raw hex so the UI never lies about a
 * step it cannot describe.
 */
export interface PlanStep {
  target: string;
  targetLabel: string;
  selector: string;
  label: string;
  calldataHex: string;
}

/**
 * The plan the operator quorum attached to a strike, plus the on-chain
 * outcome. `executed` = every step landed under the escrow-floor guard;
 * `rejected` = the batch reverted (`reason` is the revert bytes decoded
 * to a UTF-8 string when possible); `empty` = the operators saw no action
 * to take at `inputs_block`.
 */
export interface AttestedPlan {
  status: "executed" | "rejected" | "empty";
  planHash: string;
  stepCount: number;
  steps: PlanStep[];
  reason: string | null;
  timestampSecs: number;
}

export type StrikeRecord = Journal & {
  observations: Observations;
  plan: AttestedPlan;
};

export interface JournalReader {
  /** Latest N strikes for a handler, newest first. */
  readJournals(vaultAddress: string, limit: number): Promise<StrikeRecord[]>;
}

/**
 * payload = abi.encode(BoundNavResult) where BoundNavResult is a Solidity
 * struct containing (handler, nav, inputsBlock, configHash, five uint32
 * observations, StrategyPlan). Because the struct has a dynamic field
 * (StrategyPlan carries dynamic arrays), the encoding is Solidity's
 * single-element-tuple wrapper: one 32-byte offset word followed by the
 * struct body. viem/alloy round-trip cleanly on the `tuple` shape below.
 *
 * Only the first three fields drive `Journal` today (the handler binding
 * check, the attested nav, and the inputs_block cross-check); the rest ride
 * as event fields for downstream verifiers and the UI. Declaring the full
 * tuple here keeps the payload-decode aligned with the vault's decoder, so
 * any mismatch fails decoding rather than silently reading stale bytes.
 */
const PAYLOAD_TUPLE = [
  {
    type: "tuple",
    name: "result",
    components: [
      { type: "address", name: "handler" },
      { type: "uint256", name: "nav" },
      { type: "uint256", name: "inputsBlock" },
      { type: "bytes32", name: "configHash" },
      { type: "uint32", name: "leverageBps" },
      { type: "uint32", name: "ltvBps" },
      { type: "uint32", name: "reserveBps" },
      { type: "uint32", name: "supplyApyBps" },
      { type: "uint32", name: "hoursSinceUpdate" },
      { type: "uint16", name: "breachFlags" },
      {
        type: "tuple",
        name: "plan",
        components: [
          { type: "address[]", name: "targets" },
          { type: "bytes[]", name: "calldatas" },
          { type: "uint256", name: "timestamp" },
        ],
      },
    ],
  },
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

        const [result] = decodeAbiParameters(PAYLOAD_TUPLE, envelope.payload);
        const {
          handler: payloadHandler,
          nav: payloadNav,
          inputsBlock: payloadInputsBlock,
          leverageBps,
          ltvBps,
          reserveBps,
          supplyApyBps,
          hoursSinceUpdate,
          breachFlags,
        } = result;
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
          breachFlags,
        };

        const plan = buildAttestedPlan({
          rawPlan: result.plan,
          vaultAddress: vault,
          receiptLogs: receipt.logs,
        });

        strikes.push({ ...buildJournal(input), observations, plan });
      }
      return strikes;
    },
  };
}

// ---------------------------------------------------------------------------
// Plan decoding + step labelling
// ---------------------------------------------------------------------------

interface RawPlan {
  targets: readonly string[];
  calldatas: readonly Hex[];
  timestamp: bigint;
}

/** Selector -> human label + argument formatter. Returns null for the
 *  raw-hex fallback path. */
function labelStepFromCalldata(target: string, calldata: Hex): { selector: string; label: string } {
  const selector = calldata.slice(0, 10);
  try {
    const decoded = decodeFunctionData({ abi: STEP_ABI, data: calldata });
    switch (decoded.functionName) {
      case "approve": {
        const [spender, amount] = decoded.args as [Address, bigint];
        return {
          selector,
          label: `approve ${short(spender)} for ${amount.toString()} base units`,
        };
      }
      case "supplyCollateral": {
        const [, assets, onBehalf] = decoded.args as [unknown, bigint, Address, Hex];
        return {
          selector,
          label: `supplyCollateral(${assets.toString()} to Morpho, onBehalf ${short(onBehalf)})`,
        };
      }
      case "borrow": {
        const [, assets, , onBehalf, receiver] = decoded.args as [
          unknown, bigint, bigint, Address, Address,
        ];
        return {
          selector,
          label: `borrow ${assets.toString()} USDC for ${short(onBehalf)} -> ${short(receiver)}`,
        };
      }
      case "repay": {
        const [, assets, shares, onBehalf] = decoded.args as [
          unknown, bigint, bigint, Address, Hex,
        ];
        return {
          selector,
          label: `repay ${(assets || shares).toString()} to Morpho, onBehalf ${short(onBehalf)}`,
        };
      }
      case "withdrawCollateral": {
        const [, assets, onBehalf, receiver] = decoded.args as [
          unknown, bigint, Address, Address,
        ];
        return {
          selector,
          label: `withdrawCollateral ${assets.toString()} onBehalf ${short(onBehalf)} -> ${short(receiver)}`,
        };
      }
      case "exactInputSingle": {
        const [params] = decoded.args;
        return {
          selector,
          label: `swap ${params.amountIn.toString()} ${short(params.tokenIn)} -> min ${params.amountOutMinimum.toString()} ${short(params.tokenOut)}`,
        };
      }
    }
  } catch {
    // Unknown selector; fall through to raw hex.
  }
  return { selector, label: `raw call to ${short(target)}` };
}

function short(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/** Decode UTF-8 revert reason from Solidity's Error(string) or bytes. */
function decodeRevertReason(raw: Hex): string | null {
  if (raw === "0x") return null;
  // Solidity Error(string) has selector 0x08c379a0 + abi.encode(string).
  if (raw.startsWith("0x08c379a0")) {
    try {
      const [msg] = decodeAbiParameters([{ type: "string" }], `0x${raw.slice(10)}` as Hex);
      return msg as string;
    } catch {
      return raw;
    }
  }
  // Fallback: try UTF-8 of the raw bytes.
  try {
    const bytes = raw.slice(2);
    let out = "";
    for (let i = 0; i < bytes.length; i += 2) {
      out += String.fromCharCode(Number.parseInt(bytes.slice(i, i + 2), 16));
    }
    return out.replace(/[^\x20-\x7e]/g, "").trim() || raw;
  } catch {
    return raw;
  }
}

const PLAN_EXECUTED_TOPIC = keccak256(new TextEncoder().encode("PlanExecuted(bytes32,uint256)"));
const PLAN_REJECTED_TOPIC = keccak256(new TextEncoder().encode("PlanRejected(bytes32,bytes)"));

function buildAttestedPlan(input: {
  rawPlan: RawPlan;
  vaultAddress: string;
  receiptLogs: readonly {
    address: string;
    topics: readonly Hex[];
    data: Hex;
  }[];
}): AttestedPlan {
  const { rawPlan, vaultAddress, receiptLogs } = input;
  const targets = rawPlan.targets.map((t) => t.toLowerCase());
  const calldatas = rawPlan.calldatas;
  const stepCount = targets.length;

  const steps: PlanStep[] = targets.map((target, i) => {
    const calldata = calldatas[i]!;
    const { selector, label } = labelStepFromCalldata(target, calldata);
    return {
      target,
      targetLabel: short(target),
      selector,
      label,
      calldataHex: calldata,
    };
  });

  // Find the plan-status event on THIS vault in the same receipt.
  let status: AttestedPlan["status"] = "empty";
  let planHash = "0x";
  let reason: string | null = null;
  for (const log of receiptLogs) {
    if (log.address.toLowerCase() !== vaultAddress) continue;
    if (log.topics[0] === PLAN_EXECUTED_TOPIC) {
      status = stepCount === 0 ? "empty" : "executed";
      planHash = log.topics[1] ?? "0x";
      break;
    }
    if (log.topics[0] === PLAN_REJECTED_TOPIC) {
      status = "rejected";
      planHash = log.topics[1] ?? "0x";
      reason = decodeRevertReason(log.data);
      break;
    }
  }

  return {
    status,
    planHash,
    stepCount,
    steps,
    reason,
    timestampSecs: Number(rawPlan.timestamp),
  };
}
