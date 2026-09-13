/**
 * Vault engine tests: the NAV conversion that bridges the journal to the vault
 * page, the async-deposit fill math, and the single-vault resolution of the
 * record published onto the live slug over the standing record.
 *
 * Journals come from `lib/source.ts` (the only sanctioned way into the
 * captures), so these assertions double as a check that the frozen samples
 * still say what the vault pages assume.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEMO_JOURNALS, STRIKE_IDS } from "@/lib/source";
import {
  AWAITING_LABEL,
  HERO_SHARES_OUTSTANDING,
  attestedNavPerShare,
  attestedNavUsd,
  attestedShareText,
  attestedText,
  baseUnitsToNumber,
  formatAttestedNav,
  quorumFacts,
  settlingStrike,
  sharesForDeposit,
  strikeRows,
} from "@/lib/vaults/attested";
import { HERO_MARKET_ID, HERO_SLUG, automationCountFor, heroRecord, resolveVault } from "@/lib/vaults/hero";
import {
  MIN_DEPOSIT_USD,
  STRIKE_ARRIVAL_MS,
  checkAmount,
  fillFromJournal,
  positionFrom,
  positionValueUsd,
  settleRequest,
  strikeDueAt,
  type DepositRequest,
} from "@/lib/vaults/requests";
import { publishedNetApy, repriceAtLeverage } from "@/lib/canvas/mock-quote";
import { DEMO_MARKET_ID, HERO_SEED_LEVERAGE, demoMarketCandidate } from "@/lib/demo/market";
import { DEMO_SCOPE } from "@/lib/demo-scope";
import {
  FLOOR_PAIR_MAX_CONCENTRATION_PCT,
  FLOOR_PAIR_MOVE_WEIGHT,
} from "@/lib/canvas/floor-pair";
import { heroNavUsd } from "@/lib/vaults/rows";
import { handlerCaptureEvidence, onchainExecutionsFor } from "@/lib/vaults/onchain-executions";
import { SEED_SLUGS, SEED_VAULTS } from "@/lib/vaults/seeds";
import { measuredRouterReplay } from "@/lib/canvas/router-replay";
import {
  ROUTER_HISTORY_SOURCES,
  ROUTER_MEASURED_ON,
  routerPublishedToday,
} from "@/lib/canvas/router-history";
import {
  DEMO_ROUTER_MOVE_WEIGHT,
  DEMO_SUSTAIN_HOURS,
  DEMO_UPGRADE_REARM,
  DEMO_UPGRADE_THRESHOLD,
} from "@/lib/canvas/orchestrator/demo-rules";
import {
  RELOCATION_ACTION,
  routerActivityRows,
  routerMoveDetail,
} from "@/components/vaults/ActivitySection";
import {
  MODULE_VOCAB,
  canonicalModuleName,
  moduleDepositorLine,
  recordModuleNames,
  recordVenueLine,
  recordVenueParts,
  routerRuleSentence,
  venueParts,
  type AutomationSource,
  type PublishedLane,
  type VaultRecord,
  deriveAutomations,
  guessLiqLtv,
  loadPositions,
  loadUserVaults,
  loadWithdrawals,
  publishVault,
  riskGrade,
  VAULTS_EVENT,
  vaultStage,
  withdrawPosition,
  addPosition,
} from "@/lib/vaults/store";

const settled = DEMO_JOURNALS[0]!.journal;
const sabotage = DEMO_JOURNALS[1]!.journal;

describe("baseUnitsToNumber", () => {
  it("converts the captured NAV with the journal's own decimals", () => {
    expect(baseUnitsToNumber("500000000", 6)).toBe(500);
  });

  it("keeps sub-unit precision rather than truncating", () => {
    expect(baseUnitsToNumber("500123456", 6)).toBe(500.123456);
    expect(baseUnitsToNumber("1", 6)).toBe(0.000001);
  });

  it("handles zero decimals and negative values", () => {
    expect(baseUnitsToNumber("42", 0)).toBe(42);
    expect(baseUnitsToNumber("-500000000", 6)).toBe(-500);
  });

  it("throws rather than silently producing NaN", () => {
    expect(() => baseUnitsToNumber("5.0e8", 6)).toThrow();
    expect(() => baseUnitsToNumber("", 6)).toThrow();
    expect(() => baseUnitsToNumber("500000000", -1)).toThrow();
  });
});

describe("attested NAV", () => {
  it("reads the settled capture as $500, the desk's own capital", () => {
    expect(attestedNavUsd(settled)).toBe(500);
  });

  it("prices a share at the seed price when NAV equals the seed supply", () => {
    expect(attestedNavPerShare(settled)).toBe(1);
    expect(HERO_SHARES_OUTSTANDING).toBe(500);
  });

  it("settles the sabotage capture at the honest NAV, not the inflated one", () => {
    // Operator 3 reported 750000000; the quorum formed over 500000000.
    expect(sabotage.operators[2]!.nav).toBe("750000000");
    expect(attestedNavUsd(sabotage)).toBe(500);
  });

  it("formats an attested NAV at the journal's full precision", () => {
    expect(formatAttestedNav(500, 6)).toBe("500.000000");
  });
});

describe("quorumFacts", () => {
  it("reports the honest run as 3-of-3 over a 2 of 3 threshold", () => {
    const q = quorumFacts(settled);
    expect(q.label).toBe("3-of-3");
    expect(q.thresholdLabel).toBe("2 of 3");
    expect(q.reached).toBe(true);
  });

  it("reports the sabotage run as 2-of-3: the diverging node never joins", () => {
    const q = quorumFacts(sabotage);
    expect(q.label).toBe("2-of-3");
    expect(q.accepted).toBe(2);
    expect(q.total).toBe(3);
  });

  it("takes the winning hash from the quorum, not from a submission", () => {
    const q = quorumFacts(sabotage);
    const accepted = sabotage.operators.filter((o) => o.accepted);
    const rejected = sabotage.operators.filter((o) => !o.accepted);
    expect(accepted).toHaveLength(2);
    expect(rejected).toHaveLength(1);
    // The rejected node is the one that reported the inflated NAV.
    expect(rejected[0]!.nav).toBe("750000000");
    expect(q.winningHash).toBe(sabotage.quorum.winning_result_hash);
    for (const op of accepted) expect(q.winningHash).toBe(op.result_hash);
    expect(q.winningHash).not.toBe(rejected[0]!.result_hash);
  });

  it("reads the quorum's hash even when the rejected node submitted first", () => {
    // The captures happen to list an accepted operator first, so reading
    // `operators[0]` looks right on them. Reorder and the shortcut breaks.
    const reordered = { ...sabotage, operators: [...sabotage.operators].reverse() };
    expect(reordered.operators[0]!.accepted).toBe(false);
    expect(quorumFacts(reordered).winningHash).toBe(sabotage.quorum.winning_result_hash);
  });
});

describe("awaiting register", () => {
  it("says awaiting rather than quoting a number the quorum has not signed", () => {
    expect(attestedShareText(null)).toBe(AWAITING_LABEL);
    expect(attestedText(null, (v) => v.toFixed(2))).toBe(AWAITING_LABEL);
    expect(AWAITING_LABEL).not.toMatch(/\d/);
  });

  it("formats the attested value untouched once there is one", () => {
    expect(attestedShareText(1)).toBe("1.000000");
    expect(attestedShareText(0)).toBe("0.000000");
    expect(attestedText(500, (v) => `$${v.toFixed(2)}`)).toBe("$500.00");
  });
});

describe("strikeRows", () => {
  const rows = strikeRows(DEMO_JOURNALS.map((e) => e.journal));

  it("orders newest strike first", () => {
    expect(rows[0]!.strikeId).toBe(STRIKE_IDS.sabotage);
    expect(rows[1]!.strikeId).toBe(STRIKE_IDS.settled);
  });

  it("flags exactly the sabotage strike as carrying a rejection", () => {
    expect(rows[0]!.hasRejection).toBe(true);
    expect(rows[1]!.hasRejection).toBe(false);
  });

  it("marks the diverging operator as not accepted and keeps its reading", () => {
    const rejected = rows[0]!.operators.filter((o) => !o.accepted);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.navUsd).toBe(750);
  });

  it("picks the newest settled strike to fill deposits at", () => {
    const s = settlingStrike(rows);
    // Both captures settled at 1.000000, so the price alone proves nothing:
    // the assertion that bites is *which* strike was chosen.
    expect(s?.strikeId).toBe(STRIKE_IDS.sabotage);
    expect(s?.navPerShare).toBe(1);
  });
});

describe("deposit amount validation", () => {
  it("accepts a valid amount and strips currency formatting", () => {
    expect(checkAmount("1,000")).toEqual({ ok: true, amountUsd: 1000 });
    expect(checkAmount("$25")).toEqual({ ok: true, amountUsd: 25 });
  });

  it("reports an empty field without shouting at the user", () => {
    const r = checkAmount("   ");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.empty).toBe(true);
      expect(r.message).toBe("");
    }
  });

  it("warns under the minimum before submit, not after", () => {
    const r = checkAmount("5");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe(`Minimum deposit is $${String(MIN_DEPOSIT_USD)}.`);
  });

  it("rejects non-numeric input", () => {
    expect(checkAmount("lots").ok).toBe(false);
  });
});

describe("fill math", () => {
  it("fills at the journal's nav_final, converted with nav_unit.decimals", () => {
    const fill = fillFromJournal(settled, 1000, 1_700_000_000_000);
    expect(fill).not.toBeNull();
    expect(fill!.navFinalBase).toBe("500000000");
    expect(fill!.navDecimals).toBe(6);
    expect(fill!.navUsd).toBe(500);
    expect(fill!.navPerShare).toBe(1);
    expect(fill!.shares).toBe(1000);
    expect(fill!.strikeId).toBe(STRIKE_IDS.settled);
  });

  it("scales shares by the attested price, not by the deposit", () => {
    // Same capture, half the shares outstanding: NAV per share doubles.
    const fill = fillFromJournal(settled, 1000, 0, 250);
    expect(fill!.navPerShare).toBe(2);
    expect(fill!.shares).toBe(500);
  });

  it("derives shares as amount / navPerShare", () => {
    expect(sharesForDeposit(1000, 1.25)).toBe(800);
    expect(() => sharesForDeposit(1000, 0)).toThrow();
  });
});

describe("request lifecycle", () => {
  const pending: DepositRequest = {
    id: "req_1",
    vaultSlug: HERO_SLUG,
    amountUsd: 1000,
    requestedAt: new Date(1_700_000_000_000).toISOString(),
    status: "pending",
  };

  it("waits one replay cadence for the strike", () => {
    expect(STRIKE_ARRIVAL_MS).toBe(8000);
    expect(strikeDueAt(pending)).toBe(1_700_000_008_000);
  });

  it("settles a pending request at the attested NAV", () => {
    const done = settleRequest(pending, settled, 1_700_000_008_000);
    expect(done.status).toBe("settled");
    expect(done.fill?.navPerShare).toBe(1);
    expect(done.fill?.shares).toBe(1000);
  });

  it("never re-settles a request that is not pending", () => {
    const cancelled: DepositRequest = { ...pending, status: "cancelled" };
    expect(settleRequest(cancelled, settled, 0)).toBe(cancelled);
  });

  it("aggregates settled fills and keeps pending capital separate", () => {
    const settledReq = settleRequest(pending, settled, 0);
    const second: DepositRequest = { ...pending, id: "req_2", amountUsd: 250 };
    const pos = positionFrom([settledReq, second]);
    expect(pos.shares).toBe(1000);
    expect(pos.costUsd).toBe(1000);
    expect(pos.entryNavPerShare).toBe(1);
    expect(pos.pending).toBe(1);
    expect(pos.pendingUsd).toBe(250);
    expect(positionValueUsd(pos, 1.05)).toBeCloseTo(1050, 10);
  });

  it("reports no entry price with nothing settled", () => {
    expect(positionFrom([pending]).entryNavPerShare).toBeNull();
  });
});

/* ──────────────────────────────────────────────────────────── the vault ── */

describe("the vault", () => {
  it("advertises the demo's own $500 of capital, attested, not a typed TVL", () => {
    const hero = heroRecord();
    expect(hero.baseTvlUsd).toBe(500);
    expect(hero.baseTvlUsd).toBe(attestedNavUsd(settled));
    expect(hero.baseTvlUsd).toBe(heroNavUsd());
  });

  it("carries the operator quorum as an extra instrument", () => {
    // Dynamic leverage + Auto-compound, plus the quorum that attests the NAV.
    expect(automationCountFor(heroRecord())).toBe(3);
  });

  it("pins the same market the canvas catalog offers", () => {
    expect(HERO_MARKET_ID).toBe(DEMO_MARKET_ID);
  });

  it("prices through the live owners at the seed leverage, with the fee inside", () => {
    const hero = heroRecord();
    expect(hero.appliedLeverage).toBe(HERO_SEED_LEVERAGE);
    /* THE HERO PRICES THE TYPED ROW AT THE STORED LEVERAGE (G3), through the
       same owner the canvas calls, and it is deliberately NOT the router's
       measured day: two numbers, two questions, two labels. The identity is
       asserted against the owner rather than a literal so the pin follows the
       row; the inequality is asserted too, because the defect this ruling
       replaced was a page welding the two into one frame. */
    expect(hero.modeledApy).toBe(
      publishedNetApy(repriceAtLeverage(demoMarketCandidate(), HERO_SEED_LEVERAGE), false),
    );
    expect(hero.modeledApy).not.toBe(routerPublishedToday()!.loop);
    expect(hero.stage).toBe("attested");
    expect(vaultStage(hero)).toBe("attested");
    expect(hero.register).toBe("sample");
    expect(hero.modules).toEqual(["Liquidity source", "Dynamic leverage", "Auto-compound"]);
    expect(hero.liqLtv).toBe(0.915);
    expect(hero.automations?.hedge).toBeNull();
    expect(hero.automations?.leverage?.targetLeverage).toBe(HERO_SEED_LEVERAGE);
    expect(hero.automations?.compound?.cadenceHours).toBe(24);
  });

  it("types no dead figure", () => {
    const text = JSON.stringify(heroRecord());
    expect(text).not.toMatch(/5\.0x|1\.08x|0\.25%|\$50M|"modeledApy":0\.08\b|"thresholdUsd":25\b/);
    expect(text).not.toContain("\u2014");
  });

  it("leads the seeds, once, with seven coming-soon samples behind it", () => {
    expect(SEED_VAULTS).toHaveLength(8);
    expect(SEED_VAULTS[0]!.slug).toBe("verifiable-usde-loop");
    expect(SEED_VAULTS.filter((v) => v.stage === "attested")).toHaveLength(1);
    expect(SEED_VAULTS.filter((v) => v.stage !== "attested")).toHaveLength(7);
    expect(SEED_SLUGS.has("btc-carry-collector")).toBe(false);
    expect(SEED_SLUGS.has(HERO_SLUG)).toBe(true);
  });

  it("resolves to the standing record when nothing has been published", () => {
    // Node environment: no localStorage, so the store is always empty; the
    // same path the server render and the first paint take.
    expect(resolveVault()).toEqual(heroRecord());
  });
});

/* ───────────────────────────────────────── publish onto the live record ── */

/**
 * A window with a Map-backed localStorage, so the store's persistence path
 * runs as it does in a browser. Installed for this block only.
 */
function installBrowserShim(): () => void {
  const bag = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => bag.get(k) ?? null,
    setItem: (k: string, v: string) => void bag.set(k, String(v)),
    removeItem: (k: string) => void bag.delete(k),
    clear: () => bag.clear(),
    key: (i: number) => [...bag.keys()][i] ?? null,
    get length() {
      return bag.size;
    },
  };
  const win = Object.assign(new EventTarget(), { localStorage, location: { hostname: "localhost" } });
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = win;
  g.localStorage = localStorage;
  return () => {
    delete g.window;
    delete g.localStorage;
  };
}

describe("publish onto the live record", () => {
  let restore: () => void;
  beforeAll(() => {
    restore = installBrowserShim();
  });
  afterAll(() => restore());

  const draft = {
    name: "My USDe Loop",
    strategy: "loop" as const,
    strategyLabel: "Leveraged loop",
    summary: "Composed on the canvas.",
    venue: "Morpho Blue · Base",
    market: "USDe/USDC",
    modules: ["Liquidity source", "Dynamic leverage", "Auto-compound"],
    moduleLines: [],
    params: [
      { label: "Applied leverage", value: "3.25x" },
      { label: "Compound cadence", value: "6h" },
    ],
    modeledApy: 0.048,
    capacityUsd: 10_000_000,
    capacityBindingLabel: "modeled",
    liqLtv: 0.915,
    appliedLeverage: 3.25,
  };

  it("writes the composition onto the live slug rather than minting one", () => {
    const events: string[] = [];
    (globalThis as unknown as { window: EventTarget }).window.addEventListener(VAULTS_EVENT, () =>
      events.push(VAULTS_EVENT),
    );
    const rec = publishVault(draft, SEED_SLUGS);
    expect(rec).not.toBeNull();
    expect(rec!.slug).toBe(DEMO_SCOPE.liveSlug);
    expect(rec!.slug).toBe(HERO_SLUG);
    expect(rec!.mine).toBe(true);
    expect(rec!.stage).toBe("attested");
    expect(rec!.register).toBe("published");
    expect(rec!.appliedLeverage).toBe(3.25);
    expect(rec!.baseTvlUsd).toBe(heroNavUsd());
    expect(rec!.automations?.leverage?.targetLeverage).toBe(3.25);
    expect(rec!.automations?.compound?.cadenceHours).toBe(6);
    expect(events.length).toBeGreaterThan(0);
    expect(loadUserVaults().map((v) => v.slug)).toEqual([HERO_SLUG]);
  });

  it("resolves to the published name afterwards", () => {
    expect(resolveVault().name).toBe("My USDe Loop");
    expect(resolveVault().stage).toBe("attested");
  });

  it("replaces the record on a second publish instead of adding one", () => {
    publishVault({ ...draft, name: "Renamed" }, SEED_SLUGS);
    expect(loadUserVaults()).toHaveLength(1);
    expect(resolveVault().name).toBe("Renamed");
  });

  it("installs an instrument only for a module the canvas actually composed", () => {
    const a = deriveAutomations(draft);
    expect(a.leverage?.targetLeverage).toBe(3.25);
    expect(a.compound?.cadenceHours).toBe(6);
    expect(a.hedge).toBeNull();
    expect(guessLiqLtv("USDe/USDC")).toBe(0.915);
    const l = a.leverage!;
    expect(l.emergencyHf).toBeLessThan(l.deleverHf);
    expect(l.deleverHf).toBeLessThan(l.targetHf);
    expect(l.targetHf).toBeLessThan(l.leverUpHf);
  });

  it("withdraws FIFO: reduces the oldest position, then deletes it", () => {
    const first = addPosition({
      vaultSlug: HERO_SLUG,
      vaultName: "Renamed",
      amountUsd: 1000,
      shareValueAtDeposit: 1,
      depositedAt: new Date(1_700_000_000_000).toISOString(),
    });
    const second = addPosition({
      vaultSlug: HERO_SLUG,
      vaultName: "Renamed",
      amountUsd: 250,
      shareValueAtDeposit: 1,
      depositedAt: new Date(1_700_000_001_000).toISOString(),
    });
    expect(first && second).toBeTruthy();

    const afterPartial = withdrawPosition(HERO_SLUG, 400);
    expect(afterPartial).not.toBeNull();
    expect(afterPartial!.map((p) => [p.id, p.amountUsd])).toEqual([
      [second!.id, 250],
      [first!.id, 600],
    ]);
    expect(loadPositions()).toEqual(afterPartial);

    const afterMax = withdrawPosition(HERO_SLUG, 850);
    expect(afterMax).toEqual([]);
    expect(loadPositions()).toEqual([]);
    expect(loadWithdrawals().map((w) => w.amountUsd)).toEqual([850, 400]);
    expect(loadWithdrawals()[0]!.vaultSlug).toBe(HERO_SLUG);
  });

  it("refuses a withdrawal with nothing to redeem or a bad amount", () => {
    expect(withdrawPosition(HERO_SLUG, 10)).toBeNull();
    expect(withdrawPosition(HERO_SLUG, 0)).toBeNull();
    expect(withdrawPosition(HERO_SLUG, Number.NaN)).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   THE CAPITAL ROUTER ON THE VAULT PAGE (plan WP-3, rulings R4b / R5 / R6).

   Four questions, and the fourth is the one that protects everything already
   shipped: does a record without the new fields render EXACTLY as it did.
   ═══════════════════════════════════════════════════════════════════════ */

const ROUTED_LANES: PublishedLane[] = [
  {
    venue: "morpho-blue-base",
    venueLabel: "Morpho Blue · Base",
    market: "USDe/USDC",
    label: "Leveraged loop",
    family: "loop",
    publishedApy: 0.0307572,
    allocationBps: 10_000,
  },
  {
    venue: "treasury-ausdc-base",
    venueLabel: "Aave v3 · Base",
    market: "USDC reserve",
    label: "USDC lending",
    family: "treasury",
    publishedApy: 0.0297088,
    allocationBps: 0,
  },
];

/** A record shaped exactly as the canvas will publish it (seam 1). */
function routedSource(over: Partial<AutomationSource> = {}): AutomationSource {
  return {
    strategy: "loop",
    venue: "Morpho Blue and Aave v3 · Base",
    market: "USDe/USDC",
    modules: ["Liquidity source", "Capital router"],
    params: [],
    lanes: ROUTED_LANES,
    router: {
      reactivity: "standard",
      maxConcentrationPct: 60,
      turnoverBudgetPctWeek: 25,
      ruleSentence: "",
      thresholdApy: DEMO_UPGRADE_THRESHOLD,
      rearmApy: DEMO_UPGRADE_REARM,
      sustainHours: DEMO_SUSTAIN_HOURS,
      moveWeight: DEMO_ROUTER_MOVE_WEIGHT,
    },
    ...over,
  };
}

describe("a card's venue line", () => {
  /* One resolver for the directory card, the portfolio card and the page
     header: the routed record read `2 markets · Multi-venue` on the card that
     links to the page where the same record reads its two venues and its one
     chain. */
  it("resolves a routed record's Multi-venue through its own lanes", () => {
    /* Through the record's own automations, which is where the lanes live
       once `deriveAutomations` has seated the router. */
    expect(
      recordVenueLine({ venue: "Multi-venue", automations: deriveAutomations(routedSource()) }),
    ).toBe("Morpho Blue and Aave v3 · Base");
  });

  it("hands back the raw field on every record that is not routed", () => {
    expect(recordVenueLine({ venue: "Morpho Blue · Base" })).toBe("Morpho Blue · Base");
    expect(recordVenueLine({ venue: "Hyperliquid · funding" })).toBe("Hyperliquid · funding");
  });
});

describe("the hero record's two rates are labelled by how they were obtained", () => {
  /* Design item 22, re-ruled by G3. The rates are TYPED INPUTS again, so the
     rows say typed and the third row points at the measured series they are
     not drawn from. The pins read the owner, never a literal. */
  it("says typed, at the precision the row carries, beside the measured series", () => {
    const rows = heroRecord().params;
    const e = demoMarketCandidate().economics;
    expect(rows.find((r) => r.label === "Collateral yield, typed")?.value).toBe(
      `${((e?.collateralYieldApy ?? 0) * 100).toFixed(2)}%`,
    );
    expect(rows.find((r) => r.label === "Borrow rate, typed")?.value).toBe(
      `${((e?.borrowApyMarginal ?? 0) * 100).toFixed(2)}%`,
    );
    expect(rows.find((r) => r.label === "Measured series")?.value).toBe(
      `${ROUTER_MEASURED_ON} · ${ROUTER_HISTORY_SOURCES.loopReward.provider}`,
    );
    /* The hero prices the TYPED row at the seed leverage, and it is 4.8% at
       the 10% compute fee (founder, 2026-09-08): the one live workflow the
       demo is built around (Install defaults seats Dynamic leverage at 2.50x)
       depends on this row supporting leverage. */
    expect(publishedNetApy(repriceAtLeverage(demoMarketCandidate(), HERO_SEED_LEVERAGE), false)).toBeCloseTo(
      0.04815,
      3,
    );
  });
});

describe("the risk sentence names the lane that borrows", () => {
  /* A routed record's `market` field is `2 markets`, because two lanes pin
     two of them, and the liquidation line belongs to one lane. The sentence
     read `Liquidation on the 2 markets pair needs 34% adverse pair move`. */
  const routedRecord = (): VaultRecord => ({
    ...heroRecord(),
    market: "2 markets",
    lanes: ROUTED_LANES,
  });

  it("prints the loop lane's pair, never the lane count", () => {
    const { sentence } = riskGrade(routedRecord());
    expect(sentence).toContain("USDe/USDC");
    expect(sentence).not.toContain("2 markets");
  });

  it("leaves a single-lane record's sentence exactly as it was", () => {
    const hero = heroRecord();
    expect(riskGrade(hero).sentence).toContain(hero.market);
  });
});

describe("deriveAutomations seats the router on two lanes and a rule, never on one", () => {
  it("seats it when the record carries both", () => {
    const r = deriveAutomations(routedSource()).router;
    expect(r).not.toBeNull();
    expect(r?.lanes).toHaveLength(2);
    // Every figure is the quant's owner, not a literal on this line.
    expect(r?.thresholdApy).toBe(DEMO_UPGRADE_THRESHOLD);
    expect(r?.rearmApy).toBe(DEMO_UPGRADE_REARM);
    expect(r?.sustainHours).toBe(DEMO_SUSTAIN_HOURS);
    expect(r?.moveWeight).toBe(DEMO_ROUTER_MOVE_WEIGHT);
  });

  it("refuses a one-lane record and a record with no router", () => {
    expect(deriveAutomations(routedSource({ lanes: [ROUTED_LANES[0]!] })).router).toBeNull();
    expect(deriveAutomations(routedSource({ router: null })).router).toBeNull();
  });

  it("backfills the rule sentence from the owners, in the depositor's words", () => {
    const line = deriveAutomations(routedSource()).router?.ruleSentence ?? "";
    expect(line).toBe(
      routerRuleSentence({
        lanes: ROUTED_LANES,
        thresholdApy: DEMO_UPGRADE_THRESHOLD,
        sustainHours: DEMO_SUSTAIN_HOURS,
        moveWeight: FLOOR_PAIR_MOVE_WEIGHT,
        maxConcentrationPct: FLOOR_PAIR_MAX_CONCENTRATION_PCT,
      }),
    );
    expect(line).toContain("USDC lending");
    expect(line).toContain(`${DEMO_SUSTAIN_HOURS} hours`);
    /* THE FOUNDER'S OWN SENTENCE (item 5): everything moves, the bar and the
       window are named, and the rebuild is the same rule read from the other
       end. No size clause, because the move is the whole lane. */
    expect(line.startsWith("Moves everything to ")).toBe(true);
    expect(line).toContain("rebuilds the");
    expect(line).not.toContain("of the book");
    expect(line).not.toContain("12.5pp");
    for (const banned of ["moves the capital to", "follows the yield"]) {
      expect(line.toLowerCase()).not.toContain(banned);
    }
  });

  it("prefers what the record published over the owner's value", () => {
    const src = routedSource();
    const r = deriveAutomations({
      ...src,
      router: { ...src.router!, thresholdApy: 0.05, ruleSentence: "  " },
    }).router;
    expect(r?.thresholdApy).toBe(0.05);
    // A blank published sentence is not a sentence; the backfill answers.
    expect(r?.ruleSentence.startsWith("Moves ")).toBe(true);
  });
});

describe("the router vocabulary names one machine once", () => {
  it("every spelling canonicalises to `Capital router`", () => {
    for (const raw of ["Capital router", "capital router", "yield router", "router", "capital-router"]) {
      expect(canonicalModuleName(raw)).toBe("Capital router");
    }
  });

  it("the depositor line is the vocabulary's, edited nowhere", () => {
    const entry = MODULE_VOCAB.find((e) => e.name === "Capital router");
    expect(entry).toBeDefined();
    expect(moduleDepositorLine("yield router")).toBe(entry!.depositorLine);
    expect(entry!.depositorLine).toBe(
      "Moves the whole book to the better lane once it has led by the bar for 48 hours.",
    );
  });

  it("`Also installed` cannot print it a second time: the roster dedupes on the canonical name", () => {
    expect(recordModuleNames({ modules: ["Capital router", "yield router", "router"] })).toEqual([
      "Capital router",
    ]);
  });
});

describe("the measured replay is the quant's, to the day and to the weight", () => {
  const replay = measuredRouterReplay();

  it("folds one move, on 2026-06-12, loop to floor, the whole lane", () => {
    expect(replay.days).toBe(89);
    expect(replay.moves).toHaveLength(1);
    const m = replay.moves[0]!;
    expect(m.date).toBe("2026-06-12");
    expect(m.source).toBe("loop");
    expect(m.dest).toBe("floor");
    /* THE SWITCH (G1) ON THE SEAT (fix wave 2): the loop starts holding the
       whole book and ends at zero, so the move is 100.0pp. It read 50.0pp
       while the fold opened on an even split, which is a position this machine
       is never in between firings. */
    expect(m.weightFrac).toBeCloseTo(1, 9);
    expect(replay.endWeights).toEqual({ loop: 0, floor: 1 });
  });

  it("today the loop leads, so the clock is empty and nothing is armed", () => {
    const today = routerPublishedToday();
    expect(today?.date).toBe(replay.asOfDate);
    expect(replay.gapApy).toBeCloseTo((today?.loop ?? 0) - (today?.floor ?? 0), 12);
    expect(replay.gapApy).toBeGreaterThan(0);
    // Well under the bar: the shipped ratchet over a 0.10pp spread.
    expect(replay.gapApy).toBeLessThan(DEMO_UPGRADE_THRESHOLD);
    expect(replay.behindLane).toBeNull();
    expect(replay.breachDays).toBe(0);
    expect(replay.hoursBehind).toBe(0);
    expect(replay.clockFull).toBe(false);
    expect(replay.inCooldown).toBe(false);
  });

  it("reads the same answer twice: the fold is pure", () => {
    expect(measuredRouterReplay()).toBe(replay);
  });
});

describe("the ledger's relocation rows", () => {
  it("name both ends and the gap that fired the move", () => {
    /* Item 5: the direction and the gap. The size clause is gone because the
       action word already states it: the whole lane relocated. */
    const detail = routerMoveDetail(measuredRouterReplay().moves[0]!, ROUTED_LANES);
    expect(detail).toBe("Leveraged loop to USDC lending, +10.97pp");
    expect(RELOCATION_ACTION).toBe("Capital relocated");
  });

  it("carry no transaction, so the Verify cell is empty rather than a dead key", () => {
    const record = { ...heroRecord(), automations: deriveAutomations(routedSource()) };
    const rows = routerActivityRows(record);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("router");
    expect(rows[0]!.txHash).toBeUndefined();
    expect(rows[0]!.mine).toBeUndefined();
  });

  it("come from nothing on a record with no router", () => {
    expect(routerActivityRows(heroRecord())).toEqual([]);
  });

  /* The stand-down's premise moved. `onchainExecutionsFor` now returns
     `[]` on every slug (see `onchain-executions.ts`), so no vault page
     receives the captured handler ledger; the captured rows still exist
     as `handlerCaptureEvidence()` for a dedicated proof surface. What
     this test now pins: the router's own contributed rows continue to
     predate the handler capture as a whole, so a future page that DOES
     print both never renders a router move ahead of the captured
     history. */
  it("the router's rows still predate the captured handler ledger, if both were surfaced", () => {
    const chain = handlerCaptureEvidence();
    expect(chain.length).toBeGreaterThan(0);
    // No hero page currently prints these rows — the vault page's
    // getter returns empty. Pin that shape too.
    expect(onchainExecutionsFor(HERO_SLUG)).toEqual([]);
    const oldestChainMs = Math.min(...chain.map((x) => x.timestamp * 1000));
    const record = { ...heroRecord(), automations: deriveAutomations(routedSource()) };
    const rows = routerActivityRows(record);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ms).toBeLessThan(oldestChainMs);
  });
});

describe("an older single-lane record renders exactly as it did", () => {
  const legacy: AutomationSource = {
    strategy: "loop",
    venue: "Morpho Blue · Base",
    market: "USDe/USDC",
    modules: ["Liquidity source", "Dynamic leverage", "Auto-compound"],
    params: [
      { label: "Applied leverage", value: "2.50x" },
      { label: "Liquidation LTV", value: "91.5%" },
    ],
    appliedLeverage: 2.5,
    liqLtv: 0.915,
  };

  it("seats no router and moves no other instrument", () => {
    const a = deriveAutomations(legacy);
    expect(a.router).toBeNull();
    // The three instruments that existed before this wave are untouched.
    expect(a.leverage).not.toBeNull();
    expect(a.compound).not.toBeNull();
    expect(a.hedge).toBeNull();
    // The shipped instruments, and nothing else in the object. `redemption`
    // rides beside `router`: null here, seated only where the module is.
    expect(Object.keys(a).sort()).toEqual(["compound", "hedge", "leverage", "redemption", "router"]);
    expect(a.redemption).toBeNull();
  });

  it("adds no ledger row and no module to the roster", () => {
    const record = { ...heroRecord(), automations: deriveAutomations(legacy) };
    expect(routerActivityRows(record)).toEqual([]);
    expect(recordModuleNames(legacy)).not.toContain("Capital router");
  });

  it("the venue line and the automation count are the record's, unchanged", () => {
    const legacyRecord = { ...heroRecord(), automations: deriveAutomations(legacy) };
    // `venueParts` is what every record in the product resolves through today.
    expect(recordVenueParts(legacyRecord)).toEqual(venueParts(legacyRecord.venue));
    expect(automationCountFor(heroRecord())).toBe(3);
  });

  it("the shipped seed vaults publish neither field, so none of them route", () => {
    for (const v of SEED_VAULTS) {
      expect(v.lanes).toBeUndefined();
      expect(v.router).toBeUndefined();
      expect(deriveAutomations(v).router).toBeNull();
    }
    expect(heroRecord().lanes).toBeUndefined();
    expect(deriveAutomations(heroRecord()).router).toBeNull();
  });
});

describe("the rail names one vault on a routed record", () => {
  /* `vault.venue` on a two-venue publish is the word `Multi-venue`, which the
     naive split reads as the chain as well, so the Projection card printed
     `Multi-venue · Multi-venue` for a vault that never leaves Base while the
     Modeled APY row below it printed a composed two-lane number. */
  const routed = {
    ...heroRecord(),
    venue: "Multi-venue",
    automations: deriveAutomations(routedSource()),
  };

  it("reads the lanes, in the page's own `<name> · <chain>` shape", () => {
    expect(recordVenueParts(routed)).toEqual({
      venue: "Morpho Blue and Aave v3",
      chain: "Base",
    });
    // The shape the old owner produced, and the reason it had to be replaced.
    expect(venueParts("Multi-venue")).toEqual({
      venue: "Multi-venue",
      chain: "Multi-venue",
    });
  });

  it("counts the router among the vault's automations", () => {
    /* THE CARD AND THE PAGE COUNT THE SAME VAULT. The directory prints this
       number beside the link, and the page mounts the router FIRST, so a
       routed record that counted three while showing four made one vault
       read as two. Asserted as a DELTA on the hero's own automations, never
       against a typed total: the base is three (Dynamic leverage,
       Auto-compound, the quorum) and the router is the fourth. */
    const hero = heroRecord();
    expect(automationCountFor(hero)).toBe(3);
    const withRouter = {
      ...hero,
      automations: { ...hero.automations!, router: deriveAutomations(routedSource()).router },
    };
    expect(automationCountFor(withRouter)).toBe(4);
  });

  it("falls through to the label on a record whose lanes are on two chains", () => {
    const crossChain = {
      ...heroRecord(),
      venue: "Multi-venue",
      automations: deriveAutomations(
        routedSource({
          lanes: [
            ROUTED_LANES[0]!,
            { ...ROUTED_LANES[1]!, venueLabel: "Aave v3 · Ethereum" },
          ],
        }),
      ),
    };
    expect(recordVenueParts(crossChain).chain).toBe("Cross-venue");
  });
});
