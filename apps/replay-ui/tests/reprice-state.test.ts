import { describe, expect, it } from "vitest";

import {
  classifyRepriceFailure,
  invalidatesQuote,
  laneDisplayApy,
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

describe("invalidatesQuote", () => {
  it("holds the quote only for the cadence-only module", () => {
    expect(invalidatesQuote("auto-compound")).toBe(false);
    expect(invalidatesQuote("liquidity-source")).toBe(true);
    expect(invalidatesQuote("safety-buffer")).toBe(true);
    expect(invalidatesQuote("hedge")).toBe(true);
  });
});

describe("laneDisplayApy", () => {
  it("blanks the number when the composition no longer matches the quote", () => {
    expect(laneDisplayApy(0.12, true)).toBe(0.12);
    expect(laneDisplayApy(0.12, false)).toBeNull();
  });
});
