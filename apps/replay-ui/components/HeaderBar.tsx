/**
 * HeaderBar — the console masthead: the official Priime wordmark (the asset
 * drawn for the active register, never recoloured or restyled, clearspace >=
 * the ∞ height), the demo title, the vault address chip, the component-digest
 * badge, and the light/dark register switch.
 */
import type { ReactNode } from "react";

import { Badge } from "@/components/Badge";
import { Chip } from "@/components/Chip";
import { ThemeToggle } from "@/components/ThemeToggle";

export interface HeaderBarProps {
  /** Demo title. */
  title: string;
  /**
   * Provenance slot, rendered first in the meta row. The canvas puts the
   * "SIMULATED FEED · backend pending" badge here; it must never be optional
   * copy buried further down the page.
   */
  feed?: ReactNode;
  /** Truncated vault address. */
  vaultLabel: string;
  /** Explorer link for the vault, or null when the chain has no explorer. */
  vaultHref: string | null;
  /** Full vault address, for the title attribute. */
  vaultTitle: string;
  /** Truncated `sha256:…` component digest. */
  digest: string;
  /** Full digest, for the title attribute. */
  digestTitle: string;
  /**
   * Whether the digest on stage matches the one the registered operator set is
   * expected to run. `null` on the Deploy beat, where no strike exists yet and
   * the badge shows the expected digest rather than an observed one.
   */
  digestVerified: boolean | null;
}

/** The masthead. */
export function HeaderBar({
  title,
  feed,
  vaultLabel,
  vaultHref,
  vaultTitle,
  digest,
  digestTitle,
  digestVerified,
}: HeaderBarProps): React.JSX.Element {
  const digestTone =
    digestVerified === null ? "ghost" : digestVerified ? "ok" : "bad";
  const digestPrefix =
    digestVerified === null ? "Expected" : digestVerified ? "✓" : "✗";

  return (
    <header className="hdr">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="hdr__mark hdr__mark--dark"
        src="/brand/priime-logo-darkbg.png"
        alt="Priime"
        width={124}
        height={26}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="hdr__mark hdr__mark--light"
        src="/brand/priime-logo-lightbg.png"
        alt="Priime"
        width={124}
        height={26}
      />
      <div className="hdr__titles">
        <span className="kicker">
          Verifiable vaults <span className="idx">{"// 01"}</span>
        </span>
        <h1 className="hdr__title">{title}</h1>
      </div>
      <div className="hdr__meta">
        {feed}
        <Chip
          label="Vault"
          value={vaultLabel}
          href={vaultHref}
          title={vaultTitle}
          testId="vault-chip"
        />
        <Badge tone={digestTone} dot={digestVerified !== null} testId="digest-badge">
          <span title={digestTitle}>
            {digestPrefix} Component {digest}
          </span>
        </Badge>
        <ThemeToggle />
      </div>
    </header>
  );
}
