"use client";

/* Ported from build.priime.finance eb6d33a (docs/plans/LATEST_UI_PORT_SPEC.md WP4). */
/**
 * Activity: the ledger, newest first: the reader's deposits and withdrawals
 * (tagged `you`), and deterministic automation entries spaced plausibly
 * since inception (tagged `modeled`). Capped at 8 rows with an honest
 * truncation line. The strike rows are NOT here: they live in the Strikes
 * panel of the Verification section (docs/plans/LATEST_UI_PORT_SPEC.md E.9).
 *
 * Two rules on top of the store's ledger:
 *  - the template families get their own rows (`Range recentered`,
 *    `Call rolled`), built from the SAME published config and the SAME
 *    clocks the Automations instruments render, so footer and ledger agree;
 *  - a row that would state a negative dollar amount as income is dropped.
 *    Nothing is "re-supplied" out of a position that is not earning.
 *
 * Withdraw rows (WP4.7): kind `withdraw`, tagged `you`, action `Withdraw`,
 * detail `$X at 1.0000` (the share value the position was updated at).
 */

import { useMemo } from "react";
import {
  fmtUsdFull,
  modeledActivity,
  type ActivityRow,
  type PositionRecord,
  type VaultRecord,
  type WithdrawalRecord,
} from "@/lib/vaults/store";
import { collarConfig, collarRollTimes, rangeConfig, rangeRecenterTimes } from "./AutomationsSection";

const MAX_ROWS = 8;

/** The store's row plus the reader's withdrawals. */
type LedgerRow = Omit<ActivityRow, "kind"> & { kind: ActivityRow["kind"] | "withdraw" };

/** True when the detail line states a negative dollar amount. */
function statesNegativeMoney(detail: string): boolean {
  return /[-−]\s*\$/.test(detail);
}

function relTime(ms: number, nowMs: number): string {
  const d = Math.max(0, nowMs - ms);
  if (d < 90e3) return "just now";
  if (d < 3600e3) return `${Math.round(d / 60e3)} min ago`;
  if (d < 24 * 3600e3) return `${Math.round(d / 3600e3)}h ago`;
  if (d < 60 * 86400e3) return `${Math.max(1, Math.round(d / 86400e3))}d ago`;
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function ActivitySection({
  vault,
  nowMs,
  tvlUsd,
  positions,
  withdrawals = [],
  /** The share value a withdrawal settled at, for its detail line. */
  shareValue,
}: {
  vault: VaultRecord;
  nowMs: number;
  tvlUsd: number;
  positions: PositionRecord[];
  withdrawals?: WithdrawalRecord[];
  shareValue?: number | null;
}) {
  const rows = useMemo<LedgerRow[]>(() => {
    const deposits: LedgerRow[] = positions.map((p) => ({
      action: "Deposit",
      detail: fmtUsdFull(p.amountUsd),
      ms: Date.parse(p.depositedAt),
      kind: "deposit",
      mine: true,
    }));

    const exits: LedgerRow[] = withdrawals.map((w) => ({
      action: "Withdraw",
      detail:
        typeof shareValue === "number" && Number.isFinite(shareValue)
          ? `${fmtUsdFull(w.amountUsd)} at ${shareValue.toFixed(4)}`
          : fmtUsdFull(w.amountUsd),
      ms: Date.parse(w.withdrawnAt),
      kind: "withdraw",
      mine: true,
    }));

    const earning = vault.modeledApy > 0;
    const modeled: LedgerRow[] = modeledActivity(vault, nowMs, tvlUsd).filter((r) => {
      if (statesNegativeMoney(r.detail)) return false;
      if (!earning && /compound/i.test(r.action)) return false;
      return true;
    });

    const family: LedgerRow[] = [];
    const range = rangeConfig(vault);
    if (range) {
      for (const ms of rangeRecenterTimes(vault, range, nowMs, 4)) {
        family.push({
          action: "Range recentered",
          detail: `±${range.halfWidthPct.toFixed(1)}% rebuilt around spot`,
          ms,
          kind: "auto",
        });
      }
    }
    const collar = collarConfig(vault);
    if (collar?.strikePct !== null && collar?.rollDays !== null && collar !== null) {
      const strike = collar.strikePct.toFixed(0);
      const tenor = collar.rollDays;
      for (const ms of collarRollTimes(vault, collar, nowMs, 3)) {
        family.push({
          action: "Call rolled",
          detail: `fresh strike +${strike}%, ${tenor}d tenor`,
          ms,
          kind: "auto",
        });
      }
    }

    return [...deposits, ...exits, ...modeled, ...family].sort((a, b) => b.ms - a.ms);
  }, [vault, nowMs, tvlUsd, positions, withdrawals, shareValue]);

  const visible = rows.slice(0, MAX_ROWS);
  const truncated = rows.length > MAX_ROWS;

  return (
    <section id="activity" className="vxd-sec">
      <h2 className="vxd-sec-h">Activity</h2>
      <div className="vx-table-wrap">
        <table className="vx-table vxa-table">
          <thead>
            <tr>
              <th>Action</th>
              <th>Detail</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => (
              <tr key={`${r.kind}-${r.ms}-${i}`}>
                <td className="vxa-action">
                  {r.action}
                  {r.mine ? <span className="vxa-tag vxa-tag--you">you</span> : null}
                  {r.kind === "auto" ? <span className="vxa-tag">modeled</span> : null}
                </td>
                <td className="vxa-detail">{r.detail}</td>
                <td className="vxa-time">{relTime(r.ms, nowMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {truncated ? <div className="vxa-trunc">Earlier activity truncated</div> : null}
      </div>
    </section>
  );
}
