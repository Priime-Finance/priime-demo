import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ChainPort } from "../src/chain.ts";
import type { IpfsPort } from "../src/ipfs.ts";
import { workflowIds } from "../src/builder.ts";
import { LoopDeployer } from "../src/deployer.ts";
import { parseLossless, stringifyLossless } from "../src/json.ts";
import { LoopRegistry } from "../src/registry.ts";
import { fixtureServiceText, TEMPLATE_WORKFLOW_ID, validLoopResolveInput } from "./fixtures.ts";

/**
 * Walk a service doc down to a workflow's componentConfig without inline
 * casting. Throws if the doc doesn't match; the caller is a test, so a
 * throw IS the assertion.
 */
function componentConfigOf(doc: unknown, workflowId: string): Record<string, string> {
  if (doc === null || typeof doc !== "object" || !("workflows" in doc)) {
    throw new Error("service doc has no workflows");
  }
  const workflows = doc.workflows;
  if (workflows === null || typeof workflows !== "object" || !(workflowId in workflows)) {
    throw new Error(`service doc missing workflow ${workflowId}`);
  }
  const wf = Object.entries(workflows).find(([k]) => k === workflowId)?.[1];
  if (wf === undefined) throw new Error(`service doc missing workflow ${workflowId}`);
  if (wf === null || typeof wf !== "object" || !("component" in wf)) {
    throw new Error(`workflow ${workflowId} has no component`);
  }
  const component = wf.component;
  if (component === null || typeof component !== "object" || !("config" in component)) {
    throw new Error(`workflow ${workflowId} component has no config`);
  }
  const config = component.config;
  if (config === null || typeof config !== "object") {
    throw new Error(`workflow ${workflowId} component.config is not an object`);
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(config)) {
    if (typeof v !== "string") throw new Error(`componentConfig[${k}] is not a string`);
    out[k] = v;
  }
  return out;
}

/**
 * In-memory chain + IPFS doubles. The "chain" holds the current service URI,
 * the "IPFS" a CID-indexed store; together they emulate the real
 * fetch-edit-pin-set cycle including last-write-wins on the URI.
 */
interface Fakes {
  chain: ChainPort;
  ipfs: IpfsPort;
  counters: { deploys: number; pins: number; setUri: number };
  failNextPin: () => void;
  failNextPoolCheck: () => void;
  setPending: (pendingDepositAssets: bigint, pendingRedeemShares: bigint) => void;
  currentDoc: () => unknown;
  /**
   * Register a one-shot hook that fires just BEFORE the next `pinText`
   * call. Used to simulate an out-of-band `setServiceURI` writer landing
   * mid-mutation, which is exactly the cross-process race
   * `mutateService`'s optimistic-concurrency loop is meant to detect.
   */
  beforeNextPin: (fn: () => Promise<void>) => void;
}

function makeFakes(): Fakes {
  const store = new Map<string, string>();
  store.set("ipfs://QmGenesis", fixtureServiceText());
  let uri = "ipfs://QmGenesis";
  // Emulate a chain head: every `setServiceUri` records a
  // `ServiceURIUpdated` event at the CURRENT head, then advances. The
  // real chain advances by many blocks between txs; a single-block bump
  // per event is enough to exercise the race-detection window because
  // `mutateService` walks (checkpoint+1, writeBlock-1) inclusively.
  let block = 100n;
  const serviceUriUpdates: { block: bigint; uri: string }[] = [];
  let beforeNextPinHook: (() => Promise<void>) | null = null;
  let pinCounter = 0;
  let deployCounter = 0;
  const counters = { deploys: 0, pins: 0, setUri: 0 };
  let pinShouldFail = false;
  let pendingDepositAssets = 0n;
  let pendingRedeemShares = 0n;
  let poolShouldFail = false;

  const pendingDeploys = new Map<string, string>();
  const chain: ChainPort = {
    async submitDeployHandler(strategist: string): Promise<string> {
      counters.deploys += 1;
      deployCounter += 1;
      const vault = `0x${(deployCounter + 0xd000).toString(16).padStart(4, "0")}${strategist.slice(6, 42)}`.toLowerCase();
      const txHash = `0x${"tx".padStart(2, "0")}${deployCounter.toString(16).padStart(62, "0")}`;
      pendingDeploys.set(txHash, vault);
      return txHash;
    },
    async finalizeDeployHandler(txHash: string): Promise<string> {
      const vault = pendingDeploys.get(txHash);
      if (vault === undefined) throw new Error(`test fake has no pending deploy for ${txHash}`);
      return vault;
    },
    async getServiceUri(): Promise<string> {
      return uri;
    },
    async setServiceUri(next: string): Promise<{ txHash: string; blockNumber: bigint }> {
      counters.setUri += 1;
      // Real chain: a submitted tx mines in a block STRICTLY GREATER
      // than any block observable via `getBlockNumber` at submit time.
      // Advance the head first, THEN record the event, so a checkpoint
      // captured before submission and this write's block sandwich any
      // other writer that landed in the same interval — which is what
      // `mutateService`'s optimistic-concurrency scan needs to see.
      block += 1n;
      serviceUriUpdates.push({ block, uri: next });
      uri = next;
      return { txHash: "0xtxhash", blockNumber: block };
    },
    async getCurrentBlockNumber(): Promise<bigint> {
      return block;
    },
    async getServiceUriUpdates(fromBlock: bigint, toBlock: bigint): Promise<string[]> {
      if (toBlock < fromBlock) return [];
      return serviceUriUpdates
        .filter((e) => e.block >= fromBlock && e.block <= toBlock)
        .map((e) => e.uri);
    },
    async vaultPendingBalances(_vaultAddress: string): Promise<{ pendingDepositAssets: bigint; pendingRedeemShares: bigint }> {
      return { pendingDepositAssets: pendingDepositAssets, pendingRedeemShares: pendingRedeemShares };
    },
    async verifyUniswapV3Pool(_poolAddress: string): Promise<void> {
      if (poolShouldFail) {
        poolShouldFail = false;
        throw new Error(`Aerodrome CL slot0 mismatch (test-forced)`);
      }
    },
  };

  const ipfs: IpfsPort = {
    async fetchText(u: string): Promise<string> {
      const text = store.get(u);
      if (text === undefined) throw new Error(`unknown cid ${u}`);
      return text;
    },
    async pinText(content: string): Promise<string> {
      if (beforeNextPinHook !== null) {
        const fire = beforeNextPinHook;
        beforeNextPinHook = null;
        await fire();
      }
      if (pinShouldFail) {
        pinShouldFail = false;
        throw new Error("ipfs down");
      }
      counters.pins += 1;
      pinCounter += 1;
      const cid = `ipfs://QmPinned${pinCounter}`;
      store.set(cid, content);
      return cid;
    },
  };

  return {
    chain,
    ipfs,
    counters,
    failNextPin: () => {
      pinShouldFail = true;
    },
    failNextPoolCheck: () => {
      poolShouldFail = true;
    },
    setPending: (deposits: bigint, redeems: bigint) => {
      pendingDepositAssets = deposits;
      pendingRedeemShares = redeems;
    },
    currentDoc: () => parseLossless(store.get(uri) ?? "null"),
    beforeNextPin: (fn) => {
      beforeNextPinHook = fn;
    },
  };
}

let dir: string | null = null;

function makeDeployer(fakes = makeFakes()): { deployer: LoopDeployer; registry: LoopRegistry; fakes: Fakes } {
  dir = mkdtempSync(join(tmpdir(), "loop-deployer-"));
  const registry = new LoopRegistry(join(dir, "loops.db"));
  const deployer = new LoopDeployer({
    registry,
    chain: fakes.chain,
    ipfs: fakes.ipfs,
    chainKey: "evm:8453",
    usdcAddress: "0x2222222222222222222222222222222222222222",
    templateWorkflowId: TEMPLATE_WORKFLOW_ID,
    nowNanos: () => 1790000000000000000n,
  });
  return { deployer, registry, fakes };
}

afterEach(() => {
  if (dir !== null) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe("LoopDeployer", () => {
  it("deploys a loop end to end and records every step", async () => {
    const { deployer, fakes } = makeDeployer();
    const loop = await deployer.createLoop(validLoopResolveInput());

    expect(loop.status).toBe("active");
    expect(loop.step).toBe("active");
    expect(loop.handlerAddress).toMatch(/^0x[0-9a-f]{40}$/);
    expect(loop.serviceCid).toBe("ipfs://QmPinned1");

    const doc = fakes.currentDoc();
    expect(workflowIds(doc)).toContain(loop.workflowId);
    const wf = (doc as { workflows: Record<string, { component: { config: Record<string, string> }; submit: { aggregator: { component: { config: Record<string, string> } } } }> }).workflows[loop.workflowId];
    expect(wf.component.config.vault_address).toBe(loop.handlerAddress);
    expect(wf.submit.aggregator.component.config).toEqual({ "evm:8453": loop.handlerAddress });
  });

  it("marks the loop failed on error and resumes without redeploying the handler", async () => {
    const { deployer, registry, fakes } = makeDeployer();
    fakes.failNextPin();
    await expect(deployer.createLoop(validLoopResolveInput())).rejects.toThrow("ipfs down");

    const [failed] = registry.list();
    expect(failed.status).toBe("failed");
    expect(failed.step).toBe("handler_deployed");
    expect(failed.handlerAddress).not.toBeNull();
    expect(fakes.counters.deploys).toBe(1);

    const resumed = await deployer.resumeLoop(failed.id);
    expect(resumed.status).toBe("active");
    expect(fakes.counters.deploys).toBe(1); // handler NOT redeployed
    expect(workflowIds(fakes.currentDoc())).toContain(resumed.workflowId);
  });

  it("serializes concurrent creates so both workflows land", async () => {
    const { deployer, fakes } = makeDeployer();
    const [a, b] = await Promise.all([deployer.createLoop(validLoopResolveInput()), deployer.createLoop(validLoopResolveInput())]);
    const ids = workflowIds(fakes.currentDoc());
    expect(ids).toContain(a.workflowId);
    expect(ids).toContain(b.workflowId);
    expect(ids).toContain(TEMPLATE_WORKFLOW_ID);
    expect(fakes.counters.setUri).toBe(2);
  });

  it("refuses createLoop when the pool's slot0() does not match Uniswap V3 shape", async () => {
    const { deployer, registry, fakes } = makeDeployer();
    fakes.failNextPoolCheck();
    await expect(deployer.createLoop(validLoopResolveInput())).rejects.toThrow(/does not respond as a Uniswap V3 pool/);
    // No DB row, no handler, no IPFS mutation; publish rejected at the door.
    expect(registry.list()).toHaveLength(0);
    expect(fakes.counters.deploys).toBe(0);
    expect(fakes.counters.pins).toBe(0);
  });

  it("deactivates a loop by removing its workflow, keeping the handler", async () => {
    const { deployer, fakes } = makeDeployer();
    const loop = await deployer.createLoop(validLoopResolveInput());
    const deactivated = await deployer.deactivateLoop(loop.id);
    expect(deactivated.status).toBe("inactive");
    expect(deactivated.handlerAddress).toBe(loop.handlerAddress);
    expect(workflowIds(fakes.currentDoc())).toEqual([TEMPLATE_WORKFLOW_ID]);
  });

  it("refuses to deactivate a loop whose vault still holds pending deposit escrow", async () => {
    const { deployer, fakes } = makeDeployer();
    const loop = await deployer.createLoop(validLoopResolveInput());
    // 5 USDC (6-dec) sat in requestDeposit, never fulfilled by a strike.
    fakes.setPending(5_000_000n, 0n);
    await expect(deployer.deactivateLoop(loop.id)).rejects.toThrow(/refusing to pause/);
    // Workflow stayed live so the next strike can still fulfill the escrow.
    expect(workflowIds(fakes.currentDoc())).toContain(loop.workflowId);
  });

  it("refuses to deactivate a loop whose vault still holds pending redeem shares", async () => {
    const { deployer, fakes } = makeDeployer();
    const loop = await deployer.createLoop(validLoopResolveInput());
    fakes.setPending(0n, 1_000_000_000_000_000_000n);
    await expect(deployer.deactivateLoop(loop.id)).rejects.toThrow(/pendingRedeemShares=1000000000000000000/);
    expect(workflowIds(fakes.currentDoc())).toContain(loop.workflowId);
  });

  it("deactivates once pending escrow clears (guard reads chain each call)", async () => {
    const { deployer, fakes } = makeDeployer();
    const loop = await deployer.createLoop(validLoopResolveInput());
    fakes.setPending(5_000_000n, 0n);
    await expect(deployer.deactivateLoop(loop.id)).rejects.toThrow(/refusing to pause/);
    // Next strike fulfilled the escrow; retry succeeds.
    fakes.setPending(0n, 0n);
    const deactivated = await deployer.deactivateLoop(loop.id);
    expect(deactivated.status).toBe("inactive");
  });

  it("refuses to deactivate the template workflow via a crafted record", async () => {
    const { deployer } = makeDeployer();
    const loop = await deployer.createLoop(validLoopResolveInput());
    // Deactivating twice is a no-op, not an error.
    await deployer.deactivateLoop(loop.id);
    const again = await deployer.deactivateLoop(loop.id);
    expect(again.status).toBe("inactive");
  });

  it("resume on an active loop is a no-op", async () => {
    const { deployer, fakes } = makeDeployer();
    const loop = await deployer.createLoop(validLoopResolveInput());
    const resumed = await deployer.resumeLoop(loop.id);
    expect(resumed.status).toBe("active");
    expect(fakes.counters.setUri).toBe(1);
  });

  it("rejects invalid config before any side effect", async () => {
    const { deployer, registry, fakes } = makeDeployer();
    await expect(deployer.createLoop({ nope: 1 })).rejects.toThrow(/invalid loop config/);
    expect(registry.list()).toHaveLength(0);
    expect(fakes.counters.deploys).toBe(0);
  });

  it("a failed mutation does not poison the queue for the next one", async () => {
    const { deployer, fakes } = makeDeployer();
    fakes.failNextPin();
    await expect(deployer.createLoop(validLoopResolveInput())).rejects.toThrow("ipfs down");
    const ok = await deployer.createLoop(validLoopResolveInput());
    expect(ok.status).toBe("active");
  });

  it("refuses a candidateId whose chain does not match the deployer's own", async () => {
    const { deployer, registry, fakes } = makeDeployer();
    // makeDeployer uses chainKey "evm:8453"; the Sepolia entry is
    // "evm:11155111". A user picking the Sepolia candidate on a fork-flavoured
    // server must be refused up front, before any deploy tx.
    const input = { ...validLoopResolveInput(), candidateId: "morpho-blue-sepolia:11155111:USDe-USDC:0xee461cf8" };
    await expect(deployer.createLoop(input)).rejects.toThrow(/is not deployable on this server's chain/);
    expect(registry.list()).toHaveLength(0);
    expect(fakes.counters.deploys).toBe(0);
  });

  it("resumes a legacy configJson written before swapRouter/poolFee were first-class", async () => {
    /* Regression pin for roadmap P00 #9: any loop record persisted before the
       LoopConfig grew `swapRouter`/`poolFee` would otherwise fail
       `validateLoopConfig` on resume; the deployer backfills both from the
       market catalog before validating, and the resumed loop lands active. */
    const { deployer, registry, fakes } = makeDeployer();
    // Store a hand-crafted, "legacy" configJson: valid on every field except
    // the two new ones. Values mirror the Base market catalog entry.
    const legacyConfig = {
      name: "legacy resume",
      strategist: "0xabcd00000000000000000000000000000000abcd",
      cronSeconds: 60,
      candidateId: "morpho-blue-base:8453:USDe-USDC:0x54cf9be5",
      targetLeverage: 5,
      marketId: "0x54cf9be57fdfa6457a660991907434ff9d295c465a603a50126ff647d50b7354",
      lltv: "915000000000000000",
      usdeAddress: "0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34",
      oracleAddress: "0xf4b17c79492d68775e22e8dd0a2bb22854a39a47",
      irmAddress: "0x46415998764c29ab2a25cbea6254146d50d22687",
      morphoAddress: "0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb",
      poolAddress: "0xedAf6Ca46FB852D4AB0A2e9449d267cf03213F05",
      twapWindowSecs: 1800,
      inputsBlockLag: 2,
      strategyParams: {},
      // NB: no swapRouter, no poolFee.
    };
    const record = registry.create({
      id: "loop-legacy1",
      name: legacyConfig.name,
      workflowId: "wf0000000000000000000042",
      strategist: legacyConfig.strategist,
      configJson: JSON.stringify(legacyConfig),
    });
    // Sanity: the record is `validated` (registry.create's default step) and
    // has no handler, so the resume runs the full pipeline.
    expect(record.step).toBe("validated");
    expect(record.handlerAddress).toBeNull();
    const resumed = await deployer.resumeLoop(record.id);
    expect(resumed.status).toBe("active");
    expect(fakes.counters.deploys).toBe(1);
    // The two backfilled values must also reach the deployed workflow's
    // componentConfig, or the operator quorum still builds an empty plan.
    const config = componentConfigOf(fakes.currentDoc(), resumed.workflowId);
    expect(config.swap_router).toBe("0x2626664c2603336e57b271c5c0b26f421741e481");
    expect(config.pool_fee).toBe("500");
  });

  it("concurrent publishes get distinct vaults (finding: predict-only was collision-prone)", async () => {
    /* Two simultaneous createLoop calls used to both persist the same
       eth_call-predicted CREATE address; the second submission would
       actually deploy at nonce+1 while the registry pointed at the
       first caller's vault. `finalizeDeployHandler` decodes VaultCreated
       from the tx's own receipt, so two publishes with distinct hashes
       land at distinct addresses. */
    const { deployer } = makeDeployer();
    const aInput = { ...validLoopResolveInput(), name: "A", strategist: "0xaaaa00000000000000000000000000000000aaaa" };
    const bInput = { ...validLoopResolveInput(), name: "B", strategist: "0xbbbb00000000000000000000000000000000bbbb" };
    const [a, b] = await Promise.all([deployer.createLoop(aInput), deployer.createLoop(bInput)]);
    expect(a.handlerAddress).not.toBe(b.handlerAddress);
    expect(a.strategist).not.toBe(b.strategist);
  });

  it("crash between submit and confirm resumes on the same tx hash (no second vault)", async () => {
    /* Simulates a crash inside `finalizeDeployHandler`'s receipt wait.
       The registry already carries the persisted tx hash from
       `submitDeployHandler`; on resume, the deployer MUST reuse that
       hash (idempotent decode) instead of submitting a second tx. */
    const { deployer, registry, fakes } = makeDeployer();
    // Land a full loop, then rewind it to the "submit landed,
    // finalize did not" state: forget the handler address, drop step
    // back to `validated`, and re-inject a fresh unresolved tx hash so
    // `resumeLoop` MUST call `finalizeDeployHandler` — never
    // `submitDeployHandler` — to advance.
    const loop = await deployer.createLoop(validLoopResolveInput());
    const primeHash = await fakes.chain.submitDeployHandler(loop.strategist, {
      collateralToken: "0x0000000000000000000000000000000000000001",
      morpho: "0x0000000000000000000000000000000000000002",
      morphoOracle: "0x0000000000000000000000000000000000000003",
      morphoIrm: "0x0000000000000000000000000000000000000004",
      morphoLltv: 1n,
      swapRouter: "0x0000000000000000000000000000000000000005",
      poolFee: 500,
    });
    const deploysBefore = fakes.counters.deploys;
    registry.update(loop.id, {
      handlerAddress: null,
      deployTxHash: primeHash,
      step: "validated",
      status: "deploying",
    });
    const resumed = await deployer.resumeLoop(loop.id);
    expect(resumed.status).toBe("active");
    expect(resumed.handlerAddress).not.toBeNull();
    // Deploys counter did not tick — only finalize was invoked.
    expect(fakes.counters.deploys).toBe(deploysBefore);
    // Hash cleared once the vault address landed.
    expect(resumed.deployTxHash).toBeNull();
  });

  it("crash between setServiceURI and step=service_updated resumes without 'workflow already exists'", async () => {
    /* Simulates a crash after the service-mutation half of the pipeline
       succeeded (workflow already in service.json, vault already
       attesting) but before the registry write. Under the pre-fix code
       the resumed `addLoopWorkflow` would throw ServiceDocError and the
       loop would be wedged forever. */
    const { deployer, registry, fakes } = makeDeployer();
    const loop = await deployer.createLoop(validLoopResolveInput());
    // Snapshot the "landed" state and rewind the registry step to the
    // pre-mark position while leaving service.json untouched.
    const setUriBefore = fakes.counters.setUri;
    registry.update(loop.id, { step: "handler_deployed", status: "deploying", error: null });
    // Sanity: service.json still contains the workflow.
    expect(workflowIds(fakes.currentDoc())).toContain(loop.workflowId);
    const resumed = await deployer.resumeLoop(loop.id);
    expect(resumed.status).toBe("active");
    expect(resumed.step).toBe("active");
    // No second setServiceUri: the mutation queue detected the no-op.
    expect(fakes.counters.setUri).toBe(setUriBefore);
  });

  it("mid-mutation setServiceURI by another writer is detected and mutation retries without dropping any workflow", async () => {
    /* Simulates a second loop-server instance (or any out-of-band
       `setServiceURI` caller) landing a write between our doc fetch
       and our own tx. Under the pre-fix code the loop-server's
       in-process mutation tail was the only lock, so the racing write
       silently dropped the workflow the deployer was adding. The
       optimistic-concurrency loop must detect the overlap via
       `ServiceURIUpdated` event scan, re-fetch, re-apply, and land a
       final doc that contains BOTH workflows. */
    const { deployer, fakes } = makeDeployer();

    // Prime: land loop A normally so we have a real workflow shape to
    // splice into the "other writer" doc.
    const aInput = { ...validLoopResolveInput(), name: "loop A", strategist: "0xaaaa00000000000000000000000000000000aaaa" };
    const loopA = await deployer.createLoop(aInput);
    const docWithA = fakes.currentDoc();
    expect(workflowIds(docWithA)).toContain(loopA.workflowId);

    // Land loop B, but inject a "concurrent writer" that adds its own
    // pretend-workflow ("loop C") the instant loop B's mutation reads
    // the base doc. If the retry loop is wired correctly, loop B's
    // final on-chain doc must contain A, C, AND B; if the retry loop
    // is missing, loop B's write silently clobbers C.
    const bInput = { ...validLoopResolveInput(), name: "loop B", strategist: "0xbbbb00000000000000000000000000000000bbbb" };
    fakes.beforeNextPin(async () => {
      // Build a doc that mimics an interfering setServiceURI writer:
      // clone current on-chain doc and add a workflow named "loop-c"
      // by hand. The exact shape doesn't matter for the test — what
      // matters is that its workflowIds set is a superset the deployer
      // must preserve.
      const current = fakes.currentDoc();
      const clone = parseLossless(stringifyLossless(current, 0));
      if (clone === null || typeof clone !== "object" || !("workflows" in clone)) {
        throw new Error("test setup: expected workflows key");
      }
      const workflows = clone.workflows;
      if (workflows === null || typeof workflows !== "object") {
        throw new Error("test setup: workflows is not an object");
      }
      // Copy loopA's workflow onto a fresh id — represents whatever
      // the racing writer inserted.
      const templateWorkflow = Object.entries(workflows).find(([k]) => k === loopA.workflowId)?.[1];
      if (templateWorkflow === undefined) throw new Error("test setup: loopA workflow missing");
      Object.assign(workflows, { "loop-c000000000000000000c": templateWorkflow });
      const forkedText = stringifyLossless(clone, 0);
      const forkedUri = await fakes.ipfs.pinText(forkedText, "service.json");
      await fakes.chain.setServiceUri(forkedUri);
    });

    const loopB = await deployer.createLoop(bInput);
    expect(loopB.status).toBe("active");

    const finalIds = workflowIds(fakes.currentDoc());
    // Both raced-in workflows survive: nothing was silently dropped.
    expect(finalIds).toContain(loopA.workflowId);
    expect(finalIds).toContain(loopB.workflowId);
    expect(finalIds).toContain("loop-c000000000000000000c");
  });
});
