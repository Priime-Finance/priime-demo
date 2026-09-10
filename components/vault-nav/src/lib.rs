//! WAVS operator component attesting PriimeVault's NAV (wavs:operator@2.7.0).
//!
//! Each cron cycle: derive `inputs_block` from the trigger's `trigger_time`
//! (cron triggers carry no height, NAV-03; the shared trigger time is what
//! makes the derived height identical across operators - see [`blocks`]),
//! read the vault's Morpho Blue position, the market state, the pool TWAP,
//! and the vault's escrow views, all pinned to that one block, then return
//! the abi-encoded payload `(handler, nav, inputsBlock)` that operators sign
//! and the aggregator submits to `PriimeVault.handleSignedEnvelope`.
//!
//! Valuation: collateral USDe is priced at min(par, pool TWAP), debt at
//! Morpho share math with interest accrued to the block timestamp and
//! shares -> assets rounded up. NAV excludes escrowed pending deposits and
//! reserved redemption payouts (the vault's public views). Integer math
//! only; no HTTP; any failed or undecodable read fails the cycle.
//!
//! Pure math lives in [`nav`] and the deterministic block search in
//! [`blocks`] (both host-testable); chain reads in [`adapters`]
//! (wasm32-only).

pub mod blocks;
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

    use self::wavs::types::events::TriggerData;

    struct Component;

    /// The cron trigger time, in whole seconds.
    ///
    /// This is the only chain-independent value every operator in the quorum
    /// receives identically, so it - not the local chain head - is what
    /// `inputs_block` is derived from. WIT carries it as nanos since the
    /// epoch; block timestamps are seconds, and truncating is safe because
    /// the same nanos truncate to the same seconds everywhere. A non-cron
    /// trigger has no trigger time and must fail rather than fall back to a
    /// per-operator value.
    fn trigger_time_secs(data: &TriggerData) -> Result<u64, String> {
        match data {
            TriggerData::Cron(c) => Ok(c.trigger_time.nanos / 1_000_000_000),
            _ => Err("vault-nav requires a cron trigger (no trigger_time otherwise)".to_string()),
        }
    }

    fn cfg(key: &str) -> Result<String, String> {
        host::config_var(key).ok_or_else(|| format!("missing workflow config var: {key}"))
    }

    fn cfg_address(key: &str) -> Result<Address, String> {
        cfg(key)?
            .parse()
            .map_err(|e| format!("bad address in config {key}: {e}"))
    }

    fn cfg_u64(key: &str) -> Result<u64, String> {
        cfg(key)?
            .parse()
            .map_err(|e| format!("bad u64 in config {key}: {e}"))
    }

    /// Read an optional workflow config var. Absent -> None, present -> Some.
    /// Composer knobs use this because a legacy publish predating the composer
    /// simply omits the key; the operator must not fail the cycle for that.
    fn cfg_opt(key: &str) -> Option<String> {
        host::config_var(key)
    }

    /// A knob is "meaningfully set" iff its value is present and not empty,
    /// zero, or a numeric noise value the composer sends for an unset dial.
    /// The composer forwards every knob it draws (see PublishFlow.tsx), so
    /// the reader can't distinguish "user unset" from "user picked zero"
    /// unless we treat zero-ish strings as unset here. Downstream: refuse
    /// checks and observation computations both share this predicate.
    fn is_meaningfully_set(key: &str) -> bool {
        match cfg_opt(key) {
            None => false,
            Some(v) => {
                let t = v.trim();
                !(t.is_empty() || t == "0" || t == "0.0" || t == "0.00")
            }
        }
    }

    /// Fail the cycle if the strategist configured a knob the component
    /// cannot honor. The composer surface currently shows hedge, perp, and
    /// redemption-routing dials that describe strategies THIS vault-nav
    /// component does not run. Attesting NAV for a strategy the component
    /// silently ignores is the lie the whole demo is against; refuse
    /// instead. Loop-server also rejects these at validation, this is
    /// belt-and-suspenders at run time. When a component honors any of them
    /// (a hedge leg, a perp margin manager, a redemption router), remove
    /// its key from this list at the same time.
    fn refuse_unimplemented() -> Result<(), String> {
        const UNIMPLEMENTED: &[(&str, &str)] = &[
            ("hedge_leverage", "hedge leg not implemented"),
            ("delta_band_pct", "delta-neutral hedging not implemented"),
            ("margin_trim_pct", "perp margin management not implemented"),
            ("margin_restore_pct", "perp margin management not implemented"),
            ("funding_floor_apr", "perp funding-rate check not implemented"),
            ("hl_coin", "HyperLiquid perp leg not implemented"),
            ("exit_route_id", "redemption venue routing not implemented"),
            ("exit_settlement_days", "off-ramp settlement window not implemented"),
        ];
        for (key, why) in UNIMPLEMENTED {
            if is_meaningfully_set(key) {
                return Err(format!(
                    "config knob {key} is set but {why}; remove the knob or publish against a component that honors it"
                ));
            }
        }
        Ok(())
    }

    /// Canonical bytes of every workflow config key/value pair we know about,
    /// keccak256'd. Present keys are appended in lexicographic order as
    /// `key=value\n`; absent keys contribute nothing. Every operator with the
    /// same service.json therefore produces the same hash; anyone tampering
    /// with any tracked field produces a different one, its result hash
    /// diverges, and the quorum outvotes it.
    ///
    /// The list is closed because WAVS gives us no config-enumeration API - we
    /// name every key the deploy pipeline can emit. New composer knobs must
    /// land here at the same time they land in loop-server's componentConfig
    /// output, or the hash silently drops them (and the "cannot lie" property
    /// with it). loop-deploy owns the write side; this list owns the read.
    fn config_hash() -> FixedBytes<32> {
        const KEYS: &[&str] = &[
            "applied_leverage",
            "capacity_binding",
            "chain_id",
            "collateral_yield_apy",
            "compound_cadence_hours",
            "compound_threshold_usd",
            "delta_band_pct",
            "exit_route_id",
            "exit_settlement_days",
            "funding_floor_apr",
            "hedge_leverage",
            "hf_deleverage_bps",
            "hf_floor_bps",
            "hf_target_bps",
            "hl_coin",
            "inputs_block_lag",
            "irm_address",
            "lltv",
            "margin_restore_pct",
            "margin_trim_pct",
            "market_id",
            "morpho_address",
            "oracle_address",
            "pool_address",
            "reserve_fraction",
            "risk_preset",
            "twap_window_secs",
            "usdc_address",
            "usde_address",
            "vault_address",
        ];
        let mut buf: Vec<u8> = Vec::new();
        for key in KEYS {
            if let Some(value) = cfg_opt(key) {
                buf.extend_from_slice(key.as_bytes());
                buf.push(b'=');
                buf.extend_from_slice(value.as_bytes());
                buf.push(b'\n');
            }
        }
        alloy_primitives::keccak256(&buf)
    }

    fn rpc_url() -> Result<String, String> {
        let chain_id = cfg("chain_id")?;
        let chain = host::get_evm_chain_config(&chain_id)
            .ok_or_else(|| format!("no chain config for {chain_id}"))?;
        chain
            .http_endpoint
            .ok_or_else(|| format!("no HTTP endpoint for chain {chain_id}"))
    }

    fn run_cycle(trigger_time_secs: u64) -> Result<Vec<u8>, String> {
        // Belt-and-suspenders against a composer that offers dials the
        // component cannot honor. Loop-server's config validator has the
        // canonical enforcement; this catches any config that reaches wasm
        // with a knob we cannot attest against.
        refuse_unimplemented()?;

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
            twap_window_secs: u32::try_from(cfg_u64("twap_window_secs")?).map_err(|_| {
                "twap_window_secs exceeds u32 (observe secondsAgos is uint32)".to_string()
            })?,
            inputs_block_lag: cfg_u64("inputs_block_lag")?,
        };

        let s = fetch_state(rpc_url()?, &targets, trigger_time_secs)?;

        if s.market_last_update == 0 || s.market_last_update > s.block_timestamp {
            return Err(format!(
                "market lastUpdate {} incoherent with block timestamp {}",
                s.market_last_update, s.block_timestamp
            ));
        }
        let elapsed = s.block_timestamp - s.market_last_update;

        let accrued = nav::accrued_total_borrow(s.total_borrow_assets, s.borrow_rate_wad, elapsed);
        let debt = nav::borrow_assets_up(s.borrow_shares, accrued, s.total_borrow_shares);

        let tick = nav::avg_tick(s.tick_cum_old, s.tick_cum_new, s.twap_window_effective_secs)?;
        let twap_price = nav::price_1e24_at_tick(tick)?;

        // Composer knobs that CHANGE the attested NAV or fail the cycle.
        // See `refuse_unimplemented()` for knobs the component cannot honor
        // and the observation bag below for knobs bound as attested numbers.
        let preset = match cfg_opt("risk_preset") {
            Some(s) => nav::RiskPreset::parse(&s)?,
            None => nav::RiskPreset::Standard,
        };
        let hf_floor_bps: u16 = match cfg_opt("hf_floor_bps") {
            Some(s) => s
                .parse()
                .map_err(|e| format!("bad hf_floor_bps in config: {e}"))?,
            None => 0,
        };

        nav::check_hf_floor(s.collateral_1e18, debt, hf_floor_bps, lltv)?;

        let price = nav::preset_collateral_price_1e24(twap_price, preset);

        let value = nav::nav_usdc(
            s.collateral_1e18,
            price,
            debt,
            s.vault_usdc_balance,
            s.total_pending_deposit,
            s.total_claimable_redeem,
        )?;

        // Per-strike observations. Each maps to a composer knob the strategist
        // set at publish; downstream verifiers compare configured vs measured
        // and gate downstream actions on the difference. See
        // `nav::encode_payload` for the on-chain shape.
        //   applied_leverage      -> leverage_bps
        //   hf_target_bps         -> ltv_bps
        //   hf_deleverage_bps     -> ltv_bps
        //   reserve_fraction      -> reserve_bps
        //   collateral_yield_apy  -> supply_apy_bps
        //   compound_cadence_hours -> hours_since_update
        // Every value is deterministic from chain state at `inputs_block`, so
        // two operators running the same config produce identical bytes.
        let utilization_bps = nav::utilization_bps(s.total_borrow_assets, s.total_supply_assets);
        let obs = nav::Observations {
            leverage_bps: nav::measured_leverage_bps(s.collateral_1e18, debt),
            ltv_bps: nav::measured_ltv_bps(s.collateral_1e18, debt),
            reserve_bps: nav::measured_reserve_bps(s.vault_usdc_balance, value),
            supply_apy_bps: nav::measured_supply_apy_bps(s.borrow_rate_wad, utilization_bps),
            hours_since_update: nav::hours_between(s.market_last_update, s.block_timestamp),
        };

        Ok(nav::encode_payload(vault, value, s.inputs_block, config_hash(), obs))
    }

    impl Guest for Component {
        fn run(action: TriggerAction) -> Result<Vec<WasmResponse>, String> {
            let payload = run_cycle(trigger_time_secs(&action.data)?)?;
            Ok(vec![WasmResponse {
                payload,
                ordering: None,
                event_id_salt: None,
            }])
        }
    }

    export!(Component);
}
