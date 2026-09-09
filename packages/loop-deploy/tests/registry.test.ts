import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LoopRegistry } from "../src/registry.ts";

let dir: string | null = null;

function freshRegistry(): { registry: LoopRegistry; path: string } {
  dir = mkdtempSync(join(tmpdir(), "loop-registry-"));
  const path = join(dir, "loops.db");
  return { registry: new LoopRegistry(path), path };
}

afterEach(() => {
  if (dir !== null) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

const INPUT = {
  id: "loop-11111111",
  name: "test loop",
  workflowId: "loop-aaaaaaaaaaaa",
  strategist: "0xabcd00000000000000000000000000000000abcd",
  configJson: "{}",
};

describe("LoopRegistry", () => {
  it("creates records in the deploying/validated state", () => {
    const { registry } = freshRegistry();
    const rec = registry.create(INPUT);
    expect(rec.status).toBe("deploying");
    expect(rec.step).toBe("validated");
    expect(rec.handlerAddress).toBeNull();
    expect(rec.serviceCid).toBeNull();
    registry.close();
  });

  it("advances steps and clears errors via update", () => {
    const { registry } = freshRegistry();
    registry.create(INPUT);
    registry.update(INPUT.id, { status: "failed", error: "boom" });
    const failed = registry.get(INPUT.id);
    expect(failed?.status).toBe("failed");
    expect(failed?.error).toBe("boom");

    const resumed = registry.update(INPUT.id, { handlerAddress: "0xdead", step: "handler_deployed", status: "deploying", error: null });
    expect(resumed.handlerAddress).toBe("0xdead");
    expect(resumed.step).toBe("handler_deployed");
    expect(resumed.error).toBeNull();
    registry.close();
  });

  it("persists across reopen", () => {
    const { registry, path } = freshRegistry();
    registry.create(INPUT);
    registry.update(INPUT.id, { step: "service_updated", serviceCid: "ipfs://QmX" });
    registry.close();

    const reopened = new LoopRegistry(path);
    const rec = reopened.get(INPUT.id);
    expect(rec?.step).toBe("service_updated");
    expect(rec?.serviceCid).toBe("ipfs://QmX");
    reopened.close();
  });

  it("rejects duplicate ids and duplicate workflow ids", () => {
    const { registry } = freshRegistry();
    registry.create(INPUT);
    expect(() => registry.create(INPUT)).toThrow();
    expect(() => registry.create({ ...INPUT, id: "loop-22222222" })).toThrow(); // same workflowId
    registry.close();
  });

  it("update throws on unknown loop", () => {
    const { registry } = freshRegistry();
    expect(() => registry.update("loop-missing", { status: "active" })).toThrow(/not found/);
    registry.close();
  });

  it("lists in creation order", () => {
    const { registry } = freshRegistry();
    registry.create(INPUT);
    registry.create({ ...INPUT, id: "loop-22222222", workflowId: "loop-bbbbbbbbbbbb" });
    expect(registry.list().map((r) => r.id)).toEqual(["loop-11111111", "loop-22222222"]);
    registry.close();
  });

  it("filters list() by strategist, checksum-insensitive", () => {
    const { registry } = freshRegistry();
    const alice = "0xaaaa000000000000000000000000000000000001";
    const bob   = "0xbbbb000000000000000000000000000000000002";
    registry.create({ ...INPUT, id: "loop-11111111", workflowId: "loop-aaaaaaaaaaa1", strategist: alice });
    registry.create({ ...INPUT, id: "loop-22222222", workflowId: "loop-aaaaaaaaaaa2", strategist: bob });
    registry.create({ ...INPUT, id: "loop-33333333", workflowId: "loop-aaaaaaaaaaa3", strategist: alice });

    // Two loops for Alice; passing her address checksummed still matches.
    const aliceLoops = registry.list({ strategist: "0xAAAA000000000000000000000000000000000001" });
    expect(aliceLoops.map((r) => r.id)).toEqual(["loop-11111111", "loop-33333333"]);

    // Nobody matches an unknown address.
    expect(registry.list({ strategist: "0x0000000000000000000000000000000000000000" })).toHaveLength(0);

    // No filter still returns everything, in creation order.
    expect(registry.list().map((r) => r.id)).toEqual(["loop-11111111", "loop-22222222", "loop-33333333"]);

    registry.close();
  });
});
