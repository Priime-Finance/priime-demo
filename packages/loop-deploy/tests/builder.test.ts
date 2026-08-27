import { describe, expect, it } from "vitest";

import { addLoopWorkflow, newWorkflowId, removeLoopWorkflow, ServiceDocError, workflowIds, type WorkflowSpec } from "../src/builder.ts";
import { parseLossless, stringifyLossless } from "../src/json.ts";
import { fixtureServiceDoc, fixtureServiceText, TEMPLATE_WORKFLOW_ID } from "./fixtures.ts";

function spec(overrides?: Partial<WorkflowSpec>): WorkflowSpec {
  return {
    workflowId: "loop-abc123def456",
    componentConfig: {
      vault_address: "0xdddddddddddddddddddddddddddddddddddddddd",
      market_id: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      twap_window_secs: "900",
    },
    aggregatorTarget: { chainKey: "evm:31337", handler: "0xdddddddddddddddddddddddddddddddddddddddd" },
    cron: { schedule: "*/30 * * * * *", startTimeNanos: 1790000000000000007n, endTimeNanos: 1800000000000000009n },
    ...overrides,
  };
}

interface WorkflowShape {
  trigger: { cron: { schedule: string; start_time: unknown; end_time: unknown } };
  component: { config: Record<string, string>; x_future_field: unknown; source: unknown };
  submit: { aggregator: { component: { config: Record<string, string> } } };
  x_future_field: unknown;
}

function workflowFrom(doc: unknown, id: string): WorkflowShape {
  const record = doc as { workflows: Record<string, WorkflowShape> };
  return record.workflows[id];
}

describe("addLoopWorkflow", () => {
  it("clones the template and swaps cron, config, and submit target", () => {
    const next = addLoopWorkflow(fixtureServiceDoc(), spec());
    expect(workflowIds(next).sort()).toEqual(["loop-abc123def456", TEMPLATE_WORKFLOW_ID].sort());

    const wf = workflowFrom(next, "loop-abc123def456");
    expect(wf.trigger.cron.schedule).toBe("*/30 * * * * *");
    expect(wf.trigger.cron.start_time).toBe(1790000000000000007n);
    expect(wf.trigger.cron.end_time).toBe(1800000000000000009n);
    // Overridden keys win; untouched template keys survive.
    expect(wf.component.config.vault_address).toBe("0xdddddddddddddddddddddddddddddddddddddddd");
    expect(wf.component.config.twap_window_secs).toBe("900");
    expect(wf.component.config.usdc_address).toBe("0x2222222222222222222222222222222222222222");
    // Submit target is replaced wholesale.
    expect(wf.submit.aggregator.component.config).toEqual({ "evm:31337": "0xdddddddddddddddddddddddddddddddddddddddd" });
    // Unknown fields pass through.
    expect(wf.x_future_field).toBe(7);
    expect(wf.component.x_future_field).toEqual({ keep: "me" });
    // Component sources are untouched (same digest as template).
    expect(wf.component.source).toEqual(workflowFrom(next, TEMPLATE_WORKFLOW_ID).component.source);
  });

  it("does not modify the input document or the template workflow", () => {
    const doc = fixtureServiceDoc();
    const before = stringifyLossless(doc);
    addLoopWorkflow(doc, spec());
    expect(stringifyLossless(doc)).toBe(before);
  });

  it("preserves the template's unsafe-integer timestamps through a full text round trip", () => {
    const next = addLoopWorkflow(parseLossless(fixtureServiceText()), spec());
    const text = stringifyLossless(next);
    expect(text).toContain("1786611911000000001");
    expect(text).toContain("1786615511000000003");
    expect(text).toContain("1790000000000000007");
  });

  it("rejects a duplicate workflow id", () => {
    const doc = addLoopWorkflow(fixtureServiceDoc(), spec());
    expect(() => addLoopWorkflow(doc, spec(), TEMPLATE_WORKFLOW_ID)).toThrow(/already exists/);
  });

  it("rejects an invalid workflow id", () => {
    expect(() => addLoopWorkflow(fixtureServiceDoc(), spec({ workflowId: "Loop!" }))).toThrow(ServiceDocError);
    expect(() => addLoopWorkflow(fixtureServiceDoc(), spec({ workflowId: "ab" }))).toThrow(ServiceDocError);
  });

  it("requires an explicit template when several workflows exist", () => {
    const doc = addLoopWorkflow(fixtureServiceDoc(), spec());
    expect(() => addLoopWorkflow(doc, spec({ workflowId: "loop-second00000" }))).toThrow(/template workflow id required/);
    const next = addLoopWorkflow(doc, spec({ workflowId: "loop-second00000" }), TEMPLATE_WORKFLOW_ID);
    expect(workflowIds(next)).toHaveLength(3);
  });

  it("rejects documents without a workflows map and templates without cron", () => {
    expect(() => addLoopWorkflow({ nope: true }, spec())).toThrow(ServiceDocError);
    const doc = fixtureServiceDoc() as { workflows: Record<string, { trigger: unknown }> };
    doc.workflows[TEMPLATE_WORKFLOW_ID].trigger = { manual: {} };
    expect(() => addLoopWorkflow(doc, spec())).toThrow(/no cron trigger/);
  });
});

describe("removeLoopWorkflow", () => {
  it("removes a loop workflow", () => {
    const doc = addLoopWorkflow(fixtureServiceDoc(), spec());
    const next = removeLoopWorkflow(doc, "loop-abc123def456");
    expect(workflowIds(next)).toEqual([TEMPLATE_WORKFLOW_ID]);
  });

  it("refuses to remove a protected workflow", () => {
    const doc = fixtureServiceDoc();
    expect(() => removeLoopWorkflow(doc, TEMPLATE_WORKFLOW_ID, [TEMPLATE_WORKFLOW_ID])).toThrow(/protected/);
  });

  it("errors on a missing workflow", () => {
    expect(() => removeLoopWorkflow(fixtureServiceDoc(), "loop-nonexistent0")).toThrow(/does not exist/);
  });
});

describe("newWorkflowId", () => {
  it("generates valid, unique ids", () => {
    const ids = new Set(Array.from({ length: 100 }, () => newWorkflowId()));
    expect(ids.size).toBe(100);
    for (const id of ids) expect(id).toMatch(/^loop-[0-9a-f]{12}$/);
  });
});
