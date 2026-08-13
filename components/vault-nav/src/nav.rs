//! Pure NAV math for the vault-nav component. Host-testable: no WIT, no RPC.
//!
//! Conventions (must stay in lockstep with PriimeVault and the Morpho market):
//! - Collateral USDe is 18 decimals; loan USDC is 6 decimals.
//! - Prices use the Morpho oracle scale for this market: 1e24 (36 + 6 - 18).
//!   Collateral value in USDC base units = collateral_1e18 * price_1e24 / 1e36.
//! - Collateral is priced at min(par, pool TWAP): par is 1 USDC per USDe
//!   (1e24 in oracle scale), the TWAP comes from the Aerodrome Slipstream
//!   pool's tick cumulatives at `inputs_block`.
//! - Debt uses Morpho share math: interest accrued since `lastUpdate` via
//!   the IRM's Taylor-compounded rate, then shares -> assets rounded UP
//!   (virtual shares 1e6, virtual assets 1), so debt is never understated.
//! - Attested NAV = collateral value + folded idle USDC - debt, floored at
//!   zero. Idle USDC counts only above the escrow floor
//!   (totalPendingDepositAssets + totalClaimableRedeemAssets); a balance
//!   below the floor fails the cycle instead of attesting a wrong number.

use alloy_primitives::{Address, U256, U512};
use alloy_sol_types::{sol, SolValue};

/// WAD (1e18), the fixed-point base of Morpho rate math.
pub const WAD: u128 = 1_000_000_000_000_000_000;
/// Par price of USDe in USDC at the market's oracle scale (1e24 = $1.00).
pub const PAR_PRICE_1E24: u128 = 1_000_000_000_000_000_000_000_000;
/// Morpho virtual borrow shares.
const VIRTUAL_SHARES: u128 = 1_000_000;
/// Morpho virtual borrow assets.
const VIRTUAL_ASSETS: u128 = 1;

sol! {
    /// The exact bytes every operator signs and PriimeVault decodes:
    /// abi.encode(handler, nav, inputsBlock). The handler field binds the
    /// envelope to its intended receiver (PriimeVault guard zero).
    struct BoundNavResult {
        address handler;
        uint256 nav;
        uint256 inputsBlock;
    }
}

/// Morpho `toAssetsUp`: borrow shares to assets, rounded up, with the
/// virtual-shares convention. Zero shares is zero assets.
pub fn borrow_assets_up(
    borrow_shares: u128,
    total_borrow_assets: U256,
    total_borrow_shares: u128,
) -> U256 {
    if borrow_shares == 0 {
        return U256::ZERO;
    }
    let numerator = U256::from(borrow_shares) * (total_borrow_assets + U256::from(VIRTUAL_ASSETS));
    let denominator = U256::from(total_borrow_shares + VIRTUAL_SHARES);
    (numerator + denominator - U256::from(1u8)) / denominator
}

/// Total borrow assets with interest accrued since the market's `lastUpdate`,
/// per Morpho's `wTaylorCompounded` (3-term Taylor of e^x - 1, rounded down):
/// x = rate_per_second_wad * elapsed_secs.
pub fn accrued_total_borrow(
    total_borrow_assets: u128,
    borrow_rate_wad_per_sec: u128,
    elapsed_secs: u64,
) -> U256 {
    let tba = U256::from(total_borrow_assets);
    let wad = U256::from(WAD);
    // Morpho MathLib.wTaylorCompounded(rate, elapsed).
    let first = U256::from(borrow_rate_wad_per_sec) * U256::from(elapsed_secs);
    let second = first * first / (U256::from(2u8) * wad);
    let third = second * first / (U256::from(3u8) * wad);
    let taylor = first + second + third;
    // interest = tba.wMulDown(taylor)
    tba + tba * taylor / wad
}

/// Time-weighted average tick from two tick cumulatives `window_secs` apart,
/// floored toward negative infinity (the Uniswap v3 observe convention).
pub fn avg_tick(tick_cum_old: i64, tick_cum_new: i64, window_secs: u32) -> Result<i32, String> {
    if window_secs == 0 {
        return Err("TWAP window must be non-zero".to_string());
    }
    let delta = tick_cum_new - tick_cum_old;
    let window = i64::from(window_secs);
    let mut tick = delta / window;
    // Floor toward negative infinity, matching the on-chain observe convention.
    if delta < 0 && delta % window != 0 {
        tick -= 1;
    }
    i32::try_from(tick).map_err(|_| format!("average tick {tick} out of i32 range"))
}

/// Canonical Uniswap v3 sqrt ratio at a tick, Q64.96. Errors outside
/// [-887272, 887272].
pub fn sqrt_ratio_x96_at_tick(tick: i32) -> Result<U256, String> {
    const MAX_TICK: i32 = 887_272;
    if !(-MAX_TICK..=MAX_TICK).contains(&tick) {
        return Err(format!("tick {tick} outside [{}, {MAX_TICK}]", -MAX_TICK));
    }
    let abs_tick = tick.unsigned_abs();

    // Canonical Uniswap v3 TickMath: Q128.128 ratio assembled from
    // precomputed sqrt(1.0001)^(2^i) factors, one per set bit of |tick|.
    const FACTORS: [(u32, &str); 19] = [
        (0x2, "fff97272373d413259a46990580e213a"),
        (0x4, "fff2e50f5f656932ef12357cf3c7fdcc"),
        (0x8, "ffe5caca7e10e4e61c3624eaa0941cd0"),
        (0x10, "ffcb9843d60f6159c9db58835c926644"),
        (0x20, "ff973b41fa98c081472e6896dfb254c0"),
        (0x40, "ff2ea16466c96a3843ec78b326b52861"),
        (0x80, "fe5dee046a99a2a811c461f1969c3053"),
        (0x100, "fcbe86c7900a88aedcffc83b479aa3a4"),
        (0x200, "f987a7253ac413176f2b074cf7815e54"),
        (0x400, "f3392b0822b70005940c7a398e4b70f3"),
        (0x800, "e7159475a2c29b7443b29c7fa6e889d9"),
        (0x1000, "d097f3bdfd2022b8845ad8f792aa5825"),
        (0x2000, "a9f746462d870fdf8a65dc1f90e061e5"),
        (0x4000, "70d869a156d2a1b890bb3df62baf32f7"),
        (0x8000, "31be135f97d08fd981231505542fcfa6"),
        (0x10000, "9aa508b5b7a84e1c677de54f3e99bc9"),
        (0x20000, "5d6af8dedb81196699c329225ee604"),
        (0x40000, "2216e584f5fa1ea926041bedfe98"),
        (0x80000, "48a170391f7dc42444e8fa2"),
    ];

    let mut ratio: U256 = if abs_tick & 1 != 0 {
        U256::from_str_radix("fffcb933bd6fad37aa2d162d1a594001", 16).unwrap()
    } else {
        U256::from(1u8) << 128
    };
    for (bit, factor) in FACTORS {
        if abs_tick & bit != 0 {
            ratio = (ratio * U256::from_str_radix(factor, 16).unwrap()) >> 128;
        }
    }
    if tick > 0 {
        ratio = U256::MAX / ratio;
    }
    // Q128.128 -> Q64.96, rounding up.
    let rounder = if ratio & ((U256::from(1u8) << 32) - U256::from(1u8)) == U256::ZERO {
        U256::ZERO
    } else {
        U256::from(1u8)
    };
    Ok((ratio >> 32) + rounder)
}

/// Pool price at a tick in the market's 1e24 oracle scale (USDC base units
/// per 1e18 USDe, times 1e18): price_1e24 = sqrtP^2 * 1e36 / 2^192.
/// Token order fixed by address sort: token0 = USDe, token1 = USDC.
pub fn price_1e24_at_tick(tick: i32) -> Result<U256, String> {
    let sqrt_p = sqrt_ratio_x96_at_tick(tick)?;
    // sqrtP^2 needs up to 320 bits; widen before the multiply.
    let sq = U512::from(sqrt_p) * U512::from(sqrt_p);
    let scaled: U512 = (sq * U512::from(10u8).pow(U512::from(36u8))) >> 192usize;
    if scaled > U512::from(U256::MAX) {
        return Err(format!("price at tick {tick} overflows U256"));
    }
    Ok(scaled.saturating_to::<U256>())
}

/// Collateral valuation price: min(par, TWAP). Attests through par only when
/// the pool agrees USDe is worth at least $1.
pub fn bounded_price_1e24(twap_price_1e24: U256) -> U256 {
    twap_price_1e24.min(U256::from(PAR_PRICE_1E24))
}

/// Attested NAV in USDC base units. Errors if the vault's idle balance is
/// below the escrow floor (pending deposits + claimable redemptions); floors
/// at zero if debt exceeds assets.
pub fn nav_usdc(
    collateral_1e18: u128,
    price_1e24: U256,
    debt_usdc: U256,
    usdc_balance: u128,
    total_pending_deposit: u128,
    total_claimable_redeem: u128,
) -> Result<U256, String> {
    let floor = total_pending_deposit as u128 + total_claimable_redeem as u128;
    let folded_idle = usdc_balance.checked_sub(floor).ok_or_else(|| {
        format!("escrow floor breached: idle {usdc_balance} < pending+claimable {floor}")
    })?;
    let collateral_value =
        U256::from(collateral_1e18) * price_1e24 / U256::from(10u8).pow(U256::from(36u8));
    Ok((collateral_value + U256::from(folded_idle)).saturating_sub(debt_usdc))
}

/// The signed payload bytes: abi.encode(handler, nav, inputsBlock).
pub fn encode_payload(handler: Address, nav: U256, inputs_block: u64) -> Vec<u8> {
    BoundNavResult { handler, nav, inputsBlock: U256::from(inputs_block) }.abi_encode()
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy_primitives::address;

    // --- borrow share math -------------------------------------------------

    #[test]
    fn borrow_assets_zero_shares_is_zero() {
        assert_eq!(borrow_assets_up(0, U256::from(1_000_000_000u128), 5_000_000), U256::ZERO);
    }

    #[test]
    fn borrow_assets_rounds_up() {
        // shares * (tba + 1) / (tbs + 1e6) = 3 * 1001 / 2e6 = 0.0015 -> ceil 1.
        assert_eq!(borrow_assets_up(3, U256::from(1_000u128), 1_000_000), U256::from(1u8));
        // Exact division must NOT round up: 1e6 * (1_999_999 + 1) / (1e6 + 1e6) = 1_000_000.
        assert_eq!(
            borrow_assets_up(1_000_000, U256::from(1_999_999u128), 1_000_000),
            U256::from(1_000_000u128)
        );
    }

    #[test]
    fn borrow_assets_matches_loop_script_formula() {
        // Same numbers the loop-entry script computes with bc:
        // (bs*(tba+1) + (tbs+1e6) - 1) / (tbs+1e6).
        let bs = 1_907_226_640_495u128;
        let tba = 30_363_672_594_546u128;
        let tbs = 28_968_098_704_951_882u128;
        let expected = (bs * (tba + 1) + (tbs + 1_000_000) - 1) / (tbs + 1_000_000);
        assert_eq!(borrow_assets_up(bs, U256::from(tba), tbs), U256::from(expected));
    }

    // --- interest accrual ---------------------------------------------------

    #[test]
    fn accrual_zero_rate_or_elapsed_is_identity() {
        assert_eq!(accrued_total_borrow(1_000_000, 0, 3600), U256::from(1_000_000u128));
        assert_eq!(
            accrued_total_borrow(1_000_000, 31_709_791_983, 0),
            U256::from(1_000_000u128)
        );
    }

    #[test]
    fn accrual_bounded_between_linear_and_exponential() {
        // 100% APR for one year: x = 1 WAD. Taylor(1) = 1 + 1/2 + 1/6 = 5/3.
        // Accrued must be >= linear (1 + x) and < exact exponential (e^x).
        let tba = 1_000_000_000_000u128; // $1M in USDC 6-dec
        let rate = WAD / 31_536_000; // 1e18 per year, per-second
        let secs = 31_536_000u64;
        let accrued = accrued_total_borrow(tba, rate, secs);
        let linear = U256::from(tba + tba); // 1 + x with x = 1
        let exp = U256::from(tba * 27_183 / 10_000); // e^1 = 2.7183
        assert!(accrued >= linear, "3-term Taylor must dominate linear: {accrued}");
        assert!(accrued < exp, "Taylor must stay below exact e^x: {accrued}");
    }

    // --- TWAP tick math -----------------------------------------------------

    #[test]
    fn avg_tick_exact_division() {
        assert_eq!(avg_tick(0, -552_648_000, 2000).unwrap(), -276_324);
    }

    #[test]
    fn avg_tick_floors_toward_negative_infinity() {
        // delta = -7 over 2s: -3.5 must floor to -4, not truncate to -3.
        assert_eq!(avg_tick(0, -7, 2).unwrap(), -4);
        // Positive remainder truncates down as usual: 7/2 -> 3.
        assert_eq!(avg_tick(0, 7, 2).unwrap(), 3);
    }

    #[test]
    fn avg_tick_zero_window_errors() {
        assert!(avg_tick(0, 1, 0).is_err());
    }

    #[test]
    fn sqrt_ratio_matches_canonical_vectors() {
        // Known TickMath outputs.
        assert_eq!(sqrt_ratio_x96_at_tick(0).unwrap(), U256::from(1u8) << 96);
        assert_eq!(
            sqrt_ratio_x96_at_tick(1).unwrap(),
            U256::from(79_232_123_823_359_799_118_286_999_568u128)
        );
        assert_eq!(sqrt_ratio_x96_at_tick(-887_272).unwrap(), U256::from(4_295_128_739u64));
        assert!(sqrt_ratio_x96_at_tick(887_273).is_err());
    }

    #[test]
    fn price_at_parity_tick_is_close_to_par() {
        // USDe/USDC parity sits at tick ~ -276324 (1.0001^t = 1e-12).
        let p = price_1e24_at_tick(-276_324).unwrap();
        let par = U256::from(PAR_PRICE_1E24);
        assert!(p > par * U256::from(995u64) / U256::from(1000u64), "{p}");
        assert!(p < par * U256::from(1005u64) / U256::from(1000u64), "{p}");
        // Lower tick = cheaper USDe.
        assert!(price_1e24_at_tick(-276_424).unwrap() < p);
    }

    #[test]
    fn price_at_tick_zero_is_1e36() {
        assert_eq!(
            price_1e24_at_tick(0).unwrap(),
            U256::from(10u8).pow(U256::from(36u8))
        );
    }

    // --- min(par, TWAP) -----------------------------------------------------

    #[test]
    fn bounded_price_caps_at_par() {
        let above = U256::from(PAR_PRICE_1E24 + 12_345);
        assert_eq!(bounded_price_1e24(above), U256::from(PAR_PRICE_1E24));
    }

    #[test]
    fn bounded_price_passes_depeg_through() {
        // A 5% depeg must NOT be papered over to par.
        let depeg = U256::from(PAR_PRICE_1E24 * 95 / 100);
        assert_eq!(bounded_price_1e24(depeg), depeg);
    }

    // --- NAV assembly -------------------------------------------------------

    #[test]
    fn nav_is_collateral_value_plus_folded_idle_minus_debt() {
        // 2499.027723 USDe at par, debt 1999.228459, no idle: the loop-entry
        // position. NAV = 2499.027723 - 1999.228459 = 499.799264.
        let nav = nav_usdc(
            2_499_027_723_000_000_000_000u128,
            U256::from(PAR_PRICE_1E24),
            U256::from(1_999_228_459u128),
            0,
            0,
            0,
        )
        .unwrap();
        assert_eq!(nav, U256::from(499_799_264u128));
    }

    #[test]
    fn nav_counts_only_idle_above_escrow_floor() {
        // balance 1500, pending 400, claimable 100 -> folded idle 1000.
        let nav = nav_usdc(
            0,
            U256::from(PAR_PRICE_1E24),
            U256::ZERO,
            1_500_000_000,
            400_000_000,
            100_000_000,
        )
        .unwrap();
        assert_eq!(nav, U256::from(1_000_000_000u128));
    }

    #[test]
    fn nav_floors_collateral_value() {
        // 1 wei of USDe at par is < 1 USDC base unit -> floors to 0, never 1.
        let nav = nav_usdc(1, U256::from(PAR_PRICE_1E24), U256::ZERO, 0, 0, 0).unwrap();
        assert_eq!(nav, U256::ZERO);
    }

    #[test]
    fn nav_escrow_breach_fails_the_cycle() {
        // balance below the escrow floor: attesting anything would be wrong.
        assert!(nav_usdc(0, U256::from(PAR_PRICE_1E24), U256::ZERO, 99, 100, 0).is_err());
    }

    #[test]
    fn nav_insolvency_clamps_to_zero() {
        let nav = nav_usdc(
            1_000_000_000_000_000_000, // 1 USDe
            U256::from(PAR_PRICE_1E24),
            U256::from(5_000_000u128), // debt $5 > collateral $1
            0,
            0,
            0,
        )
        .unwrap();
        assert_eq!(nav, U256::ZERO);
    }

    // --- payload ------------------------------------------------------------

    #[test]
    fn payload_is_three_abi_words_bound_to_handler() {
        let handler = address!("73BB3CE07d25057A9265B476E80c08CBbA5d80d9");
        let bytes = encode_payload(handler, U256::from(500_000_000u64), 49_911_282);
        assert_eq!(bytes.len(), 96);
        // Word 0: handler left-padded to 32 bytes.
        assert_eq!(&bytes[0..12], &[0u8; 12]);
        assert_eq!(&bytes[12..32], handler.as_slice());
        // Word 1: nav.
        assert_eq!(U256::from_be_slice(&bytes[32..64]), U256::from(500_000_000u64));
        // Word 2: inputs block.
        assert_eq!(U256::from_be_slice(&bytes[64..96]), U256::from(49_911_282u64));
    }
}
