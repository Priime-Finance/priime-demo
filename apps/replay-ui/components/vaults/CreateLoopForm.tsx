"use client";

/**
 * Compact create-loop form. Lives at the top of the Live loops section on
 * `/vault`. Only asks for the two fields that vary per deployment: name and
 * strategist (the user who owns the exit). Market plumbing is fixed to the
 * pinned Base fork's Morpho USDe/USDC market, shown read-only.
 *
 * On success the parent re-fetches the loops list so the new card shows up.
 */

import { useId, useState } from "react";

import { createLoop, LoopValidationError, type CreateLoopInput } from "@/lib/vaults/live-source";
import { DEFAULT_CRON_SECONDS, DEFAULT_STRATEGIST, DEMO_MARKET } from "@/lib/vaults/loop-defaults";

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "issues"; issues: string[] }
  | { kind: "error"; message: string }
  | { kind: "success"; id: string; handler: string };

interface CreateLoopFormProps {
  onCreated: (loopId: string) => void;
}

export function CreateLoopForm({ onCreated }: CreateLoopFormProps) {
  const nameId = useId();
  const stratId = useId();
  const cronId = useId();
  const [name, setName] = useState("");
  const [strategist, setStrategist] = useState(DEFAULT_STRATEGIST);
  const [cronSeconds, setCronSeconds] = useState<number>(DEFAULT_CRON_SECONDS);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const doSubmit = async (): Promise<void> => {
    if (status.kind === "submitting") return;
    setStatus({ kind: "submitting" });
    const input: CreateLoopInput = {
      name: name.trim() === "" ? "unnamed loop" : name.trim(),
      strategist: strategist.trim(),
      cronSeconds,
      marketId: DEMO_MARKET.marketId,
      lltv: DEMO_MARKET.lltv,
      usdeAddress: DEMO_MARKET.usdeAddress,
      oracleAddress: DEMO_MARKET.oracleAddress,
      irmAddress: DEMO_MARKET.irmAddress,
      morphoAddress: DEMO_MARKET.morphoAddress,
      poolAddress: DEMO_MARKET.poolAddress,
      twapWindowSecs: DEMO_MARKET.twapWindowSecs,
      inputsBlockLag: DEMO_MARKET.inputsBlockLag,
    };
    try {
      const { loop } = await createLoop(input);
      setStatus({ kind: "success", id: loop.id, handler: loop.handlerAddress ?? "" });
      setName("");
      onCreated(loop.id);
    } catch (err) {
      if (err instanceof LoopValidationError) {
        setStatus({ kind: "issues", issues: err.issues });
      } else {
        setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      }
    }
  };

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    void doSubmit();
  };

  const busy = status.kind === "submitting";
  return (
    <form className="lv-form" onSubmit={submit}>
      <div className="lv-form-row">
        <label htmlFor={nameId}>Name</label>
        <input
          id={nameId}
          type="text"
          placeholder="my recursive loop"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          maxLength={64}
        />
      </div>
      <div className="lv-form-row">
        <label htmlFor={stratId}>Strategist</label>
        <input
          id={stratId}
          type="text"
          spellCheck={false}
          value={strategist}
          onChange={(e) => setStrategist(e.target.value)}
          disabled={busy}
          className="vn"
        />
      </div>
      <div className="lv-form-row lv-form-row--tight">
        <label htmlFor={cronId}>Strike cadence (seconds)</label>
        <input
          id={cronId}
          type="number"
          min={5}
          max={3600}
          value={cronSeconds}
          onChange={(e) => setCronSeconds(Number.parseInt(e.target.value, 10) || DEFAULT_CRON_SECONDS)}
          disabled={busy}
          className="vn"
        />
      </div>
      <div className="lv-form-fixed vn">
        <div>
          <span>Market</span>
          <b>{DEMO_MARKET.marketLabel}</b>
        </div>
        <div>
          <span>TWAP window</span>
          <b>{`${String(DEMO_MARKET.twapWindowSecs)}s`}</b>
        </div>
        <div>
          <span>Inputs block lag</span>
          <b>{String(DEMO_MARKET.inputsBlockLag)}</b>
        </div>
      </div>
      <div className="lv-form-foot">
        <button type="submit" disabled={busy} className="lv-form-btn">
          {busy ? "Deploying..." : "Deploy loop"}
        </button>
        <StatusLine status={status} />
      </div>
    </form>
  );
}

function StatusLine({ status }: { status: Status }) {
  if (status.kind === "idle" || status.kind === "submitting") return null;
  if (status.kind === "issues") {
    return (
      <ul className="lv-form-issues">
        {status.issues.map((issue) => (
          <li key={issue}>{issue}</li>
        ))}
      </ul>
    );
  }
  if (status.kind === "error") {
    return <p className="lv-form-err">Deploy failed: {status.message}</p>;
  }
  return (
    <p className="lv-form-ok">
      Deployed loop <b>{status.id}</b> at handler <b>{status.handler}</b>. The first strike lands
      within a strike cadence.
    </p>
  );
}
