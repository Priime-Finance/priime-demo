"use client";

/* Ported from build.priime.finance eb6d33a (docs/plans/LATEST_UI_PORT_SPEC.md WP4). */
/**
 * Performance. Two records, two registers, one component:
 *
 * ATTESTED (the hero, `HERO_SLUG`): the series is one point per captured
 * strike at the attested NAV per share, read off the journals through
 * `lib/vaults/rows.ts` (docs/plans/LATEST_UI_PORT_SPEC.md WP4.8). No window
 * chips, no area fill, every point marked, the terminal label is the share
 * value at 4dp. The Returns table reads `Since inception 0.00%`, faint, no
 * plus sign: both strikes settled at the same NAV, and this page will not
 * draw a curve the journal does not contain. `perfSeries` and `shareValueAt`
 * never run for this record.
 *
 * MODELED (every other record, which never reaches this page in this build):
 * the live share-value instrument, timeframe chips (1w / 1m / All slicing the
 * deterministic series from inception) plus Morpho's Returns pattern as a
 * table, never a chart. The Sparkline is keyed by timeframe so switching
 * replays the draw-in.
 *
 * Two register rules live here:
 *  - a window longer than the vault's own life has no return. It reads
 *    "not yet" against the vault's age instead of quoting a number measured
 *    from a basis that predates inception;
 *  - a negative number is a change, not a return, and never carries a sign
 *    it has not earned. Flat renders faint with no plus.
 */

import { useMemo, useState } from "react";
import Sparkline from "./Sparkline";
import { pct } from "@/lib/canvas/format";
import { HERO_SLUG } from "@/lib/demo-scope";
import { heroNavPerShare, heroStrikes } from "@/lib/vaults/rows";
import { perfSeries, shareValueAt, windowReturn, type VaultRecord } from "@/lib/vaults/store";

type Win = "1w" | "1m" | "all";
const WINS: { id: Win; label: string; days?: number }[] = [
  { id: "1w", label: "1w", days: 7 },
  { id: "1m", label: "1m", days: 30 },
  { id: "all", label: "All" },
];

/** Below this the line is flat, not a gain: no sign, faint ink. */
const FLAT = 5e-5;

/** Through the product's one % formatter, so a loss wears U+2212 like every
 *  other signed value on the page (glyph sweep, 2026-08-24). The plus stays
 *  earned-only. */
function fmtRet(r: number): string {
  if (Math.abs(r) < FLAT) return "0.00%";
  return r > 0 ? `+${pct(r, 2)}` : pct(r, 2);
}

/**
 * The attested series: oldest strike first, one point per settled strike at
 * its attested NAV per share. Pure and exported so the register is pinned:
 * nothing modeled reaches it.
 */
export function attestedShareSeries(): number[] {
  return [...heroStrikes()]
    .sort((a, b) => a.triggerBlock - b.triggerBlock)
    .map((s) => s.navPerShare)
    .filter((v): v is number => v !== null);
}

/** True for the one record whose performance is read off the journal. */
export function isAttestedPerformance(vault: Pick<VaultRecord, "slug">): boolean {
  return vault.slug === HERO_SLUG;
}

const ATTESTED_NOTE =
  "One point per captured strike. The line is flat because both strikes settled at the same NAV, and this page will not draw a curve the journal does not contain.";

function AttestedPerformance() {
  const series = attestedShareSeries();
  const sv = heroNavPerShare();
  const first = series[0];
  const last = series[series.length - 1];
  const sinceInception = first !== undefined && last !== undefined && first > 0 ? last / first - 1 : null;
  const faint = sinceInception === null || Math.abs(sinceInception) < FLAT;
  return (
    <section id="performance" className="vxd-sec">
      <h2 className="vxd-sec-h">Performance</h2>
      <div className="vx-panel">
        <div className="vxp-head">
          <div className="vxp-lead">
            <div className="vx-panel-h">Share value, attested</div>
            <b className="vxp-sv">{sv === null ? "awaiting strike" : sv.toFixed(4)}</b>
          </div>
          <span className="vx-status">
            {series.length} {series.length === 1 ? "strike" : "strikes"}
          </span>
        </div>
        {series.length >= 2 ? <Sparkline series={series} height={220} fill={false} markPoints /> : null}
        <div className="vx-spark-note">{ATTESTED_NOTE}</div>
      </div>
      <div className="vx-panel">
        <div className="vx-panel-h">Returns</div>
        <div className="vx-kv">
          <span>
            Since inception <em className="vxr-note">attested</em>
          </span>
          <b style={faint ? { color: "var(--vx-faint)" } : undefined}>
            {sinceInception === null ? "not yet" : fmtRet(sinceInception)}
          </b>
        </div>
      </div>
    </section>
  );
}

function ModeledPerformance({ vault, nowMs }: { vault: VaultRecord; nowMs: number }) {
  const [win, setWin] = useState<Win>("all");
  const days = WINS.find((w) => w.id === win)?.days;
  const series = useMemo(() => perfSeries(vault, nowMs, days), [vault, nowMs, days]);
  const sv = shareValueAt(vault, nowMs);
  const ageDays = Math.max(0, Math.floor((nowMs - Date.parse(vault.createdAt)) / 86400e3));

  // `windowReturn` returns null once it is asked for a window the vault has
  // not lived through; older builds returned a number measured from a clamped
  // pre-inception basis. Both are handled: the annotation, not the callee's
  // signature, is what this component reads.
  const retAt = (d?: number): number | null => {
    if (d !== undefined && d > ageDays) return null;
    const r: number | null = windowReturn(vault, nowMs, d);
    return typeof r === "number" && Number.isFinite(r) ? r : null;
  };

  const returns: { key: string; label: string; note: string; value: number | null }[] = [
    { key: "all", label: "Since inception", note: `${ageDays}d`, value: retAt() },
    ...[7, 30].map((d) => {
      const value = retAt(d);
      const kind = value !== null && value < 0 ? "change" : "return";
      return {
        key: `d${d}`,
        label: `${d}d ${kind}`,
        note: value === null ? `vault is ${ageDays}d old` : "modeled",
        value,
      };
    }),
  ];

  return (
    <section id="performance" className="vxd-sec">
      <h2 className="vxd-sec-h">Performance</h2>
      <div className="vx-panel">
        <div className="vxp-head">
          <div className="vxp-lead">
            <div className="vx-panel-h">Share value, modeled</div>
            <b className="vxp-sv">{sv.toFixed(4)}</b>
          </div>
          <div className="vxp-chips" role="tablist" aria-label="Timeframe">
            {WINS.map((w) => (
              <button
                key={w.id}
                type="button"
                className={win === w.id ? "on" : undefined}
                aria-pressed={win === w.id}
                onClick={() => setWin(w.id)}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>
        <Sparkline key={win} series={series} height={220} />
        <div className="vx-spark-note">
          Deterministic model from inception at the vault&apos;s modeled APY. 1.0000 at inception.
        </div>
      </div>
      <div className="vx-panel">
        <div className="vx-panel-h">Returns</div>
        {returns.map((r) => {
          const faint = r.value === null || Math.abs(r.value) < FLAT;
          return (
            <div key={r.key} className="vx-kv">
              <span>
                {r.label} <em className="vxr-note">{r.note}</em>
              </span>
              <b style={faint ? { color: "var(--vx-faint)" } : undefined}>
                {r.value === null ? "not yet" : fmtRet(r.value)}
              </b>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function PerformanceSection({ vault, nowMs }: { vault: VaultRecord; nowMs: number }) {
  if (isAttestedPerformance(vault)) return <AttestedPerformance />;
  return <ModeledPerformance vault={vault} nowMs={nowMs} />;
}
