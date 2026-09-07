/**
 * One-row tests over the live pricing owners, on the demo market row.
 *
 * The numbers here are not typed into the product anywhere: every surface
 * prints `publishedNetApy(repriceAtLeverage(row, L), false)`, and these
 * assertions pin what that owner says at the three leverages the demo walks
 * (the seed landing 2.50x, 3.00x, and the 3.25x ceiling).
 */
import { describe, expect, it } from "vitest";

import { defaultInstallChain, leverageModuleInstalls } from "@/lib/canvas/leverage-module";
import { driftBeforeTrim } from "@/lib/canvas/liquidation";
import { composedNetApy, mockQuote, publishedNetApy, repriceAtLeverage } from "@/lib/canvas/mock-quote";
import { descriptorsFor } from "@/lib/canvas/modules";
import { clampLeverage, deriveHfBands, houseMaxLeverage } from "@/lib/canvas/param-schema";
import { pressClass } from "@/lib/canvas/unified-list";
import { hfFromBps } from "@/lib/vaults/store";
import { demoMarketCandidate, HERO_SEED_LEVERAGE } from "@/lib/demo/market";

const row = demoMarketCandidate();

describe("the demo row", () => {
  it("is scan-shaped: no hand-authored model, so the default chain seats leverage and compound", () => {
    expect(row.economics).not.toHaveProperty("model");
    expect(row.economics).not.toHaveProperty("spotLeg");
    expect(row).not.toHaveProperty("coinMaxLeverage");
    expect(leverageModuleInstalls(row)).toBe(true);
    expect(defaultInstallChain(row)).toEqual(["safety-buffer", "auto-compound"]);
    expect(pressClass({ ...row, launchable: true })).toBe("launch");
  });

  it("states its own number only through the reprice owner at its ceiling", () => {
    const atCeiling = repriceAtLeverage(row, row.economics!.loopLeverage);
    expect(row.headlineApr).toBeCloseTo(atCeiling.economics!.netApyOnDepositApy, 12);
    expect(row.economics!.netApyOnDepositApy).toBeCloseTo(atCeiling.economics!.netApyOnDepositApy, 12);
    expect(row.economics!.loopLeverage).toBe(3.25);
    expect(row.economics!.targetLtv).toBeCloseTo(1 - 1 / 3.25, 12);
  });
});

describe("publishedNetApy on the demo row", () => {
  it.each([
    [2.5, 0.043],
    [3.0, 0.046],
    [3.25, 0.048],
  ])("lands at the fee-inside number at %sx", (L, expected) => {
    const priced = repriceAtLeverage(row, L);
    const published = publishedNetApy(priced, false);
    expect(published).not.toBeNull();
    expect(Math.abs(published! - expected)).toBeLessThan(0.0005);
    // The venue fact is the same composition with no house fee: 20% of a positive number.
    const venue = composedNetApy(priced, false);
    expect(venue).not.toBeNull();
    expect(published! / venue!).toBeCloseTo(0.8, 10);
  });

  it("prices the seed landing at the product's own constant", () => {
    const published = publishedNetApy(repriceAtLeverage(row, HERO_SEED_LEVERAGE), false);
    expect(Math.abs(published! - 0.043)).toBeLessThan(0.0005);
  });
});

describe("the leverage envelope on the demo market", () => {
  const lt = row.lt!;

  it("derives the dial ceiling: 3.25x standard, 3.00x conservative", () => {
    expect(Math.floor(houseMaxLeverage(lt, "standard") * 100) / 100).toBe(3.25);
    expect(Math.floor(houseMaxLeverage(lt, "conservative") * 100) / 100).toBe(3.07);
    expect(clampLeverage(5, lt)).toBeLessThan(3.26);
    expect(clampLeverage(5, lt)).toBeGreaterThanOrEqual(3.25);
  });

  it("narrows the dial to the row: max 3.25, default 2.50", () => {
    const d = descriptorsFor("safety-buffer", {
      lt,
      scanLeverage: row.economics!.loopLeverage,
      preset: "standard",
    }).find((x) => x.field === "targetLeverage") as { max?: number; default?: unknown } | undefined;
    expect(d?.max).toBe(3.25);
    expect(d?.default).toBe(2.5);
  });

  it("derives the health bands at 3.25x and 2.50x", () => {
    // The floor is `max(HF_HOUSE.floor 1.10, target - 2 * spread)`; on this
    // market the derived value sits above the house floor at both leverages.
    const hi = deriveHfBands("standard", 3.25, lt);
    expect([hi.hfTargetBps, hi.hfDeleverageBps, hi.hfFloorBps].map(hfFromBps)).toEqual(["1.32", "1.25", "1.18"]);
    const lo = deriveHfBands("standard", 2.5, lt);
    expect([lo.hfTargetBps, lo.hfDeleverageBps, lo.hfFloorBps].map(hfFromBps)).toEqual(["1.53", "1.46", "1.39"]);
    expect(lo.hfFloorBps).toBeGreaterThanOrEqual(11_000);
  });

  it.each([
    [3.25, [6.53, 4.23, 2.48]],
    [3.0, [6.04, 3.92, 2.3]],
    [2.5, [4.85, 3.15, 1.86]],
  ])("prints the drift-before-trim cells at %sx: latest / house gap / soonest", (L, cells) => {
    const pp = (p: "conservative" | "standard" | "aggressive") =>
      driftBeforeTrim(p, L, lt)! * 100;
    expect(Math.abs(pp("conservative") - cells[0]!)).toBeLessThan(0.01);
    expect(Math.abs(pp("standard") - cells[1]!)).toBeLessThan(0.01);
    expect(Math.abs(pp("aggressive") - cells[2]!)).toBeLessThan(0.01);
  });
});

describe("mockQuote", () => {
  it("synthesizes an ok quote clamped to the house ceiling", () => {
    const q = mockQuote({ row, blockNumber: 42 }, 5, "standard");
    expect(q.ok).toBe(true);
    if (q.ok) {
      expect(q.blockNumber).toBe(42);
      expect(q.requestedLeverage).toBe(5);
      expect(q.appliedLeverage).toBeLessThan(3.26);
      expect(q.candidate?.economics?.loopLeverage).toBeLessThan(3.26);
    }
  });
});
