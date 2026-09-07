import { describe, expect, it } from "vitest";

import {
  classifyRepriceFailure,
  invalidatesQuote,
  laneDisplayApy,
  laneQuoteState,
  quoteFailureLabel,
} from "@/lib/canvas/reprice-state";

describe("classifyRepriceFailure", () => {
  it("classifies a network error (null status) as unreachable", () => {
    expect(classifyRepriceFailure(null)).toBe("unreachable");
  });

  it("classifies 404 as gone: the market left the live scan", () => {
    expect(classifyRepriceFailure(404)).toBe("gone");
  });

  it("classifies 501 as failed: the stub route answered, definitively", () => {
    // app/api/canvas/reprice/route.ts answers 501 with a JSON body, so the
    // lane falls through to the modeled mock quote instead of the gone state.
    expect(classifyRepriceFailure(501)).toBe("failed");
  });

  it("classifies 500 as failed", () => {
    expect(classifyRepriceFailure(500)).toBe("failed");
  });
});

describe("laneQuoteState", () => {
  it("reads a standing mock quote as priced, never as the failure register", () => {
    const state = laneQuoteState({ repricing: false, reprice: { ok: true } });
    expect(state).toBe("priced");
    expect(state).not.toBe("failed");
    expect(state).not.toBe(quoteFailureLabel("failed"));
  });

  it("lets an in-flight retry outrank a prior failure", () => {
    expect(laneQuoteState({ repricing: true, reprice: { ok: false, kind: "failed" } })).toBe("quoting");
  });

  it("names the definitive failure kinds and the idle state", () => {
    expect(laneQuoteState({ repricing: false, reprice: null })).toBe("idle");
    expect(laneQuoteState({ repricing: false, reprice: { ok: false, kind: "gone" } })).toBe("gone");
    expect(laneQuoteState({ repricing: false, reprice: { ok: false } })).toBe("unreachable");
  });
});

describe("invalidatesQuote", () => {
  it("is derived from the priced fields: every module that reaches the quote invalidates it", () => {
    expect(invalidatesQuote("liquidity-source")).toBe(true);
    expect(invalidatesQuote("safety-buffer")).toBe(true);
    expect(invalidatesQuote("hedge")).toBe(true);
    expect(invalidatesQuote("auto-compound")).toBe(true);
  });
});

describe("laneDisplayApy", () => {
  it("blanks the number when the composition no longer matches the quote", () => {
    expect(laneDisplayApy(0.12, true)).toBe(0.12);
    expect(laneDisplayApy(0.12, false)).toBeNull();
  });
});
