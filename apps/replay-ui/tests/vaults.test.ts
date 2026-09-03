/**
 * Vault engine tests: the NAV conversion that bridges the journal to the vault
 * page, the async-deposit fill math, and the single-vault resolution of the
 * published envelope over the standing record.
 *
 * Journals come from `lib/source.ts` (the only sanctioned way into the
 * captures), so these assertions double as a check that the frozen samples
 * still say what the vault pages assume.
 */
import { describe, expect, it } from "vitest";

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
import { HERO_MARKET_ID, HERO_VAULT, automationCountFor, resolveVault } from "@/lib/vaults/hero";
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
import { DEMO_MARKET_ID } from "@/lib/canvas/opportunities";
import { deriveAutomations, guessLiqLtv, riskGrade } from "@/lib/vaults/store";

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
    vaultSlug: HERO_VAULT.slug,
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
  it("advertises the demo's own $500 of capital, not a fake TVL", () => {
    expect(HERO_VAULT.baseTvlUsd).toBe(500);
    expect(HERO_VAULT.baseTvlUsd).toBe(attestedNavUsd(settled));
  });

  it("carries the operator quorum as an extra instrument", () => {
    // Dynamic leverage + Auto-compound, plus the quorum that attests the NAV.
    expect(automationCountFor(HERO_VAULT)).toBe(3);
  });

  it("pins the same market the canvas catalog offers", () => {
    expect(HERO_MARKET_ID).toBe(DEMO_MARKET_ID);
  });

  it("resolves to the standing record when nothing has been published", () => {
    // Node environment: no localStorage, so the envelope is always absent —
    // the same path the server render and the first paint take.
    expect(resolveVault()).toEqual(HERO_VAULT);
  });
});

describe("published envelope", () => {
  const draft = {
    venue: "Morpho Blue · Base",
    market: "USDe/USDC",
    modules: ["Liquidity source", "Dynamic leverage", "Auto-compound"],
    params: [
      { label: "Target leverage", value: "4.00x" },
      { label: "Compound cadence", value: "6h" },
    ],
  };

  it("installs an instrument only for a module the canvas actually composed", () => {
    const a = deriveAutomations(draft);
    expect(a.leverage?.targetLeverage).toBe(4);
    expect(a.compound?.cadenceHours).toBe(6);
    expect(a.hedge).toBeNull();
  });

  it("derives the envelope from the market's own liquidation LTV", () => {
    expect(guessLiqLtv("USDe/USDC")).toBe(0.915);
    const a = deriveAutomations(draft);
    expect(a.leverage?.liqLtv).toBe(0.915);
    // Zones are ordered emergency < delever < target < leverUp.
    const l = a.leverage!;
    expect(l.emergencyHf).toBeLessThan(l.deleverHf);
    expect(l.deleverHf).toBeLessThan(l.targetHf);
    expect(l.targetHf).toBeLessThan(l.leverUpHf);
  });

  it("grades risk off the published envelope, never a restated adjective", () => {
    const graded = riskGrade(HERO_VAULT);
    expect(graded.rows.map((r) => r.label)).toEqual([
      "Distance to liquidation",
      "Auto-deleverage begins",
    ]);
    expect(graded.sentence).toContain("USDe/USDC");
    expect(graded.sentence).toContain(HERO_VAULT.automations!.leverage!.deleverHf.toFixed(2));
  });
});
