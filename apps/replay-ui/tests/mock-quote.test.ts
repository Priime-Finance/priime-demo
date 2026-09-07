/**
 * One-row tests over the live pricing owners, on the demo market row.
 *
 * The numbers here are not typed into the product anywhere: every surface
 * prints `publishedNetApy(repriceAtLeverage(row, L), false)`, and these
 * assertions pin what that owner says at the three leverages the demo walks
 * (the seed landing 2.50x, 3.00x, and the 3.25x ceiling).
 *
 * ══ THE ROW'S RATES ARE TYPED INPUTS (G3, 2026-09-07) ════════════════════
 * They were briefly the capture's last aligned day, which published 3.08% at
 * the seed landing and made leverage SUBTRACT on this row. That is reverted:
 * `0.044` / `0.035`, the pair captured before the router, and the row publishes
 * 4.3% at 2.50x again. The MEASURED series is `router-history.ts` and the
 * router reads it day by day; the two numbers answer different questions and
 * every surface labels which one it is printing (G3), so nothing is welded and
 * nothing is re-typed to match.
 *
 * The published series on this row, all four stops, for a reader:
 *   1.00x  composed 4.00%  published 3.20%
 *   2.50x  composed 5.35%  published 4.28%
 *   3.00x  composed 5.80%  published 4.64%
 *   3.25x  composed 6.02%  published 4.82%
 * It RISES in leverage, which is why `Install defaults` seats Dynamic leverage
 * and why the demo has an opening move at all. See the install-chain test.
 */
import { describe, expect, it } from "vitest";

import { defaultInstallChain, leverageModuleInstalls } from "@/lib/canvas/leverage-module";
import { driftBeforeTrim } from "@/lib/canvas/liquidation";
import { composedNetApy, mockQuote, publishedNetApy, repriceAtLeverage } from "@/lib/canvas/mock-quote";
import { descriptorsFor } from "@/lib/canvas/modules";
import { clampLeverage, deriveHfBands, houseMaxLeverage } from "@/lib/canvas/param-schema";
import { pressClass } from "@/lib/canvas/unified-list";
import { hfFromBps } from "@/lib/vaults/store";
import { routerPublishedToday } from "@/lib/canvas/router-history";
import { demoMarketCandidate, HERO_SEED_LEVERAGE } from "@/lib/demo/market";

const row = demoMarketCandidate();

describe("the demo row", () => {
  it("is scan-shaped: no hand-authored model, and it presses as a launch row", () => {
    expect(row.economics).not.toHaveProperty("model");
    expect(row.economics).not.toHaveProperty("spotLeg");
    expect(row).not.toHaveProperty("coinMaxLeverage");
    expect(pressClass({ ...row, launchable: true })).toBe("launch");
  });

  /* THE DEMO'S OPENING MOVE, PINNED (G3, item 8a). `Install defaults` seats
     Dynamic leverage and Auto-compound, which is the one live workflow the
     founder signed off. It is a property of the ROW: `leverageModuleInstalls`
     asks whether an extra turn models more yield, and on a typed 4.4% yield
     against a typed 3.5% borrow it does. Substituting the capture's last day
     (4.75% against 5.0869%) inverted that and emptied the chain, which is
     exactly why the substitution was reverted. */
  it("seats Dynamic leverage on Install defaults, because the typed yield is above the typed borrow", () => {
    const e = row.economics!;
    expect(e.collateralYieldApy).toBeGreaterThan(e.borrowApyMarginal);
    expect(leverageModuleInstalls(row)).toBe(true);
    expect(defaultInstallChain(row)).toEqual(["safety-buffer", "auto-compound"]);
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
    [2.5, 0.0428],
    [3.0, 0.0464],
    [3.25, 0.0482],
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

  it("rises in leverage on the typed pair, which is why the dial is offered", () => {
    const at = (L: number) => publishedNetApy(repriceAtLeverage(row, L), false)!;
    expect(at(1)).toBeLessThan(at(2.5));
    expect(at(2.5)).toBeLessThan(at(3));
    expect(at(3)).toBeLessThan(at(3.25));
  });

  it("is NOT the router's own loop number, and each says which question it answers", () => {
    /* G3, and it is the whole point of two labels. The hero prints the record's
       own number: the typed row at the stored leverage, `modeled`. The router
       instrument prints the loop's rate for the latest captured day,
       `measured` with that date. Neither is re-typed to match the other, and a
       test that asserted they were equal was asserting the weld this ruling
       removed. */
    const published = publishedNetApy(repriceAtLeverage(row, HERO_SEED_LEVERAGE), false)!;
    const measured = routerPublishedToday()!.loop!;
    expect(published).toBeCloseTo(0.0428, 4);
    expect(measured).toBeCloseTo(0.0308, 4);
    expect(published).not.toBe(measured);
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
