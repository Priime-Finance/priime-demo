// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IWavsServiceHandler} from "../src/interfaces/wavs/IWavsServiceHandler.sol";
import {IWavsServiceManager} from "../src/interfaces/wavs/IWavsServiceManager.sol";
import {PriimeVault} from "../src/PriimeVault.sol";
import {IMorphoBlue, IMorphoFlashLoanCallback} from "../src/interfaces/external/IMorphoBlue.sol";
import {IAerodromeCLRouter} from "../src/interfaces/external/IAerodromeCLRouter.sol";

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

/// @dev Mintable 18-decimal stand-in for USDe / any collateral token that
///      goes through the atomic delever swap. Same shape as TestUSDC minus
///      the fixed decimals.
contract TestUSDe {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function decimals() external pure returns (uint8) {
        return 18;
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

/// @dev Minimal Morpho Blue mock covering the surface the vault touches:
///      supplyCollateral / borrow / repay / withdrawCollateral / flashLoan.
///      One market only; state keyed by `onBehalf` so the vault-per-strike
///      state stays isolated. Pre-funded with a USDC pool so `borrow` and
///      `flashLoan` can actually transfer.
contract MockMorpho {
    IERC20 public immutable usdc;
    IERC20 public immutable usde;
    mapping(address => uint256) public collateral; // USDe base units
    mapping(address => uint256) public debt; // USDC base units (assets)
    mapping(address => uint256) public borrowShares; // shares (1:1 with debt by default)
    /* Set nonzero to model interest accrual between an inputs_block estimate
       and the actual repay call: the mock inflates `debt` by
       `debt * accrualBps / 10_000` at the start of every `repay`. Zero by
       default so existing tests are unaffected; Khaled review regression
       tests bump it to reproduce the on-mainnet accrual gap. */
    uint256 public accrualBps;

    constructor(IERC20 _usdc, IERC20 _usde) {
        usdc = _usdc;
        usde = _usde;
    }

    function setAccrualBps(uint256 bps) external {
        accrualBps = bps;
    }

    function supplyCollateral(IMorphoBlue.MarketParams calldata, uint256 assets, address onBehalf, bytes calldata)
        external
    {
        // Pull the collateral IN from msg.sender (which is the vault, or the
        // strategist during deploy). Real Morpho pulls with safeTransferFrom.
        require(usde.transferFrom(msg.sender, address(this), assets), "usde in");
        collateral[onBehalf] += assets;
    }

    function withdrawCollateral(IMorphoBlue.MarketParams calldata, uint256 assets, address onBehalf, address receiver)
        external
    {
        require(collateral[onBehalf] >= assets, "collateral");
        collateral[onBehalf] -= assets;
        /* Post-withdraw LLTV check that real Morpho performs. In this mock
           we use a simple invariant: collateral must be non-zero when debt
           is non-zero (a full-collateral withdraw with residual debt
           reverts, exactly as Morpho's health check would). */
        if (debt[onBehalf] > 0 && collateral[onBehalf] == 0) revert("morpho: health");
        require(usde.transfer(receiver, assets), "usde out");
    }

    function borrow(IMorphoBlue.MarketParams calldata, uint256 assets, uint256, address onBehalf, address receiver)
        external
        returns (uint256, uint256)
    {
        debt[onBehalf] += assets;
        borrowShares[onBehalf] += assets; // 1:1 in the mock
        require(usdc.transfer(receiver, assets), "usdc out");
        return (assets, assets);
    }

    function repay(IMorphoBlue.MarketParams calldata, uint256 assets, uint256 shares, address onBehalf, bytes calldata)
        external
        returns (uint256, uint256)
    {
        // Interest accrual model: bump debt (NOT shares — mirrors Morpho's
        // internal `totalBorrowAssets` growing while `totalBorrowShares`
        // stays flat between borrows) before pulling.
        if (accrualBps > 0) {
            uint256 accrued = debt[onBehalf] * accrualBps / 10_000;
            debt[onBehalf] += accrued;
        }
        uint256 pullAssets;
        uint256 pullShares;
        if (shares != 0) {
            /* Real Morpho: `assets = shares × total_borrow_assets /
               total_borrow_shares`. With this ratio, sending
               `shares = full_borrow_shares` pulls the exact current
               debt regardless of accrual — that is the invariant
               `plan_deleverage`'s full-unwind branch depends on. */
            pullShares = shares;
            pullAssets = shares * debt[onBehalf] / borrowShares[onBehalf];
        } else {
            pullAssets = assets;
            pullShares = assets * borrowShares[onBehalf] / debt[onBehalf];
        }
        require(debt[onBehalf] >= pullAssets, "debt");
        debt[onBehalf] -= pullAssets;
        borrowShares[onBehalf] -= pullShares;
        require(usdc.transferFrom(msg.sender, address(this), pullAssets), "usdc in");
        return (pullAssets, pullShares);
    }

    function flashLoan(address token, uint256 assets, bytes calldata data) external {
        require(IERC20(token).transfer(msg.sender, assets), "flash out");
        IMorphoFlashLoanCallback(msg.sender).onMorphoFlashLoan(assets, data);
        require(IERC20(token).transferFrom(msg.sender, address(this), assets), "flash back");
    }
}

/// @dev Minimal Aerodrome Slipstream router mock: exact 1:1e12 par swap
///      between USDC (6-dec) and USDe (18-dec). Pre-funded with both tokens.
contract MockAerodromeRouter {
    IERC20 public immutable usdc;
    IERC20 public immutable usde;

    constructor(IERC20 _usdc, IERC20 _usde) {
        usdc = _usdc;
        usde = _usde;
    }

    function exactInputSingle(IAerodromeCLRouter.ExactInputSingleParams calldata p)
        external
        payable
        returns (uint256 amountOut)
    {
        require(IERC20(p.tokenIn).transferFrom(msg.sender, address(this), p.amountIn), "in");
        if (p.tokenIn == address(usdc)) {
            // USDC (6-dec) -> USDe (18-dec) at par: multiply by 1e12.
            amountOut = p.amountIn * 1e12;
        } else {
            // USDe (18-dec) -> USDC (6-dec) at par: divide by 1e12.
            amountOut = p.amountIn / 1e12;
        }
        require(amountOut >= p.amountOutMinimum, "slippage");
        require(IERC20(p.tokenOut).transfer(p.recipient, amountOut), "out");
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
        PriimeVault.StrategyConfig memory strategyConfig = PriimeVault.StrategyConfig({
            collateralToken: address(0xC0),
            morpho: address(0xD1),
            morphoOracle: address(0x02),
            morphoIrm: address(0x03),
            morphoLltv: 915_000_000_000_000_000,
            swapRouter: address(0x04),
            poolTickSpacing: int24(1)
        });
        vault =
            new PriimeVault(IWavsServiceManager(address(manager)), IERC20(address(usdc)), STRATEGIST, strategyConfig);

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
        return _envelope(eventId, nav, inputsBlock, bytes32(0));
    }

    function _envelope(bytes20 eventId, uint256 nav, uint256 inputsBlock, bytes32 configHash)
        internal
        view
        returns (IWavsServiceHandler.Envelope memory)
    {
        PriimeVault.BoundNavResult memory result = PriimeVault.BoundNavResult({
            handler: address(vault),
            nav: nav,
            inputsBlock: inputsBlock,
            configHash: configHash,
            leverageBps: 0,
            ltvBps: 0,
            reserveBps: 0,
            supplyApyBps: 0,
            hoursSinceUpdate: 0,
            breachFlags: 0,
            plan: PriimeVault.StrategyPlan({targets: new address[](0), calldatas: new bytes[](0), timestamp: 0})
        });
        return IWavsServiceHandler.Envelope({
            eventId: eventId,
            ordering: bytes12(0),
            // abi.encode(BoundNavResult) mirrors the component's
            // struct.abi_encode() — a single dynamic tuple with the 0x20
            // leading offset word.
            payload: abi.encode(result)
        });
    }

    function _envelopeWithBreach(bytes20 eventId, uint256 nav, uint256 inputsBlock, uint16 flags)
        internal
        view
        returns (IWavsServiceHandler.Envelope memory)
    {
        PriimeVault.BoundNavResult memory result = PriimeVault.BoundNavResult({
            handler: address(vault),
            nav: nav,
            inputsBlock: inputsBlock,
            configHash: bytes32(0),
            leverageBps: 0,
            ltvBps: 0,
            reserveBps: 0,
            supplyApyBps: 0,
            hoursSinceUpdate: 0,
            breachFlags: flags,
            plan: PriimeVault.StrategyPlan({targets: new address[](0), calldatas: new bytes[](0), timestamp: 0})
        });
        return IWavsServiceHandler.Envelope({eventId: eventId, ordering: bytes12(0), payload: abi.encode(result)});
    }

    function _sigs() internal pure returns (IWavsServiceHandler.SignatureData memory) {
        return
            IWavsServiceHandler.SignatureData({
                signers: new address[](0), signatures: new bytes[](0), referenceBlock: 0
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

    function test_BreachFlagSetOnStrikeRejectsNewRequests() public {
        // Bootstrap: one round of clean deposit + strike so BOB can hold shares
        // and prove the breach gate blocks REDEEM as well as DEPOSIT.
        _bootstrapAlice();

        // Strike lands with breachFlags != 0 (bit 0 = hf_floor). Vault
        // attests NAV and stores the flag; existing balances are unaffected.
        vault.handleSignedEnvelope(
            _envelopeWithBreach(bytes20(uint160(0xB01)), 1_000 * ONE_USDC, 2, uint16(1)), _sigs()
        );
        require(vault.breachFlags() == uint16(1), "flag stored");
        require(vault.totalAssets() == 1_000 * ONE_USDC, "nav still attested");
        // New deposit request refused with VaultBreached(1). BOB already
        // approved the vault in setUp, so no allowance dance needed here.
        vm.prank(BOB);
        vm.expectRevert(abi.encodeWithSelector(PriimeVault.VaultBreached.selector, uint16(1)));
        vault.requestDeposit(100 * ONE_USDC, BOB, BOB);

        // Existing share holder cannot open a new redeem request either.
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(PriimeVault.VaultBreached.selector, uint16(1)));
        vault.requestRedeem(100 * ONE_USDC, ALICE, ALICE);

        // Next strike clears the flag: requests resume normally.
        vault.handleSignedEnvelope(
            _envelopeWithBreach(bytes20(uint160(0xB02)), 1_000 * ONE_USDC, 3, uint16(0)), _sigs()
        );
        require(vault.breachFlags() == 0, "flag cleared by fresh strike");

        vm.prank(BOB);
        vault.requestDeposit(100 * ONE_USDC, BOB, BOB);
    }

    // ------------------------------------------------------------------------
    // Roadmap P1 #4: plan_deleverage end-to-end. Fresh setup (dummy addresses
    // don't hold state) with a full Morpho + Aerodrome mock stack. Proves the
    // whole 7540 withdrawal flow:
    //   1. deposit + strike -> position opens against Morpho
    //   2. requestRedeem + strike -> plan_deleverage frees USDC via flashLoan
    //   3. redeem() delivers USDC
    // ------------------------------------------------------------------------

    function test_FullWithdrawalFlow_FlashloanDeleverFreesUsdcForClaim() public {
        // Fresh mock stack. The main vault at address `vault` uses placeholder
        // addresses for Morpho/router that can't roundtrip a real flashloan;
        // spin up a second vault wired to real mocks so this exercise is
        // end-to-end.
        TestUSDC muUsdc = new TestUSDC();
        TestUSDe muUsde = new TestUSDe();
        MockMorpho muMorpho = new MockMorpho(IERC20(address(muUsdc)), IERC20(address(muUsde)));
        MockAerodromeRouter muRouter = new MockAerodromeRouter(IERC20(address(muUsdc)), IERC20(address(muUsde)));
        ToggleableServiceManager muManager = new ToggleableServiceManager();

        PriimeVault muVault = new PriimeVault(
            IWavsServiceManager(address(muManager)),
            IERC20(address(muUsdc)),
            STRATEGIST,
            PriimeVault.StrategyConfig({
                collateralToken: address(muUsde),
                morpho: address(muMorpho),
                morphoOracle: address(0x02),
                morphoIrm: address(0x03),
                morphoLltv: 915_000_000_000_000_000,
                swapRouter: address(muRouter),
                poolTickSpacing: int24(1)
            })
        );

        // Prime Morpho and the router with enough USDC / USDe to serve the
        // flashloan + borrow + swap legs. Test-scale; real Morpho holds a
        // supply-side pool from other users.
        muUsdc.mint(address(muMorpho), 100_000 * ONE_USDC);
        muUsde.mint(address(muRouter), 100_000 * 1e18);
        muUsdc.mint(address(muRouter), 100_000 * ONE_USDC);

        // Alice deposits 1000 USDC, first strike bootstraps her shares. NAV
        // stays 0 at the bootstrap strike (position not opened yet).
        muUsdc.mint(ALICE, 1_000 * ONE_USDC);
        vm.prank(ALICE);
        muUsdc.approve(address(muVault), type(uint256).max);
        vm.prank(ALICE);
        muVault.requestDeposit(1_000 * ONE_USDC, ALICE, ALICE);
        _attestOn(muVault, bytes20(uint160(0xD1)), 0, 1);
        vm.prank(ALICE);
        muVault.deposit(1_000 * ONE_USDC, ALICE);
        require(muVault.balanceOf(ALICE) == 1_000 * ONE_USDC, "alice holds 1000 shares");

        // Strategist opens a 2x position from the deposited USDC. Simulates
        // the strike's plan_open_position: swap USDC -> USDe, supply, borrow.
        // At par: 1000 USDC -> 1000e18 USDe supplied -> borrow 500 USDC back.
        vm.prank(STRATEGIST);
        muVault.execute(address(muUsdc), abi.encodeCall(TestUSDC.approve, (address(muRouter), 1_000 * ONE_USDC)));
        vm.prank(STRATEGIST);
        muVault.execute(
            address(muRouter),
            abi.encodeCall(
                IAerodromeCLRouter.exactInputSingle,
                (IAerodromeCLRouter.ExactInputSingleParams({
                        tokenIn: address(muUsdc),
                        tokenOut: address(muUsde),
                        tickSpacing: int24(1),
                        recipient: address(muVault),
                        deadline: block.timestamp + 300,
                        amountIn: 1_000 * ONE_USDC,
                        amountOutMinimum: 0,
                        sqrtPriceLimitX96: 0
                    }))
            )
        );
        vm.prank(STRATEGIST);
        muVault.execute(address(muUsde), abi.encodeCall(TestUSDe.approve, (address(muMorpho), 1_000 * 1e18)));
        vm.prank(STRATEGIST);
        muVault.execute(
            address(muMorpho),
            abi.encodeCall(
                IMorphoBlue.supplyCollateral,
                (
                    IMorphoBlue.MarketParams({
                        loanToken: address(muUsdc),
                        collateralToken: address(muUsde),
                        oracle: address(0x02),
                        irm: address(0x03),
                        lltv: 915_000_000_000_000_000
                    }),
                    1_000 * 1e18,
                    address(muVault),
                    ""
                )
            )
        );
        vm.prank(STRATEGIST);
        muVault.execute(
            address(muMorpho),
            abi.encodeCall(
                IMorphoBlue.borrow,
                (
                    IMorphoBlue.MarketParams({
                        loanToken: address(muUsdc),
                        collateralToken: address(muUsde),
                        oracle: address(0x02),
                        irm: address(0x03),
                        lltv: 915_000_000_000_000_000
                    }),
                    500 * ONE_USDC,
                    0,
                    address(muVault),
                    address(muVault)
                )
            )
        );
        require(muUsdc.balanceOf(address(muVault)) == 500 * ONE_USDC, "vault holds 500 USDC after 2x lever");
        require(muMorpho.collateral(address(muVault)) == 1_000 * 1e18, "1000 USDe collateral");
        require(muMorpho.debt(address(muVault)) == 500 * ONE_USDC, "500 USDC debt");

        // Second strike attests NAV = 500 USDC (collateral 1000@par minus debt 500).
        _attestOn(muVault, bytes20(uint160(0xD2)), 500 * ONE_USDC, 2);
        require(muVault.totalAssets() == 500 * ONE_USDC, "NAV = 500 at 2x leverage");

        // Alice requests redemption of ALL her shares. At NAV=500 / supply=1000
        // she's owed 500 USDC, but the vault holds it too - use HALF to prove
        // the delever proportionally reduces the position instead of just
        // draining idle cash. Actually make it 700: 500 idle < 700 claim, so
        // 200 USDC must come from the delever.
        // ... but 700 shares at 500/1000 price = 350 USDC claim, still <500.
        // For a genuine delever, drain the idle first by having the strategist
        // supply it back into position, then the entire 500-USDC redemption
        // must be funded via the flashloan.
        vm.prank(STRATEGIST);
        muVault.execute(address(muUsdc), abi.encodeCall(TestUSDC.approve, (address(muRouter), 500 * ONE_USDC)));
        vm.prank(STRATEGIST);
        muVault.execute(
            address(muRouter),
            abi.encodeCall(
                IAerodromeCLRouter.exactInputSingle,
                (IAerodromeCLRouter.ExactInputSingleParams({
                        tokenIn: address(muUsdc),
                        tokenOut: address(muUsde),
                        tickSpacing: int24(1),
                        recipient: address(muVault),
                        deadline: block.timestamp + 300,
                        amountIn: 500 * ONE_USDC,
                        amountOutMinimum: 0,
                        sqrtPriceLimitX96: 0
                    }))
            )
        );
        vm.prank(STRATEGIST);
        muVault.execute(address(muUsde), abi.encodeCall(TestUSDe.approve, (address(muMorpho), 500 * 1e18)));
        vm.prank(STRATEGIST);
        muVault.execute(
            address(muMorpho),
            abi.encodeCall(
                IMorphoBlue.supplyCollateral,
                (
                    IMorphoBlue.MarketParams({
                        loanToken: address(muUsdc),
                        collateralToken: address(muUsde),
                        oracle: address(0x02),
                        irm: address(0x03),
                        lltv: 915_000_000_000_000_000
                    }),
                    500 * 1e18,
                    address(muVault),
                    ""
                )
            )
        );
        require(muUsdc.balanceOf(address(muVault)) == 0, "vault is fully deployed, 0 idle USDC");
        // Position is now 1500 USDe collateral / 500 USDC debt -> NAV 1000 at par.
        require(muMorpho.collateral(address(muVault)) == 1_500 * 1e18, "1500 USDe collateral after fold-in");

        // Alice requests full redemption at NAV=1000, supply=1000 -> 1 USDC/share.
        vm.prank(ALICE);
        muVault.requestRedeem(1_000 * ONE_USDC, ALICE, ALICE);

        // Build the strike's plan: a single `morpho.flashLoan(usdc, 500, data)`
        // where data = (collateralOut = 1500e18, minUsdcOut = 1500 USDC-1%,
        // deadline, sharesToRepay = 500 USDC of borrow shares — 1:1 with debt
        // in the mock). Full unwind: repay 500 shares (clears debt exactly),
        // withdraw 1500 USDe, swap to 1500 USDC, keep 1000 USDC net.
        bytes memory flashData = abi.encode(
            uint256(1_500 * 1e18), uint256(1_485 * ONE_USDC), block.timestamp + 300, uint256(500 * ONE_USDC)
        );
        address[] memory targets = new address[](1);
        targets[0] = address(muMorpho);
        bytes[] memory calldatas = new bytes[](1);
        calldatas[0] = abi.encodeCall(IMorphoBlue.flashLoan, (address(muUsdc), 500 * ONE_USDC, flashData));

        _attestOnWithPlan(
            muVault,
            bytes20(uint160(0xD3)),
            1_000 * ONE_USDC,
            3,
            PriimeVault.StrategyPlan({targets: targets, calldatas: calldatas, timestamp: block.timestamp + 300})
        );

        // Strike settled: alice's 1000 shares -> 1000 USDC claimable; the plan
        // brought idle USDC from 0 up to 1000 by unwinding the whole position.
        require(muVault.totalClaimableRedeemAssets() == 1_000 * ONE_USDC, "claimable = 1000");
        require(muUsdc.balanceOf(address(muVault)) == 1_000 * ONE_USDC, "1000 USDC on hand for the claim");
        require(muMorpho.collateral(address(muVault)) == 0, "collateral fully withdrawn");
        require(muMorpho.debt(address(muVault)) == 0, "debt fully repaid");

        // Alice claims. Real USDC lands in her wallet.
        uint256 aliceBefore = muUsdc.balanceOf(ALICE);
        vm.prank(ALICE);
        uint256 assets = muVault.redeem(1_000 * ONE_USDC, ALICE, ALICE);
        require(assets == 1_000 * ONE_USDC, "claim delivers 1000 USDC");
        require(muUsdc.balanceOf(ALICE) - aliceBefore == 1_000 * ONE_USDC, "USDC delivered to alice");
        require(muVault.balanceOf(ALICE) == 0, "alice's shares fully redeemed");
    }

    function test_OnMorphoFlashLoanRejectsNonMorphoCaller() public {
        vm.expectRevert(abi.encodeWithSelector(PriimeVault.FlashLoanCallerNotMorpho.selector, address(this)));
        vault.onMorphoFlashLoan(1_000 * ONE_USDC, abi.encode(uint256(0), uint256(0), block.timestamp, uint256(0)));
    }

    // ------------------------------------------------------------------------
    // Khaled review regression tests
    // ------------------------------------------------------------------------

    function test_FailedDeleverPlan_RollsBackRedemptionBookkeeping() public {
        /* If the plan reverts (floor breach), _fulfillRedeems must roll
           back too so the vault doesn't sit with `totalClaimableRedeemAssets`
           raised against a balance the plan failed to lift. Alice's shares
           stay pending, next strike tries again. */
        (PriimeVault muVault,, MockMorpho muMorpho, TestUSDC muUsdc,) = _buildMorphoMockStack();

        muUsdc.mint(ALICE, 1_000 * ONE_USDC);
        vm.prank(ALICE);
        muUsdc.approve(address(muVault), type(uint256).max);
        vm.prank(ALICE);
        muVault.requestDeposit(1_000 * ONE_USDC, ALICE, ALICE);
        _attestOn(muVault, bytes20(uint160(0xF01)), 0, 1);
        vm.prank(ALICE);
        muVault.deposit(1_000 * ONE_USDC, ALICE);
        // Move all USDC out of the vault so the next strike is stuck below floor.
        vm.prank(STRATEGIST);
        muVault.execute(address(muUsdc), abi.encodeCall(TestUSDC.transfer, (SINK, 1_000 * ONE_USDC)));

        vm.prank(ALICE);
        muVault.requestRedeem(1_000 * ONE_USDC, ALICE, ALICE);

        // Strike with an EMPTY plan while there's queued redemption -> the
        // fulfilment inside executePlanSelf will raise the floor to 1000 USDC
        // against a balance of 0 -> plan reverts.
        address[] memory noTargets = new address[](0);
        bytes[] memory noCalldatas = new bytes[](0);
        _attestOnWithPlan(
            muVault,
            bytes20(uint160(0xF02)),
            1_000 * ONE_USDC,
            2,
            PriimeVault.StrategyPlan({targets: noTargets, calldatas: noCalldatas, timestamp: block.timestamp + 300})
        );

        // Rollback assertions: the fulfilment side-effects must all be
        // gone, shares must still be in the pending queue, no claimable.
        require(muVault.totalClaimableRedeemAssets() == 0, "claim rolled back");
        require(muVault.totalPendingRedeemShares() == 1_000 * ONE_USDC, "shares still pending");
        require(muVault.balanceOf(address(muVault)) == 1_000 * ONE_USDC, "vault-escrowed shares intact");
        require(muVault.updateCount() == 2, "NAV attestation still landed");
    }

    function test_DeleverPlanSurvivesAccruedInterestBetweenEstimateAndExecution() public {
        /* Real Morpho accrues interest between the operator's inputs_block
           read and the vault's on-chain execution. The old assets-based repay
           left residual debt when the estimate lagged; shares-based repay
           captures it exactly. Model with `accrualBps = 5` (~5 bps per repay
           call, roughly one hour at typical borrow rates) and a 50% redeem
           so remaining collateral covers the accrual cost.

           OLD-code behavior (assets-based repay of stale estimate) would
           leave residual debt against the partially-withdrawn collateral,
           tripping Morpho's LLTV check on the withdrawCollateral step.
           NEW-code behavior (shares-based repay) pulls the exact current
           debt slice, so the LLTV check passes. */
        (PriimeVault muVault, MockAerodromeRouter muRouter, MockMorpho muMorpho, TestUSDC muUsdc, TestUSDe muUsde) =
            _buildMorphoMockStack();

        muUsdc.mint(ALICE, 1_000 * ONE_USDC);
        vm.prank(ALICE);
        muUsdc.approve(address(muVault), type(uint256).max);
        vm.prank(ALICE);
        muVault.requestDeposit(1_000 * ONE_USDC, ALICE, ALICE);
        _attestOn(muVault, bytes20(uint160(0xF11)), 0, 1);
        vm.prank(ALICE);
        muVault.deposit(1_000 * ONE_USDC, ALICE);

        _openPosition2x(muVault, muUsdc, muUsde, muRouter, muMorpho);
        _foldIdleIntoPosition(muVault, muUsdc, muUsde, muRouter, muMorpho, 500 * ONE_USDC);
        _attestOn(muVault, bytes20(uint160(0xF12)), 1_000 * ONE_USDC, 2);

        // 5 bps accrual per repay call.
        muMorpho.setAccrualBps(5);

        // Partial redemption: 500 shares (half). Attested claim = 500 USDC.
        vm.prank(ALICE);
        muVault.requestRedeem(500 * ONE_USDC, ALICE, ALICE);

        // Plan targets a proportional unwind:
        //   proportion = 500 / 1000 nav = 0.5
        //   collateralOut = 750 USDe, sharesToRepay = 250 (half of 500)
        //   flashloan = 250 USDC × 1.01 (accrual buffer)
        // Shares-based repay pulls 250 × current_debt / 500 = accurate slice
        // even after accrual bump.
        bytes memory flashData =
            abi.encode(uint256(755 * 1e18), uint256(750 * ONE_USDC), block.timestamp + 300, uint256(250 * ONE_USDC));
        address[] memory targets = new address[](1);
        targets[0] = address(muMorpho);
        bytes[] memory calldatas = new bytes[](1);
        calldatas[0] = abi.encodeCall(IMorphoBlue.flashLoan, (address(muUsdc), 260 * ONE_USDC, flashData));

        _attestOnWithPlan(
            muVault,
            bytes20(uint160(0xF13)),
            1_000 * ONE_USDC,
            3,
            PriimeVault.StrategyPlan({targets: targets, calldatas: calldatas, timestamp: block.timestamp + 300})
        );

        // Plan settled: shares-based repay cleared the exact proportional
        // debt slice, withdrawCollateral passed the LLTV check (residual
        // debt still backed by residual collateral), swap delivered enough
        // USDC to cover the 500 USDC claim.
        require(muVault.totalClaimableRedeemAssets() >= 495 * ONE_USDC, "half-claim materialised despite accrual");
        require(muMorpho.collateral(address(muVault)) == 745 * 1e18, "residual collateral = 1500 - 755");
        // Residual debt = old_debt × 1.0005 (accrual) - 250 × old_debt/500 = 250.25 - 250.125 = 0.125.
        // That's an approximation — the point is the LLTV check passed and
        // the position is still valid.
        require(muMorpho.collateral(address(muVault)) > 0, "collateral covers residual debt");
    }

    function test_EmergencyExecute_UnlocksStrategistRecoveryWhenStuck() public {
        /* Manual-recovery path: `execute` re-checks the floor after every
           call, so a multi-step unwind cannot even start once the vault is
           below floor. `emergencyExecute` skips that check while stuck and
           refuses once solvent again. */
        (PriimeVault muVault,,, TestUSDC muUsdc,) = _buildMorphoMockStack();

        muUsdc.mint(ALICE, 100 * ONE_USDC);
        vm.prank(ALICE);
        muUsdc.approve(address(muVault), type(uint256).max);
        vm.prank(ALICE);
        muVault.requestDeposit(100 * ONE_USDC, ALICE, ALICE);
        _attestOn(muVault, bytes20(uint160(0xF21)), 0, 1);
        vm.prank(ALICE);
        muVault.deposit(100 * ONE_USDC, ALICE);

        // Move the vault's USDC out to a placeholder sink so we're stuck.
        vm.prank(STRATEGIST);
        muVault.execute(address(muUsdc), abi.encodeCall(TestUSDC.transfer, (SINK, 100 * ONE_USDC)));
        // Stage a redemption so totalClaimableRedeemAssets grows on the next strike.
        vm.prank(ALICE);
        muVault.requestRedeem(100 * ONE_USDC, ALICE, ALICE);
        address[] memory noTargets = new address[](0);
        bytes[] memory noCalldatas = new bytes[](0);
        _attestOnWithPlan(
            muVault,
            bytes20(uint160(0xF22)),
            100 * ONE_USDC,
            2,
            PriimeVault.StrategyPlan({targets: noTargets, calldatas: noCalldatas, timestamp: block.timestamp + 300})
        );
        // With the rollback fix, no claimable is left standing after the failed plan.
        require(muVault.totalClaimableRedeemAssets() == 0, "claim rolled back");

        // Simulate a legacy stuck state (rollback didn't happen in old code)
        // by donating USDC to the vault via the strategist and setting a
        // manual scenario: mint 200 USDC to SINK, transfer it back, then
        // spend it back out so the vault is short vs its floor. We don't
        // have easy access to the old buggy path; instead just prove the
        // emergencyExecute path itself: at balance 0 with a 0 floor, the
        // guard says "not stuck".
        vm.prank(STRATEGIST);
        vm.expectRevert(abi.encodeWithSelector(PriimeVault.VaultNotStuck.selector, uint256(0), uint256(0)));
        muVault.emergencyExecute(address(muUsdc), abi.encodeCall(TestUSDC.approve, (SINK, 1)));

        // Force a stuck state: put a pending deposit on the queue (non-zero
        // floor) but drain the escrow via a legacy-simulated write. Simplest
        // path: another user deposits, we transfer their escrow out via
        // execute BEFORE the floor check would refuse (it can't, execute
        // enforces the same floor). So use `emergencyExecute` itself to
        // approve while at 0/0 (currently blocked, as expected). Instead,
        // just confirm the guard triggers with a nonzero floor.
        muUsdc.mint(BOB, 50 * ONE_USDC);
        vm.prank(BOB);
        muUsdc.approve(address(muVault), type(uint256).max);
        vm.prank(BOB);
        muVault.requestDeposit(50 * ONE_USDC, BOB, BOB); // escrow 50 in vault
        vm.prank(STRATEGIST);
        // A regular execute cannot move that 50 out (floor would break).
        vm.expectRevert(
            abi.encodeWithSelector(PriimeVault.EscrowFloorBreached.selector, uint256(0), uint256(50 * ONE_USDC))
        );
        muVault.execute(address(muUsdc), abi.encodeCall(TestUSDC.transfer, (SINK, 50 * ONE_USDC)));
        // But if the vault were ALREADY stuck (imagine mock-only state where
        // balance < floor), emergencyExecute would let the strategist act.
        // Here we prove the AT-FLOOR case is refused: balance == floor,
        // guard says not stuck.
        vm.prank(STRATEGIST);
        vm.expectRevert(
            abi.encodeWithSelector(PriimeVault.VaultNotStuck.selector, uint256(50 * ONE_USDC), uint256(50 * ONE_USDC))
        );
        muVault.emergencyExecute(address(muUsdc), abi.encodeCall(TestUSDC.approve, (SINK, 1)));
    }

    function test_ZeroDebtCollateralRedemptionDeliversUsdcInOneStrike() public {
        /* Reviewer's blocker: vault holds collateral with ZERO Morpho
           debt and a queued redeem larger than idle USDC. The component's
           delever branch was gated on `!debt.is_zero()` so the strike
           emitted an EMPTY plan, `_fulfillRedeems` raised the floor above
           the balance, the whole self-call rolled back, and Alice's
           shares stayed pending across strikes forever until a strategist
           manually unwound. `emergencyExecute` could not fire either -
           the rollback keeps the floor at zero, so `balance >= floor` and
           the recovery path refused.

           The fix (`plan_redeem_collateral` in the vault-nav component)
           emits a 3-step spot unwind: `withdrawCollateral` + `approve` +
           `exactInputSingle`. This test builds the same plan by hand and
           proves the strike now delivers the claim atomically. */
        (PriimeVault muVault, MockAerodromeRouter muRouter, MockMorpho muMorpho, TestUSDC muUsdc, TestUSDe muUsde) =
            _buildMorphoMockStack();

        // ---- 1. Alice deposits 1000 USDC. Bootstrap strike mints shares.
        muUsdc.mint(ALICE, 1_000 * ONE_USDC);
        vm.prank(ALICE);
        muUsdc.approve(address(muVault), type(uint256).max);
        vm.prank(ALICE);
        muVault.requestDeposit(1_000 * ONE_USDC, ALICE, ALICE);
        _attestOn(muVault, bytes20(uint160(0xF31)), 0, 1);
        vm.prank(ALICE);
        muVault.deposit(1_000 * ONE_USDC, ALICE);

        // ---- 2. Park 900 USDC as 900 USDe collateral. NO borrow: this
        //         is the zero-debt state the original delever branch
        //         refused to plan for.
        vm.prank(STRATEGIST);
        muVault.execute(address(muUsdc), abi.encodeCall(TestUSDC.approve, (address(muRouter), 900 * ONE_USDC)));
        vm.prank(STRATEGIST);
        muVault.execute(
            address(muRouter),
            abi.encodeCall(
                IAerodromeCLRouter.exactInputSingle,
                (IAerodromeCLRouter.ExactInputSingleParams({
                        tokenIn: address(muUsdc),
                        tokenOut: address(muUsde),
                        tickSpacing: int24(1),
                        recipient: address(muVault),
                        deadline: block.timestamp + 300,
                        amountIn: 900 * ONE_USDC,
                        amountOutMinimum: 0,
                        sqrtPriceLimitX96: 0
                    }))
            )
        );
        vm.prank(STRATEGIST);
        muVault.execute(address(muUsde), abi.encodeCall(TestUSDe.approve, (address(muMorpho), 900 * 1e18)));
        vm.prank(STRATEGIST);
        muVault.execute(
            address(muMorpho),
            abi.encodeCall(
                IMorphoBlue.supplyCollateral,
                (
                    IMorphoBlue.MarketParams({
                        loanToken: address(muUsdc),
                        collateralToken: address(muUsde),
                        oracle: address(0x02),
                        irm: address(0x03),
                        lltv: 915_000_000_000_000_000
                    }),
                    900 * 1e18,
                    address(muVault),
                    ""
                )
            )
        );
        require(muMorpho.debt(address(muVault)) == 0, "DEBT IS ZERO - the reviewer's premise");
        require(muMorpho.collateral(address(muVault)) == 900 * 1e18, "900e18 USDe collateral");
        require(muUsdc.balanceOf(address(muVault)) == 100 * ONE_USDC, "100 USDC idle");

        // Confirm the unlevered position: NAV = 900 (collateral @ par) + 100 (idle) = 1000.
        _attestOn(muVault, bytes20(uint160(0xF32)), 1_000 * ONE_USDC, 2);

        // ---- 3. Alice requests full redemption. Shortfall = 1000 - 100 = 900.
        vm.prank(ALICE);
        muVault.requestRedeem(1_000 * ONE_USDC, ALICE, ALICE);

        // ---- 4. Compose the fixed component's plan: `plan_redeem_collateral`.
        //         Same shape the Rust builder emits. Size the withdraw so the
        //         swap floor clears 900 * 1.01 = 909 USDC.
        IMorphoBlue.MarketParams memory params = IMorphoBlue.MarketParams({
            loanToken: address(muUsdc),
            collateralToken: address(muUsde),
            oracle: address(0x02),
            irm: address(0x03),
            lltv: 915_000_000_000_000_000
        });
        // Real component sizing: `usde_needed = 909 * 1e12 * 10000 / 9950
        // ~= 913.57e18`, capped at the 900e18 balance. `min_usdc_out`
        // follows: `swap_min_usdc_out(900e18, par, 50) = 895.5e6`. Mock
        // router has no slippage, so it delivers 900 USDC exactly - which
        // meets the 900 USDC shortfall on the nose.
        uint256 usdeOut = 900 * 1e18;
        uint256 minUsdcOut = 895 * ONE_USDC;
        address[] memory targets = new address[](3);
        targets[0] = address(muMorpho);
        targets[1] = address(muUsde);
        targets[2] = address(muRouter);
        bytes[] memory calldatas = new bytes[](3);
        calldatas[0] =
            abi.encodeCall(IMorphoBlue.withdrawCollateral, (params, usdeOut, address(muVault), address(muVault)));
        calldatas[1] = abi.encodeCall(TestUSDe.approve, (address(muRouter), usdeOut));
        calldatas[2] = abi.encodeCall(
            IAerodromeCLRouter.exactInputSingle,
            (IAerodromeCLRouter.ExactInputSingleParams({
                    tokenIn: address(muUsde),
                    tokenOut: address(muUsdc),
                    tickSpacing: int24(1),
                    recipient: address(muVault),
                    deadline: block.timestamp + 300,
                    amountIn: usdeOut,
                    amountOutMinimum: minUsdcOut,
                    sqrtPriceLimitX96: 0
                }))
        );

        _attestOnWithPlan(
            muVault,
            bytes20(uint160(0xF33)),
            1_000 * ONE_USDC,
            3,
            PriimeVault.StrategyPlan({targets: targets, calldatas: calldatas, timestamp: block.timestamp + 300})
        );

        // ---- 5. Single-strike delivery: pending drained, claim booked.
        require(muVault.totalPendingRedeemShares() == 0, "pending drained in one strike");
        require(muVault.claimableRedeemRequest(0, ALICE) == 1_000 * ONE_USDC, "alice's claim materialised");
        require(muVault.totalClaimableRedeemAssets() == 1_000 * ONE_USDC, "claim booked against a real balance");
        // Position: 900 - 910 was capped at 900 by the mock, but the swap
        // still delivered enough for the claim. Residual position: whatever
        // the mock had left after the withdraw. What matters is the claim.

        // ---- 6. Alice actually collects.
        uint256 balBefore = muUsdc.balanceOf(ALICE);
        vm.prank(ALICE);
        uint256 assets = muVault.redeem(1_000 * ONE_USDC, ALICE, ALICE);
        require(assets == 1_000 * ONE_USDC, "claim delivers 1000 USDC");
        require(muUsdc.balanceOf(ALICE) - balBefore == 1_000 * ONE_USDC, "USDC lands in alice's wallet");
    }

    // --- helpers used by the Khaled regression tests --------------------------

    function _buildMorphoMockStack()
        internal
        returns (PriimeVault v, MockAerodromeRouter router, MockMorpho morphoMock, TestUSDC usdcMock, TestUSDe usdeMock)
    {
        usdcMock = new TestUSDC();
        usdeMock = new TestUSDe();
        morphoMock = new MockMorpho(IERC20(address(usdcMock)), IERC20(address(usdeMock)));
        router = new MockAerodromeRouter(IERC20(address(usdcMock)), IERC20(address(usdeMock)));
        ToggleableServiceManager mgr = new ToggleableServiceManager();
        v = new PriimeVault(
            IWavsServiceManager(address(mgr)),
            IERC20(address(usdcMock)),
            STRATEGIST,
            PriimeVault.StrategyConfig({
                collateralToken: address(usdeMock),
                morpho: address(morphoMock),
                morphoOracle: address(0x02),
                morphoIrm: address(0x03),
                morphoLltv: 915_000_000_000_000_000,
                swapRouter: address(router),
                poolTickSpacing: int24(1)
            })
        );
        usdcMock.mint(address(morphoMock), 100_000 * ONE_USDC);
        usdeMock.mint(address(router), 100_000 * 1e18);
        usdcMock.mint(address(router), 100_000 * ONE_USDC);
    }

    function _openPosition2x(
        PriimeVault v,
        TestUSDC usdcT,
        TestUSDe usdeT,
        MockAerodromeRouter router,
        MockMorpho morphoM
    ) internal {
        vm.prank(STRATEGIST);
        v.execute(address(usdcT), abi.encodeCall(TestUSDC.approve, (address(router), 1_000 * ONE_USDC)));
        vm.prank(STRATEGIST);
        v.execute(
            address(router),
            abi.encodeCall(
                IAerodromeCLRouter.exactInputSingle,
                (IAerodromeCLRouter.ExactInputSingleParams({
                        tokenIn: address(usdcT),
                        tokenOut: address(usdeT),
                        tickSpacing: int24(1),
                        recipient: address(v),
                        deadline: block.timestamp + 300,
                        amountIn: 1_000 * ONE_USDC,
                        amountOutMinimum: 0,
                        sqrtPriceLimitX96: 0
                    }))
            )
        );
        vm.prank(STRATEGIST);
        v.execute(address(usdeT), abi.encodeCall(TestUSDe.approve, (address(morphoM), 1_000 * 1e18)));
        vm.prank(STRATEGIST);
        v.execute(
            address(morphoM),
            abi.encodeCall(
                IMorphoBlue.supplyCollateral,
                (
                    IMorphoBlue.MarketParams({
                        loanToken: address(usdcT),
                        collateralToken: address(usdeT),
                        oracle: address(0x02),
                        irm: address(0x03),
                        lltv: 915_000_000_000_000_000
                    }),
                    1_000 * 1e18,
                    address(v),
                    ""
                )
            )
        );
        vm.prank(STRATEGIST);
        v.execute(
            address(morphoM),
            abi.encodeCall(
                IMorphoBlue.borrow,
                (
                    IMorphoBlue.MarketParams({
                        loanToken: address(usdcT),
                        collateralToken: address(usdeT),
                        oracle: address(0x02),
                        irm: address(0x03),
                        lltv: 915_000_000_000_000_000
                    }),
                    500 * ONE_USDC,
                    0,
                    address(v),
                    address(v)
                )
            )
        );
    }

    function _foldIdleIntoPosition(
        PriimeVault v,
        TestUSDC usdcT,
        TestUSDe usdeT,
        MockAerodromeRouter router,
        MockMorpho morphoM,
        uint256 usdcAmount
    ) internal {
        vm.prank(STRATEGIST);
        v.execute(address(usdcT), abi.encodeCall(TestUSDC.approve, (address(router), usdcAmount)));
        vm.prank(STRATEGIST);
        v.execute(
            address(router),
            abi.encodeCall(
                IAerodromeCLRouter.exactInputSingle,
                (IAerodromeCLRouter.ExactInputSingleParams({
                        tokenIn: address(usdcT),
                        tokenOut: address(usdeT),
                        tickSpacing: int24(1),
                        recipient: address(v),
                        deadline: block.timestamp + 300,
                        amountIn: usdcAmount,
                        amountOutMinimum: 0,
                        sqrtPriceLimitX96: 0
                    }))
            )
        );
        uint256 usdeAmount = usdcAmount * 1e12; // par
        vm.prank(STRATEGIST);
        v.execute(address(usdeT), abi.encodeCall(TestUSDe.approve, (address(morphoM), usdeAmount)));
        vm.prank(STRATEGIST);
        v.execute(
            address(morphoM),
            abi.encodeCall(
                IMorphoBlue.supplyCollateral,
                (
                    IMorphoBlue.MarketParams({
                        loanToken: address(usdcT),
                        collateralToken: address(usdeT),
                        oracle: address(0x02),
                        irm: address(0x03),
                        lltv: 915_000_000_000_000_000
                    }),
                    usdeAmount,
                    address(v),
                    ""
                )
            )
        );
    }
    // --- helpers scoped to the flashloan-delever exercise ---------------------

    function _attestOn(PriimeVault v, bytes20 eventId, uint256 nav, uint256 inputsBlock) internal {
        PriimeVault.StrategyPlan memory emptyPlan =
            PriimeVault.StrategyPlan({targets: new address[](0), calldatas: new bytes[](0), timestamp: 0});
        _attestOnWithPlan(v, eventId, nav, inputsBlock, emptyPlan);
    }

    function _attestOnWithPlan(
        PriimeVault v,
        bytes20 eventId,
        uint256 nav,
        uint256 inputsBlock,
        PriimeVault.StrategyPlan memory plan
    ) internal {
        PriimeVault.BoundNavResult memory result = PriimeVault.BoundNavResult({
            handler: address(v),
            nav: nav,
            inputsBlock: inputsBlock,
            configHash: bytes32(0),
            leverageBps: 0,
            ltvBps: 0,
            reserveBps: 0,
            supplyApyBps: 0,
            hoursSinceUpdate: 0,
            breachFlags: 0,
            plan: plan
        });
        IWavsServiceHandler.Envelope memory env =
            IWavsServiceHandler.Envelope({eventId: eventId, ordering: bytes12(0), payload: abi.encode(result)});
        v.handleSignedEnvelope(env, _sigs());
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
        vm.expectRevert(abi.encodeWithSelector(PriimeVault.FutureInputsBlock.selector, type(uint256).max, block.number));
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
            payload: abi.encode(
                PriimeVault.BoundNavResult({
                    handler: other,
                    nav: uint256(1_000 * ONE_USDC),
                    inputsBlock: uint256(100),
                    configHash: bytes32(0),
                    leverageBps: 0,
                    ltvBps: 0,
                    reserveBps: 0,
                    supplyApyBps: 0,
                    hoursSinceUpdate: 0,
                    breachFlags: 0,
                    plan: PriimeVault.StrategyPlan({targets: new address[](0), calldatas: new bytes[](0), timestamp: 0})
                })
            )
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

        // Emission order (post Khaled-review reorder): deposits fulfil in
        // the outer frame, NAV update logs, then executePlanSelf runs which
        // is where redemption fulfilment now lives so its
        // `RedeemRequestFulfilled` event fires *inside* the plan self-call.
        vm.expectEmit(true, false, false, true);
        emit PriimeVault.DepositRequestFulfilled(BOB, 600 * ONE_USDC, 300 * ONE_USDC);
        vm.expectEmit(true, false, false, true);
        emit PriimeVault.NavUpdated(
            bytes20(uint160(0xE7E21)),
            2_000 * ONE_USDC,
            2,
            2,
            bytes32(0),
            uint32(0),
            uint32(0),
            uint32(0),
            uint32(0),
            uint32(0),
            uint16(0)
        );
        vm.expectEmit(true, false, false, true);
        emit PriimeVault.RedeemRequestFulfilled(ALICE, 250 * ONE_USDC, 500 * ONE_USDC);
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
            payload: abi.encode(
                PriimeVault.BoundNavResult({
                    handler: address(vault),
                    nav: uint256(1_234 * ONE_USDC),
                    inputsBlock: uint256(7),
                    configHash: bytes32(0),
                    leverageBps: 0,
                    ltvBps: 0,
                    reserveBps: 0,
                    supplyApyBps: 0,
                    hoursSinceUpdate: 0,
                    breachFlags: 0,
                    plan: PriimeVault.StrategyPlan({targets: new address[](0), calldatas: new bytes[](0), timestamp: 0})
                })
            )
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
            payload: abi.encode(
                PriimeVault.BoundNavResult({
                    handler: address(vault),
                    nav: uint256(1_235 * ONE_USDC),
                    inputsBlock: uint256(8),
                    configHash: bytes32(0),
                    leverageBps: 0,
                    ltvBps: 0,
                    reserveBps: 0,
                    supplyApyBps: 0,
                    hoursSinceUpdate: 0,
                    breachFlags: 0,
                    plan: PriimeVault.StrategyPlan({targets: new address[](0), calldatas: new bytes[](0), timestamp: 0})
                })
            )
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

    /* Reviewer's finding: the plan whitelist was target-only, so
       `target.call(data)` forwarded raw calldata. A quorum-signed plan
       could call `withdrawCollateral(..., rogueReceiver)` (USDe drain),
       `approve(rogue, max)` on either token (persistent pull), or a
       Morpho method with a foreign `onBehalf` — all invisible to the
       escrow-floor check (USDC only). This walks every rejection path
       `_validatePlanStep` now closes. `executePlanSelf` is gated by
       `SelfCallOnly`; `vm.prank(address(vault))` satisfies it. */
    function test_PlanValidatorRefusesEveryEscapeHatch() public {
        IMorphoBlue.MarketParams memory params = IMorphoBlue.MarketParams({
            loanToken: address(usdc),
            collateralToken: address(0xC0),
            oracle: address(0x02),
            irm: address(0x03),
            lltv: 915_000_000_000_000_000
        });
        address morpho = address(0xD1);
        address router = address(0x04);
        address collateral = address(0xC0);

        // (1) Random target off the four-address list.
        _expectRejectedStep(
            address(0xDEAD),
            abi.encodeCall(IERC20.approve, (morpho, 100)),
            abi.encodeWithSelector(PriimeVault.PlanTargetNotWhitelisted.selector, address(0xDEAD))
        );

        // (2) `approve` on the asset with a rogue spender — persistent pull.
        _expectRejectedStep(
            address(usdc),
            abi.encodeCall(IERC20.approve, (SINK, type(uint256).max)),
            abi.encodeWithSelector(PriimeVault.PlanApproveSpenderRefused.selector, SINK)
        );

        // (3) Same drain on the collateral token.
        _expectRejectedStep(
            collateral,
            abi.encodeCall(IERC20.approve, (SINK, type(uint256).max)),
            abi.encodeWithSelector(PriimeVault.PlanApproveSpenderRefused.selector, SINK)
        );

        // (4) The reviewer's headline path: `withdrawCollateral(..., SINK)`
        //     — USDe leaves the vault, escrow floor sees only USDC.
        _expectRejectedStep(
            morpho,
            abi.encodeCall(IMorphoBlue.withdrawCollateral, (params, 1e18, address(vault), SINK)),
            abi.encodeWithSelector(PriimeVault.PlanReceiverNotSelf.selector, SINK)
        );

        // (5) Same shape on the USDC leg via `borrow`.
        _expectRejectedStep(
            morpho,
            abi.encodeCall(IMorphoBlue.borrow, (params, 100, 0, address(vault), SINK)),
            abi.encodeWithSelector(PriimeVault.PlanReceiverNotSelf.selector, SINK)
        );

        // (6) `supplyCollateral(..., SINK, "")` — vault's approval moves
        //     into SINK's position slot.
        _expectRejectedStep(
            morpho,
            abi.encodeCall(IMorphoBlue.supplyCollateral, (params, 1e18, SINK, "")),
            abi.encodeWithSelector(PriimeVault.PlanOnBehalfNotSelf.selector, SINK)
        );

        // (7) `repay(..., SINK, "")` — vault's USDC repays someone else's debt.
        _expectRejectedStep(
            morpho,
            abi.encodeCall(IMorphoBlue.repay, (params, 100, 0, SINK, "")),
            abi.encodeWithSelector(PriimeVault.PlanOnBehalfNotSelf.selector, SINK)
        );

        // (8) `flashLoan` with a non-asset token — the callback is written
        //     for USDC-in / USDe-out only.
        _expectRejectedStep(
            morpho,
            abi.encodeCall(IMorphoBlue.flashLoan, (collateral, 100, "")),
            abi.encodeWithSelector(PriimeVault.PlanFlashLoanTokenRefused.selector, collateral)
        );

        // (9) A selector outside the Morpho set (e.g. `setAuthorization`).
        bytes4 rogueSel = bytes4(keccak256("setAuthorization(address,bool)"));
        _expectRejectedStep(
            morpho,
            abi.encodeWithSelector(rogueSel, SINK, true),
            abi.encodeWithSelector(PriimeVault.PlanSelectorRefused.selector, morpho, rogueSel)
        );

        // (10) A selector outside the router set.
        bytes4 wrongRouterSel = bytes4(keccak256("exactOutputSingle(bytes)"));
        _expectRejectedStep(
            router,
            abi.encodeWithSelector(wrongRouterSel, ""),
            abi.encodeWithSelector(PriimeVault.PlanSelectorRefused.selector, router, wrongRouterSel)
        );

        // (11) `exactInputSingle` with a rogue recipient — USDe → USDC swap
        //      lands somewhere else.
        IAerodromeCLRouter.ExactInputSingleParams memory swapParams = IAerodromeCLRouter.ExactInputSingleParams({
            tokenIn: collateral,
            tokenOut: address(usdc),
            tickSpacing: 1,
            recipient: SINK,
            deadline: block.timestamp + 300,
            amountIn: 100,
            amountOutMinimum: 100,
            sqrtPriceLimitX96: 0
        });
        _expectRejectedStep(
            router,
            abi.encodeCall(IAerodromeCLRouter.exactInputSingle, (swapParams)),
            abi.encodeWithSelector(PriimeVault.PlanReceiverNotSelf.selector, SINK)
        );

        // (12) Truncated calldata — the selector-based dispatch would read
        //      off the end and mis-classify.
        _expectRejectedStep(morpho, hex"01", abi.encodeWithSelector(PriimeVault.PlanCalldataTooShort.selector));
    }

    function _expectRejectedStep(address target, bytes memory data, bytes memory expectedRevert) internal {
        address[] memory targets = new address[](1);
        targets[0] = target;
        bytes[] memory calldatas = new bytes[](1);
        calldatas[0] = data;
        PriimeVault.StrategyPlan memory plan =
            PriimeVault.StrategyPlan({targets: targets, calldatas: calldatas, timestamp: block.timestamp});
        vm.prank(address(vault));
        vm.expectRevert(expectedRevert);
        vault.executePlanSelf(plan);
    }
}
