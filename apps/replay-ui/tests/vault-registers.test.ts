/**
 * The vault pages' two registers, pinned (docs/plans/LATEST_UI_PORT_SPEC.md
 * WP4.16, H.5): every value captioned `attested` on /vaults, /vaults/[slug]
 * and /portfolio is read off the journals through `lib/vaults/attested.ts`
 * and `lib/vaults/rows.ts`, never typed on the record; the modeled APY is
 * the only number that counts up; the exit sentence, the stage label and the
 * coming-soon count come from their one owner each.
 */
import { describe, expect, it } from "vitest";

import { attestationRows, ATTESTATION_NOTE } from "@/components/vaults/AttestationPanel";
import { attestedShareSeries, isAttestedPerformance } from "@/components/vaults/PerformanceSection";
import { isLiveRecord, partitionForDirectory } from "@/components/vaults/VaultsDirectory";
import { innerLaneModel, PRESS_LEAD_MS, pressStartMs, saboteurOperatorId } from "@/components/vaults/verification-model";
import { withdrawalLine } from "@/lib/canvas/fees";
import { COMING_SOON, HERO_SLUG } from "@/lib/demo-scope";
import { buildTimeline } from "@/lib/replay";
import { DEMO_JOURNALS } from "@/lib/source";
import { attestedNavPerShare, attestedNavUsd, HERO_SHARES_OUTSTANDING, settlingStrike, strikeRows } from "@/lib/vaults/attested";
import { heroRecord } from "@/lib/vaults/hero";
import { captureJournal } from "@/lib/vaults/pipeline";
import { heroNavPerShare, heroNavUsd, heroSettlingJournal, heroStrikes } from "@/lib/vaults/rows";
import { SEED_VAULTS } from "@/lib/vaults/seeds";
import { VAULT_STAGE_LABEL } from "@/lib/vaults/store";

describe("the attested register reads only from attested.ts / rows.ts", () => {
  it("the hero record's NAV is the settling capture's, byte for byte", () => {
    const settling = heroSettlingJournal();
    expect(settling).not.toBeNull();
    if (settling === null) return;
    const nav = attestedNavUsd(settling);
    expect(nav).not.toBeNull();
    expect(heroNavUsd()).toBe(nav);
    expect(heroRecord().baseTvlUsd).toBe(nav);
  });

  it("the share value is the attested NAV over the published shares, 1.0000 at 4dp", () => {
    const settling = heroSettlingJournal();
    if (settling === null) throw new Error("no settling capture");
    const sv = attestedNavPerShare(settling, HERO_SHARES_OUTSTANDING);
    expect(heroNavPerShare()).toBe(sv);
    expect(heroNavPerShare()?.toFixed(4)).toBe("1.0000");
  });

  it("the strike rows are the journals' rows: nothing modeled reaches them", () => {
    const rows = strikeRows(
      DEMO_JOURNALS.map((e) => e.journal),
      HERO_SHARES_OUTSTANDING,
    );
    expect(heroStrikes()).toEqual(rows);
    expect(settlingStrike(rows)?.navUsd).toBe(heroNavUsd());
  });

  it("the record itself types no NAV: baseTvlUsd tracks the reader, not a literal", () => {
    // The record is rebuilt on every call from the readers, so two calls
    // agree and both agree with the journal.
    expect(heroRecord().baseTvlUsd).toBe(heroRecord().baseTvlUsd);
    expect(heroRecord().baseTvlUsd).toBe(heroNavUsd());
  });
});

describe("the Performance section on the hero draws the journal, not a model", () => {
  it("the series is one point per captured strike at the attested share value, oldest first", () => {
    const series = attestedShareSeries();
    const expected = [...heroStrikes()]
      .sort((a, b) => a.triggerBlock - b.triggerBlock)
      .map((s) => s.navPerShare)
      .filter((v): v is number => v !== null);
    expect(series).toEqual(expected);
    expect(series.length).toBeGreaterThanOrEqual(2);
  });

  it("the line is flat: both strikes settled at the same NAV", () => {
    const series = attestedShareSeries();
    expect(new Set(series.map((v) => v.toFixed(6))).size).toBe(1);
    expect(series[0]?.toFixed(4)).toBe("1.0000");
  });

  it("only the hero slug takes the attested branch", () => {
    expect(isAttestedPerformance({ slug: HERO_SLUG })).toBe(true);
    expect(isAttestedPerformance({ slug: "anything-else" })).toBe(false);
  });
});

describe("the Attestation panel prints the journal's own facts", () => {
  const journal = captureJournal("honest");
  const strikes = heroStrikes();
  const rows = attestationRows(strikes);
  const value = (label: string) => rows.find((r) => r.label === label)?.value;

  it("quorum, settled, digest, service, vault, chain, operators, unit, block, hash, NAV", () => {
    const newest = strikes[0];
    if (newest === undefined) throw new Error("no strikes");
    expect(value("Quorum")).toBe(`${newest.quorum.thresholdLabel} required`);
    expect(value("Quorum")).toBe("2 of 3 required");
    expect(value("Component digest")).toBe(journal.component_digest);
    expect(value("Chain id")).toBe(String(journal.vault.chain_id));
    expect(value("Operators registered")).toBe(String(journal.operators.length));
    expect(rows.filter((r) => r.label.startsWith("Operator ")).length).toBe(journal.operators.length);
    expect(value("NAV unit")).toBe(`${journal.nav_unit.asset}, ${String(journal.nav_unit.decimals)} decimals`);
    expect(value("Latest inputs block")).toBe(String(newest.inputsBlock));
    expect(value("Latest attested NAV")).toBe("500.000000 USDC");
  });

  it("the settled line names every strike in block order with its rejection count", () => {
    const settled = value("Settled") ?? "";
    expect(settled).toContain("3 of 3 at block 49480000");
    expect(settled).toContain("2 of 3 at block 49480010, one rejection");
    expect(settled.indexOf("49480000")).toBeLessThan(settled.indexOf("49480010"));
  });

  it("the honesty line carries a period, never a semicolon", () => {
    expect(ATTESTATION_NOTE).toContain("Today the desk runs them. The shape does not change when independent operators do.");
    expect(ATTESTATION_NOTE).not.toContain(";");
  });
});

describe("the verification board's press timing is derived from the timeline", () => {
  it("the corrupt press lands the rejection at +160 ms", () => {
    const journal = captureJournal("corrupted");
    const timeline = buildTimeline(journal);
    const rejected = timeline.events.find((e) => e.kind === "submission" && !e.operator.accepted);
    expect(rejected).toBeDefined();
    if (rejected === undefined) return;
    expect(pressStartMs("corrupted")).toBe(rejected.atMs - PRESS_LEAD_MS);
    expect(PRESS_LEAD_MS).toBe(160);
  });

  it("the restore press starts where the sabotaged operator's honest submission lands, minus the lead", () => {
    const saboteur = saboteurOperatorId();
    expect(saboteur).not.toBeNull();
    const journal = captureJournal("honest");
    const timeline = buildTimeline(journal);
    const honest = timeline.events.find(
      (e) => e.kind === "submission" && e.operator.accepted && e.operator.id.toLowerCase() === saboteur?.toLowerCase(),
    );
    expect(honest).toBeDefined();
    if (honest === undefined) return;
    expect(pressStartMs("honest")).toBe(honest.atMs - PRESS_LEAD_MS);
  });

  it("the inner lane prints the record's own values and no typed fallback", () => {
    const model = innerLaneModel(heroRecord());
    expect(model.plates.map((p) => p.n)).toEqual(["S1", "S2", "S3", "S4"]);
    expect(model.plates[0]?.value).toBe("USDe/USDC");
    expect(model.plates[2]?.value).toBe("24h");
    const printed = model.plates.map((p) => `${p.value ?? ""} ${p.row?.value ?? ""}`).join(" ");
    expect(printed).not.toContain("5.0x");
    expect(printed).not.toContain("1.08x");
    expect(printed).not.toContain("0.25%");
  });
});

describe("the one-owner strings", () => {
  it("withdrawalLine on the live record", () => {
    expect(withdrawalLine(heroRecord())).toBe("at the attested share value, no fee on principal");
  });

  it("the stage label", () => {
    expect(VAULT_STAGE_LABEL.attested).toBe("Live · attested");
  });

  it("seven coming-soon cards behind one live record", () => {
    expect(SEED_VAULTS.filter((v) => v.stage !== "attested").length).toBe(7);
    expect(SEED_VAULTS.filter(isLiveRecord).length).toBe(1);
    expect(COMING_SOON.label).toBe("Coming soon");
  });

  it("no coming-soon card sorts above the live record under any key", () => {
    const keys = [
      (a: (typeof SEED_VAULTS)[number], b: (typeof SEED_VAULTS)[number]) => b.modeledApy - a.modeledApy,
      (a: (typeof SEED_VAULTS)[number], b: (typeof SEED_VAULTS)[number]) => b.baseTvlUsd - a.baseTvlUsd,
      (a: (typeof SEED_VAULTS)[number], b: (typeof SEED_VAULTS)[number]) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    ];
    for (const by of keys) {
      const ordered = partitionForDirectory(SEED_VAULTS, by);
      expect(ordered[0]?.slug).toBe(HERO_SLUG);
      expect(ordered.length).toBe(SEED_VAULTS.length);
    }
  });
});
