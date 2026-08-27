"use client";

/**
 * PublishFlow — the tight Review and Publish flow for the canvas.
 *
 * Three phases, zero dead ends, no wallet gating:
 *   review     — editable vault name, one-line summary, module chips,
 *                modeled APY, one primary key: Publish vault.
 *   publishing — three beats (Compose, Verify, Publish), ~1.8s, mock.
 *   done       — the composition is ON the vault: the published envelope is
 *                persisted and the single link opens /vault, where the NAV
 *                is attested from the replayed journals.
 *
 * There is one vault, and publishing REPLACES its envelope rather than
 * creating another. The vault's capital, inception and every attested number
 * are untouched by this flow.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  deriveAutomations,
  publishEnvelope,
  type PublishInput,
  type PublishedEnvelope,
} from "@/lib/vaults/store";
import { HERO_SLUG } from "@/lib/vaults/hero";

export interface PublishDraft extends Omit<PublishInput, "name"> {
  defaultName: string;
}

const BEATS = ["Compose", "Verify", "Publish"] as const;

export default function PublishFlow({ draft, onClose }: { draft: PublishDraft; onClose: () => void }) {
  const [name, setName] = useState(draft.defaultName);
  const [phase, setPhase] = useState<"review" | "publishing" | "done">("review");
  const [beat, setBeat] = useState(0);
  const [published, setPublished] = useState<PublishedEnvelope | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const nameRef = useRef<HTMLInputElement>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // The default name is one keystroke to replace.
  useEffect(() => {
    nameRef.current?.select();
  }, []);

  const closeCbRef = useRef(onClose);
  closeCbRef.current = onClose;

  // Escape closes (guarded against the publishing phase).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phaseRef.current !== "publishing") closeCbRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const publish = () => {
    if (phase !== "review") return;
    setPhase("publishing");
    setBeat(0);
    timers.current.push(setTimeout(() => setBeat(1), 620));
    timers.current.push(setTimeout(() => setBeat(2), 1240));
    timers.current.push(
      setTimeout(() => {
        // Automation instrument parameters are fixed here, at publish time,
        // from the composed graph: the hedge instrument exists iff a hedge
        // module was installed on the canvas. The vault page renders these
        // stored parameters, never re-derives them.
        const envelope = publishEnvelope({
          ...draft,
          name: name.trim() || draft.defaultName,
          automations: deriveAutomations(draft),
        });
        setPublished(envelope);
        setPhase("done");
      }, 1860),
    );
  };

  return (
    <div className="bcrev-backdrop" onClick={phase === "publishing" ? undefined : onClose}>
      <div className={`pf${phase === "done" ? " pf--done" : ""}`} onClick={(e) => e.stopPropagation()}>
        {phase === "review" ? (
          <>
            <div className="pf-head">
              <span className="pf-kicker">Review</span>
              <button type="button" className="pf-close" onClick={onClose}>
                Close
              </button>
            </div>
            <label className="pf-name-k" htmlFor="pf-name-input">
              Name your vault
            </label>
            <input
              id="pf-name-input"
              ref={nameRef}
              autoFocus
              className="pf-name"
              value={name}
              maxLength={48}
              aria-label="Vault name"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") publish();
              }}
            />
            <div className="pf-summary">{draft.summary}</div>
            <div className="pf-chips">
              {draft.modules.map((m) => (
                <span key={m} className="pf-chip">
                  {m}
                </span>
              ))}
            </div>
            <div className="pf-apy">
              <b>{(draft.modeledApy * 100).toFixed(1)}%</b>
              <i>modeled net APY</i>
            </div>
            <button type="button" className="pf-publish" onClick={publish}>
              Publish vault
            </button>
          </>
        ) : phase === "publishing" ? (
          <div className="pf-beats">
            {BEATS.map((b, i) => (
              <div key={b} className={`pf-beat${i < beat ? " done" : i === beat ? " now" : ""}`}>
                <span className="pf-beat-dot" />
                {b}
              </div>
            ))}
          </div>
        ) : published ? (
          <>
            <div className="pf-done-k">Published</div>
            <div className="pf-done-name">{published.name}</div>
            <div className="pf-summary">
              Running on the desk&apos;s own capital, with its NAV attested each strike.
            </div>
            <div className="pf-apy">
              <b>{(draft.modeledApy * 100).toFixed(1)}%</b>
              <i>modeled net APY</i>
            </div>
            <div className="pf-done-acts">
              <Link className="pf-publish" href={`/vault/${HERO_SLUG}`}>
                Open your vault
              </Link>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
