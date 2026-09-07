/* ─────────────────────────────────────────────────────────────────────────
 * PORTED VERBATIM (plan WP-2, docs/plans/ROUTER_LANE_PLAN.md, ruling R7).
 *
 *   source repo   ~/Desktop/autoloop-clean/autoloop-frontend
 *   source path   lib/canvas/orchestrator/attest.ts
 *   source commit eb6d33a96954819b370e93727fc2d7dcd6ba23bc
 *
 * The body below is the live app's file, byte for byte, with this header
 * prepended and NOTHING ELSE CHANGED. Any import that did not resolve in the
 * demo is listed in the WP-2 report rather than silently rewritten here; a
 * ported file that quietly diverges from its source is a second
 * implementation wearing the first one's name.
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * WHAT WAS DECIDED, MINTED AS A RECORD (spec B, WP-8).
 *
 * This file mints ids and shapes records. It decides nothing: every quantity
 * it writes arrives from `evaluate.ts`, which is where the decision was taken.
 * Splitting them is the whole point — a record built beside the decision is a
 * record that can disagree with it.
 *
 * ── ACTION PLUS POINTER, NEVER EVIDENCE INLINE ────────────────────────────
 *
 * An `AttestedDecision` carries the HASHES a reader resolves and never the
 * observed documents themselves. Two reasons, and the second is the load
 * bearing one. A signed artifact that inlines its evidence grows without
 * bound and re-states a fact that already has an owner. And a record that
 * inlines evidence cannot be checked: the only way to know a pointer is good
 * is to resolve it, and `unresolvedReferences` below is that check, run
 * before anything is published. THE RECORD MUST NEVER ADVERTISE A REFERENCE
 * THAT DOES NOT RESOLVE (the `writeContextPin` invariant).
 *
 * ── NOTHING WALL-CLOCK IN `decisionId` ────────────────────────────────────
 *
 * `decisionId = H(rulesHash, ruleId, source.hash, dest.hash)`, and those four
 * are the whole preimage. Two observers of one decision therefore mint one id
 * without agreeing on a clock first (the `EventId::new` discipline). `seq` is
 * excluded BY NAME: the `ObservationRef` contract makes it an ordering ordinal
 * only, and for `kind: "print"` it is the document's `generatedAtMs`.
 *
 * ⚠ MEASURED CONSEQUENCE, REPORTED RATHER THAN PAPERED OVER. The preimage
 * holds no ordinal, so two firings of ONE rule between the SAME two observed
 * states mint the SAME id. On a real stream that is a non-event, because a
 * new document with new numbers hashes differently. On a SCENARIO stream it is
 * reachable: `lib/canvas/scenario/generate.ts` gives every pin the bundle's
 * one hash, so a rule that fires twice in a run mints its id twice.
 * `evaluate.ts` counts duplicates and surfaces the count rather than
 * de-duplicating them into silence, and the count is a cross-package finding
 * against the ref-hash choice, not a defect this file may fix by widening a
 * preimage the spec fixes at four fields.
 *
 * ── THERE IS NO `Processor` INTERFACE IN THIS REPO ────────────────────────
 *
 * `grep` returns zero for it, so this file writes against the shape a WAVS
 * service handler actually receives:
 *
 *     Envelope      { bytes20 eventId; bytes12 ordering; bytes payload }
 *     SignatureData { address[] signers; bytes[] signatures; uint32 referenceBlock }
 *
 * `referenceBlock` is the OPERATOR-SET block: it says which quorum signed, and
 * it says nothing about what was observed. A treasury lane has no block at
 * all. So the observation ref lives inside `payload` or nowhere, and here it
 * lives inside `payload`. `eventId` is 20 bytes and `decisionId` is minted at
 * exactly that width so the id the record carries and the id the envelope
 * carries are one value rather than two spellings of one.
 */

import { canonicalJson, sha256Hex } from "../scenario/hash";
import { PAUSE_DESTINATION } from "./types";
import type { AttestedDecision, AttestedReceipt, ObservationRef } from "./types";

/** `Envelope.eventId` is `bytes20`. The id is minted at that width. Private:
 *  nothing outside this file decides how wide an id is. */
const DECISION_ID_BYTES = 20;
/** `Envelope.ordering` is `bytes12`. */
const ORDERING_BYTES = 12;

/** The four fields, and only these four, that mint a decision id. */
export interface DecisionIdPreimage {
  rulesHash: string;
  ruleId: string;
  /** `observed[sourceSlotId].hash`. */
  sourceHash: string;
  /**
   * `observed[destSlotId].hash`, or `""` when the destination is `pause`.
   *
   * `pause` is terminal and is not a slot (D11), so there is no observation
   * of it to hash. An empty string is the honest preimage for "there was no
   * destination document", and it is stable: every pause decision on one rule
   * and one source hashes the same way.
   */
  destHash: string;
}

function hexOf(bytes: number, hash: string): string {
  return `0x${hash.slice(0, bytes * 2)}`;
}

/**
 * The decision id, reproducible from the preimage and from nothing else.
 *
 * The full sha-256 is truncated to the envelope's own `bytes20` rather than
 * carried at 32 bytes and truncated later by whoever writes the envelope. One
 * width, decided here, so the record and the envelope cannot disagree about
 * which id this is.
 */
export function decisionIdOf(p: DecisionIdPreimage): string {
  return hexOf(
    DECISION_ID_BYTES,
    sha256Hex(canonicalJson({ rulesHash: p.rulesHash, ruleId: p.ruleId, sourceHash: p.sourceHash, destHash: p.destHash })),
  );
}

/**
 * `Envelope.ordering`, as `bytes12`.
 *
 * ORDERING IS THE ONE FIELD AN ORDINAL BELONGS IN, which is why the tick may
 * ride here while it may not ride in `decisionId`. The layout is a 64-bit
 * tick followed by a 32-bit index within the tick, big-endian, so envelopes
 * sort lexicographically in the order the decisions were taken.
 */
function orderingOf(tickIndex: number, indexWithinTick: number): string {
  const tick = BigInt(Math.max(0, Math.trunc(tickIndex)));
  const idx = BigInt(Math.max(0, Math.trunc(indexWithinTick)));
  return `0x${tick.toString(16).padStart(16, "0")}${idx.toString(16).padStart(8, "0")}`.slice(
    0,
    2 + ORDERING_BYTES * 2,
  );
}

/** One decision, in the shape a service handler receives it. `payload` is the
 *  canonical JSON of the decision; the bytes are the UTF-8 of that string. */
export interface AttestationEnvelope {
  /** `bytes20`. Identical to `decision.decisionId`. */
  eventId: string;
  /** `bytes12`. */
  ordering: string;
  /** The decision, canonically serialized. Key order is sorted recursively,
   *  so two observers serialize one decision into one string. */
  payload: string;
}

export function attestationEnvelope(decision: AttestedDecision, tickIndex: number, indexWithinTick: number): AttestationEnvelope {
  return {
    eventId: decision.decisionId,
    ordering: orderingOf(tickIndex, indexWithinTick),
    payload: canonicalJson(decision),
  };
}

/** Everything `buildAttestedDecision` needs, already decided. */
export interface DecisionInput {
  rulesHash: string;
  rule: AttestedDecision["rule"];
  observed: Record<string, ObservationRef>;
  scenarioRef: AttestedDecision["scenarioRef"];
  moved: AttestedDecision["moved"];
  cost: AttestedDecision["cost"];
  alternative: AttestedDecision["alternative"];
  budget: AttestedDecision["budget"];
}

/**
 * Assemble the record and mint its id from what is already inside it.
 *
 * The id's preimage is read OUT OF `observed` rather than passed beside it,
 * so a record whose id was minted from a hash it does not carry cannot be
 * built here at all.
 */
export function buildAttestedDecision(input: DecisionInput): AttestedDecision {
  const sourceHash = input.observed[input.moved.sourceSlotId]?.hash ?? "";
  const destHash =
    input.moved.destSlotId === PAUSE_DESTINATION ? "" : (input.observed[input.moved.destSlotId]?.hash ?? "");
  return {
    decisionId: decisionIdOf({
      rulesHash: input.rulesHash,
      ruleId: input.rule.ruleId,
      sourceHash,
      destHash,
    }),
    rulesHash: input.rulesHash,
    rule: input.rule,
    observed: input.observed,
    scenarioRef: input.scenarioRef,
    moved: input.moved,
    cost: input.cost,
    alternative: input.alternative,
    budget: input.budget,
  };
}

/**
 * WHAT ACTUALLY ARRIVED.
 *
 * `shortfall` is a MEASUREMENT, not an alarm: the difference between the USD
 * the decision committed and the USD the settlement delivered. It is zero
 * whenever nothing shrank in flight, and the record says zero rather than
 * omitting the field, because an absent measurement and a measured zero are
 * different claims.
 */
export function buildAttestedReceipt(args: {
  decisionId: string;
  settledAtRef: ObservationRef;
  realizedWeight: number;
  realizedCostUsd: number;
  committedUsd: number;
  deliveredUsd: number;
}): AttestedReceipt {
  return {
    decisionId: args.decisionId,
    settledAtRef: args.settledAtRef,
    realizedWeight: args.realizedWeight,
    realizedCostUsd: args.realizedCostUsd,
    shortfall: Number((args.committedUsd - args.deliveredUsd).toFixed(6)),
  };
}

/**
 * THE POINTERS THIS RECORD ADVERTISES, AND WHETHER THEY RESOLVE.
 *
 * Returns the pointers that do NOT resolve, so an empty array is the
 * publishable state. `resolves` is supplied by the caller because this file
 * holds no store: the evaluator resolves against the bundle it generated, a
 * server would resolve against whatever it wrote.
 *
 * Three families of pointer, and the third is the one a reader actually
 * follows:
 *   1. every `observed` hash, because the record claims those documents were
 *      read;
 *   2. `scenarioRef.hash`, because the record claims a reproducible run;
 *   3. `alternative.slotId`, because a runner-up naming a slot the record did
 *      not observe is a comparison nobody can check.
 */
export function unresolvedReferences(
  decision: AttestedDecision,
  resolves: (hash: string) => boolean,
): string[] {
  const bad: string[] = [];
  for (const [slotId, ref] of Object.entries(decision.observed)) {
    if (!ref.hash || !resolves(ref.hash)) bad.push(`observed[${slotId}].hash`);
  }
  if (!decision.scenarioRef.hash || !resolves(decision.scenarioRef.hash)) bad.push("scenarioRef.hash");
  const alt = decision.alternative;
  if ("slotId" in alt && !(alt.slotId in decision.observed)) bad.push(`alternative.slotId ${alt.slotId}`);
  const dest = decision.moved.destSlotId;
  if (dest !== PAUSE_DESTINATION && !(dest in decision.observed)) bad.push(`moved.destSlotId ${dest}`);
  if (!(decision.moved.sourceSlotId in decision.observed)) bad.push(`moved.sourceSlotId ${decision.moved.sourceSlotId}`);
  return bad;
}
