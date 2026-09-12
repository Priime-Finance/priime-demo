/**
 * Loop deployment orchestrator.
 *
 * Invariants:
 * - Every service.json mutation (fetch -> edit -> pin -> setServiceURI) runs
 *   through ONE serialized queue. The service definition is a single shared
 *   document with last-write-wins semantics on chain; two concurrent edits
 *   would silently drop one loop.
 * - Every step is recorded in the registry before the next one starts, so a
 *   crashed deploy resumes from its `step` instead of duplicating the
 *   handler or the workflow.
 */

import { addLoopWorkflow, newWorkflowId, removeLoopWorkflow } from "./builder.ts";
import { lookupMarket } from "./catalog.ts";
import type { ChainPort } from "./chain.ts";
import { componentConfigFor, cronFromSeconds, resolveLoopConfig, ValidationError, validateLoopConfig, type LoopConfig } from "./config.ts";
import type { IpfsPort } from "./ipfs.ts";
import { parseLossless, stringifyLossless } from "./json.ts";
import type { LoopRecord, LoopRegistry } from "./registry.ts";

export class LoopNotFoundError extends Error {
  constructor(id: string) {
    super(`loop ${id} not found`);
    this.name = "LoopNotFoundError";
  }
}

/** Raised when pause is refused because the on-chain vault still has mid-flight deposit or redeem escrow that a workflow removal would strand. */
export class PauseGuardError extends Error {
  readonly pendingDepositAssets: bigint;
  readonly pendingRedeemShares: bigint;
  constructor(pendingDepositAssets: bigint, pendingRedeemShares: bigint) {
    super(
      `refusing to pause: vault has pendingDepositAssets=${pendingDepositAssets.toString()} (USDC base units) and pendingRedeemShares=${pendingRedeemShares.toString()} (vault-share base units). Both must be zero — wait for the next quorum-signed strike to fulfill them, then retry.`,
    );
    this.name = "PauseGuardError";
    this.pendingDepositAssets = pendingDepositAssets;
    this.pendingRedeemShares = pendingRedeemShares;
  }
}

export interface DeployerOptions {
  registry: LoopRegistry;
  chain: ChainPort;
  ipfs: IpfsPort;
  /** ChainKey the aggregator submits on, e.g. "evm:31337". */
  chainKey: string;
  /** Vault asset address, injected into every loop's component config. */
  usdcAddress: string;
  /** Template workflow to clone; defaults to the sole existing workflow. */
  templateWorkflowId?: string;
  /** Loop trigger end_time horizon from now, nanoseconds. Default 10 years. */
  loopTtlNanos?: bigint;
  /** Clock override for tests, nanoseconds since epoch. */
  nowNanos?: () => bigint;
}

const TEN_YEARS_NANOS = 10n * 365n * 24n * 3600n * 1_000_000_000n;

export class LoopDeployer {
  private readonly registry: LoopRegistry;
  private readonly chain: ChainPort;
  private readonly ipfs: IpfsPort;
  private readonly chainKey: string;
  private readonly usdcAddress: string;
  private readonly templateWorkflowId: string | undefined;
  private readonly loopTtlNanos: bigint;
  private readonly nowNanos: () => bigint;
  /** Tail of the service.json mutation queue. */
  private mutationTail: Promise<unknown> = Promise.resolve();

  constructor(options: DeployerOptions) {
    this.registry = options.registry;
    this.chain = options.chain;
    this.ipfs = options.ipfs;
    this.chainKey = options.chainKey;
    this.usdcAddress = options.usdcAddress.toLowerCase();
    this.templateWorkflowId = options.templateWorkflowId;
    this.loopTtlNanos = options.loopTtlNanos ?? TEN_YEARS_NANOS;
    this.nowNanos = options.nowNanos ?? (() => BigInt(Date.now()) * 1_000_000n);
  }

  /** Validate, record, and fully deploy a new loop. */
  async createLoop(input: unknown): Promise<LoopRecord> {
    const config = resolveLoopConfig(input);
    // The catalog carries entries for every supported chain; the server
    // only speaks its own. Reject a candidate from a mismatched chain up
    // front so a Sepolia loop-server cannot be tricked into deploying a
    // mainnet-flavoured market (and vice versa).
    const market = lookupMarket(config.candidateId);
    if (market === null || market.chainKey !== this.chainKey) {
      throw new ValidationError([
        `candidateId "${config.candidateId}" is not deployable on this server's chain (${this.chainKey})`,
      ]);
    }
    // Pool preflight: one eth_call to slot0() so a market with a wrong
    // pool address is rejected here, not diagnosed later from an opaque
    // WASM `buffer overrun while deserializing` in the operator logs.
    // Regression pin for the Aerodrome CL → Uniswap V3 migration bug.
    try {
      await this.chain.verifyUniswapV3Pool(config.poolAddress);
    } catch (err) {
      throw new ValidationError([
        `poolAddress "${config.poolAddress}" does not respond as a Uniswap V3 pool: ${err instanceof Error ? err.message : String(err)}`,
      ]);
    }
    const record = this.registry.create({
      id: `loop-${crypto.randomUUID().slice(0, 8)}`,
      name: config.name,
      workflowId: newWorkflowId(),
      strategist: config.strategist,
      configJson: JSON.stringify(config),
    });
    return await this.runPipeline(record.id);
  }

  /** Resume a failed deployment from its recorded step. */
  async resumeLoop(id: string): Promise<LoopRecord> {
    const record = this.registry.get(id);
    if (record === null) throw new LoopNotFoundError(id);
    if (record.status === "active" || record.status === "inactive") return record;
    return await this.runPipeline(id);
  }

  /** Remove the loop's workflow from the service. The handler stays on chain. */
  async deactivateLoop(id: string): Promise<LoopRecord> {
    const record = this.registry.get(id);
    if (record === null) throw new LoopNotFoundError(id);
    if (record.status === "inactive") return record;
    // Pre-flight: refuse pause if the on-chain vault would leave any tester's
    // escrow stranded. `totalPendingDepositAssets` and `totalPendingRedeemShares`
    // only clear at a quorum-signed strike; if the workflow is removed first,
    // there is nothing left to fulfill them. Handler-less loops (still
    // scaffolding) skip: no vault means nothing to strand.
    if (record.handlerAddress !== null) {
      const { pendingDepositAssets, pendingRedeemShares } =
        await this.chain.vaultPendingBalances(record.handlerAddress);
      if (pendingDepositAssets > 0n || pendingRedeemShares > 0n) {
        throw new PauseGuardError(pendingDepositAssets, pendingRedeemShares);
      }
    }
    try {
      // Deploys that never reached the service have nothing to remove.
      if (record.step === "service_updated" || record.step === "active") {
        const protectedIds = this.templateWorkflowId === undefined ? [] : [this.templateWorkflowId];
        const cid = await this.mutateService((doc) => removeLoopWorkflow(doc, record.workflowId, protectedIds));
        this.registry.update(id, { serviceCid: cid });
      }
      return this.registry.update(id, { status: "inactive", error: null });
    } catch (err) {
      this.registry.update(id, { status: "failed", error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  private async runPipeline(id: string): Promise<LoopRecord> {
    try {
      let record = this.requireLoop(id);
      /* Legacy configJson written before the router+tickSpacing became first-
         class fields on LoopConfig (roadmap P00 #9). Backfill from the catalog
         so `validateLoopConfig` stays strict for new configs while old records
         still resume cleanly. The catalog is the source of truth for both
         values either way (see `resolveLoopConfig`). */
      const raw = JSON.parse(record.configJson) as Record<string, unknown>;
      if (raw !== null && typeof raw === "object") {
        if (raw.swapRouter === undefined || raw.poolFee === undefined) {
          const cid = typeof raw.candidateId === "string" ? raw.candidateId : "";
          const market = lookupMarket(cid);
          if (market !== null) {
            if (raw.swapRouter === undefined) raw.swapRouter = market.swapRouter;
            if (raw.poolFee === undefined) raw.poolFee = market.poolFee;
          }
        }
      }
      const config: LoopConfig = validateLoopConfig(raw);

      if (record.handlerAddress === null) {
        const market = lookupMarket(config.candidateId);
        if (market === null) {
          throw new Error(`market catalog missing entry for ${config.candidateId}`);
        }
        const handler = await this.chain.deployHandler(config.strategist, {
          collateralToken: market.usdeAddress,
          morpho: market.morphoAddress,
          morphoOracle: market.oracleAddress,
          morphoIrm: market.irmAddress,
          morphoLltv: BigInt(market.lltv),
          swapRouter: market.swapRouter,
          poolFee: market.poolFee,
        });
        record = this.registry.update(id, { handlerAddress: handler, step: "handler_deployed", status: "deploying", error: null });
      }

      if (record.step !== "service_updated" && record.step !== "active") {
        const handlerAddress = record.handlerAddress;
        if (handlerAddress === null) throw new Error(`loop ${id} reached ${record.step} without a handler`);
        const now = this.nowNanos();
        const cid = await this.mutateService((doc) =>
          addLoopWorkflow(
            doc,
            {
              workflowId: record.workflowId,
              componentConfig: componentConfigFor(config, {
                chainKey: this.chainKey,
                usdcAddress: this.usdcAddress,
                vaultAddress: handlerAddress,
              }),
              aggregatorTarget: { chainKey: this.chainKey, handler: handlerAddress },
              cron: {
                schedule: cronFromSeconds(config.cronSeconds),
                startTimeNanos: now,
                endTimeNanos: now + this.loopTtlNanos,
              },
            },
            this.templateWorkflowId,
          ),
        );
        record = this.registry.update(id, { serviceCid: cid, step: "service_updated" });
      }

      return this.registry.update(id, { step: "active", status: "active", error: null });
    } catch (err) {
      this.registry.update(id, { status: "failed", error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  private requireLoop(id: string): LoopRecord {
    const record = this.registry.get(id);
    if (record === null) throw new LoopNotFoundError(id);
    return record;
  }

  /**
   * Serialized service.json mutation: fetch the manager's current document,
   * apply `edit`, pin the result, point the manager at it. Returns the new
   * document's ipfs:// URI.
   */
  private mutateService(edit: (doc: unknown) => unknown): Promise<string> {
    const run = async (): Promise<string> => {
      const currentUri = await this.chain.getServiceUri();
      const currentText = await this.ipfs.fetchText(currentUri);
      const doc = parseLossless(currentText);
      const edited = edit(doc);
      const nextText = stringifyLossless(edited, 2);
      const nextUri = await this.ipfs.pinText(nextText, "service.json");
      await this.chain.setServiceUri(nextUri);
      return nextUri;
    };
    // Chain onto the tail regardless of predecessor outcome; each mutation
    // fails or succeeds on its own.
    const next = this.mutationTail.then(run, run);
    this.mutationTail = next.catch(() => undefined);
    return next;
  }
}
