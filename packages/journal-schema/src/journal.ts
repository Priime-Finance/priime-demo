/**
 * Frozen v1 NAV-strike journal: TypeScript view of the backend<->frontend seam.
 * Mirrors `schema/journal.v1.schema.json` field-for-field. The JSON Schema is
 * the source of truth; validate at runtime with ajv against `journalSchema`
 * (re-exported from the package index). Do not change shapes within v1.
 */

export const SCHEMA_VERSION = "1.0.0" as const;

export type Status = "pending" | "settled" | "stalled" | "rejected";
export type TriggerKind = "cron" | "block_interval" | "evm_event" | "manual";

export interface Vault {
  chain_id: number;
  address: string;
}

export interface Trigger {
  type: TriggerKind;
  block: number;
  /** Originating tx for evm_event triggers; null/absent for cron/block_interval. */
  tx_hash?: string | null;
}

export interface NavUnit {
  asset: string;
  /** Base-unit decimals for every nav value. */
  decimals: number;
}

export interface Operator {
  /** Operator signing address (recoverable from signature). */
  id: string;
  /** keccak256 of result_payload; equality across operators == agreement. */
  result_hash: string;
  /** NAV as an integer string in nav_unit base units (never a float). */
  nav: string;
  /** secp256k1 signature over the Priime envelope (eip191). */
  signature: string;
  /** Unix seconds (UTC) the submission was observed. */
  timestamp: number;
  /** Part of the quorum-winning set (result_hash === quorum.winning_result_hash). */
  accepted: boolean;
  /** Optional abi-encoded result bytes; lets anyone recompute the hash/NAV. */
  result_payload?: string;
}

export interface Transition {
  /** Running quorum weight after this operator joined. */
  cumulative: number;
  operator_id: string;
  result_hash: string;
  /** True once cumulative >= threshold. */
  reached: boolean;
  timestamp: number;
}

export interface Quorum {
  /** Quorum threshold (weight; == operator count in the equal-weight demo). */
  threshold: number;
  /** Total registered operator weight. */
  total: number;
  reached: boolean;
  /** The result_hash the quorum formed over; null if never reached. */
  winning_result_hash: string | null;
  transitions: Transition[];
}

export interface Attestation {
  /** On-chain attestation tx; null until settled. Deep-link via chain_id. */
  tx_hash: string | null;
  chain_id: number;
  block_number: number | null;
  /** Settled NAV in nav_unit base units; null until settled. */
  nav_final: string | null;
  timestamp: number | null;
}

/** One record per NAV strike. */
export interface Journal {
  schema_version: typeof SCHEMA_VERSION;
  strike_id: string;
  status: Status;
  service_id: string;
  vault: Vault;
  component_digest: string;
  trigger: Trigger;
  /** Block the NAV was computed against (determinism anchor). */
  inputs_block: number;
  nav_unit: NavUnit;
  operators: Operator[];
  quorum: Quorum;
  attestation: Attestation;
}
