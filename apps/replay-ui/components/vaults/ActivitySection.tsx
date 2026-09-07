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
 *
 * ON-CHAIN ROWS (founder feedback, 2026-09-07). On the attested record the
 * automation rows are not modeled: they are the loop's own executions, read
 * off Base (`lib/vaults/onchain-executions.ts`), each one tagged `on chain`
 * and carrying a Verify key at the end of its line that opens the
 * transaction on Basescan. That page is the proof: the handler call, its
 * input decoded, the operator's signature in the `signatureData` tuple.
 * Where a real ledger exists the modeled automation rows stand down, so one
 * table never mixes a modeled `Leverage rebalanced` with a real execution.
 * Rows with no transaction (a deposit on this build is a local record until
 * the backend wires it) print an empty cell, never a dead key.
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
import { explorerTxUrl } from "@/lib/format";
import { EXECUTION_CHAIN_ID, onchainExecutionsFor } from "@/lib/vaults/onchain-executions";
import { collarConfig, collarRollTimes, rangeConfig, rangeRecenterTimes } from "./AutomationsSection";

const MAX_ROWS = 8;

/** The store's row plus the reader's withdrawals and the chain's executions. */
type LedgerRow = Omit<ActivityRow, "kind"> & {
  kind: ActivityRow["kind"] | "withdraw" | "onchain";
  /** The transaction that is this row's proof, where one exists. */
  txHash?: string;
};

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

/** The action a handler call is, in the ledger's own vocabulary. */
export const EXECUTION_ACTION = "Execution landed";

/** `signed packet accepted · block 50,208,131` */
export function executionDetail(blockNumber: number): string {
  return `signed packet accepted · block ${blockNumber.toLocaleString("en-US")}`;
}

function VerifyKey({ txHash }: { txHash: string }) {
  const href = explorerTxUrl(EXECUTION_CHAIN_ID, txHash);
  if (href === null) return null;
  return (
    <a
      className="vxa-verify"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Verify this execution on Basescan, transaction ${txHash.slice(0, 10)}`}
      title={txHash}
    >
      Verify
      <svg viewBox="0 0 10 10" aria-hidden="true" focusable="false">
        <path d="M2 8 8 2M3.5 2H8v4.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </a>
  );
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

    const onchain: LedgerRow[] = onchainExecutionsFor(vault.slug).map((x) => ({
      action: EXECUTION_ACTION,
      detail: executionDetail(x.blockNumber),
      ms: x.timestamp * 1000,
      kind: "onchain",
      txHash: x.txHash,
    }));
    const hasChain = onchain.length > 0;

    const earning = vault.modeledApy > 0;
    const modeled: LedgerRow[] = modeledActivity(vault, nowMs, tvlUsd).filter((r) => {
      if (hasChain && r.kind === "auto") return false;
      if (statesNegativeMoney(r.detail)) return false;
      if (!earning && /compound/i.test(r.action)) return false;
      return true;
    });

    const family: LedgerRow[] = [];
    if (!hasChain) {
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
    }

    return [...deposits, ...exits, ...onchain, ...modeled, ...family].sort((a, b) => b.ms - a.ms);
  }, [vault, nowMs, tvlUsd, positions, withdrawals, shareValue]);

  const visible = rows.slice(0, MAX_ROWS);
  const truncated = rows.length > MAX_ROWS;
  /* The Verify column exists only where a row can fill it. A column of empty
     cells on a record with no chain ledger is chrome. */
  const verifiable = rows.some((r) => typeof r.txHash === "string");

  return (
    <section id="activity" className="vxd-sec">
      <h2 className="vxd-sec-h">Activity</h2>
      <div className="vx-table-wrap">
        <table className={`vx-table vxa-table${verifiable ? " vxa-table--verify" : ""}`}>
          <thead>
            <tr>
              <th>Action</th>
              <th>Detail</th>
              <th>Time</th>
              {verifiable ? <th className="vxa-col-verify">Verify</th> : null}
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => (
              <tr key={`${r.kind}-${r.ms}-${i}`}>
                <td className="vxa-action">
                  {r.action}
                  {r.mine ? <span className="vxa-tag vxa-tag--you">you</span> : null}
                  {r.kind === "auto" ? <span className="vxa-tag">modeled</span> : null}
                  {r.kind === "onchain" ? <span className="vxa-tag vxa-tag--chain">on chain</span> : null}
                </td>
                <td className="vxa-detail">{r.detail}</td>
                <td className="vxa-time">{relTime(r.ms, nowMs)}</td>
                {verifiable ? (
                  <td className="vxa-col-verify">{r.txHash ? <VerifyKey txHash={r.txHash} /> : null}</td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
        {truncated ? <div className="vxa-trunc">Earlier activity truncated</div> : null}
      </div>
    </section>
  );
}
