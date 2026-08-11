/**
 * The view model behind the living-system canvas.
 *
 * One pure function. In goes a frame of the feed (whatever the simulator hook
 * produced, or tomorrow whatever the polling source produced) plus the operator
 * registry; out come the preformatted strings and tones every component on the
 * page renders. No React, no clock, no DOM: `buildStageView` is a total
 * function of its input, so the same frame always draws the same pixels and the
 * whole derivation is unit-testable without mounting anything.
 *
 * This is the layering seam. `components/` never imports from `lib/`; the page
 * calls this and hands the result down as props.
 */
import type { Journal } from "@priime-demo/journal-schema";

import type { CanvasChainView, CanvasOperatorView, CanvasPulse, CanvasVaultView, NodeLamp } from "@/components/SystemCanvas";
import type { OperatorStatus } from "@/components/OperatorModule";
import type { PeerNodeView } from "@/components/PeerPanel";
import type { RegistryOperatorView } from "@/components/RegistryPanel";
import type { StrikeTickerItem } from "@/components/StrikeTicker";
import { BLANK_HASH, BLANK_PCT, STATUS_WORD } from "@/lib/copy";
import {
  demoEnvironment,
  peerStatusFor,
  registryEntryFor,
  type OperatorRegistryEntry,
} from "@/lib/environment";
import { formatNavPct, truncateAddress, truncateHash } from "@/lib/format";
import type { ReplayState, ReplayTimeline } from "@/lib/replay";
import {
  healthFactor,
  NAV_BASELINE,
  SIM_CONFIG,
  summariseStrike,
  type SimState,
} from "@/lib/simulate";

/** How long a packet takes to travel one wire, in ms. */
export const PULSE_MS = 900;

/**
 * One frame of the feed, plus the registry it is read against.
 *
 * Structurally a superset of nothing in particular on purpose: `SimulatorFeed`
 * satisfies it today, and a live `JournalSource`-backed hook will satisfy it
 * tomorrow without this file changing.
 */
export interface StageInput {
  /** Registered operators, in registry order. */
  registry: readonly OperatorRegistryEntry[];
  /** The strike currently in (or just out of) flight. */
  journal: Journal | null;
  /** Its compiled timeline. */
  timeline: ReplayTimeline | null;
  /** Its derived state at `tMs`. */
  state: ReplayState | null;
  /** Animation offset in ms since the live strike triggered. */
  tMs: number;
  /** Simulator state after the live strike (NAV, LTV, ordinal). */
  sim: SimState;
  /**
   * Operator ids currently flipped to corrupt, lowercased.
   *
   * The switch positions as they are *now*. Drives the toggles on the plates
   * and nothing else: a switch renders its own state, not the strike's.
   */
  corrupt: ReadonlySet<string>;
  /**
   * Operator ids that were flipped to corrupt when `journal` fired, lowercased.
   *
   * A flip takes effect from the *next* strike, so anything that describes what
   * happened in the strike on screen must read this and never `corrupt`.
   * Otherwise flipping a switch mid-strike relabels a node the journal beneath
   * it says did nothing wrong.
   */
  strikeCorrupt: ReadonlySet<string>;
  /** True when the OS asks for reduced motion: no travelling dots. */
  reducedMotion: boolean;
  /** Strikes newest first, live one at index 0. */
  history: readonly Journal[];
}

/** Everything one frame of the page renders. */
export interface StageView {
  /** Operator modules on the canvas, in registry order. */
  operators: readonly CanvasOperatorView[];
  /** The vault at the centre. */
  vault: CanvasVaultView;
  /** The Base attestation node. */
  chain: CanvasChainView;
  /** Packets in flight this frame. */
  pulses: readonly CanvasPulse[];
  /** True when no hash reached the threshold: nothing was attested. */
  stalled: boolean;
  /** Weight that has actually landed in the quorum bar. */
  quorumWeight: number;
  /** Weight that submitted and was refused (never enters the bar). */
  excludedWeight: number;
  /** The line under the quorum ladder, or undefined for a clean strike. */
  quorumNote: string | undefined;
  /** Vault NAV as a signed percentage of the deployed baseline. */
  vaultNavPct: string;
  /** Simulated loan-to-value, as a percentage. */
  ltvPct: number;
  /** Simulated health factor. */
  healthFactorValue: number;
  /** The attestation as the panels want it. */
  attestation: AttestationView;
  /** The recent-strikes strip, newest first. */
  ticker: readonly StrikeTickerItem[];
  /** The p2p rail. */
  peers: readonly PeerNodeView[];
  /** The registry rail. */
  registryRows: readonly RegistryOperatorView[];
  /** Registry summary line, e.g. `"3 operators · total weight 3"`. */
  registryTotals: string;
}

/** The landed (or not) attestation, unpacked once. */
export interface AttestationView {
  /** True once the receipt is in. */
  landed: boolean;
  /** Attestation tx hash, or null. */
  txHash: string | null;
  /** Settled NAV in base units, or null. */
  navFinal: string | null;
  /** Block it landed in, or null. */
  blockNumber: number | null;
  /** Unix seconds it landed at, or null. */
  timestamp: number | null;
}

/**
 * Derive one frame.
 *
 * @param input the feed frame plus the registry.
 * @returns everything the page hands to its components.
 */
export function buildStageView(input: StageInput): StageView {
  const { registry, journal, timeline, state, tMs, sim, corrupt, strikeCorrupt, reducedMotion, history } =
    input;

  const stalled = state?.status === "stalled";

  /* ------------------------------------------------------------ operators */

  // Which operators' weight has actually landed in the quorum bar so far.
  const settled = new Set(
    journal === null || state === null
      ? []
      : journal.quorum.transitions
          .slice(0, state.quorum.transitionsFired)
          .map((transition) => transition.operator_id.toLowerCase()),
  );

  const liveFor = (operatorId: string): ReplayState["operators"][number] | null =>
    state?.operators.find((op) => op.id.toLowerCase() === operatorId.toLowerCase()) ?? null;

  /**
   * Lifecycle step for one registry operator in the live strike.
   *
   * The stalled case matters: with 2+ liars nobody is accepted, but the honest
   * node was not *outvoted* — no hash reached the threshold at all. Calling
   * that "rejected" would slander the one node that told the truth.
   *
   * Reads `strikeCorrupt`, not `corrupt`: the switches as they stood when this
   * strike fired. A flip made while a stalled strike is on screen must not
   * repaint a node the journal beneath it shows as honest.
   */
  const operatorStatus = (operatorId: string): OperatorStatus => {
    const live = liveFor(operatorId);
    if (live === null) return state?.triggered === true ? "computing" : "awaiting";
    if (live.accepted) {
      return settled.has(operatorId.toLowerCase()) ? "accepted" : "submitted";
    }
    if (stalled) return strikeCorrupt.has(operatorId.toLowerCase()) ? "rejected" : "no-quorum";
    return "rejected";
  };

  const operators: readonly CanvasOperatorView[] = registry.map((entry, index) => {
    const live = liveFor(entry.id);
    const status = operatorStatus(entry.id);
    const lamp: NodeLamp =
      status === "awaiting" ? "idle" : status === "no-quorum" ? "stalled" : status;
    const peer = peerStatusFor(entry.id);

    return {
      id: entry.id,
      label: entry.label,
      index: `// 0${index + 1}`,
      address: truncateAddress(entry.id),
      lamp,
      statusWord: STATUS_WORD[status],
      hash: live === null ? BLANK_HASH : truncateHash(live.result_hash, 10, 6),
      navPct: live === null ? BLANK_PCT : formatNavPct(live.nav, NAV_BASELINE),
      weight: `WEIGHT ${entry.weight}`,
      corrupt: corrupt.has(entry.id.toLowerCase()),
      peerId: peer === null ? "unknown" : truncateHash(peer.peer_id, 12, 6),
    };
  });

  /* --------------------------------------------------------------- pulses */

  const triggerAtMs = timeline?.events.find((event) => event.kind === "trigger")?.atMs ?? 0;
  const pulses = buildPulses({ registry, timeline, state, tMs, triggerAtMs, reducedMotion });

  /* ---------------------------------------------------------------- vault */

  const healthFactorValue = healthFactor(sim, SIM_CONFIG);
  const ltvPct = sim.ltvBps / 100;
  const vaultNavPct = formatNavPct(sim.nav, NAV_BASELINE);
  // `triggerAtMs` falls back to 0 with no timeline, which made `tMs >= 0`
  // trivially true and spun the vault on the empty frame — the server render
  // and the first client paint, since the boot effect only runs after paint.
  // Gate on a strike having actually triggered, not on the clock alone.
  const reading =
    !reducedMotion &&
    state?.triggered === true &&
    tMs >= triggerAtMs &&
    tMs < triggerAtMs + PULSE_MS * 1.8;

  const vault: CanvasVaultView = {
    tone: stalled ? "stalled" : reading ? "reading" : state?.done === true ? "settled" : "idle",
    reading,
    caption: `NAV ${vaultNavPct}`,
    subCaption: `HF ${healthFactorValue.toFixed(2)} · LTV ${ltvPct.toFixed(1)}%`,
  };

  /* ---------------------------------------------------------------- chain */

  const raw = state?.attestation ?? null;
  const landed = raw?.status === "landed";
  const attestation: AttestationView = {
    landed,
    txHash: raw?.status === "landed" ? raw.txHash : null,
    navFinal: raw?.status === "landed" ? raw.navFinal : null,
    blockNumber: raw?.status === "landed" ? raw.blockNumber : null,
    timestamp: raw?.status === "landed" ? raw.timestamp : null,
  };

  // A stalled strike has no winning bucket, so no weight ever entered quorum.
  // The ladder, the chain node and the ticker must all say 0, not "the biggest
  // losing bucket happened to hold 1".
  const quorumWeight = stalled ? 0 : (state?.quorum.cumulative ?? 0);

  const chain: CanvasChainView = {
    title: "Base · 8453",
    index: "// 04",
    kicker: "Attestation sink · POA registry",
    registry: truncateAddress(demoEnvironment.registry.contract_address),
    quorum: `${quorumWeight}-of-${state?.quorum.total ?? registry.length}`,
    quorumWord: stalled ? "Not reached" : state?.quorum.reached === true ? "Reached" : "Collecting",
    lamp: stalled
      ? "stalled"
      : landed
        ? "accepted"
        : state?.triggered === true
          ? "computing"
          : "idle",
    txLabel: attestation.txHash === null ? BLANK_HASH : truncateHash(attestation.txHash, 8, 6),
    navLine:
      attestation.navFinal === null
        ? "NAV pending"
        : `NAV ${formatNavPct(attestation.navFinal, NAV_BASELINE)}`,
  };

  /* --------------------------------------------------------------- quorum */

  // "Not accepted" is true of EVERY node in a stalled strike, honest one
  // included, so taking it at face value painted all three slots in the alarm
  // register — contradicting the operator panel two inches away, which is
  // careful to draw the honest node amber rather than outvoted. When stalled,
  // count only the nodes that actually diverged and leave the honest slot
  // empty. A stalled strike with no known liar (what a real journal looks
  // like) drains the bar instead of accusing everyone: no weight entered it,
  // which is true, and it names nobody.
  const refused =
    state === null
      ? []
      : state.operators.filter((op) =>
          stalled ? strikeCorrupt.has(op.id.toLowerCase()) : !op.accepted,
        );
  const excludedWeight = refused.reduce(
    (sum, op) => sum + (registryEntryFor(op.id)?.weight ?? 1),
    0,
  );
  const rejectedLabels = refused.map(
    (op) => registryEntryFor(op.id)?.label ?? truncateAddress(op.id),
  );
  // Names the nodes that diverged in THIS strike, so it reads `strikeCorrupt`.
  // Quoting the live switches here would put a node in the sentence before it
  // has told its first lie.
  const corruptLabels = registry
    .filter((entry) => strikeCorrupt.has(entry.id.toLowerCase()))
    .map((entry) => entry.label);

  const threshold = state?.quorum.threshold ?? 2;
  const total = state?.quorum.total ?? registry.length;

  // Both sentences quote the THRESHOLD, never the live cumulative: mid-strike
  // the running count is still climbing, and "the honest 0-of-3 settles the
  // truth" is a lie the ladder itself contradicts two lines above.
  const quorumNote = stalled
    ? `${corruptLabels.length > 0 ? corruptLabels.join(", ") : "Two or more nodes"} each diverged onto a hash of their own. No hash reached ${threshold}, so the strike stalled and nothing was attested. This is why the set is 3 nodes at 2-of-3.`
    : excludedWeight > 0
      ? `${rejectedLabels.join(", ")} submitted a divergent hash. That weight never enters the bar; the honest ${threshold}-of-${total} settles the truth.`
      : undefined;

  /* -------------------------------------------------------------- history */

  const ticker: readonly StrikeTickerItem[] = history.map((entry, index) => {
    const summary = summariseStrike(entry, sim.strikeIndex - index);
    return {
      strikeId: summary.strikeId,
      ordinal: summary.ordinal,
      status: summary.status,
      navPct: summary.nav === null ? BLANK_PCT : formatNavPct(summary.nav, NAV_BASELINE),
      quorum: `${summary.cumulative}-of-${summary.total}`,
      tone: index === 0 ? "live" : summary.status === "settled" ? "ok" : "warn",
      live: index === 0,
    };
  });

  /* ----------------------------------------------------------------- rail */

  const peers: readonly PeerNodeView[] = registry.map((entry) => {
    const peer = peerStatusFor(entry.id);
    return {
      label: entry.label,
      peerId: peer === null ? "unknown" : truncateHash(peer.peer_id, 12, 6),
      peerIdTitle: peer?.peer_id ?? "unknown",
      connected: `${peer?.connected_peers.length ?? 0} peers`,
    };
  });

  const registryRows: readonly RegistryOperatorView[] = registry.map((entry) => ({
    label: entry.label,
    address: truncateAddress(entry.id),
    addressTitle: entry.id,
    weight: `weight ${entry.weight}`,
  }));

  const totalWeight = registry.reduce((sum, entry) => sum + entry.weight, 0);

  return {
    operators,
    vault,
    chain,
    pulses,
    stalled,
    quorumWeight,
    excludedWeight,
    quorumNote,
    vaultNavPct,
    ltvPct,
    healthFactorValue,
    attestation,
    ticker,
    peers,
    registryRows,
    registryTotals: `${registry.length} operators · total weight ${totalWeight}`,
  };
}

/* ---------------------------------------------------------------- helpers */

interface PulseInput {
  registry: readonly OperatorRegistryEntry[];
  timeline: ReplayTimeline | null;
  state: ReplayState | null;
  tMs: number;
  triggerAtMs: number;
  reducedMotion: boolean;
}

/** Which wires are carrying something this frame, and how far along. */
function buildPulses({
  registry,
  timeline,
  state,
  tMs,
  triggerAtMs,
  reducedMotion,
}: PulseInput): readonly CanvasPulse[] {
  if (timeline === null || state === null) return [];
  const out: CanvasPulse[] = [];

  // Reduced motion gets state, not movement: the wire is hot or it is not.
  if (reducedMotion) {
    if (state.triggered && !state.done) {
      for (const entry of registry) {
        out.push({ edgeId: `read:${entry.id}`, progress: null, tone: "read" });
      }
    }
    for (const operator of state.operators) {
      out.push({
        edgeId: `submit:${operator.id}`,
        progress: null,
        tone: operator.accepted ? "ok" : "bad",
      });
    }
    return out;
  }

  // Vault -> every operator, simultaneously: three independent reads of the
  // same position at the same block.
  const readProgress = (tMs - triggerAtMs) / PULSE_MS;
  if (readProgress >= 0 && readProgress <= 1) {
    for (const entry of registry) {
      out.push({ edgeId: `read:${entry.id}`, progress: readProgress, tone: "read" });
    }
  }

  // Operator -> chain, one packet per submission, coloured by its verdict.
  for (const event of timeline.events) {
    if (event.kind !== "submission") continue;
    const progress = (tMs - event.atMs) / PULSE_MS;
    if (progress < 0 || progress > 1) continue;
    out.push({
      edgeId: `submit:${event.operator.id}`,
      progress,
      tone: event.operator.accepted ? "ok" : "bad",
    });
  }

  return out;
}
