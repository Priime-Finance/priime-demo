//! Hello-world Priime operator component for the verifiable-vaults demo.
//!
//! Implements the single `run` export of `priime:operator@3.0.0`'s `priime-world`:
//! read a per-workflow config var, then return an abi-encoded NAV payload that
//! the operators sign and the aggregator submits on-chain. This exists to
//! retire M1's risk: authoring + building a component against the WIT world
//! from scratch. The NAV here is a constant (42) - real NAV logic lands in M3.

use alloy_primitives::U256;
use alloy_sol_types::{sol, SolValue};

wit_bindgen::generate!({
    path: "wit",
    world: "priime-world",
    generate_all,
    with: { "wasi:io/poll@0.2.0": wasip2::io::poll },
    features: ["tls"],
});

use crate::priime::types::events::TriggerData;

sol! {
    /// The bytes every operator signs and the handler decodes on-chain.
    struct NavResult {
        uint256 nav;
        uint256 blockNumber;
    }
}

struct Component;

/// Best-effort block height from the trigger (block-interval carries it; cron
/// does not). Hello-world only uses it as payload metadata.
fn block_from_trigger(data: &TriggerData) -> u64 {
    match data {
        TriggerData::BlockInterval(bi) => bi.block_height,
        _ => 0,
    }
}

impl Guest for Component {
    fn run(action: TriggerAction) -> Result<Vec<WasmResponse>, String> {
        // Prove config injection works end to end (per-workflow config_var).
        let _label = host::config_var("label").unwrap_or_else(|| "hello".to_string());
        let block = block_from_trigger(&action.data);

        // Deterministic across operators: identical bytes => identical result hash.
        let payload = NavResult {
            nav: U256::from(42u64),
            blockNumber: U256::from(block),
        };
        Ok(vec![WasmResponse {
            payload: payload.abi_encode(),
            ordering: None,
            event_id_salt: None,
        }])
    }
}

export!(Component);
