"use client";

/**
 * The attested activity ledger: one block per captured NAV strike, with the
 * per-operator submissions underneath.
 *
 * The sabotage capture is the demo's money shot and is rendered as itself, not
 * as a special case: operator 3 reported a different result hash, so its row
 * sits in the alarm register and is marked rejected, while the honest weight
 * settles the true number above it. Nothing is mutated client-side to make
 * that happen; it is what the capture says.
 *
 * No explorer deep links anywhere here. The attestation tx hashes belong to a
 * captured run, and this UI does not pretend otherwise.
 */

import { formatUtcTime } from "@/lib/format";
import { Hex } from "./Hex";
import { formatAttestedNav, type StrikeRow } from "@/lib/vaults/attested";

export function StrikeLedger({ strikes }: { strikes: readonly StrikeRow[] }) {
  return (
    <div className="vp-rows">
      {strikes.map((s) => (
        <div className="strk" key={s.strikeId}>
          <div className="strk-head">
            <span className="strk-id">strike {s.shortId}</span>
            <span className="strk-meta">
              {s.trigger} · trigger block {s.triggerBlock} · inputs block {s.inputsBlock}
            </span>
            <span className="vchip">
              {s.status === "settled" ? `Settled ${s.quorum.label}` : s.status}
            </span>
            {s.hasRejection && <span className="vchip vchip--alarm">1 rejected</span>}
            <span className="strk-nav">
              {s.navUsd === null ? "-" : formatAttestedNav(s.navUsd, s.navDecimals)} {s.navAsset}
            </span>
          </div>
          <div className="strk-ops">
            {s.operators.map((op) => (
              <div className={`strk-op${op.accepted ? "" : " bad"}`} key={op.id}>
                <span className="strk-op-id">{op.shortId}</span>
                <span className="strk-op-hash"><Hex full={op.resultHash} lead={10} tail={6} /></span>
                <span className="strk-op-tag">
                  {op.accepted ? "accepted" : "rejected, hash mismatch"}
                </span>
                <span className="strk-op-nav">
                  {formatAttestedNav(op.navUsd, s.navDecimals)} {s.navAsset}
                </span>
              </div>
            ))}
            <div
              className="strk-op"
              style={{ background: "transparent", border: 0, paddingLeft: 0 }}
            >
              quorum {s.quorum.thresholdLabel} required · {s.quorum.label} agreed · attested{" "}
              {formatUtcTime(s.attestedAt)} UTC
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
