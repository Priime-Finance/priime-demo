/**
 * RECETTE MATRIX for the router lane (Fable, 2026-09-07). Headless half of
 * docs/plans/ROUTER_RECETTE.md: M1 route regimes, M2 rules, M3 review gating
 * over every live-module subset, M5 copilot scope strings, M6 series owners.
 * Postconditions in the user's frame, never success signals.
 */
import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/canvas/orchestrate/route";
import { REGIME_IDS, DEFAULT_REGIME } from "@/lib/canvas/scenario/regime-ids";
import { DEMO_SCOPE, COPILOT_REJECT_COMING_SOON, isLiveModule, isLiveMarket } from "@/lib/demo-scope";
import { deriveReviewGate } from "@/lib/canvas/review-gating";
import { DEMO_COPILOT_SYSTEM_PROMPT, mapRejectReason } from "@/lib/canvas/copilot/scope";
import { loopPublishedApyByDay, floorPublishedApyByDay, routerPublishedToday, routerLastAlignedDay } from "@/lib/canvas/router-history";
import { DEMO_SUSTAIN_PINS_DAILY, DEMO_SUSTAIN_PINS_HOURLY, DEMO_UPGRADE_THRESHOLD } from "@/lib/canvas/orchestrator/demo-rules";

const RUN_KEYS = ["regime", "regimeLabel", "scenario", "rulesHash", "orchestratedTvlUsd", "dials", "lanes", "laneSeries", "decisions", "receipts", "legs", "refusals", "weights", "weightSumByTick", "earningWeightByTick", "budgetByTick", "moves", "firings"];

describe("M1 the route answers every regime with the panel's shape", () => {
  for (const regime of REGIME_IDS) {
    it(`regime ${regime}`, async () => {
      const res = GET(new Request(`http://x/api/canvas/orchestrate?regime=${regime}`));
      expect(res.status).toBe(200);
      const j = (await res.json()) as Record<string, unknown>;
      expect(j.ok).toBe(true);
      expect(j.modeled).toBe(true);
      for (const k of RUN_KEYS) expect(j, k).toHaveProperty(k);
      const sums = j.weightSumByTick as number[];
      expect(sums.length).toBeGreaterThan(10);
      for (const s of sums) expect(Math.abs(s - 1)).toBeLessThan(1e-9);
      const lanes = j.lanes as { slotId: string }[];
      expect(lanes.map((l) => l.slotId).sort()).toEqual(["floor", "loop"]);
      const refusals = j.refusals as { code: string }[];
      for (const r of refusals) expect(["budget", "payback", "dust", "edge-lock", "no-destination", "weight-band", "no-endpoint"]).toContain(r.code);
    });
  }
  it("an unknown regime falls to the default, never a 500", async () => {
    const res = GET(new Request("http://x/api/canvas/orchestrate?regime=nope"));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { regime: string }).regime).toBe(DEFAULT_REGIME);
  });
});

describe("M2 the 48-hour rule has one owner", () => {
  it("48h is 2 daily pins and 48 hourly pins", () => {
    expect(DEMO_SUSTAIN_PINS_DAILY).toBe(2);
    expect(DEMO_SUSTAIN_PINS_HOURLY).toBe(48);
  });
  it("the bar is a finite fraction under 5pp", () => {
    expect(DEMO_UPGRADE_THRESHOLD).toBeGreaterThan(0);
    expect(DEMO_UPGRADE_THRESHOLD).toBeLessThan(0.05);
  });
});

describe("M3 review gating over every live-module subset", () => {
  const live = DEMO_SCOPE.liveModules;
  const subsets: string[][] = [];
  for (let m = 1; m < 1 << live.length; m += 1) subsets.push(live.filter((_, i) => m & (1 << i)));
  it(`${subsets.length} subsets each arm or refuse with a reason`, () => {
    for (const placed of subsets) {
      const gate = deriveReviewGate({ validationOk: true, lanes: [{ laneReviewable: true, eligible: true, hasMarket: true, placed } as never], orchOn: false, launchShapedCount: 1 });
      expect(typeof gate.armed).toBe("boolean");
      if (!gate.armed) expect(gate.reason.length).toBeGreaterThan(0);
    }
  });
  it("a coming-soon module refuses with the register's own reason", () => {
    const gate = deriveReviewGate({ validationOk: true, lanes: [{ laneReviewable: true, eligible: true, hasMarket: true, placed: ["liquidity-source", "hedge"] } as never], orchOn: false, launchShapedCount: 1 });
    expect(gate.armed).toBe(false);
    expect(isLiveModule("hedge")).toBe(false);
  });
});

describe("M5 the copilot's register", () => {
  it("names both live lanes and refuses the rest with one sentence", () => {
    expect(DEMO_COPILOT_SYSTEM_PROMPT).toMatch(/USDe\/USDC/);
    expect(DEMO_COPILOT_SYSTEM_PROMPT).toMatch(/Aave/);
    /* No figure is typed into the prompt (the numbers travel in the context);
       the rule is named by its owners' words. */
    expect(DEMO_COPILOT_SYSTEM_PROMPT).toMatch(/published bar for the published window/);
    expect(DEMO_COPILOT_SYSTEM_PROMPT).not.toMatch(/—/);
    expect(mapRejectReason("unknown market id")).toContain("coming soon");
    expect(COPILOT_REJECT_COMING_SOON).toMatch(/coming soon/);
    expect(isLiveMarket(DEMO_SCOPE.liveMarketIds[1])).toBe(true);
  });
});

describe("M6 the published series and today's pair have one owner", () => {
  it("today equals the last aligned day of both series", () => {
    const day = routerLastAlignedDay();
    expect(day).not.toBeNull();
    const loop = loopPublishedApyByDay();
    const floor = floorPublishedApyByDay();
    const today = routerPublishedToday();
    expect(today).not.toBeNull();
    expect(loop[loop.length - 1].date).toBe(day!.date);
    expect(floor[floor.length - 1].date).toBe(day!.date);
    expect(today!.loop).toBeCloseTo(loop[loop.length - 1].apy, 12);
    expect(today!.floor).toBeCloseTo(floor[floor.length - 1].apy, 12);
  });
});
