"use client";

/**
 * `/vaults/loop-xxxxxxxx`: the page of a loop loop-server actually deployed.
 *
 * The second of the two registers `/vaults/[slug]` serves, and the reason the
 * merge exists. `VaultDetail` renders a COMPOSITION: a record the builder
 * priced, whose APY, projection, capacity and automation instruments are
 * modeled and say so. This renders a DEPLOYMENT: a handler on a chain, a cron
 * on the shared WAVS service, and the journals its operator quorum signed.
 * Nothing here is modeled, so nothing here is labeled modeled; and nothing a
 * deployment cannot know is drawn with a placeholder number in it. A page with
 * four honest tiles beats a page with nine tiles and five inventions.
 *
 * MARKUP IS ANTONI'S, DATA IS JAKUB'S (the integration's ownership rule).
 * Every class on this page is already in `app/vaults/vaults.css` and
 * `canvas.css` and is used identically by `VaultDetail`: the header zone, the
 * stat band, the bounded panel with the sticky tab strip as its header, the
 * key/value panels, the strike ledger, the activity table. This component
 * introduces no visual vocabulary of its own; it only decides WHICH of
 * Antoni's parts a deployment has the facts to fill. The data comes through
 * `lib/vaults/live-source.ts`, unchanged.
 *
 * WHAT IS ABSENT AND WHY. No Automations, Performance or Parameters
 * section: those render a `VaultRecord`'s published dials, and a deployment
 * stores a config, not a composition. No capacity instrument: nobody
 * published a ceiling. No modeled share value: the v1 journal attests a NAV,
 * not a share supply, and this vault published no share count on top of the
 * ERC-4626 accounting a claim mints.
 *
 * DEPOSIT IS ON THIS PAGE. `DepositCard` renders the ERC-7540 request +
 * claim flow against the vault directly; nothing about the deposit path
 * touches loop-server. See the card's own doc for the tx sequence.
 *
 * DEGRADING. A 502 from `/api/loops/*` is the EXPECTED state during a demo
 * pause or a fresh dev boot, so it is a rendered state with its own copy and
 * never a thrown render. The poll below keeps the last good payload on a
 * failed refresh: a strike that landed does not un-land because the server
 * went away for twelve seconds.
 */

import Link from "next/link";
import { useCallback, useEffect, useState, type CSSProperties } from "react";

import type { LoopRecord, StrikeRecord } from "@priime-demo/loop-deploy";

import { ActivityTable, executionRows, verifyHref } from "./ActivitySection";
import DepositCard from "./DepositCard";
import RedeemCard from "./RedeemCard";
import { MarketWord } from "./MarketWord";
import type { Address } from "viem";
import SectionTabs, { type TabSection } from "./SectionTabs";
import { StrikeLedger } from "./StrikeLedger";
import {
  attestedNavReading,
  cadenceText,
  journalExecutions,
  liveAttestationNote,
  liveAttestationRows,
  observedKnobRows,
  liveQuorum,
  loopFacts,
  marketWords,
  readLoopConfig,
} from "./live-loop";
import { truncateAddress } from "@/lib/format";
import { AWAITING_LABEL, strikeRows } from "@/lib/vaults/attested";
import { fetchLoop, fetchLoopJournals, pauseLoop } from "@/lib/vaults/live-source";
import { withParamKinds } from "@/lib/vaults/param-kind";
/* The product's one money format, from the same owner every other headline
   figure on a vault page reads. */
import { fmtUsd } from "@/lib/vaults/store";

/**
 * How many journals to ask for. loop-server's reader is the only thing that
 * knows how many exist; twenty is the same window `live-source` defaults to
 * and comfortably more than the eight rows the ledger prints.
 */
const JOURNAL_WINDOW = 20;

/**
 * Refresh cadence, milliseconds. The cron can strike as often as every five
 * seconds, so a page that fetched once on mount would show a demo audience a
 * loop that never moves. Twelve seconds is slower than any human notices and
 * far cheaper than the strike rate.
 */
const POLL_MS = 12_000;

/** The section strip. Overview → Deposit → Verification → Activity. */
const SECTIONS: TabSection[] = [
  { id: "overview", label: "Overview" },
  { id: "deposit", label: "Deposit" },
  { id: "verification", label: "Verification" },
  { id: "activity", label: "Activity" },
];

/** The one sentence that says which register this whole page is in. */
export const DEPLOYMENT_SUMMARY =
  "Deployed through loop-server onto its own service handler. Every value on this page is either a field the server stored at deploy or a fact the operator quorum attested on chain. Nothing here is modeled.";

/**
 * The absence, stated rather than left to be noticed. A reader arriving from
 * the showcase will look for the instruments and should be told, once, why a
 * real deployment has fewer numbers on it than a composition does.
 */
export const ABSENCE_NOTE =
  "No modeled APY, projection or capacity bar appears here — those are properties of a composition the builder priced, not of a deployment. Deposits are still real: the card below escrows USDC and mints shares once the quorum attests the next NAV.";

/** What the strike ledger says before the first strike lands. */
const NO_STRIKES =
  "No strike recorded on this handler yet. The first one lands within a strike cadence.";

/** What the activity table says before the first attestation reaches the chain. */
const NO_EXECUTIONS =
  "No attestation has landed on chain for this loop yet.";

type LoadState =
  | { kind: "loading" }
  | { kind: "unreachable"; message: string }
  | { kind: "ready"; loop: LoopRecord; journals: StrikeRecord[] };

export default function LiveLoopDetail({ id }: { id: string }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  // Minute-quantized on the first pass so the server render and the hydration
  // agree on every relative time, then live once the poll takes over. Same
  // contract VaultDetail holds itself to.
  const [nowMs, setNowMs] = useState(() => Math.floor(Date.now() / 60e3) * 60e3);

  useEffect(() => {
    // One `alive` flag for the mount, shared by the first read and every poll,
    // so an in-flight refresh cannot land on an unmounted page.
    let alive = true;
    const load = () => {
      Promise.all([fetchLoop(id), fetchLoopJournals(id, JOURNAL_WINDOW)])
        .then(([detail, feed]) => {
          if (alive) setState({ kind: "ready", loop: detail.loop, journals: feed.journals });
        })
        .catch((e: unknown) => {
          // A refresh that fails leaves the page as it was: the last payload
          // is still true, it is just no longer being confirmed.
          if (!alive) return;
          const message = e instanceof Error ? e.message : String(e);
          setState((prev) => (prev.kind === "ready" ? prev : { kind: "unreachable", message }));
        });
    };
    load();
    const poll = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(poll);
    };
  }, [id]);

  useEffect(() => {
    setNowMs(Date.now());
    const tick = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);
  const [pausing, setPausing] = useState<{ kind: "idle" } | { kind: "busy" } | { kind: "error"; message: string }>({ kind: "idle" });
  const onPause = useCallback(async () => {
    if (pausing.kind === "busy") return;
    setPausing({ kind: "busy" });
    try {
      const res = await pauseLoop(id);
      setState((prev) => (prev.kind === "ready" ? { ...prev, loop: res.loop } : prev));
      setPausing({ kind: "idle" });
    } catch (err) {
      setPausing({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, [id, pausing.kind]);

  if (state.kind === "loading") return <div className="vx-root" />;

  if (state.kind === "unreachable") {
    return (
      <div className="vx-root vx-notfound">
        <span className="vx-kicker">Deployed loops</span>
        <h1 className="vx-title">No loop answered for {id}</h1>
        {/* Two causes, one honest sentence. The slug is well formed (it got
            past `isLiveLoopSlug`), so either loop-server is not up or this
            deployment is not on the server this build points at. Guessing
            which would be a claim; naming both is a fact. */}
        <p className="vx-sub">
          loop-server did not answer for this id. It may be paused, or this deployment may live on a
          different server than the one this build points at.
        </p>
        <p className="vxd-note">{state.message}</p>
        <Link className="vx-cta" href="/vaults">
          Browse all vaults
        </Link>
      </div>
    );
  }

  const { loop, journals } = state;
  const config = readLoopConfig(loop.configJson);
  const quorum = liveQuorum(journals);
  const nav = attestedNavReading(journals);
  const settled = journals.filter((j) => j.status === "settled").length;
  const candidateId = config?.candidateId ?? null;
  const market = candidateId === null ? null : marketWords(candidateId);
  const cronSeconds = config?.cronSeconds ?? null;
  /* `strikeRows` takes a share supply because the CAPTURED hero published one.
     A deployment has not, so the default is passed and the `navPerShare` it
     derives is never read: `StrikeLedger` prints the attested NAV, the
     operators and the quorum, and no per-share figure exists on this page. */
  const strikes = strikeRows(journals);
  const attestation = withParamKinds(liveAttestationRows(journals));
  const facts = withParamKinds(loopFacts(loop, config, journals));
  const loopLedger = executionRows(journalExecutions(journals));
  const loopVerifiable = loopLedger.some((r) => verifyHref(r) !== null);
  const observedKnobs = observedKnobRows(config, journals);

  return (
    <div className="vx-root vxd">
      {/* A. Header zone, the record page's own */}
      <Link className="vx-back" href="/vaults">
        ← All vaults
      </Link>
      <header className="vxd-head">
        <h1 className="vxd-title">{loop.name}</h1>
        <div className="vx-dmeta">
          <span className="vx-tag">Deployed loop</span>
          {/* The chip is the record's OWN status word, from loop-server. The
              green heartbeat is granted to `active` only; a deploy that is
              still walking its steps, or one that failed, takes the neutral
              pill and says which. */}
          {loop.status === "active" ? (
            <span className="vx-status">Active</span>
          ) : (
            <span className="vx-tag vx-tag--stage">{loop.status}</span>
          )}
          {market === null ? null : (
            <span className="vx-card-mkt">
              <MarketWord market={market.pair} /> · {market.venue}
            </span>
          )}
          <span className="vx-dmeta-cur">
            Strategist <b>{truncateAddress(loop.strategist)}</b>
          </span>
        </div>
        {loop.status === "inactive" ? (
          <p className="vxd-note vxd-note--muted">
            Paused. Workflow removed from the service; operators no longer schedule strikes. On-chain vault (
            {truncateAddress(loop.handlerAddress ?? "")}) still holds any deposited assets.
          </p>
        ) : (
          <div className="vxd-actions">
            <button
              type="button"
              className="vxd-btn vxd-btn--ghost"
              onClick={() => { void onPause(); }}
              disabled={pausing.kind === "busy"}
              title="Stop the operator quorum from scheduling this loop's strikes"
            >
              {pausing.kind === "busy" ? "Pausing…" : "Pause loop"}
            </button>
            {pausing.kind === "error" ? (
              <span className="vxd-note vxd-note--err">{pausing.message}</span>
            ) : null}
          </div>
        )}
        <p className="vx-dsummary">{DEPLOYMENT_SUMMARY}</p>
      </header>

      {/* B. Stat band. Four tiles, and every one of them is a fact the server
          or the quorum stated. There is no fifth tile because there is no
          fifth fact. */}
      <div className="vx-stats">
        <div className="vx-stat" style={{ "--i": 0 } as CSSProperties}>
          <i>NAV</i>
          {/* Rounded here like every other headline on the product. The
              journal's full base-unit precision is printed once, in the
              Attestation rows below (A.3 #13), and the caption names the unit
              so the dollar sign is never read as a currency claim. */}
          <b>{nav === null ? AWAITING_LABEL : fmtUsd(nav.value)}</b>
          <small>
            {/* HONESTY PASS: this caption used to open with "attested" in
                BOTH branches, so a loop whose first strike had not landed
                printed "awaiting strike" over the word attested. Nothing has
                been attested at that point; the quorum has not signed
                anything. The word is earned only by the branch that has a
                settled strike behind it. */}
            {nav === null
              ? "no strike has settled yet"
              : `attested in ${nav.asset}, newest settled strike`}
          </small>
        </div>
        <div className="vx-stat" style={{ "--i": 1 } as CSSProperties}>
          <i>Strikes</i>
          <b>{settled}</b>
          <small>
            settled of {journals.length} recorded
          </small>
        </div>
        <div className="vx-stat" style={{ "--i": 2 } as CSSProperties}>
          <i>Quorum</i>
          <b>{quorum === null ? AWAITING_LABEL : quorum.requiredLabel}</b>
          <small>
            {quorum === null ? "no journal yet" : "registered on this deployment"}
          </small>
        </div>
        {cronSeconds === null ? null : (
          <div className="vx-stat" style={{ "--i": 3 } as CSSProperties}>
            <i>Cadence</i>
            <b>{cadenceText(cronSeconds)}</b>
            <small>cron on the shared service</small>
          </div>
        )}
      </div>

      {/* C + D. The bounded panel, the sticky strip as its header. No row 1
          two-column split: there is no rail to put beside the sections. */}
      <div className="vxd-panel">
        <SectionTabs sections={SECTIONS} />

        <div className="vxd-wide">
          <section id="overview" className="vxd-sec">
            <h2 className="vxd-sec-h">Overview</h2>
            <div className="vx-panel">
              <p className="vxd-desc">
                This loop runs as one workflow on the shared WAVS service. On every cron tick the
                component re-reads the position at a pinned block, the operator set signs the result,
                and the handler accepts the packet only after it has checked that signature against
                the registry.
              </p>
              <p className="vxd-desc vxd-desc--note">{ABSENCE_NOTE}</p>
            </div>
            <div className="vx-panel">
              <div className="vx-panel-h">Deployment</div>
              {facts.map((f) => (
                <div key={f.label} className={`vx-kv${f.kind === "prose" ? " vx-kv--prose" : ""}`}>
                  <span>{f.label}</span>
                  <b data-kind={f.kind}>{f.value}</b>
                </div>
              ))}
            </div>
          </section>

          <section id="deposit" className="vxd-sec">
            <h2 className="vxd-sec-h">Deposit</h2>
            {loop.handlerAddress === null ? (
              <div className="vx-panel vxd-dep">
                <p className="vxd-desc">
                  Deposit is unavailable — this loop has no handler address recorded on
                  loop-server. Redeploy or wait for the deployment to complete.
                </p>
              </div>
            ) : (
              <>
                <DepositCard
                  handlerAddress={loop.handlerAddress as Address}
                  hasSettledStrike={settled > 0}
                />
                <RedeemCard handlerAddress={loop.handlerAddress as Address} />
              </>
            )}
          </section>

          <section id="verification" className="vxd-sec">
            <h2 className="vxd-sec-h">Verification</h2>
            <div className="vx-panel">
              <p className="vxd-desc">
                {quorum === null
                  ? "The operator set re-executes the component against one pinned input block and the quorum attests the NAV only once their result hashes agree. This loop has recorded no strike yet, so the numbers below are absent rather than assumed."
                  : liveAttestationNote(quorum)}
              </p>
            </div>
            <div className="vx-panel vx-ledger" style={{ marginTop: 16 }}>
              <div className="vx-panel-h">Strikes</div>
              {strikes.length === 0 ? (
                <p className="vxd-desc vxd-desc--note">{NO_STRIKES}</p>
              ) : (
                <StrikeLedger strikes={strikes} />
              )}
            </div>
            {strikes.length === 0 ? null : (
              <div className="vx-panel vx-attest" style={{ marginTop: 16 }}>
                <div className="vx-panel-h">Operator decisions</div>
                <p className="vxd-desc vxd-desc--note">
                  What the quorum decided this vault should do at each strike. Every step is a
                  whitelisted-target calldata batch signed as part of the same payload the NAV rides
                  in, so the operators cannot decide one thing and land another. Empty means they saw
                  no action to take; rejected means the batch reverted on-chain (NAV attestation still
                  landed) and the reason is the failing step&apos;s revert bytes.
                </p>
                {journals
                  .slice()
                  .sort((a, b) => b.inputs_block - a.inputs_block)
                  .slice(0, 6)
                  .map((j) => (
                    <div key={j.strike_id} className="vx-kv vx-kv--prose">
                      <span>
                        strike {j.inputs_block} ·{" "}
                        <span data-kind="hex">{j.plan.status}</span>
                        {j.plan.stepCount === 0 ? null : ` · ${j.plan.stepCount} steps`}
                      </span>
                      <b data-kind="phrase">
                        {j.plan.status === "empty"
                          ? "no action"
                          : j.plan.status === "rejected"
                          ? `rejected: ${j.plan.reason ?? "no reason bytes"}`
                          : j.plan.steps.map((s) => s.label).join(" -> ")}
                      </b>
                    </div>
                  ))}
              </div>
            )}
            {observedKnobs.length === 0 ? null : (
              <div className="vx-panel vx-attest" style={{ marginTop: 16 }}>
                <div className="vx-panel-h">Composer knobs, observed</div>
                <p className="vxd-desc vxd-desc--note">
                  Every strategist dial the operator quorum measures at the pinned inputs block.
                  Configured is what the strategist published; measured is what the quorum attested
                  in the payload. Both are cryptographically bound to the pinned service.json, so a
                  single operator running a divergent config or reading a different block produces a
                  divergent hash and gets outvoted.
                </p>
                {observedKnobs.map((r) => (
                  <div key={r.key} className="vx-kv">
                    <span>{r.label}</span>
                    <b data-kind="phrase">
                      {r.configured ?? "not set"}
                      {" · "}
                      {r.measured ?? "awaiting strike"}
                    </b>
                  </div>
                ))}
              </div>
            )}
            {attestation.length === 0 ? null : (
              <div className="vx-panel vx-attest">
                <div className="vx-panel-h">Attestation</div>
                {attestation.map((r) => (
                  <div key={r.label} className={`vx-kv${r.kind === "prose" ? " vx-kv--prose" : ""}`}>
                    <span>{r.label}</span>
                    <b data-kind={r.kind}>{r.value}</b>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* J. Activity: THIS DEPLOYMENT'S OWN STRIKES, and nothing else.
              The nine captured Base mainnet calls live on the showcase record
              (`onchainExecutionsFor`, ActivitySection), where they belong: a
              capture of a different handler on a different chain is evidence
              about the mechanism, not about this loop, and a caption that has
              to open with "not this loop" is the proof it was in the wrong
              place. A deployment with no strikes yet says so. */}
          <section id="activity" className="vxd-sec">
            <h2 className="vxd-sec-h">Activity</h2>
            <div className="vxa-src">
              <span className="vxa-src-k">This loop</span>
              {/* The second clause is DERIVED, not typed: on the fork these
                  rows have no explorer to open and the caption says so, and
                  on a mainnet target (`deploy/targets/`) the same rows carry
                  their Verify keys and the caption drops the excuse. */}
              <p className="vxa-src-note">
                Attestations from this deployment&apos;s own journal feed.
                {loopVerifiable
                  ? ""
                  : " They carry no Verify key: the chain they settled on has no public explorer to open."}
              </p>
              <ActivityTable rows={loopLedger} nowMs={nowMs} empty={NO_EXECUTIONS} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
