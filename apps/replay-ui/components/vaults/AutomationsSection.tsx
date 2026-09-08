"use client";

/* Ported from build.priime.finance eb6d33a (docs/plans/LATEST_UI_PORT_SPEC.md WP4). */
/**
 * Automations — the section a Morpho vault page structurally cannot have.
 * One instrument card per installed module, in the dashboard's grammar
 * translated to the vault page's cream register: kicker (VENUE · ROLE),
 * title, one-line role sentence, status chip, then the instrument itself.
 * Each card's headline grammar is when it acts: the current modeled value
 * plotted against the vault's published thresholds.
 *
 * READER, NOT AUTHOR. Every threshold on this page is the one the canvas
 * published: the protection envelope comes off `vault.automations` verbatim
 * (store.deriveAutomations prefers the published `liqLtv` / `hfTargetBps` /
 * `hfDeleverageBps` / `hfFloorBps` and only backfills older records), and the
 * only quantity computed here is `distance to liquidation`, from the published
 * liquidation LTV at the applied leverage. Nothing on this page invents a
 * threshold, and no band renders that the record does not carry.
 *
 * Sign discipline: an instrument that would print a negative number under the
 * words earnings, harvest or re-supplied does not render at all. Every module
 * the vault carries is accounted for — instrumented, or listed with its
 * published line — so the section never claims a vault has no automations
 * while it is running some.
 *
 * Reveal choreography: each card gates its draw sequence on first
 * intersection (useInView) — zones scale in, the needle settles, cascade
 * rows rise, and the harvest meter counts + fills. All hidden resting
 * states carry explicit reduced-motion fallbacks in vaults.css.
 */

import {
  accruedSinceCompound,
  canonicalModuleName,
  currentHedgeMarginPct,
  currentLeverage,
  currentNetDelta,
  deleverageDrift,
  deleverageDriftLine,
  fmtHf,
  fmtLev,
  fmtUsdFull,
  hashString,
  healthFactorAt,
  lastActionTimes,
  hedgeInstrumentHead,
  moduleDepositorLine,
  railsArmed,
  rand01,
  routerMaxMoveFrac,
  routerRearmStopText,
  recordModuleNames,
  recordVenueParts,
  type LeverageAutomation,
  type RedemptionAutomation,
  type RouterAutomation,
  type VaultAutomations,
  type VaultRecord,
} from "@/lib/vaults/store";
/* MINUS is U+2212, the ledger's one sign glyph for numeric runs; `pct` is the
   product's one % formatter and carries it. An ASCII hyphen beside mono
   tabular digits is the drift the glyph sweep (2026-08-24) removed. */
import { MINUS, fmtCapacityUsd, pct, usd } from "@/lib/canvas/format";
import { openingCase } from "@/lib/canvas/graph-ops";
import { collarForfeit, type CollarForfeit } from "@/lib/canvas/templates";
/* The router's two published rates and its measured decisions, each from its
   one owner. The card retypes neither. */
import { routerPublishedToday } from "@/lib/canvas/router-history";
import { measuredRouterReplay, routerDayLabel } from "@/lib/canvas/router-replay";
/* The two lanes' own measured histories: the reserve's unborrowed liquidity
   under the Redemption route card, the pair's drift under Dynamic leverage.
   Each from its one owner, each labelled with its own window. */
import {
  COLLATERAL_PRICE_PAIR,
  RESERVE_LIQUIDITY_VENUE,
  collateralDrift,
  reserveLiquidityLatest,
  reserveLiquidityLow,
  reserveLiquiditySeries,
} from "@/lib/canvas/lane-history";

import type { CSSProperties } from "react";

import Sparkline from "./Sparkline";
import { useCountUp } from "./useCountUp";
import { valueKind } from "@/lib/vaults/param-kind";
import { useInView } from "./useInView";

/**
 * A FOOT READING, with its type register decided by the value and nowhere
 * else. The feet under an instrument are heads in the sans with their values
 * beside them, and most of those values are figures with a unit. The ones
 * that are not, `none since publish`, `every block`, `just now`, `in 13h`,
 * `app.aave.com`, are words. Printing words in the mono is the defect
 * this closes (founder, 2026-09-08). `valueKind` is the one owner; a `<b>`
 * here never decides for itself.
 */
function FootVal({ children }: { children: string }) {
  return <b data-kind={valueKind(children)}>{children}</b>;
}

const HOUR_MS = 3600e3;
const DAY_MS = 86400e3;

/** The ONE spelling of the router module, so the instrument and the covered
 *  set that keeps it out of `Also installed` can never disagree. */
const ROUTER_MODULE = "Capital router";

function relAgo(ms: number, nowMs: number): string {
  const d = Math.max(0, nowMs - ms);
  if (d < 90e3) return "just now";
  if (d < 3600e3) return `${Math.round(d / 60e3)} min ago`;
  if (d < 48 * 3600e3) return `${Math.round(d / 3600e3)}h ago`;
  return `${Math.round(d / 86400e3)}d ago`;
}

function relIn(ms: number, nowMs: number): string {
  const d = Math.max(0, ms - nowMs);
  if (d < 90e3) return "under a minute";
  if (d < 3600e3) return `in ${Math.round(d / 60e3)} min`;
  if (d < 48 * 3600e3) return `in ${Math.round(d / 3600e3)}h`;
  return `in ${Math.round(d / 86400e3)}d`;
}

function clampPct(p: number): number {
  return Math.min(97.5, Math.max(2.5, p));
}

/**
 * `fmtHf` / `fmtLev` come from the store, not from a local copy.
 *
 * Health factors and leverages are different quantities and never share a
 * formatter: a health factor is unitless (the canvas prints 1.32), a leverage
 * carries the x (3.00x). One `fx` for both is how "1.32x health factor ·
 * 3.00x leverage" got onto the page. A local re-declaration is the same
 * defect one level up — it let the detail panel print the health envelope
 * with the leverage suffix while this panel printed it unitless.
 */

/**
 * Tolerant readers for the published record. The publish path is gaining the
 * full parameter set (liqLtv, the three HF bands, appliedLeverage, hedge
 * leverage, margin reserve, hedge coin, delta band, funding floor, harvest
 * threshold, capacity, chain + block); every one of them is absent on records
 * published before that landed, and on seeds. Reading through these keeps the
 * page correct on both sides of that change without a schema assumption.
 */
function numField(o: unknown, key: string): number | null {
  const raw = (o as Record<string, unknown> | null | undefined)?.[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function strField(o: unknown, key: string): string | null {
  const raw = (o as Record<string, unknown> | null | undefined)?.[key];
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

/** First number in a published parameter row matching `re`, sign preserved. */
function paramNum(v: VaultRecord, re: RegExp): number | null {
  const row = (v.params ?? []).find((p) => re.test(p.label));
  const m = row?.value.match(/-?\d+(?:\.\d+)?/);
  return m ? Number.parseFloat(m[0]) : null;
}

/** Module membership on the ONE vocabulary: `Range engine` reads as `Auto center`. */
function hasModule(v: VaultRecord, name: string): boolean {
  const want = canonicalModuleName(name).toLowerCase();
  return (v.modules ?? []).some((m) => canonicalModuleName(m).toLowerCase() === want);
}

/**
 * Deterministic continuous drift in [-0.5, 0.5] — two adjacent seeded draws
 * interpolated across the step, the same shape store.ts uses for its needles,
 * so every modeled position moves smoothly and agrees between renders.
 */
function slowDrift(seedBase: number, ms: number, stepMs: number): number {
  const idx = Math.floor(ms / stepMs);
  const f = (ms - idx * stepMs) / stepMs;
  const a = rand01(seedBase + idx) - 0.5;
  const b = rand01(seedBase + idx + 1) - 0.5;
  return a + (b - a) * f;
}

function Chip({ tone, label }: { tone: "armed" | "watch"; label: string }) {
  return <span className={`vxi-chip vxi-chip--${tone}`}>{label}</span>;
}

/**
 * ⚠ THE ARMED CHIP READS THE ONE OWNER (recette 2026-08-23, I6/I9).
 *
 * Every instrument card wore a green literal `Armed` while the register's
 * amber row on the same page said `Automations compile in shadow / not
 * armed` — one boolean from two owners, disagreeing on one screen. The
 * register was right: no rail runs any published vault (`compile.ts` writes
 * `railsReady: false` unconditionally), so on a published record every
 * automation compiles in shadow and nothing is armed.
 *
 * All five cards now read `store.railsArmed`, the boolean's one owner. The
 * instruments' modeled readouts (net delta, health factor, harvest meter)
 * keep rendering under the true state — the model still describes what the
 * automation would do; the chip stops claiming it is doing it.
 */
function ArmedChip({ vault }: { vault: VaultRecord }) {
  return railsArmed(vault) ? (
    <Chip tone="armed" label="Armed" />
  ) : (
    <Chip tone="watch" label="In shadow" />
  );
}

/* ── template-family configs, read from the published record ───────────────
 * Both are exported: the Activity ledger builds its `Range recentered` and
 * `Call rolled` rows from these same values and these same clocks, so the
 * instrument footer and the ledger can never disagree. */

export interface RangeConfig {
  /** Half-width of the concentrated range, percent. */
  halfWidthPct: number;
  /** Recenter fires at this share of the half-width. */
  triggerShare: number;
  /** Modeled hours between recenters — tighter ranges recenter more often. */
  periodMs: number;
}

/**
 * Installed-only: the strategy label is never enough. A delta-neutral lane
 * that ejected its range module must not render a range instrument, the same
 * way a lane that kept it must not be missed because the seed spells it
 * `Range engine`.
 */
export function rangeConfig(v: VaultRecord): RangeConfig | null {
  if (!hasModule(v, "Auto center")) return null;
  const halfWidthPct = Math.abs(paramNum(v, /range width/i) ?? 2.5) || 2.5;
  const trig = paramNum(v, /recenter trigger/i);
  const triggerShare = trig !== null && trig > 0 && trig <= 100 ? trig / 100 : 0.6;
  const jitter = hashString(`${v.slug}:rc`) % 9;
  const periodMs = (12 + halfWidthPct * 16 + jitter) * HOUR_MS;
  return { halfWidthPct, triggerShare, periodMs };
}

export interface CollarConfig {
  /** Call strike, percent above spot. Null when no call leg is installed. */
  strikePct: number | null;
  /** Put floor, percent below spot, positive magnitude. Null with no put leg. */
  floorPct: number | null;
  /** Roll tenor in days. Null with no call leg: the put has no published tenor. */
  rollDays: number | null;
}

/** Each leg renders only if the vault carries it. Ejecting the put removes
 *  the floor from the page, rather than leaving a floor nothing is holding. */
export function collarConfig(v: VaultRecord): CollarConfig | null {
  const hasCall = hasModule(v, "Covered call");
  const hasPut = hasModule(v, "Protective put");
  if (!hasCall && !hasPut) return null;
  return {
    strikePct: hasCall ? Math.abs(paramNum(v, /call strike/i) ?? 15) || 15 : null,
    floorPct: hasPut ? Math.abs(paramNum(v, /put floor/i) ?? 12) || 12 : null,
    rollDays: hasCall ? Math.abs(paramNum(v, /roll cadence/i) ?? 30) || 30 : null,
  };
}

/**
 * QNT-3 — the record-side read of the collar's companion fact: the upside
 * forfeited above the written strike, at the dials THIS record published.
 * `collarConfig` is the one parser of those rows, and `collarForfeit` is the
 * one derivation of the figure, so a record surface printing the modeled APY
 * composes the two rather than typing either. Null off the collar family, on
 * a record missing either option leg, and on an off-grid dial.
 */
export function collarForfeitForVault(v: VaultRecord): CollarForfeit | null {
  const cfg = collarConfig(v);
  if (cfg?.strikePct === null || cfg?.floorPct === null || cfg?.rollDays === null || !cfg) return null;
  return collarForfeit({
    strikePct: cfg.strikePct.toFixed(0),
    floorPct: cfg.floorPct.toFixed(0),
    rollDays: cfg.rollDays.toFixed(0),
  });
}

/** Recenter timestamps, newest first, never before inception. */
export function rangeRecenterTimes(
  v: VaultRecord,
  cfg: RangeConfig,
  nowMs: number,
  count: number,
): number[] {
  const created = Date.parse(v.createdAt);
  const offset = hashString(`${v.slug}:ro`) % cfg.periodMs;
  let t = Math.floor((nowMs - offset) / cfg.periodMs) * cfg.periodMs + offset;
  const out: number[] = [];
  for (let k = 0; k < count && t > created; k++, t -= cfg.periodMs) out.push(t);
  return out;
}

/** Roll timestamps, newest first, never before inception. Empty with no call leg. */
export function collarRollTimes(
  v: VaultRecord,
  cfg: CollarConfig,
  nowMs: number,
  count: number,
): number[] {
  if (cfg.rollDays === null) return [];
  const created = Date.parse(v.createdAt);
  const period = cfg.rollDays * DAY_MS;
  const offset = hashString(`${v.slug}:cr`) % period;
  let t = Math.floor((nowMs - offset) / period) * period + offset;
  const out: number[] = [];
  for (let k = 0; k < count && t > created; k++, t -= period) out.push(t);
  return out;
}

/* ── 0. Capital router: the gap, the 48 hour clock and the rule ──────────
 *
 * PORTFOLIO LEVEL, so it mounts FIRST: every other instrument on this page
 * describes one position, and this one decides how much of the book each
 * position holds.
 *
 * NOT ONE FIGURE ON THIS CARD IS TYPED. The two published rates come from
 * `routerPublishedToday` (lib/canvas/router-history.ts), which prices the
 * demo's own row and the treasury issuer's row through the product's own
 * quote owners on the last day all three captured series cover. The bar, the
 * hysteresis, the founder's 48 hours and the move weight come from the
 * record where it states them and from `lib/canvas/orchestrator/demo-rules.ts`
 * where it does not. The clock's state and the last move come from
 * `measuredRouterReplay()`, which folds that same history through the same
 * rule state machine the dock's run panel folds. If a number appears in this
 * file as a literal it is a defect.
 *
 * THE CHIP IS THE OWNER'S, NEVER A GREEN LITERAL. `In shadow` is what
 * `railsArmed` says of every published record. The only override is `Armed`
 * in the WATCH tone, and only while the sustain window is actually full and a
 * move is pending, which is the same shape the Range instrument uses for
 * `Recentering`. Green on this card would celebrate a move nobody asked for.
 */

/** `+0.10pp` / `−3.00pp`, two decimals, U+2212 on the minus. Two decimals is
 *  the instrument's own subject: at one decimal today's gap rounds to 0.1pp
 *  and the reading stops distinguishing the two lanes at all. */
function ppSigned(frac: number, dp = 2): string {
  const v = frac * 100;
  const rounded = Number(v.toFixed(dp));
  const body = Math.abs(rounded === 0 ? 0 : v).toFixed(dp);
  return `${rounded < 0 ? MINUS : "+"}${body}pp`;
}

/** The capture date the section note names, from the replay's own clock. */
function routerNoteDay(): string {
  return routerDayLabel(measuredRouterReplay().asOfDate);
}

/** `3.00pp`, unsigned, for a threshold that is a magnitude and not a delta. */
function ppMagnitude(frac: number, dp = 2): string {
  return `${Math.abs(frac * 100).toFixed(dp)}pp`;
}

/** A pp value already in percent, signed with the ledger's glyph, for the
 *  drift strip's three printed values. */
function ppDelta(v: number): string {
  const rounded = Number(v.toFixed(2));
  const body = Math.abs(rounded === 0 ? 0 : v).toFixed(2);
  return `${rounded < 0 ? MINUS : rounded > 0 ? "+" : ""}${body}pp`;
}

/** The loop lane's pair on a routed record, the record's market otherwise. */
function loopPairOf(v: VaultRecord): string {
  return v.automations?.router?.lanes?.find((l) => l.family === "loop")?.market ?? v.market;
}

/**
 * THE PAIR'S MEASURED DRIFT UNDER THE ENVELOPE (2026-09-08), as one pure read.
 *
 * The card drew the bands and the cascade and nothing that moved: a reader
 * could see WHERE the trim fires and not whether the pair has ever come near
 * it. The strip is the pair's own price over the captured window against its
 * first day, in the same unit the foot states the trigger in, so the two
 * numbers in the caption are comparable by eye: the worst day the window
 * held, and how far the cascade's first action sits. Null off the one pair
 * the capture covers; nothing is drawn from a series the product does not
 * hold.
 */
export interface DriftStrip {
  /** Percent, oldest first, the first day at zero. */
  series: number[];
  label: string;
}

export function leverageDriftStrip(vault: VaultRecord, lev: LeverageAutomation): DriftStrip | null {
  if (loopPairOf(vault) !== COLLATERAL_PRICE_PAIR) return null;
  const d = collateralDrift();
  if (!d) return null;
  const trigger = deleverageDrift(lev);
  const parts = [
    `${COLLATERAL_PRICE_PAIR}, ${d.days} days from ${routerDayLabel(d.from)}`,
    `worst day ${ppSigned(d.worst.drift)}`,
  ];
  if (trigger !== null) parts.push(`trim after ${ppMagnitude(trigger)}`);
  return { series: d.points.map((p) => p.drift * 100), label: parts.join(" · ") };
}

/**
 * EVERY STRING THE REDEMPTION CARD PRINTS, AS ONE PURE READ, pinned by test
 * the way the router's is.
 */
export interface RedemptionReadout {
  kicker: string;
  role: string;
  settlementText: string;
  readingLine: string;
  provenance: string;
  /** The reserve's unborrowed liquidity, where the capture covers the venue. */
  strip: { series: number[]; label: string } | null;
  tableHead: string;
  rows: { cond: string; val: string; act: string; tone: "tgt" | "del"; lit: boolean }[];
  foot: { k: string; v: string; href?: string }[];
}

export function redemptionReadout(
  r: RedemptionAutomation,
  bookUsd: number,
  /** The levered lane's label on a routed record, so the second row can name
   *  what the router rebuilds; null on a single lane, which prints one row. */
  routedLoopLabel: string | null,
): RedemptionReadout {
  const venueName = r.venueLabel.split("·")[0]?.trim() || r.venueLabel;
  const latest = r.venue === RESERVE_LIQUIDITY_VENUE ? reserveLiquidityLatest() : null;
  const low = r.venue === RESERVE_LIQUIDITY_VENUE ? reserveLiquidityLow() : null;
  const series = latest ? reserveLiquiditySeries() : [];
  const strip =
    latest && low && series.length >= 2
      ? {
          series,
          label: `Unborrowed liquidity, ${series.length} days · low ${fmtCapacityUsd(low.usd)} · book ${fmtCapacityUsd(bookUsd)}`,
        }
      : null;
  const readingLine = latest
    ? `${r.routeLabel} · ${fmtCapacityUsd(latest.usd)} unborrowed in the reserve, measured ${routerDayLabel(latest.date)}`
    : [r.routeLabel, r.window ?? "runs continuously", r.minUsd !== null ? `minimum ${usd(r.minUsd)}` : null]
        .filter((x): x is string => typeof x === "string")
        .join(" · ");
  const rows: RedemptionReadout["rows"] = [
    { cond: "Withdrawal request", val: r.settlementText, act: r.routeLabel, tone: "tgt", lit: true },
  ];
  if (routedLoopLabel !== null) {
    rows.push({
      cond: "Router leaves this lane",
      val: "same route",
      act: `Withdraw, then rebuild the ${routedLoopLabel}`,
      tone: "del",
      lit: false,
    });
  }
  const foot: RedemptionReadout["foot"] = [
    { k: "Route", v: r.routeLabel },
    { k: "Settlement", v: r.settlementText },
    { k: "Minimum", v: r.minUsd !== null ? usd(r.minUsd) : "none" },
    { k: "Daily limit", v: r.limitUsd !== null ? usd(r.limitUsd) : "none" },
  ];
  if (latest) foot.push({ k: "Unborrowed", v: fmtCapacityUsd(latest.usd) });
  if (r.marketUrl) {
    const host = r.marketUrl.replace(/^https?:\/\//, "").split("/")[0] ?? r.marketUrl;
    foot.push({ k: "Reserve", v: host, href: r.marketUrl });
  }
  return {
    kicker: `${venueName} · Exit`,
    role: r.laneLabel
      ? `Leaves the ${r.laneLabel} lane by its published route.`
      : "Leaves the position by its published route.",
    settlementText: r.settlementText,
    readingLine,
    provenance: r.reading,
    strip,
    tableHead: "The route · as the issuer publishes it",
    rows,
    foot,
  };
}

/**
 * EVERY STRING AND EVERY GEOMETRY THE ROUTER CARD PRINTS, AS ONE PURE READ.
 *
 * Exported so the register is PINNED rather than asserted: the test reads the
 * same object the card renders, so "the gap prints +0.10pp at two decimals"
 * and "the last move prints as an absolute date past 60 days" are checked
 * against what actually ships, not against a second copy of the arithmetic.
 */
export interface RouterReadout {
  /** Loop published APY minus the floor's, as a fraction. */
  gap: number;
  gapText: string;
  loopText: string;
  floorText: string;
  floorLabel: string;
  /** The levered lane's own label, `lanes[0].label`. The instrument names
   *  BOTH lanes rather than hard-coding the word `loop` on one side: the
   *  record carries what the canvas called each lane, and a portfolio whose
   *  first lane is not called `loop` must not be described as if it were. */
  loopLabel: string;
  asOfText: string;
  /** The one line the reading states, both lanes, with the measured date on
   *  the lane whose number came from the capture. */
  readingLine: string;
  /** The bar, the hysteresis and the CLAMPED move, as the foot prints them. */
  barText: string;
  /**
   * THE RE-ARM STOP, ON THE GAP AXIS THIS CARD DRAWS, and therefore SIGNED.
   *
   * The card's axis is `loop - floor`, and the rule re-arms when the
   * improvement (`floor - loop`) is at or under `rearmApy`, so the stop sits
   * at MINUS `rearmApy`. It used to print as an unsigned magnitude with a
   * hard-coded minus in front of it, which was true only while `rearmApy` was
   * positive. At the shipped 1.508% bar R28's 2pp gap puts it at -0.492%, so
   * the stop is at +0.49pp: the loop has to LEAD by that much before the rule
   * that left it re-arms. One string, printed by the band stop and the foot,
   * so the two cannot disagree about which side of zero it is on.
   */
  rearmText: string;
  moveText: string;
  maxMove: number;
  /** One cell per hour of the founder's window, and how many are filled. */
  cells: number;
  filled: number;
  clockLabel: string;
  /** Which cascade row is lit: 0 move to floor, 1 hold, 2 move to loop, 3 cooldown. */
  lit: 0 | 1 | 2 | 3;
  /** Full sustain window with a move pending. The ONLY licence for `Armed`. */
  clockFull: boolean;
  lastMoveText: string;
  allocationText: string | null;
  /** Band geometry: the needle's percent, and the four stops as SHARES that
   *  sum to 1. They have to be shares: `.vxe-bar` is a flex row and
   *  `.vxe-labels` a grid, and both distribute FREE space by their weights,
   *  so raw APY fractions (0.015 / 0.02 / 0.04 / 0.015) summed to 0.09 and
   *  drew a 59px band inside a 654px card. Caught in a browser. */
  needlePct: number;
  zMove: number;
  zRearm: number;
  zHold: number;
}

export function routerReadout(r: RouterAutomation): RouterReadout {
  const replay = measuredRouterReplay();
  const today = routerPublishedToday();

  const loopLane = r.lanes[0];
  const floorLane = r.lanes[1];
  const loopApy = today?.loop ?? loopLane?.publishedApy ?? null;
  const floorApy = today?.floor ?? floorLane?.publishedApy ?? null;
  /* The gap the card is about. The published pair and the replay are two
     reads of ONE day, so the pair wins when both are present and the replay
     is the fallback: neither is ever averaged with the other. */
  const gap = loopApy !== null && floorApy !== null ? loopApy - floorApy : replay.gapApy;

  /* The move, through the ONE owner in the store, which is the same call the
     Parameters row makes. Under the switch it is the whole lane, so the
     instrument states it as a word rather than as a size (item 8d): one
     number for a move, and the cascade says `all`. */
  const maxMove = routerMaxMoveFrac(r);

  // The band's axis: the bar either side plus half a bar of headroom, so both
  // move stops are on screen with the needle between them.
  const axis = r.thresholdApy * 1.5;

  // One cell per hour of the founder's window, filled by the hours the
  // trailing lane has actually been behind. Never a bar and never a
  // countdown: a window that counts observations is drawn as observations.
  const cells = Math.max(1, Math.round(r.sustainHours));
  const filled = Math.min(cells, Math.round(replay.hoursBehind));

  // The lit row IS the state; no separate word says "watching".
  const lit: 0 | 1 | 2 | 3 = replay.inCooldown
    ? 3
    : gap <= -r.thresholdApy
      ? 0
      : gap >= r.thresholdApy
        ? 2
        : 1;

  return {
    gap,
    gapText: ppSigned(gap),
    loopText: pct(loopApy, 2),
    floorText: pct(floorApy, 2),
    floorLabel: floorLane?.label ?? "lending lane",
    loopLabel: loopLane?.label ?? "loop",
    asOfText: routerDayLabel(replay.asOfDate),
    barText: ppMagnitude(r.thresholdApy),
    rearmText: routerRearmStopText(r.rearmApy),
    moveText: ppMagnitude(maxMove, 1),
    maxMove,
    /* THE MEASURED PAIR, AS THE READING LINE STATES IT (G3). The loop's rate
       is the latest captured day and it says so with its date; the hero on the
       same page prints the record's own published number at the stored
       leverage and says THAT. Neither is re-typed to match the other. */
    readingLine:
      `${loopLane?.label ?? "loop"} ${pct(loopApy, 2)} (measured ${routerDayLabel(replay.asOfDate)}) ` +
      `against ${floorLane?.label ?? "lending lane"} ${pct(floorApy, 2)}`,
    cells,
    filled,
    clockLabel: `${filled} of ${cells} hours behind`,
    lit,
    clockFull: replay.clockFull,
    /* THE RECORD'S OWN MOVE HISTORY, AND IT IS EMPTY (fix wave 2, ruling 2).
       This used to print the REPLAY's June move, which is a decision the
       modeled 89-day fold took over captured history and not something this
       vault did: the record carries no ledger, the vault has taken no move
       since it was published, and a foot row reading `Jun 12, 2026` claimed
       one. The replay's moves stay where they belong, in the dock's run panel
       and in the backtest. When the record starts carrying a move history this
       line reads it; until then the honest answer is the absence. */
    lastMoveText: "none since publish",
    allocationText:
      loopLane && floorLane
        ? `${loopLane.label} ${(loopLane.allocationBps / 100).toFixed(0)}%, ${floorLane.label} ${(
            floorLane.allocationBps / 100
          ).toFixed(0)}%`
        : null,
    needlePct: clampPct(((gap + axis) / (2 * axis)) * 100),
    // The four stops span the axis exactly: half a bar of headroom, the
    // hysteresis gap, the hold band, and half a bar of headroom again.
    zMove: (0.5 * r.thresholdApy) / (2 * axis),
    zRearm: (r.thresholdApy - r.rearmApy) / (2 * axis),
    zHold: (r.rearmApy + r.thresholdApy) / (2 * axis),
  };
}

function RouterInstrument({ vault, r }: { vault: VaultRecord; r: RouterAutomation }) {
  const { ref, inView } = useInView<HTMLDivElement>();
  /* THROUGH THE ROUTED OWNER, and it has to be: a two-venue record publishes
     the label `Multi-venue`, and the naive split reads that word as the chain
     too, so the one instrument that spans both venues was the one printing
     `Multi-venue · Capital routing` in its kicker. The lanes say Base. */
  const { chain } = recordVenueParts(vault);
  const replay = measuredRouterReplay();
  const read = routerReadout(r);
  const { floorLabel, loopLabel, cells, filled, lit, zMove, zRearm, zHold } = read;
  /* Both lanes are named the same way on every row: `the <label>` inside a
     sentence, capitalised where the label opens one. Without this the card
     read `Move to treasury floor` beside `Move to the loop`, and
     `treasury floor leads by` beside `Loop leads by`: one mechanism, two
     grammars, and the asymmetry read as a difference between the lanes.
     `openingCase` is the one owner of that rule; the plate's bars and the
     dock's bars read the same function. */
  const capFloor = openingCase(floorLabel);
  const capLoop = openingCase(loopLabel);
  const needle = read.needlePct;
  const bar = read.barText;

  return (
    <div ref={ref} className={`vxi${inView ? " vxi--in" : ""}`}>
      <div className="vxi-head">
        <div>
          <span className="vxi-kick">{chain} · Capital routing</span>
          <h3 className="vxi-title">Capital router</h3>
          {/* THE RECORD'S OWN RULE SENTENCE, not a second one from the module
              vocabulary. `routerRuleSentence` is the owner, the review sheet
              published it, and the Parameters panel below prints the same
              string: one rule, one spelling, in the founder's words. */}
          <p className="vxi-role">{r.ruleSentence}</p>
        </div>
        {read.clockFull ? <Chip tone="watch" label="Armed" /> : <ArmedChip vault={vault} />}
      </div>
      <div className="vxi-body">
        <div className="vxe-read">
          <b data-kind={valueKind(read.gapText)}>{read.gapText}</b>
          <span>{read.readingLine}</span>
          {/* THE REGISTER OF THIS NUMBER, AND IT IS NOT THE HERO'S (G3). The
              hero prints the record's published number at the stored leverage
              and tags it `published at 2.50x, modeled`; this one is what the
              two lanes are paying today and the tag says so. The DATE is one
              line up, inside the reading, so `measured` is stated once. */}
          <i className="vxe-modeled">measured</i>
        </div>
        <div className="vxk">
          <div className="vxk-cells" aria-hidden>
            {Array.from({ length: cells }, (_, i) => (
              <span key={i} className={`vxk-cell${i < filled ? " vxk-cell--on" : ""}`} />
            ))}
          </div>
          <div className="vxk-lab">{read.clockLabel}</div>
        </div>
        <div className="vxe-wrap">
          <div className="vxe-bar" aria-hidden>
            <span className="vxe-z vxe-z--del" style={{ flexGrow: zMove }} />
            <span className="vxe-z vxe-z--tgt" style={{ flexGrow: zRearm + zHold }} />
            <span className="vxe-z vxe-z--del" style={{ flexGrow: zMove }} />
          </div>
          <span className="vxe-needle" style={{ left: `${needle}%` }} aria-hidden />
        </div>
        <div
          className="vxe-labels"
          style={{ gridTemplateColumns: `${zMove}fr ${zRearm + zHold}fr ${zMove}fr` }}
        >
          {/* THE BAND'S STOPS SAY WHAT HAPPENS AT THEM, in the cascade's own
              words: `Move to the USDC lending` is what an article welded to a
              lane label produces, and the cascade three rows down already
              spells the action. Same two verbs, same two lanes. */}
          <div className="vxe-lab vxe-lab--del">
            <i>Move all to {floorLabel}</i>
            <b>
              &lt; {MINUS}
              {ppMagnitude(r.thresholdApy)}
            </b>
          </div>
          {/* ONE HOLD ZONE (founder's de-slop, 2026-09-07 night). A switch has
              three states, so the band draws three: the re-arm stop is a
              reading inside the hold zone, not a zone of its own, and the
              live gap already prints as the card's hero number above. */}
          <div className="vxe-lab vxe-lab--tgt">
            <i>Hold · re-arms at</i>
            <b>{read.rearmText}</b>
          </div>
          <div className="vxe-lab vxe-lab--del">
            <i>Rebuild the {loopLabel}</i>
            <b>&gt; +{ppMagnitude(r.thresholdApy)}</b>
          </div>
        </div>
        <div className="vxc">
          <div className="vxc-k">The rule · one check per hour</div>
          <div className="vxc-rows">
            <div className={`vxc-row${lit === 0 ? " vxc-row--on" : ""}`} style={{ "--i": 0 } as CSSProperties}>
              <span className="vxc-dot vxc-dot--del" />
              <span className="vxc-cond">{capFloor} leads by</span>
              <b className="vxc-val">
                {bar} for {r.sustainHours}h
              </b>
              <span className="vxc-arr">→</span>
              <span className="vxc-act">Move all to {floorLabel}</span>
            </div>
            <div className={`vxc-row${lit === 1 ? " vxc-row--on" : ""}`} style={{ "--i": 1 } as CSSProperties}>
              <span className="vxc-dot vxc-dot--tgt" />
              <span className="vxc-cond">Gap inside</span>
              <b className="vxc-val">±{bar}</b>
              <span className="vxc-arr">→</span>
              <span className="vxc-act">Hold</span>
            </div>
            <div className={`vxc-row${lit === 2 ? " vxc-row--on" : ""}`} style={{ "--i": 2 } as CSSProperties}>
              <span className="vxc-dot vxc-dot--del" />
              <span className="vxc-cond">{capLoop} leads by</span>
              <b className="vxc-val">
                {bar} for {r.sustainHours}h
              </b>
              <span className="vxc-arr">→</span>
              <span className="vxc-act">Rebuild the {loopLabel}</span>
            </div>
            <div className={`vxc-row${lit === 3 ? " vxc-row--on" : ""}`} style={{ "--i": 3 } as CSSProperties}>
              <span className="vxc-dot vxc-dot--em" />
              <span className="vxc-cond">Inside the cooldown</span>
              <b className="vxc-val">{replay.cooldownHours}h</b>
              <span className="vxc-arr">→</span>
              <span className="vxc-act">Refuse</span>
            </div>
          </div>
          {/* THE PAYBACK LOCK, ITS OWN LINE. It is not a clause of the rule
              sentence and it is not one of the four cascade rows: it is the
              condition on the WAY BACK, and `lockReverseEdge` holds that edge
              until the last move has earned its own friction. */}
          <div className="vxc-note">the way back waits until the move has paid for itself</div>
        </div>
      </div>
      <div className="vxi-foot">
        <span>
          Bar · <FootVal>{bar}</FootVal>
        </span>
        <span>
          Sustain · <FootVal>{`${String(r.sustainHours)}h`}</FootVal>
        </span>
        <span>
          Re-arm · <FootVal>{read.rearmText}</FootVal>
        </span>
        {read.allocationText === null ? null : (
          <span>
            Allocation · <FootVal>{read.allocationText}</FootVal>
          </span>
        )}
        <span>
          Last move · <FootVal>{read.lastMoveText}</FootVal>
        </span>
      </div>
    </div>
  );
}

/* ── 1. Dynamic leverage: protection envelope + cascade ── */

function LeverageInstrument({
  vault,
  lev,
  nowMs,
}: {
  vault: VaultRecord;
  lev: LeverageAutomation;
  nowMs: number;
}) {
  const { chain } = recordVenueParts(vault);
  const { ref, inView } = useInView<HTMLDivElement>();
  // ONE envelope in this component. `curLev` used to come from a second
  // lookup on the record (`currentLeverage(vault, nowMs)`), which carried a
  // `?? 3` fallback — so the leverage printed at the top of the instrument
  // and the envelope drawn under it could describe two different positions.
  // The instrument prices the envelope it was handed, and nothing else.
  const curLev = currentLeverage(vault, nowMs, lev);
  const hf = healthFactorAt(lev, curLev);

  // The envelope is rendered verbatim. `leverUpHf` and `axisMaxHf` are read
  // tolerantly: a record that publishes no lever-up threshold gets no
  // lever-up zone and no lever-up cascade row, rather than an invented one.
  const floorHf = lev.emergencyHf;
  const delevHf = lev.deleverHf;
  const targetHf = lev.targetHf;
  const leverUpHf = numField(lev, "leverUpHf");
  const axisMaxHf =
    numField(lev, "axisMaxHf") ?? (leverUpHf ?? targetHf) + Math.max(0.05, targetHf - floorHf);

  // ONE definition, the store's: the published liquidation threshold at the
  // applied leverage. Nothing on this page recomputes it.
  // `targetLeverage` on the record IS the applied leverage the canvas priced
  // (store.deriveAutomations takes `appliedLeverage` first), so the printed
  // leverage and the printed distance can never describe two positions.
  const appliedL = lev.targetLeverage;
  // null when the liquidation threshold was inferred from the pair name
  // rather than published. The row is omitted in that case: an unmeasured
  // cushion must not render under a measured label.
  /* ⚠ D2 (2026-08-22, law L6). THE FOOT NAMES THE TRIGGER, NOT THE LINE.
     ------------------------------------------------------------------------
     This slot held `Distance to liquidation · 33% adverse pair move`, and it
     sat in the same foot as the cascade that PRE-EMPTS it. `deriveHfBands`
     places the trim at `target − presetSpread` with `presetSpread` strictly
     positive on all three presets, so the cascade fires strictly before that
     line on every record at every setting — by construction, not by
     measurement. A foot leading on the line was quoting the one number on the
     card that the card's own instrument guarantees is never reached first.

     What replaces it is the trigger in the same unit: how far the pair may
     drift before the cascade acts. `store.deleverageDriftLine` is the owner
     and it is a DIFFERENCE of two readings of `liquidationDistanceAtHf` — the
     same owner the deleted line used — so nothing here computes a new
     quantity, and the cushion itself still renders in the params table above,
     where it is a row in a table rather than a headline.

     Null on an inferred threshold or an unlevered record, and the row is
     omitted rather than dashed: an unmeasured trigger must not render under a
     measured label. */
  const driftText = deleverageDriftLine(lev);
  const drift = leverageDriftStrip(vault, lev);

  const zone = hf < floorHf ? 0 : hf < delevHf ? 1 : leverUpHf !== null && hf > leverUpHf ? 3 : 2;
  const zonePhrase =
    zone === 0 ? "below the floor" : zone === 1 ? "in the deleverage zone" : zone === 2 ? "inside the target band" : "above lever-up";

  const axis = Math.max(0.05, axisMaxHf - 1);
  const topOfTarget = leverUpHf ?? axisMaxHf;
  const wEm = (floorHf - 1) / axis;
  const wDel = Math.max(0, (delevHf - floorHf) / axis);
  const wTgt = Math.max(0, (topOfTarget - delevHf) / axis);
  const wUp = leverUpHf !== null ? Math.max(0, (axisMaxHf - leverUpHf) / axis) : 0;
  const needle = clampPct(((hf - 1) / axis) * 100);
  const times = lastActionTimes(vault, nowMs);
  const cols = leverUpHf !== null ? `${wEm}fr ${wDel}fr ${wTgt}fr ${wUp}fr` : `${wEm}fr ${wDel}fr ${wTgt}fr`;

  return (
    <div ref={ref} className={`vxi${inView ? " vxi--in" : ""}`}>
      <div className="vxi-head">
        <div>
          <span className="vxi-kick">{chain} · Safety controls</span>
          <h3 className="vxi-title">Dynamic leverage</h3>
          <p className="vxi-role">Holds the loop at target. Trims when health drops, adds a layer when there is room.</p>
        </div>
        <ArmedChip vault={vault} />
      </div>
      <div className="vxi-body">
        <div className="vxe-read">
          <b data-kind={valueKind(fmtHf(hf))}>{fmtHf(hf)}</b>
          <span>
            health factor · {fmtLev(curLev)} leverage · {zonePhrase}
          </span>
          <i className="vxe-live">live</i>
        </div>
        {drift ? (
          <div className="vxs">
            <Sparkline series={drift.series} height={64} fill={false} format={ppDelta} />
            <div className="vxs-lab">{drift.label}</div>
          </div>
        ) : null}
        <div className="vxe-wrap">
          <div className="vxe-bar" aria-hidden>
            <span className="vxe-z vxe-z--em" style={{ flexGrow: wEm }} />
            <span className="vxe-z vxe-z--del" style={{ flexGrow: wDel }} />
            <span className="vxe-z vxe-z--tgt" style={{ flexGrow: wTgt }} />
            {leverUpHf !== null ? <span className="vxe-z vxe-z--up" style={{ flexGrow: wUp }} /> : null}
          </div>
          <span className="vxe-needle" style={{ left: `${needle}%` }} aria-hidden />
        </div>
        <div className="vxe-labels" style={{ gridTemplateColumns: cols }}>
          <div className="vxe-lab vxe-lab--em">
            <i>Emergency floor</i>
            <b>&lt; {fmtHf(floorHf)}</b>
          </div>
          <div className="vxe-lab vxe-lab--del">
            <i>Deleverage</i>
            <b>{fmtHf(delevHf)}</b>
          </div>
          <div className="vxe-lab vxe-lab--tgt">
            <i>Target</i>
            <b>{fmtHf(targetHf)}</b>
          </div>
          {leverUpHf !== null ? (
            <div className="vxe-lab vxe-lab--up">
              <i>Lever-up</i>
              <b>&gt; {fmtHf(leverUpHf)}</b>
            </div>
          ) : null}
        </div>
        <div className="vxc">
          <div className="vxc-k">The cascade · one action per check</div>
          <div className="vxc-rows">
            <div className={`vxc-row${zone === 0 ? " vxc-row--on" : ""}`} style={{ "--i": 0 } as CSSProperties}>
              <span className="vxc-dot vxc-dot--em" />
              <span className="vxc-cond">Health factor is below</span>
              <b className="vxc-val">{fmtHf(floorHf)}</b>
              <span className="vxc-arr">→</span>
              <span className="vxc-act">Fast unwind</span>
            </div>
            <div className={`vxc-row${zone === 1 ? " vxc-row--on" : ""}`} style={{ "--i": 1 } as CSSProperties}>
              <span className="vxc-dot vxc-dot--del" />
              <span className="vxc-cond">Health factor between</span>
              <b className="vxc-val">
                {fmtHf(floorHf)} and {fmtHf(delevHf)}
              </b>
              <span className="vxc-arr">→</span>
              <span className="vxc-act">Sell slice, repay borrow</span>
            </div>
            <div className={`vxc-row${zone === 2 ? " vxc-row--on" : ""}`} style={{ "--i": 2 } as CSSProperties}>
              <span className="vxc-dot vxc-dot--tgt" />
              <span className="vxc-cond">
                {leverUpHf !== null ? "Health factor between" : "Health factor above"}
              </span>
              <b className="vxc-val">
                {leverUpHf !== null ? `${fmtHf(delevHf)} and ${fmtHf(leverUpHf)}` : fmtHf(delevHf)}
              </b>
              <span className="vxc-arr">→</span>
              <span className="vxc-act">Hold</span>
            </div>
            {leverUpHf !== null ? (
              <div className={`vxc-row${zone === 3 ? " vxc-row--on" : ""}`} style={{ "--i": 3 } as CSSProperties}>
                <span className="vxc-dot vxc-dot--up" />
                <span className="vxc-cond">Health factor is above</span>
                <b className="vxc-val">{fmtHf(leverUpHf)}</b>
                <span className="vxc-arr">→</span>
                <span className="vxc-act">Add a layer</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <div className="vxi-foot">
        <span>
          Liquidation LTV · <FootVal>{`${(lev.liqLtv * 100).toFixed(1)}%`}</FootVal>
          {lev.liqLtvInferred ? " (inferred from the pair)" : ""}
        </span>
        {driftText === null ? null : (
          <span>
            Cascade acts after · <FootVal>{driftText}</FootVal>
          </span>
        )}
        <span>
          Applied leverage · <FootVal>{fmtLev(appliedL)}</FootVal>
        </span>
        <span>
          Cadence · <FootVal>{lev.cadence}</FootVal>
        </span>
        <span>
          Last rebalance · <FootVal>{relAgo(times.leverage, nowMs)}</FootVal>
        </span>
      </div>
    </div>
  );
}

/* ── 2. The hedge instrument: net-delta gauge + margin rules ── */

function HedgeInstrument({ vault, nowMs }: { vault: VaultRecord; nowMs: number }) {
  const h = vault.automations?.hedge;
  const { ref, inView } = useInView<HTMLDivElement>();
  /* DL-2: the card answers to the record's OWN module name. This head was the
     literal `Dynamic hedge`, so a funding record whose Modules chips read
     `Basis engine` carried an Automations card named on no chip — two lists
     for one machine. `hedgeInstrumentHead` resolves title and role from
     `vault.modules`, the same source the chips print. */
  const head = hedgeInstrumentHead(vault);
  if (!h) return null;
  const delta = currentNetDelta(vault, nowMs);
  const band = numField(h, "deltaBandPct") ?? numField(vault, "deltaBandPct") ?? 0.5;
  const margin = currentHedgeMarginPct(vault, nowMs);
  const pos = clampPct(((delta + band) / (2 * band)) * 100);
  const times = lastActionTimes(vault, nowMs);
  const sign = delta >= 0 ? "+" : MINUS;
  const coin = strField(h, "hlCoin") ?? strField(vault, "hlCoin");
  const hedgeLev = numField(h, "hedgeLeverage") ?? numField(vault, "hedgeLeverage");
  const reserve = numField(h, "reserveFraction") ?? numField(vault, "reserveFraction");
  const fundingFloor = numField(h, "fundingFloorApr") ?? numField(vault, "fundingFloorApr");
  return (
    <div ref={ref} className={`vxi${inView ? " vxi--in" : ""}`}>
      <div className="vxi-head">
        <div>
          <span className="vxi-kick">
            {h.venue} · {coin ? `${coin} perp` : "Hedge"}
          </span>
          <h3 className="vxi-title">{head.title}</h3>
          <p className="vxi-role">{head.role}</p>
        </div>
        <ArmedChip vault={vault} />
      </div>
      <div className="vxi-body">
        <div className="vxe-read">
          <b data-kind={valueKind(`${sign}${Math.abs(delta).toFixed(2)}%`)}>
            {sign}
            {Math.abs(delta).toFixed(2)}%
          </b>
          <span>net delta · target 0 · {Math.abs(delta) <= band ? "inside the band" : "outside the band"}</span>
          <i className="vxe-live">live</i>
        </div>
        <div className="vxe-wrap">
          <div className="vxh-gauge" aria-hidden>
            <span className="vxh-center" />
          </div>
          <span className="vxe-needle" style={{ left: `${pos}%` }} aria-hidden />
        </div>
        <div className="vxh-scale">
          <b>
            {MINUS}
            {band.toFixed(1)}%
          </b>
          <b>0</b>
          <b>+{band.toFixed(1)}%</b>
        </div>
        <div className="vxc">
          <div className="vxc-k">Margin · keeps the short funded</div>
          <div className="vxc-rows">
            <div className="vxc-row" style={{ "--i": 0 } as CSSProperties}>
              <span className="vxc-dot vxc-dot--em" />
              <span className="vxc-cond">Margin is below</span>
              <b className="vxc-val">{h.marginTrimBelowPct}%</b>
              <span className="vxc-arr">→</span>
              <span className="vxc-act">Trim short, restore to {h.marginRestorePct}%</span>
            </div>
            <div className="vxc-row" style={{ "--i": 1 } as CSSProperties}>
              <span className="vxc-dot vxc-dot--del" />
              <span className="vxc-cond">
                {fundingFloor !== null ? "Funding below" : "Funding negative"}
              </span>
              <b className="vxc-val">
                {fundingFloor !== null
                  ? `${pct(fundingFloor, 2)} for ${h.fundingDeallocPeriods} periods`
                  : `${h.fundingDeallocPeriods} periods`}
              </b>
              <span className="vxc-arr">→</span>
              <span className="vxc-act">Exit the venue</span>
            </div>
          </div>
        </div>
      </div>
      <div className="vxi-foot">
        <span>
          Cadence · <FootVal>{h.cadence}</FootVal>
        </span>
        {hedgeLev !== null ? (
          <span>
            Short leverage · <FootVal>{fmtLev(hedgeLev)}</FootVal>
          </span>
        ) : null}
        {reserve !== null ? (
          <span>
            Margin reserve · <FootVal>{`${(reserve * 100).toFixed(0)}%`}</FootVal>
          </span>
        ) : null}
        <span>
          Margin now · <FootVal>{`${margin.toFixed(1)}%`}</FootVal>
        </span>
        <span>
          Last check · <FootVal>{relAgo(times.hedge, nowMs)}</FootVal>
        </span>
      </div>
    </div>
  );
}

/* ── 3. Auto-compound: harvest meter ── */

function CompoundInstrument({
  vault,
  nowMs,
  tvlUsd,
}: {
  vault: VaultRecord;
  nowMs: number;
  tvlUsd: number;
}) {
  const c = vault.automations?.compound;
  const { ref, inView } = useInView<HTMLDivElement>();
  const accrued = c ? Math.max(0, accruedSinceCompound(vault, nowMs, tvlUsd)) : 0;
  const accruedShown = useCountUp(inView ? accrued : 0, 900);
  if (!c) return null;
  const perTick = (tvlUsd * vault.modeledApy * c.cadenceHours) / (365 * 24);
  // Nothing is harvested out of a position that is not earning: the meter,
  // its threshold tick and the "re-supplied" grammar all come off the page
  // rather than render a negative number under the word harvest.
  if (!(perTick > 0)) return null;
  const threshold = numField(c, "thresholdUsd") ?? numField(vault, "thresholdUsd") ?? 25;
  // The axis spans whichever is larger, one check's accrual or the threshold,
  // so a threshold the cadence cannot clear in one check stays on the chart
  // instead of being pinned to the right edge and read as reachable.
  const axisUsd = Math.max(perTick, threshold);
  const ready = accrued >= threshold;
  const fill = Math.min(1, accrued / axisUsd);
  const tickLeft = Math.min(97, Math.max(0, (threshold / axisUsd) * 100));
  const checksNeeded = Math.ceil(threshold / perTick);
  const times = lastActionTimes(vault, nowMs);
  const { venue } = recordVenueParts(vault);
  return (
    <div ref={ref} className={`vxi${inView ? " vxi--in" : ""}`}>
      <div className="vxi-head">
        <div>
          <span className="vxi-kick">{venue} · Compounding</span>
          <h3 className="vxi-title">Auto-compound</h3>
          <p className="vxi-role">Sweeps earned yield back into the position once it clears the threshold.</p>
        </div>
        <ArmedChip vault={vault} />
      </div>
      <div className="vxi-body">
        <div className="vxm">
          <div className="vxm-top">
            <span className="vxm-k">Accrued since last compound</span>
            <b className="vxm-num">{fmtUsdFull(accruedShown)}</b>
          </div>
          <div className="vxm-bar" aria-hidden>
            <span className="vxm-fill" style={{ width: `${Math.max(1.5, fill * 100)}%` }} />
            <span className="vxm-tick" style={{ left: `${tickLeft}%` }} aria-hidden />
          </div>
          <div className="vxm-scale">
            <span>$0</span>
            <span>
              {fmtUsdFull(perTick)} accrues per {c.cadenceHours}h check
              {checksNeeded > 1 ? ` · clears ${fmtUsdFull(threshold)} in ${checksNeeded} checks` : ""}
            </span>
          </div>
        </div>
        <div className="vxc">
          <div className="vxc-rows">
            <div className={`vxc-row${ready ? " vxc-row--on" : ""}`} style={{ "--i": 0 } as CSSProperties}>
              <span className="vxc-dot vxc-dot--tgt" />
              <span className="vxc-cond">At the {c.cadenceHours}h check, accrued at least</span>
              <b className="vxc-val">{fmtUsdFull(threshold)}</b>
              <span className="vxc-arr">→</span>
              <span className="vxc-act">Harvest and re-supply</span>
            </div>
          </div>
        </div>
      </div>
      <div className="vxi-foot">
        <span>
          Cadence · <FootVal>{`${String(c.cadenceHours)}h`}</FootVal>
        </span>
        <span>
          Last compound · <FootVal>{relAgo(times.compound, nowMs)}</FootVal>
        </span>
        <span>
          Next check · <FootVal>{relIn(times.nextCompoundCheck, nowMs)}</FootVal>
        </span>
      </div>
    </div>
  );
}

/* ── 4. Auto center: the range and its recenter trigger ── */

function RangeInstrument({
  vault,
  cfg,
  nowMs,
}: {
  vault: VaultRecord;
  cfg: RangeConfig;
  nowMs: number;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const { venue } = recordVenueParts(vault);
  const w = cfg.halfWidthPct;
  const trigger = w * cfg.triggerShare;
  // Modeled price walk against the range center, in percent.
  const drift = slowDrift(hashString(`${vault.slug}:rg`) * 7 + 5, nowMs, 900e3) * w * 2.1;
  const inRange = Math.abs(drift) <= w;
  const atTrigger = Math.abs(drift) >= trigger;
  const needle = clampPct(((drift + w) / (2 * w)) * 100);
  const outer = (1 - cfg.triggerShare) / 2;
  const last = rangeRecenterTimes(vault, cfg, nowMs, 1)[0] ?? Date.parse(vault.createdAt);
  const sign = drift >= 0 ? "+" : MINUS;
  return (
    <div ref={ref} className={`vxi${inView ? " vxi--in" : ""}`}>
      <div className="vxi-head">
        <div>
          <span className="vxi-kick">{venue} · Range</span>
          <h3 className="vxi-title">Auto center</h3>
          <p className="vxi-role">Recenters the range around spot before the position goes one-sided.</p>
        </div>
        {/* The activity state is the model's; the ARMED state is the owner's.
            `Recentering` describes what the modeled position is doing, which
            the Activity ledger also states; the resting chip must not claim
            `Armed` while the rails are not (recette 2026-08-23, I6). */}
        {atTrigger ? <Chip tone="watch" label="Recentering" /> : <ArmedChip vault={vault} />}
      </div>
      <div className="vxi-body">
        <div className="vxe-read">
          <b data-kind={valueKind(`${sign}${Math.abs(drift).toFixed(2)}%`)}>
            {sign}
            {Math.abs(drift).toFixed(2)}%
          </b>
          <span>
            price against range center · range ±{w.toFixed(1)}% · {inRange ? "in range" : "outside the range"}
          </span>
          <i className="vxe-live">live</i>
        </div>
        <div className="vxe-wrap">
          <div className="vxe-bar" aria-hidden>
            <span className="vxe-z vxe-z--del" style={{ flexGrow: outer }} />
            <span className="vxe-z vxe-z--tgt" style={{ flexGrow: cfg.triggerShare }} />
            <span className="vxe-z vxe-z--del" style={{ flexGrow: outer }} />
          </div>
          <span className="vxe-needle" style={{ left: `${needle}%` }} aria-hidden />
        </div>
        <div
          className="vxe-labels"
          style={{ gridTemplateColumns: `${outer}fr ${cfg.triggerShare}fr ${outer}fr` }}
        >
          <div className="vxe-lab vxe-lab--del">
            <i>Recenter</i>
            <b>
              {MINUS}
              {trigger.toFixed(2)}%
            </b>
          </div>
          <div className="vxe-lab vxe-lab--tgt">
            <i>Fees accrue</i>
            <b>±{trigger.toFixed(2)}%</b>
          </div>
          <div className="vxe-lab vxe-lab--del">
            <i>Recenter</i>
            <b>+{trigger.toFixed(2)}%</b>
          </div>
        </div>
        <div className="vxc">
          <div className="vxc-k">The range · one action per check</div>
          <div className="vxc-rows">
            <div className={`vxc-row${!atTrigger ? " vxc-row--on" : ""}`} style={{ "--i": 0 } as CSSProperties}>
              <span className="vxc-dot vxc-dot--tgt" />
              <span className="vxc-cond">Price inside</span>
              <b className="vxc-val">±{trigger.toFixed(2)}%</b>
              <span className="vxc-arr">→</span>
              <span className="vxc-act">Hold, fees accrue</span>
            </div>
            <div className={`vxc-row${atTrigger && inRange ? " vxc-row--on" : ""}`} style={{ "--i": 1 } as CSSProperties}>
              <span className="vxc-dot vxc-dot--del" />
              <span className="vxc-cond">Price walks past</span>
              <b className="vxc-val">
                ±{trigger.toFixed(2)}% ({(cfg.triggerShare * 100).toFixed(0)}% of range)
              </b>
              <span className="vxc-arr">→</span>
              <span className="vxc-act">Recenter around spot</span>
            </div>
            <div className={`vxc-row${!inRange ? " vxc-row--on" : ""}`} style={{ "--i": 2 } as CSSProperties}>
              <span className="vxc-dot vxc-dot--em" />
              <span className="vxc-cond">Price outside</span>
              <b className="vxc-val">±{w.toFixed(2)}%</b>
              <span className="vxc-arr">→</span>
              <span className="vxc-act">One-sided until the recenter lands</span>
            </div>
          </div>
        </div>
      </div>
      <div className="vxi-foot">
        <span>
          Range width · <FootVal>{`±${w.toFixed(1)}%`}</FootVal>
        </span>
        <span>
          Recenter trigger · <FootVal>{`${(cfg.triggerShare * 100).toFixed(0)}% of range`}</FootVal>
        </span>
        <span>
          Last recenter · <FootVal>{relAgo(last, nowMs)}</FootVal>
        </span>
      </div>
    </div>
  );
}

/* ── 5. Covered call + protective put: the collar band ── */

function CollarInstrument({
  vault,
  cfg,
  nowMs,
}: {
  vault: VaultRecord;
  cfg: CollarConfig;
  nowMs: number;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const { venue } = recordVenueParts(vault);
  const { strikePct: k, floorPct: f, rollDays } = cfg;
  // Axis: the two published thresholds plus half a leg of headroom on each
  // installed side. A leg the vault does not carry contributes no zone, no
  // label and no rule.
  const kAxis = k ?? 15;
  const fAxis = f ?? 15;
  const spot = slowDrift(hashString(`${vault.slug}:cl`) * 11 + 3, nowMs, 3600e3) * (kAxis + fAxis) * 0.9;
  const low = -fAxis * 1.5;
  const high = kAxis * 1.5;
  const span = high - low;
  const wFloor = f !== null ? (f * 0.5) / span : 0;
  const wCap = k !== null ? (k * 0.5) / span : 0;
  const wMid = Math.max(0.05, 1 - wFloor - wCap);
  const needle = clampPct(((spot - low) / span) * 100);
  const below = f !== null && spot <= -f;
  const above = k !== null && spot >= k;
  const last = collarRollTimes(vault, cfg, nowMs, 1)[0] ?? Date.parse(vault.createdAt);
  const next = rollDays !== null ? last + rollDays * DAY_MS : null;
  const sign = spot >= 0 ? "+" : MINUS;
  const title =
    k !== null && f !== null
      ? "Covered call and protective put"
      : k !== null
        ? "Covered call"
        : "Protective put";
  const role =
    k !== null && f !== null
      ? "Calls written above spot fund the put that holds the floor."
      : k !== null
        ? "Writes calls above spot and rolls them on cadence. The premium is the income."
        : "Holds puts below spot, so the position has a floor between roll dates.";
  const cols = [wFloor > 0 ? `${wFloor}fr` : "", `${wMid}fr`, wCap > 0 ? `${wCap}fr` : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div ref={ref} className={`vxi${inView ? " vxi--in" : ""}`}>
      <div className="vxi-head">
        <div>
          <span className="vxi-kick">{venue} · Collar</span>
          <h3 className="vxi-title">{title}</h3>
          <p className="vxi-role">{role}</p>
        </div>
        <ArmedChip vault={vault} />
      </div>
      <div className="vxi-body">
        <div className="vxe-read">
          <b data-kind={valueKind(`${sign}${Math.abs(spot).toFixed(1)}%`)}>
            {sign}
            {Math.abs(spot).toFixed(1)}%
          </b>
          <span>
            spot against the position{f !== null ? ` · floor ${MINUS}${f.toFixed(0)}%` : ""}
            {k !== null ? ` · cap +${k.toFixed(0)}%` : ""}
          </span>
          <i className="vxe-live">live</i>
        </div>
        <div className="vxe-wrap">
          <div className="vxe-bar" aria-hidden>
            {f !== null ? <span className="vxe-z vxe-z--del" style={{ flexGrow: wFloor }} /> : null}
            <span className="vxe-z vxe-z--tgt" style={{ flexGrow: wMid }} />
            {k !== null ? <span className="vxe-z vxe-z--up" style={{ flexGrow: wCap }} /> : null}
          </div>
          <span className="vxe-needle" style={{ left: `${needle}%` }} aria-hidden />
        </div>
        <div className="vxe-labels" style={{ gridTemplateColumns: cols }}>
          {f !== null ? (
            <div className="vxe-lab vxe-lab--del">
              <i>Put floor</i>
              <b>
                {MINUS}
                {f.toFixed(0)}%
              </b>
            </div>
          ) : null}
          <div className="vxe-lab vxe-lab--tgt">
            <i>Participates</i>
            <b>
              {f !== null ? `${MINUS}${f.toFixed(0)}%` : "spot"} to {k !== null ? `+${k.toFixed(0)}%` : "spot"}
            </b>
          </div>
          {k !== null ? (
            <div className="vxe-lab vxe-lab--up">
              <i>Call strike</i>
              <b>+{k.toFixed(0)}%</b>
            </div>
          ) : null}
        </div>
        <div className="vxc">
          <div className="vxc-k">The collar · one action per roll</div>
          <div className="vxc-rows">
            {f !== null ? (
              <div className={`vxc-row${below ? " vxc-row--on" : ""}`} style={{ "--i": 0 } as CSSProperties}>
                <span className="vxc-dot vxc-dot--del" />
                <span className="vxc-cond">Spot at or below</span>
                <b className="vxc-val">
                  {MINUS}
                  {f.toFixed(0)}%
                </b>
                <span className="vxc-arr">→</span>
                <span className="vxc-act">The put pays, the floor holds</span>
              </div>
            ) : null}
            <div className={`vxc-row${!below && !above ? " vxc-row--on" : ""}`} style={{ "--i": 1 } as CSSProperties}>
              <span className="vxc-dot vxc-dot--tgt" />
              <span className="vxc-cond">
                {f !== null && k !== null ? "Spot between" : f !== null ? "Spot above" : "Spot below"}
              </span>
              <b className="vxc-val">
                {f !== null && k !== null
                  ? `${MINUS}${f.toFixed(0)}% and +${k.toFixed(0)}%`
                  : f !== null
                    ? `${MINUS}${f.toFixed(0)}%`
                    : `+${(k ?? 0).toFixed(0)}%`}
              </b>
              <span className="vxc-arr">→</span>
              <span className="vxc-act">
                {k !== null ? "Hold, the premium is the income" : "Hold, the floor stands"}
              </span>
            </div>
            {k !== null ? (
              <div className={`vxc-row${above ? " vxc-row--on" : ""}`} style={{ "--i": 2 } as CSSProperties}>
                <span className="vxc-dot vxc-dot--up" />
                <span className="vxc-cond">Spot at or above</span>
                <b className="vxc-val">+{k.toFixed(0)}%</b>
                <span className="vxc-arr">→</span>
                <span className="vxc-act">Calls assigned, upside above the strike is sold</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <div className="vxi-foot">
        {rollDays !== null ? (
          <span>
            Roll cadence · <FootVal>{`${String(rollDays)}d`}</FootVal>
          </span>
        ) : null}
        <span>
          {rollDays !== null ? "Last roll · " : "Since · "}
          <FootVal>{relAgo(last, nowMs)}</FootVal>
        </span>
        {next !== null ? (
          <span>
            Next roll · <FootVal>{relIn(next, nowMs)}</FootVal>
          </span>
        ) : null}
      </div>
    </div>
  );
}

/* ── 7. The redemption route: the exit, its window, the reserve's depth ── */

function RedemptionInstrument({
  vault,
  r,
  bookUsd,
  routedLoopLabel,
}: {
  vault: VaultRecord;
  r: RedemptionAutomation;
  bookUsd: number;
  routedLoopLabel: string | null;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const read = redemptionReadout(r, bookUsd, routedLoopLabel);
  return (
    <div ref={ref} className={`vxi${inView ? " vxi--in" : ""}`}>
      <div className="vxi-head">
        <div>
          <span className="vxi-kick">{read.kicker}</span>
          <h3 className="vxi-title">Redemption route</h3>
          <p className="vxi-role">{read.role}</p>
        </div>
        <ArmedChip vault={vault} />
      </div>
      <div className="vxi-body">
        <div className="vxe-read">
          {/* `same day` is a phrase and was printing as a 22px monospaced
              headline; a window that reads `T+1` is a datum. One owner
              decides, per record. */}
          <b data-kind={valueKind(read.settlementText)}>{read.settlementText}</b>
          <span>{read.readingLine}</span>
          {/* The window is the issuer's own statement, and the tag says so. */}
          <i className="vxe-modeled">{read.provenance}</i>
        </div>
        {read.strip ? (
          <div className="vxs">
            <Sparkline series={read.strip.series} height={64} fill={false} format={fmtCapacityUsd} />
            <div className="vxs-lab">{read.strip.label}</div>
          </div>
        ) : null}
        <div className="vxc">
          <div className="vxc-k">{read.tableHead}</div>
          <div className="vxc-rows">
            {read.rows.map((row, i) => (
              <div
                key={row.cond}
                className={`vxc-row${row.lit ? " vxc-row--on" : ""}`}
                style={{ "--i": i } as CSSProperties}
              >
                <span className={`vxc-dot vxc-dot--${row.tone}`} />
                <span className="vxc-cond">{row.cond}</span>
                {/* The one cascade whose condition column is WORDS: this
                    table reads `same day` and `same route`, not a threshold.
                    Every other cascade in the section states a figure and
                    keeps the mono by default. */}
                <b className="vxc-val" data-kind={valueKind(row.val)}>
                  {row.val}
                </b>
                <span className="vxc-arr">→</span>
                <span className="vxc-act">{row.act}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="vxi-foot">
        {read.foot.map((f) => (
          <span key={f.k}>
            {f.k} ·{" "}
            <b data-kind={valueKind(f.v)}>
              {f.href ? (
                <a href={f.href} target="_blank" rel="noreferrer">
                  {f.v}
                </a>
              ) : (
                f.v
              )}
            </b>
          </span>
        ))}
      </div>
    </div>
  );
}

/** ONE note, one voice (founder, 2026-09-07): extended by clause, never
 *  stacked as a second italic line. */
function sectionNote(a: VaultAutomations | undefined): string {
  const parts = ["Envelope, bands and thresholds are the vault's published parameters."];
  if (a?.router) {
    parts.push(
      `The router's rates are modeled from rates measured on ${routerNoteDay()}, and every move it decides starts in shadow.`,
    );
  }
  const reserve = a?.redemption?.venue === RESERVE_LIQUIDITY_VENUE ? reserveLiquidityLatest() : null;
  if (reserve) parts.push(`The reserve's liquidity is measured on ${routerDayLabel(reserve.date)}.`);
  return parts.join(" ");
}

/* ── section ── */

/** Modules that are the position itself, not something running on top of it. */
const SOURCE_MODULES = ["liquidity source", "perp market"];


export default function AutomationsSection({
  vault,
  nowMs,
  tvlUsd,
}: {
  vault: VaultRecord;
  nowMs: number;
  tvlUsd: number;
}) {
  const a = vault.automations;
  const range = rangeConfig(vault);
  const collar = collarConfig(vault);
  const cad = a?.compound?.cadenceHours ?? 24;
  const compoundShown = Boolean(a?.compound) && (tvlUsd * vault.modeledApy * cad) / (365 * 24) > 0;

  // Every module the vault carries is accounted for: instrumented above, or
  // listed with its published line below. A vault that runs something never
  // renders as a vault that runs nothing.
  const covered = new Set<string>();
  if (a?.leverage) covered.add("dynamic leverage");
  if (a?.hedge) {
    covered.add("dynamic hedge");
    covered.add("basis engine");
  }
  if (compoundShown) covered.add("auto-compound");
  if (range) {
    covered.add("auto center");
    covered.add("range engine");
  }
  if (collar) {
    covered.add("covered call");
    covered.add("protective put");
  }
  /* Or the router prints twice: once as this instrument and once as a prose
     row in `Also installed` 400px below it. */
  if (a?.router) covered.add(ROUTER_MODULE.toLowerCase());
  if (a?.redemption) covered.add("redemption route");
  // Through the one list the Overview chips print (DL-2), so a module can
  // appear here under no other spelling than the chip it sits beside.
  const others = recordModuleNames(vault).filter((m) => {
    const k = m.toLowerCase();
    return !covered.has(k) && !SOURCE_MODULES.includes(k);
  });
  const lineFor = (name: string): string => {
    // A compounder on a position that is not earning is listed, not metered:
    // its published line promises a harvest the model does not produce.
    if (name.toLowerCase() === "auto-compound" && a?.compound && !compoundShown) {
      return `Installed on a ${cad}h cadence. No harvest is modeled at this vault's modeled APY.`;
    }
    const recorded = (vault.moduleLines ?? []).find(
      (l) => canonicalModuleName(l.name).toLowerCase() === name.toLowerCase(),
    )?.line;
    return moduleDepositorLine(name) ?? recorded ?? "";
  };

  const instruments =
    Boolean(a?.router) ||
    Boolean(a?.redemption) ||
    Boolean(a?.leverage) ||
    Boolean(a?.hedge) ||
    compoundShown ||
    Boolean(range) ||
    Boolean(collar);
  const anything = instruments || others.length > 0;

  return (
    <section id="automations" className="vxd-sec">
      <h2 className="vxd-sec-h">Automations</h2>
      {anything ? (
        <>
          {/* Portfolio level, so it leads the position-level instruments. */}
          {a?.router ? <RouterInstrument vault={vault} r={a.router} /> : null}
          {a?.leverage ? <LeverageInstrument vault={vault} lev={a.leverage} nowMs={nowMs} /> : null}
          {range ? <RangeInstrument vault={vault} cfg={range} nowMs={nowMs} /> : null}
          {collar ? <CollarInstrument vault={vault} cfg={collar} nowMs={nowMs} /> : null}
          {a?.hedge ? <HedgeInstrument vault={vault} nowMs={nowMs} /> : null}
          {compoundShown ? <CompoundInstrument vault={vault} nowMs={nowMs} tvlUsd={tvlUsd} /> : null}
          {/* The exit last: it is the last thing the position does. */}
          {a?.redemption ? (
            <RedemptionInstrument
              vault={vault}
              r={a.redemption}
              bookUsd={tvlUsd}
              routedLoopLabel={a?.router?.lanes.find((l) => l.family === "loop")?.label ?? null}
            />
          ) : null}
          {others.length > 0 ? (
            <div className="vx-panel">
              <div className="vx-panel-h">Also installed</div>
              {others.map((m) => (
                <div key={m} className="vx-kv vx-kv--prose">
                  <span>{m}</span>
                  <b>{lineFor(m) || "Installed on this vault."}</b>
                </div>
              ))}
            </div>
          ) : null}
          {/* ONE note, one voice (founder, 2026-09-07). The router's rates are
              not published parameters, so on a routed record the section's own
              sentence is extended rather than a second italic note stacked
              under it. */}
          <p className="vxd-note">{sectionNote(a)}</p>
        </>
      ) : (
        <div className="vx-panel">
          <div className="vx-dep-note">No automation modules installed on this vault.</div>
        </div>
      )}
    </section>
  );
}
