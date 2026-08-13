//! WAVS operator component attesting PriimeVault's NAV (wavs:operator@2.7.0).
//!
//! Each cron cycle: self-determine `inputs_block` (chain head minus a
//! configured lag; cron triggers carry no height, NAV-03), read the vault's
//! Morpho Blue position, the market state, the pool TWAP, and the vault's
//! escrow views, all pinned to that one block, then return the abi-encoded
//! payload `(handler, nav, inputsBlock)` that operators sign and the
//! aggregator submits to `PriimeVault.handleSignedEnvelope`.
//!
//! Valuation: collateral USDe is priced at min(par, pool TWAP), debt at
//! Morpho share math with interest accrued to the block timestamp and
//! shares -> assets rounded up. NAV excludes escrowed pending deposits and
//! reserved redemption payouts (the vault's public views). Integer math
//! only; no HTTP; any failed or undecodable read fails the cycle.
//!
//! Pure math lives in [`nav`] (host-testable); chain reads in [`adapters`]
//! (wasm32-only).

pub mod nav;

#[cfg(target_arch = "wasm32")]
mod adapters;

#[cfg(target_arch = "wasm32")]
mod component {
    use crate::adapters::{fetch_state, ReadTargets};
    use crate::nav;
    use alloy_primitives::{Address, FixedBytes, U256};

    wit_bindgen::generate!({
        path: "wit",
        world: "wavs-world",
        generate_all,
        with: { "wasi:io/poll@0.2.0": wasip2::io::poll },
        features: ["tls"],
    });

    struct Component;

    fn cfg(key: &str) -> Result<String, String> {
        host::config_var(key).ok_or_else(|| format!("missing workflow config var: {key}"))
    }

    fn cfg_address(key: &str) -> Result<Address, String> {
        cfg(key)?.parse().map_err(|e| format!("bad address in config {key}: {e}"))
    }

    fn cfg_u64(key: &str) -> Result<u64, String> {
        cfg(key)?.parse().map_err(|e| format!("bad u64 in config {key}: {e}"))
    }

    fn rpc_url() -> Result<String, String> {
        let chain_id = cfg("chain_id")?;
        let chain = host::get_evm_chain_config(&chain_id)
            .ok_or_else(|| format!("no chain config for {chain_id}"))?;
        chain.http_endpoint.ok_or_else(|| format!("no HTTP endpoint for chain {chain_id}"))
    }

    fn run_cycle() -> Result<Vec<u8>, String> {
        let vault = cfg_address("vault_address")?;
        let market_id: FixedBytes<32> = cfg("market_id")?
            .parse()
            .map_err(|e| format!("bad market_id: {e}"))?;
        let lltv: U256 = cfg("lltv")?.parse().map_err(|e| format!("bad lltv: {e}"))?;
        let usdc = cfg_address("usdc_address")?;
        let usde = cfg_address("usde_address")?;
        let oracle = cfg_address("oracle_address")?;
        let irm = cfg_address("irm_address")?;

        let targets = ReadTargets {
            morpho: cfg_address("morpho_address")?,
            market_id,
            market_params: (usdc, usde, oracle, irm, lltv),
            irm,
            pool: cfg_address("pool_address")?,
            usdc,
            vault,
            twap_window_secs: cfg_u64("twap_window_secs")? as u32,
            inputs_block_lag: cfg_u64("inputs_block_lag")?,
        };

        let s = fetch_state(rpc_url()?, &targets)?;

        // Degenerate market clock states fail the cycle (idiom: a zero or
        // future-dated lastUpdate cannot support a sound accrual).
        if s.market_last_update == 0 || s.market_last_update > s.block_timestamp {
            return Err(format!(
                "market lastUpdate {} incoherent with block timestamp {}",
                s.market_last_update, s.block_timestamp
            ));
        }
        let elapsed = s.block_timestamp - s.market_last_update;

        let accrued = nav::accrued_total_borrow(s.total_borrow_assets, s.borrow_rate_wad, elapsed);
        let debt = nav::borrow_assets_up(s.borrow_shares, accrued, s.total_borrow_shares);

        let tick = nav::avg_tick(s.tick_cum_old, s.tick_cum_new, targets.twap_window_secs)?;
        let price = nav::bounded_price_1e24(nav::price_1e24_at_tick(tick)?);

        let value = nav::nav_usdc(
            s.collateral_1e18,
            price,
            debt,
            s.vault_usdc_balance,
            s.total_pending_deposit,
            s.total_claimable_redeem,
        )?;

        Ok(nav::encode_payload(vault, value, s.inputs_block))
    }

    impl Guest for Component {
        fn run(_action: TriggerAction) -> Result<Vec<WasmResponse>, String> {
            let payload = run_cycle()?;
            Ok(vec![WasmResponse { payload, ordering: None, event_id_salt: None }])
        }
    }

    export!(Component);
}
