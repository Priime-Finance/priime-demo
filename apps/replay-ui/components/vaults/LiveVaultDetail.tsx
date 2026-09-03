"use client";

/**
 * Minimal detail page for a live loop: pulls `/api/loops/[id]` for identity
 * and `/api/loops/[id]/journals` for the strike ledger. Everything shown here
 * is attested; no modeled numbers anywhere.
 *
 * Kept small on purpose. The rich Antoni layout on `/vault/[slug]` is the
 * hero surface; this is the honest "look at real attested strikes on your
 * own loop" companion. When Khaled's canvas is ready to eat live journals,
 * this component moves under it.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import type { Journal } from "@priime-demo/journal-schema";
import type { LoopRecord } from "@priime-demo/loop-deploy";

import { fetchLoop, fetchLoopJournals } from "@/lib/vaults/live-source";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; loop: LoopRecord; journals: Journal[] };

export function LiveVaultDetail({ id }: { id: string }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    Promise.all([fetchLoop(id), fetchLoopJournals(id, 20)])
      .then(([detail, journals]) => {
        if (alive) setState({ kind: "ready", loop: detail.loop, journals: journals.journals });
      })
      .catch((e: unknown) => {
        if (alive) setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      alive = false;
    };
  }, [id]);

  if (state.kind === "loading") {
    return <p className="dir-live-msg">Loading live loop…</p>;
  }
  if (state.kind === "error") {
    return (
      <div className="dir-live-msg">
        <p>Could not load loop <b>{id}</b>: {state.message}.</p>
        <p>
          <Link href="/vault">Back to vaults</Link>
        </p>
      </div>
    );
  }

  const { loop, journals } = state;
  return (
    <div className="live-vault">
      <header className="live-vault-head">
        <div>
          <div className="dir-kicker">Live loop</div>
          <h1 className="dir-title">{loop.name}</h1>
          <p className="dir-sub">
            Deployed through the loop server. Every strike below is a real on-chain attestation from
            the WAVS pipeline on this loop&apos;s handler. Not a replay.
          </p>
        </div>
        <Link className="dir-create" href="/vault">
          All vaults
        </Link>
      </header>

      <dl className="live-vault-facts vn">
        <div>
          <dt>Loop id</dt>
          <dd>{loop.id}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{loop.status}</dd>
        </div>
        <div>
          <dt>Handler</dt>
          <dd>{loop.handlerAddress ?? "pending"}</dd>
        </div>
        <div>
          <dt>Strategist</dt>
          <dd>{loop.strategist}</dd>
        </div>
        <div>
          <dt>Workflow id</dt>
          <dd>{loop.workflowId}</dd>
        </div>
      </dl>

      <section className="live-vault-strikes">
        <h2 className="dir-live-title">Attested strikes ({String(journals.length)})</h2>
        {journals.length === 0 ? (
          <p className="dir-live-msg">
            No strikes attested to this handler yet. Give the cron cycle a beat.
          </p>
        ) : (
          <table className="live-vault-table vn">
            <thead>
              <tr>
                <th>Inputs block</th>
                <th>NAV (base units)</th>
                <th>Operators</th>
                <th>Quorum</th>
                <th>Attestation tx</th>
              </tr>
            </thead>
            <tbody>
              {journals.map((j) => (
                <tr key={j.strike_id}>
                  <td>{String(j.inputs_block)}</td>
                  <td>{j.attestation.nav_final ?? "-"}</td>
                  <td>{String(j.operators.length)}</td>
                  <td>{`${String(j.quorum.threshold)} of ${String(j.quorum.total)} ${j.quorum.reached ? "reached" : "pending"}`}</td>
                  <td>{j.attestation.tx_hash ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
