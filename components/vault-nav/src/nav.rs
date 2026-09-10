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

use alloy_primitives::{Address, FixedBytes, U256, U512};
use alloy_sol_types::{sol, SolCall, SolValue};

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
    /// abi.encode(handler, nav, inputsBlock, configHash, observations...).
    ///
    /// - `handler` binds the envelope to its intended receiver (PriimeVault
    ///   guard zero).
    /// - `configHash` is keccak256(canonical config bytes) where the canonical
    ///   form is the concatenation of every workflow config key/value pair in
    ///   lexicographic order of key, encoded as `key=value\n`. Any operator
    ///   running a divergent config produces a different hash, its result
    ///   hash diverges, and the quorum outvotes it.
    /// - The remaining fields are per-strike observations every operator
    ///   independently measures at `inputs_block`. They are what the
    ///   composer's non-cycle-affecting knobs bind against: a user picking
    ///   `applied_leverage=2.5` gets `leverageBps` attested against the
    ///   position's actual leverage, and a divergent operator running a
    ///   different market snapshot produces a different value here. All
    ///   values are deterministic from chain state at `inputs_block`.
    struct BoundNavResult {
        address handler;
        uint256 nav;
        uint256 inputsBlock;
        bytes32 configHash;
        /// Measured leverage: debt_usdc * 10_000 / (par_collateral_usdc - debt_usdc).
        /// Zero when there is no debt; saturates at u32::MAX above equity.
        uint32 leverageBps;
        /// Measured LTV: debt_usdc * 10_000 / par_collateral_usdc.
        /// Zero when there is no collateral. The floor check uses the same
        /// number in a wider integer; this is the u32 for downstream display.
        uint32 ltvBps;
        /// USDC reserve fraction: vault_usdc_balance * 10_000 / nav_usdc.
        /// Zero when the vault is empty. Above 10_000 when nav < reserve.
        uint32 reserveBps;
        /// Annualized supply APY in bps: borrow_rate * seconds_per_year *
        /// utilization, all in bps.
        uint32 supplyApyBps;
        /// Hours between the market's last accrual and `inputs_block`. A
        /// stale market means the strike is measuring an old snapshot.
        uint32 hoursSinceUpdate;
        /// Quorum-signed on-chain action batch the vault dispatches AFTER
        /// NAV settlement. Empty when the component chose to hold. Each
        /// operator running the same config computes identical bytes here;
        /// a divergent target or calldata means a divergent hash and the
        /// quorum outvotes it. Vault enforces target whitelist + escrow
        /// floor at execution time.
        StrategyPlan plan;
    }

    struct StrategyPlan {
        address[] targets;
        bytes[] calldatas;
        uint256 timestamp;
    }
}

sol! {
    // Call-site ABIs the operator quorum encodes into StrategyPlan calldatas.
    // Nothing here is called from Rust; the sol! macro just emits abi encoders
    // for each selector so a two-line change to a target signature would fail
    // to compile against these.
    function approve(address spender, uint256 amount) external returns (bool);

    struct MorphoMarketParams {
        address loanToken;
        address collateralToken;
        address oracle;
        address irm;
        uint256 lltv;
    }
    function supplyCollateral(
        MorphoMarketParams marketParams,
        uint256 assets,
        address onBehalf,
        bytes data
    ) external;
    function borrow(
        MorphoMarketParams marketParams,
        uint256 assets,
        uint256 shares,
        address onBehalf,
        address receiver
    ) external returns (uint256, uint256);

    struct AerodromeExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        int24 tickSpacing;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(AerodromeExactInputSingleParams params)
        external payable returns (uint256 amountOut);
}

/// Convert a USDC amount into the minimum USDe base-units the operator will
/// accept from the USDC->USDe swap at the current TWAP. `slippage_bps` is
/// the maximum deviation below TWAP the operator will tolerate; every
/// operator computing the same TWAP + slippage produces identical bytes.
/// USDC has 6 decimals, USDe has 18; the scale factor is 1e12.
pub fn swap_min_usde_out(usdc_in: U256, twap_price_1e24: U256, slippage_bps: u32) -> U256 {
    // out = usdc_in * (1e18 base per unit) / (price in USDC-per-USDe base scale)
    //     = usdc_in * 1e36 / price_1e24
    // Then trim by (10000 - slippage_bps) / 10000.
    if twap_price_1e24.is_zero() {
        return U256::ZERO;
    }
    let scale = U256::from(10u8).pow(U256::from(36u8));
    let expected = usdc_in * scale / twap_price_1e24;
    let keep_bps = u128::from(10_000u32.saturating_sub(slippage_bps));
    expected * U256::from(keep_bps) / U256::from(10_000u16)
}

/// Convert a USDe base-unit amount into the min USDC the operator will
/// accept from the reverse swap. Same shape, inverse scale.
pub fn swap_min_usdc_out(usde_in: U256, twap_price_1e24: U256, slippage_bps: u32) -> U256 {
    let scale = U256::from(10u8).pow(U256::from(36u8));
    let expected = usde_in * twap_price_1e24 / scale;
    let keep_bps = u128::from(10_000u32.saturating_sub(slippage_bps));
    expected * U256::from(keep_bps) / U256::from(10_000u16)
}

/// Compose the plan for opening a fresh recursive-loop position at the
/// composer's target leverage.
///
/// Sequence (five steps, one strike):
///   1. USDC.approve(router, usdc_amount)
///   2. router.exactInputSingle(USDC -> USDe, amountOutMinimum = min_usde_out)
///   3. USDe.approve(morpho, min_usde_out)
///   4. morpho.supplyCollateral(marketParams, min_usde_out, vault, "")
///   5. morpho.borrow(marketParams, target_borrow_usdc, 0, vault, vault)
///
/// `target_borrow_usdc` lands so post-strike measured leverage
/// = collateral / (collateral - debt) = target_leverage_bps / 10_000. Anyone
/// running the same TWAP + config produces identical bytes; Morpho's own
/// LLTV guard rejects the borrow at execution if the oracle disagrees.
#[allow(clippy::too_many_arguments)]
pub fn plan_open_position(
    vault: Address,
    usdc: Address,
    usde: Address,
    morpho: Address,
    swap_router: Address,
    tick_spacing: i32,
    market_params: (Address, Address, Address, Address, U256),
    usdc_amount: U256,
    twap_price_1e24: U256,
    slippage_bps: u32,
    target_leverage_bps: u32,
    deadline_secs: u64,
) -> PlanBuild {
    let min_usde_out = swap_min_usde_out(usdc_amount, twap_price_1e24, slippage_bps);

    // Borrow amount lands us at target leverage.
    // debt = collateral * (L-1) / L; collateral_value ~= min_usde_out * 1e-12
    let target_l = U256::from(target_leverage_bps);
    let collateral_value_usdc = min_usde_out / U256::from(1_000_000_000_000u64);
    let borrow_usdc = if target_leverage_bps > 10_000 {
        collateral_value_usdc * (target_l - U256::from(10_000u16)) / target_l
    } else {
        U256::ZERO
    };

    let (loan_token, collateral_token, oracle, irm, lltv) = market_params;
    let m = MorphoMarketParams {
        loanToken: loan_token,
        collateralToken: collateral_token,
        oracle,
        irm,
        lltv,
    };

    let mut plan = PlanBuild::empty(deadline_secs);

    // 1. approve USDC to router
    plan.push(
        usdc,
        approveCall {
            spender: swap_router,
            amount: usdc_amount,
        }
        .abi_encode(),
    );
    // 2. swap USDC -> USDe
    plan.push(
        swap_router,
        exactInputSingleCall {
            params: AerodromeExactInputSingleParams {
                tokenIn: usdc,
                tokenOut: usde,
                tickSpacing: alloy_primitives::Signed::<24, 1>::try_from(tick_spacing)
                    .unwrap_or_default(),
                recipient: vault,
                deadline: U256::from(deadline_secs),
                amountIn: usdc_amount,
                amountOutMinimum: min_usde_out,
                sqrtPriceLimitX96: alloy_primitives::Uint::<160, 3>::ZERO,
            },
        }
        .abi_encode(),
    );
    // 3. approve USDe to morpho
    plan.push(
        usde,
        approveCall {
            spender: morpho,
            amount: min_usde_out,
        }
        .abi_encode(),
    );
    // 4. supplyCollateral
    plan.push(
        morpho,
        supplyCollateralCall {
            marketParams: m.clone(),
            assets: min_usde_out,
            onBehalf: vault,
            data: Vec::new().into(),
        }
        .abi_encode(),
    );
    // 5. borrow
    if !borrow_usdc.is_zero() {
        plan.push(
            morpho,
            borrowCall {
                marketParams: m,
                assets: borrow_usdc,
                shares: U256::ZERO,
                onBehalf: vault,
                receiver: vault,
            }
            .abi_encode(),
        );
    }
    plan
}

/// The bag of per-strike observations that ride in `BoundNavResult`. Kept as
/// a plain struct so the encode/decode boundary is one flat call and every
/// caller reads the same names as PriimeVault decodes.
#[derive(Clone, Copy, Debug)]
pub struct Observations {
    pub leverage_bps: u32,
    pub ltv_bps: u32,
    pub reserve_bps: u32,
    pub supply_apy_bps: u32,
    pub hours_since_update: u32,
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

/// Floor on the effective TWAP averaging window, in seconds. Below this a
/// clamped window has degraded from an average toward a spot price, which is
/// cheap to move for the one block a cycle reads — the cycle must fail
/// rather than attest on it.
pub const MIN_TWAP_WINDOW_SECS: u32 = 300;

/// The TWAP window this cycle can actually use: `configured_secs` (workflow
/// config `twap_window_secs`) clamped to `observable_secs` (the age of the
/// pool's oldest initialized observation, from [`crate::adapters`]). Errors
/// if the clamped result falls below [`MIN_TWAP_WINDOW_SECS`].
///
/// Deliberately one guard on the final `effective` value, not two separate
/// checks: it covers both a ring too young to answer a full window
/// (`observable_secs` small) and a `twap_window_secs` misconfigured below
/// the floor (`configured_secs` small) with the same code path, and the
/// error message below distinguishes the two for the operator.
pub fn effective_twap_window(configured_secs: u32, observable_secs: u32) -> Result<u32, String> {
    let effective = configured_secs.min(observable_secs);
    if effective < MIN_TWAP_WINDOW_SECS {
        return Err(format!(
            "effective TWAP window {effective}s is below the {MIN_TWAP_WINDOW_SECS}s floor \
             (configured twap_window_secs={configured_secs}s, observable={observable_secs}s): \
             a shorter average degrades toward a spot price and is cheap to manipulate; check \
             whether the pool's observation ring is still young (observable is the smaller \
             input) or twap_window_secs itself is misconfigured (configured is the smaller \
             input)"
        ));
    }
    Ok(effective)
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

/// Risk preset from the composer, chosen by the strategist at publish and
/// pinned in the workflow's componentConfig. Controls how conservative the
/// collateral valuation is, so two vaults on the same market with different
/// presets attest provably different NAVs even in the same block.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RiskPreset {
    /// Trust the peg: value collateral at par unconditionally.
    Aggressive,
    /// Current default: `min(par, TWAP)`.
    Standard,
    /// Standard plus a 100 bps haircut on the TWAP-derived price.
    Conservative,
}

impl RiskPreset {
    pub fn parse(s: &str) -> Result<Self, String> {
        match s {
            "aggressive" => Ok(Self::Aggressive),
            "standard" => Ok(Self::Standard),
            "conservative" => Ok(Self::Conservative),
            other => Err(format!(
                "risk_preset must be one of aggressive|standard|conservative, got {other:?}"
            )),
        }
    }
}

/// Priced collateral in USDC base units: `collateral_1e18 * price_1e24 / 1e36`.
/// Same math `nav_usdc` uses, extracted so every LTV-shaped reading (the
/// hf_floor guard and both attested observations) values collateral at the
/// same market price the attested NAV does.
#[inline]
pub fn priced_collateral_usdc(collateral_1e18: u128, price_1e24: U256) -> U256 {
    // 1e24 * 1e18 / 1e36 == 1 base unit per par-priced USDe; the general form
    // holds for any market price. Widen to U256 first to avoid overflow.
    U256::from(collateral_1e18) * price_1e24 / U256::from(10u8).pow(U256::from(36u8))
}

/// Measured leverage in bps: priced_collateral / (priced_collateral - debt),
/// the standard "position size divided by equity" reading a composer
/// publishes when a strategist picks `applied_leverage=2.5`. `price_1e24`
/// is the same collateral valuation the vault attests to (post-preset), so
/// the reading agrees with what liquidation actually keys off during a
/// depeg. Zero when there is no debt (unleveraged); saturates at u32::MAX
/// when equity is <= 0 (a state the hf_floor check should have rejected,
/// but the observation still lands as a signal rather than a panic).
pub fn measured_leverage_bps(collateral_1e18: u128, price_1e24: U256, debt_usdc: U256) -> u32 {
    if debt_usdc.is_zero() {
        return 0;
    }
    let priced_col = priced_collateral_usdc(collateral_1e18, price_1e24);
    if priced_col <= debt_usdc {
        return u32::MAX;
    }
    let equity = priced_col - debt_usdc;
    let ratio = priced_col * U256::from(10_000u16) / equity;
    u32::try_from(ratio).unwrap_or(u32::MAX)
}

/// Valuation price for the collateral leg, in the market's 1e24 oracle
/// scale. Every preset now caps at `min(par, TWAP)`:
///  * `Aggressive` no longer values collateral above market — publishing par
///    during a depeg made the operator quorum attest above what liquidation
///    keys off. The variant is kept for wire compatibility (`risk_preset`
///    still parses) but semantically maps to `Standard`.
///  * `Conservative` no longer haircuts the price — a 100 bps haircut on
///    collateral was leverage-amplified (2.5% NAV cut at 2.5x leverage,
///    5% at 5x). The haircut moved to equity-NAV level via
///    [`preset_equity_haircut_bps`], so it is now sized in the same units it
///    protects.
pub fn preset_collateral_price_1e24(twap_price_1e24: U256, _preset: RiskPreset) -> U256 {
    bounded_price_1e24(twap_price_1e24)
}

/// Equity-level NAV haircut in bps for a preset. Applied to the attested
/// NAV after collateral has been priced and debt subtracted, so a 100 bps
/// haircut is 100 bps of equity regardless of the leverage the collateral
/// leg runs at. `Aggressive` and `Standard` never haircut; `Conservative`
/// buffers depositors by 100 bps of NAV.
#[inline]
pub fn preset_equity_haircut_bps(preset: RiskPreset) -> u32 {
    match preset {
        RiskPreset::Aggressive | RiskPreset::Standard => 0,
        RiskPreset::Conservative => 100,
    }
}

/// Fail the cycle if the current position's health factor drops below the
/// strategist's floor. The floor is `hf_floor_bps = HF * 1e4` (so 11_000 is
/// HF 1.10, 15_000 is HF 1.50). The allowed LTV under that floor is
/// `lltv_bps * 10_000 / hf_floor_bps`; the cycle fails when the measured
/// LTV exceeds it. Zero disables the check.
///
/// A value below 10_000 (HF < 1.0) sits at or past the liquidation boundary
/// and is refused rather than accepted as "the position may be liquidatable
/// but keep attesting": the guard's whole purpose is to stop attesting there.
pub fn check_hf_floor(
    collateral_1e18: u128,
    price_1e24: U256,
    debt_usdc: U256,
    hf_floor_bps: u32,
    lltv_wad: U256,
) -> Result<(), String> {
    if hf_floor_bps == 0 {
        return Ok(());
    }
    if hf_floor_bps < 10_000 {
        return Err(format!(
            "hf_floor_bps {hf_floor_bps} is below 10_000 (HF < 1.0 sits at or past liquidation)"
        ));
    }
    // Priced collateral at the same valuation the attested NAV uses.
    // Par used to hardcode this, silencing a depeg while the vault attests
    // a lower NAV against the same collateral; now they agree.
    let priced_collateral = priced_collateral_usdc(collateral_1e18, price_1e24);
    if priced_collateral.is_zero() {
        // No collateral (or zero-priced) means no leverage - the check is vacuous.
        return Ok(());
    }
    // ltv_bps = debt * 10_000 / priced_collateral. Widen once to avoid overflow.
    let ltv_bps = debt_usdc * U256::from(10_000u16) / priced_collateral;
    // allowed_ltv_bps = lltv_bps * 10_000 / hf_floor_bps.
    // lltv is in WAD (1e18). Convert to bps: lltv_wad / 1e14.
    let lltv_bps = lltv_wad / U256::from(100_000_000_000_000u64);
    let allowed_bps = lltv_bps * U256::from(10_000u16) / U256::from(hf_floor_bps);
    if ltv_bps > allowed_bps {
        return Err(format!(
            "hf_floor_breached: ltv_bps {ltv_bps} exceeds allowed {allowed_bps} (lltv_bps {lltv_bps}, hf_floor_bps {hf_floor_bps})"
        ));
    }
    Ok(())
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
    let floor = total_pending_deposit + total_claimable_redeem;
    let folded_idle = usdc_balance.checked_sub(floor).ok_or_else(|| {
        format!("escrow floor breached: idle {usdc_balance} < pending+claimable {floor}")
    })?;
    let collateral_value = priced_collateral_usdc(collateral_1e18, price_1e24);
    Ok((collateral_value + U256::from(folded_idle)).saturating_sub(debt_usdc))
}

/// Measured LTV in bps: debt / priced_collateral. Zero when there is no
/// collateral or the market price is zero (the vacuous-check case: no
/// leverage story to tell). Same `price_1e24` the attested NAV uses, so
/// the observation matches the valuation liquidation keys off during a
/// depeg.
pub fn measured_ltv_bps(collateral_1e18: u128, price_1e24: U256, debt_usdc: U256) -> u32 {
    let priced_col = priced_collateral_usdc(collateral_1e18, price_1e24);
    if priced_col.is_zero() {
        return 0;
    }
    let ratio = debt_usdc * U256::from(10_000u16) / priced_col;
    u32::try_from(ratio).unwrap_or(u32::MAX)
}

/// USDC reserve fraction in bps: vault_usdc_balance / nav. Zero when the
/// vault is empty; can exceed 10_000 when nav < usdc (collateral loss).
pub fn measured_reserve_bps(usdc_balance: u128, nav_usdc: U256) -> u32 {
    if nav_usdc.is_zero() {
        return 0;
    }
    let ratio = U256::from(usdc_balance) * U256::from(10_000u16) / nav_usdc;
    u32::try_from(ratio).unwrap_or(u32::MAX)
}

/// Utilization in bps: total_borrow_assets / total_supply_assets.
/// Zero when the market has no supply.
pub fn utilization_bps(total_borrow_assets: u128, total_supply_assets: u128) -> u32 {
    if total_supply_assets == 0 {
        return 0;
    }
    let ratio = total_borrow_assets.saturating_mul(10_000) / total_supply_assets;
    u32::try_from(ratio).unwrap_or(u32::MAX)
}

/// Annualized supply APY in bps.
/// APY_supply ≈ (borrow_rate_wad_per_sec * 3.1536e7 / 1e14) * utilization / 10_000.
/// Ignores Morpho protocol fee; that shaves supply APY by ~fee_bps and can
/// be added when the market's fee is non-zero.
pub fn measured_supply_apy_bps(borrow_rate_wad_per_sec: u128, utilization_bps: u32) -> u32 {
    // secs/year * borrow_rate_wad = year_wad; divide by 1e14 to get bps.
    const SECONDS_PER_YEAR: u128 = 31_536_000;
    let annual_wad = borrow_rate_wad_per_sec.saturating_mul(SECONDS_PER_YEAR);
    let borrow_apy_bps = annual_wad / 100_000_000_000_000u128;
    let supply_apy_bps = borrow_apy_bps.saturating_mul(utilization_bps as u128) / 10_000;
    u32::try_from(supply_apy_bps).unwrap_or(u32::MAX)
}

/// Hours between two unix timestamps, saturating.
pub fn hours_between(from_secs: u64, to_secs: u64) -> u32 {
    let secs = to_secs.saturating_sub(from_secs);
    u32::try_from(secs / 3_600).unwrap_or(u32::MAX)
}

/// Parse a decimal-string leverage/fraction into bps. `"2.5"` -> `25_000`,
/// `"0.05"` -> `500`, `"1"` -> `10_000`. Rejects negatives, NaN, and any
/// value that overflows `u32`. Uses `f64` intentionally: IEEE 754 `parse`
/// is deterministic across every wasm operator running the same host.
pub fn parse_decimal_bps(raw: &str) -> Result<u32, String> {
    let v: f64 = raw
        .trim()
        .parse()
        .map_err(|e| format!("cannot parse {raw:?} as decimal: {e}"))?;
    if !v.is_finite() || v < 0.0 {
        return Err(format!("decimal {raw:?} must be finite and non-negative"));
    }
    let bps = (v * 10_000.0).round();
    if bps > f64::from(u32::MAX) {
        return Err(format!("decimal {raw:?} overflows u32 bps"));
    }
    Ok(bps as u32)
}

/// Fail the cycle when measured leverage drifts more than `tolerance_bps`
/// (relative to configured) from what the strategist published. Skips when
/// the vault has essentially no debt: a freshly seeded loop reads zero
/// leverage regardless of the user's target, and a fresh vault is not a
/// lie about a position that does not exist yet.
pub fn check_applied_leverage_drift(
    measured_bps: u32,
    configured_bps: u32,
    tolerance_bps: u32,
    debt_usdc: U256,
) -> Result<(), String> {
    // Under 1 USDC of debt there is no leverage story worth policing.
    if debt_usdc < U256::from(1_000_000u64) {
        return Ok(());
    }
    if configured_bps == 0 {
        return Ok(());
    }
    let lo = configured_bps
        .saturating_sub((u64::from(configured_bps) * u64::from(tolerance_bps) / 10_000) as u32);
    let hi = configured_bps
        .saturating_add((u64::from(configured_bps) * u64::from(tolerance_bps) / 10_000) as u32);
    if measured_bps < lo || measured_bps > hi {
        return Err(format!(
            "applied_leverage_drift: measured {measured_bps} bps outside [{lo}, {hi}] (configured {configured_bps} bps, tolerance {tolerance_bps} bps)"
        ));
    }
    Ok(())
}

/// Fail the cycle when the position's health factor has dropped below the
/// strategist's trim trigger. The trigger is `deleverage_bps = HF * 1e4`
/// (so 14_550 is HF 1.455). The allowed LTV under that trigger is
/// `lltv_bps * 10_000 / deleverage_bps`; the cycle fails when the measured
/// LTV exceeds it. Zero disables the check.
///
/// If the strike measures a value past the trigger and nothing has trimmed,
/// attesting a NAV as though the position matched policy is a lie of
/// omission. A value below 10_000 (HF < 1.0) sits at or past liquidation
/// and is refused for the same reason as `check_hf_floor`.
pub fn check_deleverage_threshold(
    measured_ltv_bps: u32,
    deleverage_bps: u32,
    debt_usdc: U256,
    lltv_wad: U256,
) -> Result<(), String> {
    if debt_usdc < U256::from(1_000_000u64) {
        return Ok(());
    }
    if deleverage_bps == 0 {
        return Ok(());
    }
    if deleverage_bps < 10_000 {
        return Err(format!(
            "hf_deleverage_bps {deleverage_bps} is below 10_000 (HF < 1.0 sits at or past liquidation)"
        ));
    }
    let lltv_bps = lltv_wad / U256::from(100_000_000_000_000u64);
    let allowed_bps = lltv_bps * U256::from(10_000u16) / U256::from(deleverage_bps);
    let measured = U256::from(measured_ltv_bps);
    if measured > allowed_bps {
        return Err(format!(
            "hf_deleverage_threshold_breached: measured LTV {measured_ltv_bps} bps exceeds trim trigger {allowed_bps} bps (lltv_bps {lltv_bps}, hf_deleverage_bps {deleverage_bps})"
        ));
    }
    Ok(())
}

/// Fail the cycle when the vault's USDC reserve is below the strategist's
/// floor. Skipped for near-empty vaults (nav < 1 USDC): a freshly published
/// vault holds no assets and any reserve fraction of zero is vacuous.
pub fn check_reserve_floor(
    measured_reserve_bps: u32,
    floor_bps: u32,
    nav_usdc: U256,
) -> Result<(), String> {
    if nav_usdc < U256::from(1_000_000u64) {
        return Ok(());
    }
    if floor_bps == 0 {
        return Ok(());
    }
    if measured_reserve_bps < floor_bps {
        return Err(format!(
            "reserve_below_floor: measured {measured_reserve_bps} bps below floor {floor_bps} bps"
        ));
    }
    Ok(())
}

/// Fail the cycle when the market has not accrued within the strategist's
/// compound cadence. `grace_hours` is added to the configured cadence so a
/// missed cron beat does not immediately kill the vault. A cadence of zero
/// disables the check (no policy declared).
pub fn check_compound_cadence(
    hours_since_update: u32,
    cadence_hours: u32,
    grace_hours: u32,
) -> Result<(), String> {
    if cadence_hours == 0 {
        return Ok(());
    }
    let ceiling = cadence_hours.saturating_add(grace_hours);
    if hours_since_update > ceiling {
        return Err(format!(
            "compound_overdue: {hours_since_update} hours since market update, cadence {cadence_hours} h (+ {grace_hours} h grace)"
        ));
    }
    Ok(())
}

/// A plan the quorum signs and the vault dispatches after NAV settlement.
/// Steps are ordered; each `(target, calldata)` must call one of the vault's
/// four whitelisted contracts (USDC, USDe, Morpho Blue, swap router). An
/// empty plan is legal — the vault emits `PlanExecuted(hash, 0)` and no
/// action runs. `timestamp` binds the plan to the block whose state the
/// operator observed, so a stale plan submitted at a later block can be
/// audited against its own snapshot.
#[derive(Clone, Debug, Default)]
pub struct PlanBuild {
    pub targets: Vec<Address>,
    pub calldatas: Vec<Vec<u8>>,
    pub timestamp_secs: u64,
}

impl PlanBuild {
    pub fn empty(timestamp_secs: u64) -> Self {
        Self {
            targets: Vec::new(),
            calldatas: Vec::new(),
            timestamp_secs,
        }
    }

    pub fn push(&mut self, target: Address, calldata: Vec<u8>) {
        self.targets.push(target);
        self.calldatas.push(calldata);
    }

    pub fn is_empty(&self) -> bool {
        self.targets.is_empty()
    }

    /// Convert to the sol! wrapper for `abi_encode`. Zero-copy where possible.
    fn into_sol(self) -> StrategyPlan {
        StrategyPlan {
            targets: self.targets,
            calldatas: self.calldatas.into_iter().map(Into::into).collect(),
            timestamp: U256::from(self.timestamp_secs),
        }
    }
}

/// The signed payload bytes:
/// abi.encode(handler, nav, inputsBlock, configHash, leverageBps, ltvBps,
///            reserveBps, supplyApyBps, hoursSinceUpdate, StrategyPlan).
pub fn encode_payload(
    handler: Address,
    nav: U256,
    inputs_block: u64,
    config_hash: FixedBytes<32>,
    obs: Observations,
    plan: PlanBuild,
) -> Vec<u8> {
    BoundNavResult {
        handler,
        nav,
        inputsBlock: U256::from(inputs_block),
        configHash: config_hash,
        leverageBps: obs.leverage_bps,
        ltvBps: obs.ltv_bps,
        reserveBps: obs.reserve_bps,
        supplyApyBps: obs.supply_apy_bps,
        hoursSinceUpdate: obs.hours_since_update,
        plan: plan.into_sol(),
    }
    .abi_encode()
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy_primitives::address;

    // --- borrow share math -------------------------------------------------

    #[test]
    fn borrow_assets_zero_shares_is_zero() {
        assert_eq!(
            borrow_assets_up(0, U256::from(1_000_000_000u128), 5_000_000),
            U256::ZERO
        );
    }

    #[test]
    fn borrow_assets_rounds_up() {
        // shares * (tba + 1) / (tbs + 1e6) = 3 * 1001 / 2e6 = 0.0015 -> ceil 1.
        assert_eq!(
            borrow_assets_up(3, U256::from(1_000u128), 1_000_000),
            U256::from(1u8)
        );
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
        let expected = (bs * (tba + 1)).div_ceil(tbs + 1_000_000);
        assert_eq!(
            borrow_assets_up(bs, U256::from(tba), tbs),
            U256::from(expected)
        );
    }

    // --- interest accrual ---------------------------------------------------

    #[test]
    fn accrual_zero_rate_or_elapsed_is_identity() {
        assert_eq!(
            accrued_total_borrow(1_000_000, 0, 3600),
            U256::from(1_000_000u128)
        );
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
        assert!(
            accrued >= linear,
            "3-term Taylor must dominate linear: {accrued}"
        );
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

    // --- TWAP window floor ---------------------------------------------------

    #[test]
    fn window_uses_configured_when_observable_covers_it() {
        assert_eq!(effective_twap_window(1800, 3600).unwrap(), 1800);
    }

    #[test]
    fn window_clamps_to_observable_above_the_floor() {
        assert_eq!(effective_twap_window(1800, 900).unwrap(), 900);
    }

    #[test]
    fn window_clamps_to_observable_exactly_at_the_floor() {
        assert_eq!(effective_twap_window(1800, 300).unwrap(), 300);
    }

    #[test]
    fn window_one_second_short_of_the_floor_fails_the_cycle() {
        assert!(effective_twap_window(1800, 299).is_err());
    }

    #[test]
    fn window_a_young_ring_of_a_few_seconds_fails_the_cycle() {
        let e = effective_twap_window(1800, 4).unwrap_err();
        assert!(e.contains("4"), "{e}");
    }

    #[test]
    fn window_misconfigured_below_the_floor_fails_even_with_ample_observable() {
        // observable is plenty (a day old ring); the configured window itself
        // is the problem, not the ring.
        let e = effective_twap_window(60, 86_400).unwrap_err();
        assert!(e.contains("60"), "{e}");
    }

    #[test]
    fn window_zero_configured_fails_the_cycle() {
        assert!(effective_twap_window(0, 3600).is_err());
    }

    #[test]
    fn sqrt_ratio_matches_canonical_vectors() {
        // Known TickMath outputs.
        assert_eq!(sqrt_ratio_x96_at_tick(0).unwrap(), U256::from(1u8) << 96);
        assert_eq!(
            sqrt_ratio_x96_at_tick(1).unwrap(),
            U256::from(79_232_123_823_359_799_118_286_999_568u128)
        );
        assert_eq!(
            sqrt_ratio_x96_at_tick(-887_272).unwrap(),
            U256::from(4_295_128_739u64)
        );
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

    // --- risk preset --------------------------------------------------------

    #[test]
    fn preset_aggressive_no_longer_values_above_market() {
        // Roadmap #12: Aggressive used to return par unconditionally, which
        // let the operator quorum attest above what liquidation keys off
        // during a depeg. Every preset now caps at min(par, TWAP).
        let depeg = U256::from(PAR_PRICE_1E24 * 90 / 100);
        assert_eq!(
            preset_collateral_price_1e24(depeg, RiskPreset::Aggressive),
            depeg
        );
    }

    #[test]
    fn preset_standard_matches_historical_bounded_min() {
        let depeg = U256::from(PAR_PRICE_1E24 * 95 / 100);
        assert_eq!(
            preset_collateral_price_1e24(depeg, RiskPreset::Standard),
            bounded_price_1e24(depeg)
        );
        let above = U256::from(PAR_PRICE_1E24 + 12_345);
        assert_eq!(
            preset_collateral_price_1e24(above, RiskPreset::Standard),
            U256::from(PAR_PRICE_1E24)
        );
    }

    #[test]
    fn preset_conservative_no_longer_haircuts_the_collateral_price() {
        // Roadmap #12: the 100 bps Conservative haircut moved from
        // collateral-price to equity-NAV level (see preset_equity_haircut_bps),
        // so it is no longer leverage-amplified. At par the collateral price
        // now matches Standard exactly.
        let par = U256::from(PAR_PRICE_1E24);
        assert_eq!(
            preset_collateral_price_1e24(par, RiskPreset::Conservative),
            par
        );
    }

    #[test]
    fn preset_equity_haircut_bps_only_touches_conservative() {
        assert_eq!(preset_equity_haircut_bps(RiskPreset::Aggressive), 0);
        assert_eq!(preset_equity_haircut_bps(RiskPreset::Standard), 0);
        assert_eq!(preset_equity_haircut_bps(RiskPreset::Conservative), 100);
    }

    #[test]
    fn preset_equity_haircut_sized_in_nav_not_collateral() {
        // 100 USDe collateral at par, 60 USDC debt -> NAV 40 USDC pre-haircut.
        // Old (collateral-price) Conservative would haircut 100 bps of the
        // 100 USDC collateral leg (1 USDC) -> NAV 39 USDC. That is 2.5%
        // of equity, leverage-amplified.
        // New (equity) haircut = 100 bps of NAV = 0.40 USDC -> NAV 39.60 USDC.
        // Independent of leverage.
        let nav = nav_usdc(
            100_000_000_000_000_000_000u128, // 100 USDe collateral
            U256::from(PAR_PRICE_1E24),
            U256::from(60_000_000u64), // 60 USDC debt
            0,
            0,
            0,
        )
        .unwrap();
        assert_eq!(nav, U256::from(40_000_000u64));
        let haircut = preset_equity_haircut_bps(RiskPreset::Conservative);
        let attested = nav * U256::from(10_000 - haircut) / U256::from(10_000u16);
        assert_eq!(attested, U256::from(39_600_000u64));
    }

    #[test]
    fn preset_parse_round_trip() {
        assert_eq!(RiskPreset::parse("aggressive"), Ok(RiskPreset::Aggressive));
        assert_eq!(RiskPreset::parse("standard"), Ok(RiskPreset::Standard));
        assert_eq!(
            RiskPreset::parse("conservative"),
            Ok(RiskPreset::Conservative)
        );
        assert!(RiskPreset::parse("yolo").is_err());
    }

    // --- hf floor -----------------------------------------------------------

    #[test]
    fn hf_floor_zero_disables_the_check() {
        // 100% LTV is patently unsafe but zero floor bps means "no check".
        let collateral_1e18 = 1_000_000_000_000_000_000u128; // 1 USDe
        let debt_usdc = U256::from(1_000_000u64); // 1 USDC
        let lltv_wad = U256::from(915_000_000_000_000_000u64); // 91.5%
        let par = U256::from(PAR_PRICE_1E24);
        assert!(check_hf_floor(collateral_1e18, par, debt_usdc, 0, lltv_wad).is_ok());
    }

    #[test]
    fn hf_floor_allows_ltv_below_floor_at_par() {
        // Collateral priced at par (1 USDe = 1 USDC), no depeg.
        // hf_floor_bps = 11_000 (HF 1.10) vs 91.5% LLTV
        // -> allowed LTV = 9150 * 10_000 / 11_000 = 8318 bps.
        // Measured LTV = 80% = 8000 bps; 8000 <= 8318, passes.
        let collateral_1e18 = 1_000_000_000_000_000_000u128; // 1 USDe
        let debt_usdc = U256::from(800_000u64); // 0.8 USDC
        let lltv_wad = U256::from(915_000_000_000_000_000u64);
        let par = U256::from(PAR_PRICE_1E24);
        assert!(check_hf_floor(collateral_1e18, par, debt_usdc, 11_000, lltv_wad).is_ok());
    }

    #[test]
    fn hf_floor_rejects_floor_breach_at_par() {
        // Same allowed 8318 bps; measured 85% = 8500 bps > 8318, fails.
        let collateral_1e18 = 1_000_000_000_000_000_000u128;
        let debt_usdc = U256::from(850_000u64);
        let lltv_wad = U256::from(915_000_000_000_000_000u64);
        let par = U256::from(PAR_PRICE_1E24);
        let err = check_hf_floor(collateral_1e18, par, debt_usdc, 11_000, lltv_wad).unwrap_err();
        assert!(err.contains("hf_floor_breached"));
    }

    #[test]
    fn hf_floor_catches_depeg_that_par_would_hide() {
        // The whole point of roadmap #11: par-priced this would pass silently,
        // priced at the same market TWAP the NAV attests to it fails.
        // Position: 1 USDe collateral, 0.8 USDC debt.
        //  - At par: LTV = 8000 bps -> under the 8318 allowance for hf_floor=11_000.
        //  - At TWAP 0.9 par (10% depeg): priced_col = 0.9 USDC,
        //    LTV = 8000/0.9 ≈ 8888 bps -> above 8318, guard fires.
        let collateral_1e18 = 1_000_000_000_000_000_000u128;
        let debt_usdc = U256::from(800_000u64);
        let lltv_wad = U256::from(915_000_000_000_000_000u64);
        let par = U256::from(PAR_PRICE_1E24);
        // Sanity: at par the check passes (as the reviewer flagged).
        assert!(check_hf_floor(collateral_1e18, par, debt_usdc, 11_000, lltv_wad).is_ok());
        // At market, it refuses.
        let depeg_price = par * U256::from(9_000u16) / U256::from(10_000u16);
        let err = check_hf_floor(collateral_1e18, depeg_price, debt_usdc, 11_000, lltv_wad).unwrap_err();
        assert!(err.contains("hf_floor_breached"));
    }

    #[test]
    fn hf_floor_vacuous_on_zero_collateral() {
        // No collateral means no leverage story; the check has nothing to say.
        let par = U256::from(PAR_PRICE_1E24);
        assert!(check_hf_floor(0, par, U256::ZERO, 11_000, U256::from(915_000_000_000_000_000u64)).is_ok());
    }

    #[test]
    fn hf_floor_rejects_below_1x_hf() {
        // hf_floor_bps < 10_000 means HF < 1.0 (past liquidation) - the guard
        // exists to stop attesting there, not to be configurable to accept it.
        let lltv_wad = U256::from(915_000_000_000_000_000u64);
        let par = U256::from(PAR_PRICE_1E24);
        let err = check_hf_floor(1_000_000_000_000_000_000u128, par, U256::from(1u64), 9_999, lltv_wad).unwrap_err();
        assert!(err.contains("is below 10_000"));
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

    // --- observation helpers ------------------------------------------------

    #[test]
    fn measured_leverage_is_zero_with_no_debt() {
        let par = U256::from(PAR_PRICE_1E24);
        assert_eq!(
            measured_leverage_bps(1_000_000_000_000_000_000u128, par, U256::ZERO),
            0
        );
    }

    #[test]
    fn measured_leverage_saturates_above_equity() {
        // debt >= priced_collateral means equity <= 0 - the position is
        // insolvent. The floor check should reject it, but the observation
        // still lands as u32::MAX so downstream verifiers see the signal.
        let collateral_1e18 = 1_000_000_000_000_000_000u128; // 1 USDe -> $1 par
        let debt = U256::from(1_000_000u64); // exactly 1 USDC
        let par = U256::from(PAR_PRICE_1E24);
        assert_eq!(measured_leverage_bps(collateral_1e18, par, debt), u32::MAX);
    }

    #[test]
    fn measured_leverage_matches_expected_ratio_at_par() {
        // priced_col = $10, debt = $6 -> equity = $4,
        // leverage = priced_col/equity = 10/4 = 2.5x.
        let collateral_1e18 = 10_000_000_000_000_000_000u128;
        let debt = U256::from(6_000_000u64);
        let par = U256::from(PAR_PRICE_1E24);
        assert_eq!(measured_leverage_bps(collateral_1e18, par, debt), 25_000);
    }

    #[test]
    fn measured_leverage_reads_higher_during_depeg() {
        // Same position as above, USDe at 0.9 par -> priced_col $9, equity $3,
        // leverage 9/3 = 3.0x. The par-priced reading (2.5x) hid the depeg
        // exposure; the priced reading surfaces it.
        let collateral_1e18 = 10_000_000_000_000_000_000u128;
        let debt = U256::from(6_000_000u64);
        let depeg_price = U256::from(PAR_PRICE_1E24) * U256::from(9_000u16) / U256::from(10_000u16);
        assert_eq!(measured_leverage_bps(collateral_1e18, depeg_price, debt), 30_000);
    }

    #[test]
    fn measured_ltv_matches_check_hf_floor_computation_at_par() {
        // priced_col $1, debt $0.80 -> 8000 bps LTV.
        let collateral_1e18 = 1_000_000_000_000_000_000u128;
        let debt = U256::from(800_000u64);
        let par = U256::from(PAR_PRICE_1E24);
        assert_eq!(measured_ltv_bps(collateral_1e18, par, debt), 8_000);
    }

    #[test]
    fn measured_ltv_reads_higher_during_depeg() {
        // Same position, TWAP 0.9 par -> priced_col $0.90, LTV = 8000/0.9
        // = 8888 bps. Whereas the par-priced reading stays at 8000, the
        // priced one surfaces what liquidation sees.
        let collateral_1e18 = 1_000_000_000_000_000_000u128;
        let debt = U256::from(800_000u64);
        let depeg_price = U256::from(PAR_PRICE_1E24) * U256::from(9_000u16) / U256::from(10_000u16);
        assert_eq!(measured_ltv_bps(collateral_1e18, depeg_price, debt), 8_888);
    }

    #[test]
    fn measured_ltv_is_zero_with_no_collateral() {
        let par = U256::from(PAR_PRICE_1E24);
        assert_eq!(measured_ltv_bps(0, par, U256::from(1_000_000u64)), 0);
    }

    #[test]
    fn reserve_is_zero_when_nav_is_zero() {
        assert_eq!(measured_reserve_bps(5_000_000, U256::ZERO), 0);
    }

    #[test]
    fn reserve_matches_expected_ratio() {
        // 2 USDC reserve vs 10 USDC nav -> 20% = 2000 bps.
        assert_eq!(
            measured_reserve_bps(2_000_000, U256::from(10_000_000u64)),
            2_000
        );
    }

    #[test]
    fn utilization_zero_supply() {
        assert_eq!(utilization_bps(1_000, 0), 0);
    }

    #[test]
    fn utilization_matches_expected_ratio() {
        assert_eq!(utilization_bps(800_000, 1_000_000), 8_000);
    }

    #[test]
    fn supply_apy_scales_borrow_by_utilization() {
        // borrow rate_wad_per_sec = 3.17e9 per sec ~ 10% APR.
        // At 100% utilization supply APY ~= borrow APR.
        // year_wad = 3.17e9 * 3.1536e7 = ~1e17 wad = 10% wad = 1000 bps.
        let rate = 3_170_000_000u128;
        assert!(measured_supply_apy_bps(rate, 10_000) >= 990);
        assert!(measured_supply_apy_bps(rate, 10_000) <= 1_010);
        // At 50% utilization supply is halved.
        assert!(measured_supply_apy_bps(rate, 5_000) >= 495);
        assert!(measured_supply_apy_bps(rate, 5_000) <= 510);
    }

    #[test]
    fn hours_between_saturates_backwards() {
        assert_eq!(hours_between(100, 50), 0);
    }

    #[test]
    fn hours_between_computes_integer_hours() {
        assert_eq!(hours_between(0, 7_200), 2);
        assert_eq!(hours_between(0, 3_599), 0);
    }

    // --- payload ------------------------------------------------------------

    #[test]
    fn payload_carries_observations_and_empty_plan() {
        let handler = address!("73BB3CE07d25057A9265B476E80c08CBbA5d80d9");
        let config_hash = FixedBytes::<32>::from([0xAB; 32]);
        let obs = Observations {
            leverage_bps: 25_000,
            ltv_bps: 8_000,
            reserve_bps: 500,
            supply_apy_bps: 700,
            hours_since_update: 3,
        };
        let plan = PlanBuild::empty(1_234_567);
        let bytes = encode_payload(
            handler,
            U256::from(500_000_000u64),
            49_911_282,
            config_hash,
            obs,
            plan,
        );
        // Dynamic sol! struct (StrategyPlan carries dynamic arrays) is
        // encoded as a single-element tuple: 32-byte leading offset (0x20)
        // then the struct body. Solidity decodes with
        // abi.decode(payload, (BoundNavResult)).
        assert_eq!(U256::from_be_slice(&bytes[0..32]), U256::from(32u8));
        let body = &bytes[32..];
        assert_eq!(&body[0..12], &[0u8; 12]);
        assert_eq!(&body[12..32], handler.as_slice());
        assert_eq!(
            U256::from_be_slice(&body[32..64]),
            U256::from(500_000_000u64)
        );
        assert_eq!(
            U256::from_be_slice(&body[64..96]),
            U256::from(49_911_282u64)
        );
        assert_eq!(&body[96..128], config_hash.as_slice());
        assert_eq!(U256::from_be_slice(&body[128..160]), U256::from(25_000u64));
        assert_eq!(U256::from_be_slice(&body[160..192]), U256::from(8_000u64));
        assert_eq!(U256::from_be_slice(&body[192..224]), U256::from(500u64));
        assert_eq!(U256::from_be_slice(&body[224..256]), U256::from(700u64));
        assert_eq!(U256::from_be_slice(&body[256..288]), U256::from(3u64));
    }

    #[test]
    fn plan_open_position_lands_at_target_leverage() {
        let vault = address!("0000000000000000000000000000000000000A11");
        let usdc = address!("833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
        let usde = address!("5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34");
        let morpho = address!("BBBBBbbBBb9cC5e90e3b3AF64bdAF62C37EEFFCb");
        let router = address!("BE6D8f0d05cC4be24d5167a3eF062215bE6D18a5");
        let usdc_amount = U256::from(5_000_000u64); // 5 USDC
        let twap = U256::from(PAR_PRICE_1E24); // par
        let plan = plan_open_position(
            vault,
            usdc,
            usde,
            morpho,
            router,
            1, // tick spacing
            (
                usdc,
                usde,
                Address::ZERO,
                Address::ZERO,
                U256::from(915_000_000_000_000_000u64),
            ),
            usdc_amount,
            twap,
            50,     // 50 bps slippage
            25_000, // 2.5x
            1_800_000_000,
        );
        // 5 steps: approve USDC, swap, approve USDe, supply, borrow.
        assert_eq!(plan.targets.len(), 5);
        assert_eq!(plan.targets[0], usdc);
        assert_eq!(plan.targets[1], router);
        assert_eq!(plan.targets[2], usde);
        assert_eq!(plan.targets[3], morpho);
        assert_eq!(plan.targets[4], morpho);
    }

    // --- knob invariants ----------------------------------------------------

    #[test]
    fn parse_decimal_bps_common_shapes() {
        assert_eq!(parse_decimal_bps("2.5").unwrap(), 25_000);
        assert_eq!(parse_decimal_bps("0.05").unwrap(), 500);
        assert_eq!(parse_decimal_bps("1").unwrap(), 10_000);
        assert_eq!(parse_decimal_bps(" 3.0 ").unwrap(), 30_000);
    }

    #[test]
    fn parse_decimal_bps_rejects_bad_input() {
        assert!(parse_decimal_bps("-1").is_err());
        assert!(parse_decimal_bps("nan").is_err());
        assert!(parse_decimal_bps("abc").is_err());
    }

    #[test]
    fn applied_leverage_skipped_when_no_debt() {
        // Empty vault: measured leverage is 0, configured is 2.5x. No cycle-fail.
        assert!(check_applied_leverage_drift(0, 25_000, 2_500, U256::ZERO).is_ok());
    }

    #[test]
    fn applied_leverage_within_tolerance_passes() {
        // Configured 2.5x, tolerance 25% -> band [1.875x, 3.125x].
        let debt = U256::from(5_000_000u64);
        assert!(check_applied_leverage_drift(20_000, 25_000, 2_500, debt).is_ok());
        assert!(check_applied_leverage_drift(30_000, 25_000, 2_500, debt).is_ok());
    }

    #[test]
    fn applied_leverage_drift_fails_the_cycle() {
        let debt = U256::from(5_000_000u64);
        // 4x measured vs 2.5x configured is a real drift.
        let err = check_applied_leverage_drift(40_000, 25_000, 2_500, debt).unwrap_err();
        assert!(err.contains("applied_leverage_drift"));
    }

    #[test]
    fn deleverage_threshold_skipped_when_no_debt() {
        let lltv_wad = U256::from(915_000_000_000_000_000u64);
        assert!(check_deleverage_threshold(9_500, 14_550, U256::ZERO, lltv_wad).is_ok());
    }

    #[test]
    fn deleverage_threshold_passes_below_trigger() {
        // deleverage_bps = 14_550 (HF 1.455) vs 91.5% LLTV
        // -> trigger LTV = 9150 * 10_000 / 14_550 = 6289 bps.
        // Measured 6000 bps < 6289, passes.
        let debt = U256::from(5_000_000u64);
        let lltv_wad = U256::from(915_000_000_000_000_000u64);
        assert!(check_deleverage_threshold(6_000, 14_550, debt, lltv_wad).is_ok());
    }

    #[test]
    fn deleverage_threshold_fails_above_trigger() {
        // Same trigger 6289 bps; measured 6500 bps > 6289, fails.
        let debt = U256::from(5_000_000u64);
        let lltv_wad = U256::from(915_000_000_000_000_000u64);
        let err = check_deleverage_threshold(6_500, 14_550, debt, lltv_wad).unwrap_err();
        assert!(err.contains("hf_deleverage_threshold_breached"));
    }

    #[test]
    fn deleverage_threshold_rejects_below_1x_hf() {
        // deleverage_bps < 10_000 means HF < 1.0 (past liquidation); refused.
        let debt = U256::from(5_000_000u64);
        let lltv_wad = U256::from(915_000_000_000_000_000u64);
        let err = check_deleverage_threshold(6_500, 9_999, debt, lltv_wad).unwrap_err();
        assert!(err.contains("is below 10_000"));
    }

    #[test]
    fn reserve_floor_skipped_when_nav_is_empty() {
        assert!(check_reserve_floor(0, 500, U256::ZERO).is_ok());
    }

    #[test]
    fn reserve_floor_passes_at_or_above_floor() {
        let nav = U256::from(10_000_000u64);
        assert!(check_reserve_floor(500, 500, nav).is_ok());
        assert!(check_reserve_floor(600, 500, nav).is_ok());
    }

    #[test]
    fn reserve_floor_fails_below_floor() {
        let nav = U256::from(10_000_000u64);
        let err = check_reserve_floor(400, 500, nav).unwrap_err();
        assert!(err.contains("reserve_below_floor"));
    }

    #[test]
    fn compound_cadence_zero_disables_the_check() {
        // Old vault, no cadence configured; a stale market is not a lie.
        assert!(check_compound_cadence(1_000_000, 0, 6).is_ok());
    }

    #[test]
    fn compound_cadence_within_grace_passes() {
        assert!(check_compound_cadence(24, 24, 6).is_ok());
        assert!(check_compound_cadence(30, 24, 6).is_ok());
    }

    #[test]
    fn compound_cadence_beyond_grace_fails() {
        let err = check_compound_cadence(31, 24, 6).unwrap_err();
        assert!(err.contains("compound_overdue"));
    }
}
