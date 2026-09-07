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
  deleverageDriftLine,
  registerInputForVault,
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
  recordModuleNames,
  venueParts,
  type LeverageAutomation,
  type VaultRecord,
} from "@/lib/vaults/store";
import { fundingRegisterFor } from "@/lib/vaults/funding-register";
/* MINUS is U+2212, the ledger's one sign glyph for numeric runs; `pct` is the
   product's one % formatter and carries it. An ASCII hyphen beside mono
   tabular digits is the drift the glyph sweep (2026-08-24) removed. */
import { MINUS, pct } from "@/lib/canvas/format";
import { collarForfeit, type CollarForfeit } from "@/lib/canvas/templates";
import {
  registerFor,
  REGISTER_TITLE,
  VERDICT_TITLE,
} from "@/lib/canvas/register";
/* THE TABLE ITSELF. `riskTableForVault` is the one call this surface makes for
   the register: four families, one return type, every reading carrying its own
   denominator and its own state. It shipped with zero importers — this is the
   wire. */
import { riskTableForVault } from "@/lib/vaults/risk-table";
import {
  readingStamp,
  RISK_NOT_MEASURED,
  type RiskParty,
  type RiskRow,
  type RiskSectionAbsence,
} from "@/lib/canvas/risk-table";
import { liquidationVerdict, type LiquidationVerdict } from "@/lib/canvas/liquidation-lines";
import { Fragment, type CSSProperties } from "react";
import { useCountUp } from "./useCountUp";
import { useInView } from "./useInView";

const HOUR_MS = 3600e3;
const DAY_MS = 86400e3;

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
  const { chain } = venueParts(vault.venue);
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
          <b>{fmtHf(hf)}</b>
          <span>
            health factor · {fmtLev(curLev)} leverage · {zonePhrase}
          </span>
          <i className="vxe-live">live</i>
        </div>
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
            <div className={`vxc-row${zone === 0 ? " vxc-row--on" : ""}`}>
              <span className="vxc-dot vxc-dot--em" />
              <span className="vxc-cond">Health factor is below</span>
              <b className="vxc-val">{fmtHf(floorHf)}</b>
              <span className="vxc-arr">→</span>
              <span className="vxc-act">Fast unwind</span>
            </div>
            <div className={`vxc-row${zone === 1 ? " vxc-row--on" : ""}`}>
              <span className="vxc-dot vxc-dot--del" />
              <span className="vxc-cond">Health factor between</span>
              <b className="vxc-val">
                {fmtHf(floorHf)} and {fmtHf(delevHf)}
              </b>
              <span className="vxc-arr">→</span>
              <span className="vxc-act">Sell slice, repay borrow</span>
            </div>
            <div className={`vxc-row${zone === 2 ? " vxc-row--on" : ""}`}>
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
              <div className={`vxc-row${zone === 3 ? " vxc-row--on" : ""}`}>
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
          Liquidation LTV · <b>{(lev.liqLtv * 100).toFixed(1)}%</b>
          {lev.liqLtvInferred ? " (inferred from the pair)" : ""}
        </span>
        {driftText === null ? null : (
          <span>
            Cascade acts after · <b>{driftText}</b>
          </span>
        )}
        <span>
          Applied leverage · <b>{fmtLev(appliedL)}</b>
        </span>
        <span>
          Cadence · <b>{lev.cadence}</b>
        </span>
        <span>
          Last rebalance · <b>{relAgo(times.leverage, nowMs)}</b>
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
          <b>
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
            <div className="vxc-row">
              <span className="vxc-dot vxc-dot--em" />
              <span className="vxc-cond">Margin is below</span>
              <b className="vxc-val">{h.marginTrimBelowPct}%</b>
              <span className="vxc-arr">→</span>
              <span className="vxc-act">Trim short, restore to {h.marginRestorePct}%</span>
            </div>
            <div className="vxc-row">
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
          Cadence · <b>{h.cadence}</b>
        </span>
        {hedgeLev !== null ? (
          <span>
            Short leverage · <b>{fmtLev(hedgeLev)}</b>
          </span>
        ) : null}
        {reserve !== null ? (
          <span>
            Margin reserve · <b>{(reserve * 100).toFixed(0)}%</b>
          </span>
        ) : null}
        <span>
          Margin now · <b>{margin.toFixed(1)}%</b>
        </span>
        <span>
          Last check · <b>{relAgo(times.hedge, nowMs)}</b>
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
  const { venue } = venueParts(vault.venue);
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
            <div className={`vxc-row${ready ? " vxc-row--on" : ""}`}>
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
          Cadence · <b>{c.cadenceHours}h</b>
        </span>
        <span>
          Last compound · <b>{relAgo(times.compound, nowMs)}</b>
        </span>
        <span>
          Next check · <b>{relIn(times.nextCompoundCheck, nowMs)}</b>
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
  const { venue } = venueParts(vault.venue);
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
          <b>
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
            <div className={`vxc-row${!atTrigger ? " vxc-row--on" : ""}`}>
              <span className="vxc-dot vxc-dot--tgt" />
              <span className="vxc-cond">Price inside</span>
              <b className="vxc-val">±{trigger.toFixed(2)}%</b>
              <span className="vxc-arr">→</span>
              <span className="vxc-act">Hold, fees accrue</span>
            </div>
            <div className={`vxc-row${atTrigger && inRange ? " vxc-row--on" : ""}`}>
              <span className="vxc-dot vxc-dot--del" />
              <span className="vxc-cond">Price walks past</span>
              <b className="vxc-val">
                ±{trigger.toFixed(2)}% ({(cfg.triggerShare * 100).toFixed(0)}% of range)
              </b>
              <span className="vxc-arr">→</span>
              <span className="vxc-act">Recenter around spot</span>
            </div>
            <div className={`vxc-row${!inRange ? " vxc-row--on" : ""}`}>
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
          Range width · <b>±{w.toFixed(1)}%</b>
        </span>
        <span>
          Recenter trigger · <b>{(cfg.triggerShare * 100).toFixed(0)}% of range</b>
        </span>
        <span>
          Last recenter · <b>{relAgo(last, nowMs)}</b>
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
  const { venue } = venueParts(vault.venue);
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
          <b>
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
              <div className={`vxc-row${below ? " vxc-row--on" : ""}`}>
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
            <div className={`vxc-row${!below && !above ? " vxc-row--on" : ""}`}>
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
              <div className={`vxc-row${above ? " vxc-row--on" : ""}`}>
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
            Roll cadence · <b>{rollDays}d</b>
          </span>
        ) : null}
        <span>
          {rollDays !== null ? "Last roll · " : "Since · "}
          <b>{relAgo(last, nowMs)}</b>
        </span>
        {next !== null ? (
          <span>
            Next roll · <b>{relIn(next, nowMs)}</b>
          </span>
        ) : null}
      </div>
    </div>
  );
}

/* ── section ── */

/** Modules that are the position itself, not something running on top of it. */
const SOURCE_MODULES = ["liquidity source", "perp market"];

/* ══ THE RISK REGISTER, AS A TABLE — THE RENDER (rework 2026-09-02) ═════════
   THE FOUNDER'S COMPLAINT, VERBATIM: "way too wordy and I hate the AI slop
   aspect of it. those info could be displayed but must be displayed as
   structured table and not a wordy paragraph."

   THE FIRST PASS BUILT THE TABLE AND WIRED IT TO NOTHING. `riskTableForVault`
   shipped typed, tested and with zero production importers, so this renderer
   kept reading `registerFor`'s legacy entries and laying out the SAME prose in
   a nicer grid: the sentence moved from beside the number to under the label,
   and the surface got 28% WORDIER than the one he rejected. A layer that is
   not wired is not a fix. This pass wires it.

   WHAT CHANGES BECAUSE THE SOURCE CHANGES, not because the markup did:
     · the clause is a CLAUSE. `RiskRow.consequence` is capped at 48 characters
       by `validateRiskRow`, lower case, no terminal stop, and it is NULL
       wherever the mechanism already says it — so most rows now carry no
       prose at all. The legacy `why` was a full sentence on every one of them
       and this renderer had a `?? e.why` fallback that guaranteed it printed.
     · every reading carries its denominator. `1.00` with the unit stranded in
       the sentence to its left is now `15% · of short notional` beside
       `funds 1 refill, then manual`.
     · one grammar in the response column. `margin 6.5% → 23%` on every family,
       never a bare `33.3%` that collides with three other 33.3% on the screen.
     · the four as-of rows are retired into the footer stamp, in the product's
       own `modeled · block n` grammar.
     · one row per counterparty CLASS, each with its own coverage state, in
       place of three class names comma-joined into one label over a single
       `clear` that covered a class nothing reads.

   WHAT THE RENDERER STILL OWNS, and it is only geometry and state: three
   typed columns, the four reading states, the failing chip, the arming
   caption, the 390 transpose and both themes.

   ⚠ THE VERDICT BLOCK STAYS, AND IT IS NOT A RENDER DECISION.
   `lib/canvas/__tests__/liquidation-verdict-wiring.test.ts` is a ratified gate
   that pins `VaultVerdict` here by name, pins every field it renders, and pins
   exactly one `registerFor` and one `liquidationVerdict` call, and pins that
   `reactionEntryCount` reaches neither surface
   on this surface. The table's `forced-exit` section now states the same legs
   in better shape, so the verdict is a second printing — but retiring it means
   moving a ratified invariant, which belongs to whoever owns that gate. The
   legacy entries survive here for one purpose only: their COUNT is the gate on
   whether this card renders at all. Nothing on screen renders from them, and
   since re-review #4 no number does either — the verdict takes no argument. ── */

/** The three heads. `Reading` over `Measure`: it pairs with the footer's
 *  `readings not taken` and with the block stamp, and it is honest about what
 *  the column holds — a reading taken at one block, not a measurement in the
 *  abstract. `Written response` is the load-bearing one: it makes every cell
 *  in that column honest about a rail that does not actuate, with no
 *  disclaimer sentence anywhere. */
const COL_MECHANISM = "Mechanism";
const COL_READING = "Reading";
const COL_RESPONSE = "Written response";

/** ⚠ THE EMPTY RESPONSE CELL IS EMPTY, AND THE ABSENCE IS COUNTED ONCE.
 *
 *  It printed `none written` per row, and on a hedged loop record that is
 *  THIRTEEN identical strings down one column — the same "a cell that says the
 *  same characters on every row is chrome" defect the register's own wall gate
 *  bans in the other direction. Under a head, an empty cell in a column of
 *  values already reads as an absence; the footer states the count so the
 *  absence is said exactly once instead of thirteen times. */
const RESPONSES_NOUN = "written responses";

/** The one coverage state that inverts to ink. */
const FAILING = "failing";

/** THE AS-OF, PER ROW, DROPPED AGAINST THE FOOTER'S OWN STAMP.
 *
 *  `readingStamp` emits the product's `modeled · block 41,563,811` grammar —
 *  the same one `DockReadouts` prints — with either half absent where it does
 *  not apply. Printing it in a column of its own would wall nine identical
 *  block numbers down a loop record, which is the "a column where no cell
 *  holds a distinct reading is chrome" defect in a new place. So it prints as
 *  the reading's own third line, and ONLY where it says something the footer
 *  stamp does not: a `modeled` figure on a card whose other numbers were read,
 *  or a row read at a different block than the card's oldest. Stated as an
 *  identity against the footer rather than as a list of row ids, so it is a
 *  no-op the day every row agrees and it can never silently swallow a row that
 *  was read somewhere else. */
function rowStamp(row: RiskRow, footerAsOf: string | null): string | null {
  const s = readingStamp(row);
  if (s === null || s === footerAsOf) return null;
  return s;
}

/* ── ONE ROW ────────────────────────────────────────────────────────────────
   THE FOUR READING STATES ARE DATA, AND THIS COMPONENT BRANCHES ON THEM AND
   ON NOTHING ELSE. It never inspects the value string, which is how
   `not measured` stopped being a string test and started being a state.

     · measured / stated  a value exists. Mono, ink, tabular, with its
                          denominator as the caption beneath it.
     · no-threshold       no level exists to watch. The denominator IS the
                          cell ("no level to watch"), in body faint: printing
                          a figure would invent one.
     · unmeasured         a quantity exists and nothing reads it. The absence
                          word, then the name of what WOULD have measured it.
                          Never a dash, never a rounded zero.

   THE RESPONSE CELL CARRIES ITS OWN HEAD AS A `data-h`. At 390 the third
   column has no header row above it, and the first pass let the response
   VALUE render there anyway — a right-aligned `33.3%` floating under a
   paragraph with no label, which is the exact defect he pasted. The label
   travels with the cell and the stylesheet prints it only where the head is
   gone. ── */
function RiskTableRow({
  row,
  i,
  cols,
  footerAsOf,
}: {
  row: RiskRow;
  i: number;
  cols: number;
  footerAsOf: string | null;
}) {
  const rd = row.reading;
  const r = row.response;
  const stamp = rowStamp(row, footerAsOf);
  const has = rd.state === "measured" || rd.state === "stated";
  /* The file's own `--i` stagger (`.vx-table tbody tr`), capped at six.
     `.vxc-row` carried delays for `nth-child(1..4)` only, so row 5 and past
     arrived unstaggered — a latent defect this shape does not inherit. */
  const style = { ["--i" as string]: Math.min(i, 5) } as CSSProperties;
  return (
    <tr className="vxb-row" role="row" style={style}>
      <td className="vxb-mech" role="cell">
        {row.mechanism}
        {row.consequence ? <span className="vxb-cl">{row.consequence}</span> : null}
      </td>
      <td className="vxb-read" role="cell" data-state={rd.state} data-h={COL_READING}>
        {has ? (
          <>
            {row.coverage === FAILING ? (
              <span className="vxb-fail">{rd.value}</span>
            ) : (
              <span className="vxb-val">{rd.value}</span>
            )}
            {rd.denominator ? <span className="vxb-den">{rd.denominator}</span> : null}
          </>
        ) : rd.state === "unmeasured" ? (
          <>
            <span className="vxb-abs">{RISK_NOT_MEASURED}</span>
            {rd.denominator ? <span className="vxb-den">{rd.denominator}</span> : null}
          </>
        ) : (
          <span className="vxb-abs">{rd.denominator}</span>
        )}
        {stamp ? <span className="vxb-stamp">{stamp}</span> : null}
      </td>
      {cols < 3 ? null : (
        <td
          className={`vxb-act${r ? "" : " vxb-act--none"}`}
          role="cell"
          data-h={COL_RESPONSE}
        >
          {r ? (
            <>
              <span className="vxb-trig">{r.trigger}</span>
              {r.cadence ? <em>{r.cadence}</em> : null}
            </>
          ) : null}
        </td>
      )}
    </tr>
  );
}

/* ── ONE ABSENCE, ONCE, AT GROUP LEVEL ─────────────────────────────────────
   A group whose rows are unmeasured used to say so once per row. The Yield
   group on a published hedged-loop record ran three near-identical captions —
   `the borrow rate is not published on this record`, `lower-quartile APR, not
   published on this record`, `no guard floor published on this record` — over
   a footer already printing `3 readings not taken`. Four statements of one
   fact, under a heading that promises how the yield dies.

   `RiskSectionBlock.absence` is non-null exactly there, and this renders it in
   the same two cells every other row uses so the reader meets no new shape.
   The rows it covers are dropped from `shown` and STAY on `rows`, so the
   footer count and every gate still see the group at full length: what changed
   is how many times a reader is told.

   ⚠ IT NOW SITS AFTER THE ROWS IT DID NOT FOLD (2026-09-02). The fold covers
   the group's UNMEASURED SUBSET rather than only a wholly-blind group, so a
   group can carry measured rows AND one absence line — `aerodrome-rangekeeper`
   is the case: its LP range is measured and its two funding dials are not.
   Measured first, then the one line that says what was not read. ── */
function SectionAbsenceRow({ absence, cols }: { absence: RiskSectionAbsence; cols: number }) {
  return (
    <tr className="vxb-row" role="row">
      <td className="vxb-mech" role="cell">
        {absence.mechanism}
      </td>
      <td className="vxb-read" role="cell" data-state="unmeasured" data-h={COL_READING}>
        <span className="vxb-abs">{RISK_NOT_MEASURED}</span>
        <span className="vxb-den">{absence.denominator}</span>
      </td>
      {cols < 3 ? null : <td className="vxb-act vxb-act--none" role="cell" data-h={COL_RESPONSE} />}
    </tr>
  );
}

/** THE PARTIES, ONE ROUTE SENTENCE EACH, over the classes that belong to them.
 *  `RiskParty.because` is per PARTY and the classes are per row, so printing
 *  it on every row would repeat one sentence three times under three names —
 *  which is how the comma-joined label got written in the first place. */
function partyRuns(rows: readonly RiskRow[]): { party: RiskParty | null; rows: RiskRow[] }[] {
  const out: { party: RiskParty | null; rows: RiskRow[] }[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    /* ⚠ BOTH SIDES NORMALISED TO null. `last.party?.id` is `undefined` on a
       run with no party and `r.party?.id ?? null` is `null`, so the raw
       comparison was false on EVERY partyless row: each row became its own
       run, and every run in a section then carried the section's id as its
       key. React reported four duplicate keys per record. */
    const id = r.party?.id ?? null;
    if (last && (last.party?.id ?? null) === id) {
      last.rows.push(r);
      continue;
    }
    out.push({ party: r.party, rows: [r] });
  }
  return out;
}

/* ══ THE LIQUIDATION VERDICT, IN THE TABLE'S GRAMMAR ═══════════════════════
   IT STAYS ITS OWN BLOCK, and it is now three sentences and no readings.

   ⚠ THE TWO ROWS ARE GONE (parent ruling, 2026-09-02). This block used to
   print `Short margin ratio · 33.3%` and `Short's own liquidation · not
   measured` — and eight rows below, the table printed `Short margin · 33.3% ·
   of the short's own notional` and `Short's own liquidation · +41% · adverse
   HYPE move`. The second pair is right: the table derives the coin's
   maintenance margin from the record's published margin ladder, which the
   legacy verdict path never receives, so the verdict was claiming `not
   measured` about a number the same card had already measured. On
   khype-boost-loop and steady-eth-loop that put two different readings under
   one label on one screen.

   THE SEAM, STATED SO IT CANNOT SLIDE BACK: the verdict says WHICH LEGS CAN
   BE CLOSED, in words; the table says AT WHAT LEVEL, with the denominator, the
   field path and the as-of. The ratified gate now asserts that stronger
   invariant — no liquidation reading in this block at all, and a derived
   `short-line` row in the table — rather than the old one, which pinned the
   `not measured` value and so enforced the contradiction.

   ⚠ AND THE SAME RULING REACHED THE PROSE (G7 re-review, same day). Two more
   printings went, both of them the seam's own shape in a sentence:

     · the short claim's opening. `The perp short holds 33% of the deposit as
       margin and reserve.` against `Deposit held as perp margin · 32.6% · of
       the deposit, as margin and reserve` eight lines below — one quantity at
       two precisions. Dropping the figure left the row's own sentence without
       its number, so the clause went with it. The claim is now the eight words
       the table cannot say: `The perp short can be closed against you.`
     · the headline, and the bridge under it. `This liquidates if wstETH loses
       29% against WETH. We trim 3.65pp before that.` / `Three things could
       reach 29% before the trim does.` against `Deposit liquidation line ·
       29% · adverse wstETH/WETH move` and `Trim fires · 3.65pp · of that
       move, before the line` sixteen lines below. Two quantities, each
       printed twice on one screen, and `depositLineRow` was written to
       replace that very sentence. The block is now ONE FIGURE-FREE CLAIM PER
       LEG and the bridge element is retired with the sentence (re-review #4).
     · the whole block on a record with NO leg. `stable-yield-router` and
       `dao-treasury-collar` printed `No borrow. No liquidation line on the
       deposit.` five lines above `Borrow · none · the deposit carries no debt`
       and `Deposit liquidation line · none · no borrow leg to liquidate`. One
       absence, three statements. `liquidationVerdict` returns null on the
       `none` key, so this component is unchanged: it renders what it is
       handed, and it is handed nothing there. ── */
function VaultVerdict({ verdict }: { verdict: LiquidationVerdict }) {
  return (
    <div className="vxb-verdict">
      <div className="vxc-k">{VERDICT_TITLE}</div>
      <p className="vxv-h">{verdict.headline}</p>
      {verdict.note ? <p className="vxb-note">{verdict.note}</p> : null}
    </div>
  );
}

function RiskRegister({ vault }: { vault: VaultRecord }) {
  /* ⚠ THE REGISTER NEVER REVEALED (recette gate, 2026-08-27). This card was
     the ONE `.vxi` on the page rendered without `useInView`, and every row of
     it painted at opacity 0 and stayed there on every vault page in the
     product. The hook sits above the early return because hooks may not be
     called conditionally. */
  const { ref, inView } = useInView<HTMLDivElement>();

  /* THE ONE CALL THIS SURFACE MAKES. Four families, one return type, so the
     render branches on data and never on a strategy name — which is what
     closes the gap where funding was the only family with no statement of
     what can be closed against a depositor. */
  const table = riskTableForVault(vault);

  /* ⚠ THE LEGACY REGISTER IS READ FOR EXACTLY ONE THING, AND IT IS NO LONGER A
     NUMBER. It used to supply the reaction tally the verdict's bridge sentence
     printed; that sentence is retired (re-review #4), so all that is left is
     `entries.length`, the gate on whether this card renders. The ratified
     wiring gate pins one `registerFor` and one `liquidationVerdict` here, and
     pins that `reactionEntryCount` is not called on either surface. */
  const input = vault.strategy === "funding" ? null : registerInputForVault(vault);
  const entries =
    vault.strategy === "funding" ? fundingRegisterFor(vault) : input ? registerFor(input) : [];
  if (!table || table.sections.length === 0 || entries.length === 0) return null;

  /* NO CONTEXT RIDES ALONG ANY MORE. `trimDrift` was here so the verdict's
     trim clause read the record's own derivation rather than re-deriving from
     the preset (G7 nit, 2026-08-24, when this page printed 3.66pp in the
     verdict beside 3.65pp in the rows). The clause is retired and the row
     `Trim fires` is the quantity's only owner on this page, so the argument
     went with it. */
  const verdict = input ? liquidationVerdict(input.lane) : null;

  const groups = table.sections;
  const arming = table.arming;
  const foot = table.footer;

  /* A LONE HEADING CARRIES NO INFORMATION. A label whose siblings cannot
     differ is chrome; a family with one section drops straight to the heads. */
  const showHeads = groups.length > 1;

  /* THE RESPONSE COLUMN EARNS ITS PLACE OR IT DOES NOT RENDER. On a collar and
     on an unhedged loop NO row carries a written response, so the head and the
     track would be chrome. Where at least one row has one the column renders
     and the empty cells stay empty; the footer says how many rows filled it,
     once, instead of the absence repeating down the column. */
  const responses = groups.reduce(
    (n, g) => n + g.rows.filter((r) => r.response !== null).length,
    0,
  );
  const anyResponse = responses > 0;
  const cols = anyResponse ? 3 : 2;

  /* THE READINGS NOT TAKEN, off the footer's own two counts. Never rendered at
     zero: a bar stating we measure everything is a completeness claim. */
  const gaps = Math.max(0, foot.readable - foot.measured);

  /* Both counts, each said ONCE, in one middot-joined run. They replace two
     walls: the collapsed skip drawer (a state behind a chevron is a state a
     depositor never sees) and thirteen rows of `none written`. Neither is
     rendered at zero — a bar stating we measure everything, or that everything
     has a rule, is a completeness claim. */
  const counts = [
    gaps > 0 ? `${gaps} reading${gaps === 1 ? "" : "s"} not taken` : "",
    responses > 0 ? `${responses} ${RESPONSES_NOUN}` : "",
  ].filter((s) => s.length > 0);

  let i = -1;
  return (
    <div ref={ref} className={`vxi${inView ? " vxi--in" : ""}`}>
      <div className="vxi-head">
        <div>
          <span className="vxi-kick">{vault.market}</span>
          {/* THE CARD KEEPS ITS RATIFIED HEAD. `REGISTER_TITLE` is the second
              half of a pair the product states at two altitudes — `What can be
              closed` then `What would have to break` — and the dock prints the
              same constant. `RISK_TABLE_TITLE` is a third spelling of one
              head; a table does not get to rename the card it sits in. */}
          <h3 className="vxi-title">{REGISTER_TITLE}</h3>
        </div>
      </div>
      <div className="vxi-body">
        <div className="vxb-wrap">
          {verdict ? <VaultVerdict verdict={verdict} /> : null}
          {/* THE ARMING STATE AS THE TABLE'S CAPTION, not one amber row among
              nine. A caption governs the whole table INCLUDING ITS HEADS,
              which is the only structure in which `Written response` is honest
              on a product where watchers detect and actuation is roadmap. */}
          {arming ? (
            <div className="vxb-cap" role="status">
              <i aria-hidden />
              <span>{arming.label}</span>
              <b>{arming.value}</b>
              <em>{arming.note}</em>
            </div>
          ) : null}
          <table className="vxb" role="table">
            <colgroup>
              <col />
              <col style={{ width: "22ch" }} />
              {anyResponse ? <col style={{ width: "24%" }} /> : null}
            </colgroup>
            <thead>
              <tr className="vxb-hrow" role="row">
                <th role="columnheader" scope="col">
                  {COL_MECHANISM}
                </th>
                <th role="columnheader" scope="col">
                  {COL_READING}
                </th>
                {anyResponse ? (
                  <th role="columnheader" scope="col" className="vxb-h--act">
                    {COL_RESPONSE}
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {groups.map((sec) => (
                <Fragment key={sec.section}>
                  {showHeads ? (
                    <tr className="vxb-grprow" role="row">
                      <th className="vxb-grp" colSpan={cols} scope="colgroup" role="columnheader">
                        {sec.heading}
                      </th>
                    </tr>
                  ) : null}
                  {/* THE ROWS THE FOLD LEFT STANDING, then the group's ONE
                      absence line. `sec.shown` is the model's own answer to
                      "what does a renderer walk" — this component holds no
                      predicate about which rows an absence covers, because a
                      component that decides that is a second owner of the fold.
                      Both branches are DATA, never a section name: the Yield
                      group and the canvas counterparty section are where it
                      fires today and nothing here knows that. */}
                  {partyRuns(sec.shown).map((run) => (
                    <Fragment key={`run:${run.party?.id ?? sec.section}`}>
                      {run.party ? (
                        <tr className="vxb-partyrow" role="row">
                          <th className="vxb-party" colSpan={cols} scope="colgroup" role="columnheader">
                            <b>{run.party.label}</b>
                            <span>{run.party.because}</span>
                          </th>
                        </tr>
                      ) : null}
                      {run.rows.map((r) => {
                        i += 1;
                        return (
                          <RiskTableRow
                            key={r.id}
                            row={r}
                            i={i}
                            cols={cols}
                            footerAsOf={foot.asOf}
                          />
                        );
                      })}
                    </Fragment>
                  ))}
                  {sec.absence ? (
                    <SectionAbsenceRow absence={sec.absence} cols={cols} />
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
          <div className="vxb-foot">
            <span>{counts.join(" · ")}</span>
            <span className="vxb-foot-asof">{foot.asOf ?? foot.asOfNote}</span>
          </div>
          {/* The dependencies nothing on this lane reads, said ONCE, at product
              level. It was a per-vault row, byte-identical on every vault with
              the pair swapped, which is the definition of a statement that is
              not about this vault. Null wherever the overlay is placed and the
              parties are rows of their own. */}
          {foot.unwatched ? <div className="vxb-unwatched">{foot.unwatched}</div> : null}
        </div>
      </div>
    </div>
  );
}


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

  const instruments = Boolean(a?.leverage) || Boolean(a?.hedge) || compoundShown || Boolean(range) || Boolean(collar);
  const anything = instruments || others.length > 0;

  return (
    <section id="automations" className="vxd-sec">
      <h2 className="vxd-sec-h">Automations</h2>
      {anything ? (
        <>
          {a?.leverage ? <LeverageInstrument vault={vault} lev={a.leverage} nowMs={nowMs} /> : null}
          {range ? <RangeInstrument vault={vault} cfg={range} nowMs={nowMs} /> : null}
          {collar ? <CollarInstrument vault={vault} cfg={collar} nowMs={nowMs} /> : null}
          {a?.hedge ? <HedgeInstrument vault={vault} nowMs={nowMs} /> : null}
          {compoundShown ? <CompoundInstrument vault={vault} nowMs={nowMs} tvlUsd={tvlUsd} /> : null}
          {/* Under the cascade, in the cascade's own rows. Absent whenever the
              record cannot produce an entry — never an empty heading, which
              would claim a class exists here and we found nothing in it. */}
          <RiskRegister vault={vault} />
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
          <p className="vxd-note">Envelope, bands and thresholds are the vault&apos;s published parameters.</p>
        </>
      ) : (
        <div className="vx-panel">
          <div className="vx-dep-note">No automation modules installed on this vault.</div>
        </div>
      )}
    </section>
  );
}
