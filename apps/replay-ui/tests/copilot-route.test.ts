/**
 * Copilot route handlers invoked directly (IT4_COPILOT_SPEC §6 tests 18-22,
 * D1, D2) with the catalog retargeted to `@/lib/canvas/catalog-server` and a
 * mocked Anthropic stream. Ported from build.priime.finance eb6d33a
 * `lib/canvas/__tests__/copilot-route.test.ts`, plus the scope: the route
 * reads the one-row `liveVenues()`, hands the model the demo prompt and the
 * two scoped tools, seats a proposal on the live market, and answers any other
 * market with the coming-soon sentence.
 */
/* eslint-disable @typescript-eslint/require-await --
 * The mocked SDK stream keeps the SDK's own async surface (an async iterator
 * and an async finalMessage) so the route awaits exactly what it awaits in
 * production; the mock has nothing of its own to await. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { emptyPortfolio } from "@/lib/canvas/graph-ops";
import { DEMO_COPILOT_SYSTEM_PROMPT } from "@/lib/canvas/copilot/scope";
import {
  DEMO_SUSTAIN_HOURS,
  DEMO_UPGRADE_REARM,
  DEMO_UPGRADE_THRESHOLD,
} from "@/lib/canvas/orchestrator/demo-rules";
import {
  ROUTER_FLOOR_CANDIDATE_ID,
  ROUTER_HISTORY_SOURCES,
  routerPublishedToday,
} from "@/lib/canvas/router-history";
import { COPILOT_REJECT_COMING_SOON, HERO_MARKET_ID } from "@/lib/demo-scope";

vi.mock("@/lib/canvas/catalog-server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/canvas/catalog-server")>();
  return {
    demoVenues: vi.fn(actual.demoVenues),
    liveVenues: vi.fn(actual.liveVenues),
  };
});

vi.mock("@anthropic-ai/sdk", () => {
  class MockAnthropic {
    constructor(opts?: unknown) {
      (globalThis as Record<string, unknown>).__copilotMockCtor = opts;
      (globalThis as Record<string, unknown>).__copilotMockConstructed =
        ((globalThis as Record<string, unknown>).__copilotMockConstructed as number | undefined ?? 0) + 1;
    }
    messages = {
      stream: (params: unknown) => {
        (globalThis as Record<string, unknown>).__copilotMockParams = params;
        const final =
          (globalThis as Record<string, unknown>).__copilotMockFinal ??
          ({ stop_reason: "end_turn", content: [] } as unknown);
        const err = (globalThis as Record<string, unknown>).__copilotMockError;
        return {
          async *[Symbol.asyncIterator]() {
            if (err) throw err as Error;
            yield { type: "content_block_delta", delta: { type: "text_delta", text: "ok" } };
          },
          finalMessage: async () => final,
        };
      },
    };
  }
  return { default: MockAnthropic };
});

import { GET, POST } from "@/app/api/canvas/copilot/route";
import { liveVenues, demoVenues } from "@/lib/canvas/catalog-server";

const savedKey = process.env.ANTHROPIC_API_KEY;
const savedWorkspace = process.env.ANTHROPIC_WORKSPACE_ID;
const g = globalThis as Record<string, unknown>;

function validBody(userTurns = 1) {
  const messages: { role: "user" | "assistant"; content: string }[] = [];
  for (let i = 0; i < userTurns; i++) {
    if (i > 0) messages.push({ role: "assistant", content: `a${i}` });
    messages.push({ role: "user", content: `u${i}` });
  }
  return {
    messages,
    canvas: { portfolio: emptyPortfolio(), reprices: {} },
  };
}

function post(body: string, ip: string) {
  return POST(
    new Request("http://local/api/canvas/copilot", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body,
    }),
  );
}

function toolUse(name: string, input: unknown) {
  return { stop_reason: "tool_use", content: [{ type: "tool_use", name, input }] };
}

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  delete process.env.ANTHROPIC_WORKSPACE_ID;
  delete g.__copilotMockFinal;
  delete g.__copilotMockError;
  delete g.__copilotMockParams;
  delete g.__copilotMockCtor;
  g.__copilotMockConstructed = 0;
  vi.mocked(liveVenues).mockClear();
  vi.mocked(demoVenues).mockClear();
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedKey;
  if (savedWorkspace === undefined) delete process.env.ANTHROPIC_WORKSPACE_ID;
  else process.env.ANTHROPIC_WORKSPACE_ID = savedWorkspace;
});

describe("copilot route", () => {
  it("18. no ANTHROPIC_API_KEY → POST 503 offline, GET online:false, the SDK never constructed", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const probe = GET();
    expect(await probe.json()).toEqual({ ok: true, online: false });
    const r = await post(JSON.stringify(validBody()), "18.0.0.1");
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ ok: false, offline: true });
    expect(g.__copilotMockConstructed).toBe(0);
    expect(vi.mocked(liveVenues)).not.toHaveBeenCalled();
  });

  it("GET reports online with a key", async () => {
    const probe = GET();
    expect(await probe.json()).toEqual({ ok: true, online: true });
  });

  it("19. rate limit: 11th request inside a minute → 429 with retryAfterMs", async () => {
    for (let i = 0; i < 10; i++) {
      const r = await post("{malformed", "19.0.0.1");
      expect(r.status).toBe(400); // consumes a token, fails JSON parse
    }
    const r11 = await post("{malformed", "19.0.0.1");
    expect(r11.status).toBe(429);
    const body = await r11.json();
    expect(body.error).toBe("rate limited");
    expect(body.retryAfterMs).toBeGreaterThan(0);
  });

  it("20. turn cap: 21 user messages → 400 turn-limit", async () => {
    const r = await post(JSON.stringify(validBody(21)), "20.0.0.1");
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.code).toBe("turn-limit");
  });

  it("21. oversized body → 413; last message not user → 400", async () => {
    const big = await post("x".repeat(201 * 1024), "21.0.0.1");
    expect(big.status).toBe(413);

    const notUser = validBody(1);
    notUser.messages.push({ role: "assistant", content: "trailing" });
    const r = await post(JSON.stringify(notUser), "21.0.0.2");
    expect(r.status).toBe(400);
  });

  it("22. tool-use stop with an unknown id emits proposal_rejected with the coming-soon reason, then done", async () => {
    g.__copilotMockFinal = toolUse("propose_portfolio", {
      title: "t",
      rationale: "r",
      loops: [{ candidateId: "mkt:ghost", strategy: "loop", leverage: null, hedge: false, compound: false }],
      allocationsBps: null,
    });
    const r = await post(JSON.stringify(validBody()), "22.0.0.1");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/event-stream");
    const text = await r.text();
    expect(text).toContain("event: proposal_rejected");
    expect(text).toContain('"unknownIds":["mkt:ghost"]');
    expect(text).toContain(`"reason":${JSON.stringify(COPILOT_REJECT_COMING_SOON)}`);
    expect(text).not.toContain("the scan may have moved");
    expect(text).toContain("event: done");
    expect(text.indexOf("event: proposal_rejected")).toBeLessThan(text.indexOf("event: done"));
    expect(text).not.toContain("event: proposal\n");
    expect(text).toContain('"stopReason":"tool_use"');
  });

  it("S1. the model is handed the demo prompt, the two scoped tools and the one-row context", async () => {
    const r = await post(JSON.stringify(validBody()), "30.0.0.1");
    expect(r.status).toBe(200);
    await r.text();
    expect(vi.mocked(liveVenues)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(demoVenues)).not.toHaveBeenCalled();
    const params = g.__copilotMockParams as {
      model: string;
      system: { type: string; text: string; cache_control: { type: string } }[];
      tools: { name: string }[];
      tool_choice: unknown;
      messages: { role: string; content: string }[];
    };
    expect(params.model).toBe("claude-sonnet-5");
    expect(params.system).toEqual([
      { type: "text", text: DEMO_COPILOT_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    ]);
    expect(params.tools.map((t) => t.name)).toEqual(["propose_portfolio", "explain_market"]);
    expect(params.tool_choice).toEqual({ type: "auto", disable_parallel_tool_use: true });
    expect(params.messages[0]!.role).toBe("user");
    expect(params.messages[0]!.content).toContain("<canvas_context>");
    expect(params.messages[0]!.content).toContain(HERO_MARKET_ID);
    expect(params.messages[0]!.content).toContain('"complete":true');
    expect(params.messages[1]).toEqual({ role: "user", content: "u0" });
    expect(g.__copilotMockCtor).toEqual({});
  });

  /* WP-4: the floor lane and the rule reach the model, and every figure in
     that block comes out of the quant's owners rather than out of a literal
     anywhere on this path (SEAM 4). */
  it("S1b. the context carries the router: both published rates, the gap, the rule and the sources", async () => {
    const r = await post(JSON.stringify(validBody()), "30.0.0.2");
    await r.text();
    const params = g.__copilotMockParams as { messages: { content: string }[] };
    const block = params.messages[0]!.content;
    const json = JSON.parse(block.slice(block.indexOf("{"), block.lastIndexOf("}") + 1)) as {
      router: {
        live: boolean;
        modeled: boolean;
        measuredOn: string;
        gapPp: number;
        loop: { publishedApyPct: number };
        floor: {
          candidateId: string;
          venueLabel: string;
          modules: string[];
          redemptionRoute: string;
          settlementDays: number;
          publishedApyPct: number;
        };
        rule: { sustainHours: number; thresholdPp: number; rearmPp: number };
        sources: { of: string; label: string }[];
      };
    };
    const today = routerPublishedToday()!;
    const rt = json.router;
    expect(rt.live).toBe(true);
    expect(rt.modeled).toBe(true);
    expect(rt.measuredOn).toBe(today.date);
    expect(rt.loop.publishedApyPct).toBe(Number((today.loop! * 100).toFixed(2)));
    expect(rt.floor.publishedApyPct).toBe(Number((today.floor! * 100).toFixed(2)));
    /* Differenced BEFORE rounding: 3.08 minus 2.97 would print 0.11. */
    expect(rt.gapPp).toBe(Number(((today.loop! - today.floor!) * 100).toFixed(2)));
    expect(rt.floor.candidateId).toBe(ROUTER_FLOOR_CANDIDATE_ID);
    expect(rt.floor.venueLabel).toBe("Aave USDC · Base");
    expect(rt.floor.modules).toEqual(["liquidity-source", "redemption-route"]);
    expect(rt.floor.settlementDays).toBe(0);
    expect(rt.floor.redemptionRoute.length).toBeGreaterThan(0);
    expect(rt.rule.sustainHours).toBe(DEMO_SUSTAIN_HOURS);
    expect(rt.rule.thresholdPp).toBe(Number((DEMO_UPGRADE_THRESHOLD * 100).toFixed(2)));
    expect(rt.rule.rearmPp).toBe(Number((DEMO_UPGRADE_REARM * 100).toFixed(2)));
    expect(rt.sources.map((s) => s.of)).toEqual(["floor", "loop collateral", "loop borrow"]);
    expect(rt.sources[0]!.label).toBe(ROUTER_HISTORY_SOURCES.aaveUsdcSupply.label);
    expect(block).toContain(ROUTER_HISTORY_SOURCES.aaveUsdcSupply.pool);
    /* The move size is deliberately absent: the rule's weight and the weight
       the concentration floor actually lets through are two numbers, and only
       the second is on a screen. */
    expect(block).not.toContain("moveWeight");
  });

  it("S1c. the floor market is in the market list the model reads, beside the loop", async () => {
    const r = await post(JSON.stringify(validBody()), "30.0.0.3");
    await r.text();
    const params = g.__copilotMockParams as { messages: { content: string }[] };
    expect(params.messages[0]!.content).toContain(ROUTER_FLOOR_CANDIDATE_ID);
  });

  it("S1d. a two-lane proposal on the loop and the floor is seated, and both lanes are priced", async () => {
    g.__copilotMockFinal = toolUse("propose_portfolio", {
      title: "Loop with a lending floor",
      rationale: "The loop with the USDC lending lane beside it.",
      loops: [
        { candidateId: HERO_MARKET_ID, strategy: "loop", leverage: null, hedge: false, compound: true },
        { candidateId: ROUTER_FLOOR_CANDIDATE_ID, strategy: "treasury", leverage: null, hedge: false, compound: false },
      ],
      allocationsBps: [5000, 5000],
    });
    const text = await (await post(JSON.stringify(validBody()), "35.0.0.1")).text();
    expect(text).toContain("event: proposal\n");
    expect(text).not.toContain("event: proposal_rejected");
    const line = text.split("\n").find((l) => l.startsWith("data: ") && l.includes('"loops"'))!;
    const payload = JSON.parse(line.slice(6)) as {
      loops: { candidateId: string; strategy: string; lane: { vaultApy: number | null } }[];
      allocationsBps: number[] | null;
    };
    expect(payload.loops.map((l) => l.candidateId)).toEqual([HERO_MARKET_ID, ROUTER_FLOOR_CANDIDATE_ID]);
    expect(payload.loops.map((l) => l.strategy)).toEqual(["loop", "treasury"]);
    expect(payload.allocationsBps).toEqual([5000, 5000]);
    for (const l of payload.loops) expect(typeof l.lane.vaultApy).toBe("number");
  });

  it("S1e. the five other treasury issuers are still refused with the coming-soon sentence", async () => {
    g.__copilotMockFinal = toolUse("explain_market", {
      candidateId: "template:treasury-floor:treasury-buidl-ethereum:buidl",
    });
    const text = await (await post(JSON.stringify(validBody()), "35.0.0.2")).text();
    expect(text).toContain("event: proposal_rejected");
    expect(text).toContain(`"reason":${JSON.stringify(COPILOT_REJECT_COMING_SOON)}`);
    expect(text).not.toContain("event: explain\n");
  });

  it("S2. a proposal on the live market is seated, priced from the lane, and its prose is linted", async () => {
    g.__copilotMockFinal = toolUse("propose_portfolio", {
      title: "One lane on Prime Build",
      rationale: "The loop as the live market seats it. A conservative choice.",
      loops: [{ candidateId: HERO_MARKET_ID, strategy: "loop", leverage: 5, hedge: false, compound: true }],
      allocationsBps: null,
    });
    const r = await post(JSON.stringify(validBody()), "31.0.0.1");
    const text = await r.text();
    expect(text).toContain("event: proposal\n");
    expect(text).not.toContain("event: proposal_rejected");
    const line = text.split("\n").find((l) => l.startsWith("data: ") && l.includes('"loops"'))!;
    const payload = JSON.parse(line.slice(6)) as {
      title: string;
      rationale: string;
      loops: {
        candidateId: string;
        hedge: boolean;
        leverage: number | null;
        lane: { vaultApy: number | null; seatedLeverage: number; seatBounds: { max: number } | null };
      }[];
      notes: string[];
    };
    expect(payload.title).toBe("Portfolio blueprint");
    expect(payload.rationale).toBe("The loop as the live market seats it.");
    expect(payload.loops).toHaveLength(1);
    expect(payload.loops[0]!.candidateId).toBe(HERO_MARKET_ID);
    expect(payload.loops[0]!.hedge).toBe(false);
    /* The seat: 5x lands at the dial's own ceiling (`seatBounds.max`, read
       off the lane, never typed here), the lane is priced at that seat in the
       PRODUCT frame (`vaultApy`, the fee inside), and the card carries the
       correction as a note. `netApy` is not a field on the lane; an
       assertion on it passed vacuously (`undefined` is not `null`). */
    const lane = payload.loops[0]!.lane;
    expect(lane.seatBounds).not.toBeNull();
    expect(payload.loops[0]!.leverage).toBe(lane.seatBounds!.max);
    expect(payload.loops[0]!.leverage).toBeLessThan(5);
    expect(lane.seatedLeverage).toBe(payload.loops[0]!.leverage);
    expect(typeof lane.vaultApy).toBe("number");
    expect(lane.vaultApy!).toBeGreaterThan(0);
    expect(payload.notes.length).toBeGreaterThan(0);
    expect(payload.notes.some((n) => n.includes("seated at"))).toBe(true);
  });

  it("S3. explain_market on the live id emits explain; on any other id, the coming-soon reason", async () => {
    g.__copilotMockFinal = toolUse("explain_market", { candidateId: HERO_MARKET_ID });
    const live = await (await post(JSON.stringify(validBody()), "32.0.0.1")).text();
    expect(live).toContain("event: explain\n");
    expect(live).toContain(HERO_MARKET_ID);

    g.__copilotMockFinal = toolUse("explain_market", { candidateId: "hyperliquid:ETH" });
    const soon = await (await post(JSON.stringify(validBody()), "32.0.0.2")).text();
    expect(soon).toContain("event: proposal_rejected");
    expect(soon).toContain(`"reason":${JSON.stringify(COPILOT_REJECT_COMING_SOON)}`);
    expect(soon).not.toContain("event: explain\n");
  });

  it("S4. the compare tool is not on the list, and a stray compare call is ignored", async () => {
    g.__copilotMockFinal = toolUse("compare", { candidateIds: [HERO_MARKET_ID, "mkt:ghost"] });
    const text = await (await post(JSON.stringify(validBody()), "33.0.0.1")).text();
    expect(text).not.toContain("event: compare");
    expect(text).not.toContain("event: proposal_rejected");
    expect(text).toContain('"stopReason":"tool_use"');
    expect(text).toContain("event: done");
  });

  it("S5. ANTHROPIC_WORKSPACE_ID rides as a default header only when set", async () => {
    process.env.ANTHROPIC_WORKSPACE_ID = "wrkspc_test";
    await (await post(JSON.stringify(validBody()), "34.0.0.1")).text();
    expect(g.__copilotMockCtor).toEqual({ defaultHeaders: { "anthropic-workspace-id": "wrkspc_test" } });
  });

  /* D2 (2026-09-01): a body that parses as JSON but misses a path the context
     builder dereferences must be a structured 400 naming the path, never a
     500. The orchestrator case is the one that 500ed in production. */
  it("D2. portfolio missing orchestrator → 400 malformed-canvas naming the path", async () => {
    const body = validBody();
    delete (body.canvas.portfolio as { orchestrator?: unknown }).orchestrator;
    const r = await post(JSON.stringify(body), "23.0.0.1");
    expect(r.status).toBe(400);
    const json = await r.json();
    expect(json.code).toBe("malformed-canvas");
    expect(json.error).toBe("malformed canvas: portfolio.orchestrator is not an object");
  });

  it("D2. loops not an array / node missing data → 400 with the offending path", async () => {
    const noLoops = validBody();
    (noLoops.canvas.portfolio as { loops: unknown }).loops = "nope";
    const r1 = await post(JSON.stringify(noLoops), "23.0.0.2");
    expect(r1.status).toBe(400);
    expect((await r1.json()).error).toBe("malformed canvas: portfolio.loops is not an array");

    const badNode = validBody();
    (badNode.canvas.portfolio as { loops: unknown }).loops = [
      { id: "loop_1", label: "Lane 1", nodes: [{ id: "x" }], edges: [] },
    ];
    const r2 = await post(JSON.stringify(badNode), "23.0.0.3");
    expect(r2.status).toBe(400);
    expect((await r2.json()).error).toBe(
      "malformed canvas: portfolio.loops[0].nodes[0].data is not an object",
    );
  });

  it("D2 mutation: the same body with orchestrator restored streams 200", async () => {
    /* The guard keys on the orchestrator, not on the rest of the body: moving
       only that one key flips 400 → 200 SSE. */
    const r = await post(JSON.stringify(validBody()), "23.0.0.4");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/event-stream");
  });

  /* D1 (2026-09-01): the model-call catch must surface the failure class and
     HTTP status on the SSE error, log the full detail server-side, and leak
     neither key material nor the upstream message text to the client. */
  it("D1. a 401 from the SDK reaches the SSE line as class + status, detail stays server-side", async () => {
    const upstream = Object.assign(new Error("invalid x-api-key: sk-ant-xxxx"), {
      name: "AuthenticationError",
      status: 401,
      type: "authentication_error",
    });
    g.__copilotMockError = upstream;
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const r = await post(JSON.stringify(validBody()), "24.0.0.1");
      expect(r.status).toBe(200);
      const text = await r.text();
      expect(text).toContain('"message":"copilot request failed: authentication_error 401"');
      expect(text).toContain("event: done");
      // no secrets, no upstream echo on the wire
      expect(text).not.toContain("x-api-key");
      expect(text).not.toContain("sk-ant");
      // the full detail is logged server-side
      const line = logged.mock.calls.map((c) => String(c[0])).join("\n");
      expect(line).toContain("name=AuthenticationError");
      expect(line).toContain("status=401");
      expect(line).toContain("invalid x-api-key");
    } finally {
      logged.mockRestore();
    }
  });

  it("D1. the rate-limit branch is preserved verbatim", async () => {
    g.__copilotMockError = Object.assign(new Error("overloaded"), {
      name: "RateLimitError",
      status: 429,
      type: "rate_limit_error",
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const r = await post(JSON.stringify(validBody()), "24.0.0.2");
      const text = await r.text();
      expect(text).toContain('"message":"copilot is busy, retry shortly"');
    } finally {
      logged.mockRestore();
    }
  });

  it("D1. a non-API error falls back to its class name, no status", async () => {
    g.__copilotMockError = new TypeError("boom");
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const r = await post(JSON.stringify(validBody()), "24.0.0.3");
      const text = await r.text();
      expect(text).toContain('"message":"copilot request failed: TypeError"');
    } finally {
      logged.mockRestore();
    }
  });
});
