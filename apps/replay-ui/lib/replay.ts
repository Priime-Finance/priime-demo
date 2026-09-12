/**
 * The replay engine: a frozen v1 journal plus a clock reading, in; a fully
 * derived, renderable `ReplayState`, out.
 *
 * Pure by construction — no module state, no `Date.now()`. The caller owns
 * the clock and passes `t` (ms since playback start), which is what makes
 * scrubbing backward, pausing, and re-rendering a *growing* (pending)
 * journal all fall out for free: same journal + same `t` always yields the
 * same state.
 *
 * Real strikes have 1-9 s gaps between events. Those are remapped onto a
 * demo-paced schedule (`REPLAY_PACING`) that keeps relative order exactly
 * but guarantees a minimum on-screen dwell per event; the two demo captures
 * land at ~17.2 s (settled) and ~15.0 s (sabotage) of playback.
 */
import type {
  Attestation,
  Journal,
  NavUnit,
  Operator,
  Status,
  Transition,
  Trigger,
  Vault,
} from "@priime-demo/journal-schema";

/* ------------------------------------------------------------------ pacing */

/** Knobs that map real strike timestamps onto demo playback time. */
interface ReplayPacing {
  /** Dead air before the trigger fires, so the idle frame is legible. */
  leadInMs: number;
  /** Floor on the gap between consecutive events (simultaneous ones included). */
  minGapMs: number;
  /** Ceiling on the gap, so a 9 s real pause does not stall the demo. */
  maxGapMs: number;
  /** Scale factor: playback ms per real second, before clamping. */
  msPerRealSecond: number;
  /** Hold after the last event before `done` flips true. */
  tailHoldMs: number;
}

/**
 * The single place playback pacing is tuned.
 *
 * Chosen against the two captures to land total playback in the 15-25 s
 * target: settled = 8 events -> 17.2 s, sabotage = 7 events -> 15.0 s.
 */
export const REPLAY_PACING: ReplayPacing = {
  leadInMs: 1_500,
  minGapMs: 1_200,
  maxGapMs: 3_000,
  msPerRealSecond: 1_100,
  tailHoldMs: 3_500,
};

/* ------------------------------------------------------------------ events */

/** Discriminator for `ReplayEvent`. */
export type ReplayEventKind =
  | "trigger"
  | "submission"
  | "transition"
  | "attestation";

/** Fields every timeline event carries. */
interface ReplayEventCommon {
  /** Playback offset (ms since playback start) at which this event fires. */
  atMs: number;
  /** The journal's own unix-seconds timestamp this event was derived from. */
  sourceTimestamp: number;
}

/** The strike firing (cron/block/event/manual). Always the first event. */
interface TriggerReplayEvent extends ReplayEventCommon {
  kind: "trigger";
  /** The journal's trigger record. */
  trigger: Trigger;
}

/** One operator's NAV submission landing. */
interface SubmissionReplayEvent extends ReplayEventCommon {
  kind: "submission";
  /** The submitting operator, verbatim from the journal. */
  operator: Operator;
  /** 0-based order of appearance among submissions. */
  order: number;
}

/** One quorum-weight transition over the winning result hash. */
interface TransitionReplayEvent extends ReplayEventCommon {
  kind: "transition";
  /** The transition record, verbatim from the journal. */
  transition: Transition;
  /** Index into `journal.quorum.transitions`. */
  order: number;
}

/** The on-chain attestation landing. Only emitted once `tx_hash` exists. */
interface AttestationReplayEvent extends ReplayEventCommon {
  kind: "attestation";
  /** The attestation record, verbatim from the journal. */
  attestation: Attestation;
}

/** Anything that can happen during playback. */
type ReplayEvent =
  | TriggerReplayEvent
  | SubmissionReplayEvent
  | TransitionReplayEvent
  | AttestationReplayEvent;

/** A journal compiled into a demo-paced schedule. Pure function of its inputs. */
interface ReplayTimeline {
  /** Events in fire order, `atMs` strictly increasing. */
  events: readonly ReplayEvent[];
  /** Playback length including `tailHoldMs`; `done` flips at this `t`. */
  durationMs: number;
  /** Pacing used to build it. */
  pacing: ReplayPacing;
}

/* ------------------------------------------------------------------- state */

/**
 * Overall strike phase. Monotonically non-decreasing as `t` grows.
 *
 * The last three are terminal and mirror `Journal.status`: `complete` for
 * `settled`, plus `stalled`/`rejected`. A `pending` journal never reaches a
 * terminal phase — playback just runs out of events (`done`) while the strike
 * stays `collecting`/`quorum-reached`, which is exactly the live-poll case.
 */
type ReplayPhase =
  | "idle"
  | "triggered"
  | "collecting"
  | "quorum-reached"
  | "attested"
  | "complete"
  | "stalled"
  | "rejected";

/**
 * Sort rank per phase; higher = later. `complete`/`stalled`/`rejected` are
 * the three mutually exclusive terminal phases and share a rank. Exported so
 * renderers (and tests) can assert progression without hardcoding order.
 */
export const REPLAY_PHASE_RANK: Readonly<Record<ReplayPhase, number>> = {
  idle: 0,
  triggered: 1,
  collecting: 2,
  "quorum-reached": 3,
  attested: 4,
  complete: 5,
  stalled: 5,
  rejected: 5,
};

/** An operator that has appeared on screen, with its verdict. */
interface ReplayOperatorState {
  /** Operator signing address. */
  id: string;
  /** keccak256 of the result payload. */
  result_hash: string;
  /** NAV as an integer string in `nav_unit` base units. */
  nav: string;
  /** secp256k1 signature over the Priime envelope. */
  signature: string;
  /** Unix seconds the submission was observed. */
  timestamp: number;
  /** Journal's own verdict: part of the quorum-winning set. */
  accepted: boolean;
  /**
   * `result_hash === quorum.winning_result_hash`. `null` while no winning
   * hash exists yet (pending/stalled strike) — render as "undetermined",
   * not as a mismatch.
   */
  matchesWinningHash: boolean | null;
  /** Playback offset at which this operator appeared. */
  appearedAtMs: number;
  /** Optional abi-encoded result bytes, for independent recomputation. */
  result_payload?: string;
}

/** Quorum fill progress at `t`. */
interface ReplayQuorumState {
  /** Weight required to settle. */
  threshold: number;
  /** Total registered operator weight. */
  total: number;
  /** Weight accumulated over the winning hash so far. */
  cumulative: number;
  /** True once a transition with `reached` has fired. */
  reached: boolean;
  /** The hash quorum formed over; null until/unless reached. */
  winningResultHash: string | null;
  /** The transition that fired most recently, for the "just filled" flourish. */
  lastTransition: Transition | null;
  /** Playback offset of `lastTransition`; null when none has fired. */
  lastTransitionAtMs: number | null;
  /** How many transitions have fired out of `journal.quorum.transitions`. */
  transitionsFired: number;
}

/** Attestation state: not on chain yet, or landed with its receipt. */
type ReplayAttestationState =
  | {
      /** Nothing on chain yet. */
      status: "not-landed";
      /** Chain the attestation will land on (deep-link target). */
      chainId: number;
    }
  | {
      /** Receipt is in. */
      status: "landed";
      /** Chain the attestation landed on. */
      chainId: number;
      /** Attestation tx hash. */
      txHash: string;
      /** Block it landed in, when known. */
      blockNumber: number | null;
      /** Settled NAV in `nav_unit` base units. */
      navFinal: string | null;
      /** Unix seconds the attestation landed. */
      timestamp: number | null;
    };

/**
 * Everything a renderer needs at time `t`. Fully derived: a component reading
 * this never needs the raw journal, a clock, or any branching on scene.
 */
export interface ReplayState {
  /** `Journal.strike_id`. */
  strikeId: string;
  /** Journal lifecycle status (not the playback phase). */
  status: Status;
  /** Playback phase at `t`. */
  phase: ReplayPhase;
  /** The `t` this state was derived at, clamped to `[0, durationMs]`. */
  tMs: number;
  /** Total playback length. */
  durationMs: number;
  /** `tMs / durationMs`, clamped to `[0, 1]`. */
  progress: number;
  /** True once the trigger event has fired. */
  triggered: boolean;
  /** The journal's trigger record (shown from `triggered` onward). */
  trigger: Trigger;
  /** Determinism anchor: block the NAV was computed against. */
  inputsBlock: number;
  /** Denomination and base-unit decimals for every `nav` string. */
  navUnit: NavUnit;
  /** sha256 digest of the NAV component every operator ran. */
  componentDigest: string;
  /** The vault whose NAV is being attested. */
  vault: Vault;
  /** Operators that have appeared, in appearance order. */
  operators: readonly ReplayOperatorState[];
  /** Operators in the journal that have not appeared yet. */
  awaitingOperatorCount: number;
  /** Quorum fill progress. */
  quorum: ReplayQuorumState;
  /** Attestation state. */
  attestation: ReplayAttestationState;
  /** How many timeline events have fired. */
  eventsFired: number;
  /** The most recent event to fire; null before the trigger. */
  lastEvent: ReplayEvent | null;
  /** True once `tMs >= durationMs`: playback is over. */
  done: boolean;
}

/* --------------------------------------------------------------- internals */

/**
 * A timeline event before its playback offset is assigned. Distributes over
 * the union (a plain `Omit<ReplayEvent, "atMs">` would collapse to the keys
 * every member shares).
 */
type UnpacedEvent = ReplayEvent extends infer E
  ? E extends ReplayEvent
    ? Omit<E, "atMs">
    : never
  : never;

/** Fire-order rank for events sharing a source timestamp. */
const KIND_RANK: Readonly<Record<ReplayEventKind, number>> = {
  trigger: 0,
  submission: 1,
  transition: 2,
  attestation: 3,
};

/** Clamp `value` into `[min, max]`. */
function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Earliest unix timestamp anywhere in the journal; 0 when the journal is empty. */
function earliestTimestamp(journal: Journal): number {
  const stamps: number[] = [
    ...journal.operators.map((o) => o.timestamp),
    ...journal.quorum.transitions.map((tr) => tr.timestamp),
  ];
  if (journal.attestation.timestamp !== null) {
    stamps.push(journal.attestation.timestamp);
  }
  return stamps.length === 0 ? 0 : Math.min(...stamps);
}

/* ---------------------------------------------------------------- timeline */

/**
 * Compile a journal into a demo-paced timeline.
 *
 * Ordering is taken from the journal's own timestamps (trigger first, then
 * submissions, then quorum transitions, then the attestation; ties broken so
 * an operator's submission always precedes the transition it caused).
 * Incomplete journals just produce a shorter timeline — a pending strike with
 * no attestation simply ends after its last submission.
 *
 * @param journal the strike to compile.
 * @param pacing pacing overrides; defaults to `REPLAY_PACING`.
 * @returns the compiled timeline. Pure: same inputs, same output.
 */
export function buildTimeline(
  journal: Journal,
  pacing: ReplayPacing = REPLAY_PACING,
): ReplayTimeline {
  const triggerAt = earliestTimestamp(journal);

  const unpaced: { event: UnpacedEvent; rank: number; seq: number }[] = [];
  let seq = 0;

  unpaced.push({
    event: { kind: "trigger", sourceTimestamp: triggerAt, trigger: journal.trigger },
    rank: KIND_RANK.trigger,
    seq: seq++,
  });

  const submissions = journal.operators
    .map((operator, index) => ({ operator, index }))
    .sort((a, b) =>
      a.operator.timestamp !== b.operator.timestamp
        ? a.operator.timestamp - b.operator.timestamp
        : a.index - b.index,
    );

  submissions.forEach(({ operator }, order) => {
    unpaced.push({
      event: {
        kind: "submission",
        sourceTimestamp: operator.timestamp,
        operator,
        order,
      },
      rank: KIND_RANK.submission,
      seq: seq++,
    });
  });

  journal.quorum.transitions.forEach((transition, order) => {
    unpaced.push({
      event: {
        kind: "transition",
        sourceTimestamp: transition.timestamp,
        transition,
        order,
      },
      rank: KIND_RANK.transition,
      seq: seq++,
    });
  });

  const { attestation } = journal;
  if (attestation.tx_hash !== null) {
    unpaced.push({
      event: {
        kind: "attestation",
        sourceTimestamp: attestation.timestamp ?? triggerAt,
        attestation,
      },
      rank: KIND_RANK.attestation,
      seq: seq++,
    });
  }

  unpaced.sort((a, b) => {
    if (a.event.sourceTimestamp !== b.event.sourceTimestamp) {
      return a.event.sourceTimestamp - b.event.sourceTimestamp;
    }
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.seq - b.seq;
  });

  const events: ReplayEvent[] = [];
  let cursor = pacing.leadInMs;
  let previousSource: number | null = null;

  for (const { event } of unpaced) {
    if (previousSource !== null) {
      const realGapSeconds = Math.max(0, event.sourceTimestamp - previousSource);
      cursor += clamp(
        Math.round(realGapSeconds * pacing.msPerRealSecond),
        pacing.minGapMs,
        pacing.maxGapMs,
      );
    }
    previousSource = event.sourceTimestamp;
    // The spread distributes over the union and keeps the discriminant, so no
    // assertion is needed to re-attach it.
    events.push({ ...event, atMs: cursor });
  }

  const lastAt = events.length === 0 ? 0 : events[events.length - 1]!.atMs;
  return { events, durationMs: lastAt + pacing.tailHoldMs, pacing };
}

/**
 * Total playback length for a journal, in ms.
 *
 * @param journal the strike.
 * @param pacing pacing overrides; defaults to `REPLAY_PACING`.
 * @returns duration in ms, including the tail hold.
 */
export function replayDurationMs(
  journal: Journal,
  pacing: ReplayPacing = REPLAY_PACING,
): number {
  return buildTimeline(journal, pacing).durationMs;
}

/* ------------------------------------------------------------- derivation */

/**
 * Terminal phase for a *finished* strike, or `null` for one that is still
 * open. A `pending` journal whose timeline has run out is not "complete" —
 * it is a live strike we have simply caught up with, so it keeps its derived
 * phase and only `done` flips.
 */
function terminalPhase(status: Status): ReplayPhase | null {
  if (status === "settled") return "complete";
  if (status === "stalled") return "stalled";
  if (status === "rejected") return "rejected";
  return null;
}

/**
 * Derive the full renderable state of a strike at playback time `t`.
 *
 * The core engine entry point. Pure: no clock, no memo, no module state, so
 * scrubbing backwards is identical to arriving forwards, and a journal that
 * grows between polls simply produces a longer timeline on the next call.
 *
 * @param journal the strike (may be incomplete: `pending`, null attestation).
 * @param t milliseconds since playback start; negative values clamp to 0,
 *   values past the end clamp to `durationMs` and set `done`.
 * @param timeline precompiled timeline, to avoid recompiling every frame.
 *   Must have been built from the same `journal`.
 * @returns everything a renderer needs at `t`.
 */
export function deriveReplayState(
  journal: Journal,
  t: number,
  timeline: ReplayTimeline = buildTimeline(journal),
): ReplayState {
  const { durationMs } = timeline;
  const tMs = clamp(Number.isFinite(t) ? t : durationMs, 0, durationMs);
  const done = tMs >= durationMs;

  const fired = timeline.events.filter((event) => event.atMs <= tMs);
  const lastEvent = fired.length === 0 ? null : fired[fired.length - 1]!;

  const triggered = fired.some((event) => event.kind === "trigger");

  const winningResultHash = journal.quorum.winning_result_hash;
  const operators: ReplayOperatorState[] = fired
    .filter((event): event is SubmissionReplayEvent => event.kind === "submission")
    .map(({ operator, atMs }) => ({
      id: operator.id,
      result_hash: operator.result_hash,
      nav: operator.nav,
      signature: operator.signature,
      timestamp: operator.timestamp,
      accepted: operator.accepted,
      matchesWinningHash:
        winningResultHash === null ? null : operator.result_hash === winningResultHash,
      appearedAtMs: atMs,
      ...(operator.result_payload === undefined
        ? {}
        : { result_payload: operator.result_payload }),
    }));

  const firedTransitions = fired.filter(
    (event): event is TransitionReplayEvent => event.kind === "transition",
  );
  const lastTransitionEvent =
    firedTransitions.length === 0 ? null : firedTransitions[firedTransitions.length - 1]!;

  const quorum: ReplayQuorumState = {
    threshold: journal.quorum.threshold,
    total: journal.quorum.total,
    cumulative: lastTransitionEvent?.transition.cumulative ?? 0,
    reached: firedTransitions.some((event) => event.transition.reached),
    winningResultHash,
    lastTransition: lastTransitionEvent?.transition ?? null,
    lastTransitionAtMs: lastTransitionEvent?.atMs ?? null,
    transitionsFired: firedTransitions.length,
  };

  const attestationEvent = fired.find(
    (event): event is AttestationReplayEvent => event.kind === "attestation",
  );
  const attested = attestationEvent?.attestation ?? null;
  const txHash = attested?.tx_hash ?? null;

  const attestation: ReplayAttestationState =
    attested === null || txHash === null
      ? { status: "not-landed", chainId: journal.attestation.chain_id }
      : {
          status: "landed",
          chainId: attested.chain_id,
          txHash,
          blockNumber: attested.block_number,
          navFinal: attested.nav_final,
          timestamp: attested.timestamp,
        };

  const finished = done ? terminalPhase(journal.status) : null;

  let phase: ReplayPhase;
  if (!triggered) phase = "idle";
  else if (finished !== null) phase = finished;
  else if (attestation.status === "landed") phase = "attested";
  else if (quorum.reached) phase = "quorum-reached";
  else if (operators.length > 0) phase = "collecting";
  else phase = "triggered";

  return {
    strikeId: journal.strike_id,
    status: journal.status,
    phase,
    tMs,
    durationMs,
    progress: durationMs === 0 ? 1 : clamp(tMs / durationMs, 0, 1),
    triggered,
    trigger: journal.trigger,
    inputsBlock: journal.inputs_block,
    navUnit: journal.nav_unit,
    componentDigest: journal.component_digest,
    vault: journal.vault,
    operators,
    awaitingOperatorCount: Math.max(0, journal.operators.length - operators.length),
    quorum,
    attestation,
    eventsFired: fired.length,
    lastEvent,
    done,
  };
}
