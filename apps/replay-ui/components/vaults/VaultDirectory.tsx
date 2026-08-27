"use client";

/**
 * The Vaults directory: every vault composed and published with Priime Build,
 * as a grid of cards (one today; the grid is the invitation). Card shape per
 * Antoni's directory reference: name, strategy chip, market and venue, the
 * modeled APY as the one big number, a share-value hairline, then TVL, share
 * value and automation count, with the curator and a live chip on the foot.
 *
 * Register rules hold here too: the APY is labeled modeled; the sparkline and
 * share value are the attested series off the journal, which today is a flat
 * line, and the card will not draw a curve the journal does not contain.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import { useBuildHref } from "@/lib/host";
import {
  HERO_VAULT,
  automationCountFor,
  heroNavPerShare,
  heroNavUsd,
  heroStrikes,
  resolveVault,
} from "@/lib/vaults/rows";
import { VAULTS_EVENT, fmtPct, fmtUsd, venueParts, type VaultRecord } from "@/lib/vaults/store";

import { Sparkline } from "./Sparkline";

export function VaultDirectory() {
  // SSR renders the standing record; the published envelope lands on mount.
  const [vault, setVault] = useState<VaultRecord>(HERO_VAULT);
  useEffect(() => {
    const refresh = () => {
      setVault(resolveVault());
    };
    refresh();
    window.addEventListener(VAULTS_EVENT, refresh);
    return () => {
      window.removeEventListener(VAULTS_EVENT, refresh);
    };
  }, []);

  const navUsd = heroNavUsd() ?? vault.baseTvlUsd;
  const share = heroNavPerShare();
  const series = [...heroStrikes()]
    .reverse()
    .map((s) => s.navPerShare)
    .filter((v): v is number => v !== null);
  const { venue, chain } = venueParts(vault.venue);
  const automations = automationCountFor(vault);
  const buildHref = useBuildHref();

  return (
    <div className="dir">
      <header className="dir-head">
        <div>
          <div className="dir-kicker">Built with Priime</div>
          <h1 className="dir-title">Vaults</h1>
          <p className="dir-sub">
            Every vault composed and published with Priime Build. All performance numbers are
            modeled; the NAV and share value are attested off the journal.
          </p>
          <div className="dir-count vn">
            1 vault · {fmtUsd(navUsd)} attested NAV · 1 strategy
          </div>
        </div>
        <Link className="dir-create" href="/build">
          Create a vault
        </Link>
      </header>

      <div className="dir-chips">
        <span className="dir-chip on">All 1</span>
        <span className="dir-chip">{vault.strategyLabel} 1</span>
      </div>

      <div className="dir-grid">
        <Link className="dir-card" href={`/vault/${vault.slug}`}>
          <div className="dir-card-h">
            <b>{vault.name}</b>
            <span className="dir-tag">{vault.strategyLabel}</span>
          </div>
          <div className="dir-mkt vn">
            {vault.market} · {venue} · {chain}
          </div>
          <div className="dir-apy">
            <b className="vn">{fmtPct(vault.modeledApy)}</b>
            <i>modeled APY</i>
          </div>
          <div className="dir-spark">
            <Sparkline
              values={series}
              fill={false}
              markPoints
              viewHeight={36}
              label="Attested share value per strike"
            />
          </div>
          <div className="dir-stats">
            <div>
              <span>NAV, attested</span>
              <b className="vn">{fmtUsd(navUsd)}</b>
            </div>
            <div>
              <span>Share value</span>
              <b className="vn">{share === null ? "1.000000" : share.toFixed(6)}</b>
            </div>
            <div>
              <span>Automations</span>
              <b className="vn">{String(automations)}</b>
            </div>
          </div>
          <div className="dir-foot">
            <span>
              Curated by <b>{vault.curator}</b>
            </span>
            <span className="vchip">Attested</span>
          </div>
        </Link>
        <a className="dir-ghost" href={buildHref}>
          <span className="dir-ghost-label">+ Compose a vault</span>
          <span className="dir-ghost-copy">
            An empty bay. Publish from Priime Build and it lands here.
          </span>
        </a>
      </div>

      <p className="dir-note">
        One vault today, replaying captured journals. The directory grows as the desk publishes
        more; every card&apos;s attested numbers come from its own strike journal and nowhere else.
      </p>
    </div>
  );
}
