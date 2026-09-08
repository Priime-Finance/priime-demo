/**
 * The verification board's pure inputs: where a press starts playback, and
 * the record adapter that feeds the inner lane.
 *
 * Both are derived at call time from the captured journals through
 * `lib/replay.ts` and `lib/vaults/pipeline.ts`, never typed
 * (docs/plans/LATEST_UI_PORT_SPEC.md WP4.12 (b) and (f), F.5). Kept out of
 * the component so the numbers the stopwatch checks on stage are the numbers
 * a unit test can read.
 */

import { lev, pct } from "@/lib/canvas/format";
import { buildTimeline, deriveReplayState } from "@/lib/replay";
import { captureJournal, type Capture } from "@/lib/vaults/pipeline";
import { fmtHf, type VaultRecord } from "@/lib/vaults/store";

/**
 * How long before its event a press lands, so the reaction reads as the
 * press's own: the key clunks at t=0 and the operator goes sick (or green)
 * one beat later, in one frame.
 */
export const PRESS_LEAD_MS = 160;

/**
 * The operator the sabotage capture records as the liar, from the capture
 * itself: only that node's switch is live, because only that journal exists
 * to replay. Null when the capture carries no rejected submission.
 */
export function saboteurOperatorId(): string | null {
  const sabotage = captureJournal("corrupted");
  const timeline = buildTimeline(sabotage);
  const settled = deriveReplayState(sabotage, timeline.durationMs, timeline);
  return settled.operators.find((o) => o.matchesWinningHash === false)?.id ?? null;
}

/**
 * Where playback starts for a press on the capture it opens.
 *
 * - `corrupted`: the first `accepted:false` submission's `atMs` minus the
 *   press lead, so the rejection lands at +160 ms and every later event
 *   (the quorum forming without it, the attestation) keeps its own spacing.
 * - `honest` (the restore press): the settled capture's submission by the
 *   operator the sabotage capture rejected, minus the press lead, so that
 *   operator goes green at +160 ms and the 3-of-3 and the attestation follow.
 *
 * `Replay the strike` does not use this: it runs the full timeline from 0.
 */
export function pressStartMs(capture: Capture): number {
  const journal = captureJournal(capture);
  const timeline = buildTimeline(journal);
  const saboteur = saboteurOperatorId();
  const event = timeline.events.find((e) => {
    if (e.kind !== "submission") return false;
    if (capture === "corrupted") return !e.operator.accepted;
    return (
      e.operator.accepted && saboteur !== null && e.operator.id.toLowerCase() === saboteur.toLowerCase()
    );
  });
  return Math.max(0, (event?.atMs ?? 0) - PRESS_LEAD_MS);
}

/** One plate of the inner lane. A null value prints nothing: no typed fallback. */
export interface InnerLanePlate {
  /** `S1` … `S4`. */
  n: string;
  label: string;
  /** The screen's status line. */
  status: string;
  /** The screen's big value, or null when the record carries none. */
  value: string | null;
  /** One optional fact row under the value. */
  row: { label: string; value: string } | null;
  /** `● Armed` style chip, green when true. */
  armed: boolean;
}

/** The inner lane, read off the live record. */
export interface InnerLaneModel {
  name: string;
  market: string | null;
  venue: string | null;
  modeledApy: number | null;
  plates: InnerLanePlate[];
}

/**
 * The record adapter for `InnerLane` (WP4.12 (f)): S1 the market pair, S2
 * `Dynamic leverage` at the applied leverage, S3 `Auto-compound` at its
 * cadence, S4 the vault at its modeled APY. Every value is the record's own
 * or null; nothing here types a figure.
 */
export function innerLaneModel(v: VaultRecord): InnerLaneModel {
  const a = v.automations;
  const leverage =
    typeof v.appliedLeverage === "number" && Number.isFinite(v.appliedLeverage)
      ? v.appliedLeverage
      : (a?.leverage?.targetLeverage ?? null);
  const floor = a?.leverage?.emergencyHf ?? null;
  const cadence = a?.compound?.cadenceHours ?? null;
  const apy = typeof v.modeledApy === "number" && Number.isFinite(v.modeledApy) ? v.modeledApy : null;
  const market = v.market.trim().length > 0 ? v.market : null;
  const venue = v.venue.trim().length > 0 ? v.venue : null;
  return {
    name: v.name,
    market,
    venue,
    modeledApy: apy,
    plates: [
      {
        n: "S1",
        label: "Liquidity source",
        status: venue === null ? "Market" : `Market · ${venue.split("·")[0]?.trim() ?? venue}`,
        value: market,
        row: venue === null ? null : { label: "Venue", value: venue },
        armed: false,
      },
      {
        n: "S2",
        label: "Dynamic leverage",
        status: "Protection envelope",
        value: leverage === null ? null : lev(leverage),
        row: floor === null ? null : { label: "HF floor", value: fmtHf(floor) },
        armed: leverage !== null,
      },
      {
        n: "S3",
        label: "Auto-compound",
        status: "Compounding",
        value: cadence === null ? null : `${String(cadence)}h`,
        row: null,
        armed: cadence !== null,
      },
      {
        n: "S4",
        label: "Vault",
        status: "Net APY",
        value: apy === null ? null : pct(apy),
        row: null,
        armed: false,
      },
    ],
  };
}
