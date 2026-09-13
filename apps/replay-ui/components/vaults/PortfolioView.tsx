"use client";

/* Ported from build.priime.finance eb6d33a (docs/plans/LATEST_UI_PORT_SPEC.md WP4). */
/**
 * /portfolio: the money room (v2, 2026-08-21). Directory-grade anatomy:
 * an instrumented hero (count-up total + portfolio value chart in the
 * vault page's Sparkline grammar + mono stats strip), one position card
 * per vault in the directory card grammar (multiple deposits into the
 * same vault aggregate), and an elevated empty state with a ghost card.
 *
 * THE ATTESTED REGISTER (docs/plans/LATEST_UI_PORT_SPEC.md WP4.11). A
 * position in the live record (`HERO_SLUG`) is valued at `heroNavPerShare()`,
 * read off the journal, never at the modeled drift; its strip states the
 * attested strikes instead of drawing a curve; the hero caption reads
 * `Total portfolio value, attested`. This page never draws a rising curve
 * for the hero. The wallet is the mock (`lib/wallet.ts`): connected state
 * decides which EMPTY state renders; positions always win.
 *
 * SSR contract: positions live in localStorage, so the server renders the
 * header only; everything below hydrates in after the first client load
 * (no structure mismatch by construction). Motion is one-shot and
 * reduced-motion guarded.
 */

import Link from "next/link";
import { useEffect, useId, useMemo, useState, type CSSProperties } from "react";
import { useAccount, useConnectModal } from "@/lib/wallet";
import { fmtCapacityUsd } from "@/lib/canvas/capacity";
/* The exit sentence's ONE owner (PO-4). Read, never re-declared: the record's
   fee schedule, the deposit rail's position panel and this card all print the
   same string from `fees.feeRows()`. */
import { withdrawalLine } from "@/lib/canvas/fees";
import { HERO_SLUG } from "@/lib/demo-scope";
import { heroNavPerShare, heroStrikes } from "@/lib/vaults/rows";
import { SEED_VAULTS } from "@/lib/vaults/seeds";
import { useBuildHref } from "@/lib/host";
import { useCountUp } from "./useCountUp";
import { useInView } from "./useInView";
import { SparkInception } from "./VaultsDirectory";
import {
  aggregatePositions,
  fmtPct,
  fmtUsdFull,
  loadPositions,
  loadUserVaults,
  portfolioValueSeries,
  recordVenueLine,
  shareValueAt,
  sparkHasHistory,
  VAULT_STAGE_LABEL,
  VAULTS_EVENT,
  vaultStage,
  type AggregatePosition,
  type PositionRecord,
  type VaultRecord,
} from "@/lib/vaults/store";
import { MarketWord } from "./MarketWord";

/** |P&L| under half a cent is flat, not a gain: no plus sign, no green. */
const FLAT = 0.005;

/** Semantic P&L rendering: class + "+$4.12 (+0.41%)" text. */
function pnlParts(pnl: number, base: number): { cls: "pos" | "neg" | "flat"; text: string } {
  if (Math.abs(pnl) < FLAT) return { cls: "flat", text: "$0.00" };
  const sign = pnl >= 0 ? "+" : "−";
  const pct = base > 0 ? Math.abs(pnl) / base : 0;
  return {
    cls: pnl >= 0 ? "pos" : "neg",
    text: `${sign}${fmtUsdFull(Math.abs(pnl))} (${sign}${fmtPct(pct, 2)})`,
  };
}

/** True for a position in the live record, valued off the journal. */
export function isAttestedPosition(slug: string): boolean {
  return slug === HERO_SLUG;
}

/** The share value a position is valued at: attested for the live record. */
function positionShareValue(vault: VaultRecord | null, a: AggregatePosition, now: number): number {
  if (vault === null) return a.shareValueAtDeposit;
  if (isAttestedPosition(vault.slug)) return heroNavPerShare() ?? a.shareValueAtDeposit;
  return shareValueAt(vault, now);
}

/** The strip's note for an attested position: the strikes, not a curve. */
function attestedNote(): string {
  const n = heroStrikes().filter((s) => s.navPerShare !== null).length;
  const sv = heroNavPerShare();
  return sv === null ? "awaiting strike" : `attested, flat across ${n} ${n === 1 ? "strike" : "strikes"} at ${sv.toFixed(4)}`;
}

/**
 * Compact USD for chart rulings and the terminal label: a DISPATCH between
 * two owners, not a third derivation. The magnitude bands belong to
 * `fmtCapacityUsd`, the exact sub-$100K band to `fmtUsdFull`.
 */
function chartUsd(v: number): string {
  return v >= 100_000 ? fmtCapacityUsd(v) : fmtUsdFull(v);
}

/**
 * The hero's portfolio value chart, the vault page's Sparkline grammar over
 * the total-value series. Client-only by construction; playback of the
 * authored draw stagger gates on first in-view (vx-spark--in). A series with
 * no history (a portfolio opened today, or an attested flat one) states the
 * fact in the slot instead of charting noise (DS-6).
 */
function PortfolioChart({ series, note }: { series: number[]; note: string }) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const [w, setW] = useState(640);
  const gradId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const cw = el.clientWidth;
      if (cw > 0) setW(Math.max(240, cw));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!sparkHasHistory(series)) {
    return (
      <div ref={ref} className="vx-pf-chart vx-pf-chart--none">
        <SparkInception note={note} />
      </div>
    );
  }

  const h = 120;
  const pad = 6;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const spanRaw = max - min;
  const padV = Math.max(spanRaw * 0.15, max * 0.004, 0.01);
  const lo = min - padV;
  const span = max + padV - lo || 1e-9;
  const x = (i: number) => pad + (i / (series.length - 1)) * (w - pad * 2);
  const y = (v: number) => h - pad - ((v - lo) / span) * (h - pad * 2);
  const d = series.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const area = `${d} L ${x(series.length - 1).toFixed(1)} ${h - pad} L ${x(0).toFixed(1)} ${h - pad} Z`;
  const last = series[series.length - 1];
  const dotX = x(series.length - 1);
  const dotY = y(last);
  const rulings = [0.25, 0.5, 0.75].map((f) => pad + f * (h - pad * 2));
  const mono = "var(--font-mono, ui-monospace, monospace)";

  const termLabelY = dotY - 7;
  const inFrame = (v: number) => Math.min(h - pad - 2, Math.max(pad + 9, v));
  const clearOfTerminal = (v: number) => Math.abs(v - termLabelY) >= 13;
  const lastText = chartUsd(last);
  const maxText = chartUsd(max);
  const minText = chartUsd(min);
  const maxLabelY = inFrame(y(max) - 6);
  const minLabelY = inFrame(y(min) + 11);
  const showMax = maxText !== lastText && clearOfTerminal(maxLabelY);
  const showMin = minText !== lastText && minText !== maxText && clearOfTerminal(minLabelY);

  return (
    <div ref={ref} className="vx-pf-chart">
      <svg
        className={`vx-spark${inView ? " vx-spark--in" : ""}`}
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        aria-hidden
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2B5CFF" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#2B5CFF" stopOpacity="0" />
          </linearGradient>
        </defs>
        {rulings.map((ry) => (
          <line
            key={ry}
            x1={pad}
            x2={w - pad}
            y1={ry}
            y2={ry}
            stroke="#e7e4dd"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {showMax ? (
          <text x={w - pad - 2} y={maxLabelY} textAnchor="end" fontSize="9" fontFamily={mono} fill="#6f6b63">
            {maxText}
          </text>
        ) : null}
        {showMin ? (
          <text x={w - pad - 2} y={minLabelY} textAnchor="end" fontSize="9" fontFamily={mono} fill="#6f6b63">
            {minText}
          </text>
        ) : null}
        <path className="vx-spark-fill" d={area} fill={`url(#${gradId})`} />
        <path
          className="vx-spark-line"
          pathLength={1}
          d={d}
          fill="none"
          stroke="#2B5CFF"
          strokeWidth="1.8"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle className="vx-spark-dot" cx={dotX} cy={dotY} r="3" fill="#2B5CFF" />
        <text
          x={dotX - 7}
          y={dotY - 7}
          textAnchor="end"
          fontSize="10"
          fontFamily={mono}
          fontWeight="600"
          fill="#2B5CFF"
          stroke="#fff"
          strokeWidth="2"
          paintOrder="stroke"
        >
          {chartUsd(last)}
        </text>
      </svg>
    </div>
  );
}

/**
 * The directory's 38px inline spark, series = this position's value over
 * time. Hidden until first reveal, one draw-in, then at rest. A series with
 * no history states the fact (DL-3).
 */
function PositionSpark({ series, inView }: { series: number[]; inView: boolean }) {
  const gradId = useId();
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    if (!inView || entered) return;
    const t = setTimeout(() => setEntered(true), 750);
    return () => clearTimeout(t);
  }, [inView, entered]);

  if (!sparkHasHistory(series)) {
    return <SparkInception note="modeled from your first deposit" />;
  }

  if (series.length < 2) return null;
  const w = 100;
  const h = 38;
  const pad = 3;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const padV = Math.max((max - min) * 0.15, max * 0.004, 0.01);
  const lo = min - padV;
  const span = max + padV - lo || 1e-9;
  const x = (i: number) => (i / (series.length - 1)) * w;
  const y = (val: number) => h - pad - ((val - lo) / span) * (h - pad * 2);
  const d = series
    .map((val, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)} ${y(val).toFixed(2)}`)
    .join(" ");
  const area = `${d} L${w} ${h} L0 ${h} Z`;
  const yPct = (y(series[series.length - 1]) / h) * 100;
  const mod = !inView ? "--pre" : entered ? "" : "--enter";

  return (
    <>
      <svg
        className={`vx-ds${mod ? ` vx-ds${mod}` : ""}`}
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        aria-hidden
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2B5CFF" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#2B5CFF" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path className="vx-ds-fill" d={area} fill={`url(#${gradId})`} />
        <path
          className="vx-ds-line"
          pathLength={1}
          d={d}
          fill="none"
          stroke="#2B5CFF"
          strokeWidth="1.6"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span
        className={`vx-ds-dotel${mod ? ` vx-ds-dotel${mod}` : ""}`}
        style={{ top: `${yPct.toFixed(1)}%` }}
        aria-hidden
      />
    </>
  );
}

/**
 * The current-value numeral: shows the target until first in view (no 0
 * flash below the fold), then counts up once. An attested value lands whole:
 * it is read off the journal and never counts.
 */
function ValueHero({ value, inView, attested }: { value: number; inView: boolean; attested: boolean }) {
  const counted = useCountUp(inView && !attested ? value : 0, 800);
  const shown = attested ? value : inView ? counted : value;
  return <b>{fmtUsdFull(shown)}</b>;
}

interface CardModel {
  a: AggregatePosition;
  vault: VaultRecord | null;
  rows: PositionRecord[];
  sv: number;
  value: number;
  attested: boolean;
}

/**
 * A holding whose vault record no longer resolves (cleared storage, a
 * record that never landed). It renders as what it is, a deposit we can
 * name and cannot value, with NO href.
 */
function UnresolvableCard({ c, i }: { c: CardModel; i: number }) {
  return (
    <div className="vx-card vx-pf-card" style={{ "--i": Math.min(i, 11) } as CSSProperties}>
      <div className="vx-card-top">
        <span className="vx-card-name">{c.a.vaultName}</span>
      </div>
      <span className="vx-card-mkt">Vault record not found</span>
      <div className="vx-pf-val">
        <span className="vx-pf-val-main">
          <i>Current value, modeled</i>
          <b>—</b>
        </span>
        <span className="vx-pf-pnl flat">no record</span>
      </div>
      <div className="vx-card-rows">
        <span className="vx-cell">
          <i>Deposited</i>
          <b>{fmtUsdFull(c.a.amountUsd)}</b>
        </span>
        <span className="vx-cell">
          <i>Entry share value</i>
          <b>{c.a.shareValueAtDeposit.toFixed(4)}</b>
        </span>
        <span className="vx-cell">
          <i>Deposits</i>
          <b>{c.a.deposits}</b>
        </span>
      </div>
      <div className="vx-pf-foot">
        <span className="vx-pf-foot-dep">
          This deposit is recorded, its vault is not. Nothing here can be valued or opened.
        </span>
      </div>
    </div>
  );
}

/**
 * The position card: a single anchor (A.3 #21), no Withdraw key inside it;
 * the exit line reads the one owner sentence. Exported so the stage chip and
 * the attested strip are pinned by test.
 */
export function PositionCard({ c, i, now }: { c: CardModel; i: number; now: number }) {
  const { ref, inView } = useInView<HTMLAnchorElement>();
  const pnl = c.value - c.a.amountUsd;
  const { cls, text } = pnlParts(pnl, c.a.amountUsd);
  const series = useMemo(
    () => (c.attested ? [] : portfolioValueSeries(c.rows, () => c.vault, now, 40)),
    [c.rows, c.vault, c.attested, now],
  );

  return (
    <a
      ref={ref}
      className="vx-card vx-pf-card"
      href={`/vaults/${c.a.vaultSlug}`}
      style={{ "--i": Math.min(i, 11) } as CSSProperties}
    >
      <div className="vx-card-top">
        <span className="vx-card-name">{c.vault?.name ?? c.a.vaultName}</span>
        {c.vault ? (
          <span className="vx-card-tags">
            <span className={`vx-tag${c.vault.mine ? " vx-tag--mine" : ""}`}>{c.vault.strategyLabel}</span>
            {vaultStage(c.vault) === "incubating" ? (
              <span className="vx-card-stage">{VAULT_STAGE_LABEL.incubating}</span>
            ) : null}
          </span>
        ) : null}
      </div>
      {c.vault ? (
        <span className="vx-card-mkt">
          <MarketWord market={c.vault.market} /> · {recordVenueLine(c.vault)}
        </span>
      ) : null}
      <div className="vx-pf-val">
        <span className="vx-pf-val-main">
          <i>Current value, {c.attested ? "attested" : "modeled"}</i>
          <ValueHero value={c.value} inView={inView} attested={c.attested} />
        </span>
        <span className={`vx-pf-pnl ${cls}${inView ? " vx-pf-pnl--in" : ""}`}>{text}</span>
      </div>
      <div className="vx-ds-slot">
        {c.attested ? <SparkInception note={attestedNote()} /> : <PositionSpark series={series} inView={inView} />}
      </div>
      <div className="vx-card-rows">
        <span className="vx-cell">
          <i>Deposited</i>
          <b>{fmtUsdFull(c.a.amountUsd)}</b>
        </span>
        <span className="vx-cell">
          <i>Share value</i>
          <b>
            {c.a.shareValueAtDeposit.toFixed(4)} → {c.sv.toFixed(4)}
          </b>
        </span>
        <span className="vx-cell">
          <i>Deposits</i>
          <b>{c.a.deposits}</b>
        </span>
      </div>
      {/* THE EXIT, from the ONE owner (PO-4): the same call the record's fee
          schedule and the deposit rail's position panel read. */}
      <span className="vx-pf-exit">Withdrawal: {withdrawalLine(c.vault)}</span>
      <div className="vx-pf-foot">
        <span className="vx-pf-foot-dep">Deposit more</span>
        <span className="vx-pf-foot-view">View vault →</span>
      </div>
    </a>
  );
}

export default function PortfolioView() {
  const [positions, setPositions] = useState<PositionRecord[] | null>(null);
  const [vaults, setVaults] = useState<VaultRecord[]>(SEED_VAULTS);
  const [now, setNow] = useState(() => Date.now());
  /* Funnel state: the mock wallet decides which EMPTY state renders.
     Positions always win: the money room renders regardless of connection. */
  const { isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const buildHref = useBuildHref();

  useEffect(() => {
    const load = () => {
      setPositions(loadPositions());
      const mine = loadUserVaults();
      const taken = new Set(mine.map((v) => v.slug));
      setVaults([...mine, ...SEED_VAULTS.filter((v) => !taken.has(v.slug))]);
    };
    load();
    window.addEventListener(VAULTS_EVENT, load);
    window.addEventListener("storage", load);
    // Modeled share values drift intraday: refresh the derived numbers every
    // 30s. The attested value does not move with this clock.
    const drift = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      window.removeEventListener(VAULTS_EVENT, load);
      window.removeEventListener("storage", load);
      clearInterval(drift);
    };
  }, []);

  const bySlug = useMemo(() => new Map(vaults.map((v) => [v.slug, v])), [vaults]);

  const cards = useMemo<CardModel[]>(() => {
    if (!positions) return [];
    const rowsBy = new Map<string, PositionRecord[]>();
    for (const p of positions) {
      const list = rowsBy.get(p.vaultSlug);
      if (list) list.push(p);
      else rowsBy.set(p.vaultSlug, [p]);
    }
    return aggregatePositions(positions)
      .map((a) => {
        const vault = bySlug.get(a.vaultSlug) ?? null;
        const sv = positionShareValue(vault, a, now);
        return {
          a,
          vault,
          rows: rowsBy.get(a.vaultSlug) ?? [],
          sv,
          value: a.shares * sv,
          attested: vault !== null && isAttestedPosition(vault.slug),
        };
      })
      .sort((x, y) => y.value - x.value);
  }, [positions, bySlug, now]);

  const held = useMemo(() => cards.filter((c) => c.vault !== null), [cards]);
  const orphans = useMemo(() => cards.filter((c) => c.vault === null), [cards]);
  const heroRows = useMemo(
    () => (positions ?? []).filter((p) => bySlug.has(p.vaultSlug)),
    [positions, bySlug],
  );
  const allAttested = held.length > 0 && held.every((c) => c.attested);

  const totalValue = held.reduce((s, c) => s + c.value, 0);
  const totalIn = held.reduce((s, c) => s + c.a.amountUsd, 0);
  const totalPnl = totalValue - totalIn;

  // The hero series: attested holdings are flat at the attested share value
  // (never a modeled walk); a modeled portfolio keeps the live series.
  const heroSeries = useMemo(
    () =>
      allAttested
        ? [totalValue, totalValue]
        : portfolioValueSeries(heroRows, (slug) => bySlug.get(slug) ?? null, now, 64),
    [allAttested, totalValue, heroRows, bySlug, now],
  );

  const totalShown = useCountUp(allAttested ? 0 : totalValue, 800);
  const strip = pnlParts(totalPnl, totalIn);
  const register = allAttested ? "attested" : "modeled";

  const loaded = positions !== null;
  const empty = loaded && cards.length === 0;

  return (
    <div className="vx-root">
      <div className="vx-head">
        <div>
          <span className="vx-kicker">Your deposits</span>
          <h1 className="vx-title">Portfolio</h1>
        </div>
        {!empty ? (
          <Link className="vx-cta vx-cta--ghost" href="/vaults">
            Explore vaults
          </Link>
        ) : null}
      </div>
      {/* HONEST-LABELING BANNER. This page renders from localStorage
          `PositionRecord`s plus `SEED_VAULTS`; there is no
          `balanceOf(handler, wallet)` read and no
          `GET /api/loops?strategist=<wallet>` fetch. So even a
          connected wallet with real on-chain positions in a published
          loop-server vault sees an "empty" state here until the
          localStorage record is written by the deposit flow. Say so
          explicitly rather than let the empty/attested surface pose as
          a wallet read. */}
      <p className="vx-sub" style={{ marginTop: 12, marginBottom: 0 }}>
        Positions on this page are read from the browser&apos;s own storage — deposits made through this session — not from your connected wallet on chain. Vault values marked <em>attested</em> use the sample fixtures in <code>schema/samples/</code>; every other figure is modeled.
      </p>


      {!loaded ? null : empty ? (
        !isConnected ? (
          /* Funnel state A: not connected, nothing held: the connect invite. */
          <div className="vx-empty vx-pf-empty vx-pf-connect">
            <i>Connect a wallet to start a portfolio.</i>
            <div className="vx-pf-acts">
              <button type="button" className="vx-cta" onClick={openConnectModal}>
                Connect wallet
              </button>
              <Link className="vx-cta vx-cta--ghost" href="/vaults">
                Explore vaults
              </Link>
            </div>
          </div>
        ) : (
          /* Funnel state B: connected, nothing held yet. */
          <div className="vx-empty vx-pf-empty">
            <i>Nothing here yet. Compose a vault or make your first deposit.</i>
            <div className="vx-pf-acts">
              <a className="vx-cta" href={buildHref}>
                Compose a vault
              </a>
              <Link className="vx-cta vx-cta--ghost" href="/vaults">
                Explore vaults
              </Link>
            </div>
            <div className="vx-pf-ghost" aria-hidden>
              <div className="vx-pf-ghost-top">
                <span className="vx-pf-ghost-bar" style={{ width: "42%" }} />
                <span className="vx-pf-ghost-pill" />
              </div>
              <span className="vx-pf-ghost-bar vx-pf-ghost-bar--big" style={{ width: "34%" }} />
              <svg className="vx-pf-ghost-spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden>
                <path
                  d="M0 25 C 10 23, 18 26, 28 21 S 46 15, 56 17 S 76 9, 88 8 S 96 6, 100 5"
                  fill="none"
                  stroke="#dedad1"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
              <div className="vx-pf-ghost-cells">
                <span className="vx-pf-ghost-bar" style={{ width: "70%" }} />
                <span className="vx-pf-ghost-bar" style={{ width: "82%" }} />
                <span className="vx-pf-ghost-bar" style={{ width: "40%" }} />
              </div>
              <i>A position, as it will read here</i>
            </div>
          </div>
        )
      ) : (
        <>
          {held.length === 0 ? null : (
            <section className="vx-hero vx-pf-hero">
              <div className="vx-pf-hero-read">
                <i>Total portfolio value, {register}</i>
                <b>{fmtUsdFull(allAttested ? totalValue : totalShown)}</b>
                {Math.abs(totalPnl) < FLAT ? (
                  <small className="flat">$0.00 since deposit, {register}</small>
                ) : (
                  <small className={totalPnl >= 0 ? "pos" : "neg"}>
                    {totalPnl >= 0 ? "+" : "−"}
                    {fmtUsdFull(Math.abs(totalPnl))} since deposit, {register}
                  </small>
                )}
              </div>
              <PortfolioChart
                series={heroSeries}
                note={allAttested ? attestedNote() : "modeled from your first deposit"}
              />
              <p className="vx-pf-strip">
                {heroRows.length} {heroRows.length === 1 ? "position" : "positions"} · {held.length}{" "}
                {held.length === 1 ? "vault" : "vaults"} · total P&amp;L{" "}
                <span className={strip.cls}>{strip.text}</span>
                {orphans.length > 0 ? (
                  <>
                    {" · "}
                    {orphans.length} unresolvable
                  </>
                ) : null}
              </p>
            </section>
          )}
          <div className="vx-pf-grid">
            {held.map((c, i) => (
              <PositionCard key={c.a.vaultSlug} c={c} i={i} now={now} />
            ))}
            {orphans.map((c, i) => (
              <UnresolvableCard key={c.a.vaultSlug} c={c} i={held.length + i} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
