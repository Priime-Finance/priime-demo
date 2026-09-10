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
            (
                "margin_restore_pct",
                "perp margin management not implemented",
            ),
            (
                "funding_floor_apr",
                "perp funding-rate check not implemented",
            ),
            ("hl_coin", "HyperLiquid perp leg not implemented"),
            ("exit_route_id", "redemption venue routing not implemented"),
            (
                "exit_settlement_days",
                "off-ramp settlement window not implemented",
            ),
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
            "pool_tick_spacing",
            "reserve_fraction",
            "risk_preset",
            "swap_router",
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
        let hf_floor_bps: u32 = match cfg_opt("hf_floor_bps") {
            Some(s) => s
                .trim()
                .parse()
                .map_err(|e| format!("bad hf_floor_bps in config: {e}"))?,
            None => 0,
        };
        // Preset-adjusted collateral valuation MUST be computed first: the
        // hf_floor guard and the leverage/LTV observations all use the same
        // price the attested NAV does, or a depeg silently misaligns the
        // three surfaces (roadmap P00 #11).
        let price = nav::preset_collateral_price_1e24(twap_price, preset);

        // hf_floor breach no longer aborts the strike: we attest with the
        // BREACH_HF_FLOOR bit set (roadmap P00 #13) so the vault contract
        // can stop taking new deposit / redeem requests instead of the
        // whole cycle silently disappearing. `?` still bubbles a config
        // error (hf_floor_bps below HF 1.0), which is not a runtime state.
        let mut breach_flags: u16 = 0;
        if nav::check_hf_floor(s.collateral_1e18, price, debt, hf_floor_bps, lltv)? {
            breach_flags |= nav::BREACH_HF_FLOOR;
        }

        let value = nav::nav_usdc(
            s.collateral_1e18,
            price,
            debt,
            s.vault_usdc_balance,
            s.total_pending_deposit,
            s.total_claimable_redeem,
        )?;
        // Equity-level preset haircut (roadmap P00 #12). Applied to the
        // attested NAV, sized in the same units it protects, so a 100 bps
        // Conservative buffer is 100 bps regardless of the leverage on the
        // collateral leg. Zero for Standard/Aggressive.
        let haircut_bps = nav::preset_equity_haircut_bps(preset);
        let value = if haircut_bps == 0 {
            value
        } else {
            value * U256::from(10_000 - haircut_bps) / U256::from(10_000u16)
        };

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
        let mut obs = nav::Observations {
            leverage_bps: nav::measured_leverage_bps(s.collateral_1e18, price, debt),
            ltv_bps: nav::measured_ltv_bps(s.collateral_1e18, price, debt),
            reserve_bps: nav::measured_reserve_bps(s.vault_usdc_balance, value),
            supply_apy_bps: nav::measured_supply_apy_bps(s.borrow_rate_wad, utilization_bps),
            hours_since_update: nav::hours_between(s.market_last_update, s.block_timestamp),
            /* Rewritten below once every check has run so callers see one
            finalised bag, not a partially-filled snapshot. */
            breach_flags: 0,
        };

        // Read the strategist's per-knob invariants and fail the cycle when
        // the measured observation breaches them. Each check is skipped when
        // the vault is not in a state the invariant applies to (no debt, no
        // NAV, no policy declared), so a freshly published vault attests
        // deterministically before any strategist action has landed.
        if let Some(raw) = cfg_opt("applied_leverage") {
            let configured_bps = nav::parse_decimal_bps(&raw)?;
            // 25% tolerance band: 2.5x published lets the position sit in
            // [1.875x, 3.125x] before the cycle refuses.
            nav::check_applied_leverage_drift(obs.leverage_bps, configured_bps, 2_500, debt)?;
        }
        if let Some(raw) = cfg_opt("hf_deleverage_bps") {
            let deleverage_bps: u32 = raw
                .trim()
                .parse()
                .map_err(|e| format!("bad hf_deleverage_bps in config: {e}"))?;
            if nav::check_deleverage_threshold(obs.ltv_bps, deleverage_bps, debt, lltv)? {
                breach_flags |= nav::BREACH_DELEVERAGE;
            }
        }
        if let Some(raw) = cfg_opt("reserve_fraction") {
            let floor_bps = nav::parse_decimal_bps(&raw)?;
            nav::check_reserve_floor(obs.reserve_bps, floor_bps, value)?;
        }
        if let Some(raw) = cfg_opt("compound_cadence_hours") {
            let cadence_hours: u32 = raw
                .trim()
                .parse()
                .map_err(|e| format!("bad compound_cadence_hours in config: {e}"))?;
            // Six-hour grace: a missed cron beat does not immediately kill
            // an otherwise healthy vault.
            nav::check_compound_cadence(obs.hours_since_update, cadence_hours, 6)?;
        }

        // Fold every guard's verdict into the observations bag so the vault
        // contract can decode `breachFlags != 0` and stop taking new
        // deposit / redeem requests (roadmap P00 #13). Non-fatal: the strike
        // still attests, downstream verifiers still see every reading.
        obs.breach_flags = breach_flags;

        // Compose the on-chain action plan the vault will dispatch after
        // NAV settlement. On breach we force an empty plan: the position
        // has drifted past what the strategist configured, and continuing
        // to lever up (or emit any other loop action) against a live guard
        // would be a lie of omission. Plan-deleverage lands in P1 #4 and
        // will replace the empty plan with an unwind step.
        let plan = if breach_flags != 0 {
            nav::PlanBuild::empty(s.block_timestamp)
        } else {
            build_action_plan(&s, debt, value, twap_price, price)?
        };

        Ok(nav::encode_payload(
            vault,
            value,
            s.inputs_block,
            config_hash(),
            obs,
            plan,
        ))
    }

    /// Decide the plan for this strike from state + composer knobs.
    /// Returns an empty plan when either the vault has no strategy to run
    /// (no `applied_leverage` configured), or is already at target, or has
    /// no free USDC to deploy.
    fn build_action_plan(
        s: &crate::adapters::ChainState,
        debt: U256,
        nav_value: U256,
        twap_price_1e24: U256,
        priced_collateral_1e24: U256,
    ) -> Result<nav::PlanBuild, String> {
        let vault = cfg_address("vault_address")?;
        let usdc = cfg_address("usdc_address")?;
        let usde = cfg_address("usde_address")?;
        let morpho = cfg_address("morpho_address")?;

        // Swap route: composer publishes address + tick spacing. Missing
        // either -> no plan (the vault has no way to swap).
        let swap_router = match cfg_opt("swap_router") {
            Some(v) => match v.trim().parse::<alloy_primitives::Address>() {
                Ok(a) => a,
                Err(_) => return Ok(nav::PlanBuild::empty(s.block_timestamp)),
            },
            None => return Ok(nav::PlanBuild::empty(s.block_timestamp)),
        };
        let tick_spacing: i32 = match cfg_opt("pool_tick_spacing") {
            Some(v) => v
                .trim()
                .parse()
                .map_err(|e| format!("bad pool_tick_spacing: {e}"))?,
            None => return Ok(nav::PlanBuild::empty(s.block_timestamp)),
        };

        // Redemption shortfall: how much USDC the plan must free so the
        // vault sits at or above the escrow floor after `_fulfillRedeems`
        // carves this strike's redemption claims out of `nav`. Mirrors the
        // vault's own bootstrap-price math so the two sides can't drift.
        let redeem_assets_out = if s.share_supply == 0 || s.total_pending_redeem_shares == 0 {
            U256::ZERO
        } else {
            // Fresh deposits are folded into NAV BEFORE redeems fulfill on
            // chain, so the effective NAV redeems price against is
            // `attested_nav + total_pending_deposit`. Using the pre-strike
            // share supply here overestimates by the deposit-minted shares —
            // conservative (frees a little more USDC than strictly needed),
            // so a small over-cushion is fine.
            let effective_nav = nav_value + U256::from(s.total_pending_deposit);
            U256::from(s.total_pending_redeem_shares) * effective_nav / U256::from(s.share_supply)
        };
        let post_strike_claimable = U256::from(s.total_claimable_redeem) + redeem_assets_out;
        let vault_balance = U256::from(s.vault_usdc_balance);
        let shortfall = if post_strike_claimable > vault_balance {
            post_strike_claimable - vault_balance
        } else {
            U256::ZERO
        };

        // Delever branch (roadmap P1 #4): shortfall > 0 means the strike
        // will breach the escrow floor unless the plan frees enough USDC.
        // Emit `plan_deleverage` — a single Morpho flashLoan step whose
        // callback repays + withdraws + swaps atomically. See
        // `contracts/src/PriimeVault.sol::onMorphoFlashLoan`.
        if !shortfall.is_zero() && !debt.is_zero() {
            let priced_collateral =
                nav::priced_collateral_usdc(s.collateral_1e18, priced_collateral_1e24);
            let equity = if priced_collateral > debt {
                priced_collateral - debt
            } else {
                // Debt already exceeds priced collateral: floor check should
                // have flagged this. Empty plan attests and lets the guard
                // surface it.
                return Ok(nav::PlanBuild::empty(s.block_timestamp));
            };
            if equity.is_zero() {
                return Ok(nav::PlanBuild::empty(s.block_timestamp));
            }
            /* Cushion scales with leverage. Swap slippage tolerated by
            `swap_min_usdc_out` is 50 bps of the GROSS collateral leg
            (`collateral_out_usde × price`), and that leg equals
            `proportion × priced_collateral ≈ target_free × L`. A flat
            1% cushion undershoots at L > ~2 (Khaled review, roadmap
            follow-up). Formula: 100 bps floor + 60 bps per unit of
            leverage. Landings: L=2.5 -> 250 bps, L=5 -> 400 bps,
            L=10 -> 700 bps. Bounded to u32 in leverage_bps ceiling. */
            let leverage_bps_u256 = priced_collateral * U256::from(10_000u16) / equity;
            let leverage_bps = u32::try_from(leverage_bps_u256).unwrap_or(u32::MAX);
            let cushion_bps = U256::from(100u64 + 60u64 * u64::from(leverage_bps) / 10_000u64);
            let target_free_usdc = shortfall + shortfall * cushion_bps / U256::from(10_000u16);
            let one_wad = U256::from(1_000_000_000_000_000_000u64);
            // proportion_wad = min(target_free / equity, 1.0).
            let proportion_wad = (target_free_usdc * one_wad / equity).min(one_wad);
            let collateral_out_usde = U256::from(s.collateral_1e18) * proportion_wad / one_wad;
            /* SHARES, not assets, on the repay leg. Morpho computes the
            exact assets pulled from `shares × total_borrow_assets /
            total_borrow_shares` at execution time, so interest that
            accrued between our inputs_block estimate and the vault's
            execution block is captured cleanly. Full unwind
            (proportion_wad = 1e18) sends the vault's entire
            `borrow_shares`, which zeroes debt exactly and lets
            `withdrawCollateral(full)` pass Morpho's LLTV check.
            Flashloan principal (`debt_repay_usdc`) covers the
            stale-estimate repay amount + a 20 bps cushion for accrual
            so `morpho.repay`'s allowance pull cannot underflow. */
            let shares_to_repay = U256::from(s.borrow_shares) * proportion_wad / one_wad;
            let debt_repay_usdc = debt * proportion_wad / one_wad
                + debt * proportion_wad / one_wad / U256::from(5_000u16); // + 20 bps
                                                                          // 50 bps against TWAP — same convention plan_open_position uses.
            let min_usdc_out = nav::swap_min_usdc_out(collateral_out_usde, twap_price_1e24, 50);
            let _ = (vault, usde, tick_spacing, swap_router); // reserved for future lever-up branch parity
            return Ok(nav::plan_deleverage(
                usdc,
                morpho,
                debt_repay_usdc,
                shares_to_repay,
                collateral_out_usde,
                min_usdc_out,
                s.block_timestamp + 300,
            ));
        }

        let configured_leverage_bps = match cfg_opt("applied_leverage") {
            Some(v) => nav::parse_decimal_bps(&v)?,
            None => return Ok(nav::PlanBuild::empty(s.block_timestamp)),
        };
        if configured_leverage_bps <= 10_000 {
            return Ok(nav::PlanBuild::empty(s.block_timestamp));
        }

        // Already-holding-a-position path: skip if measured leverage is
        // within 15% of target. Rebalancing (increase/deleverage) is a
        // follow-up plan shape we can add without changing the payload.
        if !debt.is_zero() {
            let measured =
                nav::measured_leverage_bps(s.collateral_1e18, priced_collateral_1e24, debt);
            let lo = configured_leverage_bps.saturating_sub(configured_leverage_bps / 7);
            let hi = configured_leverage_bps.saturating_add(configured_leverage_bps / 7);
            if measured >= lo && measured <= hi {
                return Ok(nav::PlanBuild::empty(s.block_timestamp));
            }
            return Ok(nav::PlanBuild::empty(s.block_timestamp));
        }

        // Deployable USDC = balance - reserved (pending deposits already
        // fulfill BEFORE the plan runs; claimable redeems are already
        // reserved). Fold-in of a fresh deposit lands as `nav_value` so use
        // that as the deployable ceiling.
        let usable_usdc = U256::from(nav_value.min(U256::from(s.vault_usdc_balance)));
        if usable_usdc < U256::from(1_000_000u64) {
            return Ok(nav::PlanBuild::empty(s.block_timestamp));
        }
        // Leave a 1% cushion so a small pool tick move between operator
        // read and vault execution does not push the swap under
        // amountOutMinimum.
        let deploy_amount = usable_usdc * U256::from(99u16) / U256::from(100u16);
        if deploy_amount < U256::from(1_000_000u64) {
            return Ok(nav::PlanBuild::empty(s.block_timestamp));
        }

        // Rebuild the market params tuple the plan encoder needs.
        let market_params: (
            alloy_primitives::Address,
            alloy_primitives::Address,
            alloy_primitives::Address,
            alloy_primitives::Address,
            U256,
        ) = (
            usdc,
            usde,
            cfg_address("oracle_address")?,
            cfg_address("irm_address")?,
            cfg("lltv")?.parse().map_err(|e| format!("bad lltv: {e}"))?,
        );

        // Slippage: 50 bps against the pinned TWAP. Deadline 300 s past
        // inputs_block_ts so a normal cron submission window fits.
        let plan = nav::plan_open_position(
            vault,
            usdc,
            usde,
            morpho,
            swap_router,
            tick_spacing,
            market_params,
            deploy_amount,
            twap_price_1e24,
            50,
            configured_leverage_bps,
            s.block_timestamp + 300,
        );
        Ok(plan)
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
