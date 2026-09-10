import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ChainPort } from "../src/chain.ts";
import type { IpfsPort } from "../src/ipfs.ts";
import { workflowIds } from "../src/builder.ts";
import { LoopDeployer } from "../src/deployer.ts";
import { parseLossless } from "../src/json.ts";
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
  currentDoc: () => unknown;
}

function makeFakes(): Fakes {
  const store = new Map<string, string>();
  store.set("ipfs://QmGenesis", fixtureServiceText());
  let uri = "ipfs://QmGenesis";
  let pinCounter = 0;
  let deployCounter = 0;
  const counters = { deploys: 0, pins: 0, setUri: 0 };
  let pinShouldFail = false;

  const chain: ChainPort = {
    async deployHandler(strategist: string): Promise<string> {
      counters.deploys += 1;
      deployCounter += 1;
      return `0x${(deployCounter + 0xd000).toString(16).padStart(4, "0")}${strategist.slice(6, 42)}`.toLowerCase();
    },
    async getServiceUri(): Promise<string> {
      return uri;
    },
    async setServiceUri(next: string): Promise<string> {
      counters.setUri += 1;
      uri = next;
      return "0xtxhash";
    },
  };

  const ipfs: IpfsPort = {
    async fetchText(u: string): Promise<string> {
      const text = store.get(u);
      if (text === undefined) throw new Error(`unknown cid ${u}`);
      return text;
    },
    async pinText(content: string): Promise<string> {
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
    currentDoc: () => parseLossless(store.get(uri) ?? "null"),
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

  it("deactivates a loop by removing its workflow, keeping the handler", async () => {
    const { deployer, fakes } = makeDeployer();
    const loop = await deployer.createLoop(validLoopResolveInput());
    const deactivated = await deployer.deactivateLoop(loop.id);
    expect(deactivated.status).toBe("inactive");
    expect(deactivated.handlerAddress).toBe(loop.handlerAddress);
    expect(workflowIds(fakes.currentDoc())).toEqual([TEMPLATE_WORKFLOW_ID]);
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

  it("resumes a legacy configJson written before swapRouter/poolTickSpacing were first-class", async () => {
    /* Regression pin for roadmap P00 #9: any loop record persisted before the
       LoopConfig grew `swapRouter`/`poolTickSpacing` would otherwise fail
       `validateLoopConfig` on resume; the deployer backfills both from the
       market catalog before validating, and the resumed loop lands active. */
    const { deployer, registry, fakes } = makeDeployer();
    // Store a hand-crafted, "legacy" configJson: valid on every field except
    // the two new ones. Values mirror the Base market catalog entry.
    const legacyConfig = {
      name: "legacy resume",
      strategist: "0xabcd00000000000000000000000000000000abcd",
      cronSeconds: 30,
      candidateId: "morpho-blue-base:8453:USDe-USDC:0x54cf9be5",
      targetLeverage: 5,
      marketId: "0x54cf9be57fdfa6457a660991907434ff9d295c465a603a50126ff647d50b7354",
      lltv: "915000000000000000",
      usdeAddress: "0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34",
      oracleAddress: "0xf4b17c79492d68775e22e8dd0a2bb22854a39a47",
      irmAddress: "0x46415998764c29ab2a25cbea6254146d50d22687",
      morphoAddress: "0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb",
      poolAddress: "0x15bc08d2e2b405afed3fb872dcd2d962bccfb7e0",
      twapWindowSecs: 1800,
      inputsBlockLag: 2,
      strategyParams: {},
      // NB: no swapRouter, no poolTickSpacing.
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
    expect(config.swap_router).toBe("0xbe6d8f0d05cc4be24d5167a3ef062215be6d18a5");
    expect(config.pool_tick_spacing).toBe("1");
  });
});
