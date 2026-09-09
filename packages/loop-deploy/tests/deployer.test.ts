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
    chainKey: "evm:31337",
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
    expect(wf.submit.aggregator.component.config).toEqual({ "evm:31337": loop.handlerAddress });
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
    // makeDeployer uses chainKey "evm:31337"; the Sepolia entry is
    // "evm:11155111". A user picking the Sepolia candidate on a fork-flavoured
    // server must be refused up front, before any deploy tx.
    const input = { ...validLoopResolveInput(), candidateId: "morpho-blue-sepolia:11155111:USDe-USDC:0xee461cf8" };
    await expect(deployer.createLoop(input)).rejects.toThrow(/is not deployable on this server's chain/);
    expect(registry.list()).toHaveLength(0);
    expect(fakes.counters.deploys).toBe(0);
  });
});
