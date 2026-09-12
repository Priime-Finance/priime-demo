// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPriimeServiceManager} from "./interfaces/priime/IPriimeServiceManager.sol";
import {PriimeVault} from "./PriimeVault.sol";

/// @title PriimeVaultFactory
/// @notice Deploys `PriimeVault` instances and emits `VaultCreated` so an off-chain indexer (subgraph, subsquid, etc.) can track every deployment through one event stream instead of tailing each vault address separately. Every `PriimeVault` on Base flows through here; the factory address is the single "point at me" pin for any observer.
contract PriimeVaultFactory {
    /// @notice `VaultCreated` is emitted once per successful `deployVault` call. Subgraph data-source templates spawn a per-vault indexer instance from this event's `vault` field.
    event VaultCreated(
        address indexed vault,
        address indexed strategist,
        address indexed serviceManager,
        address asset,
        address deployer,
        uint256 index
    );

    /// @notice Every vault this factory ever deployed, in order. `vaults(i)` is the vault at position `i`; `vaultCount()` is the current length.
    address[] private _vaults;

    error ZeroDeployment();

    function deployVault(
        IPriimeServiceManager serviceManager,
        IERC20 asset,
        address strategist,
        PriimeVault.StrategyConfig calldata strategy
    ) external returns (address vault) {
        PriimeVault instance = new PriimeVault(serviceManager, asset, strategist, strategy);
        vault = address(instance);
        if (vault == address(0)) revert ZeroDeployment();
        uint256 index = _vaults.length;
        _vaults.push(vault);
        emit VaultCreated(vault, strategist, address(serviceManager), address(asset), msg.sender, index);
    }

    function vaults(uint256 index) external view returns (address) {
        return _vaults[index];
    }

    function vaultCount() external view returns (uint256) {
        return _vaults.length;
    }

    /// @notice Snapshot every deployed vault at once. Cheap because factory storage is append-only; convenient for one-shot off-chain reads.
    function allVaults() external view returns (address[] memory) {
        return _vaults;
    }
}
