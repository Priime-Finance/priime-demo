// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title IMorphoBlue
/// @notice Minimal Morpho Blue interface for supplyCollateral / borrow /
///         repay / withdrawCollateral. Everything the vault needs to run a
///         recursive USDe/USDC loop, nothing else. Signatures verified
///         against the canonical Morpho Blue deployment on Base
///         (0xBBBBBbbBBb9cC5e90e3b3AF64bdAF62C37EEFFCb).
interface IMorphoBlue {
    /// @dev Mirrors Morpho Blue's on-chain MarketParams tuple exactly.
    struct MarketParams {
        address loanToken;
        address collateralToken;
        address oracle;
        address irm;
        uint256 lltv;
    }

    function supplyCollateral(MarketParams calldata marketParams, uint256 assets, address onBehalf, bytes calldata data)
        external;

    function withdrawCollateral(MarketParams calldata marketParams, uint256 assets, address onBehalf, address receiver)
        external;

    /// @return assetsBorrowed
    /// @return sharesBorrowed
    function borrow(
        MarketParams calldata marketParams,
        uint256 assets,
        uint256 shares,
        address onBehalf,
        address receiver
    ) external returns (uint256, uint256);

    /// @return assetsRepaid
    /// @return sharesRepaid
    function repay(
        MarketParams calldata marketParams,
        uint256 assets,
        uint256 shares,
        address onBehalf,
        bytes calldata data
    ) external returns (uint256, uint256);

    /// @notice Free-then-pull flashloan. Morpho transfers `assets` of `token`
    ///         to `msg.sender`, calls `onMorphoFlashLoan(assets, data)` on the
    ///         caller, then pulls `assets` back via `safeTransferFrom` (the
    ///         caller must have granted allowance to Morpho by then). No fee
    ///         today; the caller keeps the delta the callback produced.
    function flashLoan(address token, uint256 assets, bytes calldata data) external;
}

/// @title IMorphoFlashLoanCallback
/// @notice Interface `flashLoan` callers must implement. The callback runs
///         inside `flashLoan`, after the `assets` have been transferred to
///         the caller and before Morpho pulls them back.
interface IMorphoFlashLoanCallback {
    function onMorphoFlashLoan(uint256 assets, bytes calldata data) external;
}
