"use client";

/**
 * DEBUG HARNESS — engineering tool, not a demo surface.
 *
 * The engine (lib/replay.ts) is the deliverable; this page exists only to
 * prove it drives end to end against the two **captured** journals: pick a
 * strike, run the clock, dump the derived `ReplayState`. It is intentionally
 * unstyled.
 *
 * `/` is the presentation surface and runs on the simulator instead. This
 * page is the only place `lib/source.ts` is exercised in the app, so it is
 * also the first thing to point at a `PollingJournalSource` when one exists.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Journal } from "@priime-demo/journal-schema";

import { componentDigestMatches } from "@/lib/environment";
import { formatNavPct, formatUtcTime, truncateHash } from "@/lib/format";
import { buildTimeline, deriveReplayState } from "@/lib/replay";
import { demoJournalSource, type StrikeRef } from "@/lib/source";

const MONO: React.CSSProperties = { fontFamily: "var(--font-mono, monospace)" };
const BOX: React.CSSProperties = {
  border: "1px dashed var(--border, #555)",
  padding: "12px",
  marginBottom: "16px",
};

export default function DebugHarness() {
  const [refs, setRefs] = useState<readonly StrikeRef[]>([]);
  const [strikeId, setStrikeId] = useState<string>("");
  const [journal, setJournal] = useState<Journal | null>(null);
  const [tMs, setTMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const frameRef = useRef<number | null>(null);

  // `?strike=<strike_id>&t=<ms>&play=1` deep-links a frame (and optionally
  // starts the clock), so the harness can be driven headlessly (curl /
  // chrome --dump-dom) as well as by hand.
  const query = useRef<{ strike: string | null; t: number | null; play: boolean }>({
    strike: null,
    t: null,
    play: false,
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("t");
    query.current = {
      strike: params.get("strike"),
      t: t === null || Number.isNaN(Number(t)) ? null : Number(t),
      play: params.get("play") === "1",
    };

    let live = true;
    void demoJournalSource.list().then((list) => {
      if (!live) return;
      setRefs(list);
      if (list.length === 0) return;
      const wanted = list.find((ref) => ref.strikeId === query.current.strike);
      setStrikeId((wanted ?? list[0]!).strikeId);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (strikeId === "") return;
    let live = true;
    void demoJournalSource.get(strikeId).then((next) => {
      if (!live) return;
      setJournal(next);
      setTMs(query.current.t ?? 0);
      setPlaying(query.current.play);
    });
    return () => {
      live = false;
    };
  }, [strikeId]);

  const timeline = useMemo(() => (journal === null ? null : buildTimeline(journal)), [journal]);
  const state = useMemo(
    () =>
      journal === null || timeline === null
        ? null
        : deriveReplayState(journal, tMs, timeline),
    [journal, timeline, tMs],
  );

  useEffect(() => {
    if (!playing || timeline === null) return;
    let previous = performance.now();
    const step = (now: number) => {
      const delta = now - previous;
      previous = now;
      setTMs((current) => {
        const next = current + delta;
        if (next >= timeline.durationMs) {
          setPlaying(false);
          return timeline.durationMs;
        }
        return next;
      });
      frameRef.current = requestAnimationFrame(step);
    };
    frameRef.current = requestAnimationFrame(step);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [playing, timeline]);

  const togglePlay = useCallback(() => {
    setPlaying((current) => {
      if (current) return false;
      if (timeline !== null && tMs >= timeline.durationMs) setTMs(0);
      return true;
    });
  }, [timeline, tMs]);

  return (
    <main style={{ ...MONO, padding: "24px", maxWidth: "980px", fontSize: "13px" }}>
      <h1 style={{ fontSize: "16px", marginBottom: "12px" }}>
        replay engine debug harness (throwaway)
      </h1>

      <div style={BOX}>
        <label>
          strike{" "}
          <select
            value={strikeId}
            onChange={(event) => setStrikeId(event.target.value)}
            data-testid="strike-select"
          >
            {refs.map((ref) => (
              <option key={ref.strikeId} value={ref.strikeId}>
                {ref.label} [{ref.status}] {ref.strikeId}
              </option>
            ))}
          </select>
        </label>
      </div>

      {state !== null && timeline !== null && journal !== null ? (
        <>
          <div style={BOX}>
            <button type="button" onClick={togglePlay} data-testid="play-toggle">
              {playing ? "pause" : "play"}
            </button>{" "}
            <button type="button" onClick={() => setTMs(0)}>
              reset
            </button>{" "}
            <input
              type="range"
              min={0}
              max={timeline.durationMs}
              step={10}
              value={tMs}
              onChange={(event) => {
                setPlaying(false);
                setTMs(Number(event.target.value));
              }}
              style={{ width: "460px", verticalAlign: "middle" }}
              data-testid="scrub"
            />{" "}
            <span data-testid="clock">
              {(tMs / 1000).toFixed(2)}s / {(timeline.durationMs / 1000).toFixed(2)}s
            </span>
          </div>

          <div style={BOX} data-testid="summary">
            <div>
              phase=<b>{state.phase}</b> done={String(state.done)} events=
              {state.eventsFired}/{timeline.events.length} last=
              {state.lastEvent?.kind ?? "-"}
            </div>
            <div>
              quorum {state.quorum.cumulative}/{state.quorum.threshold} of{" "}
              {state.quorum.total} reached={String(state.quorum.reached)} winning=
              {truncateHash(state.quorum.winningResultHash ?? "-")}
            </div>
            <div>
              attestation={state.attestation.status}
              {state.attestation.status === "landed"
                ? ` tx=${truncateHash(state.attestation.txHash)} block=${state.attestation.blockNumber} nav_final=${state.attestation.navFinal} at=${formatUtcTime(state.attestation.timestamp)}`
                : ""}
            </div>
            <div>component_digest matches env fixture: {String(componentDigestMatches(journal))}</div>
          </div>

          <table style={{ ...BOX, width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th align="left">operator</th>
                <th align="left">result_hash</th>
                <th align="left">nav</th>
                <th align="left">vs winner</th>
                <th align="left">accepted</th>
                <th align="left">matches</th>
                <th align="left">t</th>
              </tr>
            </thead>
            <tbody data-testid="operators">
              {state.operators.map((operator) => (
                <tr key={operator.id}>
                  <td>{truncateHash(operator.id)}</td>
                  <td>{truncateHash(operator.result_hash)}</td>
                  <td>{operator.nav}</td>
                  <td>
                    {state.attestation.status === "landed" &&
                    state.attestation.navFinal !== null
                      ? formatNavPct(operator.nav, state.attestation.navFinal)
                      : "-"}
                  </td>
                  <td>{String(operator.accepted)}</td>
                  <td>{String(operator.matchesWinningHash)}</td>
                  <td>{formatUtcTime(operator.timestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <pre style={{ ...BOX, whiteSpace: "pre-wrap" }} data-testid="state-dump">
            {JSON.stringify(state, null, 2)}
          </pre>
        </>
      ) : (
        <p>loading…</p>
      )}
    </main>
  );
}
