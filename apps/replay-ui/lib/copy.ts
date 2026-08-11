/**
 * Fixed copy and instrument blanks, in one place.
 *
 * The two disclaimers are the important ones. They are said the *same way*
 * everywhere the thing they describe appears, because a verification demo that
 * is vague about which numbers are real is the disease we claim to cure. If you
 * edit them, edit them here — never per panel.
 */
import type { OperatorStatus } from "@/components/OperatorModule";

/** Chain line the journal does not carry. */
export const CHAIN_LABEL = "Base · chain 8453";

/** Shown in a readout with no value yet. Instrument blanks, not em dashes. */
export const BLANK_HASH = "awaiting";

/** Shown in a percentage readout with no value yet. */
export const BLANK_PCT = "--.--%";

/** Status word on an operator's mini LCD, one per lifecycle step. */
export const STATUS_WORD: Readonly<Record<OperatorStatus, string>> = {
  awaiting: "Idle",
  computing: "Computing",
  submitted: "Signed",
  accepted: "Accepted",
  rejected: "Rejected",
  "no-quorum": "No quorum",
};

/** The fixture disclaimer, said the same way on every fixture-backed panel. */
export const FIXTURE_NOTE =
  "Fixture data. The peer mesh and the registry are read from a local sidecar until the live backend serves them. Nothing on this panel is attested.";

/** The simulator disclaimer, said the same way everywhere the feed appears. */
export const SIM_NOTE =
  "Simulated feed. Strikes, hashes, signatures and the attestation tx on this page are generated in your browser from a seeded PRNG, not observed from a running operator set. The shape is the frozen v1 journal; the authority is not there yet. Nothing here is deep-linked to an explorer, because nothing here is on chain.";
