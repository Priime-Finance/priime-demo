/**
 * WHAT A TWO-LANE PUBLISH WRITES ONTO THE RECORD (router lane plan R5, seam 1).
 *
 * The shapes are WP-1's until `lib/vaults/store.ts` (WP-3) declares them, so
 * these assertions are the contract integration reconciles the two halves
 * against: the field names, the units, and the one thing that must never be
 * true of them, which is that a figure here was retyped rather than read from
 * the owner that produces it on screen.
 */
import { describe, expect, it } from "vitest";

import { ORCH_DIAL_DEFAULTS } from "@/lib/canvas/param-schema";
import {
  DEMO_SUSTAIN_HOURS,
  DEMO_SUSTAIN_PINS_HOURLY,
  DEMO_UPGRADE_THRESHOLD,
} from "@/lib/canvas/orchestrator/demo-rules";
import type { LoopSlot } from "@/lib/canvas/orchestrator/types";
import { publishedRouter } from "@/lib/canvas/published-lanes";
import { FLOOR_MARKET_ID, HERO_MARKET_ID } from "@/lib/demo-scope";

/** The two lanes the demo publishes, in the shape `slotsFromPortfolio` builds. */
const SLOTS: LoopSlot[] = [
  {
    slotId: "loop_1",
    venue: "morpho-blue-base",
    candidateId: HERO_MARKET_ID,
    marketKey: "USDe/USDC",
    cls: "N1",
    targetWeight: 0.5,
    minWeight: 0.4,
    maxWeight: 0.6,
    screenedAtApy: null,
    metrics: { funding: false, basis: false },
  } as LoopSlot,
  {
    slotId: "loop_2",
    venue: "treasury-ausdc-base",
    candidateId: FLOOR_MARKET_ID,
    marketKey: "aUSDC",
    cls: "N1",
    targetWeight: 0.5,
    minWeight: 0.4,
    maxWeight: 0.6,
    screenedAtApy: null,
    metrics: { funding: false, basis: false },
  } as LoopSlot,
];

describe("publishedRouter", () => {
  it("is absent on a single-lane publish, so an old record is byte for byte itself", () => {
    expect(publishedRouter(ORCH_DIAL_DEFAULTS, SLOTS.slice(0, 1))).toBeNull();
    expect(publishedRouter(ORCH_DIAL_DEFAULTS, [])).toBeNull();
  });

  it("carries the three dials verbatim, never a re-derivation of them", () => {
    const r = publishedRouter(ORCH_DIAL_DEFAULTS, SLOTS)!;
    expect(r.reactivity).toBe(ORCH_DIAL_DEFAULTS.reactivity);
    expect(r.maxConcentrationPct).toBe(ORCH_DIAL_DEFAULTS.maxConcentrationPct);
    expect(r.turnoverBudgetPctWeek).toBe(ORCH_DIAL_DEFAULTS.turnoverBudgetPctWeek);
  });

  it("states the founder's 48 hours on the clock a PUBLISHED vault runs", () => {
    const r = publishedRouter(ORCH_DIAL_DEFAULTS, SLOTS)!;
    // The record describes the live handler, which lands hourly, not the
    // modeled replay's daily cadence.
    expect(r.sustainPins).toBe(DEMO_SUSTAIN_PINS_HOURLY);
    expect(DEMO_SUSTAIN_PINS_HOURLY).toBe(DEMO_SUSTAIN_HOURS);
    for (const s of r.ruleSentences) expect(s).toContain(`for ${DEMO_SUSTAIN_PINS_HOURLY} scans`);
  });

  it("decodes one upgrade sentence per lane, at the quant's own threshold", () => {
    const r = publishedRouter(ORCH_DIAL_DEFAULTS, SLOTS)!;
    expect(r.ruleSentences).toHaveLength(SLOTS.length);
    expect(r.ruleSentences[0]!.startsWith("loop_1:")).toBe(true);
    expect(r.ruleSentences[1]!.startsWith("loop_2:")).toBe(true);
    /* THE BAR IS THE OWNER'S, printed at the decode's own precision. Typed as
       a derivation of `DEMO_UPGRADE_THRESHOLD` rather than as the string
       `3.0%`, so moving the threshold moves this assertion with it. */
    const bar = `above ${(DEMO_UPGRADE_THRESHOLD * 100).toFixed(1)}% APY`;
    for (const s of r.ruleSentences) expect(s).toContain(bar);
  });

  it("holds no em dash and no second spelling of the mechanism", () => {
    const r = publishedRouter(ORCH_DIAL_DEFAULTS, SLOTS)!;
    for (const s of r.ruleSentences) {
      expect(s).not.toContain("—");
      expect(s).not.toContain("relocat");
      expect(s).not.toContain("Prime");
    }
  });
});
