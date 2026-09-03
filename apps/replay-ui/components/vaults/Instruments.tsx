"use client";

/**
 * Automation instrument cards: one per installed instrument, in the vault
 * page's hardware register — Fraunces kicker, sentence-case title, an Armed
 * chip in the live green, then the rule rows (condition in mono, arrow,
 * action) and a mono cadence footer.
 *
 * Three of the four are modeled config, rendered from the vault record's
 * frozen `automations`. The fourth, `OperatorInstrument`, is the attested one
 * and exists only on the hero vault: its cadence, quorum and last strike come
 * off the journal.
 */

import type { StrikeRow } from "@/lib/vaults/attested";
import { fmtAgo, fmtIn } from "@/lib/vaults/display";
import {
  accruedSinceCompound,
  fmtUsdFull,
  lastActionTimes,
  venueParts,
  type VaultRecord,
} from "@/lib/vaults/store";

interface RuleProps {
  tone?: "blue" | "live" | "warn" | "alarm";
  /** Highlight the row the vault is currently sitting in. */
  active?: boolean;
  /** Alarm-register row (the rejected branch). */
  bad?: boolean;
  children: React.ReactNode;
  action: string;
}

function Rule({ tone = "blue", active, bad, children, action }: RuleProps) {
  const dot =
    tone === "live"
      ? "vi-dot vi-dot--live"
      : tone === "warn"
        ? "vi-dot vi-dot--warn"
        : tone === "alarm"
          ? "vi-dot vi-dot--alarm"
          : "vi-dot";
  return (
    <div className={`vi-rule${active ? " on" : ""}${bad ? " bad" : ""}`}>
      <span className={dot} />
      <span className="vi-rule-t">
        {children} <span className="vi-arrow">&rarr;</span>
      </span>
      <span className="vi-act">{action}</span>
    </div>
  );
}

function Foot({ cells }: { cells: { label: string; value: string }[] }) {
  return (
    <div className="vi-foot">
      {cells.map((c) => (
        <span key={c.label}>
          {c.label} · <span className="vn">{c.value}</span>
        </span>
      ))}
    </div>
  );
}

function Head({
  kicker,
  title,
  desc,
}: {
  kicker: string;
  title: string;
  desc: string;
}) {
  return (
    <div className="vi-head">
      <div>
        <div className="vi-k">{kicker}</div>
        <h3 className="vi-t">{title}</h3>
        <p className="vi-d">{desc}</p>
      </div>
      <span className="vchip">Armed</span>
    </div>
  );
}

/** The dynamic-leverage protection envelope. */
export function LeverageInstrument({ vault, nowMs }: { vault: VaultRecord; nowMs: number }) {
  const lev = vault.automations?.leverage;
  if (!lev) return null;
  const { venue } = venueParts(vault.venue);
  const hf = (n: number) => `${n.toFixed(2)}x`;
  return (
    <div className="vi">
      <Head
        kicker={`${venue} · Protection envelope`}
        title="Dynamic leverage"
        desc={`Holds the loop at ${lev.targetLeverage.toFixed(1)}x and steps the position down before the liquidation band tightens.`}
      />
      <div className="vi-rules">
        <Rule tone="alarm" action="Fast unwind">
          Health factor is below <span className="vn">{hf(lev.emergencyHf)}</span>
        </Rule>
        <Rule tone="warn" action="Sell slice, repay borrow">
          Health factor between <span className="vn">{hf(lev.emergencyHf)}</span> and{" "}
          <span className="vn">{hf(lev.deleverHf)}</span>
        </Rule>
        <Rule tone="live" active action="Hold">
          Health factor between <span className="vn">{hf(lev.deleverHf)}</span> and{" "}
          <span className="vn">{hf(lev.leverUpHf)}</span>
        </Rule>
        <Rule action="Add a layer">
          Health factor is above <span className="vn">{hf(lev.leverUpHf)}</span>
        </Rule>
      </div>
      <Foot
        cells={[
          { label: "Cadence", value: lev.cadence },
          { label: "Cooldown", value: lev.cooldown },
          { label: "Last rebalance", value: fmtAgo(lastActionTimes(vault, nowMs).leverage, nowMs) },
        ]}
      />
    </div>
  );
}

/** The perp-hedge instrument: delta band plus margin maintenance. */
export function HedgeInstrument({ vault, nowMs }: { vault: VaultRecord; nowMs: number }) {
  const hedge = vault.automations?.hedge;
  if (!hedge) return null;
  return (
    <div className="vi">
      <Head
        kicker={`${hedge.venue} · Hedging`}
        title="Dynamic hedge"
        desc="Mirrors the position's price exposure with a perp short and keeps the short's margin inside its band."
      />
      <div className="vi-rules">
        <Rule tone="live" active action="Hold the hedge">
          Net delta inside <span className="vn">±{hedge.deltaBandPct.toFixed(1)}%</span>
        </Rule>
        <Rule action="Resize the short">
          Net delta leaves <span className="vn">±{hedge.deltaBandPct.toFixed(1)}%</span>
        </Rule>
        <Rule tone="warn" action="Top margin back up">
          Margin falls under <span className="vn">{String(hedge.marginTrimBelowPct)}%</span>
        </Rule>
        <Rule tone="alarm" action="De-allocate the venue">
          Funding negative for <span className="vn">{String(hedge.fundingDeallocPeriods)}</span>{" "}
          periods
        </Rule>
      </div>
      <Foot
        cells={[
          { label: "Cadence", value: hedge.cadence },
          { label: "Margin restore", value: `${String(hedge.marginRestorePct)}%` },
          { label: "Last trim", value: fmtAgo(lastActionTimes(vault, nowMs).hedge, nowMs) },
        ]}
      />
    </div>
  );
}

/** The auto-compound harvest meter. */
export function CompoundInstrument({
  vault,
  nowMs,
  tvlUsd,
}: {
  vault: VaultRecord;
  nowMs: number;
  tvlUsd: number;
}) {
  const cmp = vault.automations?.compound;
  if (!cmp) return null;
  const { venue } = venueParts(vault.venue);
  const times = lastActionTimes(vault, nowMs);
  const accrued = accruedSinceCompound(vault, nowMs, tvlUsd);
  const full = (tvlUsd * vault.modeledApy * cmp.cadenceHours) / (365 * 24);
  const pct = Math.min(100, full > 0 ? (accrued / full) * 100 : 0);
  return (
    <div className="vi">
      <Head
        kicker={`${venue} · Compounding`}
        title="Auto-compound"
        desc="Sweeps earned yield back into the position once it clears the threshold."
      />
      <div style={{ padding: "14px 18px 4px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 14,
          }}
        >
          <span style={{ fontSize: 13.5, color: "var(--v-mut)" }}>
            Accrued since last compound <i>modeled</i>
          </span>
          <span className="vn" style={{ fontSize: 22, fontWeight: 500 }}>
            {fmtUsdFull(accrued)}
          </span>
        </div>
        <div
          style={{
            height: 6,
            borderRadius: 999,
            background: "var(--v-line-soft)",
            margin: "10px 0 5px",
            overflow: "hidden",
          }}
        >
          <div style={{ width: `${pct.toFixed(1)}%`, height: "100%", background: "var(--v-blue)" }} />
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontFamily: "var(--vm)",
            fontSize: 10.5,
            color: "var(--v-faint)",
          }}
        >
          <span>$0</span>
          <span>
            harvests ~{fmtUsdFull(full)} at the {String(cmp.cadenceHours)}h check
          </span>
        </div>
      </div>
      <div className="vi-rules" style={{ paddingTop: 10 }}>
        <Rule tone="live" active action="Harvest and re-supply">
          At the <span className="vn">{String(cmp.cadenceHours)}h</span> check, accrued at least{" "}
          <span className="vn">${String(cmp.thresholdUsd)}</span>
        </Rule>
      </div>
      <Foot
        cells={[
          { label: "Cadence", value: `${String(cmp.cadenceHours)}h` },
          { label: "Last compound", value: fmtAgo(times.compound, nowMs) },
          { label: "Next check", value: fmtIn(times.nextCompoundCheck, nowMs) },
        ]}
      />
    </div>
  );
}

/**
 * The attested instrument. Hero vault only: nowhere else in this UI does the
 * word "quorum", "operator" or "attested" appear.
 */
export function OperatorInstrument({ strikes }: { strikes: readonly StrikeRow[] }) {
  const newest = strikes[0];
  if (!newest) return null;
  return (
    <div className="vi">
      <Head
        kicker="Base · NAV attestation"
        title="Priime Operator, NAV attestation"
        desc="Three operators re-execute the NAV from the same component digest against the same input block. The quorum settles only over an identical result hash."
      />
      <div className="vi-rules">
        <Rule action="Three operators re-execute">
          <span className="vn">{newest.trigger}</span> trigger fires a NAV strike
        </Rule>
        <Rule tone="live" active action="Attest the NAV on chain">
          Result hashes agree and weight reaches{" "}
          <span className="vn">{newest.quorum.thresholdLabel}</span>
        </Rule>
        <Rule tone="alarm" bad action="Reject the submission">
          A result hash diverges from the quorum
        </Rule>
      </div>
      <Foot
        cells={[
          { label: "Trigger", value: newest.trigger },
          { label: "Quorum", value: newest.quorum.thresholdLabel },
          { label: "Last strike", value: `block ${String(newest.triggerBlock)}` },
        ]}
      />
    </div>
  );
}
