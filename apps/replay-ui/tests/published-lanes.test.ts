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
  DEMO_SUSTAIN_HOURS,
  DEMO_UPGRADE_REARM,
  DEMO_UPGRADE_THRESHOLD,
} from "@/lib/canvas/orchestrator/demo-rules";
import { publishedRouter, type PublishedLane } from "@/lib/canvas/published-lanes";
import {
  FLOOR_PAIR_MAX_CONCENTRATION_PCT,
  FLOOR_PAIR_MOVE_WEIGHT,
  FLOOR_PAIR_TURNOVER_PCT_WEEK,
} from "@/lib/canvas/floor-pair";
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
    venueLabel: "Aave v3 · Base",
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

  it("carries the reactivity dial and the SWITCH's own band and budget (G1)", () => {
    /* The record publishes the machine it runs. The reactivity dial is still
       the user's, because it scales the cooldown and the cooldown is
       unchanged; the concentration ceiling and the weekly budget are the
       switch's, because between a lane and its floor the band is [0, 1] and
       the week admits one full move. A record publishing a 60% ceiling over a
       machine that evacuates would state a policy the vault does not keep. */
    const r = publishedRouter(ORCH_DIAL_DEFAULTS, LANES)!;
    expect(r.reactivity).toBe(ORCH_DIAL_DEFAULTS.reactivity);
    expect(r.maxConcentrationPct).toBe(FLOOR_PAIR_MAX_CONCENTRATION_PCT);
    expect(r.turnoverBudgetPctWeek).toBe(FLOOR_PAIR_TURNOVER_PCT_WEEK);
    expect(r.maxConcentrationPct).not.toBe(ORCH_DIAL_DEFAULTS.maxConcentrationPct);
  });

  it("carries the four rule constants from their owners, none of them typed", () => {
    const r = publishedRouter(ORCH_DIAL_DEFAULTS, LANES)!;
    expect(r.thresholdApy).toBe(DEMO_UPGRADE_THRESHOLD);
    expect(r.rearmApy).toBe(DEMO_UPGRADE_REARM);
    expect(r.sustainHours).toBe(DEMO_SUSTAIN_HOURS);
    expect(r.moveWeight).toBe(FLOOR_PAIR_MOVE_WEIGHT);
  });

  it("writes the store's own sentence, so the record and the page cannot disagree", () => {
    const r = publishedRouter(ORCH_DIAL_DEFAULTS, LANES)!;
    expect(r.ruleSentence).toBe(
      routerRuleSentence({
        lanes: LANES,
        thresholdApy: DEMO_UPGRADE_THRESHOLD,
        sustainHours: DEMO_SUSTAIN_HOURS,
        moveWeight: FLOOR_PAIR_MOVE_WEIGHT,
        maxConcentrationPct: FLOOR_PAIR_MAX_CONCENTRATION_PCT,
      }),
    );
    expect(r.ruleSentence).toContain(`for ${DEMO_SUSTAIN_HOURS} hours`);
    expect(r.ruleSentence).toContain(`${(DEMO_UPGRADE_THRESHOLD * 100).toFixed(2)}pp`);
  });

  it("says `everything` and states no size, because there is no longer one", () => {
    /* Under the switch the move is the whole lane, so a size clause would be
       a second number for a thing the verb already states. `routerMaxMoveFrac`
       is still the owner of what a firing carries from an even split, and the
       Parameters row is where it prints. */
    const r = publishedRouter(ORCH_DIAL_DEFAULTS, LANES)!;
    const admitted = routerMaxMoveFrac({
      lanes: LANES,
      moveWeight: FLOOR_PAIR_MOVE_WEIGHT,
      maxConcentrationPct: FLOOR_PAIR_MAX_CONCENTRATION_PCT,
    });
    expect(admitted).toBe(0.5);
    expect(r.ruleSentence).toContain("Moves everything to");
    expect(r.ruleSentence).not.toContain("pp of the book");
  });

  it("holds no em dash and no second spelling of the mechanism", () => {
    const r = publishedRouter(ORCH_DIAL_DEFAULTS, LANES)!;
    expect(r.ruleSentence).not.toContain("—");
    expect(r.ruleSentence).not.toContain("relocat");
    expect(r.ruleSentence).not.toContain("unwinds");
    expect(r.ruleSentence).not.toContain("Prime");
  });
});
