/**
 * The one owner of the live / coming soon register, and the surfaces in lib/
 * that read it.
 */
import { describe, expect, it } from "vitest";

import { feeRows, WITHDRAWAL_ATTESTED_LINE, withdrawalLine } from "@/lib/canvas/fees";
import { STRATEGIES } from "@/lib/canvas/graph-ops";
import { DISPLAY_ORDER } from "@/lib/canvas/modules";
import { VENUE_LABELS } from "@/lib/canvas/opportunities";
import { deriveReviewGate } from "@/lib/canvas/review-gating";
import { SHELF_COUNT_SCOPED } from "@/lib/canvas/shelf-count";
import {
  COMING_SOON,
  COPILOT_REJECT_COMING_SOON,
  DEMO_SCOPE,
  FLOOR_MARKET_ID,
  HERO_MARKET_ID,
  HERO_SLUG,
  isLiveMarket,
  isLiveModule,
  isLiveStrategy,
  isLiveVenue,
  REVIEW_REASON_COMING_SOON,
  shelfCountScoped,
} from "@/lib/demo-scope";
import { ROUTER_FLOOR_CANDIDATE_ID } from "@/lib/canvas/router-history";
import { TREASURY_CANDIDATES } from "@/lib/canvas/templates";
import { DEMO_MARKET_ID } from "@/lib/demo/market";
import { VAULT_STAGE_LABEL, VAULT_STAGE_NOUN, vaultStage } from "@/lib/vaults/store";

const EM_DASH = "—";

describe("the register", () => {
  it("names one live vault of two lanes", () => {
    expect(HERO_SLUG).toBe("verifiable-usde-loop");
    expect(HERO_MARKET_ID).toBe("morpho-blue-base:8453:USDe-USDC:0x54cf9be5");
    expect(FLOOR_MARKET_ID).toBe("template:treasury-floor:treasury-ausdc-base:ausdc");
    expect(DEMO_MARKET_ID).toBe(HERO_MARKET_ID);
    expect(DEMO_SCOPE).toEqual({
      liveMarketId: HERO_MARKET_ID,
      liveMarketIds: [HERO_MARKET_ID, FLOOR_MARKET_ID],
      liveVenues: ["morpho-blue-base", "treasury-ausdc-base"],
      liveModules: ["liquidity-source", "safety-buffer", "auto-compound", "redemption-route"],
      liveStrategies: ["loop", "treasury"],
      liveSlug: HERO_SLUG,
    });
  });

  it("keeps the floor id and the router's own spelling of it as one string", () => {
    expect(FLOOR_MARKET_ID).toBe(ROUTER_FLOOR_CANDIDATE_ID);
    expect(TREASURY_CANDIDATES.some((c) => c.id === FLOOR_MARKET_ID)).toBe(true);
  });

  it("spells its ids in the kit's own vocabulary", () => {
    for (const k of DEMO_SCOPE.liveModules) expect(DISPLAY_ORDER).toContain(k);
    for (const s of DEMO_SCOPE.liveStrategies) expect(STRATEGIES).toContain(s);
    for (const v of DEMO_SCOPE.liveVenues) expect(Object.keys(VENUE_LABELS)).toContain(v);
  });

  it("prints the label in sentence case, two words, no dot", () => {
    expect(COMING_SOON.label).toBe("Coming soon");
    expect(COMING_SOON.prose).toBe("coming soon");
  });

  it("answers the four predicates from the lists, never from a name", () => {
    expect(isLiveMarket(HERO_MARKET_ID)).toBe(true);
    expect(isLiveMarket(FLOOR_MARKET_ID)).toBe(true);
    expect(isLiveMarket("morpho-blue-base:8453:wstETH-WETH:0x0")).toBe(false);
    // The five other issuer rows stay coming soon (R1).
    expect(isLiveMarket("template:treasury-floor:treasury-buidl-ethereum:buidl")).toBe(false);
    expect(isLiveVenue("morpho-blue-base")).toBe(true);
    expect(isLiveVenue("treasury-ausdc-base")).toBe(true);
    expect(isLiveVenue("aave-v3-base")).toBe(false);
    expect(isLiveModule("safety-buffer")).toBe(true);
    expect(isLiveModule("redemption-route")).toBe(true);
    expect(isLiveModule("hedge")).toBe(false);
    expect(isLiveStrategy("loop")).toBe(true);
    expect(isLiveStrategy("treasury")).toBe(true);
    expect(isLiveStrategy("funding")).toBe(false);
  });

  it("carries no em dash and no dead number in any string", () => {
    for (const s of [
      COMING_SOON.label,
      COMING_SOON.prose,
      REVIEW_REASON_COMING_SOON,
      COPILOT_REJECT_COMING_SOON,
      SHELF_COUNT_SCOPED,
      WITHDRAWAL_ATTESTED_LINE,
    ]) {
      expect(s).not.toContain(EM_DASH);
      expect(s).not.toMatch(/5\.0x|1\.08x|0\.25%|\$50M|18%|14%|21\.5%/);
    }
    expect(REVIEW_REASON_COMING_SOON).toBe("a coming-soon module is on this lane");
    expect(COPILOT_REJECT_COMING_SOON).toBe(
      "that market is coming soon; only the USDe/USDC loop is live in this build",
    );
  });
});

describe("the shelf count", () => {
  it("is derived from the kit's own totals, never typed", () => {
    /* DERIVED, never hand-typed: the four numbers in the string are
       (liveSources), (liveModules − liveSources), (liveStrategies) and
       (DISPLAY_ORDER.length − liveModules) + (STRATEGIES.length −
       liveStrategies). The assertion reads the same two owners the string
       does rather than pinning 9 and 5. */
    const live = DEMO_SCOPE.liveModules.length;
    const liveStrat = DEMO_SCOPE.liveStrategies.length;
    const soon = DISPLAY_ORDER.length - live + (STRATEGIES.length - liveStrat);
    expect(SHELF_COUNT_SCOPED).toBe(`1 source, ${live - 1} modules, ${liveStrat} strategies · ${soon} coming soon`);
    expect(SHELF_COUNT_SCOPED).toBe("1 source, 3 modules, 2 strategies · 8 coming soon");
    expect(SHELF_COUNT_SCOPED).toBe(shelfCountScoped(DISPLAY_ORDER.length, STRATEGIES.length));
    // One more module key on the shelf is one more coming soon.
    expect(shelfCountScoped(DISPLAY_ORDER.length + 1, STRATEGIES.length)).toBe(
      `1 source, ${live - 1} modules, ${liveStrat} strategies · ${soon + 1} coming soon`,
    );
    /* A SECOND LIVE VENUE ADDS NO SOURCE ROW: `liveSources` counts the
       `liquidity-source` KEY, and both lanes pin their market on one. */
    expect(SHELF_COUNT_SCOPED.startsWith("1 source,")).toBe(true);
  });
});

describe("the review gate", () => {
  const armedLane = {
    laneReviewable: true,
    eligible: true,
    hasMarket: true,
    hasModule: true,
    netApy: 0.04,
  };

  it("closes on a coming-soon module with the owner's reason", () => {
    const g = deriveReviewGate({
      validationOk: true,
      lanes: [{ ...armedLane, placed: ["liquidity-source", "safety-buffer", "hedge"] }],
      orchOn: false,
      launchShapedCount: 1,
    });
    expect(g.armed).toBe(false);
    expect(g.reason).toBe(REVIEW_REASON_COMING_SOON);
  });

  it("arms the two-lane router composition, every module live", () => {
    const g = deriveReviewGate({
      validationOk: true,
      lanes: [
        { ...armedLane, placed: ["liquidity-source", "safety-buffer"] },
        { ...armedLane, netApy: 0.0297088, placed: ["liquidity-source", "redemption-route"] },
      ],
      orchOn: true,
      launchShapedCount: 2,
    });
    expect(g.armed).toBe(true);
    expect(g.reason).toBeNull();
  });

  it("arms the live composition", () => {
    const g = deriveReviewGate({
      validationOk: true,
      lanes: [{ ...armedLane, placed: ["liquidity-source", "safety-buffer", "auto-compound"] }],
      orchOn: false,
      launchShapedCount: 1,
    });
    expect(g.armed).toBe(true);
    expect(g.reason).toBeNull();
  });
});

describe("the attested stage", () => {
  it("has its chip and its noun beside the two live ones", () => {
    expect(VAULT_STAGE_LABEL.attested).toBe("Live · attested");
    expect(VAULT_STAGE_NOUN.attested).toBe("live");
    expect(vaultStage({ stage: "attested", register: "sample" })).toBe("attested");
    expect(vaultStage({ register: "sample" })).toBe("live");
    expect(vaultStage({ register: "published" })).toBe("incubating");
  });
});

describe("the withdrawal row", () => {
  it("is a price on the live record and a fact on every other", () => {
    expect(withdrawalLine({ slug: HERO_SLUG })).toBe("at the attested share value, no fee on principal");
    expect(withdrawalLine({ stage: "attested" })).toBe(WITHDRAWAL_ATTESTED_LINE);
    expect(withdrawalLine({ slug: "steady-eth-loop" })).toBe("no exit rail on a modeled record");
    expect(withdrawalLine()).toBe("no exit rail on a modeled record");
    const rows = feeRows({ slug: HERO_SLUG });
    expect(rows.map((r) => r.label)).toEqual(["Compute fee", "Settlement fee", "Management fee", "Withdrawal"]);
    expect(rows[3]!.value).toBe(WITHDRAWAL_ATTESTED_LINE);
  });
});
