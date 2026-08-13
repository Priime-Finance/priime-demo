// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IWavsServiceHandler} from "../src/interfaces/wavs/IWavsServiceHandler.sol";
import {IWavsServiceManager} from "../src/interfaces/wavs/IWavsServiceManager.sol";
import {PriimeVault} from "../src/PriimeVault.sol";

/// @dev Minimal surface of forge's built-in cheatcode contract; declared here
///      instead of vendoring forge-std (the repo vendors no forge-std).
interface Vm {
    function prank(address) external;
    function expectRevert(bytes calldata) external;
}

/// @dev Mintable 6-decimal stand-in for USDC. Test-only.
contract TestUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function decimals() external pure returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "balance");
        require(allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @dev Toggleable stand-in for the WAVS service manager: `validate` passes by
///      default and reverts once `setReject(true)` is called, so tests can
///      exercise both the accepted-quorum and rejected-quorum paths. Test-only;
///      the src/ MockServiceManager stays a no-op for the anvil pipeline.
contract ToggleableServiceManager {
    bool public reject;

    error ValidationRejected();

    function setReject(bool _reject) external {
        reject = _reject;
    }

    function validate(IWavsServiceHandler.Envelope calldata, IWavsServiceHandler.SignatureData calldata)
        external
        view
    {
        if (reject) revert ValidationRejected();
    }
}

/// @dev Target that always reverts with a typed error, to prove `execute`
///      bubbles the target's revert data unchanged.
contract RevertingTarget {
    error Boom(uint256 code);

    function kaboom() external pure {
        revert Boom(42);
    }
}

contract PriimeVaultTest {
    Vm internal vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    TestUSDC internal usdc;
    ToggleableServiceManager internal manager;
    PriimeVault internal vault;

    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);
    address internal constant STRATEGIST = address(0x57121);
    address internal constant SINK = address(0x51D4);

    uint256 internal constant ONE_USDC = 1e6;

    function setUp() public {
        usdc = new TestUSDC();
        manager = new ToggleableServiceManager();
        vault = new PriimeVault(IWavsServiceManager(address(manager)), IERC20(address(usdc)), STRATEGIST);

        usdc.mint(ALICE, 1_000_000 * ONE_USDC);
        usdc.mint(BOB, 1_000_000 * ONE_USDC);
        vm.prank(ALICE);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(BOB);
        usdc.approve(address(vault), type(uint256).max);
    }

    // --- helpers -------------------------------------------------------------

    function _envelope(bytes20 eventId, uint256 nav, uint256 inputsBlock)
        internal
        view
        returns (IWavsServiceHandler.Envelope memory)
    {
        return IWavsServiceHandler.Envelope({
            eventId: eventId,
            ordering: bytes12(0),
            // Same bytes the NAV component signs:
            // abi.encode(handler, nav, inputsBlock), bound to this vault.
            payload: abi.encode(address(vault), nav, inputsBlock)
        });
    }

    function _sigs() internal pure returns (IWavsServiceHandler.SignatureData memory) {
        return IWavsServiceHandler.SignatureData({
            signers: new address[](0),
            signatures: new bytes[](0),
            referenceBlock: 0
        });
    }

    function _attest(bytes20 eventId, uint256 nav, uint256 inputsBlock) internal {
        vault.handleSignedEnvelope(_envelope(eventId, nav, inputsBlock), _sigs());
    }

    /// @dev Alice requests 1,000 USDC, bootstrap strike fulfills 1:1, Alice claims.
    function _bootstrapAlice() internal {
        vm.prank(ALICE);
        vault.requestDeposit(1_000 * ONE_USDC, ALICE, ALICE);
        _attest(bytes20(uint160(0xF00D01)), 0, 1);
        vm.prank(ALICE);
        vault.deposit(1_000 * ONE_USDC, ALICE);
    }

    // --- ERC-7540 request lifecycle: deposits --------------------------------

    function test_RequestDepositEscrowsAssetsAsPending() public {
        vm.prank(ALICE);
        uint256 requestId = vault.requestDeposit(1_000 * ONE_USDC, ALICE, ALICE);

        require(requestId == 0, "fungible requestId 0");
        require(usdc.balanceOf(address(vault)) == 1_000 * ONE_USDC, "assets escrowed");
        require(vault.pendingDepositRequest(0, ALICE) == 1_000 * ONE_USDC, "pending recorded");
        require(vault.claimableDepositRequest(0, ALICE) == 0, "nothing claimable yet");
        require(vault.totalSupply() == 0, "no shares minted yet");
    }

    function test_RequestDepositZeroReverts() public {
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(PriimeVault.ZeroAmount.selector));
        vault.requestDeposit(0, ALICE, ALICE);
    }

    function test_ClaimBeforeFulfillmentReverts() public {
        vm.prank(ALICE);
        vault.requestDeposit(1_000 * ONE_USDC, ALICE, ALICE);

        vm.prank(ALICE);
        vm.expectRevert(
            abi.encodeWithSelector(PriimeVault.ExceedsClaimable.selector, uint256(1_000 * ONE_USDC), uint256(0))
        );
        vault.deposit(1_000 * ONE_USDC, ALICE);

        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(PriimeVault.ExceedsClaimable.selector, uint256(1), uint256(0)));
        vault.mint(1, ALICE);
    }

    function test_StrikeFulfillsBootstrapDepositAndClaimMintsShares() public {
        vm.prank(ALICE);
        vault.requestDeposit(1_000 * ONE_USDC, ALICE, ALICE);

        // Bootstrap strike: no position yet, attested NAV 0; fulfillment prices
        // 1 share per USDC base unit and folds the deposit into NAV.
        _attest(bytes20(uint160(1)), 0, 1);

        require(vault.pendingDepositRequest(0, ALICE) == 0, "pending cleared");
        require(vault.claimableDepositRequest(0, ALICE) == 1_000 * ONE_USDC, "claimable assets");
        require(vault.maxDeposit(ALICE) == 1_000 * ONE_USDC, "maxDeposit tracks claimable");
        require(vault.maxMint(ALICE) == 1_000 * ONE_USDC, "maxMint at bootstrap price");
        require(vault.totalAssets() == 1_000 * ONE_USDC, "deposit folded into NAV");
        require(vault.totalSupply() == 1_000 * ONE_USDC, "shares escrowed in vault");
        require(vault.balanceOf(address(vault)) == 1_000 * ONE_USDC, "escrow holds shares");

        vm.prank(ALICE);
        uint256 shares = vault.deposit(1_000 * ONE_USDC, ALICE);

        require(shares == 1_000 * ONE_USDC, "bootstrap 1:1");
        require(vault.balanceOf(ALICE) == 1_000 * ONE_USDC, "shares delivered");
        require(vault.claimableDepositRequest(0, ALICE) == 0, "claimable consumed");
        require(vault.maxDeposit(ALICE) == 0, "maxDeposit back to zero");
    }

    function test_SecondDepositorFulfilledAtLaterStrikeGetsDifferentPrice() public {
        _bootstrapAlice();

        vm.prank(BOB);
        vault.requestDeposit(1_000 * ONE_USDC, BOB, BOB);

        // Position doubled: attested NAV 2,000 against 1,000 shares -> 2 USDC/share.
        _attest(bytes20(uint160(2)), 2_000 * ONE_USDC, 2);

        require(vault.claimableDepositRequest(0, BOB) == 1_000 * ONE_USDC, "bob claimable assets");
        require(vault.maxMint(BOB) == 500 * ONE_USDC, "bob shares priced at 2 USDC/share");
        require(vault.totalAssets() == 3_000 * ONE_USDC, "attested NAV plus fulfilled deposit");

        vm.prank(BOB);
        uint256 assets = vault.mint(500 * ONE_USDC, BOB);

        require(assets == 1_000 * ONE_USDC, "mint consumed full claim");
        require(vault.balanceOf(BOB) == 500 * ONE_USDC, "bob shares");
        require(vault.totalSupply() == 1_500 * ONE_USDC, "supply after both depositors");
    }

    // --- ERC-7540 request lifecycle: redemptions -----------------------------

    function test_RequestRedeemEscrowsSharesAndFulfillsAtStrikePrice() public {
        _bootstrapAlice();

        vm.prank(ALICE);
        uint256 requestId = vault.requestRedeem(400 * ONE_USDC, ALICE, ALICE);

        require(requestId == 0, "fungible requestId 0");
        require(vault.balanceOf(ALICE) == 600 * ONE_USDC, "shares escrowed away from owner");
        require(vault.pendingRedeemRequest(0, ALICE) == 400 * ONE_USDC, "pending shares");
        require(vault.claimableRedeemRequest(0, ALICE) == 0, "nothing claimable yet");

        // Position gained 50%: attested NAV 1,500 against 1,000 shares -> 1.5 USDC/share.
        usdc.mint(address(vault), 500 * ONE_USDC); // the gain, as claimable liquidity
        _attest(bytes20(uint160(2)), 1_500 * ONE_USDC, 2);

        require(vault.pendingRedeemRequest(0, ALICE) == 0, "pending cleared");
        require(vault.claimableRedeemRequest(0, ALICE) == 400 * ONE_USDC, "claimable shares");
        require(vault.maxRedeem(ALICE) == 400 * ONE_USDC, "maxRedeem tracks claimable");
        require(vault.maxWithdraw(ALICE) == 600 * ONE_USDC, "maxWithdraw at strike price");
        require(vault.totalSupply() == 600 * ONE_USDC, "redeemed shares burned");
        require(vault.totalAssets() == 900 * ONE_USDC, "payout carved out of NAV");

        uint256 before = usdc.balanceOf(ALICE);
        vm.prank(ALICE);
        uint256 assets = vault.redeem(400 * ONE_USDC, ALICE, ALICE);

        require(assets == 600 * ONE_USDC, "payout at 1.5 USDC/share");
        require(usdc.balanceOf(ALICE) - before == 600 * ONE_USDC, "assets delivered");
        require(vault.claimableRedeemRequest(0, ALICE) == 0, "claim consumed");
    }

    function test_WithdrawClaimsFulfilledRedemptionByAssets() public {
        _bootstrapAlice();

        vm.prank(ALICE);
        vault.requestRedeem(400 * ONE_USDC, ALICE, ALICE);
        usdc.mint(address(vault), 500 * ONE_USDC);
        _attest(bytes20(uint160(2)), 1_500 * ONE_USDC, 2);

        // Partial claim by assets: 300 USDC at 1.5 USDC/share burns a 200-share claim.
        uint256 before = usdc.balanceOf(ALICE);
        vm.prank(ALICE);
        uint256 shares = vault.withdraw(300 * ONE_USDC, ALICE, ALICE);

        require(shares == 200 * ONE_USDC, "claim shares consumed pro rata");
        require(usdc.balanceOf(ALICE) - before == 300 * ONE_USDC, "partial payout");
        require(vault.claimableRedeemRequest(0, ALICE) == 200 * ONE_USDC, "remainder claimable");

        vm.prank(ALICE);
        uint256 rest = vault.redeem(200 * ONE_USDC, ALICE, ALICE);
        require(rest == 300 * ONE_USDC, "remainder at same price");
    }

    // --- operator model ------------------------------------------------------

    function test_OperatorCanRequestAndClaimOnBehalf() public {
        vm.prank(ALICE);
        vault.setOperator(BOB, true);
        require(vault.isOperator(ALICE, BOB), "operator recorded");

        vm.prank(BOB);
        vault.requestDeposit(1_000 * ONE_USDC, ALICE, ALICE);
        require(vault.pendingDepositRequest(0, ALICE) == 1_000 * ONE_USDC, "request for alice");

        _attest(bytes20(uint160(1)), 0, 1);

        vm.prank(BOB);
        vault.deposit(1_000 * ONE_USDC, ALICE, ALICE);
        require(vault.balanceOf(ALICE) == 1_000 * ONE_USDC, "shares to alice");
    }

    function test_NonOperatorCannotRequestOrClaim() public {
        vm.prank(BOB);
        vm.expectRevert(abi.encodeWithSelector(PriimeVault.NotOwnerOrOperator.selector));
        vault.requestDeposit(1_000 * ONE_USDC, ALICE, ALICE);

        vm.prank(ALICE);
        vault.requestDeposit(1_000 * ONE_USDC, ALICE, ALICE);
        _attest(bytes20(uint160(1)), 0, 1);

        vm.prank(BOB);
        vm.expectRevert(abi.encodeWithSelector(PriimeVault.NotControllerOrOperator.selector));
        vault.deposit(1_000 * ONE_USDC, BOB, ALICE);
    }

    // --- 7540 overrides of the sync 4626 surface -----------------------------

    function test_PreviewFunctionsRevert() public {
        bytes memory err = abi.encodeWithSelector(PriimeVault.AsyncFlowOnly.selector);
        vm.expectRevert(err);
        vault.previewDeposit(1);
        vm.expectRevert(err);
        vault.previewMint(1);
        vm.expectRevert(err);
        vault.previewWithdraw(1);
        vm.expectRevert(err);
        vault.previewRedeem(1);
    }

    function test_SupportsInterfaceReturnsEipIds() public view {
        require(vault.supportsInterface(0x01ffc9a7), "ERC-165");
        require(vault.supportsInterface(0xe3bc4e65), "7540 operator methods");
        require(vault.supportsInterface(0x2f0a18c5), "ERC-7575");
        require(vault.supportsInterface(0xce3bbe50), "async deposit vault");
        require(vault.supportsInterface(0x620ee8e4), "async redeem vault");
        require(!vault.supportsInterface(0xffffffff), "0xffffffff must be false");
        require(vault.share() == address(vault), "ERC-7575 share is the vault itself");
    }

    // --- NAV accounting coherence --------------------------------------------

    function test_PendingDepositAssetsExcludedFromTotalAssets() public {
        _bootstrapAlice();
        require(vault.totalAssets() == 1_000 * ONE_USDC, "baseline NAV");

        vm.prank(BOB);
        vault.requestDeposit(500 * ONE_USDC, BOB, BOB);

        require(vault.totalAssets() == 1_000 * ONE_USDC, "pending escrow not in NAV");
        require(vault.totalPendingDepositAssets() == 500 * ONE_USDC, "escrow tracked separately");
    }

    function test_BootstrapDiscardsPhantomPreSupplyNav() public {
        // A strike lands before any shares exist (hello-nav's constant 42 would
        // do exactly this), attesting value the vault holds no assets for.
        _attest(bytes20(uint160(0xBAD)), 42 * ONE_USDC, 1);
        require(vault.totalAssets() == 42 * ONE_USDC, "phantom NAV recorded pre-supply");

        vm.prank(ALICE);
        vault.requestDeposit(1_000 * ONE_USDC, ALICE, ALICE);
        _attest(bytes20(uint160(0xBAD2)), 42 * ONE_USDC, 2);

        // Bootstrap replaces the pre-supply NAV: the share pool is backed only
        // by assets actually folded in.
        require(vault.totalAssets() == 1_000 * ONE_USDC, "phantom NAV discarded at bootstrap");

        vm.prank(ALICE);
        vault.deposit(1_000 * ONE_USDC, ALICE);
        vm.prank(ALICE);
        vault.requestRedeem(1_000 * ONE_USDC, ALICE, ALICE);
        _attest(bytes20(uint160(0xBAD3)), 1_000 * ONE_USDC, 3);

        // Full exit pays exactly what was deposited, covered by real USDC.
        uint256 before = usdc.balanceOf(ALICE);
        vm.prank(ALICE);
        uint256 assets = vault.redeem(1_000 * ONE_USDC, ALICE, ALICE);
        require(assets == 1_000 * ONE_USDC, "solvent full exit at 1:1");
        require(usdc.balanceOf(ALICE) - before == 1_000 * ONE_USDC, "payout delivered");
    }

    // --- strategist execution path -------------------------------------------

    function test_StrategistCanExecuteAgainstFreeBalance() public {
        _bootstrapAlice(); // vault holds 1,000 USDC, all folded into NAV, no escrow

        // Route an approval through execute (how the loop script will arm Morpho).
        vm.prank(STRATEGIST);
        bytes memory ret = vault.execute(address(usdc), abi.encodeCall(TestUSDC.approve, (SINK, 250 * ONE_USDC)));
        require(abi.decode(ret, (bool)), "approve returned true through execute");
        require(usdc.allowance(address(vault), SINK) == 250 * ONE_USDC, "allowance set from vault");

        // Deploy free capital out of the vault (stand-in for a Morpho supply).
        vm.prank(STRATEGIST);
        vault.execute(address(usdc), abi.encodeCall(TestUSDC.transfer, (SINK, 400 * ONE_USDC)));
        require(usdc.balanceOf(SINK) == 400 * ONE_USDC, "free balance deployed");
        require(usdc.balanceOf(address(vault)) == 600 * ONE_USDC, "vault balance reduced");
    }

    function test_NonStrategistCannotExecute() public {
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(PriimeVault.NotStrategist.selector));
        vault.execute(address(usdc), abi.encodeCall(TestUSDC.transfer, (SINK, 1)));
    }

    function test_ExecuteCannotTargetVaultItself() public {
        vm.prank(STRATEGIST);
        vm.expectRevert(abi.encodeWithSelector(PriimeVault.SelfCallForbidden.selector));
        vault.execute(address(vault), abi.encodeCall(PriimeVault.setOperator, (STRATEGIST, true)));
    }

    function test_ExecuteCannotSpendPendingDepositEscrow() public {
        _bootstrapAlice(); // 1,000 USDC free (folded into NAV)

        vm.prank(BOB);
        vault.requestDeposit(500 * ONE_USDC, BOB, BOB); // escrow floor now 500

        // Balance 1,500; spending 1,100 would leave 400 < 500 escrow floor.
        vm.prank(STRATEGIST);
        vm.expectRevert(
            abi.encodeWithSelector(
                PriimeVault.EscrowFloorBreached.selector, uint256(400 * ONE_USDC), uint256(500 * ONE_USDC)
            )
        );
        vault.execute(address(usdc), abi.encodeCall(TestUSDC.transfer, (SINK, 1_100 * ONE_USDC)));

        // Spending exactly the free 1,000 is allowed (balance lands on the floor).
        vm.prank(STRATEGIST);
        vault.execute(address(usdc), abi.encodeCall(TestUSDC.transfer, (SINK, 1_000 * ONE_USDC)));
        require(usdc.balanceOf(address(vault)) == 500 * ONE_USDC, "escrow floor intact");
    }

    function test_ExecuteCannotSpendReservedRedemptionPayouts() public {
        _bootstrapAlice();

        vm.prank(ALICE);
        vault.requestRedeem(400 * ONE_USDC, ALICE, ALICE);
        _attest(bytes20(uint160(0xF00D02)), 1_000 * ONE_USDC, 2); // payout 400 reserved

        // Balance 1,000; reserved 400; spending 700 would leave 300 < 400.
        vm.prank(STRATEGIST);
        vm.expectRevert(
            abi.encodeWithSelector(
                PriimeVault.EscrowFloorBreached.selector, uint256(300 * ONE_USDC), uint256(400 * ONE_USDC)
            )
        );
        vault.execute(address(usdc), abi.encodeCall(TestUSDC.transfer, (SINK, 700 * ONE_USDC)));
    }

    function test_ExecuteBubblesTargetRevertData() public {
        RevertingTarget target = new RevertingTarget();

        vm.prank(STRATEGIST);
        vm.expectRevert(abi.encodeWithSelector(RevertingTarget.Boom.selector, uint256(42)));
        vault.execute(address(target), abi.encodeCall(RevertingTarget.kaboom, ()));
    }

    // --- VAULT-02: NAV update through the service-manager seam ---------------

    function test_ValidUpdateAccepted() public {
        _attest(bytes20(uint160(1)), 4_242 * ONE_USDC, 100);

        require(vault.totalAssets() == 4_242 * ONE_USDC, "nav recorded");
        require(vault.lastInputsBlock() == 100, "inputs block recorded");
        require(vault.updateCount() == 1, "update counted");
        require(vault.processed(bytes20(uint160(1))), "eventId marked processed");
    }

    function test_UpdateRejectedWhenValidationFails() public {
        manager.setReject(true);

        vm.expectRevert(abi.encodeWithSelector(ToggleableServiceManager.ValidationRejected.selector));
        vault.handleSignedEnvelope(_envelope(bytes20(uint160(1)), 4_242 * ONE_USDC, 100), _sigs());

        require(vault.totalAssets() == 0, "nav untouched");
        require(vault.lastInputsBlock() == 0, "inputs block untouched");
        require(vault.updateCount() == 0, "no update recorded");
        require(!vault.processed(bytes20(uint160(1))), "eventId not consumed");
    }

    // --- VAULT-03: replay + staleness guards ---------------------------------

    function test_ReplayedEventIdRejected() public {
        _attest(bytes20(uint160(1)), 1_000 * ONE_USDC, 100);

        // Same eventId again, even with a fresh inputs block, must be rejected.
        vm.expectRevert(abi.encodeWithSelector(PriimeVault.AlreadyProcessed.selector, bytes20(uint160(1))));
        vault.handleSignedEnvelope(_envelope(bytes20(uint160(1)), 9_999 * ONE_USDC, 200), _sigs());

        require(vault.totalAssets() == 1_000 * ONE_USDC, "nav unchanged after replay");
        require(vault.updateCount() == 1, "replay not counted");
    }

    function test_EnvelopeBoundToOtherHandlerRejected() public {
        // Payload names a handler that is not this vault; must be rejected
        // before any state is touched, regardless of quorum validity.
        address other = address(0xDEAD);
        IWavsServiceHandler.Envelope memory env = IWavsServiceHandler.Envelope({
            eventId: bytes20(uint160(1)),
            ordering: bytes12(0),
            payload: abi.encode(other, uint256(1_000 * ONE_USDC), uint256(100))
        });

        vm.expectRevert(abi.encodeWithSelector(PriimeVault.HandlerMismatch.selector, other));
        vault.handleSignedEnvelope(env, _sigs());

        require(vault.totalAssets() == 0, "nav untouched");
        require(vault.lastInputsBlock() == 0, "inputs block untouched");
        require(vault.updateCount() == 0, "no update recorded");
        require(!vault.processed(bytes20(uint160(1))), "eventId not consumed");
    }

    function test_StaleInputsBlockRejected() public {
        _attest(bytes20(uint160(1)), 1_000 * ONE_USDC, 100);

        // Equal inputs block: rejected.
        vm.expectRevert(abi.encodeWithSelector(PriimeVault.StaleInputsBlock.selector, uint256(100), uint256(100)));
        vault.handleSignedEnvelope(_envelope(bytes20(uint160(2)), 9_999 * ONE_USDC, 100), _sigs());

        // Older inputs block: a delayed-but-valid envelope cannot move NAV backwards.
        vm.expectRevert(abi.encodeWithSelector(PriimeVault.StaleInputsBlock.selector, uint256(99), uint256(100)));
        vault.handleSignedEnvelope(_envelope(bytes20(uint160(3)), 9_999 * ONE_USDC, 99), _sigs());

        require(vault.totalAssets() == 1_000 * ONE_USDC, "nav unchanged after stale updates");
        require(vault.lastInputsBlock() == 100, "inputs block unchanged");
        require(vault.updateCount() == 1, "stale updates not counted");
    }
}
