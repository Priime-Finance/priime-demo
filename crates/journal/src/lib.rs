//! Frozen v1 NAV-strike journal: the seam between the backend (aggregator
//! component's accumulated keyvalue + on-chain attestation readback) and the
//! frontend (replay UI, then the identical-shape live-polling API).
//!
//! These types mirror `schema/journal.v1.schema.json` field-for-field.
//! `#[serde(deny_unknown_fields)]` makes any drift from the frozen schema a
//! test failure, and the tests round-trip the committed samples so the schema,
//! the samples, and this binding can never silently diverge.

use serde::{Deserialize, Serialize};

/// Frozen schema version. Bump only alongside a new schema `$id` (v2).
pub const SCHEMA_VERSION: &str = "1.0.0";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Journal {
    pub schema_version: String,
    pub strike_id: String,
    pub status: Status,
    pub service_id: String,
    pub vault: Vault,
    pub component_digest: String,
    pub trigger: Trigger,
    pub inputs_block: u64,
    pub nav_unit: NavUnit,
    pub operators: Vec<Operator>,
    pub quorum: Quorum,
    pub attestation: Attestation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Pending,
    Settled,
    Stalled,
    Rejected,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Vault {
    pub chain_id: u64,
    pub address: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Trigger {
    #[serde(rename = "type")]
    pub kind: TriggerKind,
    pub block: u64,
    #[serde(default)]
    pub tx_hash: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TriggerKind {
    Cron,
    BlockInterval,
    EvmEvent,
    Manual,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NavUnit {
    pub asset: String,
    pub decimals: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Operator {
    /// Operator signing address (recoverable from `signature`).
    pub id: String,
    /// keccak256 of `result_payload`. Equality across operators == agreement.
    pub result_hash: String,
    /// NAV as an integer string in `nav_unit` base units (never a float).
    pub nav: String,
    /// secp256k1 signature over the WAVS envelope (eip191).
    pub signature: String,
    /// Unix seconds (UTC) the submission was observed.
    pub timestamp: u64,
    /// Part of the quorum-winning set (`result_hash == quorum.winning_result_hash`).
    pub accepted: bool,
    /// Optional abi-encoded result bytes; lets anyone recompute the hash/NAV.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result_payload: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Quorum {
    pub threshold: u64,
    pub total: u64,
    pub reached: bool,
    pub winning_result_hash: Option<String>,
    pub transitions: Vec<Transition>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Transition {
    pub cumulative: u64,
    pub operator_id: String,
    pub result_hash: String,
    pub reached: bool,
    pub timestamp: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Attestation {
    pub tx_hash: Option<String>,
    pub chain_id: u64,
    pub block_number: Option<u64>,
    pub nav_final: Option<String>,
    pub timestamp: Option<u64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    const SETTLED: &str = include_str!("../../../schema/samples/strike-settled.json");
    const SABOTAGE: &str = include_str!("../../../schema/samples/strike-sabotage.json");

    fn roundtrip(j: &Journal) {
        let s = serde_json::to_string(j).unwrap();
        let back: Journal = serde_json::from_str(&s).unwrap();
        assert_eq!(j, &back, "serialize/deserialize must round-trip");
    }

    #[test]
    fn parses_settled_sample() {
        let j: Journal =
            serde_json::from_str(SETTLED).expect("settled sample must match frozen schema");
        assert_eq!(j.schema_version, SCHEMA_VERSION);
        assert_eq!(j.status, Status::Settled);
        assert_eq!(j.operators.len(), 3);
        assert!(
            j.operators.iter().all(|o| o.accepted),
            "all honest operators accepted"
        );
        assert!(j.quorum.reached);
        assert_eq!(j.attestation.nav_final.as_deref(), Some("500000000"));
        roundtrip(&j);
    }

    #[test]
    fn parses_sabotage_sample() {
        let j: Journal =
            serde_json::from_str(SABOTAGE).expect("sabotage sample must match frozen schema");
        assert_eq!(j.status, Status::Settled);
        assert_eq!(j.operators.len(), 3);

        let rejected: Vec<&Operator> = j.operators.iter().filter(|o| !o.accepted).collect();
        assert_eq!(rejected.len(), 1, "exactly one sabotaging operator");

        let win = j
            .quorum
            .winning_result_hash
            .as_deref()
            .expect("quorum reached => winning hash");
        assert_ne!(
            rejected[0].result_hash, win,
            "the liar's hash must differ from the quorum's"
        );
        assert!(
            j.operators
                .iter()
                .filter(|o| o.accepted)
                .all(|o| o.result_hash == win),
            "every accepted operator shares the winning hash",
        );
        // The vault settled the honest number despite the liar.
        assert_eq!(j.attestation.nav_final.as_deref(), Some("500000000"));
        roundtrip(&j);
    }
}
