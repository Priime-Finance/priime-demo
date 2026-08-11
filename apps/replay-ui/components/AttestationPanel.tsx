/**
 * AttestationPanel — the kit's `data/Metric` on a `data/Screen`: dark and idle
 * until the attestation event fires, then lit with the settled NAV, the block,
 * and a live explorer deep link.
 *
 * NAV is a percentage of the deployed baseline. There is no dollar figure here,
 * by design: percentages and attestations, not dollar P&L.
 */
import { Badge } from "@/components/Badge";
import { Metric, Readout, Screen } from "@/components/Screen";

export interface AttestationPanelProps {
  /** True once the attestation receipt is in. */
  landed: boolean;
  /** Settled NAV as a signed percentage of the baseline, or null. */
  navPct: string | null;
  /** Truncated attestation tx hash, or null. */
  txLabel: string | null;
  /** Explorer deep link, or null when the chain has no public explorer. */
  txHref: string | null;
  /** Full tx hash for the title attribute. */
  txTitle: string | null;
  /** Block the attestation landed in. */
  blockNumber: string | null;
  /** Landing time, UTC. */
  timestamp: string;
  /** Chain line, e.g. `"Base · chain 8453"`. */
  chainLabel: string;
  /**
   * Why a landed tx is not a link. Defaults to the honest "no explorer for
   * this chain"; the simulated feed passes `"simulated"` instead, because a
   * placeholder hash must never be dressed up as a Basescan deep link.
   */
  txNote?: string;
}

/** The settled-NAV readout. */
export function AttestationPanel({
  landed,
  navPct,
  txLabel,
  txHref,
  txTitle,
  blockNumber,
  timestamp,
  chainLabel,
  txNote = "no explorer",
}: AttestationPanelProps): React.JSX.Element {
  return (
    <Screen
      label="Attestation · on chain"
      status={landed ? "Settled" : "Not landed"}
      tone={landed ? "ok" : "idle"}
      scanlines
      testId="attestation-screen"
    >
      <Metric
        value={navPct ?? "0.00"}
        unit={navPct === null ? "%" : undefined}
        label="Settled NAV vs deployed baseline"
        caption={landed ? "Attested by the quorum, verified on chain" : "Awaiting quorum"}
        tone={landed ? "ok" : "idle"}
        testId="attestation-nav"
      />
      <Readout
        label="Chain"
        value={chainLabel}
        tone={landed ? "normal" : "dim"}
      />
      <Readout
        label="Block"
        value={blockNumber ?? "awaiting"}
        tone={blockNumber === null ? "dim" : "normal"}
      />
      <Readout label="Landed" value={timestamp} tone={landed ? "normal" : "dim"} />
      <div className="op__foot">
        {landed && txLabel !== null ? (
          txHref === null ? (
            <Badge tone="neutral" testId="attestation-tx">
              <span title={txTitle ?? undefined}>
                Tx {txLabel} · {txNote}
              </span>
            </Badge>
          ) : (
            <a
              className="chip"
              href={txHref}
              target="_blank"
              rel="noreferrer noopener"
              data-testid="attestation-tx"
              title={txTitle ?? undefined}
            >
              <span className="chip__label">Tx</span>
              <span>{txLabel}</span>
              <span className="chip__arrow" aria-hidden="true">
                ↗
              </span>
            </a>
          )
        ) : (
          <Badge tone="ghost" testId="attestation-tx">
            Tx awaiting
          </Badge>
        )}
      </div>
    </Screen>
  );
}
