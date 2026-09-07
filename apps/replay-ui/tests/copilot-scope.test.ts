/**
 * The scoped copilot's three owners (docs/plans/LATEST_UI_PORT_SPEC.md D.1,
 * D.2, D.3): the prompt bytes, the narrowed tool list, the rejection register.
 *
 * The prompt is FINAL COPY and the prompt-cache key, so its bytes are pinned
 * here by a digest and every fact it quotes is asserted against ITS OWNER
 * (the fee rows, the caption, the live chip) rather than a re-typed literal.
 */
import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { liveVenues } from "@/lib/canvas/catalog-server";
import { liveRowsFrom } from "@/lib/canvas/copilot/context";
import { modeledRows } from "@/lib/canvas/unified-list";
import { COPILOT_TOOLS, validateExplain, validateProposal } from "@/lib/canvas/copilot/tools";
import { apyCaption, feeRows, WITHDRAWAL_ATTESTED_LINE } from "@/lib/canvas/fees";
import { NO_BORROW_BANDS_VALUE } from "@/lib/canvas/labels";
import { COMING_SOON, COPILOT_REJECT_COMING_SOON, HERO_MARKET_ID } from "@/lib/demo-scope";
import { VAULT_STAGE_LABEL } from "@/lib/vaults/store";

import {
  DEMO_COPILOT_SYSTEM_PROMPT as P,
  mapRejectReason,
  scopedLiveRows,
  scopedTools,
} from "@/lib/canvas/copilot/scope";

const EM_DASH = "—";

/** The D.1 bytes as ratified. A change here is a deliberate prompt edit. */
const PROMPT_SHA256 = "316e62eb4a3ae0415ceb9397e753f1949b773b500fd1ec73514da809a36d7ad6";

describe("D.1 the system prompt", () => {
  it("is the ratified bytes", () => {
    expect(createHash("sha256").update(P, "utf8").digest("hex")).toBe(PROMPT_SHA256);
  });

  it("is byte-stable across two imports (no interpolation, no clock, no hash)", async () => {
    vi.resetModules();
    const again = await import("@/lib/canvas/copilot/scope");
    expect(again.DEMO_COPILOT_SYSTEM_PROMPT).toBe(P);
    expect(P).not.toMatch(/\d{13}/); // no Date.now()
  });

  it("carries no em dash", () => {
    expect(P.includes(EM_DASH)).toBe(false);
  });

  it("spells the brand Priime, and names the misspelling only inside the rule that bans it", () => {
    const outsideTheRule = P.replace('never "Prime"', "");
    expect(outsideTheRule).not.toMatch(/\bPrime\b/);
    expect(P).toContain("Priime Build");
  });

  it("names the one live workflow and the register for everything else", () => {
    expect(P).toContain("One workflow is live today: the USDe/USDC recursive loop on Morpho Blue, Base.");
    expect(P).toContain(`Everything else is ${COMING_SOON.prose}`);
    expect(P).toContain("say in one sentence that it is coming soon, then offer the live loop");
    const toolSection = P.slice(P.indexOf("When to use tools:"));
    expect(toolSection).not.toContain("compare");
    expect(P).not.toContain("compare candidates");
    expect(P).not.toContain("Incubating");
    expect(P).not.toContain("backtest");
  });

  it("quotes the product's own copy from its owners", () => {
    for (const row of feeRows({ stage: "attested" })) expect(P, row.label).toContain(row.value);
    expect(P).toContain(WITHDRAWAL_ATTESTED_LINE);
    expect(P).toContain(apyCaption());
    expect(P).toContain(VAULT_STAGE_LABEL.attested);
    expect(P).toContain(NO_BORROW_BANDS_VALUE);
    expect(P).toContain("modeled net APY");
  });
});

describe("D.2 scopedTools", () => {
  const tools = scopedTools();
  const propose = tools[0]!;
  const explain = tools[1]!;
  const loops = propose.input_schema.properties.loops as {
    minItems?: number;
    maxItems?: number;
    description?: string;
    items: { properties: Record<string, Record<string, unknown>>; required: string[] };
  };

  it("keeps propose_portfolio and explain_market in the live order and drops compare", () => {
    expect(tools.map((t) => t.name)).toEqual(["propose_portfolio", "explain_market"]);
    expect(COPILOT_TOOLS.map((t) => t.name)).toEqual(["propose_portfolio", "explain_market", "compare"]);
  });

  it("seats one lane on the one market with the one strategy and no hedge", () => {
    /* D.2 asks for `maxItems: 1`; the API refuses array constraints on a
       strict schema, so the bound is a description and the validator's own
       duplicate refusal (next test). */
    expect(loops.maxItems).toBeUndefined();
    expect(loops.description).toBe("Exactly one lane, on the live market.");
    expect(loops.minItems).toBe((COPILOT_TOOLS[0].input_schema.properties.loops as { minItems?: number }).minItems);
    expect(loops.items.properties.candidateId).toEqual({ type: "string", enum: [HERO_MARKET_ID] });
    expect(loops.items.properties.strategy.enum).toEqual(["loop"]);
    expect(loops.items.properties.strategy.type).toBe("string");
    expect(loops.items.properties.hedge).toEqual({
      type: "boolean",
      description: "Must be false: this loop has no price leg.",
    });
    expect(loops.items.required).toEqual(COPILOT_TOOLS[0].input_schema.properties.loops.items.required);
  });

  it("a second lane is refused by the unchanged validator, so one lane is a fact", () => {
    const rows = scopedLiveRows(liveVenues(1_800_000_000_000).venues);
    expect(rows.size).toBe(1);
    expect(rows.has(HERO_MARKET_ID)).toBe(true);
    const lane = { candidateId: HERO_MARKET_ID, strategy: "loop", leverage: null, hedge: false, compound: true };
    const two = validateProposal({ title: "t", rationale: "r", loops: [lane, lane], allocationsBps: [5000, 5000] }, rows);
    expect(two.ok).toBe(false);
    if (!two.ok) expect(two.reason).toBe("two lanes on the same market");
    const one = validateProposal({ title: "t", rationale: "r", loops: [lane], allocationsBps: null }, rows);
    expect(one.ok).toBe(true);
  });

  it("appends the scope sentence to the live propose description", () => {
    expect(propose.description).toBe(
      `${COPILOT_TOOLS[0].description} candidateId is the live market id. hedge must be false. allocationsBps is null for a single loop.`,
    );
  });

  it("explain_market takes only the live id", () => {
    expect(explain.input_schema.properties.candidateId).toEqual({ type: "string", enum: [HERO_MARKET_ID] });
  });

  it("keeps strict where the live schema sets it", () => {
    expect(propose.strict).toBe(COPILOT_TOOLS[0].strict);
    expect(explain.strict).toBe(COPILOT_TOOLS[1].strict);
  });

  it("never mutates the live list, and each call is a fresh copy", () => {
    expect(COPILOT_TOOLS).toHaveLength(3);
    expect((COPILOT_TOOLS[0].input_schema.properties.loops as { maxItems?: number }).maxItems).toBeUndefined();
    expect(COPILOT_TOOLS[0].input_schema.properties.loops.items.properties.candidateId).not.toHaveProperty("enum");
    const b = scopedTools();
    expect(b).toEqual(tools);
    expect(b[0]).not.toBe(tools[0]);
  });
});

describe("D.3 scopedLiveRows", () => {
  it("drops the kit's modeled template rows the live map appends, so a collar or a dn-LP cannot validate", () => {
    const venues = liveVenues(1_800_000_000_000).venues;
    const unscoped = liveRowsFrom(venues);
    const scoped = scopedLiveRows(venues);
    expect(modeledRows().length).toBeGreaterThan(0);
    expect(unscoped.size).toBe(1 + modeledRows().length);
    expect([...scoped.keys()]).toEqual([HERO_MARKET_ID]);
    for (const r of modeledRows()) {
      const v = validateExplain({ candidateId: r.id }, scoped);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(mapRejectReason(v.reason)).toBe(COPILOT_REJECT_COMING_SOON);
    }
  });
});

describe("D.3 mapRejectReason", () => {
  it("turns the validators' unknown-id refusals into the coming-soon sentence", () => {
    expect(mapRejectReason("unknown market id(s); the scan may have moved")).toBe(COPILOT_REJECT_COMING_SOON);
    expect(mapRejectReason("unknown market id")).toBe(COPILOT_REJECT_COMING_SOON);
  });

  it("passes every other reason through unchanged", () => {
    for (const r of ["malformed proposal", "two lanes on the same market", "allocations must sum to 10000 bps", ""]) {
      expect(mapRejectReason(r)).toBe(r);
    }
  });
});
