"use client";

/**
 * `/vault/[slug]` — one vault's own page.
 *
 * The verification canvas is the hero and takes the full page width: the
 * vault plate at the center of its three operators and the Base attestation
 * sink, replaying the captured strikes. Under it, the attested stat band,
 * then the subpage segments as real tabs (Overview, Automations, Performance,
 * Parameters, Activity) with the deposit rail alongside the active panel.
 *
 * Two registers on one page, and they never mix:
 * - *modeled*: the projected APY and the automation instrument parameters,
 *   labeled so wherever they render;
 * - *attested*: the NAV, the share price, the strike ledger and the quorum,
 *   read off the captured NAV-strike journals and never labeled modeled.
 *
 * The published envelope lives in localStorage, so resolution finishes
 * client-side: the server and the first paint render the standing record.
 * The slug is checked against the resolved record the same way; a stray slug
 * gets a quiet not-found state with a way back to the directory.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { truncateAddress, truncateHash } from "@/lib/format";
import { formatAttestedNav, type StrikeRow } from "@/lib/vaults/attested";
import { fmtAgo } from "@/lib/vaults/display";
import { HERO_SLUG, HERO_VAULT, heroNavPerShare, heroNavUsd, heroStrikes, resolveVault } from "@/lib/vaults/rows";
import { loadRequestsFor, type DepositRequest } from "@/lib/vaults/requests";
import {
  VAULTS_EVENT,
  fmtPct,
  fmtUsdFull,
  riskGrade,
  venueParts,
  type VaultRecord,
} from "@/lib/vaults/store";
import { DEMO_JOURNALS } from "@/lib/source";

import type { Capture } from "@/lib/vaults/pipeline";

import { AttestedDepositCard } from "./AttestedDeposit";
import { ProjectionCard } from "./DepositRail";
import {
  CompoundInstrument,
  HedgeInstrument,
  LeverageInstrument,
  OperatorInstrument,
} from "./Instruments";
import { VerificationCanvas } from "./VerificationCanvas";
import { Sparkline } from "./Sparkline";
import { StrikeLedger } from "./StrikeLedger";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "automations", label: "Automations" },
  { id: "performance", label: "Performance" },
  { id: "parameters", label: "Parameters" },
  { id: "activity", label: "Activity" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function VaultAsset({ slug }: { slug: string }) {
  // The standing record is the SSR render; the published envelope lands in the
  // mount effect, so the server and the first paint never disagree.
  const [vault, setVault] = useState<VaultRecord>(HERO_VAULT);
  const [nowMs, setNowMs] = useState(0);
  const [amountUsd, setAmountUsd] = useState<number | null>(null);
  const [requests, setRequests] = useState<DepositRequest[]>([]);
  const [tab, setTab] = useState<TabId>("overview");
  // Which capture the canvas is replaying. Session-local and never persisted:
  // it is a way of looking at the record, not a change to it. The deposit
  // rail reads it only to say the quiet line about entry price.
  const [capture, setCapture] = useState<Capture>("honest");

  const refresh = useCallback(() => {
    setVault(resolveVault());
    setNowMs(Date.now());
    setRequests(loadRequestsFor(HERO_SLUG));
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener(VAULTS_EVENT, refresh);
    return () => {
      window.removeEventListener(VAULTS_EVENT, refresh);
    };
  }, [refresh]);

  const strikes = heroStrikes();
  const navUsd = heroNavUsd();
  const navPerShare = heroNavPerShare();
  const navOrCapital = navUsd ?? vault.baseTvlUsd;
  const { venue, chain } = venueParts(vault.venue);

  // One vault exists; any other slug is a quiet miss, not an error page.
  if (slug !== vault.slug) {
    return (
      <div className="vpx">
        <div className="vpx-miss">
          <p>No vault lives at this address.</p>
          <Link href="/vault">Back to all vaults</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="vpx">
      <div className="vpx-crumb">
        <Link href="/vault">◂ All vaults</Link>
      </div>

      <header className="vp-head">
        <div className="vp-kicker">
          {vault.strategyLabel} · curated by {vault.curator}
        </div>
        <h1 className="vp-name">
          {vault.name}
          <span className="vchip">Attested</span>
        </h1>
        <p className="vp-summary">{vault.summary}</p>
      </header>

      {/* The register line lives next to the one surface that looks live. */}
      <p className="vp-replaying">
        Replaying captured journal. These strikes were recorded on Base and are replayed here; the
        page is not polling a live chain.
      </p>

      <VerificationCanvas
        capture={capture}
        onCapture={setCapture}
        vault={vault}
        navPerShare={navPerShare}
      />

      <p className="vp-note">
        Corrupting an operator plays the second capture, in which one node reported an inflated NAV
        and was rejected. Nothing on this page edits a journal, and no strike here is live.
      </p>

      <StatBand
        vault={vault}
        navUsd={navOrCapital}
        shareValue={navPerShare ?? 1}
        strikes={strikes}
      />

      <nav className="vp-tabs vpx-tabs" aria-label="Vault sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`vp-tab${tab === t.id ? " on" : ""}`}
            onClick={() => {
              setTab(t.id);
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="vpx-body">
        <div className="vp-main">
          {tab === "overview" && (
            <section className="vp-sec">
              <h2 className="vp-sec-h">Overview</h2>
              <p className="vp-prose">
                {`${vault.name} runs a recursive ${vault.market} loop on ${venue}, ${chain}, with the desk's own capital. `}
                Every NAV strike is re-executed independently by three operators from one component
                digest and one input block; the quorum attests the number only when their result
                hashes match, so a single operator cannot move the NAV it reports.
              </p>
              <div className="vp-mods">
                {vault.moduleLines.map((m) => (
                  <div className="vp-mod" key={m.name}>
                    <b>{m.name}</b>
                    <span>{m.line}</span>
                  </div>
                ))}
              </div>
              <p className="vp-note">
                The projected APY on this page is modeled. The NAV, the share price and the strike
                ledger are not: they are read off the journal.
              </p>
            </section>
          )}

          {tab === "automations" && (
            <section className="vp-sec">
              <h2 className="vp-sec-h">Automations</h2>
              <OperatorInstrument strikes={strikes} />
              <LeverageInstrument vault={vault} nowMs={nowMs} />
              <HedgeInstrument vault={vault} nowMs={nowMs} />
              <CompoundInstrument vault={vault} nowMs={nowMs} tvlUsd={navOrCapital} />
              <p className="vp-note">
                Envelope and harvest meter are the vault&apos;s published parameters, modeled. The
                attestation instrument is read from the journal.
              </p>
            </section>
          )}

          {tab === "performance" && (
            <section className="vp-sec">
              <h2 className="vp-sec-h">Performance</h2>
              <AttestedPerformance strikes={strikes} navPerShare={navPerShare} />
            </section>
          )}

          {tab === "parameters" && (
            <section className="vp-sec">
              <h2 className="vp-sec-h">Parameters</h2>
              <div className="vp-rows">
                {vault.params.map((p) => (
                  <div className="vp-row" key={p.label}>
                    <span className="vp-row-l">{p.label}</span>
                    <span className="vp-row-lead" />
                    <span className="vp-row-v">{p.value}</span>
                  </div>
                ))}
                {riskGrade(vault).rows.map((r) => (
                  <div className="vp-row" key={r.label}>
                    <span className="vp-row-l">{r.label}</span>
                    <span className="vp-row-lead" />
                    <span className="vp-row-v">{r.value}</span>
                  </div>
                ))}
              </div>
              <p className="vp-note">{riskGrade(vault).sentence}</p>
              <AttestationParameters strikes={strikes} />
            </section>
          )}

          {tab === "activity" && (
            <section className="vp-sec">
              <h2 className="vp-sec-h">Activity</h2>
              <StrikeLedger strikes={strikes} />
              {requests.length > 0 && (
                <div className="vp-rows" style={{ marginTop: 14 }}>
                  {requests.map((r) => (
                    <div className="act-row" key={r.id}>
                      <span className="act-a">
                        {r.status === "settled"
                          ? "Deposit settled"
                          : r.status === "cancelled"
                            ? "Request cancelled"
                            : "Deposit requested"}
                      </span>
                      <span className="act-d">
                        {fmtUsdFull(r.amountUsd)}
                        {r.fill
                          ? ` at ${r.fill.navPerShare.toFixed(6)} per share, strike ${String(r.fill.strikeBlock)}`
                          : ""}
                      </span>
                      <span className="act-t">{fmtAgo(Date.parse(r.requestedAt), nowMs)}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="vp-note">
                Two captured strikes, replayed. Nothing on this ledger deep-links to an explorer:
                the transactions belong to the capture, not to this session.
              </p>
            </section>
          )}
        </div>

        <aside className="vp-rail">
          <AttestedDepositCard
            vault={vault}
            navPerShare={navPerShare}
            onAmount={setAmountUsd}
            corrupted={capture === "corrupted"}
          />
          <ProjectionCard
            vault={vault}
            amountUsd={amountUsd}
            footnote="At the current modeled rate. The deposit itself settles at the next attested NAV strike."
          />
        </aside>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────── stat band ── */

function StatBand({
  vault,
  navUsd,
  shareValue,
  strikes,
}: {
  vault: VaultRecord;
  navUsd: number;
  shareValue: number;
  strikes: readonly StrikeRow[];
}) {
  const newest = strikes[0];
  const cells: { label: string; modeled?: boolean; value: string }[] = [
    { label: "NAV", value: fmtUsdFull(navUsd) },
    { label: "Share value", value: shareValue.toFixed(6) },
    { label: "Quorum", value: newest ? newest.quorum.thresholdLabel : "-" },
    { label: "Net APY", modeled: true, value: fmtPct(vault.modeledApy) },
  ];
  return (
    <div className="vp-band">
      {cells.map((c) => (
        <div className="vp-cell" key={c.label}>
          <div className="vp-cell-l">
            {c.label} <i>{c.modeled === true ? "modeled" : "attested"}</i>
          </div>
          <div className="vp-cell-v">{c.value}</div>
        </div>
      ))}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── performance ── */

function AttestedPerformance({
  strikes,
  navPerShare,
}: {
  strikes: readonly StrikeRow[];
  navPerShare: number | null;
}) {
  // Oldest to newest, one point per settled strike. Two captures today.
  const series = [...strikes]
    .reverse()
    .map((s) => s.navPerShare)
    .filter((v): v is number => v !== null);
  return (
    <div className="vp-chart">
      <div className="vp-chart-head">
        <div>
          <div className="vp-chart-k">Share value, attested</div>
          <div className="vp-chart-v">{(navPerShare ?? 1).toFixed(6)}</div>
        </div>
        <span className="vchip">{series.length} strikes</span>
      </div>
      <div className="vp-chart-body" style={{ height: 150 }}>
        {/* No area tint: a filled curve under two flat attested points would
            imply growth the journal does not report. Hairline only. */}
        <Sparkline
          values={series}
          fill={false}
          markPoints
          viewHeight={64}
          label="Attested share value per strike"
        />
      </div>
      <p className="vp-note">
        One point per captured strike. The line is flat because both strikes settled at the same
        NAV, and this page will not draw a curve the journal does not contain.
      </p>
    </div>
  );
}

/* ───────────────────────────────────────────────── attestation parameters ── */

function AttestationParameters({ strikes }: { strikes: readonly StrikeRow[] }) {
  const journal = DEMO_JOURNALS[0]?.journal;
  const newest = strikes[0];
  if (!journal || !newest) return null;
  const rows: { label: string; value: string }[] = [
    { label: "Component digest", value: journal.component_digest },
    { label: "Service id", value: truncateAddress(journal.service_id) },
    { label: "Vault", value: truncateAddress(journal.vault.address) },
    { label: "Chain id", value: String(journal.vault.chain_id) },
    { label: "Operators registered", value: String(newest.quorum.total) },
    // The operator set itself, folded in here rather than given a panel of its
    // own. Addresses come from the journal, which is the only place in this app
    // an operator identity is attested; the peer mesh and the registry contract
    // are fixture data and are deliberately not quoted in this block.
    ...journal.operators.map((op, index) => ({
      label: `Operator ${String(index + 1)}`,
      value: truncateAddress(op.id),
    })),
    { label: "Quorum threshold", value: newest.quorum.thresholdLabel },
    {
      label: "NAV unit",
      value: `${journal.nav_unit.asset}, ${String(journal.nav_unit.decimals)} decimals`,
    },
    { label: "Latest inputs block", value: String(newest.inputsBlock) },
    { label: "Winning result hash", value: truncateHash(newest.operators[0]?.resultHash ?? "", 10, 6) },
    {
      label: "Latest attested NAV",
      value:
        newest.navUsd === null
          ? "-"
          : `${formatAttestedNav(newest.navUsd, newest.navDecimals)} ${newest.navAsset}`,
    },
  ];
  return (
    <>
      <h3 className="vp-sec-h" style={{ fontSize: 16, margin: "22px 0 12px" }}>
        Attestation
      </h3>
      <div className="vp-rows">
        {rows.map((r) => (
          <div className="vp-row" key={r.label}>
            <span className="vp-row-l">{r.label}</span>
            <span className="vp-row-lead" />
            <span className="vp-row-v">{r.value}</span>
          </div>
        ))}
      </div>
      <p className="vp-note">
        Three operators re-execute the same component against the same input block. Today the desk
        runs them; the shape does not change when independent operators do.
      </p>
    </>
  );
}
