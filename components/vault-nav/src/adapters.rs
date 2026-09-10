//! Pinned-block chain reads for the NAV attestation (wasm32-only).
//!
//! Every read in a cycle is pinned to the same `inputs_block`, so all
//! operators observe one snapshot and produce identical bytes. Any RPC or
//! decode failure fails the cycle rather than attesting a guessed value.
//!
//! `inputs_block` itself is derived from the cron `trigger_time` (see
//! [`crate::blocks`]), NOT from this operator's chain head: the head is the
//! one input that differs between nodes, and a differing height means a
//! differing signed payload and a silently missed quorum.

use crate::blocks::resolve_inputs_block;
use crate::nav::effective_twap_window;
use alloy_primitives::{Address, FixedBytes, U256};
use alloy_provider::Provider;
use alloy_rpc_types::TransactionRequest;
use alloy_sol_macro::sol;
use alloy_sol_types::SolCall;
use wavs_wasi_utils::evm::new_evm_provider;
use wstd::runtime::block_on;

pub type AdapterResult<T> = Result<T, String>;

sol! {
    function position(bytes32 id, address user) external view returns (
        uint256 supplyShares, uint128 borrowShares, uint128 collateral
    );
    function market(bytes32 id) external view returns (
        uint128 totalSupplyAssets, uint128 totalSupplyShares,
        uint128 totalBorrowAssets, uint128 totalBorrowShares,
        uint128 lastUpdate, uint128 fee
    );
    function borrowRateView(
        (address, address, address, address, uint256) marketParams,
        (uint128, uint128, uint128, uint128, uint128, uint128) marketState
    ) external view returns (uint256);
    function observe(uint32[] secondsAgos) external view returns (
        int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128s
    );
    // Aerodrome Slipstream CLPool keeps Uniswap v3's observation layout, but
    // its Slot0 drops v3's `feeProtocol` (protocol/unstaked fees live
    // elsewhere), so this is six fields, not seven. Verified against the
    // live pool: slot0() returns exactly six words.
    function slot0() external view returns (
        uint160 sqrtPriceX96, int24 tick, uint16 observationIndex,
        uint16 observationCardinality, uint16 observationCardinalityNext,
        bool unlocked
    );
    function observations(uint256 index) external view returns (
        uint32 blockTimestamp, int56 tickCumulative,
        uint160 secondsPerLiquidityCumulativeX128, bool initialized
    );
    function balanceOf(address account) external view returns (uint256);
    function totalPendingDepositAssets() external view returns (uint256);
    function totalClaimableRedeemAssets() external view returns (uint256);
}

/// Everything the NAV computation needs, read at one block.
pub struct ChainState {
    pub inputs_block: u64,
    /// Timestamp of `inputs_block` (drives interest accrual).
    pub block_timestamp: u64,
    pub borrow_shares: u128,
    pub collateral_1e18: u128,
    pub total_borrow_assets: u128,
    pub total_supply_assets: u128,
    pub total_borrow_shares: u128,
    pub market_last_update: u64,
    /// IRM average borrow rate, WAD per second, at `inputs_block`.
    pub borrow_rate_wad: u128,
    /// Pool tick cumulatives at [now - window, now] as of `inputs_block`,
    /// where `window` is [`ChainState::twap_window_effective_secs`].
    pub tick_cum_old: i64,
    pub tick_cum_new: i64,
    /// The TWAP window actually observed: the configured
    /// `twap_window_secs` clamped to the age of the pool's oldest
    /// initialized observation, and never below
    /// [`crate::nav::MIN_TWAP_WINDOW_SECS`] (a shorter clamp fails the
    /// cycle instead of attesting on a near-spot price). Must be the
    /// divisor in `avg_tick`.
    pub twap_window_effective_secs: u32,
    pub vault_usdc_balance: u128,
    pub total_pending_deposit: u128,
    pub total_claimable_redeem: u128,
}

/// Addresses and parameters from workflow config.
pub struct ReadTargets {
    pub morpho: Address,
    pub market_id: FixedBytes<32>,
    /// MarketParams tuple: (loan, collateral, oracle, irm, lltv).
    pub market_params: (Address, Address, Address, Address, U256),
    pub irm: Address,
    pub pool: Address,
    pub usdc: Address,
    pub vault: Address,
    pub twap_window_secs: u32,
    pub inputs_block_lag: u64,
}

fn u128_of(v: U256, what: &str) -> AdapterResult<u128> {
    v.try_into()
        .map_err(|_| format!("{what} overflows u128: {v}"))
}

/// Read the full snapshot. Derives `inputs_block` from the cron
/// `trigger_time_secs` (the one value every operator in the quorum shares),
/// applies `inputs_block_lag` for reorg depth, then pins every call to it.
pub fn fetch_state(
    rpc_url: String,
    t: &ReadTargets,
    trigger_time_secs: u64,
) -> AdapterResult<ChainState> {
    block_on(async move {
        let provider = new_evm_provider::<alloy_network::Ethereum>(rpc_url);

        // Header timestamp lookup, shared by the block search below and the
        // snapshot pin. Borrows the provider rather than moving it so the
        // returned future outlives the call (same idiom as `call`).
        let timestamp_of = |n: u64| {
            let provider = &provider;
            async move {
                provider
                    .get_block_by_number(n.into())
                    .await
                    .map_err(|e| format!("get_block {n} failed: {e}"))?
                    .ok_or_else(|| format!("block {n} not found"))
                    .map(|b| b.header.timestamp)
            }
        };

        // The cron fires at a wall-clock boundary the chain has usually not
        // minted past yet: at trigger second N the newest block's timestamp
        // is N minus zero-to-block-time. That is not an error, it is a race
        // the component must wait out (bounded well inside the workflow's
        // 30s time limit); failing immediately would kill essentially every
        // cycle on a 2s chain. Determinism is unaffected: blocks.rs still
        // requires head_ts >= trigger_time before it finalizes the answer,
        // this loop only gives the chain time to get there.
        let mut latest = 0u64;
        for attempt in 0..30u32 {
            if attempt > 0 {
                wstd::task::sleep(wstd::time::Duration::from_millis(500)).await;
            }
            latest = provider
                .get_block_number()
                .await
                .map_err(|e| format!("get_block_number failed: {e}"))?;
            if timestamp_of(latest).await? >= trigger_time_secs {
                break;
            }
        }
        let inputs_block =
            resolve_inputs_block(latest, trigger_time_secs, t.inputs_block_lag, &timestamp_of)
                .await?;

        let block_timestamp = timestamp_of(inputs_block).await?;

        let call = |to: Address, data: Vec<u8>| {
            let provider = &provider;
            async move {
                provider
                    .call(TransactionRequest::default().to(to).input(data.into()))
                    .number(inputs_block)
                    .await
                    .map_err(|e| format!("eth_call to {to} @ {inputs_block} failed: {e}"))
            }
        };

        let pos_raw = call(
            t.morpho,
            positionCall {
                id: t.market_id,
                user: t.vault,
            }
            .abi_encode(),
        )
        .await?;
        let pos = positionCall::abi_decode_returns(&pos_raw)
            .map_err(|e| format!("decode position failed: {e}"))?;

        let mkt_raw = call(t.morpho, marketCall { id: t.market_id }.abi_encode()).await?;
        let mkt = marketCall::abi_decode_returns(&mkt_raw)
            .map_err(|e| format!("decode market failed: {e}"))?;

        let rate_raw = call(
            t.irm,
            borrowRateViewCall {
                marketParams: t.market_params,
                marketState: (
                    mkt.totalSupplyAssets,
                    mkt.totalSupplyShares,
                    mkt.totalBorrowAssets,
                    mkt.totalBorrowShares,
                    mkt.lastUpdate,
                    mkt.fee,
                ),
            }
            .abi_encode(),
        )
        .await?;
        let rate = borrowRateViewCall::abi_decode_returns(&rate_raw)
            .map_err(|e| format!("decode borrowRateView failed: {e}"))?;

        // The pool's observation ring may be younger than the configured TWAP
        // window: `increaseObservationCardinalityNext` allocates slots but
        // nothing backfills them, and the mainnet pool sits at cardinality 1
        // at the fork pin. Asking `observe` for a secondsAgo older than the
        // oldest initialized observation reverts (`OLD`), which would kill
        // bring-up with an opaque eth_call error. Clamp instead - but only
        // down to a floor: a clamp that eats too much of the window turns
        // the "average" into a near-spot price, which is cheap to move for
        // the one block this cycle reads. Below that floor the cycle must
        // fail, not attest on it.
        let slot0_raw = call(t.pool, slot0Call {}.abi_encode()).await?;
        let slot0 = slot0Call::abi_decode_returns(&slot0_raw)
            .map_err(|e| format!("decode slot0 failed: {e}"))?;
        if slot0.observationCardinality == 0 {
            return Err("pool observation cardinality is zero".to_string());
        }
        // Uniswap v3 ring convention: the newest observation sits at
        // `observationIndex`, so the oldest is the next slot round the ring.
        // While the ring is still growing that slot is uninitialized and
        // index 0 holds the oldest one (widen to u32 first: the +1 would wrap
        // a u16 index of 65535).
        let oldest_index =
            (u32::from(slot0.observationIndex) + 1) % u32::from(slot0.observationCardinality);
        let read_obs = |index: u32| {
            let call = &call;
            async move {
                let raw = call(
                    t.pool,
                    observationsCall {
                        index: U256::from(index),
                    }
                    .abi_encode(),
                )
                .await?;
                observationsCall::abi_decode_returns(&raw)
                    .map_err(|e| format!("decode observations({index}) failed: {e}"))
            }
        };
        let mut oldest = read_obs(oldest_index).await?;
        if !oldest.initialized {
            oldest = read_obs(0).await?;
            if !oldest.initialized {
                return Err("pool has no initialized observation".to_string());
            }
        }
        // Observation clocks are uint32 (Uniswap's truncated timestamp), so
        // the age is computed in that width, wrapping exactly as the pool
        // does. The `as` cast truncates rather than overflowing.
        let observable_secs = (block_timestamp as u32).wrapping_sub(oldest.blockTimestamp);
        let twap_window_effective_secs = effective_twap_window(t.twap_window_secs, observable_secs)
            .map_err(|e| {
                format!(
                    "{e} (oldest observation timestamp {}, inputs_block {inputs_block}, block \
                     timestamp {block_timestamp}); if observable is the smaller input the \
                     observation ring needs more time to fill after \
                     increaseObservationCardinalityNext",
                    oldest.blockTimestamp
                )
            })?;

        let obs_raw = call(
            t.pool,
            observeCall {
                secondsAgos: vec![twap_window_effective_secs, 0],
            }
            .abi_encode(),
        )
        .await?;
        let obs = observeCall::abi_decode_returns(&obs_raw)
            .map_err(|e| format!("decode observe failed: {e}"))?;
        if obs.tickCumulatives.len() != 2 {
            return Err(format!(
                "observe returned {} cumulatives, want 2",
                obs.tickCumulatives.len()
            ));
        }

        let bal_raw = call(t.usdc, balanceOfCall { account: t.vault }.abi_encode()).await?;
        let bal = balanceOfCall::abi_decode_returns(&bal_raw)
            .map_err(|e| format!("decode balanceOf failed: {e}"))?;

        let pend_raw = call(t.vault, totalPendingDepositAssetsCall {}.abi_encode()).await?;
        let pending = totalPendingDepositAssetsCall::abi_decode_returns(&pend_raw)
            .map_err(|e| format!("decode totalPendingDepositAssets failed: {e}"))?;

        let claim_raw = call(t.vault, totalClaimableRedeemAssetsCall {}.abi_encode()).await?;
        let claimable = totalClaimableRedeemAssetsCall::abi_decode_returns(&claim_raw)
            .map_err(|e| format!("decode totalClaimableRedeemAssets failed: {e}"))?;

        Ok(ChainState {
            inputs_block,
            block_timestamp,
            borrow_shares: pos.borrowShares,
            collateral_1e18: pos.collateral,
            total_borrow_assets: mkt.totalBorrowAssets,
            total_supply_assets: mkt.totalSupplyAssets,
            total_borrow_shares: mkt.totalBorrowShares,
            market_last_update: mkt
                .lastUpdate
                .try_into()
                .map_err(|_| "market lastUpdate overflows u64".to_string())?,
            borrow_rate_wad: u128_of(rate, "borrow rate")?,
            tick_cum_old: obs.tickCumulatives[0].as_i64(),
            tick_cum_new: obs.tickCumulatives[1].as_i64(),
            twap_window_effective_secs,
            vault_usdc_balance: u128_of(bal, "vault USDC balance")?,
            total_pending_deposit: u128_of(pending, "totalPendingDepositAssets")?,
            total_claimable_redeem: u128_of(claimable, "totalClaimableRedeemAssets")?,
        })
    })
}
