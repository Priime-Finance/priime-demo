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
    function roll(uint256) external;
    function expectEmit(bool, bool, bool, bool) external;
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

    /// @dev Bytes the vault is expected to forward, hashed. Zero disables the
    ///      check, which is the default for every other test.
    bytes32 public expectedEnvelopeHash;
    bytes32 public expectedSignatureHash;

    error ValidationRejected();
    error EnvelopeNotForwardedVerbatim(bytes32 expected, bytes32 received);
    error SignatureNotForwardedVerbatim(bytes32 expected, bytes32 received);

    function setReject(bool _reject) external {
        reject = _reject;
    }

    /// @dev Pin the exact envelope and signature bytes the vault must hand to
    ///      `validate`.
    ///
    ///      `IWavsServiceManager.validate` is `view`, so the vault reaches it
    ///      through a STATICCALL and no mock can write down what it saw. The
    ///      check is therefore inverted: the test states the bytes up front and
    ///      `validate` fails the call when anything else arrives, so a
    ///      successful `handleSignedEnvelope` is itself proof that the envelope
    ///      and signature data crossed the seam unchanged.
    function expectForwarded(
        IWavsServiceHandler.Envelope calldata envelope,
        IWavsServiceHandler.SignatureData calldata signatureData
    ) external {
        expectedEnvelopeHash = keccak256(abi.encode(envelope));
        expectedSignatureHash = keccak256(abi.encode(signatureData));
    }

    function validate(
        IWavsServiceHandler.Envelope calldata envelope,
        IWavsServiceHandler.SignatureData calldata signatureData
    ) external view {
        if (reject) revert ValidationRejected();
        if (expectedEnvelopeHash != bytes32(0)) {
            bytes32 envelopeHash = keccak256(abi.encode(envelope));
            if (envelopeHash != expectedEnvelopeHash) {
                revert EnvelopeNotForwardedVerbatim(expectedEnvelopeHash, envelopeHash);
            }
            bytes32 signatureHash = keccak256(abi.encode(signatureData));
            if (signatureHash != expectedSignatureHash) {
                revert SignatureNotForwardedVerbatim(expectedSignatureHash, signatureHash);
            }
        }
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
    address internal constant CAROL = address(0xCA401);
    address internal constant STRATEGIST = address(0x57121);
    address internal constant SINK = address(0x51D4);

    uint256 internal constant ONE_USDC = 1e6;

    function setUp() public {
        // `inputsBlock` is bounded above by the current height, so run the
        // suite from a block far enough along that the fixtures' inputs blocks
        // are legitimate past heights.
        vm.roll(1_000);

        usdc = new TestUSDC();
        manager = new ToggleableServiceManager();
        vault = new PriimeVault(IWavsServiceManager(address(manager)), IERC20(address(usdc)), STRATEGIST);

        usdc.mint(ALICE, 1_000_000 * ONE_USDC);
        usdc.mint(BOB, 1_000_000 * ONE_USDC);
        usdc.mint(CAROL, 1_000_000 * ONE_USDC);
        vm.prank(ALICE);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(BOB);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(CAROL);
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

    function test_OneStrikeFulfillsEveryQueuedControllerAtOnePrice() public {
        _bootstrapAlice(); // supply 1,000 shares, nav 1,000, Alice holds them

        vm.prank(BOB);
        vault.requestDeposit(600 * ONE_USDC, BOB, BOB);
        vm.prank(CAROL);
        vault.requestDeposit(200 * ONE_USDC, CAROL, CAROL);
        vm.prank(ALICE);
        vault.requestRedeem(250 * ONE_USDC, ALICE, ALICE);

        // One strike, 2 USDC/share: every queued controller settles at that
        // price, and folding each deposit in keeps the price flat across the loop.
        _attest(bytes20(uint160(0xC0FFEE)), 2_000 * ONE_USDC, 2);

        require(vault.maxDeposit(BOB) == 600 * ONE_USDC, "bob claimable assets");
        require(vault.maxMint(BOB) == 300 * ONE_USDC, "bob shares at 2/share");
        require(vault.maxDeposit(CAROL) == 200 * ONE_USDC, "carol claimable assets");
        require(vault.maxMint(CAROL) == 100 * ONE_USDC, "carol shares at the same price");
        require(vault.maxRedeem(ALICE) == 250 * ONE_USDC, "alice claimable shares");
        require(vault.maxWithdraw(ALICE) == 500 * ONE_USDC, "alice payout at the same price");

        require(vault.totalPendingDepositAssets() == 0, "deposit queue drained");
        require(vault.totalPendingRedeemShares() == 0, "redeem queue drained");
        require(vault.totalClaimableRedeemAssets() == 500 * ONE_USDC, "payout reserved");
        require(vault.totalSupply() == 1_150 * ONE_USDC, "1,000 + 400 minted - 250 burned");
        require(vault.totalAssets() == 2_300 * ONE_USDC, "2,000 + 800 folded in - 500 carved out");

        // Every controller gets exactly what was recorded for them.
        vm.prank(BOB);
        require(vault.deposit(600 * ONE_USDC, BOB) == 300 * ONE_USDC, "bob claims his shares");
        vm.prank(CAROL);
        require(vault.deposit(200 * ONE_USDC, CAROL) == 100 * ONE_USDC, "carol claims hers");
        uint256 before = usdc.balanceOf(ALICE);
        vm.prank(ALICE);
        require(vault.redeem(250 * ONE_USDC, ALICE, ALICE) == 500 * ONE_USDC, "alice claims her payout");
        require(usdc.balanceOf(ALICE) - before == 500 * ONE_USDC, "payout delivered");

        // The queues really were consumed: a later strike settles nothing new.
        _attest(bytes20(uint160(0xC0FFEF)), 2_300 * ONE_USDC, 3);
        require(vault.totalSupply() == 1_150 * ONE_USDC, "no double fulfillment");
        require(vault.totalAssets() == 2_300 * ONE_USDC, "nav is purely the new attestation");
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

    // --- partial claims: no phantom claims, no stranded dust -----------------

    function test_PartialRedeemSettlesBucketWhenPayoutRoundsToZero() public {
        _bootstrapAlice();

        vm.prank(ALICE);
        vault.requestRedeem(400 * ONE_USDC, ALICE, ALICE);

        // Total loss: the redemption is fulfilled at a zero payout, so the
        // bucket carries shares on one side and nothing on the other.
        _attest(bytes20(uint160(0xD05)), 0, 2);
        require(vault.maxRedeem(ALICE) == 400 * ONE_USDC, "claimable shares recorded");
        require(vault.maxWithdraw(ALICE) == 0, "nothing to pay out");

        // A partial claim empties the assets side, so it must settle the whole
        // bucket: anything left behind is worth zero forever and would keep
        // reporting as claimable.
        vm.prank(ALICE);
        uint256 assets = vault.redeem(1, ALICE, ALICE);

        require(assets == 0, "zero payout at zero NAV");
        require(vault.maxRedeem(ALICE) == 0, "no phantom shares left behind");
        require(vault.maxWithdraw(ALICE) == 0, "no phantom assets left behind");
        require(vault.claimableRedeemRequest(0, ALICE) == 0, "bucket closed");
        require(vault.totalClaimableRedeemAssets() == 0, "no stranded reserve");
    }

    function test_RepeatedPartialRedeemClaimsDrainBothSidesWithoutDust() public {
        _bootstrapAlice();

        vm.prank(ALICE);
        vault.requestRedeem(900 * ONE_USDC, ALICE, ALICE);
        // Awkward price (0.333333333 USDC/share) so every partial claim floors.
        _attest(bytes20(uint160(0xD06)), 333_333_333, 2);

        uint256 reserved = vault.maxWithdraw(ALICE);
        require(reserved == 299_999_999, "payout floors against the vault");
        require(vault.totalClaimableRedeemAssets() == reserved, "reserve tracked");

        uint256 before = usdc.balanceOf(ALICE);

        vm.prank(ALICE);
        vault.withdraw(100 * ONE_USDC, ALICE, ALICE);
        vm.prank(ALICE);
        vault.redeem(200 * ONE_USDC, ALICE, ALICE);

        uint256 halfAssets = vault.maxWithdraw(ALICE) / 2;
        vm.prank(ALICE);
        vault.withdraw(halfAssets, ALICE, ALICE);

        uint256 restShares = vault.maxRedeem(ALICE);
        vm.prank(ALICE);
        vault.redeem(restShares, ALICE, ALICE);

        require(vault.maxRedeem(ALICE) == 0, "shares side empty");
        require(vault.maxWithdraw(ALICE) == 0, "assets side empty");
        require(vault.claimableRedeemRequest(0, ALICE) == 0, "bucket closed");
        require(vault.totalClaimableRedeemAssets() == 0, "no dust stranded in the reserve");
        require(usdc.balanceOf(ALICE) - before == reserved, "every reserved base unit delivered");
    }

    function test_PartialDepositClaimsSplitProRataAndCloseTheBucket() public {
        _bootstrapAlice();

        vm.prank(BOB);
        vault.requestDeposit(900 * ONE_USDC, BOB, BOB);
        // 1.5 USDC/share: 900 USDC buys 600 shares.
        _attest(bytes20(uint160(0xD07)), 1_500 * ONE_USDC, 2);

        require(vault.maxDeposit(BOB) == 900 * ONE_USDC, "claimable assets");
        require(vault.maxMint(BOB) == 600 * ONE_USDC, "claimable shares at 1.5/share");

        vm.prank(BOB);
        uint256 firstHalf = vault.deposit(450 * ONE_USDC, BOB);
        require(firstHalf == 300 * ONE_USDC, "half the assets claim half the shares");
        require(vault.maxDeposit(BOB) == 450 * ONE_USDC, "half the assets left");
        require(vault.maxMint(BOB) == 300 * ONE_USDC, "half the shares left");

        vm.prank(BOB);
        uint256 rest = vault.deposit(450 * ONE_USDC, BOB);
        require(rest == 300 * ONE_USDC, "remainder at the same price");
        require(vault.maxDeposit(BOB) == 0, "assets side empty");
        require(vault.maxMint(BOB) == 0, "shares side empty");
        require(vault.balanceOf(BOB) == 600 * ONE_USDC, "all shares delivered");
        require(vault.balanceOf(address(vault)) == 0, "no shares stranded in escrow");
    }

    // --- queue cap -----------------------------------------------------------

    /// @dev `cap + 1` distinct controllers: one more than a queue can hold.
    function _fillers(uint256 offset, uint256 count) internal pure returns (address[] memory controllers) {
        controllers = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            // forge-lint: disable-next-line(unsafe-typecast)
            controllers[i] = address(uint160(offset + i));
        }
    }

    function test_DepositQueueIsCapped() public {
        uint256 cap = vault.MAX_QUEUE_LENGTH();
        address[] memory controllers = _fillers(0x1000, cap + 1);

        for (uint256 i = 0; i < cap; i++) {
            vm.prank(ALICE);
            vault.requestDeposit(ONE_USDC, controllers[i], ALICE);
        }

        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(PriimeVault.QueueFull.selector));
        vault.requestDeposit(ONE_USDC, controllers[cap], ALICE);

        // A controller already in the queue takes no new slot, so top-ups still work.
        vm.prank(ALICE);
        vault.requestDeposit(ONE_USDC, controllers[0], ALICE);
        require(vault.pendingDepositRequest(0, controllers[0]) == 2 * ONE_USDC, "top-up allowed at cap");
    }

    function test_RedeemQueueIsCapped() public {
        _bootstrapAlice(); // Alice holds 1,000 shares
        uint256 cap = vault.MAX_QUEUE_LENGTH();
        address[] memory controllers = _fillers(0x2000, cap + 1);

        for (uint256 i = 0; i < cap; i++) {
            vm.prank(ALICE);
            vault.requestRedeem(1, controllers[i], ALICE);
        }

        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(PriimeVault.QueueFull.selector));
        vault.requestRedeem(1, controllers[cap], ALICE);

        vm.prank(ALICE);
        vault.requestRedeem(1, controllers[0], ALICE);
        require(vault.pendingRedeemRequest(0, controllers[0]) == 2, "top-up allowed at cap");
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

    function test_BootstrapFoldsDepositIntoStandingAttestedNav() public {
        // A strike lands before any shares exist, attesting a position the
        // vault already holds (here: 42 USDC of strategy value).
        _attest(bytes20(uint160(0xBAD)), 42 * ONE_USDC, 1);
        require(vault.totalAssets() == 42 * ONE_USDC, "pre-supply NAV recorded");
        usdc.mint(address(vault), 42 * ONE_USDC); // the attested value, as real cash

        vm.prank(ALICE);
        vault.requestDeposit(1_000 * ONE_USDC, ALICE, ALICE);
        _attest(bytes20(uint160(0xBAD2)), 42 * ONE_USDC, 2);

        // Bootstrap folds the deposit into the standing NAV rather than
        // replacing it. The bootstrap holder owns the whole pool, so the
        // standing value is theirs; the price they paid (1 share per base
        // unit) is the bootstrap convention, not a claim about the pool size.
        require(vault.totalAssets() == 1_042 * ONE_USDC, "standing NAV preserved plus deposit");
        require(vault.maxMint(ALICE) == 1_000 * ONE_USDC, "bootstrap 1 share per base unit");

        vm.prank(ALICE);
        vault.deposit(1_000 * ONE_USDC, ALICE);
        vm.prank(ALICE);
        vault.requestRedeem(1_000 * ONE_USDC, ALICE, ALICE);
        _attest(bytes20(uint160(0xBAD3)), 1_042 * ONE_USDC, 3);

        // Full exit pays out the whole pool, covered by real USDC.
        uint256 before = usdc.balanceOf(ALICE);
        vm.prank(ALICE);
        uint256 assets = vault.redeem(1_000 * ONE_USDC, ALICE, ALICE);
        require(assets == 1_042 * ONE_USDC, "solvent full exit takes the whole pool");
        require(usdc.balanceOf(ALICE) - before == 1_042 * ONE_USDC, "payout delivered");
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

    /// @dev The guarantee `execute` actually holds is a post-call balance floor,
    ///      not "escrow can never be spent": the check only sees the vault's
    ///      balance when the call returns. An allowance granted through
    ///      `execute` can be pulled afterwards and take the balance below the
    ///      floor with nothing to revert (see
    ///      `test_ExecuteFloorDoesNotBindAllowancesPulledLater`). Approvals are
    ///      therefore expected to be exact-amount and revoked by the strategist.
    function test_ExecuteRevertsWhenPostCallBalanceBelowDepositEscrowFloor() public {
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

    /// @dev Same caveat as the deposit-escrow case above: this pins the
    ///      post-call balance floor, not an unspendable reserve.
    function test_ExecuteRevertsWhenPostCallBalanceBelowRedemptionReserveFloor() public {
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

    /// @dev The honest limit of the floor check, pinned so nobody reads the two
    ///      tests above as an escrow guarantee. The contract deliberately does
    ///      not track allowances (see `execute`'s natspec); the mitigation is
    ///      operational (exact-amount approvals, revoked after the entry
    ///      sequence), not enforced on chain.
    function test_ExecuteFloorDoesNotBindAllowancesPulledLater() public {
        _bootstrapAlice();

        vm.prank(BOB);
        vault.requestDeposit(500 * ONE_USDC, BOB, BOB); // escrow floor 500, balance 1,500

        // The approval itself passes the floor check: it moves no balance.
        vm.prank(STRATEGIST);
        vault.execute(address(usdc), abi.encodeCall(TestUSDC.approve, (SINK, 1_500 * ONE_USDC)));

        // Pulled later, outside any `execute` frame, it drains the escrow with
        // nothing left to revert.
        vm.prank(SINK);
        require(usdc.transferFrom(address(vault), SINK, 1_500 * ONE_USDC), "pull succeeds");

        require(usdc.balanceOf(address(vault)) == 0, "floor does not survive the allowance");
        require(vault.totalPendingDepositAssets() == 500 * ONE_USDC, "escrow still owed on the books");
    }

    function test_ExecuteEmitsExecutedAfterTheFloorCheck() public {
        _bootstrapAlice();

        bytes memory data = abi.encodeCall(TestUSDC.transfer, (SINK, 400 * ONE_USDC));

        vm.expectEmit(true, false, false, true);
        emit PriimeVault.Executed(address(usdc), data);
        vm.prank(STRATEGIST);
        vault.execute(address(usdc), data);
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

    function test_FutureInputsBlockRejected() public {
        _attest(bytes20(uint160(1)), 1_000 * ONE_USDC, 100);

        // A block height the chain has not reached cannot have been read.
        uint256 future = block.number + 1;
        vm.expectRevert(abi.encodeWithSelector(PriimeVault.FutureInputsBlock.selector, future, block.number));
        vault.handleSignedEnvelope(_envelope(bytes20(uint160(2)), 9_999 * ONE_USDC, future), _sigs());

        // The bricking case: one corrupt quorum signing uint256.max would
        // otherwise raise the staleness floor beyond any reachable height and
        // freeze NAV forever.
        vm.expectRevert(
            abi.encodeWithSelector(PriimeVault.FutureInputsBlock.selector, type(uint256).max, block.number)
        );
        vault.handleSignedEnvelope(_envelope(bytes20(uint160(3)), 9_999 * ONE_USDC, type(uint256).max), _sigs());

        require(vault.lastInputsBlock() == 100, "inputs block unchanged");
        require(vault.updateCount() == 1, "rejected updates not counted");

        // Legitimate updates still land afterwards.
        _attest(bytes20(uint160(4)), 2_000 * ONE_USDC, 101);
        require(vault.totalAssets() == 2_000 * ONE_USDC, "vault not bricked");
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

    function test_ReBootstrapAfterFullExitPreservesAttestedNav() public {
        _bootstrapAlice();

        // Full exit: every share redeemed, supply back to zero.
        vm.prank(ALICE);
        vault.requestRedeem(1_000 * ONE_USDC, ALICE, ALICE);
        _attest(bytes20(uint160(0xE0)), 1_000 * ONE_USDC, 2);
        vm.prank(ALICE);
        vault.redeem(1_000 * ONE_USDC, ALICE, ALICE);
        require(vault.totalSupply() == 0, "supply fully exited");
        require(vault.totalAssets() == 0, "nav fully carved out");

        // A residual strategy position survives the exit and is attested.
        _attest(bytes20(uint160(0xE1)), 50 * ONE_USDC, 3);
        require(vault.totalAssets() == 50 * ONE_USDC, "residual attested");

        // Re-bootstrap: the new depositor prices 1 share per base unit, but the
        // residual value is kept, not discarded.
        vm.prank(BOB);
        vault.requestDeposit(200 * ONE_USDC, BOB, BOB);
        _attest(bytes20(uint160(0xE2)), 50 * ONE_USDC, 4);

        require(vault.totalAssets() == 250 * ONE_USDC, "residual preserved plus folded deposit");
        require(vault.maxMint(BOB) == 200 * ONE_USDC, "bootstrap prices 1 share per base unit");
        require(vault.totalSupply() == 200 * ONE_USDC, "supply re-bootstrapped");

        // Bob is the only holder, so his shares are worth the whole pool.
        vm.prank(BOB);
        vault.mint(200 * ONE_USDC, BOB);
        vm.prank(BOB);
        vault.requestRedeem(200 * ONE_USDC, BOB, BOB);
        usdc.mint(address(vault), 50 * ONE_USDC); // residual realized as cash
        _attest(bytes20(uint160(0xE3)), 250 * ONE_USDC, 5);

        vm.prank(BOB);
        uint256 assets = vault.redeem(200 * ONE_USDC, BOB, BOB);
        require(assets == 250 * ONE_USDC, "bob's shares are worth the whole pool");
    }

    // --- unpriceable deposits: refund instead of revert or zero-share mint ----

    function test_ZeroNavStrikeRefundsPendingDepositAndKeepsUpdatesFlowing() public {
        _bootstrapAlice(); // supply 1,000 shares, nav 1,000

        vm.prank(BOB);
        vault.requestDeposit(500 * ONE_USDC, BOB, BOB);
        uint256 bobBefore = usdc.balanceOf(BOB);

        // Total loss: the attested NAV is zero while shares are still
        // outstanding, so Bob's deposit has no price. It must be refunded, not
        // reverted (a revert would brick every future strike) and not folded in
        // at zero shares (that would donate it to Alice).
        _attest(bytes20(uint160(0xF00D03)), 0, 2);

        require(usdc.balanceOf(BOB) - bobBefore == 500 * ONE_USDC, "deposit refunded to controller");
        require(vault.pendingDepositRequest(0, BOB) == 0, "pending cleared");
        require(vault.claimableDepositRequest(0, BOB) == 0, "nothing claimable");
        require(vault.maxMint(BOB) == 0, "no shares minted");
        require(vault.totalPendingDepositAssets() == 0, "escrow released");
        require(vault.totalAssets() == 0, "refund not folded into NAV");
        require(vault.totalSupply() == 1_000 * ONE_USDC, "supply untouched");
        require(vault.updateCount() == 2, "strike accepted");

        // The vault is not bricked: a later strike still lands and prices.
        _attest(bytes20(uint160(0xF00D04)), 800 * ONE_USDC, 3);
        require(vault.totalAssets() == 800 * ONE_USDC, "later strike still works");
        require(vault.updateCount() == 3, "later strike counted");
    }

    function test_ZeroShareDustDepositIsRefunded() public {
        _bootstrapAlice();

        // Share price is 10,000 USDC/share after the strike below, so a 1-base-unit
        // deposit prices to zero shares: refund rather than donate it to Alice.
        vm.prank(BOB);
        vault.requestDeposit(1, BOB, BOB);
        uint256 bobBefore = usdc.balanceOf(BOB);

        _attest(bytes20(uint160(0xF00D05)), 10_000_000 * ONE_USDC, 2);

        require(usdc.balanceOf(BOB) - bobBefore == 1, "dust refunded");
        require(vault.maxMint(BOB) == 0, "no shares for dust");
        require(vault.maxDeposit(BOB) == 0, "nothing claimable");
        require(vault.totalAssets() == 10_000_000 * ONE_USDC, "dust not folded into NAV");
        require(vault.totalSupply() == 1_000 * ONE_USDC, "supply untouched");
    }

    // --- event surface -------------------------------------------------------

    function test_RequestPathsEmitErc7540RequestEvents() public {
        vm.expectEmit(true, true, true, true);
        emit PriimeVault.DepositRequest(ALICE, ALICE, 0, ALICE, 1_000 * ONE_USDC);
        vm.prank(ALICE);
        vault.requestDeposit(1_000 * ONE_USDC, ALICE, ALICE);

        _attest(bytes20(uint160(0xE7E20)), 0, 1);
        vm.prank(ALICE);
        vault.deposit(1_000 * ONE_USDC, ALICE);

        // Submitted by an operator, so `sender` differs from owner/controller.
        vm.prank(ALICE);
        vault.setOperator(BOB, true);
        vm.expectEmit(true, true, true, true);
        emit PriimeVault.RedeemRequest(ALICE, ALICE, 0, BOB, 400 * ONE_USDC);
        vm.prank(BOB);
        vault.requestRedeem(400 * ONE_USDC, ALICE, ALICE);
    }

    function test_StrikeEmitsFulfillmentAndNavEvents() public {
        _bootstrapAlice();

        vm.prank(BOB);
        vault.requestDeposit(600 * ONE_USDC, BOB, BOB);
        vm.prank(ALICE);
        vault.requestRedeem(250 * ONE_USDC, ALICE, ALICE);

        // Emission order is the settlement order: deposits, then redemptions,
        // then the NAV record (which reports the attested value, not the
        // post-fulfillment one).
        vm.expectEmit(true, false, false, true);
        emit PriimeVault.DepositRequestFulfilled(BOB, 600 * ONE_USDC, 300 * ONE_USDC);
        vm.expectEmit(true, false, false, true);
        emit PriimeVault.RedeemRequestFulfilled(ALICE, 250 * ONE_USDC, 500 * ONE_USDC);
        vm.expectEmit(true, false, false, true);
        emit PriimeVault.NavUpdated(bytes20(uint160(0xE7E21)), 2_000 * ONE_USDC, 2, 2);
        _attest(bytes20(uint160(0xE7E21)), 2_000 * ONE_USDC, 2);
    }

    function test_RefundedDepositEmitsDepositRequestRefunded() public {
        _bootstrapAlice();

        vm.prank(BOB);
        vault.requestDeposit(500 * ONE_USDC, BOB, BOB);

        vm.expectEmit(true, false, false, true);
        emit PriimeVault.DepositRequestRefunded(BOB, 500 * ONE_USDC);
        _attest(bytes20(uint160(0xE7E22)), 0, 2);
    }

    // --- envelope forwarding across the service-manager seam ------------------

    function test_HandleSignedEnvelopeForwardsEnvelopeAndSignaturesVerbatim() public {
        IWavsServiceHandler.Envelope memory env = IWavsServiceHandler.Envelope({
            eventId: bytes20(uint160(0x5E11)),
            ordering: bytes12(uint96(0xABCDEF)), // non-zero, so a dropped word would show
            payload: abi.encode(address(vault), uint256(1_234 * ONE_USDC), uint256(7))
        });

        address[] memory signers = new address[](2);
        signers[0] = ALICE;
        signers[1] = BOB;
        bytes[] memory signatures = new bytes[](2);
        signatures[0] = hex"1122334455";
        signatures[1] = hex"deadbeefcafe";
        IWavsServiceHandler.SignatureData memory sigs =
            IWavsServiceHandler.SignatureData({signers: signers, signatures: signatures, referenceBlock: 99});

        // The quorum's bytes must reach `validate` untouched: the vault decodes
        // the payload for its own guards but must never re-encode what it
        // forwards, or the signatures would no longer cover it.
        manager.expectForwarded(env, sigs);
        vault.handleSignedEnvelope(env, sigs);
        require(vault.totalAssets() == 1_234 * ONE_USDC, "update landed on forwarded bytes");

        // Negative controls: the seam check is live, not vacuous.
        IWavsServiceHandler.Envelope memory other = IWavsServiceHandler.Envelope({
            eventId: bytes20(uint160(0x5E12)),
            ordering: bytes12(uint96(0xABCDEF)),
            payload: abi.encode(address(vault), uint256(1_235 * ONE_USDC), uint256(8))
        });
        vm.expectRevert(
            abi.encodeWithSelector(
                ToggleableServiceManager.EnvelopeNotForwardedVerbatim.selector,
                keccak256(abi.encode(env)),
                keccak256(abi.encode(other))
            )
        );
        vault.handleSignedEnvelope(other, sigs);

        manager.expectForwarded(other, sigs);
        IWavsServiceHandler.SignatureData memory tampered =
            IWavsServiceHandler.SignatureData({signers: signers, signatures: signatures, referenceBlock: 100});
        vm.expectRevert(
            abi.encodeWithSelector(
                ToggleableServiceManager.SignatureNotForwardedVerbatim.selector,
                keccak256(abi.encode(sigs)),
                keccak256(abi.encode(tampered))
            )
        );
        vault.handleSignedEnvelope(other, tampered);
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
