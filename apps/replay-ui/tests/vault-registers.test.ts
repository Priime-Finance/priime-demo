/**
 * The vault pages' two registers, pinned (docs/plans/LATEST_UI_PORT_SPEC.md
 * WP4.16, H.5): every value captioned `attested` on /vaults, /vaults/[slug]
 * and /portfolio is read off the journals through `lib/vaults/attested.ts`
 * and `lib/vaults/rows.ts`, never typed on the record; the modeled APY is
 * the only number that counts up; the exit sentence, the stage label and the
 * coming-soon count come from their one owner each.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

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
import {
  VAULT_STAGE_LABEL,
  type PublishedLane,
  type RouterAutomation,
} from "@/lib/vaults/store";
import { routerReadout } from "@/components/vaults/AutomationsSection";
import { RELOCATION_ACTION } from "@/components/vaults/ActivitySection";
import {
  FLOOR_PAIR_MAX_CONCENTRATION_PCT,
  FLOOR_PAIR_MOVE_WEIGHT,
  FLOOR_PAIR_TURNOVER_PCT_WEEK,
} from "@/lib/canvas/floor-pair";
import {
  DEMO_SUSTAIN_HOURS,
  DEMO_SUSTAIN_PINS_HOURLY,
  DEMO_UPGRADE_REARM,
  DEMO_UPGRADE_THRESHOLD,
} from "@/lib/canvas/orchestrator/demo-rules";

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

/* ══════════════════════════════════════════════════════════════════════════
   THE ROUTER'S REGISTER (plan R6). Every number this card prints is modeled,
   says so once, and comes out of an owner. The strings below are read off
   `routerReadout`, which is the object the card renders, so this pins what
   ships rather than a second copy of the arithmetic.
   ═══════════════════════════════════════════════════════════════════════ */

const ROUTER_LANES: PublishedLane[] = [
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

const ROUTER_AUTOMATION: RouterAutomation = {
  lanes: ROUTER_LANES,
  thresholdApy: DEMO_UPGRADE_THRESHOLD,
  rearmApy: DEMO_UPGRADE_REARM,
  sustainHours: DEMO_SUSTAIN_HOURS,
  /* The switch's own three numbers (G1), from their one owner. */
  moveWeight: FLOOR_PAIR_MOVE_WEIGHT,
  maxConcentrationPct: FLOOR_PAIR_MAX_CONCENTRATION_PCT,
  turnoverBudgetPctWeek: FLOOR_PAIR_TURNOVER_PCT_WEEK,
  ruleSentence: "",
};

describe("the router instrument prints the owners and nothing else", () => {
  const read = routerReadout(ROUTER_AUTOMATION);

  it("the reading is the gap at TWO decimals, because one erases it", () => {
    expect(read.gapText).toBe("+0.10pp");
    // At one decimal the whole subject of the card rounds away.
    expect(read.loopText).toBe("3.08%");
    expect(read.floorText).toBe("2.97%");
    expect(read.asOfText).toBe("Sep 7, 2026");
  });

  it("the bar, the hysteresis and the whole-lane move come from their owners", () => {
    expect(read.barText).toBe(`${(DEMO_UPGRADE_THRESHOLD * 100).toFixed(2)}pp`);
    expect(read.rearmText).toBe(`${(DEMO_UPGRADE_REARM * 100).toFixed(2)}pp`);
    /* THE WHOLE LANE, from an even split: 50.0pp, the same number the measured
       replay's one decision records. ONE number for a move (item 8d). */
    expect(read.moveText).toBe("50.0pp");
    expect(read.maxMove).toBe(0.5);
  });

  it("the clock counts observations: one cell per hour, none filled today", () => {
    expect(read.cells).toBe(DEMO_SUSTAIN_PINS_HOURLY);
    expect(DEMO_SUSTAIN_HOURS).toBe(DEMO_SUSTAIN_PINS_HOURLY);
    expect(read.filled).toBe(0);
    expect(read.clockLabel).toBe("0 of 48 hours behind");
  });

  it("the lit row is the state, and it is Hold", () => {
    expect(read.lit).toBe(1);
    // Nothing is armed, so the chip has no licence to say so.
    expect(read.clockFull).toBe(false);
  });

  it("the last move prints absolute, because the page's own clock switches past 60 days", () => {
    expect(read.lastMoveText).toBe("Jun 12, 2026");
    expect(read.lastMoveText).not.toMatch(/ago/);
  });

  it("the allocation is the record's, in the record's own lane labels", () => {
    expect(read.allocationText).toBe("Leveraged loop 100%, USDC lending 0%");
  });

  it("the needle sits between the two move stops", () => {
    expect(read.needlePct).toBeGreaterThan(2.5);
    expect(read.needlePct).toBeLessThan(97.5);
    // Just past the middle: a +0.10pp lead on a ±4.50pp axis.
    expect(read.needlePct).toBeCloseTo(51.16, 1);
  });

  /* THE STOPS ARE SHARES AND MUST SUM TO ONE. `.vxe-bar` is a flex row and
     `.vxe-labels` a grid: both distribute FREE space by these weights, so a
     set summing to 0.09 draws a 59px band inside a 654px card. That shipped
     for one browser pass and this is the assertion that would have caught
     it without one. */
  it("the four band stops sum to the whole bar", () => {
    expect(read.zMove * 2 + read.zRearm + read.zHold).toBeCloseTo(1, 9);
    for (const z of [read.zMove, read.zRearm, read.zHold]) expect(z).toBeGreaterThan(0);
  });
});

describe("the router's copy carries the ban and the register", () => {
  const automations = readFileSync(
    join(process.cwd(), "components/vaults/AutomationsSection.tsx"),
    "utf8",
  );
  const activity = readFileSync(
    join(process.cwd(), "components/vaults/ActivitySection.tsx"),
    "utf8",
  );

  it("the reading's tail names its register AND its clock, never the live heartbeat", () => {
    /* G3: two numbers on one page, each saying which question it answers. The
       hero is `published at 2.50x, modeled`; this reading is the capture's
       last day and says so. */
    expect(automations).toContain('className="vxe-modeled"');
    expect(automations).toContain('<i className="vxe-modeled">measured</i>');
    /* The date is in the reading, one line above the tag, so `measured` is
       stated once and the pair reads `measured Sep 7, 2026`. */
    const reading = routerReadout(ROUTER_AUTOMATION);
    expect(reading.readingLine).toContain(`(measured ${reading.asOfText})`);
    expect(
      readFileSync(join(process.cwd(), "components/vaults/VaultDetail.tsx"), "utf8"),
    ).toContain("published at ${lev.toFixed(2)}x, modeled");
    // One heartbeat per surface: `.vxe-live` belongs to the polled readings.
    const card = automations.slice(
      automations.indexOf("function RouterInstrument"),
      automations.indexOf("/* ── 1. Dynamic leverage"),
    );
    expect(card.length).toBeGreaterThan(0);
    expect(card).not.toContain("vxe-live");
    // Green on this card would celebrate a move nobody asked for.
    expect(card).not.toContain("vxi-chip--armed");
  });

  it("the relocation verb is available now, and the ban is on the claims that are still false", () => {
    /* THE BAN MOVED WITH THE MECHANISM (G1). `relocates` was banned because a
       band shift cannot empty a lane; the switch does empty it, and the
       measured replay leaves the loop at exactly zero. What stays banned is
       the vaguer claim: a router that "moves the capital to" a better lane
       whenever it finds one is the yield-follower this pair is not. */
    for (const src of [automations, activity]) {
      for (const banned of ["moves the capital to", "follows the yield"]) {
        expect(src).not.toContain(banned);
      }
    }
    expect(RELOCATION_ACTION).toBe("Capital relocated");
  });

  it("the vault page's data face stays Geist Mono: the canvas's mono does not cross the seam", () => {
    const dir = join(process.cwd(), "components/vaults");
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".tsx") || n.endsWith(".ts"))) {
      const src = readFileSync(join(dir, f), "utf8");
      expect(src, `${f} carries the canvas mono`).not.toContain("var(--fm)");
      expect(src, `${f} names IBM Plex`).not.toContain("IBM Plex");
    }
  });

  /* SCOPED TO THE ROUTER'S OWN CODE, deliberately. Both files carry em
     dashes in prose block comments that predate this wave and are not
     rendered; widening this to the whole file would fail on documentation
     rather than on copy. */
  it("no em dash reaches the router's own code", () => {
    const card = automations.slice(
      automations.indexOf("export interface RouterReadout"),
      automations.indexOf("/* ── 1. Dynamic leverage"),
    );
    const rows = activity.slice(
      activity.indexOf("export const RELOCATION_ACTION"),
      activity.indexOf("function VerifyKey"),
    );
    expect(card.length).toBeGreaterThan(0);
    expect(rows.length).toBeGreaterThan(0);
    for (const src of [card, rows]) expect(src).not.toContain("—");
  });
});
