/**
 * THE TWO POSITION-LEVEL INSTRUMENTS (2026-09-08).
 *
 * The founder published the loop + USDC lending pair and found Dynamic
 * leverage and Redemption route listed as two prose rows under `Also
 * installed`. The first was a seam defect: the two-lane publish let the
 * treasury lane vote on the loop's leverage and the record declined the
 * envelope. The second was an absence: nothing on the record said how the
 * floor lane leaves, and no card read it. These pin the record's new shape
 * and the two cards' readouts against the owners that produce them.
 */
import { describe, expect, it } from "vitest";

import { leverageDriftStrip, redemptionReadout } from "@/components/vaults/AutomationsSection";
import { fmtCapacityUsd } from "@/lib/canvas/format";
import { COLLATERAL_PRICE_BY_DAY, RESERVE_LIQUIDITY_BY_DAY } from "@/lib/canvas/lane-history-data";
import {
  LANE_HISTORY_CAPTURED_AT,
  RESERVE_LIQUIDITY_VENUE,
  collateralDrift,
  reserveLiquidityLatest,
  reserveLiquidityLow,
  reserveLiquiditySeries,
} from "@/lib/canvas/lane-history";
import { deriveHfBands } from "@/lib/canvas/param-schema";
import { publishedModelRecord, type RecordLane } from "@/lib/canvas/pricing-params";
import { publishedLaneExit } from "@/lib/canvas/published-lanes";
import { ROUTER_HISTORY_CAPTURED_AT, routerLastAlignedDay } from "@/lib/canvas/router-history";
import { issuerRedemptionByVenue, settlementWindowText } from "@/lib/canvas/templates";
import { FLOOR_MARKET_ID, HERO_MARKET_ID } from "@/lib/demo-scope";
import { heroRecord } from "@/lib/vaults/hero";
import { deriveAutomations, type AutomationSource, type PublishedLane } from "@/lib/vaults/store";

const LT = 0.915;

/** A loop lane as RackCanvas hands it to the record, at leverage `L`. */
function loopLane(L: number, over: Partial<RecordLane["p"]> = {}): RecordLane {
  return {
    p: {
      venue: "morpho-blue-base",
      candidateId: HERO_MARKET_ID,
      launchableVenue: true,
      pairLabel: "USDe/USDC",
      hlCoin: null,
      chainId: 8453,
      riskPreset: "standard",
      targetLeverage: L,
      hedge: null,
      compound: { cadence: "24h", minActionUsd: 155 },
      exit: null,
      ...over,
    },
    family: "loop",
    lt: LT,
    appliedLeverage: L,
    rowHlCoin: null,
    blockNumber: null,
    bands: { hf: deriveHfBands("standard", L, LT), margin: null },
  };
}

/** The USDC lending floor. Its quote carries bands too (`mockQuote` bands
 *  whatever it is handed), which is exactly what must never leak. */
function floorLane(): RecordLane {
  return {
    p: {
      venue: "treasury-ausdc-base",
      candidateId: FLOOR_MARKET_ID,
      launchableVenue: true,
      pairLabel: "USDC",
      hlCoin: null,
      chainId: 8453,
      riskPreset: "standard",
      targetLeverage: 1,
      hedge: null,
      compound: null,
      exit: { exitPath: "instant-usdc", settlementDays: 0 },
    },
    family: "treasury",
    lt: null,
    appliedLeverage: 1,
    rowHlCoin: null,
    blockNumber: null,
    bands: { hf: deriveHfBands("standard", 1, 0.8), margin: null },
  };
}

describe("publishedModelRecord votes only the lanes a quantity is a fact about", () => {
  it("states the loop lane's envelope beside a USDC lending lane", () => {
    const rec = publishedModelRecord([loopLane(2.5), floorLane()], null);
    expect(rec.appliedLeverage).toBe(2.5);
    expect(rec.liqLtv).toBe(LT);
    const hf = deriveHfBands("standard", 2.5, LT);
    expect(rec.hfTargetBps).toBe(hf.hfTargetBps);
    expect(rec.hfDeleverageBps).toBe(hf.hfDeleverageBps);
    expect(rec.hfFloorBps).toBe(hf.hfFloorBps);
    // The compounder is the loop lane's, the one lane that seats it.
    expect(rec.compoundCadenceHours).toBe(24);
    expect(rec.thresholdUsd).toBe(155);
    /* Roadmap P2 #6: hero-shape records (any loop lane present) publish
       null exit, because `redemption-route` seats only on the treasury
       family and lifting the treasury lane's exit onto the deployed
       loop-vault record used to ship `exit_route_id=instant-usdc` and
       break the WASM component's refuse guard on the first cycle. */
    expect(rec.exitRouteId).toBeNull();
    expect(rec.exitSettlementDays).toBeNull();
    // Both lanes settle on Base, so the chain is still agreed by all.
    expect(rec.chainId).toBe(8453);
  });

  it("declines the envelope off the loop family (MTX-2), and still states the exit", () => {
    const rec = publishedModelRecord([floorLane()], null);
    expect(rec.appliedLeverage).toBeNull();
    expect(rec.liqLtv).toBeNull();
    expect(rec.hfTargetBps).toBeNull();
    expect(rec.exitRouteId).toBe("instant-usdc");
    expect(rec.exitSettlementDays).toBe(0);
  });

  it("still declines two loops that disagree", () => {
    const rec = publishedModelRecord([loopLane(2), loopLane(4)], null);
    expect(rec.appliedLeverage).toBeNull();
    expect(rec.liqLtv).toBe(LT);
    expect(rec.hfTargetBps).toBeNull();
  });

  it("a single loop lane publishes exactly what it did", () => {
    const rec = publishedModelRecord([loopLane(3.25)], null);
    expect(rec.appliedLeverage).toBe(3.25);
    expect(rec.liqLtv).toBe(LT);
    expect(rec.compoundCadenceHours).toBe(24);
    expect(rec.thresholdUsd).toBe(155);
    expect(rec.exitRouteId).toBeNull();
    expect(rec.exitSettlementDays).toBeNull();
  });

  it("a module's dials come from the lanes that seat it, when they agree", () => {
    const one = publishedModelRecord([loopLane(2.5, { compound: null }), loopLane(2.5)], null);
    expect(one.compoundCadenceHours).toBe(24);
    const two = publishedModelRecord(
      [loopLane(2.5, { compound: { cadence: "6h", minActionUsd: 155 } }), loopLane(2.5)],
      null,
    );
    expect(two.compoundCadenceHours).toBeNull();
    expect(two.appliedLeverage).toBe(2.5);
  });
});

describe("the lane's exit on the record", () => {
  it("names the issuer's own route and that route's window", () => {
    expect(publishedLaneExit(floorLane().p)).toEqual({
      routeId: "instant-usdc",
      routeLabel: "Withdraw to USDC",
      settlementDays: 0,
    });
  });

  it("falls to the module vocabulary off an issuer row", () => {
    const p = { ...floorLane().p, candidateId: "no-such-row" };
    expect(publishedLaneExit(p)).toEqual({ routeId: "instant-usdc", routeLabel: "Instant USDC", settlementDays: 0 });
  });

  it("is absent on a lane without the module", () => {
    expect(publishedLaneExit(loopLane(2.5).p)).toBeNull();
  });
});

const ROUTED_LANES: PublishedLane[] = [
  {
    venue: "morpho-blue-base",
    venueLabel: "Morpho Blue · Base",
    market: "USDe/USDC",
    label: "loop",
    family: "loop",
    publishedApy: 0.0434,
    allocationBps: 10_000,
    exit: null,
  },
  {
    venue: "treasury-ausdc-base",
    venueLabel: "Aave v3 · Base",
    market: "USDC",
    label: "USDC lending",
    family: "treasury",
    publishedApy: 0.03,
    allocationBps: 0,
    exit: { routeId: "instant-usdc", routeLabel: "Withdraw to USDC", settlementDays: 0 },
  },
];

/** The routed record as the canvas publishes it after this wave. */
function routedSource(over: Partial<AutomationSource> = {}): AutomationSource {
  return {
    strategy: "loop",
    venue: "Multi-venue",
    market: "2 markets",
    modules: ["Liquidity source", "Dynamic leverage", "Redemption route", "Auto-compound", "Capital router"],
    params: [],
    lanes: ROUTED_LANES,
    router: {
      reactivity: "standard",
      maxConcentrationPct: 100,
      turnoverBudgetPctWeek: 100,
      ruleSentence: "",
      thresholdApy: 0.01508,
      rearmApy: -0.00492,
      sustainHours: 48,
      moveWeight: 1,
    },
    appliedLeverage: 2.5,
    liqLtv: LT,
    ...deriveHfBands("standard", 2.5, LT),
    exitRouteId: "instant-usdc",
    exitSettlementDays: 0,
    ...over,
  };
}

describe("deriveAutomations seats the redemption route", () => {
  it("on the routed record, off the lane's own exit, beside the loop's envelope", () => {
    const a = deriveAutomations(routedSource());
    expect(a.leverage?.targetLeverage).toBe(2.5);
    expect(a.router).not.toBeNull();
    const r = a.redemption!;
    expect(r.venue).toBe(RESERVE_LIQUIDITY_VENUE);
    expect(r.laneLabel).toBe("USDC lending");
    expect(r.venueLabel).toBe("Aave v3 · Base");
    expect(r.marketUrl).toContain("app.aave.com/reserve-overview");
    expect(r.routeLabel).toBe("Withdraw to USDC");
    expect(r.settlementDays).toBe(0);
    expect(r.settlementText).toBe("same day");
    expect(r.minUsd).toBeNull();
    expect(r.limitUsd).toBeNull();
    expect(r.window).toBeNull();
    expect(r.reading).toBe("stated");
    expect(r.source).toContain("Aave v3 withdraw");
  });

  it("on a single treasury lane, off the record's own pair and its venue label", () => {
    const a = deriveAutomations({
      strategy: "treasury",
      venue: "Aave v3 · Base",
      market: "USDC",
      modules: ["Liquidity source", "Redemption route"],
      params: [],
      exitRouteId: "instant-usdc",
      exitSettlementDays: 0,
    });
    expect(a.leverage).toBeNull();
    expect(a.router).toBeNull();
    expect(a.redemption?.venue).toBe(RESERVE_LIQUIDITY_VENUE);
    expect(a.redemption?.laneLabel).toBeNull();
    expect(a.redemption?.routeLabel).toBe("Withdraw to USDC");
  });

  it("not without the module, and not without a route", () => {
    expect(deriveAutomations(routedSource({ modules: ["Liquidity source", "Capital router"] })).redemption).toBeNull();
    expect(
      deriveAutomations(
        routedSource({
          lanes: ROUTED_LANES.map((l) => ({ ...l, exit: null })),
          exitRouteId: null,
          exitSettlementDays: null,
        }),
      ).redemption,
    ).toBeNull();
  });

  it("keeps the record's own route where the issuer lists no such door", () => {
    const lanes = ROUTED_LANES.map((l) =>
      l.family === "treasury" ? { ...l, exit: { routeId: "issuer-wire", routeLabel: "Issuer wire", settlementDays: 1 } } : l,
    );
    const r = deriveAutomations(routedSource({ lanes })).redemption!;
    expect(r.routeId).toBe("issuer-wire");
    expect(r.routeLabel).toBe("Issuer wire");
    expect(r.settlementText).toBe("1 business day");
    expect(r.source).toBeNull();
  });
});

describe("the venue lookup and the window text", () => {
  it("resolves the slug and the label to the same issuer", () => {
    expect(issuerRedemptionByVenue("treasury-ausdc-base")?.venue).toBe("treasury-ausdc-base");
    expect(issuerRedemptionByVenue("Aave v3 · Base")?.venue).toBe("treasury-ausdc-base");
    expect(issuerRedemptionByVenue("morpho-blue-base")).toBeNull();
    expect(issuerRedemptionByVenue("")).toBeNull();
  });

  it("spells the window the way the risk table does", () => {
    expect(settlementWindowText(0)).toBe("same day");
    expect(settlementWindowText(1)).toBe("1 business day");
    expect(settlementWindowText(5)).toBe("5 business days");
  });
});

function ascendingUnique(dates: readonly string[]): boolean {
  return dates.every((d, i) => i === 0 || d > (dates[i - 1] ?? ""));
}

describe("the two measured series", () => {
  it("the reserve's liquidity is the router capture's own, to the instant and to the day", () => {
    expect(LANE_HISTORY_CAPTURED_AT.reserveLiquidity).toBe(ROUTER_HISTORY_CAPTURED_AT);
    expect(reserveLiquidityLatest()?.date).toBe(routerLastAlignedDay()?.date);
    expect(RESERVE_LIQUIDITY_BY_DAY).toHaveLength(92);
    expect(ascendingUnique(RESERVE_LIQUIDITY_BY_DAY.map((r) => r.date))).toBe(true);
    for (const r of RESERVE_LIQUIDITY_BY_DAY) {
      expect(Number.isInteger(r.usd)).toBe(true);
      expect(r.usd).toBeGreaterThan(0);
    }
    expect(reserveLiquiditySeries()).toHaveLength(92);
    expect(reserveLiquidityLow()!.usd).toBeLessThanOrEqual(reserveLiquidityLatest()!.usd);
  });

  it("the pair's price covers the same window, and its drift starts at zero", () => {
    expect(COLLATERAL_PRICE_BY_DAY[0]?.date).toBe(RESERVE_LIQUIDITY_BY_DAY[0]?.date);
    expect(COLLATERAL_PRICE_BY_DAY[COLLATERAL_PRICE_BY_DAY.length - 1]?.date).toBe(
      RESERVE_LIQUIDITY_BY_DAY[RESERVE_LIQUIDITY_BY_DAY.length - 1]?.date,
    );
    expect(ascendingUnique(COLLATERAL_PRICE_BY_DAY.map((r) => r.date))).toBe(true);
    for (const r of COLLATERAL_PRICE_BY_DAY) {
      expect(r.price).toBeGreaterThan(0.99);
      expect(r.price).toBeLessThan(1.01);
    }
    const d = collateralDrift()!;
    expect(d.days).toBe(92);
    expect(d.points[0]?.drift).toBe(0);
    expect(d.worst.drift).toBeLessThanOrEqual(0);
    expect(d.worst.drift).toBeGreaterThan(-0.01);
  });
});

describe("the two cards' readouts", () => {
  it("the redemption card, on the reserve", () => {
    const r = deriveAutomations(routedSource()).redemption!;
    const read = redemptionReadout(r, 500, "loop");
    expect(read.kicker).toBe("Aave v3 · Exit");
    expect(read.role).toBe("Leaves the USDC lending lane by its published route.");
    expect(read.settlementText).toBe("same day");
    expect(read.provenance).toBe("stated");
    expect(read.readingLine).toContain("Withdraw to USDC");
    expect(read.readingLine).toContain("unborrowed in the reserve, measured Sep 7, 2026");
    expect(read.strip?.series).toHaveLength(92);
    expect(read.strip?.label).toContain(fmtCapacityUsd(reserveLiquidityLow()!.usd));
    expect(read.strip?.label).toContain("book $500");
    expect(read.rows.map((row) => row.act)).toEqual(["Withdraw to USDC", "Withdraw, then rebuild the loop"]);
    expect(read.rows[0]?.lit).toBe(true);
    expect(read.foot.map((f) => f.k)).toEqual(["Route", "Settlement", "Minimum", "Daily limit", "Unborrowed", "Reserve"]);
    expect(read.foot.find((f) => f.k === "Reserve")?.href).toContain("proto_base_v3");
    const all = JSON.stringify(read);
    expect(all).not.toContain("—");
    expect(all).not.toContain("Prime");
  });

  it("the redemption card, on a single lane off the reserve, prints one row and no strip", () => {
    const r = { ...deriveAutomations(routedSource()).redemption!, venue: "treasury-buidl-ethereum", laneLabel: null };
    const read = redemptionReadout(r, 25_000, null);
    expect(read.strip).toBeNull();
    expect(read.rows).toHaveLength(1);
    expect(read.role).toBe("Leaves the position by its published route.");
    expect(read.readingLine).toBe("Withdraw to USDC · runs continuously");
    expect(read.foot.map((f) => f.k)).toEqual(["Route", "Settlement", "Minimum", "Daily limit", "Reserve"]);
  });

  it("the drift strip under the envelope names the window, the worst day and the trigger", () => {
    const hero = heroRecord();
    const automations = deriveAutomations(hero);
    const strip = leverageDriftStrip({ ...hero, automations }, automations.leverage!)!;
    expect(strip.series).toHaveLength(92);
    expect(strip.series[0]).toBe(0);
    expect(strip.label).toMatch(/^USDe\/USDC, 92 days from Jun 8, 2026 · worst day −\d\.\d\dpp · trim after \d+\.\d\dpp$/);
  });

  it("and draws nothing off the captured pair", () => {
    const hero = heroRecord();
    const automations = deriveAutomations(hero);
    expect(leverageDriftStrip({ ...hero, market: "wstETH/WETH", automations }, automations.leverage!)).toBeNull();
  });
});
