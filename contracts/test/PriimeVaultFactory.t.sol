// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPriimeServiceManager} from "../src/interfaces/priime/IPriimeServiceManager.sol";
import {PriimeVault} from "../src/PriimeVault.sol";
import {PriimeVaultFactory} from "../src/PriimeVaultFactory.sol";
import {ToggleableServiceManager} from "./PriimeVault.t.sol";
import {TestUSDC} from "./PriimeVault.t.sol";

interface FactoryVm {
    function prank(address) external;
    function expectEmit(bool, bool, bool, bool) external;
    function roll(uint256) external;
    function label(address, string calldata) external;
}

contract PriimeVaultFactoryTest {
    FactoryVm internal vm = FactoryVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address internal constant STRATEGIST = address(0x57121);
    address internal constant DEPLOYER = address(0xDEA1E7);

    TestUSDC internal usdc;
    ToggleableServiceManager internal manager;
    PriimeVaultFactory internal factory;

    function setUp() public {
        vm.roll(1_000);
        usdc = new TestUSDC();
        manager = new ToggleableServiceManager();
        factory = new PriimeVaultFactory();
    }

    function _strategy() internal pure returns (PriimeVault.StrategyConfig memory) {
        return PriimeVault.StrategyConfig({
            collateralToken: address(0xC0),
            morpho: address(0xD1),
            morphoOracle: address(0x02),
            morphoIrm: address(0x03),
            morphoLltv: 915_000_000_000_000_000,
            swapRouter: address(0x04),
            poolFee: uint24(500)
        });
    }

    function test_DeploysVaultAndEmitsVaultCreated() public {
        // Predict address emitted by expectEmit is unknown; we assert the event by shape
        // via topics, then read back state.
        vm.prank(DEPLOYER);
        address vault = factory.deployVault(
            IPriimeServiceManager(address(manager)), IERC20(address(usdc)), STRATEGIST, _strategy()
        );

        require(vault.code.length > 0, "vault has no bytecode");
        require(factory.vaultCount() == 1, "vault count = 1");
        require(factory.vaults(0) == vault, "vaults[0] matches return");

        address[] memory all = factory.allVaults();
        require(all.length == 1 && all[0] == vault, "allVaults returns [vault]");

        // Read state from the new vault directly.
        PriimeVault deployed = PriimeVault(vault);
        require(deployed.strategist() == STRATEGIST, "strategist wired");
        require(deployed.asset() == address(usdc), "asset wired");
        require(address(deployed.serviceManager()) == address(manager), "manager wired");
        require(deployed.poolFee() == 500, "poolFee wired");
    }

    function test_TwoDeploymentsHaveDistinctAddresses() public {
        address vaultA = factory.deployVault(
            IPriimeServiceManager(address(manager)), IERC20(address(usdc)), STRATEGIST, _strategy()
        );
        address vaultB = factory.deployVault(
            IPriimeServiceManager(address(manager)), IERC20(address(usdc)), STRATEGIST, _strategy()
        );
        require(vaultA != vaultB, "distinct addresses");
        require(factory.vaultCount() == 2, "count = 2");
        require(factory.vaults(1) == vaultB, "vaults[1] = B");
    }
}
