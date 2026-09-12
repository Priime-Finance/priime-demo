// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title IUniswapV3SwapRouter02
/// @notice Minimal Uniswap V3 SwapRouter02 surface for single-hop exact-input
///         swaps. SwapRouter02 on Base sits at
///         `0x2626664c2603336E57B271c5C0b26F421741e481`; the interface is
///         also the same on every other chain Uniswap V3 deploys to
///         (Ethereum, Optimism, Arbitrum, Polygon, BNB, Avalanche, ...),
///         which is what lets this vault stay chain-agnostic. Pools are
///         identified by `(tokenIn, tokenOut, fee)`; the deep USDe/USDC
///         pool on Base is at fee tier 500 (0.05%).
///
///         SwapRouter02 drops the per-swap `deadline` field the older
///         SwapRouter (v1) carried. The router itself is meant to be
///         wrapped in `multicall` when a deadline matters; the vault's
///         plan step is atomic within a single tx so the pool state at
///         call time is the state the operator quorum priced against.
interface IUniswapV3SwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    /// @return amountOut The actual amount of `tokenOut` received.
    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}
