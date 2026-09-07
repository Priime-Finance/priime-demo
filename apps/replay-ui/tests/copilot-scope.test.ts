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
import { ORCH_HONESTY_LINE } from "@/lib/canvas/orchestrator/rule-schema";
import { ROUTER_FLOOR_CANDIDATE_ID } from "@/lib/canvas/router-history";
import { COMING_SOON, COPILOT_REJECT_COMING_SOON, HERO_MARKET_ID } from "@/lib/demo-scope";
import { VAULT_STAGE_LABEL } from "@/lib/vaults/store";

import {
  DEMO_COPILOT_SYSTEM_PROMPT as P,
  mapRejectReason,
  scopedLiveRows,
  scopedTools,
} from "@/lib/canvas/copilot/scope";

const EM_DASH = "—";

/** The D.1 bytes as ratified. A change here is a deliberate prompt edit.
 *  Moved 2026-09-07 by WP-4: the register went from one live workflow to two. */
const PROMPT_SHA256 = "540b6383d1d5a307cc5e2cb28d47f5fc9b00675b8018cfbcdda765424cf3de31";

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

  it("names the two live workflows and the register for everything else", () => {
    expect(P).toContain("Two workflows are live today. The first is the USDe/USDC recursive loop on Morpho Blue, Base.");
    expect(P).toContain(
      "The second is the USDC lending floor on Aave v3 Base and the capital router that pairs it with the loop.",
    );
    expect(P).toContain(`Everything else is ${COMING_SOON.prose}`);
    expect(P).toContain("say in one sentence that it is coming soon, then offer the live loop");
    const toolSection = P.slice(P.indexOf("When to use tools:"));
    expect(toolSection).not.toContain("compare");
    expect(P).not.toContain("compare candidates");
    expect(P).not.toContain("Incubating");
    expect(P).not.toContain("backtest");
  });

  /* WP-4, R4(c) + the design director's item 12. Only the half of each rule
     that stopped being true was retired: the router is live in the builder and
     is still not executable, so the no-execution clause survives the edit. */
  it("retires the router's coming-soon half and keeps the no-execution half", () => {
    expect(P).toContain("2. The capital router is live in the builder and modeled only.");
    expect(P).toContain(
      "Never claim automated rebalancing, automated reallocation, or any execution capability the context does not mark as real",
    );
    expect(P).toContain(
      "it moves the whole book to the better lane once that lane has led by the published bar for the published window, every move modeled and none executed",
    );
    expect(P).toContain("3. One loop market and one lending reserve are live.");
    /* The quant's honest register, quoted from its owner so the model
       reproduces the line rather than a second version of it. */
    expect(P).toContain(ORCH_HONESTY_LINE);
  });

  it("drops exactly three entries from the coming-soon list and keeps the rest", () => {
    const list = P.slice(P.indexOf("Everything else is "), P.indexOf("When a user asks for any market"));
    for (const gone of ["redemption route", "treasury floor", "capital router that allocates"]) {
      expect(list, gone).not.toContain(gone);
    }
    for (const stays of [
      "dynamic hedge",
      "auto center",
      "covered call",
      "protective put",
      "exogenous risk",
      "funding carry",
      "delta-neutral LP",
      "treasury collar",
    ]) {
      expect(list, stays).toContain(stays);
    }
  });

  /* SEAM 4: no surface retypes the quant's figures, and the prompt is a
     surface. The bar, the re-arm, the window and both published rates reach
     the model through the context block, never through these bytes. */
  it("types no router figure into the prompt: the numbers travel in the context", () => {
    const para = P.slice(P.indexOf("The second is the USDC lending floor"), P.indexOf("Everything else is "));
    expect(para).toContain("paid more for a sustained window, by at least a fixed margin");
    expect(para).toContain("are all in your context. Read them from there and never name one of them from memory");
    /* The mechanism sentence names no quantity and points at no field. The
       first draft of it said "the window your context names", and the model
       copied that phrase verbatim into a blueprint rationale a user reads,
       which is rule 9's leak entered through the copy rather than through a
       field name. The pointer is now a separate sentence. */
    expect(para).toContain("write the window and the margin as quantities rather than as a reference to where you read them");
    /* `Aave v3` is a venue's name, not a figure; nothing else in the paragraph
       carries a digit at all. */
    expect(para.replace("Aave v3", "Aave")).not.toMatch(/\d/);
    for (const typed of ["48 hour", "48-hour", "3.00pp", "3.0pp", "0.10pp"]) {
      expect(P, typed).not.toContain(typed);
    }
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

  it("seats at most two lanes on the two live markets with their two strategies and no hedge", () => {
    /* D.2 asks for `maxItems`; the API refuses array constraints on a strict
       schema, so the bound is a description and the validator's own duplicate
       refusal (next test). */
    expect(loops.maxItems).toBeUndefined();
    expect(loops.description).toBe(
      "At most two lanes: the live loop market, the live lending reserve, or both, each once.",
    );
    expect(loops.minItems).toBe((COPILOT_TOOLS[0].input_schema.properties.loops as { minItems?: number }).minItems);
    expect(loops.items.properties.candidateId).toEqual({
      type: "string",
      enum: [HERO_MARKET_ID, ROUTER_FLOOR_CANDIDATE_ID],
    });
    expect(loops.items.properties.strategy.enum).toEqual(["loop", "treasury"]);
    expect(loops.items.properties.strategy.type).toBe("string");
    expect(loops.items.properties.hedge).toEqual({
      type: "boolean",
      description: "Must be false: neither live lane has a price leg.",
    });
    expect(loops.items.required).toEqual(COPILOT_TOOLS[0].input_schema.properties.loops.items.required);
  });

  /* R4(c): the copilot may PROPOSE ADDING the floor lane, and this is the
     assertion that it can. No new tool was needed: APPLY replaces the canvas,
     so "add the lending lane and the router" is the two-lane composition
     through the existing `propose_portfolio`. */
  it("validates the two-lane proposal R4(c) asks for, and still refuses a repeated market", () => {
    const rows = scopedLiveRows(liveVenues(1_800_000_000_000).venues);
    expect([...rows.keys()]).toEqual([HERO_MARKET_ID, ROUTER_FLOOR_CANDIDATE_ID]);
    const loop = { candidateId: HERO_MARKET_ID, strategy: "loop", leverage: null, hedge: false, compound: true };
    const floor = {
      candidateId: ROUTER_FLOOR_CANDIDATE_ID,
      strategy: "treasury",
      leverage: null,
      hedge: false,
      compound: false,
    };
    const pair = validateProposal(
      { title: "t", rationale: "r", loops: [loop, floor], allocationsBps: [5000, 5000] },
      rows,
    );
    expect(pair.ok).toBe(true);
    if (pair.ok) {
      expect(pair.payload.loops.map((l) => l.candidateId)).toEqual([HERO_MARKET_ID, ROUTER_FLOOR_CANDIDATE_ID]);
      /* The floor borrows nothing: the validator's own leverage narrowing
         seats it at the product floor with no note, because a strategy with
         no dial is not a correction to anything. */
      expect(pair.payload.loops[1]!.strategy).toBe("treasury");
      expect(pair.payload.loops[1]!.leverageModule).toBe(false);
      expect(pair.payload.loops[1]!.hedge).toBe(false);
    }
    const twice = validateProposal(
      { title: "t", rationale: "r", loops: [loop, loop], allocationsBps: [5000, 5000] },
      rows,
    );
    expect(twice.ok).toBe(false);
    if (!twice.ok) expect(twice.reason).toBe("two lanes on the same market");
    const one = validateProposal({ title: "t", rationale: "r", loops: [loop], allocationsBps: null }, rows);
    expect(one.ok).toBe(true);
  });

  /* Strategy forcing is the LIVE code's, unchanged: the model may name the
     strategy, `strategyForRow` chooses it, and the mismatch prints. */
  it("corrects a floor lane the model calls a loop, and states the correction", () => {
    const rows = scopedLiveRows(liveVenues(1_800_000_000_000).venues);
    const v = validateProposal(
      {
        title: "t",
        rationale: "r",
        loops: [{ candidateId: ROUTER_FLOOR_CANDIDATE_ID, strategy: "loop", leverage: 3, hedge: false, compound: false }],
        allocationsBps: null,
      },
      rows,
    );
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.payload.loops[0]!.strategy).toBe("treasury");
      expect(v.payload.notes.some((n) => n.includes("which is the strategy this market carries"))).toBe(true);
    }
  });

  it("appends the scope sentence to the live propose description", () => {
    expect(propose.description).toBe(
      `${COPILOT_TOOLS[0].description} candidateId is one of the two live market ids. hedge must be false. allocationsBps is null for one lane and sums to 10000 for two.`,
    );
  });

  it("explain_market takes either live id", () => {
    expect(explain.input_schema.properties.candidateId).toEqual({
      type: "string",
      enum: [HERO_MARKET_ID, ROUTER_FLOOR_CANDIDATE_ID],
    });
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
  it("keeps the floor and drops every other modeled template row, so a collar, a dn-LP or a second issuer cannot validate", () => {
    const venues = liveVenues(1_800_000_000_000).venues;
    const unscoped = liveRowsFrom(venues);
    const scoped = scopedLiveRows(venues);
    expect(modeledRows().length).toBeGreaterThan(0);
    expect(unscoped.size).toBe(1 + modeledRows().length);
    expect([...scoped.keys()]).toEqual([HERO_MARKET_ID, ROUTER_FLOOR_CANDIDATE_ID]);
    /* The floor is one of the modeled rows, and it is the ONE that survives:
       the other five treasury issuers (R1 keeps Aave Ethereum, BUIDL and the
       rest coming soon), the dn-LP and the collar are all still refused. */
    const soon = modeledRows().filter((r) => r.id !== ROUTER_FLOOR_CANDIDATE_ID);
    expect(soon.length).toBe(modeledRows().length - 1);
    for (const r of soon) {
      const v = validateExplain({ candidateId: r.id }, scoped);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(mapRejectReason(v.reason)).toBe(COPILOT_REJECT_COMING_SOON);
    }
    expect(validateExplain({ candidateId: ROUTER_FLOOR_CANDIDATE_ID }, scoped).ok).toBe(true);
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
