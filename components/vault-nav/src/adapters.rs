//! Pinned-block chain reads for the NAV attestation (wasm32-only).
//!
//! Every read in a cycle is pinned to the same `inputs_block`, so all
//! operators observe one snapshot and produce identical bytes. Any RPC or
//! decode failure fails the cycle rather than attesting a guessed value.

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
    pub total_borrow_shares: u128,
    pub market_last_update: u64,
    /// IRM average borrow rate, WAD per second, at `inputs_block`.
    pub borrow_rate_wad: u128,
    /// Pool tick cumulatives at [now - window, now] as of `inputs_block`.
    pub tick_cum_old: i64,
    pub tick_cum_new: i64,
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
    v.try_into().map_err(|_| format!("{what} overflows u128: {v}"))
}

/// Read the full snapshot. Self-determines `inputs_block` as the chain head
/// minus the configured lag (cron triggers carry no height), then pins every
/// call to it.
pub fn fetch_state(rpc_url: String, t: &ReadTargets) -> AdapterResult<ChainState> {
    block_on(async move {
        let provider = new_evm_provider::<alloy_network::Ethereum>(rpc_url);

        let latest = provider
            .get_block_number()
            .await
            .map_err(|e| format!("get_block_number failed: {e}"))?;
        let inputs_block = latest
            .checked_sub(t.inputs_block_lag)
            .ok_or_else(|| format!("chain head {latest} below inputs_block_lag"))?;

        let block = provider
            .get_block_by_number(inputs_block.into())
            .await
            .map_err(|e| format!("get_block {inputs_block} failed: {e}"))?
            .ok_or_else(|| format!("block {inputs_block} not found"))?;
        let block_timestamp = block.header.timestamp;

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

        let pos_raw =
            call(t.morpho, positionCall { id: t.market_id, user: t.vault }.abi_encode()).await?;
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

        let obs_raw = call(
            t.pool,
            observeCall { secondsAgos: vec![t.twap_window_secs, 0] }.abi_encode(),
        )
        .await?;
        let obs = observeCall::abi_decode_returns(&obs_raw)
            .map_err(|e| format!("decode observe failed: {e}"))?;
        if obs.tickCumulatives.len() != 2 {
            return Err(format!("observe returned {} cumulatives, want 2", obs.tickCumulatives.len()));
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
            total_borrow_shares: mkt.totalBorrowShares,
            market_last_update: mkt
                .lastUpdate
                .try_into()
                .map_err(|_| "market lastUpdate overflows u64".to_string())?,
            borrow_rate_wad: u128_of(rate, "borrow rate")?,
            tick_cum_old: obs.tickCumulatives[0].as_i64(),
            tick_cum_new: obs.tickCumulatives[1].as_i64(),
            vault_usdc_balance: u128_of(bal, "vault USDC balance")?,
            total_pending_deposit: u128_of(pending, "totalPendingDepositAssets")?,
            total_claimable_redeem: u128_of(claimable, "totalClaimableRedeemAssets")?,
        })
    })
}
