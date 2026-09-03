"use client";

/**
 * Live loops section: fetches `/api/loops` (proxy for loop-server) on mount
 * and renders one card per live loop below the hero directory grid. Silently
 * hides when the server is unreachable, so the demo still works with the
 * backend down (captured journals continue to power the hero card above).
 *
 * Every number rendered here is attested (comes from the server's journal
 * reader, which is derived from on-chain state) or is loop metadata (name,
 * strategist). No modeling.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import type { LoopRecord } from "@priime-demo/loop-deploy";

import { fetchLoops } from "@/lib/vaults/live-source";

interface LiveLoopCardData {
  loop: LoopRecord;
}

export function LiveVaultsSection() {
  const [loops, setLoops] = useState<LoopRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchLoops()
      .then((r) => {
        if (alive) setLoops(r.loops);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  if (loops === null && error === null) return null; // loading, keep quiet
  if (error !== null) return null; // backend down; hero card is enough
  if (loops === null || loops.length === 0) return null;

  return (
    <section className="dir-live">
      <header className="dir-live-head">
        <h2 className="dir-live-title">Live loops</h2>
        <p className="dir-live-sub">
          Deployed through the loop server. Every number below is attested from on-chain state, not
          modeled. Handler and NAV come from the running WAVS pipeline.
        </p>
      </header>
      <div className="dir-live-grid">
        {loops.map((loop) => (
          <LiveLoopCard key={loop.id} loop={loop} />
        ))}
      </div>
    </section>
  );
}

function LiveLoopCard({ loop }: LiveLoopCardData) {
  const truncated = `${loop.handlerAddress?.slice(0, 8) ?? "pending"}…${loop.handlerAddress?.slice(-6) ?? ""}`;
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
          Strategist <b className="vn">{`${loop.strategist.slice(0, 6)}…${loop.strategist.slice(-4)}`}</b>
        </span>
        <span className="vchip">Live</span>
      </div>
    </Link>
  );
}
