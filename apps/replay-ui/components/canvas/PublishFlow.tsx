"use client";

/**
 * PublishFlow: the Review and Publish flow for the canvas.
 *
 * Wired to the running loop server. On Publish vault we:
 *   1. read the connected wallet (mandatory: no wallet, no publish),
 *   2. persist the modeled envelope locally (unchanged: the existing vault
 *      page reads this for the modeled register),
 *   3. POST the composer's inputs to /api/loops -> loop server deploys a
 *      fresh PriimeVault + workflow,
 *   4. redirect to /vault/live/<loop-id> so the user sees the attested
 *      ledger of their own handler.
 *
 * The publishing animation covers whatever the network takes; on error we
 * drop back to review with a message. No fake success on a failed deploy.
 */

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { ConnectButton } from "@/components/nav/ConnectButton";

import { LoopValidationError, publishLoopToServer } from "@/lib/vaults/publish-loop";
import {
  deriveAutomations,
  publishEnvelope,
  type PublishInput,
  type PublishedEnvelope,
} from "@/lib/vaults/store";

export interface PublishDraft extends Omit<PublishInput, "name"> {
  defaultName: string;
  /** Composer's liquidity-source candidate id, forwarded to loop-server. */
  candidateId: string;
  /** Composer's safety-buffer target-leverage value, forwarded to loop-server. */
  targetLeverage: number;
}

const BEATS = ["Compose", "Verify", "Publish"] as const;

type TimerHandle = ReturnType<typeof setTimeout>;

type Phase =
  | { kind: "review" }
  | { kind: "publishing"; beat: number }
  | { kind: "error"; message: string; issues?: string[] }
  | { kind: "done"; envelope: PublishedEnvelope; loopId: string; handler: string };

export default function PublishFlow({ draft, onClose }: { draft: PublishDraft; onClose: () => void }) {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const [name, setName] = useState(draft.defaultName);
  const [phase, setPhase] = useState<Phase>({ kind: "review" });
  const timers = useRef<TimerHandle[]>([]);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  useEffect(() => {
    nameRef.current?.select();
  }, []);

  const closeCbRef = useRef(onClose);
  closeCbRef.current = onClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (phase.kind === "publishing") return;
      closeCbRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase.kind]);

  const runBeats = (): void => {
    setPhase({ kind: "publishing", beat: 0 });
    timers.current.push(setTimeout(() => setPhase({ kind: "publishing", beat: 1 }), 620));
    timers.current.push(setTimeout(() => setPhase({ kind: "publishing", beat: 2 }), 1240));
  };

  const publish = (): void => {
    if (phase.kind !== "review") return;
    if (!isConnected || address === undefined) {
      setPhase({ kind: "error", message: "Connect a wallet before publishing; the strategist is the connected address." });
      return;
    }
    const finalName = name.trim() || draft.defaultName;
    runBeats();
    void (async () => {
      try {
        const { loopId, handler } = await publishLoopToServer({
          name: finalName,
          strategist: address,
          candidateId: draft.candidateId,
          targetLeverage: draft.targetLeverage,
        });
        const envelope = publishEnvelope({
          ...draft,
          name: finalName,
          automations: deriveAutomations(draft),
        });
        setPhase({ kind: "done", envelope, loopId, handler });
      } catch (err) {
        if (err instanceof LoopValidationError) {
          setPhase({ kind: "error", message: "Deploy rejected by the server.", issues: err.issues });
        } else {
          setPhase({ kind: "error", message: err instanceof Error ? err.message : String(err) });
        }
      }
    })();
  };

  const openVault = (): void => {
    if (phase.kind !== "done") return;
    closeCbRef.current();
    router.push(`/vault/live/${phase.loopId}`);
  };

  return (
    <div
      className="bcrev-backdrop"
      onClick={phase.kind === "publishing" ? undefined : onClose}
    >
      <div
        className={`pf${phase.kind === "done" ? " pf--done" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        {phase.kind === "review" || phase.kind === "error" ? (
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
            {!isConnected ? (
              <div className="pf-connect">
                <p className="pf-hint">
                  Connect a wallet first. The connected address becomes the strategist and holds the loop&apos;s exit key.
                </p>
                <ConnectButton />
              </div>
            ) : null}
            {phase.kind === "error" ? (
              <div className="pf-err">
                <p>{phase.message}</p>
                {phase.issues !== undefined ? (
                  <ul>
                    {phase.issues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            <button
              type="button"
              className="pf-publish"
              onClick={publish}
              disabled={!isConnected}
            >
              Publish vault
            </button>
          </>
        ) : phase.kind === "publishing" ? (
          <div className="pf-beats">
            {BEATS.map((b, i) => (
              <div
                key={b}
                className={`pf-beat${i < phase.beat ? " done" : i === phase.beat ? " now" : ""}`}
              >
                <span className="pf-beat-dot" />
                {b}
              </div>
            ))}
          </div>
        ) : (
          <>
            <div className="pf-done-k">Published</div>
            <div className="pf-done-name">{phase.envelope.name}</div>
            <div className="pf-summary">
              Deployed to <b className="vn">{phase.handler}</b>. First strike lands within a cadence.
            </div>
            <div className="pf-apy">
              <b>{(draft.modeledApy * 100).toFixed(1)}%</b>
              <i>modeled net APY</i>
            </div>
            <div className="pf-done-acts">
              <button type="button" className="pf-publish" onClick={openVault}>
                Open your vault
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
