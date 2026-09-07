/**
 * The catalog this build serves: six committed snapshots with the demo row
 * spliced in, and the one-row live list the copilot reads.
 */
import { describe, expect, it } from "vitest";

import { demoVenues, liveVenues } from "@/lib/canvas/catalog-server";
import { reconcileHedgeFunding } from "@/lib/canvas/perp-books";
import { isLiveMarket } from "@/lib/demo-scope";
import { DEMO_MARKET_ID, demoMarketCandidate } from "@/lib/demo/market";

const NOW = 1_800_000_000_000;

describe("demoVenues", () => {
  const payload = demoVenues(NOW);

  it("serves the six committed venues, sorted, from the snapshot tier", () => {
    expect(payload.ok).toBe(true);
    expect(payload.nowMs).toBe(NOW);
    expect(payload.degraded).toEqual([]);
    expect(payload.venues.map((v) => v.venue)).toEqual([
      "aave-v3-base",
      "dolomite-berachain",
      "hyperliquid-funding",
      "morpho-blue-base",
      "morpho-blue-ethereum",
      "morpho-blue-hyperevm",
    ]);
    for (const v of payload.venues) expect(v.source).toBe("snapshot");
  });

  it("splices the demo row into the Morpho Base unhedged section exactly once", () => {
    const base = payload.venues.find((v) => v.venue === "morpho-blue-base")!;
    const hits = [...base.hedged, ...base.unhedged].filter((c) => c.id === DEMO_MARKET_ID);
    expect(hits).toHaveLength(1);
    expect(base.unhedged[0]!.id).toBe(DEMO_MARKET_ID);
    expect(base.hedged.some((c) => c.id === DEMO_MARKET_ID)).toBe(false);
    expect(base.unhedged[0]).toEqual(demoMarketCandidate());
  });

  it("is already funding-reconciled at the boundary (a second pass moves nothing)", () => {
    const again = reconcileHedgeFunding(payload.venues);
    expect(again).toEqual(payload.venues);
  });

  it("is pure in the clock", () => {
    expect(demoVenues(NOW)).toEqual(payload);
  });
});

describe("liveVenues", () => {
  it("holds exactly one row, and it is the demo market", () => {
    const live = liveVenues(NOW);
    const rows = live.venues.flatMap((v) => [...v.hedged, ...v.unhedged]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(DEMO_MARKET_ID);
    expect(isLiveMarket(rows[0]!.id)).toBe(true);
    expect(live.venues).toHaveLength(1);
    expect(live.venues[0]!.venue).toBe("morpho-blue-base");
    expect(live.ok).toBe(true);
    expect(live.degraded).toEqual([]);
  });
});
