import { describe, expect, it } from "vitest";

import { POST } from "@/app/api/canvas/reprice/route";
import type { RepriceData } from "@/components/canvas/types";
import { liveVenues } from "@/lib/canvas/catalog-server";
import { routerPublishedToday } from "@/lib/canvas/router-history";
import { catalogRow, laneQuote, mockQuote, publishedNetApy } from "@/lib/canvas/mock-quote";
import { DEMO_MARKET_ID, HERO_SEED_LEVERAGE } from "@/lib/demo/market";

/**
 * The reprice fallback (docs/plans/LATEST_UI_PORT_SPEC.md 2.17): the route
 * answers 200 in the live rail's own shape, so the canvas never surfaces the
 * quote-failed register on the one live market, and the number it prints from
 * the rail is the number it prints offline.
 */
function post(body: unknown, raw = false): Promise<Response> {
  return POST(
    new Request("http://localhost/api/canvas/reprice", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw ? (body as string) : JSON.stringify(body),
    }),
  );
}

type Ok = Extract<RepriceData, { ok: true }>;

describe("POST /api/canvas/reprice", () => {
  it("answers the live market in the rail's shape: the row at its own seat, the lane's leverage applied", async () => {
    const res = await post({
      venue: "morpho-blue-base",
      candidateId: DEMO_MARKET_ID,
      targetLeverage: HERO_SEED_LEVERAGE,
      riskPreset: "standard",
    });
    expect(res.status).toBe(200);
    const q = (await res.json()) as Ok;
    expect(q.ok).toBe(true);
    expect(q.requestedLeverage).toBe(HERO_SEED_LEVERAGE);
    expect(q.appliedLeverage).toBe(HERO_SEED_LEVERAGE);
    /* The candidate is the catalog row itself, at the market's own ceiling
       (3.25x), never a row already repriced at the lane: the canvas reprices
       it client-side and reads the market's seat off it. */
    expect(q.candidate?.id).toBe(DEMO_MARKET_ID);
    expect(q.candidate?.economics?.loopLeverage).toBeCloseTo(3.25, 6);
    expect(q.bands.hf.hfFloorBps).toBeGreaterThan(0);
    expect(q.bands.margin).toBeNull();
    expect(q.violations).toEqual([]);
  });

  it("prices the lane, through the canvas's own laneQuote, to the offline number", async () => {
    const res = await post({ candidateId: DEMO_MARKET_ID, targetLeverage: HERO_SEED_LEVERAGE, riskPreset: "standard" });
    const server = (await res.json()) as Ok;
    /* RackCanvas: `laneQuote(serverOk, p)` when the rail answered, else
       `mockQuote(scanHit, L, preset, p)`. One frame, one number. */
    const fromRail = laneQuote(server, null);
    const hit = catalogRow(liveVenues(Date.now()), DEMO_MARKET_ID);
    expect(hit).not.toBeNull();
    const offline = mockQuote(hit!, HERO_SEED_LEVERAGE, "standard", null);
    expect(fromRail.ok).toBe(true);
    expect(offline.ok).toBe(true);
    const a = publishedNetApy((fromRail as Ok).candidate!, false);
    const b = publishedNetApy((offline as Ok).candidate!, false);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a).toBeCloseTo(b ?? Number.NaN, 6);
    /* The vault number the header prints, from the one owner, with the fee
       inside, and it is the ROUTER's own loop number, not a typed constant
       (router lane WP-1, design item 1: one owner across the two frames). */
    expect(a).toBe(routerPublishedToday()!.loop);
    expect((fromRail as Ok).candidate?.economics?.loopLeverage).toBeCloseTo(HERO_SEED_LEVERAGE, 6);
  });

  it("seats a request above the ceiling at the market's own seat, and says what was asked", async () => {
    const res = await post({ candidateId: DEMO_MARKET_ID, targetLeverage: 5, riskPreset: "standard" });
    const q = (await res.json()) as Ok;
    expect(q.requestedLeverage).toBe(5);
    /* `clampLeverage` pins 5x to the house maximum for LT 0.915 (about
       3.26x) and the rail caps that at the market's own ceiling, 3.25x. The
       stored request stays above the cap, which the band validator names. */
    expect(q.appliedLeverage).toBeCloseTo(3.25, 6);
    expect(q.violations.map((v) => v.invariant)).toContain("leverage-house-cap");
  });

  it("seats the market's own ceiling when no leverage is asked for", async () => {
    const res = await post({ candidateId: DEMO_MARKET_ID });
    const q = (await res.json()) as Ok;
    expect(q.requestedLeverage).toBeNull();
    expect(q.appliedLeverage).toBeCloseTo(3.25, 6);
  });

  it("answers 404 for a market outside the live list", async () => {
    const res = await post({ candidateId: "aave-v3-base:8453:nothing", targetLeverage: 2, riskPreset: "standard" });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(false);
  });

  it("answers 400 without a candidate id or with a malformed body", async () => {
    expect((await post({ targetLeverage: 2 })).status).toBe(400);
    expect((await post("{not json", true)).status).toBe(400);
  });
});
