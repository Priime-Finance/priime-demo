/**
 * The Attestation panel, inside the Verification section: the facts the
 * quorum settled, in rows, at the journal's own precision (6dp lives here and
 * nowhere else on the page, docs/plans/LATEST_UI_PORT_SPEC.md A.3 #13, WP4.13).
 *
 * Every value is read through `lib/vaults/rows.ts` (over `attested.ts`) and
 * `lib/vaults/pipeline.ts`: the strike rows and the captured journal. No
 * explorer links: the hashes belong to a captured run
 * (`schema/README.md:54`). The Quorum tile lives here, not in the stat band
 * (A.3 #16).
 *
 * Extracted from the retired `VaultAsset.tsx` attestation block.
 */

import { truncateAddress, truncateHash } from "@/lib/format";
import { formatAttestedNav, type StrikeRow } from "@/lib/vaults/attested";
import { captureJournal } from "@/lib/vaults/pipeline";
import { heroStrikes } from "@/lib/vaults/rows";

export interface AttestationRow {
  label: string;
  value: string;
}

/** `one rejection` / `2 rejections`, from the operator rows of one strike. */
function rejectionClause(s: StrikeRow): string {
  const n = s.operators.filter((o) => !o.accepted).length;
  if (n === 0) return "";
  return n === 1 ? ", one rejection" : `, ${String(n)} rejections`;
}

/**
 * The rows, pure, so a test can hold every value to its reader. Takes the
 * strike rows newest-first (the shape `heroStrikes()` returns) and the
 * captured journal the identities are read from.
 */
export function attestationRows(strikes: readonly StrikeRow[] = heroStrikes()): AttestationRow[] {
  const newest = strikes[0];
  if (newest === undefined) return [];
  const journal = captureJournal("honest");
  const oldestFirst = [...strikes].sort((a, b) => a.triggerBlock - b.triggerBlock);
  return [
    { label: "Quorum", value: `${newest.quorum.thresholdLabel} required` },
    {
      label: "Settled",
      value: oldestFirst
        .map(
          (s) =>
            `${String(s.quorum.accepted)} of ${String(s.quorum.total)} at block ${String(s.triggerBlock)}${rejectionClause(s)}`,
        )
        .join(" · "),
    },
    { label: "Component digest", value: journal.component_digest },
    { label: "Service id", value: truncateAddress(journal.service_id) },
    { label: "Vault", value: truncateAddress(journal.vault.address) },
    { label: "Chain id", value: String(journal.vault.chain_id) },
    { label: "Operators registered", value: String(newest.quorum.total) },
    // The operator set itself, folded in here rather than given a panel of
    // its own. Addresses come from the journal, which is the only place in
    // this app an operator identity is attested.
    ...journal.operators.map((op, index) => ({
      label: `Operator ${String(index + 1)}`,
      value: truncateAddress(op.id),
    })),
    {
      label: "NAV unit",
      value: `${journal.nav_unit.asset}, ${String(journal.nav_unit.decimals)} decimals`,
    },
    { label: "Latest inputs block", value: String(newest.inputsBlock) },
    {
      label: "Winning result hash",
      // The journal's own field. Reading it off an operator row would quote a
      // submission, which on a sabotage strike need not be the winning one.
      value: newest.quorum.winningHash === null ? "no quorum formed" : truncateHash(newest.quorum.winningHash, 10, 6),
    },
    {
      label: "Latest attested NAV",
      value:
        newest.navUsd === null
          ? "awaiting strike"
          : `${formatAttestedNav(newest.navUsd, newest.navDecimals)} ${newest.navAsset}`,
    },
  ];
}

/** The honesty line under the rows. A period, not a semicolon (WP4.13). */
export const ATTESTATION_NOTE =
  "Three operators re-execute the same component against the same input block. Today the desk runs them. The shape does not change when independent operators do.";

export function AttestationPanel({ strikes }: { strikes: readonly StrikeRow[] }) {
  const rows = attestationRows(strikes);
  if (rows.length === 0) return null;
  return (
    <div className="vx-panel vx-attest">
      <div className="vx-panel-h">Attestation</div>
      {rows.map((r) => (
        <div key={r.label} className="vx-kv">
          <span>{r.label}</span>
          <b>{r.value}</b>
        </div>
      ))}
      <p className="vxd-desc vxd-desc--note">{ATTESTATION_NOTE}</p>
    </div>
  );
}
