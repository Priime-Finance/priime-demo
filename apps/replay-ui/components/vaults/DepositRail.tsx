"use client";

/**
 * The right rail's projection card, plus the quick-amount chips the deposit
 * card shares with it.
 *
 * The instant mock deposit that used to live here is gone with the modeled
 * vaults. The only deposit path left is the async request lifecycle in
 * `AttestedDeposit.tsx`, which settles at an attested NAV strike.
 */

import { fmtPct, fmtUsdFull, venueParts, type VaultRecord } from "@/lib/vaults/store";

/** Quick-amount chips, shared with the attested deposit card. */
export const QUICK_AMOUNTS = [1000, 5000, 25000];

/** Modeled projection over the typed (or example) amount. */
export function ProjectionCard({
  vault,
  amountUsd,
  footnote,
}: {
  vault: VaultRecord;
  /** The amount the user typed, or null for the $1,000 example. */
  amountUsd: number | null;
  /** Overridden on the attested vault to name the settlement rule. */
  footnote?: string;
}) {
  const { venue, chain } = venueParts(vault.venue);
  const amount = amountUsd ?? 1000;
  const yearly = amount * vault.modeledApy;
  return (
    <section className="proj">
      <div className="proj-k">Projection</div>
      <div className="proj-row">
        <span className="proj-l">Venue</span>
        <span className="proj-v">
          {venue} · {chain}
        </span>
      </div>
      <div className="proj-row">
        <span className="proj-l">Deposit amount</span>
        <span className="proj-v">
          {amountUsd === null
            ? `$${amount.toLocaleString("en-US")} example`
            : fmtUsdFull(amountUsd)}
        </span>
      </div>
      <div className="proj-row">
        <span className="proj-l">Modeled APY</span>
        <span className="proj-v">{fmtPct(vault.modeledApy)}</span>
      </div>
      <div className="proj-row">
        <span className="proj-l">Projected monthly earnings</span>
        <span className="proj-v">{fmtUsdFull(yearly / 12)}</span>
      </div>
      <div className="proj-row">
        <span className="proj-l">Projected yearly earnings</span>
        <span className="proj-v">{fmtUsdFull(yearly)}</span>
      </div>
      <p className="proj-note">{footnote ?? "At the current modeled rate."}</p>
    </section>
  );
}
