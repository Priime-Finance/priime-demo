/**
 * The catalog this build serves: six committed snapshots with the demo row
 * spliced in, the router's floor venue beside them, and the live list the
 * copilot reads.
 */
import { describe, expect, it } from "vitest";

import { demoVenues, liveVenues } from "@/lib/canvas/catalog-server";
import { publishedNetApy, repriceAtLeverage } from "@/lib/canvas/mock-quote";
import { reconcileHedgeFunding } from "@/lib/canvas/perp-books";
import {
  floorRowToday,
  ROUTER_FLOOR_CANDIDATE_ID,
  routerPublishedToday,
} from "@/lib/canvas/router-history";
import { buildUnifiedList, discoverAbsence, seatedLeverage } from "@/lib/canvas/unified-list";
import { FLOOR_MARKET_ID, isLiveMarket } from "@/lib/demo-scope";
import { DEMO_MARKET_ID, HERO_SEED_LEVERAGE, demoMarketCandidate } from "@/lib/demo/market";

const NOW = 1_800_000_000_000;

describe("demoVenues", () => {
  const payload = demoVenues(NOW);

  it("serves the six committed venues plus the floor, sorted, from the snapshot tier", () => {
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
      "treasury-ausdc-base",
    ]);
    for (const v of payload.venues) expect(v.source).toBe("snapshot");
  });

  describe("the router's floor venue (R1)", () => {
    const floor = payload.venues.find((v) => v.venue === "treasury-ausdc-base")!;

    it("carries the one issuer row, unhedged, with no scan document behind it", () => {
      expect(floor.hedged).toEqual([]);
      expect(floor.unhedged.map((c) => c.id)).toEqual([ROUTER_FLOOR_CANDIDATE_ID]);
      expect(ROUTER_FLOOR_CANDIDATE_ID).toBe(FLOOR_MARKET_ID);
      // `MODELED_CONTENT_HASH`, the hash `modeledRows` stamps: a hand-authored
      // row must not claim a scan it never had.
      expect(floor.contentHash).toBe("template");
      expect(floor.stale).toBe(false);
      expect(floor.launchable).toBe(false);
    });

    it("serves the row the ROUTER prices, not the shipped 2026-09-03 capture", () => {
      expect(floor.unhedged[0]).toEqual(floorRowToday());
    });

    it("is pickable in the dock: absence-free, unlevered, and it prices", () => {
      const rows = buildUnifiedList(payload.venues, {});
      const row = [...rows.hedged, ...rows.unhedged].find((r) => r.id === FLOOR_MARKET_ID)!;
      expect(row).toBeDefined();
      expect(discoverAbsence(row)).toBeNull();
      expect(seatedLeverage(row)).toBe(1);
      expect(row.venueLabel).toBe("Aave USDC · Base");
    });
  });

  /* ── THE WELD (design item 1) ────────────────────────────────────────────
     The whole package rests on the canvas and the router pricing ONE pair of
     lanes. Both sides are recomputed here through their own owners and
     asserted equal at full precision, so a second frame cannot open in
     silence the way the typed 0.044 / 0.035 pair did. */
  describe("the canvas and the router price one vault", () => {
    const today = routerPublishedToday()!;

    it("prices the loop lane at the router's own loop number", () => {
      const canvas = publishedNetApy(
        repriceAtLeverage(demoMarketCandidate(), HERO_SEED_LEVERAGE),
        false,
      );
      expect(canvas).toBe(today.loop);
      // The dock ladder's last rung, at the precision the canvas prints.
      expect(`${((canvas ?? 0) * 100).toFixed(1)}%`).toBe("3.1%");
    });

    it("prices the floor lane at the router's own floor number", () => {
      const floorRow = payload.venues.find((v) => v.venue === "treasury-ausdc-base")!.unhedged[0]!;
      expect(publishedNetApy(floorRow, false)).toBe(today.floor);
      expect(`${((today.floor ?? 0) * 100).toFixed(1)}%`).toBe("3.0%");
    });

    it("leaves the gap the router instrument reads, at two decimals", () => {
      const gapPp = ((today.loop ?? 0) - (today.floor ?? 0)) * 100;
      expect(gapPp.toFixed(2)).toBe("0.10");
    });
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
  it("holds exactly the two live rows: the loop market and the floor", () => {
    const live = liveVenues(NOW);
    const rows = live.venues.flatMap((v) => [...v.hedged, ...v.unhedged]);
    expect(rows.map((r) => r.id)).toEqual([DEMO_MARKET_ID, FLOOR_MARKET_ID]);
    for (const r of rows) expect(isLiveMarket(r.id)).toBe(true);
    expect(live.venues.map((v) => v.venue)).toEqual(["morpho-blue-base", "treasury-ausdc-base"]);
    expect(live.ok).toBe(true);
    expect(live.degraded).toEqual([]);
  });
});
