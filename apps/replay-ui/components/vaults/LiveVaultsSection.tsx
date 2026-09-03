"use client";

/**
 * Live loops section: fetches `/api/loops` (proxy for loop-server) on mount
 * and renders one card per live loop below the hero directory grid. Silently
 * hides when the server is unreachable, so the demo still works with the
 * backend down (captured journals continue to power the hero card above).
 *
 * Includes an inline `CreateLoopForm`; on success the form re-triggers a
 * fetch so the new card appears without a hard reload.
 *
 * Every number rendered here is attested (comes from the server's journal
 * reader, which is derived from on-chain state) or is loop metadata (name,
 * strategist). No modeling.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { LoopRecord } from "@priime-demo/loop-deploy";

import { fetchLoops } from "@/lib/vaults/live-source";

import { CreateLoopForm } from "./CreateLoopForm";

interface LiveLoopCardData {
  loop: LoopRecord;
}

type LoopsState =
  | { kind: "loading" }
  | { kind: "unreachable"; message: string }
  | { kind: "ready"; loops: LoopRecord[] };

export function LiveVaultsSection() {
  const [state, setState] = useState<LoopsState>({ kind: "loading" });

  const reload = useCallback(() => {
    fetchLoops()
      .then((r) => {
        setState({ kind: "ready", loops: r.loops });
      })
      .catch((e: unknown) => {
        setState({ kind: "unreachable", message: e instanceof Error ? e.message : String(e) });
      });
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  if (state.kind === "loading") return null;
  // Backend down: keep quiet, the captured hero card carries the page.
  if (state.kind === "unreachable") return null;

  return (
    <section className="dir-live">
      <header className="dir-live-head">
        <h2 className="dir-live-title">Live loops</h2>
        <p className="dir-live-sub">
          Deployed through the loop server. Every number below is attested from on-chain state, not
          modeled. Handler, NAV and quorum come from the running WAVS pipeline.
        </p>
      </header>

      <CreateLoopForm onCreated={reload} />

      {state.loops.length === 0 ? (
        <p className="dir-live-msg">
          No loops yet. Deploy one above; the first strike lands within a strike cadence.
        </p>
      ) : (
        <div className="dir-live-grid">
          {state.loops.map((loop) => (
            <LiveLoopCard key={loop.id} loop={loop} />
          ))}
        </div>
      )}
    </section>
  );
}

function LiveLoopCard({ loop }: LiveLoopCardData) {
  const truncated = `${loop.handlerAddress?.slice(0, 8) ?? "pending"}...${loop.handlerAddress?.slice(-6) ?? ""}`;
  return (
    <Link className="dir-card dir-card--live" href={`/vault/live/${loop.id}`}>
      <div className="dir-card-h">
        <b>{loop.name}</b>
        <span className="dir-tag">Loop</span>
      </div>
      <div className="dir-mkt vn">Handler {truncated}</div>
      <div className="dir-stats">
        <div>
          <span>Loop id</span>
          <b className="vn">{loop.id}</b>
        </div>
        <div>
          <span>Status</span>
          <b className="vn">{loop.status}</b>
        </div>
      </div>
      <div className="dir-foot">
        <span>
          Strategist <b className="vn">{`${loop.strategist.slice(0, 6)}...${loop.strategist.slice(-4)}`}</b>
        </span>
        <span className="vchip">Live</span>
      </div>
    </Link>
  );
}
