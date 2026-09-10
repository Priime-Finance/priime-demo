// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title IAerodromeCLRouter
/// @notice Minimal Aerodrome Slipstream (Uniswap V3 fork) router surface for
///         single-hop exact-input swaps. The Slipstream router at
///         0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5 on Base identifies pools
///         by `tickSpacing`, not by fee tier — that is the only shape
///         difference from Uniswap V3's SwapRouter02.
interface IAerodromeCLRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        int24 tickSpacing;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    /// @return amountOut The actual amount of `tokenOut` received.
    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}
