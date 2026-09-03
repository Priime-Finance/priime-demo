"use client";

/**
 * Option A deposit lifecycle, attested vault only.
 *
 * The house rule from priime-pools: the UI never asserts what the source of
 * truth has not confirmed. This vault is ERC-7540 style async and its source
 * of truth is the NAV-strike journal, so:
 *
 *   submit  → a *request*, not a deposit. Nothing is priced yet.
 *   pending → "settles at the next attested NAV strike", with a quiet cancel.
 *   settle  → the next strike lands (paced off the replay engine's own
 *             cadence, `STRIKE_ARRIVAL_MS`), and only then does a price
 *             exist: the journal's `attestation.nav_final`, converted with
 *             `nav_unit.decimals`, and nothing else.
 *
 * The entry price shown is that number exactly. No modeled share value ever
 * touches this card.
 */

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { formatAttestedNav } from "@/lib/vaults/attested";
import { QUICK_AMOUNTS } from "./DepositRail";
import { heroSettlingJournal } from "@/lib/vaults/rows";
import {
  MIN_DEPOSIT_USD,
  cancelRequest,
  checkAmount,
  createRequest,
  loadRequestsFor,
  positionFrom,
  positionValueUsd,
  saveRequest,
  settleRequest,
  strikeDueAt,
  type DepositRequest,
} from "@/lib/vaults/requests";
import { fmtUsdFull, type VaultRecord } from "@/lib/vaults/store";

export function AttestedDepositCard({
  vault,
  navPerShare,
  onAmount,
  corrupted = false,
}: {
  vault: VaultRecord;
  /** The currently attested NAV per share, or null if nothing has settled. */
  navPerShare: number | null;
  onAmount: (amountUsd: number | null) => void;
  /**
   * True while the operator panel is replaying the sabotage capture. It changes
   * nothing about settlement — requests fill at `heroSettlingJournal()`'s
   * attested NAV either way, which is the whole point — and only earns one
   * quiet line saying so.
   */
  corrupted?: boolean;
}) {
  const [raw, setRaw] = useState("");
  const [requests, setRequests] = useState<DepositRequest[]>([]);
  const [settledId, setSettledId] = useState<string | null>(null);
  const check = checkAmount(raw);
  const touched = raw.trim() !== "";

  const refresh = useCallback(() => {
    setRequests(loadRequestsFor(vault.slug));
  }, [vault.slug]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const edit = (next: string) => {
    setRaw(next);
    const c = checkAmount(next);
    onAmount(c.ok ? c.amountUsd : null);
  };

  const submit = () => {
    if (!check.ok) return;
    createRequest(vault.slug, check.amountUsd);
    edit("");
    refresh();
  };

  /**
   * Settlement pacing. Each pending request carries its own submission time, so
   * the strike is due at `requestedAt + STRIKE_ARRIVAL_MS`. A reload mid-wait
   * lands here with a negative delay and settles immediately, which is the
   * honest behaviour: the strike did fire while the tab was closed.
   */
  useEffect(() => {
    const pending = requests.filter((r) => r.status === "pending");
    if (pending.length === 0) return;
    const journal = heroSettlingJournal();
    if (journal === null) return;
    const timers = pending.map((request) =>
      setTimeout(
        () => {
          const settled = settleRequest(request, journal, Date.now());
          if (settled === request) return;
          saveRequest(settled);
          setSettledId(settled.id);
          refresh();
        },
        Math.max(0, strikeDueAt(request) - Date.now()),
      ),
    );
    return () => {
      timers.forEach(clearTimeout);
    };
  }, [requests, refresh]);

  const pending = requests.filter((r) => r.status === "pending");
  const position = positionFrom(requests);
  const settled = requests.find((r) => r.id === settledId && r.status === "settled");

  return (
    <>
      <section className="dep">
        <div className="dep-k">Deposit</div>
        <div className="dep-chips">
          {QUICK_AMOUNTS.map((q) => (
            <button
              key={q}
              type="button"
              className="dep-chip"
              onClick={() => {
                edit(String(q));
              }}
            >
              ${q.toLocaleString("en-US")}
            </button>
          ))}
        </div>
        <div className="dep-form">
          <input
            className={`dep-in${touched && !check.ok ? " warn" : ""}`}
            inputMode="decimal"
            placeholder="Amount, USD"
            aria-label="Deposit amount in USD"
            value={raw}
            onChange={(e) => {
              edit(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
          <button type="button" className="dep-btn" disabled={!check.ok} onClick={submit}>
            Request
          </button>
        </div>
        {!check.ok && !check.empty && <div className="dep-warn">{check.message}</div>}
        <p className="dep-note">
          Deposits are requests. They settle at the next attested NAV strike. Minimum $
          {String(MIN_DEPOSIT_USD)}.
        </p>
        {corrupted && (
          <p className="dep-note">
            Requests still settle at the attested NAV. A rejected operator never reaches the quorum,
            so it cannot move your entry price.
          </p>
        )}

        {pending.map((r) => (
          <div key={r.id} className="dep-pending">
            <div className="dep-pending-row">
              <span style={{ fontSize: 13, color: "var(--v-mut)" }}>Requested</span>
              <span className="dep-pending-amt">{fmtUsdFull(r.amountUsd)}</span>
            </div>
            <div className="dep-pending-s">Pending, settles at next NAV strike.</div>
            <button
              type="button"
              className="dep-cancel"
              onClick={() => {
                cancelRequest(r.id);
                refresh();
              }}
            >
              cancel request
            </button>
          </div>
        ))}

        {position.shares > 0 && (
          <div className="dep-pos">
            <div className="dep-pending-row">
              <span style={{ fontSize: 13, color: "var(--v-mut)" }}>Your position</span>
              <span className="dep-pending-amt">
                {navPerShare === null
                  ? `${position.shares.toFixed(6)} shares`
                  : fmtUsdFull(positionValueUsd(position, navPerShare))}
              </span>
            </div>
            <div className="dep-pending-s">
              {position.shares.toFixed(6)} shares, entered at{" "}
              {position.entryNavPerShare === null ? "-" : position.entryNavPerShare.toFixed(6)} per
              share, attested.
            </div>
          </div>
        )}
      </section>

      {/* Portaled to <body>: the card lives inside the sticky .vp-rail, which is
          its own stacking context below the sticky tab bar, so a fixed overlay
          rendered in place can never paint above the tabs. */}
      {settled?.fill &&
        createPortal(
        <div
          className="vp-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Deposit settled"
          onClick={() => {
            setSettledId(null);
          }}
        >
          <div
            className="vp-modal-card"
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <div className="vp-modal-k">Settled</div>
            <h2 className="vp-modal-t">Your request settled</h2>
            <p className="vp-modal-nav">
              Settled at attested NAV{" "}
              <b>
                {formatAttestedNav(settled.fill.navUsd, settled.fill.navDecimals)}{" "}
                {settled.fill.navAsset}
              </b>{" "}
              · strike <b>{settled.fill.strikeId}</b>
            </p>
            <div className="vp-modal-rows">
              <div className="vp-modal-row">
                Deposited <span className="vn">{fmtUsdFull(settled.amountUsd)}</span>
              </div>
              <div className="vp-modal-row">
                Shares issued <span className="vn">{settled.fill.shares.toFixed(6)}</span>
              </div>
              <div className="vp-modal-row">
                Entry price, per share{" "}
                <span className="vn">{settled.fill.navPerShare.toFixed(6)}</span>
              </div>
              <div className="vp-modal-row">
                Strike block <span className="vn">{String(settled.fill.strikeBlock)}</span>
              </div>
            </div>
            <button
              type="button"
              className="vp-modal-btn"
              onClick={() => {
                setSettledId(null);
              }}
            >
              Done
            </button>
          </div>
        </div>,
          document.body,
        )}
    </>
  );
}
