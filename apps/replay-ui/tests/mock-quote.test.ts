import { describe, expect, it } from "vitest";

import { catalogRow, composedNetApy, mockQuote } from "@/lib/canvas/mock-quote";
import type { ProjectedCandidate } from "@/lib/canvas/opportunities";

/** Minimal catalog row: only the fields mockQuote and composedNetApy read. */
function candidate(over: Partial<ProjectedCandidate> = {}): ProjectedCandidate {
  return {
    id: "morpho-base:USDe/USDC",
    venue: "morpho-blue-base",
    cls: "N1",
    pair: "USDe/USDC",
    collateralSymbol: "USDe",
    debtSymbol: "USDC",
    hlCoin: null,
    eligible: true,
    eligibleWithRewards: null,
    lt: 0.915,
    headlineApr: 0.1,
    score: null,
    scoreN1: null,
    apyRiskAdj: null,
    economics: {
      netApyOnDepositApy: 0.14,
      netCarryOnEquityApy: 0.2,
      loopLeverage: 3,
      targetLtv: 0.8,
      capacityUsd: 5_000_000,
      capacityBinding: "liquidity",
      fundingP25Apr: 0.02,
      collateralYieldApy: 0.09,
      borrowApyMarginal: 0.05,
    },
    firstFailedGate: null,
    failedGates: [],
    gatesPassed: 6,
    gatesTotal: 6,
    launchable: true,
    ...over,
  };
}

describe("mockQuote", () => {
  it("stamps the quote with the passed clock, never its own", () => {
    const nowMs = 1_700_000_000_000;
    const q = mockQuote({ row: candidate(), blockNumber: 42 }, 3, "standard", nowMs);
    expect(q.ok).toBe(true);
    if (q.ok) {
      expect(q.repricedAtMs).toBe(nowMs);
      expect(q.blockNumber).toBe(42);
      expect(q.requestedLeverage).toBe(3);
    }
  });

  it("is pure in the clock: two calls with the same nowMs agree", () => {
    const hit = { row: candidate(), blockNumber: 7 };
    const a = mockQuote(hit, 2, "conservative", 1234);
    const b = mockQuote(hit, 2, "conservative", 1234);
    expect(a).toEqual(b);
  });
});

describe("catalogRow", () => {
  it("returns null with no catalog or no candidate id", () => {
    expect(catalogRow(null, "x")).toBeNull();
    expect(
      catalogRow({ venues: [], degraded: [], demoMarketId: "d" }, ""),
    ).toBeNull();
  });

  it("finds the row and pins its venue block", () => {
    const row = candidate();
    const hit = catalogRow(
      {
        venues: [
          { blockNumber: 99, hedged: [], unhedged: [row] } as never,
        ],
        degraded: [],
        demoMarketId: row.id,
      },
      row.id,
    );
    expect(hit?.blockNumber).toBe(99);
    expect(hit?.row.id).toBe(row.id);
  });
});

describe("composedNetApy", () => {
  it("strips the funding leg when the hedge is not installed", () => {
    const c = candidate();
    expect(composedNetApy(c, true)).toBeCloseTo(0.14, 10);
    expect(composedNetApy(c, false)).toBeCloseTo(0.12, 10);
  });

  it("has no honest number without a candidate", () => {
    expect(composedNetApy(null, true)).toBeNull();
  });
});
