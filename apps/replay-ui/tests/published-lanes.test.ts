/**
 * WHAT A TWO-LANE PUBLISH WRITES ONTO THE RECORD (router lane plan R5, seam 1).
 *
 * The shapes are `lib/vaults/store.ts`'s: integration collapsed the canvas's
 * parallel declaration into the store's, so these assertions are the contract
 * BOTH halves are held to. The field names, the units, and the one thing that
 * must never be true of them, which is that a figure here was retyped rather
 * than read from the owner that produces it on screen.
 */
import { describe, expect, it } from "vitest";

import { ORCH_DIAL_DEFAULTS } from "@/lib/canvas/param-schema";
import {
  DEMO_ROUTER_MOVE_WEIGHT,
  DEMO_SUSTAIN_HOURS,
  DEMO_UPGRADE_REARM,
  DEMO_UPGRADE_THRESHOLD,
} from "@/lib/canvas/orchestrator/demo-rules";
import { publishedRouter, type PublishedLane } from "@/lib/canvas/published-lanes";
import { routerMaxMoveFrac, routerRuleSentence } from "@/lib/vaults/store";

/** The two lanes the demo publishes, in the canvas's own publish order. */
const LANES: PublishedLane[] = [
  {
    venue: "morpho-blue-base",
    venueLabel: "Morpho Blue · Base",
    market: "USDe/USDC",
    label: "Leveraged loop",
    family: "loop",
    publishedApy: 0.0307572,
    allocationBps: 5000,
  },
  {
    venue: "treasury-ausdc-base",
    venueLabel: "Aave USDC · Base",
    market: "USDC reserve",
    label: "USDC lending",
    family: "treasury",
    publishedApy: 0.0297088,
    allocationBps: 5000,
  },
];

describe("publishedRouter", () => {
  it("is absent on a single-lane publish, so an old record is byte for byte itself", () => {
    expect(publishedRouter(ORCH_DIAL_DEFAULTS, LANES.slice(0, 1))).toBeNull();
    expect(publishedRouter(ORCH_DIAL_DEFAULTS, [])).toBeNull();
  });

  it("carries the three dials verbatim, never a re-derivation of them", () => {
    const r = publishedRouter(ORCH_DIAL_DEFAULTS, LANES)!;
    expect(r.reactivity).toBe(ORCH_DIAL_DEFAULTS.reactivity);
    expect(r.maxConcentrationPct).toBe(ORCH_DIAL_DEFAULTS.maxConcentrationPct);
    expect(r.turnoverBudgetPctWeek).toBe(ORCH_DIAL_DEFAULTS.turnoverBudgetPctWeek);
  });

  it("carries the four rule constants from their owners, none of them typed", () => {
    const r = publishedRouter(ORCH_DIAL_DEFAULTS, LANES)!;
    expect(r.thresholdApy).toBe(DEMO_UPGRADE_THRESHOLD);
    expect(r.rearmApy).toBe(DEMO_UPGRADE_REARM);
    expect(r.sustainHours).toBe(DEMO_SUSTAIN_HOURS);
    expect(r.moveWeight).toBe(DEMO_ROUTER_MOVE_WEIGHT);
  });

  it("writes the store's own sentence, so the record and the page cannot disagree", () => {
    const r = publishedRouter(ORCH_DIAL_DEFAULTS, LANES)!;
    expect(r.ruleSentence).toBe(
      routerRuleSentence({
        lanes: LANES,
        thresholdApy: DEMO_UPGRADE_THRESHOLD,
        sustainHours: DEMO_SUSTAIN_HOURS,
        moveWeight: DEMO_ROUTER_MOVE_WEIGHT,
        maxConcentrationPct: ORCH_DIAL_DEFAULTS.maxConcentrationPct,
      }),
    );
    expect(r.ruleSentence).toContain(`for ${DEMO_SUSTAIN_HOURS} hours`);
    expect(r.ruleSentence).toContain(`${(DEMO_UPGRADE_THRESHOLD * 100).toFixed(2)}pp`);
  });

  it("states the size the band admits, not the dial the band refuses", () => {
    const r = publishedRouter(ORCH_DIAL_DEFAULTS, LANES)!;
    const admitted = routerMaxMoveFrac({
      lanes: LANES,
      moveWeight: DEMO_ROUTER_MOVE_WEIGHT,
      maxConcentrationPct: ORCH_DIAL_DEFAULTS.maxConcentrationPct,
    });
    expect(admitted).toBeLessThan(DEMO_ROUTER_MOVE_WEIGHT);
    expect(r.ruleSentence).toContain(`${(admitted * 100).toFixed(1)}pp`);
    expect(r.ruleSentence).not.toContain(`${(DEMO_ROUTER_MOVE_WEIGHT * 100).toFixed(1)}pp`);
  });

  it("holds no em dash and no second spelling of the mechanism", () => {
    const r = publishedRouter(ORCH_DIAL_DEFAULTS, LANES)!;
    expect(r.ruleSentence).not.toContain("—");
    expect(r.ruleSentence).not.toContain("relocat");
    expect(r.ruleSentence).not.toContain("unwinds");
    expect(r.ruleSentence).not.toContain("Prime");
  });
});
