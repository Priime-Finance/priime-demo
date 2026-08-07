//! Minimal WAVS aggregator for the verifiable-vaults M1 demo.
//!
//! Implements `wavs:aggregator@2.7.0`'s `aggregator-world`. For each operator
//! response it emits one EVM submit action per configured submit chain,
//! targeting the workflow's service-handler address (`HelloNavHandler`). No
//! timer batching and no gas oracle: submit immediately and let the node pay
//! default gas. This is the piece that turns a signed operator result into the
//! on-chain `handleSignedEnvelope` call.

use crate::wavs::{
    aggregator::output::{EvmSubmitAction, SubmitAction},
    types::{chain::EvmAddress, service::Submit},
};

wit_bindgen::generate!({
    path: "wit",
    world: "aggregator-world",
    generate_all,
    with: { "wasi:io/poll@0.2.0": wasip2::io::poll },
    features: ["tls"],
});

struct Component;

/// One EVM submit action per configured submit chain in the calling workflow.
/// The submit config is a flat `chain-key -> handler-address` map; non-chain
/// entries are skipped.
fn submissions() -> Result<Vec<AggregatorAction>, String> {
    let workflow = host::get_workflow().workflow;
    let submit_config = match workflow.submit {
        Submit::None => return Err("workflow has no aggregator submit config".to_string()),
        Submit::Aggregator(agg) => agg.component.config,
    };

    let mut actions = Vec::new();
    for (chain_key, handler_address) in submit_config {
        if host::get_evm_chain_config(&chain_key).is_none() {
            continue;
        }
        let addr: alloy_primitives::Address = handler_address
            .parse()
            .map_err(|e| format!("bad handler address for '{chain_key}': {e}"))?;
        actions.push(AggregatorAction::Submit(SubmitAction::Evm(
            EvmSubmitAction {
                chain: chain_key,
                address: EvmAddress {
                    raw_bytes: addr.to_vec(),
                },
                gas_price: None,
            },
        )));
    }
    Ok(actions)
}

impl Guest for Component {
    fn process_input(_input: AggregatorInput) -> Result<Vec<AggregatorAction>, String> {
        submissions()
    }

    fn handle_timer_callback(_input: AggregatorInput) -> Result<Vec<AggregatorAction>, String> {
        submissions()
    }

    fn handle_submit_callback(
        _input: AggregatorInput,
        tx_result: Result<AnyTxHash, String>,
    ) -> Result<(), String> {
        tx_result.map(|_| ())
    }
}

export!(Component);
