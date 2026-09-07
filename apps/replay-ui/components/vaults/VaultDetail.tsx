"use client";

/* Ported from build.priime.finance eb6d33a (docs/plans/LATEST_UI_PORT_SPEC.md WP4). */
/**
 * /vaults/[slug]: the asset page (docs/plans/LATEST_UI_PORT_SPEC.md E).
 * Header zone, stat band, capacity instrument, then ONE bounded panel: the
 * sticky section tabs as its header across both columns, row 1 the four
 * modeled sections beside the sticky deposit rail, rows 2 and 3 the
 * Verification section (the board, the strike ledger, the attestation) and
 * the Activity ledger spanning both columns.
 *
 * Two registers on one page, and they never mix:
 * - MODELED: the APY, the projection, the automation instruments and their
 *   thresholds, labeled so wherever they render. The modeled APY is the only
 *   number that counts up.
 * - ATTESTED: the NAV, the share value, the strike ledger and the quorum,
 *   read off the captured NAV-strike journals through `lib/vaults/rows.ts`
 *   and `lib/vaults/pipeline.ts`, never labeled modeled, never counted,
 *   ticked or flashed.
 *
 * Rendering model: seed vaults resolve synchronously from SEED_VAULTS so the
 * page (and its section anchors) server-renders; the published record
 * hydrates from localStorage in the mount effect. Clock-derived values render
 * from a minute-quantized timestamp on the first pass (server and client
 * agree), then a 1s ticker takes over so the instruments drift live.
 */

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import ActivitySection from "./ActivitySection";
import { AttestationPanel } from "./AttestationPanel";
import AutomationsSection, {
  collarForfeitForVault,
} from "./AutomationsSection";
import DepositRail, {
  apyDisplayable,
  capacityReading,
  depositCeiling,
  DEPOSIT_CONFIRMATION_MS,
  type CapacityReading,
} from "./DepositRail";
import PerformanceSection from "./PerformanceSection";
import SectionTabs, { type TabSection } from "./SectionTabs";
import { StrikeLedger } from "./StrikeLedger";
import { useCountUp } from "./useCountUp";
import { VerificationCanvas } from "./VerificationCanvas";
import { apyCaption, feeRows, type FeeRecordRef } from "@/lib/canvas/fees";
import { isModeledBinding } from "@/lib/canvas/capacity";
import { collarForfeitLine } from "@/lib/canvas/templates";
/* The floor lane's rate provenance and the capture's own clock, from their
   one owner each. Neither the pool id nor the date is retyped here. */
import { ROUTER_HISTORY_SOURCES } from "@/lib/canvas/router-history";
import { measuredRouterReplay, routerDayLabel } from "@/lib/canvas/router-replay";
import { APPLIED_LEVERAGE_LABEL } from "@/lib/canvas/labels";
import {
  HF_TARGET_CAP_BPS,
  MIN_DEPOSIT_USD,
  PRODUCT_MIN_LEVERAGE,
} from "@/lib/canvas/param-schema";
import { HERO_SLUG } from "@/lib/demo-scope";
import { AWAITING_LABEL, HERO_SHARES_OUTSTANDING } from "@/lib/vaults/attested";
import type { Capture } from "@/lib/vaults/pipeline";
import { heroNavPerShare, heroNavUsd, heroStrikes } from "@/lib/vaults/rows";
import { SEED_VAULTS } from "@/lib/vaults/seeds";
import {
  depositorModuleLines,
  fmtHf,
  fmtLev,
  fmtPct,
  fmtUsd,
  INCUBATING_LINE,
  loadPositions,
  loadUserVaults,
  loadWithdrawals,
  recordModuleNames,
  riskGrade,
  routerMaxMoveFrac,
  shareValueAt,
  VAULT_STAGE_LABEL,
  vaultDescription,
  vaultStage,
  recordVenueParts,
  VAULTS_EVENT,
  type PositionRecord,
  type VaultRecord,
  type VaultStage,
  type WithdrawalRecord,
} from "@/lib/vaults/store";

const DAY_MS = 86400e3;

/** The band's own life, re-exported for any surface that trails it. */
export { DEPOSIT_CONFIRMATION_MS };

/**
 * The section strip, in reading order: the four modeled sections, then the
 * proof, then the ledger. Verification sits between Parameters and Activity
 * (E.8): the quorum demo at the end, just above the action list.
 */
const SECTIONS: TabSection[] = [
  { id: "overview", label: "Overview" },
  { id: "automations", label: "Automations" },
  { id: "performance", label: "Performance" },
  { id: "parameters", label: "Parameters" },
  { id: "verification", label: "Verification" },
  { id: "activity", label: "Activity" },
];

/** Below this width the board is not rendered; the ledger and rows stand in (E.8). */
const BOARD_MIN_WIDTH_PX = 700;

/** The Overview note, one owner (A.3 #30). */
export const OVERVIEW_NOTE =
  "Performance on this page is modeled. The NAV, the share value and the strike ledger are read off the journal.";

/** The Verification panel's prose and the mandatory README line (E.8). */
const VERIFICATION_PROSE =
  "Three operators re-execute the NAV from one component digest and one input block. The quorum attests the number only when their result hashes agree, so a single operator cannot move the NAV it reports.";
const REPLAYING_LINE =
  "Replaying captured journal. These strikes were recorded on Base and are replayed here; the page is not polling a live chain.";

/**
 * THE capacity instrument (founder call, 2026-08-22): how much of this
 * strategy's total capacity the TVL already represents, as a headline
 * indicator rather than a line in a parameter table.
 *
 * Instrument rules, not decoration rules: hairline rulings at the quarters;
 * a terminal value label riding the fill's own end, clamped inside the
 * track; both endpoints named in dollars, and the binding resource named;
 * an honest empty state; one draw-in, on entrance, never a loop. The fill is
 * `max(2px, frac)` so the draw-in lands on a mark (F.9).
 *
 * MOTION FALLBACK, explicit. The resting width is the INLINE width, and the
 * animation only scales the element about its left edge from 0 to 1, an
 * identity at rest, so `animation:none` under prefers-reduced-motion leaves
 * a correctly-sized bar rather than an empty track.
 *
 * At capacity is a STATE, not an error: same ink, same track, no red.
 */
function CapacityBar({
  reading,
  usedNoun = "deposited",
  bind,
}: {
  reading: CapacityReading;
  usedNoun?: string;
  /** The head's right-hand line; defaults to the record's binding. */
  bind?: string | null;
}) {
  const pct = reading.frac * 100;
  const w = `${pct.toFixed(2)}%`;
  const bindText = bind === undefined ? reading.binding : bind;
  return (
    <section
      className={`vxcap${reading.full ? " vxcap--full" : ""}`}
      aria-label="Capacity utilization"
    >
      <div className="vxcap-head">
        <i>{reading.head}</i>
        {bindText ? <span className="vxcap-bind">{bindText}</span> : null}
      </div>
      <div
        className="vxcap-track"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-valuetext={`${reading.pct} of ${reading.totalUsd} capacity used, ${reading.usedUsd} ${usedNoun}`}
      >
        {[25, 50, 75].map((r) => (
          <span
            key={r}
            className="vxcap-rule"
            style={{ left: `${r}%` }}
            aria-hidden
          />
        ))}
        <span
          className="vxcap-fill"
          style={{ width: `max(2px, ${w})` }}
          aria-hidden
        />
        {/* The tip label is positioned by clamp() so 0% and 100% both keep it
            inside the rulings instead of hanging off an edge. */}
        <span
          className="vxcap-tip"
          style={{ left: `clamp(20px, ${w}, calc(100% - 20px))` }}
        >
          {reading.pct}
        </span>
      </div>
      <div className="vxcap-ends">
        <span>
          <b>{reading.usedUsd}</b> {usedNoun}
        </span>
        <span>
          <b>{reading.totalUsd}</b> total capacity
        </span>
      </div>
    </section>
  );
}

// ── Parameters block: the pure rules, exported so they are pinned ───────────

export interface ParamRow {
  label: string;
  value: string;
}

/**
 * A LANE row names its venue AND its market in one label (`Hyperliquid ·
 * ETH-USD`) and its value is that lane's share of capital. It dedupes on its
 * EXACT full label only, and never participates in the family rule in either
 * direction.
 */
export function isLaneRow(label: string): boolean {
  return label.includes(" · ");
}

/**
 * The whole Parameters dedupe policy as one pure fold, in row order.
 * `paramRows` builds its raw list and hands it here; there is no second
 * implementation of this rule anywhere in the component.
 */
export function dedupeParamRows(input: ParamRow[]): ParamRow[] {
  const rows: ParamRow[] = [];
  for (const row of input) {
    const key = row.label.toLowerCase();
    if (isLaneRow(row.label)) {
      if (!rows.some((r) => r.label.toLowerCase() === key)) rows.push(row);
      continue;
    }
    const family = key.split(" ")[0];
    const dup = rows.some(
      (r) =>
        r.label.toLowerCase() === key ||
        (!isLaneRow(r.label) &&
          r.value === row.value &&
          r.label.toLowerCase().split(" ")[0] === family),
    );
    if (!dup) rows.push(row);
  }
  return rows;
}

/**
 * A record with no borrow leg. Two independent readings, either one decides:
 * the applied leverage the model priced sits at or under
 * `PRODUCT_MIN_LEVERAGE` (1), or the published health target is the
 * `HF_TARGET_CAP_BPS` sentinel, which is what the canvas writes when there
 * is no liquidation line to defend. Such a record prints no protection
 * envelope.
 */
export function unleveredRecord(
  v: Pick<VaultRecord, "appliedLeverage" | "hfTargetBps" | "automations">,
): boolean {
  if (v.hfTargetBps === HF_TARGET_CAP_BPS) return true;
  const applied =
    v.appliedLeverage ?? v.automations?.leverage?.targetLeverage ?? null;
  return (
    applied !== null &&
    Number.isFinite(applied) &&
    applied <= PRODUCT_MIN_LEVERAGE
  );
}

/** Re-exported from the one owner (`lib/canvas/fees.ts`) so this module's
 *  existing importers keep their entry point while the SENTENCE has a single
 *  declaration: the review sheet prints the same call. */
export { apyCaption };

/**
 * The fee schedule, appended verbatim to every record, in `feeRows(record)`
 * order: four rows, byte-identical to the review sheet the depositor read
 * before publishing. The record is passed through so the Withdrawal row is
 * the live record's own (`at the attested share value, no fee on
 * principal`, A.3 #23). `lib/canvas/fees.ts` is the single owner of those
 * strings; this function owns only their placement.
 */
export function withFeeRows(
  rows: ParamRow[],
  record?: FeeRecordRef | null,
): ParamRow[] {
  const fees = feeRows(record);
  const labels = new Set(fees.map((r) => r.label.toLowerCase()));
  return [...rows.filter((r) => !labels.has(r.label.toLowerCase())), ...fees];
}

/**
 * The TVL tile's caption for a MODELED record, pure and exported so its
 * register is pinned: the base in the stage's own register, the reader's
 * recorded deposits in theirs, and the two clauses sum to the number they
 * sit under. The attested record does not use it: its NAV tile is the
 * journal's number alone.
 */
export function tvlCaption(
  stage: VaultStage,
  baseTvlUsd: number,
  myDepositsUsd: number,
): string {
  const base = `${fmtUsd(baseTvlUsd)} ${stage === "incubating" ? "modeled" : "seeded"}`;
  return myDepositsUsd > 0
    ? `${base} + ${fmtUsd(myDepositsUsd)} deposited`
    : base;
}

/** True for the one record whose NAV, share value and strikes are attested. */
export function isAttestedRecord(v: Pick<VaultRecord, "slug">): boolean {
  return v.slug === HERO_SLUG;
}

function fmtCreated(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function VaultDetail({ slug }: { slug: string }) {
  // Seed vaults resolve synchronously (server-renderable); the published
  // record loads in the mount effect. undefined = still resolving, null = not found.
  const [vault, setVault] = useState<VaultRecord | null | undefined>(
    () => SEED_VAULTS.find((x) => x.slug === slug) ?? undefined,
  );
  const [positions, setPositions] = useState<PositionRecord[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRecord[]>([]);
  const [tvlFlash, setTvlFlash] = useState(false);
  // Which capture the board is replaying. Session-local and never persisted:
  // it is a way of looking at the record, not a change to it.
  const [capture, setCapture] = useState<Capture>("honest");
  // The board is not rendered below 700px; the ledger and rows stand in.
  const [wide, setWide] = useState(true);
  // Minute-quantized on first render (SSR + hydration agree), live after mount.
  const [nowMs, setNowMs] = useState(
    () => Math.floor(Date.now() / 60e3) * 60e3,
  );
  const dismissTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);
  const [stripH, setStripH] = useState<number | null>(null);
  const [railH, setRailH] = useState<number | null>(null);

  useEffect(() => {
    const load = () => {
      const v =
        loadUserVaults().find((x) => x.slug === slug) ??
        SEED_VAULTS.find((x) => x.slug === slug) ??
        null;
      setVault(v);
      setPositions(loadPositions().filter((p) => p.vaultSlug === slug));
      setWithdrawals(loadWithdrawals().filter((w) => w.vaultSlug === slug));
      if (v) document.title = `${v.name}, Priime`;
    };
    load();
    window.addEventListener(VAULTS_EVENT, load);
    return () => window.removeEventListener(VAULTS_EVENT, load);
  }, [slug]);

  useEffect(() => {
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${BOARD_MIN_WIDTH_PX}px)`);
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // The strip's height, measured, so the stuck rail's first card top sits at
  // the strip's bottom edge (E.1): `--vxd-strip-h` on the panel. The rail's
  // own height travels too (`--vxd-rail-h`): with a position and the Withdraw
  // block the rail measures about 1,150px, taller than a 1000px viewport, so
  // its sticky top is the lesser of the strip's edge and `100vh - rail`, and
  // the Withdraw block at its foot is reachable while the rail is stuck
  // (measured 2026-09-07 at 1440x1000).
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const strip = panel.querySelector<HTMLElement>(".vxd-tabs");
    const rail = panel.querySelector<HTMLElement>(".vxd-rail-in");
    if (!strip) return;
    const measure = () => {
      setStripH(strip.getBoundingClientRect().height);
      if (rail) setRailH(rail.getBoundingClientRect().height);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(strip);
    if (rail) ro.observe(rail);
    return () => ro.disconnect();
  }, [vault]);

  useEffect(() => {
    const timers = dismissTimers.current;
    return () => timers.forEach(clearTimeout);
  }, []);

  const attested = vault ? isAttestedRecord(vault) : false;

  // Hydration-safe aggregates: positions state starts empty on both server
  // and client, so TVL / depositors never read localStorage during render.
  // The attested share value is the journal's; the modeled one is the clock's.
  const navUsd = attested ? heroNavUsd() : null;
  const navPerShare = attested ? heroNavPerShare() : null;
  const sv = useMemo(
    () =>
      vault ? (attested ? (navPerShare ?? 0) : shareValueAt(vault, nowMs)) : 0,
    [vault, attested, navPerShare, nowMs],
  );
  const myDeposits = useMemo(
    () => positions.reduce((s, p) => s + p.amountUsd, 0),
    [positions],
  );
  const tvlUsd = vault
    ? (attested ? (navUsd ?? 0) : vault.baseTvlUsd) + myDeposits
    : 0;
  // The live owner: base depositors plus the reader while they hold a position.
  const depositors = vault
    ? vault.baseDepositors + (positions.length > 0 ? 1 : 0)
    : 0;

  // The APY display gate: a record that never validated, or whose modeled
  // APY is not a finite number, prints no number here at all.
  const apyOk = vault ? apyDisplayable(vault) : false;
  /* SEEDED (C1, walk W2.4). `modeledApy` is FROZEN on the record, the same
     number on the server and in the browser, so the hero's first render is
     the published value. The modeled APY is the ONLY number that counts up:
     NAV and share value on the attested record land whole. */
  const apyShown = useCountUp(vault && apyOk ? vault.modeledApy : 0, 700, true);
  const tvlShown = useCountUp(attested ? 0 : tvlUsd);
  const svShown = useCountUp(attested ? 0 : sv);
  /* QNT-3: the collar's headline never prints without the upside it was
     paid for, derived at this record's own dials; null off the collar family. */
  const forfeit = useMemo(
    () =>
      vault && apyOk && vault.strategy === "collar"
        ? collarForfeitForVault(vault)
        : null,
    [vault, apyOk],
  );
  const ceiling = useMemo(
    () => (vault ? depositCeiling(vault, tvlUsd) : null),
    [vault, tvlUsd],
  );
  // Null on a record with no reconciled capacity: the bar is then not drawn
  // at all rather than drawn against a denominator nobody published.
  const capRead = useMemo(
    () => (ceiling ? capacityReading(ceiling, tvlUsd) : null),
    [ceiling, tvlUsd],
  );
  /* Null on a record with no router: a single-lane record has one number on
     the page and no second frame to distinguish itself from, so the extra line
     would be noise. `targetLeverage` is the record's own applied leverage, the
     same field the Dynamic leverage instrument prices its envelope at. */
  const heroRegister = useMemo(() => {
    const r = vault?.automations?.router ?? null;
    if (!r || r.lanes.length < 2) return null;
    const lev = vault?.automations?.leverage?.targetLeverage ?? null;
    return lev === null ? "published on this record, modeled" : `published at ${lev.toFixed(2)}x, modeled`;
  }, [vault]);

  const strikes = useMemo(() => (attested ? heroStrikes() : []), [attested]);
  const quorumLabel = strikes[0]?.quorum.thresholdLabel ?? null;

  const paramRows = useMemo(() => {
    if (!vault) return [];
    // The raw list, in reading order (E.7). Every dedupe rule lives in
    // `dedupeParamRows`, so this block only decides WHAT is stated.
    const rows: ParamRow[] = [];
    const push = (label: string, value: string) => {
      rows.push({ label, value });
    };
    /* TWO LANES, TWO HEADS (design 2026-09-07, item 22). On a routed record
       the flat `Market` / `Venue` pair reads as vault-wide while describing
       one lane only, so each lane names itself. A single-lane record keeps
       today's two rows exactly, which is what every record in the product is
       and what the invariance test pins. */
    const routedLanes = vault.automations?.router?.lanes ?? null;
    if (routedLanes && routedLanes.length >= 2) {
      /* The head is the lane's ROLE, not its label: the router's two sides
         are the loop and the floor everywhere else on this page (the
         instrument's band, its cascade, the ledger's detail line), and the
         labels themselves are already the VALUES two rows down. */
      routedLanes.forEach((lane, i) => {
        const role = i === 0 ? "Loop" : i === 1 ? "Floor" : lane.label;
        push(`${role} market`, lane.market);
        push(`${role} venue`, lane.venueLabel);
      });
    } else {
      push("Market", vault.market);
      push("Venue", vault.venue);
    }
    const a = vault.automations;
    const envelope = Boolean(a?.leverage) && !unleveredRecord(vault);
    for (const p of vault.params) {
      // "Risk profile: Standard" is a subjective adjective; never printed.
      if (p.label.toLowerCase() === "risk profile") continue;
      // The record's own `Health bands` row states the same three numbers the
      // `Protection envelope` row below prints from the automation; one
      // quantity, one spelling (H14).
      if (envelope && p.label.toLowerCase() === "health bands") continue;
      push(p.label, p.value);
    }
    if (!attested) {
      // The measurable risk rows and the mechanism sentence, on modeled
      // records. On the attested record the risk register lives in the
      // Automations section (E.6) and Parameters holds the published rows.
      const grade = riskGrade(vault);
      for (const r of grade.rows) push(r.label, r.value);
      push("Main risk", grade.sentence.replace(/^Main risk:\s*/, ""));
    }
    if (a?.leverage) {
      /* ONE QUANTITY, ONE SPELLING (S1, 2026-08-24): `Applied leverage`, the
         record's own published row, wins under the shared label. */
      push(APPLIED_LEVERAGE_LABEL, fmtLev(a.leverage.targetLeverage));
      // Three HEALTH FACTORS, unitless, stated only where there is a borrow
      // leg to trim.
      if (envelope) {
        push(
          "Protection envelope",
          `${fmtHf(a.leverage.emergencyHf)} / ${fmtHf(a.leverage.deleverHf)} / ${fmtHf(a.leverage.leverUpHf)} health`,
        );
      }
    }
    if (a?.hedge) {
      push("Delta band", `±${a.hedge.deltaBandPct.toFixed(1)}%`);
      push(
        "Margin rule",
        `${a.hedge.marginTrimBelowPct}% → ${a.hedge.marginRestorePct}%`,
      );
    }
    if (a?.compound) {
      push("Compound cadence", `${a.compound.cadenceHours}h`);
      push("Harvest threshold", `$${a.compound.thresholdUsd}`);
    }
    if (typeof ceiling?.capacityUsd === "number") {
      push(
        "Capacity",
        ceiling.bindingLabel
          ? `${fmtUsd(ceiling.capacityUsd)}, ${ceiling.bindingLabel}`
          : isModeledBinding(vault.capacityBinding)
            ? `${fmtUsd(ceiling.capacityUsd)} · modeled`
            : fmtUsd(ceiling.capacityUsd),
      );
      push("Remaining capacity", fmtUsd(ceiling.remainingUsd ?? 0));
    }
    // One minimum across the product: the same constant the capacity filter
    // and the deposit rail are held to.
    push("Min deposit", `$${MIN_DEPOSIT_USD.toLocaleString("en-US")}`);
    // The fee schedule closes the block on every record, the same four rows
    // in the same order the review sheet showed before publish.
    return withFeeRows(dedupeParamRows(rows), vault);
  }, [vault, ceiling, attested]);

  /* ── the router's own parameter group ──────────────────────────────────
     Five dials and a provenance line appended to a 17-row flat table with no
     head leaves a reader no way to know whose parameters they are, so the
     router gets the `Also installed` idiom: its own panel with its own head.
     Every figure is the record's, and the record's figures are the quant's
     owners written at publish. The rule sentence leads, in prose, because it
     is the one thing here that is a sentence rather than a number. */
  const routerPanel = useMemo(() => {
    const r = vault?.automations?.router ?? null;
    if (!r || r.lanes.length < 2) return null;
    const maxMove = routerMaxMoveFrac(r);
    const src = ROUTER_HISTORY_SOURCES.aaveUsdcSupply;
    const rows: ParamRow[] = [
      { label: "Move bar", value: `${(r.thresholdApy * 100).toFixed(2)}pp` },
      { label: "Sustain", value: `${r.sustainHours}h` },
      { label: "Re-arm", value: `${(r.rearmApy * 100).toFixed(2)}pp` },
      /* THE WHOLE LANE (G1), stated as the size it is from the even split.
         `routerConcentrationBand` is still the owner of the band and the band
         is now [0, 1], which is why the row that printed it is gone: a row
         reading `0% to 100%` is a control with nothing in it. What replaces it
         is the budget, which is the bound that still binds. */
      { label: "Move size", value: `the whole lane, ${(maxMove * 100).toFixed(1)}pp from an even split` },
      { label: "Moves", value: `${Math.round(r.turnoverBudgetPctWeek / 100)} per week` },
      {
        label: "Floor rate source",
        value: `${src.label}, daily · ${src.provider} ${src.pool.slice(0, 8)} · read ${routerDayLabel(
          measuredRouterReplay().asOfDate,
        )}`,
      },
    ];
    return (
      <div className="vx-panel">
        <div className="vx-panel-h">Router</div>
        <div className="vx-kv vx-kv--prose">
          <span>Rule</span>
          <b>{r.ruleSentence}</b>
        </div>
        {rows.map((row) => (
          <div key={row.label} className="vx-kv">
            <span>{row.label}</span>
            <b>{row.value}</b>
          </div>
        ))}
      </div>
    );
  }, [vault]);

  if (vault === undefined) return <div className="vx-root" />;
  if (vault === null) {
    return (
      <div className="vx-root vx-notfound">
        <span className="vx-kicker">Vaults</span>
        <h1 className="vx-title">This vault does not exist</h1>
        <Link className="vx-cta" href="/vaults">
          Browse all vaults
        </Link>
      </div>
    );
  }

  const inceptionToday =
    Math.floor(nowMs / DAY_MS) ===
    Math.floor(Date.parse(vault.createdAt) / DAY_MS);
  /* ONE OWNER for the venue line: on a routed record `vault.venue` is the
     word `Multi-venue`, which the naive split reads as both the venue and the
     chain. `recordVenueParts` reads the lanes instead and falls through to
     `venueParts` on every record that is not routed. */
  const { venue, chain } = recordVenueParts(vault);
  /* Routed = the record carries the two lanes the router routes between. The
     header reads it because that is the only record whose `venue` field is a
     word rather than a venue. */
  const routed = (vault.automations?.router?.lanes.length ?? 0) >= 2;
  const chainLine =
    typeof vault.chainId === "number" && Number.isFinite(vault.chainId)
      ? `${chain} · ${String(vault.chainId)}`
      : chain;
  const stage = vaultStage(vault);
  const sections = attested
    ? SECTIONS
    : SECTIONS.filter((s) => s.id !== "verification");

  const onDeposited = () => {
    // On a modeled record the TVL ticks blue for a beat, then settles back to
    // ink. The attested cells never flash (F.6). The position reload rides
    // the VAULTS_EVENT listener above.
    if (attested) return;
    setTvlFlash(true);
    dismissTimers.current.push(setTimeout(() => setTvlFlash(false), 600));
  };

  return (
    <div className="vx-root vxd">
      {/* A. Header zone */}
      <Link className="vx-back" href="/vaults">
        ← All vaults
      </Link>
      <header className="vxd-head">
        <h1 className="vxd-title">{vault.name}</h1>
        <div className="vx-dmeta">
          <span className="vx-tag">{vault.strategyLabel}</span>
          {/* THE LIFECYCLE CHIP (R2): the string comes from `VAULT_STAGE_LABEL`,
              the same declaration the directory card reads. The live chips
              keep `.vx-status` and its green dot; the incubating one takes
              the neutral `.vx-tag` pill instead. */}
          {stage === "attested" ? (
            <span className="vx-status">{VAULT_STAGE_LABEL.attested}</span>
          ) : stage === "live" ? (
            <span className="vx-status">{VAULT_STAGE_LABEL.live}</span>
          ) : (
            <span className="vx-tag vx-tag--stage">
              {VAULT_STAGE_LABEL.incubating}
            </span>
          )}
          {/* THE RAW FIELD ON EVERY RECORD THAT HAS ONE, and the composed line
              only where the raw field is the word `Multi-venue`. Rewriting
              this unconditionally would have re-spelled every shipped record's
              header (a funding vault's `Hyperliquid · funding` resolves to a
              chain of `Hyperliquid L1`), so the routed case is the only one
              that moves. */}
          <span className="vx-card-mkt">
            {vault.market} · {routed ? `${venue} · ${chain}` : vault.venue}
          </span>
          <span className="vx-dmeta-cur">
            Curated by <b>{vault.curator}</b>
          </span>
        </div>
        {stage === "incubating" ? (
          <p className="vxd-desc vxd-desc--note vxd-stage-note">
            {INCUBATING_LINE}
          </p>
        ) : null}
        <p className="vx-dsummary">{vault.summary}</p>
      </header>

      {/* B. Stat band (E.3) */}
      <div className="vx-stats">
        <div className="vx-stat" style={{ "--i": 0 } as CSSProperties}>
          <i>Modeled APY</i>
          <b className="apy">{apyOk ? fmtPct(apyShown) : "—"}</b>
          <small>{apyOk ? apyCaption() : "composition never priced"}</small>
          {/* THE REGISTER OF THIS NUMBER, on a routed record (G3). The router
              instrument further down prints the loop's rate for the latest
              captured day and tags it `paying today, measured <date>`. Two
              numbers on one page answering two questions, each saying which:
              this one is the record's own, published at the leverage it was
              published at, and it is modeled. */}
          {apyOk && heroRegister ? <small>{heroRegister}</small> : null}
          {forfeit ? <small>{collarForfeitLine(forfeit)}</small> : null}
        </div>
        {attested ? (
          <>
            {/* The attested cells land whole with the row's rise: read off the
                journal, never counted, ticked or flashed. */}
            <div className="vx-stat" style={{ "--i": 1 } as CSSProperties}>
              <i>NAV</i>
              <b>{navUsd === null ? AWAITING_LABEL : fmtUsd(navUsd)}</b>
              <small>attested, replayed capture</small>
            </div>
            <div className="vx-stat" style={{ "--i": 2 } as CSSProperties}>
              <i>Share value</i>
              <b>
                {navPerShare === null ? AWAITING_LABEL : navPerShare.toFixed(4)}
              </b>
              <small>
                attested NAV over {HERO_SHARES_OUTSTANDING} published shares
              </small>
            </div>
          </>
        ) : (
          <>
            <div className="vx-stat" style={{ "--i": 1 } as CSSProperties}>
              <i>TVL</i>
              <b className={tvlFlash ? "vx-num-flash" : undefined}>
                {fmtUsd(tvlShown)}
              </b>
              <small>{tvlCaption(stage, vault.baseTvlUsd, myDeposits)}</small>
            </div>
            <div className="vx-stat" style={{ "--i": 2 } as CSSProperties}>
              <i>Share value</i>
              <b>{svShown.toFixed(4)}</b>
              <small>1.0000 at inception</small>
            </div>
          </>
        )}
        <div className="vx-stat" style={{ "--i": 3 } as CSSProperties}>
          <i>Depositors</i>
          <b>{depositors}</b>
          {attested ? null : (
            <small>
              {positions.length > 0 ? "including you" : "since inception"}
            </small>
          )}
        </div>
        {/* Capacity is a constraint, not a stat: a vault that cannot absorb
            the deposit is not an opportunity. The remaining comes from the
            live owner (`depositCeiling`). */}
        {typeof ceiling?.capacityUsd === "number" ? (
          <div className="vx-stat" style={{ "--i": 4 } as CSSProperties}>
            <i>Capacity</i>
            <b>{fmtUsd(ceiling.capacityUsd)}</b>
            <small>
              {ceiling.full
                ? "full, no headroom"
                : `${fmtUsd(ceiling.remainingUsd ?? 0)} left`}
              {isModeledBinding(vault.capacityBinding) ? ", modeled" : ""}
            </small>
          </div>
        ) : null}
      </div>

      {/* B2. The capacity instrument, directly under the band it belongs to.
          Absent entirely on a record with no published capacity. On the
          attested record the head reads `$500 attested of $10.0M modeled`
          (F.9). */}
      {capRead ? (
        <CapacityBar
          reading={capRead}
          usedNoun={
            attested
              ? "attested"
              : stage === "incubating"
                ? "modeled"
                : "deposited"
          }
          bind={
            attested && typeof ceiling?.capacityUsd === "number"
              ? `${navUsd === null ? AWAITING_LABEL : fmtUsd(navUsd)} attested of ${fmtUsd(ceiling.capacityUsd)}${isModeledBinding(vault.capacityBinding) ? " modeled" : ""}`
              : undefined
          }
        />
      ) : null}

      {/* D. THE PANEL (E.1): the sticky tab strip is its header across both
          columns; row 1 the four modeled sections beside the sticky rail;
          rows 2 and 3 Verification and Activity across both columns. */}
      <div
        className="vxd-panel"
        ref={panelRef}
        style={
          {
            ...(stripH === null ? {} : { "--vxd-strip-h": `${stripH}px` }),
            ...(railH === null ? {} : { "--vxd-rail-h": `${railH}px` }),
          } as CSSProperties
        }
      >
        {/* C. Sticky section tabs, the panel's header */}
        <SectionTabs sections={sections} />

        {/* Row 1: the four modeled sections beside the sticky rail. The row
            is its own grid so the rail's sticky containing block is THIS row
            (Chrome constrains a sticky grid item to the whole grid container,
            not its area; measured 2026-09-07: the rail rode over the
            Verification panel). It scrolls away exactly when Verification
            begins. */}
        <div className="vxd-row">
          <div className="vxd-cols">
            {/* E. Overview */}
            <section id="overview" className="vxd-sec">
              <h2 className="vxd-sec-h">Overview</h2>
              <div className="vx-panel">
                <p className="vxd-desc">{vaultDescription(vault)}</p>
                <p className="vxd-desc vxd-desc--note">
                  {attested
                    ? OVERVIEW_NOTE
                    : inceptionToday
                      ? "Inception today at 1.0000. All figures on this page are modeled from the vault's published parameters."
                      : "All figures on this page are modeled from the vault's published parameters."}
                </p>
              </div>
              <div className="vx-panel">
                <div className="vx-panel-h">Vault configuration</div>
                <div className="vx-kv">
                  <span>Curator</span>
                  <b>{vault.curator}</b>
                </div>
                <div className="vx-kv">
                  <span>Created</span>
                  <b>{fmtCreated(vault.createdAt)}</b>
                </div>
                <div className="vx-kv">
                  <span>Venue</span>
                  <b>{venue}</b>
                </div>
                <div className="vx-kv">
                  <span>Chain</span>
                  <b>{chainLine}</b>
                </div>
                <div className="vx-kv">
                  <span>Strategy class</span>
                  <b>{vault.strategyLabel}</b>
                </div>
                <div className="vx-kv vx-kv--chips">
                  <span>Modules</span>
                  <span className="vxo-chips">
                    {recordModuleNames(vault).map((m) => (
                      <span key={m} className="vxo-chip">
                        {m}
                      </span>
                    ))}
                  </span>
                </div>
                <div className="vx-kv">
                  <span>Verification</span>
                  <b>
                    {attested && quorumLabel !== null
                      ? `Operator quorum (WAVS), ${quorumLabel} required · attested`
                      : "Operator quorum (WAVS), every action co-signed · modeled"}
                  </b>
                </div>
              </div>
            </section>

            {/* F. Automations, the differentiator */}
            <AutomationsSection vault={vault} nowMs={nowMs} tvlUsd={tvlUsd} />

            {/* G. Performance */}
            <PerformanceSection vault={vault} nowMs={nowMs} />

            {/* H. Parameters */}
            <section id="parameters" className="vxd-sec">
              <h2 className="vxd-sec-h">Parameters</h2>
              <div className="vx-panel">
                {paramRows.map((p) => (
                  <div
                    key={p.label}
                    className={`vx-kv${p.label === "Main risk" ? " vx-kv--prose" : ""}`}
                  >
                    <span>{p.label}</span>
                    <b>{p.value}</b>
                  </div>
                ))}
              </div>
              {routerPanel}
              <div className="vx-panel">
                <div className="vx-panel-h">Composed modules</div>
                {depositorModuleLines(vault).map((m) => (
                  <div key={m.name} className="vx-mod">
                    <b>{m.name}</b>
                    <span>{m.line}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <aside className="vxd-rail">
            <DepositRail
              vault={vault}
              sv={sv}
              positions={positions}
              tvlUsd={tvlUsd}
              onDeposited={onDeposited}
            />
          </aside>
        </div>

        <div className="vxd-wide">
          {/* I. Verification (E.8): the proof, seated full width. */}
          {attested ? (
            <section id="verification" className="vxd-sec">
              <h2 className="vxd-sec-h">Verification</h2>
              <div className="vx-panel">
                <p className="vxd-desc">{VERIFICATION_PROSE}</p>
                <p className="vxd-desc vxd-desc--note">{REPLAYING_LINE}</p>
              </div>
              {wide ? (
                <div className="vx-board-seat">
                  <VerificationCanvas
                    capture={capture}
                    onCapture={setCapture}
                    vault={vault}
                    navPerShare={navPerShare}
                  />
                </div>
              ) : null}
              <div className="vx-panel vx-ledger" style={{ marginTop: 16 }}>
                <div className="vx-panel-h">Strikes</div>
                <StrikeLedger strikes={strikes} />
              </div>
              <AttestationPanel strikes={strikes} />
            </section>
          ) : null}

          {/* J. Activity */}
          <ActivitySection
            vault={vault}
            nowMs={nowMs}
            tvlUsd={tvlUsd}
            positions={positions}
            withdrawals={withdrawals}
            shareValue={sv}
          />
        </div>
      </div>
    </div>
  );
}
