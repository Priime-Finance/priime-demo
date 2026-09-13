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
  "function updateCount() external view returns (uint256)",
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

/** Only the service-manager event we need to derive the on-chain quorum
 *  fraction. `QuorumThresholdUpdated(numerator, denominator)` is a
 *  cumulative log stream: the LATEST emission is the current threshold
 *  the manager gates `validate()` against. Both fields are `indexed`
 *  in the interface (`contracts/src/interfaces/priime/IPriimeServiceManager.sol`). */
const MANAGER_ABI = parseAbi([
  "event QuorumThresholdUpdated(uint256 indexed numerator, uint256 indexed denominator)",
]) satisfies Abi;

export interface JournalReaderOptions {
  rpcUrl: string;
  chainId: number;
  chainKey: string;
  managerAddress: string;
  componentDigest: string;
  /**
   * FALLBACK ONLY. Used when the manager has never emitted a
   * `QuorumThresholdUpdated` event (fresh deploy, or a fork replayed
   * without the constructor emission). The reader ALWAYS prefers the
   * on-chain event scan; these values are what a new build advertises
   * before the first threshold write lands.
   */
  fallbackQuorumThreshold: number;
  fallbackQuorumTotal: number;
  /** Where to start scanning for `NavUpdated` and `QuorumThresholdUpdated` logs. Defaults to earliest. */
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

/**
 * Wire shape returned by `readJournals` and served verbatim by
 * `loop-server` on `GET /loops/:id/journals`. The `journal` field is
 * schema-compliant against `schema/journal.v1.schema.json` (v1 is
 * FROZEN with `additionalProperties:false`; `docs/LIVE_DEMO.md` and
 * `schema/README.md` both promise every emitted record validates
 * against it). `observations` and `plan` are enrichments the reader
 * decodes from the strike's calldata; they sit as SIBLING fields so
 * they never contaminate the schema-valid journal object.
 */
export interface JournalWireEntry {
  journal: Journal;
  observations: Observations;
  plan: AttestedPlan;
}

/**
 * Flat client-facing view. Kept as a `Journal & { observations, plan }`
 * intersection so existing UI code that reads `strike.attestation` /
 * `strike.inputs_block` / `strike.plan.status` in one namespace stays
 * unchanged. The wire boundary (`apps/replay-ui/lib/vaults/live-source.ts`)
 * flattens `JournalWireEntry` into this shape on parse.
 */
export type StrikeRecord = Journal & {
  observations: Observations;
  plan: AttestedPlan;
};

/**
 * Result of `readJournals`. Carries the scan window and the on-chain
 * strike count alongside the decoded strikes so consumers can tell a
 * "vault has never attested" state apart from a "vault attested plenty,
 * but every strike is older than our lookback window" state — which
 * used to render identically as `{ journals: [], attested: null }`.
 */
export interface JournalScan {
  strikes: JournalWireEntry[];
  /**
   * `updateCount` read straight off the vault. `strikes.length` never
   * exceeds `Number(chainStrikeCount)`; if it is strictly less, our
   * window is missing strikes and the UI MUST tell the operator the
   * shortfall instead of drawing an idle vault.
   */
  chainStrikeCount: bigint;
  /** Inclusive lower bound of the block range we scanned. */
  windowFromBlock: bigint;
  /** Inclusive upper bound of the block range we scanned. */
  windowToBlock: bigint;
  /**
   * On-chain quorum threshold, resolved from the LATEST
   * `QuorumThresholdUpdated(numerator, denominator)` event on the
   * service manager. `source: "chain"` means the scan found at least
   * one emission in the window; `source: "fallback"` means the reader
   * fell back to its constructor's `fallbackQuorumThreshold/Total`
   * (the loop-server env values) because no event was found — usually
   * a fresh deploy before the first threshold write, or a chain
   * snapshot that pre-dates the manager. Consumers MUST render the
   * source so the UI never poses env defaults as chain reads.
   */
  chainQuorum: { threshold: number; total: number; source: "chain" | "fallback" };
}

/**
 * Pick the authoritative `chainQuorum` from a `QuorumThresholdUpdated`
 * log stream. The event is cumulative on chain — later emissions
 * replace earlier ones — so the latest well-formed entry wins.
 *
 * Returns the caller's `fallback` (tagged `source: "fallback"`) when
 * the stream is empty or every entry is malformed (missing args,
 * zero denominator). Split out for isolated testing; `readJournals`
 * calls it after fetching the logs.
 */
export function pickLatestQuorum(
  logs: readonly { args: { numerator?: bigint; denominator?: bigint } }[],
  fallback: { threshold: number; total: number },
): { threshold: number; total: number; source: "chain" | "fallback" } {
  for (let i = logs.length - 1; i >= 0; i -= 1) {
    const { numerator, denominator } = logs[i]!.args;
    if (numerator === undefined || denominator === undefined) continue;
    if (denominator === 0n) continue;
    return { threshold: Number(numerator), total: Number(denominator), source: "chain" };
  }
  return { threshold: fallback.threshold, total: fallback.total, source: "fallback" };
}

export interface JournalReader {
  /** Latest N strikes for a handler, newest first, with window metadata. */
  readJournals(vaultAddress: string, limit: number): Promise<JournalScan>;
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

/**
 * Envelope tuple as Priime signs it. `Envelope` is a Solidity struct with a
 * dynamic field (`payload`), so `abi.encode(envelope)` — which is what the
 * Rust side does via `SolValue::abi_encode` on the struct — wraps the tuple
 * with an outer offset word. Encoding as three loose parameters produces a
 * different byte string and therefore a different keccak256, which is what
 * ever consumer would use to verify the signatures we persist in the
 * journal against. Model the tuple explicitly.
 */
const ENVELOPE_TUPLE = [
  {
    type: "tuple",
    components: [
      { name: "eventId", type: "bytes20" },
      { name: "ordering", type: "bytes12" },
      { name: "payload", type: "bytes" },
    ],
  },
] as const;

/**
 * Result hash the operator quorum signs. Byte-identical to what
 * `Envelope.abi_encode()` produces in `priime-types::signing` (verified
 * against the alloy encoding with a matching sample). Any consumer that
 * wants to verify the persisted signatures re-derives the hash from the
 * `payload` + `eventId` + `ordering` fields in the journal, so this
 * function has to stay in lockstep with the Rust side or the whole
 * signature record becomes decorative.
 */
export function hashEnvelope(envelope: { eventId: `0x${string}`; ordering: `0x${string}`; payload: `0x${string}` }): `0x${string}` {
  return keccak256(
    encodeAbiParameters(ENVELOPE_TUPLE, [{
      eventId: envelope.eventId,
      ordering: envelope.ordering,
      payload: envelope.payload,
    }]),
  );
}

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

  // Chain-authoritative quorum: scan `QuorumThresholdUpdated` events off
  // the service manager and take the LATEST emission. The fallback env
  // values are only used when the manager has never emitted (fresh
  // deploy, or a fork replayed without a threshold write). Cache the
  // result; the event is rare and the RPC cost adds up otherwise.
  const managerQuorumUpdated = MANAGER_ABI.find(
    (e): e is Extract<(typeof MANAGER_ABI)[number], { type: "event" }> =>
      e.type === "event" && e.name === "QuorumThresholdUpdated",
  );
  if (managerQuorumUpdated === undefined) throw new Error("manager abi is missing QuorumThresholdUpdated");
  type ChainQuorum = { threshold: number; total: number; source: "chain" | "fallback" };
  let quorumCache: ChainQuorum | null = null;
  const resolveQuorum = async (headBlock: bigint): Promise<ChainQuorum> => {
    if (quorumCache !== null) return quorumCache;
    // Same window bounds `readJournals` uses for NavUpdated: honours
    // `fromBlock` if the caller pins one, otherwise a rolling 10k
    // (Base fork on anvil caps `eth_getLogs` at 10 000 blocks).
    const scanFrom = options.fromBlock ?? (headBlock > 9_999n ? headBlock - 9_999n : 0n);
    const logs = await client.getLogs({
      address: options.managerAddress as Address,
      event: managerQuorumUpdated,
      fromBlock: scanFrom,
      toBlock: headBlock,
    });
    quorumCache = pickLatestQuorum(logs, {
      threshold: options.fallbackQuorumThreshold,
      total: options.fallbackQuorumTotal,
    });
    return quorumCache;
  };

  return {
    async readJournals(vaultAddress: string, limit: number): Promise<JournalScan> {
      const vault = vaultAddress.toLowerCase() as Address;
      // Some RPCs (Base fork on anvil) cap eth_getLogs at 10k blocks. Default
      // to a rolling window ending at head; callers with a wider need set
      // fromBlock explicitly.
      const head = await client.getBlockNumber();
      const [chainStrikeCount, chainQuorum] = await Promise.all([
        // Read the vault's own strike counter so callers can tell a
        // stalled vault ("plenty of strikes on-chain, none in our
        // window") from an idle one ("vault has never attested"). The
        // rolling-window read below cannot make that distinction on
        // its own: an empty log slice looks identical either way.
        client.readContract({ address: vault, abi: HANDLER_ABI, functionName: "updateCount" }),
        // Chain-authoritative quorum for the manager (not env
        // defaults). Cached inside `resolveQuorum` — first call scans
        // the manager's `QuorumThresholdUpdated` events; subsequent
        // calls return immediately.
        resolveQuorum(head),
      ]);
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

      const strikes: JournalWireEntry[] = [];
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

        const resultHash = hashEnvelope({
          eventId: envelope.eventId,
          ordering: envelope.ordering,
          payload: envelope.payload,
        });

        const input: JournalBuildInput = {
          chainId: options.chainId,
          chainKey: options.chainKey,
          managerAddress: options.managerAddress,
          vaultAddress: vault,
          componentDigest: options.componentDigest,
          navAsset: unit.asset,
          navDecimals: unit.decimals,
          quorumThreshold: chainQuorum.threshold,
          quorumTotal: chainQuorum.total,
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

        strikes.push({ journal: buildJournal(input), observations, plan });
      }
      return { strikes, chainStrikeCount, windowFromBlock: from, windowToBlock: head, chainQuorum };
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
