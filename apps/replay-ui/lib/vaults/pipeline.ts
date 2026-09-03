/**
 * The operator pipeline, as the vault page draws it.
 *
 * In: one captured NAV-strike journal plus one derived frame from the replay
 * engine (`lib/replay.ts`). Out: preformatted node cards, quorum fill and
 * attestation landing. Pure — no clock, no React, no DOM — so the whole
 * choreography is unit-testable without mounting anything, and the panel that
 * renders it owns nothing but timers.
 *
 * Both captures are read through `lib/source.ts`, never from `lib/journal.ts`
 * directly. The corrupted run is a *capture*, not a client-side mutation of the
 * honest one: `captureJournal("corrupted")` returns the recorded sabotage
 * strike verbatim.
 */

import type { Journal } from "@priime-demo/journal-schema";

import { formatUtcTime, truncateAddress, truncateHash } from "@/lib/format";
import type { ReplayState } from "@/lib/replay";
import { DEMO_JOURNALS, STRIKE_IDS } from "@/lib/source";

import { baseUnitsToNumber, formatAttestedNav } from "./attested";

/* ─────────────────────────────────────────────────────────────── captures ── */

/**
 * Which of the two captures the panel is replaying.
 *
 * Session-local display state. It selects a recording; it never edits one.
 */
export type Capture = "honest" | "corrupted";

/** The strike id each capture plays. */
export const CAPTURE_STRIKE_ID: Readonly<Record<Capture, string>> = {
  honest: STRIKE_IDS.settled,
  corrupted: STRIKE_IDS.sabotage,
};

/**
 * The journal behind a capture.
 *
 * @throws when the demo source does not carry that strike, which would mean
 *   the captures and the ids have drifted apart.
 */
export function captureJournal(capture: Capture): Journal {
  const wanted = CAPTURE_STRIKE_ID[capture];
  const entry = DEMO_JOURNALS.find((e) => e.journal.strike_id === wanted);
  if (entry === undefined) throw new Error(`No captured journal for ${capture}`);
  return entry.journal;
}

/* ────────────────────────────────────────────────────────────────── nodes ── */

/**
 * Where one operator is in the strike.
 *
 * `computing` is the beat between the trigger firing and that node's
 * submission landing; `reported` is a submission with no winning hash to
 * compare against yet (a strike still open), which renders as undetermined and
 * never as a mismatch.
 */
type NodeStep = "awaiting" | "computing" | "reported" | "accepted" | "rejected";

/** Status copy per step. Sentence case, no em dashes. */
const STEP_LABEL: Readonly<Record<NodeStep, string>> = {
  awaiting: "Idle",
  computing: "Computing",
  reported: "Reported",
  accepted: "Accepted",
  rejected: "Rejected",
};

/** One operator node card, every value preformatted. */
export interface NodeView {
  /** Operator signing address, verbatim from the journal. */
  id: string;
  /** `Operator 1` … `Operator 3`, by journal order. */
  label: string;
  /** `0x1111…1111`. */
  shortId: string;
  /** Lifecycle step at this frame. */
  step: NodeStep;
  /** Status word for the step pill. */
  stepLabel: string;
  /** True once this node's submission has landed on screen. */
  reported: boolean;
  /** `0xa1a1a1…a1a1`, or null before the submission lands. */
  hashShort: string | null;
  /** Full result hash, for the title attribute; null before the submission. */
  hash: string | null;
  /** `500.000000 USDC`, or null before the submission lands. */
  navText: string | null;
  /** True once a signature over the envelope is on screen. */
  signaturePresent: boolean;
  /** `0xefefefef…efef`, or null before the submission lands. */
  signatureShort: string | null;
  /** Why this submission was rejected, or null when it was not. */
  reason: string | null;
}

/** Build one node card from the journal's operator and the frame's verdict. */
function nodeView(
  journal: Journal,
  index: number,
  state: ReplayState,
): NodeView {
  const operator = journal.operators[index];
  if (operator === undefined) throw new Error(`No operator at index ${String(index)}`);
  const label = `Operator ${String(index + 1)}`;
  const shortId = truncateAddress(operator.id);
  const live =
    state.operators.find((o) => o.id.toLowerCase() === operator.id.toLowerCase()) ?? null;

  if (live === null) {
    return {
      id: operator.id,
      label,
      shortId,
      step: state.triggered ? "computing" : "awaiting",
      stepLabel: STEP_LABEL[state.triggered ? "computing" : "awaiting"],
      reported: false,
      hashShort: null,
      hash: null,
      navText: null,
      signaturePresent: false,
      signatureShort: null,
      reason: null,
    };
  }

  const step: NodeStep =
    live.matchesWinningHash === null ? "reported" : live.accepted ? "accepted" : "rejected";

  return {
    id: operator.id,
    label,
    shortId,
    step,
    stepLabel: STEP_LABEL[step],
    reported: true,
    hashShort: truncateHash(live.result_hash, 10, 6),
    hash: live.result_hash,
    navText: `${formatAttestedNav(
      baseUnitsToNumber(live.nav, state.navUnit.decimals),
      state.navUnit.decimals,
    )} ${state.navUnit.asset}`,
    signaturePresent: live.signature.length > 0,
    signatureShort: truncateHash(live.signature, 10, 6),
    reason: step === "rejected" ? "Result hash mismatch, outside the quorum" : null,
  };
}

/* ───────────────────────────────────────────────────────────────── quorum ── */

/** Submissions that landed on a hash the quorum did not form over. */
interface OutsideBucket {
  /** `0xdededede…dede`. */
  hashShort: string;
  /** Full hash, for the title attribute. */
  hash: string;
  /** How many submissions landed here. */
  count: number;
  /** `500.000000 USDC` — the number this bucket reported. */
  navText: string;
}

/** Quorum fill at this frame. */
interface QuorumView {
  /** Weight required to settle. */
  threshold: number;
  /** Total registered operator weight. */
  total: number;
  /** Weight accumulated over the winning hash so far. */
  cumulative: number;
  /** True once a transition carried the threshold. */
  reached: boolean;
  /** `2 of 3` — the configured requirement. */
  thresholdLabel: string;
  /** `2 of 3` — weight in the bucket over total registered weight. */
  weightLabel: string;
  /** `cumulative / total`, as a percentage of the bar. */
  fillPct: number;
  /** Where the threshold notch sits on the bar, as a percentage. */
  thresholdPct: number;
  /** `0xa1a1a1…a1a1`, or null while no hash has won. */
  winningHashShort: string | null;
  /** The bucket that never reached quorum, or null when every hash agreed. */
  outside: OutsideBucket | null;
}

/** Build the quorum view, including the bucket the corrupted node lands in. */
function quorumView(journal: Journal, state: ReplayState): QuorumView {
  const { threshold, total, cumulative, reached, winningResultHash } = state.quorum;
  // Only submissions that are on screen and demonstrably on another hash. A
  // frame with no winning hash yet has no outside bucket: undetermined is not
  // a mismatch.
  const rejected = state.operators.filter((o) => o.matchesWinningHash === false);
  const first = rejected[0];
  const outside: OutsideBucket | null =
    first === undefined
      ? null
      : {
          hashShort: truncateHash(first.result_hash, 10, 6),
          hash: first.result_hash,
          count: rejected.filter((o) => o.result_hash === first.result_hash).length,
          navText: `${formatAttestedNav(
            baseUnitsToNumber(first.nav, journal.nav_unit.decimals),
            journal.nav_unit.decimals,
          )} ${journal.nav_unit.asset}`,
        };

  const safeTotal = total > 0 ? total : 1;
  return {
    threshold,
    total,
    cumulative,
    reached,
    thresholdLabel: `${String(threshold)} of ${String(total)}`,
    weightLabel: `${String(cumulative)} of ${String(total)}`,
    fillPct: Math.min(100, (cumulative / safeTotal) * 100),
    thresholdPct: Math.min(100, (threshold / safeTotal) * 100),
    winningHashShort:
      winningResultHash === null ? null : truncateHash(winningResultHash, 10, 6),
    outside,
  };
}

/* ──────────────────────────────────────────────────────────── attestation ── */

/** The attestation landing, or the resting frame before it lands. */
interface AttestationView {
  /** True once the receipt is on screen. */
  landed: boolean;
  /** `500.000000 USDC` from `attestation.nav_final`, or null before it lands. */
  navText: string | null;
  /** Determinism anchor: the block every operator read. */
  inputsBlock: number;
  /** `sha256:9c9c9c…9c9c`. */
  digestShort: string;
  /** Full component digest, for the title attribute. */
  digest: string;
  /** `12:01:49` UTC, or the blank instrument reading before it lands. */
  attestedAt: string;
  /** Block the attestation landed in, or null. */
  blockNumber: number | null;
  /** `2-of-3` — the weight that actually settled it. */
  settledBy: string | null;
}

/** Build the attestation view for this frame. */
function attestationView(journal: Journal, state: ReplayState): AttestationView {
  const attestation = state.attestation;
  const landed = attestation.status === "landed";
  const navFinal = attestation.status === "landed" ? attestation.navFinal : null;
  return {
    landed,
    navText:
      navFinal === null
        ? null
        : `${formatAttestedNav(
            baseUnitsToNumber(navFinal, journal.nav_unit.decimals),
            journal.nav_unit.decimals,
          )} ${journal.nav_unit.asset}`,
    inputsBlock: state.inputsBlock,
    digestShort: truncateHash(journal.component_digest, 13, 6),
    digest: journal.component_digest,
    attestedAt: formatUtcTime(
      attestation.status === "landed" ? attestation.timestamp : null,
    ),
    blockNumber: attestation.status === "landed" ? attestation.blockNumber : null,
    settledBy: landed
      ? `${String(state.quorum.cumulative)}-of-${String(state.quorum.total)}`
      : null,
  };
}

/* ─────────────────────────────────────────────────────────────── the view ── */

/** Headline word for the panel's status pill. */
const PHASE_LABEL: Readonly<Record<string, string>> = {
  idle: "Idle",
  triggered: "Strike fired",
  collecting: "Collecting",
  "quorum-reached": "Quorum reached",
  attested: "Attested",
  complete: "Attested",
  stalled: "Stalled",
  rejected: "Rejected",
};

/** Everything the operator panel renders at one frame of playback. */
export interface PipelineView {
  /** `Journal.strike_id`. */
  strikeId: string;
  /** Block the cron trigger fired at, the readable handle for the strike. */
  triggerBlock: number;
  /** How the strike was triggered. */
  trigger: string;
  /** Status word for the panel pill. */
  phaseLabel: string;
  /** True once the trigger has fired at this frame. */
  triggered: boolean;
  /** Playback progress, 0-100. */
  progressPct: number;
  /** One card per registered operator, in journal order. */
  nodes: readonly NodeView[];
  quorum: QuorumView;
  attestation: AttestationView;
}

/**
 * Derive the whole panel from a journal and one replay frame.
 *
 * @param journal the capture being replayed.
 * @param state the frame, from `deriveReplayState`.
 */
export function buildPipelineView(journal: Journal, state: ReplayState): PipelineView {
  return {
    strikeId: journal.strike_id,
    triggerBlock: journal.trigger.block,
    trigger: journal.trigger.type,
    phaseLabel: PHASE_LABEL[state.phase] ?? "Idle",
    triggered: state.triggered,
    progressPct: Math.round(state.progress * 100),
    nodes: journal.operators.map((_operator, index) => nodeView(journal, index, state)),
    quorum: quorumView(journal, state),
    attestation: attestationView(journal, state),
  };
}
