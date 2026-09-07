/**
 * One-row tests over the live pricing owners, on the demo market row.
 *
 * The numbers here are not typed into the product anywhere: every surface
 * prints `publishedNetApy(repriceAtLeverage(row, L), false)`, and these
 * assertions pin what that owner says at the three leverages the demo walks
 * (the seed landing 2.50x, 3.00x, and the 3.25x ceiling).
 *
 * ══ THE ROW'S RATES ARE MEASURED NOW (router lane WP-1, design item 1) ═════
 * The row carried `0.044` / `0.035` as literals and published 4.3% at the seed
 * landing; it reads the capture's last aligned day (`demoMarketRates`) and
 * publishes 3.08%. The pins below stopped being typed constants at the same
 * time: they are asserted against `routerPublishedToday`, the owner the router
 * instrument reads, so the canvas and the router can never open two frames on
 * one lane again.
 *
 * The published series on this row, all four stops, for a reader:
 *   1.00x  composed 4.35%  published 3.48%
 *   2.50x  composed 3.84%  published 3.08%
 *   3.00x  composed 3.68%  published 2.94%
 *   3.25x  composed 3.59%  published 2.87%
 * It DESCENDS in leverage, and that is the finding, not a defect: the measured
 * marginal borrow (5.0869%) is above the measured collateral yield (4.75%), so
 * every extra turn models less yield. See the install-chain test below.
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

  /* ⚠ THE CONSEQUENCE OF THE MEASURED PAIR, PINNED SO IT CANNOT PASS UNSEEN.
     -----------------------------------------------------------------------
     This test used to assert `defaultInstallChain(row)` equals
     `["safety-buffer", "auto-compound"]`, and lib/demo/market.ts's own
     docblock says the row is scan-shaped precisely so that `Install defaults`
     seats those two. With the measured rates the ghost-bay ruling withholds
     the leverage module: `leverageModuleInstalls` asks whether an extra turn
     of leverage MODELS MORE YIELD, and on borrow 5.0869% against yield 4.75%
     it does not. So the shelf offers Dynamic leverage under `Add anyway` with
     the two rates in its own reason line, and the builder seats it in one
     press; nothing is hidden and nothing is unreachable, but the DEFAULT
     composition is no longer levered.
     This is a founder-visible change to the demo's opening move and it is
     recorded in WP-1's report, not smoothed over here. */
  it("withholds the leverage module by default, because the measured borrow is above the measured yield", () => {
    const e = row.economics!;
    expect(e.borrowApyMarginal).toBeGreaterThan(e.collateralYieldApy);
    expect(leverageModuleInstalls(row)).toBe(false);
    expect(defaultInstallChain(row)).toEqual([]);
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
    [2.5, 0.0308],
    [3.0, 0.0294],
    [3.25, 0.0287],
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

  it("descends in leverage on the measured pair, which is why the dial is withheld", () => {
    const at = (L: number) => publishedNetApy(repriceAtLeverage(row, L), false)!;
    expect(at(1)).toBeGreaterThan(at(2.5));
    expect(at(2.5)).toBeGreaterThan(at(3));
    expect(at(3)).toBeGreaterThan(at(3.25));
  });

  it("prices the seed landing at the ROUTER's own loop number, to the last digit", () => {
    /* THE WELD (design item 1). Not a typed constant: the router instrument,
       the run panel, the published record and this row all read one number. */
    const published = publishedNetApy(repriceAtLeverage(row, HERO_SEED_LEVERAGE), false);
    expect(published).toBe(routerPublishedToday()!.loop);
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
