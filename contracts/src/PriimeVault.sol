// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IWavsServiceHandler} from "./interfaces/wavs/IWavsServiceHandler.sol";
import {IWavsServiceManager} from "./interfaces/wavs/IWavsServiceManager.sol";
import {IMorphoBlue, IMorphoFlashLoanCallback} from "./interfaces/external/IMorphoBlue.sol";
import {IAerodromeCLRouter} from "./interfaces/external/IAerodromeCLRouter.sol";

/// @title PriimeVault
/// @notice ERC-7540 fully asynchronous vault (async deposits AND async
///         redemptions) over a single asset (USDC), whose settlement price is
///         the WAVS quorum-attested NAV: "the vault that cannot lie".
///
///         Why 7540 and not sync 4626: the vault's NAV is attested
///         asynchronously, one strike at a time, by operators re-executing the
///         NAV computation and reaching quorum through the service manager. A
///         synchronous 4626 exchange rate would have to price against a value
///         the contract cannot verify between strikes. ERC-7540 makes the
///         attestation the settlement event: requests queue as Pending, and
///         each accepted NAV strike fulfills every pending request at the
///         attested price (single epoch per strike). Lagoon-style mechanics;
///         the differentiation is that fulfillment prices come from
///         quorum-attested re-execution, not a trusted updater.
///
/// @dev Demo scale, own capital only: no fees, no cancelation flow, not
///      audited, not for public depositors. Fulfillment iterates every pending
///      controller in one transaction, so each queue is capped at
///      `MAX_QUEUE_LENGTH` distinct controllers; the gas is bounded but still
///      sized for demo participant counts only.
///
///      Payload encoding (must stay in lockstep with the NAV component):
///      `envelope.payload = abi.encode(address handler, uint256 nav,
///      uint256 inputsBlock)`. The first word binds the envelope to its
///      intended handler: the component signs the address of the contract
///      the attestation is meant for (this vault, delivered as workflow
///      config), and `handleSignedEnvelope` accepts only payloads bound to
///      `address(this)`. A service manager is shared service-wide across
///      workflows, so the binding is what scopes an attestation to one
///      handler. The second word is the attested NAV in asset base units
///      (USDC, 6 decimals); the third is the journal's `inputs_block`, the
///      block height whose state the operators read (NAV-03: the component
///      self-reports it, since cron triggers carry no height). Every
///      operator signs these exact bytes, so the quorum is over
///      (handler, nav, inputsBlock) as a triple.
///
///      Accounting coherence (this defines what the NAV component must
///      measure): the stored `nav` is what backs outstanding shares, and
///      `totalAssets()` returns it.
///        - USDC escrowed by `requestDeposit` is Pending and NOT part of NAV
///          (`totalPendingDepositAssets` tracks it).
///        - At fulfillment, fulfilled deposit assets are folded INTO `nav`
///          and fulfilled redemption payouts are carved OUT of `nav`, so the
///          share price stays consistent between strikes.
///        - USDC reserved for claimable redemptions is NOT part of NAV
///          (`totalClaimableRedeemAssets` tracks it).
///      Therefore the attested NAV must equal: strategy position value plus
///      any vault-held USDC already folded into the share pool, EXCLUDING
///      `totalPendingDepositAssets` and `totalClaimableRedeemAssets` (both
///      public precisely so the component can read and exclude them).
///
///      ERC-7540 conformance notes: fungible request model with
///      `requestId == 0` everywhere; requests are aggregated per controller.
///      `deposit`/`mint` are claim-only (assets moved at `requestDeposit`);
///      `redeem`/`withdraw` are claim-only (shares moved at `requestRedeem`)
///      and their `owner` parameter is the 7540 `controller`. All `preview*`
///      revert. Partial claims use floor division, and the claim that empties
///      either side of a bucket settles the whole bucket, so rounding dust
///      goes to the final claimer rather than stranding in the vault.
contract PriimeVault is ERC4626, IWavsServiceHandler, IMorphoFlashLoanCallback {
    using SafeERC20 for IERC20;

    /// @notice Fungible request model: every request is requestId 0.
    uint256 public constant REQUEST_ID = 0;

    /// @notice Maximum number of distinct controllers queued per side.
    ///         Fulfillment iterates the whole queue inside `handleSignedEnvelope`,
    ///         so an unbounded queue is a NAV update that cannot fit in a block:
    ///         the vault would be bricked by its own backlog. At demo scale
    ///         (own capital, a handful of participants) 100 controllers per side
    ///         is far above expected use and still settles well inside the block
    ///         gas limit. Only new controllers consume a slot; a controller
    ///         already queued can always top up.
    uint256 public constant MAX_QUEUE_LENGTH = 100;

    /// @notice Service manager (POA stake registry) that validates operator sigs.
    IWavsServiceManager public immutable serviceManager;

    /// @notice Trusted demo role that drives the strategy from the vault's own
    ///         balance via `execute` (manual override). Quorum-signed
    ///         `StrategyPlan`s in `handleSignedEnvelope` are the primary path;
    ///         `execute` remains for emergency out-of-band moves.
    address public immutable strategist;

    /// @notice Recursive USDe/USDC loop config, pinned at construction so
    ///         every quorum-signed step targets the market and swap route the
    ///         vault was configured for. Any target outside this whitelist
    ///         fails `handleSignedEnvelope`'s dispatch guard.
    address public immutable collateralToken;
    IMorphoBlue public immutable morpho;
    address public immutable morphoOracle;
    address public immutable morphoIrm;
    uint256 public immutable morphoLltv;
    address public immutable swapRouter;
    int24 public immutable poolTickSpacing;

    /// @notice Latest attested NAV in asset base units; what backs outstanding
    ///         shares. `totalAssets()` returns this.
    uint256 public nav;
    /// @notice `inputs_block` of the last accepted NAV update (staleness guard).
    uint256 public lastInputsBlock;
    /// @notice Number of NAV updates successfully recorded.
    uint256 public updateCount;
    /// @notice keccak256 of the workflow's canonicalized componentConfig, as
    ///         computed by the vault-nav component on every strike. Stored so
    ///         off-chain verifiers can prove which pinned service.json the
    ///         operator quorum ran against - any drift from the config the
    ///         user chose at publish would produce a different hash here.
    ///         Zero until the first attested strike lands.
    bytes32 public lastConfigHash;
    /// @notice Replay guard: each envelope `eventId` is processed at most once.
    mapping(bytes20 => bool) public processed;

    /// @notice ERC-7540 operator approvals: controller => operator => approved.
    mapping(address => mapping(address => bool)) private _operators;

    // Deposit request state (per controller, requestId 0 aggregation).
    mapping(address => uint256) private _pendingDepositAssets;
    mapping(address => uint256) private _claimableDepositAssets;
    mapping(address => uint256) private _claimableDepositShares;
    address[] private _depositQueue;
    /// @notice Escrowed USDC awaiting fulfillment; NOT part of NAV.
    uint256 public totalPendingDepositAssets;

    // Redeem request state (per controller, requestId 0 aggregation).
    mapping(address => uint256) private _pendingRedeemShares;
    mapping(address => uint256) private _claimableRedeemShares;
    mapping(address => uint256) private _claimableRedeemAssets;
    address[] private _redeemQueue;
    /// @notice Escrowed shares awaiting fulfillment (still in totalSupply).
    uint256 public totalPendingRedeemShares;
    /// @notice USDC reserved for claimable redemptions; NOT part of NAV.
    uint256 public totalClaimableRedeemAssets;

    /// @notice Non-zero when the last accepted NAV strike raised at least
    ///         one strategist-configured guard (LTV above the hf_floor, or
    ///         drift past the deleverage trigger). While set, the vault
    ///         refuses new `requestDeposit` / `requestRedeem`; existing
    ///         claims fulfill normally. Cleared automatically the next
    ///         strike whose payload attests clean flags. Bit layout:
    ///           bit 0 = hf_floor breached
    ///           bit 1 = deleverage trigger crossed
    ///         Mirrors `components/vault-nav/src/nav.rs::BREACH_*`.
    uint16 public breachFlags;

    // ERC-7540 events.
    event DepositRequest(
        address indexed controller, address indexed owner, uint256 indexed requestId, address sender, uint256 assets
    );
    event RedeemRequest(
        address indexed controller, address indexed owner, uint256 indexed requestId, address sender, uint256 shares
    );
    event OperatorSet(address indexed controller, address indexed operator, bool approved);
    // Implementation events.
    /// @notice A NAV strike lands. `eventId` is the aggregator's dedup key.
    ///         `nav` is the settled value in USDC base units; `inputsBlock` is
    ///         the block whose state the operators read; `updateCount` is a
    ///         monotonically increasing strike count; `configHash` is
    ///         keccak256 of the canonicalized workflow componentConfig (the
    ///         "cannot lie about config" cryptographic bind).
    ///
    ///         Observation fields are per-strike measurements every operator
    ///         independently computed at `inputsBlock`:
    ///           - leverageBps = debt * 10_000 / (par_collateral - debt)
    ///           - ltvBps       = debt * 10_000 / par_collateral
    ///           - reserveBps   = usdc_balance * 10_000 / nav
    ///           - supplyApyBps = annualized supply APY (bps)
    ///           - hoursSinceUpdate = hours between market lastUpdate and
    ///             `inputsBlock` timestamp.
    ///         Each maps to a composer knob (applied_leverage, hf_*_bps,
    ///         reserve_fraction, collateral_yield_apy, compound_cadence_hours)
    ///         so downstream verifiers gate on measured-vs-configured drift.
    event NavUpdated(
        bytes20 indexed eventId,
        uint256 nav,
        uint256 inputsBlock,
        uint256 updateCount,
        bytes32 configHash,
        uint32 leverageBps,
        uint32 ltvBps,
        uint32 reserveBps,
        uint32 supplyApyBps,
        uint32 hoursSinceUpdate,
        uint16 breachFlags
    );
    event DepositRequestFulfilled(address indexed controller, uint256 assets, uint256 shares);
    event RedeemRequestFulfilled(address indexed controller, uint256 shares, uint256 assets);
    /// @notice A pending deposit could not be priced at the attested NAV
    ///         (zero NAV against outstanding shares, or an amount too small to
    ///         buy one share) and was returned to its controller.
    event DepositRequestRefunded(address indexed controller, uint256 assets);
    /// @notice A strategist call left the vault above the escrow floor. The
    ///         full calldata is logged: `execute` is the vault's only arbitrary
    ///         call path, so this is the audit trail for every strategy action
    ///         taken between NAV strikes.
    event Executed(address indexed target, bytes data);

    /// @notice A quorum-signed StrategyPlan landed and every whitelisted
    ///         step in it succeeded. `planHash` binds the log to the exact
    ///         (targets, calldatas, timestamp) tuple the operators signed.
    event PlanExecuted(bytes32 indexed planHash, uint256 stepCount);
    /// @notice The plan reverted somewhere in the batch. `reason` is the raw
    ///         revert bytes from the failing step or the escrow-floor guard.
    ///         NAV attestation and fulfillments already landed in the same
    ///         transaction; only the plan's on-chain writes rolled back.
    event PlanRejected(bytes32 indexed planHash, bytes reason);

    error ZeroServiceManager();
    error ZeroStrategist();
    error NotStrategist();
    error SelfCallForbidden();
    error EscrowFloorBreached(uint256 balance, uint256 floor);
    /// @notice `emergencyExecute` was called while the vault is at or above
    ///         its escrow floor. The manual-recovery path is intentionally
    ///         only unlocked while the vault is stuck; once the floor is
    ///         restored, ordinary `execute` handles subsequent moves and
    ///         re-enforces the invariant.
    error VaultNotStuck(uint256 balance, uint256 floor);
    error ZeroAmount();
    error HandlerMismatch(address handler);
    error AlreadyProcessed(bytes20 eventId);
    error StaleInputsBlock(uint256 inputsBlock, uint256 lastInputsBlock);
    error FutureInputsBlock(uint256 inputsBlock, uint256 blockNumber);
    error NotOwnerOrOperator();
    error NotControllerOrOperator();
    error ExceedsClaimable(uint256 requested, uint256 claimable);
    error QueueFull();
    /// @notice `requestDeposit` / `requestRedeem` while the vault is under a
    ///         breach flag. Existing claims are unaffected; only NEW
    ///         requests are refused, until the next strike clears the flag.
    error VaultBreached(uint16 flags);

    /// @notice Batch of on-chain steps the operator quorum computed for
    ///         THIS strike. `targets[i]` is called with `calldatas[i]` under
    ///         the vault's own escrow-floor guard, once the NAV attestation
    ///         has landed. Every step is atomic across the batch: if any
    ///         reverts, the whole plan is rolled back and the strike still
    ///         records the attested NAV. `timestamp` binds the plan to its
    /// @notice The bytes every operator signs and the vault decodes. Layout
    ///         mirrors the component's `sol!` definition in
    ///         `components/vault-nav/src/nav.rs`; a two-line drift on
    ///         either side breaks decoding rather than silently reading
    ///         stale bytes. Encoding is Solidity's tuple format (a single
    ///         dynamic-typed element in `abi.encode` grows a leading offset
    ///         word), matching Rust alloy `struct.abi_encode()`.
    struct BoundNavResult {
        address handler;
        uint256 nav;
        uint256 inputsBlock;
        bytes32 configHash;
        uint32 leverageBps;
        uint32 ltvBps;
        uint32 reserveBps;
        uint32 supplyApyBps;
        uint32 hoursSinceUpdate;
        uint16 breachFlags;
        StrategyPlan plan;
    }

    ///         computing block for downstream verifiers.
    struct StrategyPlan {
        address[] targets;
        bytes[] calldatas;
        uint256 timestamp;
    }

    error PlanArrayMismatch();
    error PlanTargetNotWhitelisted(address target);
    error SelfCallOnly();
    error AsyncFlowOnly();
    /// @notice `onMorphoFlashLoan` was invoked by a caller other than the
    ///         pinned Morpho instance. Prevents any attacker from tricking
    ///         the callback into repaying + withdrawing collateral outside a
    ///         real flashLoan context.
    error FlashLoanCallerNotMorpho(address caller);
    /// @notice The USDe -> USDC swap inside `onMorphoFlashLoan` returned fewer
    ///         USDC than the operator quorum's `minUsdcOut` floor. Bubbled up
    ///         from the router with our own selector so `PlanRejected` decodes
    ///         cleanly on the frontend.
    error DeleverageSlippage(uint256 usdcOut, uint256 minUsdcOut);
    /// @notice The strike's `plan_deleverage` step freed enough USDC to
    ///         cover this strike's fresh redemption claims. `flashAssets`
    ///         is the flashloan principal, `collateralOut` the USDe pulled
    ///         from Morpho, `usdcOut` the swap output.
    event Deleveraged(uint256 flashAssets, uint256 collateralOut, uint256 usdcOut);

    /// @dev Groups the recursive-loop strategy parameters into one calldata
    ///      struct so the constructor stays readable; every field lands as
    ///      an immutable on the contract.
    struct StrategyConfig {
        address collateralToken;
        address morpho;
        address morphoOracle;
        address morphoIrm;
        uint256 morphoLltv;
        address swapRouter;
        int24 poolTickSpacing;
    }

    error ZeroStrategyConfigField();

    constructor(
        IWavsServiceManager _serviceManager,
        IERC20 _asset,
        address _strategist,
        StrategyConfig memory _strategy
    ) ERC4626(_asset) ERC20("Priime Vault Share", "pvUSDC") {
        if (address(_serviceManager) == address(0)) revert ZeroServiceManager();
        if (_strategist == address(0)) revert ZeroStrategist();
        if (
            _strategy.collateralToken == address(0) || _strategy.morpho == address(0)
                || _strategy.morphoOracle == address(0) || _strategy.morphoIrm == address(0)
                || _strategy.morphoLltv == 0 || _strategy.swapRouter == address(0) || _strategy.poolTickSpacing == 0
        ) revert ZeroStrategyConfigField();
        serviceManager = _serviceManager;
        strategist = _strategist;
        collateralToken = _strategy.collateralToken;
        morpho = IMorphoBlue(_strategy.morpho);
        morphoOracle = _strategy.morphoOracle;
        morphoIrm = _strategy.morphoIrm;
        morphoLltv = _strategy.morphoLltv;
        swapRouter = _strategy.swapRouter;
        poolTickSpacing = _strategy.poolTickSpacing;
    }

    /// @dev The Morpho MarketParams tuple this vault is bound to. Built from
    ///      the strategy immutables so callers never restate them.
    function _marketParams() internal view returns (IMorphoBlue.MarketParams memory) {
        return IMorphoBlue.MarketParams({
            loanToken: asset(), collateralToken: collateralToken, oracle: morphoOracle, irm: morphoIrm, lltv: morphoLltv
        });
    }

    /// @dev The set of contracts the operator quorum may call through a
    ///      StrategyPlan. Kept narrow to the two protocols the recursive
    ///      loop touches (Morpho Blue for supply/borrow/repay/withdraw, the
    ///      swap router for USDC<->USDe) plus the two ERC-20s the vault
    ///      needs to approve. `execute`'s `SelfCallForbidden` covers
    ///      reentry into this vault; anything else outside the whitelist
    ///      would let a compromised operator drain funds to a rogue target.
    function _isPlanTarget(address target) internal view returns (bool) {
        return target == asset() || target == collateralToken || target == address(morpho) || target == swapRouter;
    }

    /// @notice Execute a quorum-signed StrategyPlan inside a self-call so
    ///         any failure rolls back the batch atomically. Callable only
    ///         from `handleSignedEnvelope` (msg.sender == address(this)); the
    ///         try/catch wrapper there keeps NAV settlement independent of
    ///         plan success.
    /// @dev Each step must target a whitelisted contract. Reverts bubble the
    ///      failing step's raw revert data. At the tail:
    ///        1. `_fulfillRedeems()` books this strike's redemption claims —
    ///           INSIDE the self-call so a plan revert rolls back the claim
    ///           bookkeeping too, and the vault never sits with
    ///           `totalClaimableRedeemAssets` raised against a balance the
    ///           plan failed to free (Khaled review, roadmap follow-up).
    ///        2. Escrow floor check, same guard `execute` enforces.
    /// @param plan The batch (targets, calldatas, timestamp) the quorum signed.
    /// @return planHash keccak256(abi.encode(plan)) — logged by the caller.
    function executePlanSelf(StrategyPlan calldata plan) external returns (bytes32 planHash) {
        if (msg.sender != address(this)) revert SelfCallOnly();
        if (plan.targets.length != plan.calldatas.length) revert PlanArrayMismatch();
        planHash = keccak256(abi.encode(plan.targets, plan.calldatas, plan.timestamp));
        for (uint256 i = 0; i < plan.targets.length; i++) {
            address target = plan.targets[i];
            if (!_isPlanTarget(target)) revert PlanTargetNotWhitelisted(target);
            (bool success, bytes memory ret) = target.call(plan.calldatas[i]);
            if (!success) {
                assembly ("memory-safe") {
                    revert(add(ret, 0x20), mload(ret))
                }
            }
        }
        // Book redemption claims AFTER the plan brought USDC in. If the
        // floor check below fails, `_fulfillRedeems` rolls back with the
        // rest of this self-call and shares stay in `_pendingRedeemShares`
        // for the next strike to try again.
        _fulfillRedeems();
        uint256 floor = totalPendingDepositAssets + totalClaimableRedeemAssets;
        uint256 balance = IERC20(asset()).balanceOf(address(this));
        if (balance < floor) revert EscrowFloorBreached(balance, floor);
    }

    // ------------------------------------------------------------------------
    // Morpho flashLoan callback: atomic proportional delever
    // ------------------------------------------------------------------------

    /// @notice Morpho Blue's flashLoan callback: the vault's own atomic
    ///         proportional-unwind primitive. The operator quorum's plan
    ///         emits one step, `morpho.flashLoan(USDC, debtRepay, data)`;
    ///         Morpho transfers `debtRepay` USDC to the vault, calls back
    ///         here, and pulls the same `debtRepay` back at the end. Inside
    ///         the callback we (1) repay `assets` of Morpho debt, (2) pull
    ///         `collateralOut` USDe of freed collateral, (3) swap it back to
    ///         USDC through the pinned Aerodrome pool, (4) re-approve the
    ///         flashloan repayment. Net inflow to the vault is
    ///         `usdcOut - assets` = `proportion * nav - slippage`, which is
    ///         exactly what a proportional redemption needs to satisfy the
    ///         escrow floor after `_fulfillRedeems`. Priime-pools's
    ///         `RebalanceOpsLib.unwindPositions` does the same thing
    ///         synchronously; we do it on the quorum-signed cadence.
    /// @dev Not exposed for user calls. `msg.sender` must be the pinned
    ///      Morpho instance (checked at entry); Morpho only invokes this
    ///      inside its own `flashLoan`, so a caller other than Morpho
    ///      cannot force the repay+withdraw sequence. Approvals are exact
    ///      per step; the trailing `approve(morpho, assets)` grants Morpho
    ///      permission to pull the flashloan back via `safeTransferFrom`.
    /// @param assets The flashloan principal in USDC base units. Also the
    ///        amount of Morpho debt this callback repays (they are the same
    ///        by construction of `plan_deleverage`).
    /// @param data ABI-encoded `(uint256 collateralOut, uint256 minUsdcOut,
    ///        uint256 deadline)`. `collateralOut` is the USDe amount pulled
    ///        from Morpho after the repay; `minUsdcOut` is the operator
    ///        quorum's slippage floor on the USDe -> USDC swap; `deadline`
    ///        gates the Aerodrome call the same way the open-position swap
    ///        does.
    function onMorphoFlashLoan(uint256 assets, bytes calldata data) external override {
        if (msg.sender != address(morpho)) revert FlashLoanCallerNotMorpho(msg.sender);
        (uint256 collateralOut, uint256 minUsdcOut, uint256 deadline, uint256 sharesToRepay) =
            abi.decode(data, (uint256, uint256, uint256, uint256));

        // 1. Repay Morpho debt by SHARES so accrued interest between the
        //    component's inputs_block estimate and this call is captured
        //    exactly (Khaled review). `assets = 0` tells Morpho to compute
        //    the pull amount from `shares × total_borrow_assets /
        //    total_borrow_shares` at the current rate. Full-unwind
        //    (`sharesToRepay == vault's borrow_shares`) zeroes debt, so the
        //    subsequent `withdrawCollateral(full)` passes the LLTV check.
        //    Approval is `assets` (the flashloan principal we hold, which
        //    is sized to cover the actual repay + 20 bps of accrual buffer),
        //    so a small over-allowance stays inside the vault as surplus.
        IERC20(asset()).forceApprove(address(morpho), assets);
        morpho.repay(_marketParams(), 0, sharesToRepay, address(this), "");

        // 2. Withdraw the freed collateral (USDe). Morpho enforces the new
        //    HF against the post-repay debt, so this can never leave the
        //    position undercollateralised.
        morpho.withdrawCollateral(_marketParams(), collateralOut, address(this), address(this));

        // 3. Swap USDe -> USDC through the pinned Aerodrome pool. `minUsdcOut`
        //    is the operator quorum's slippage floor, computed off the same
        //    TWAP the strike attests; the swap reverts if the pool has moved
        //    outside that window between the operator's read and this call.
        IERC20(collateralToken).forceApprove(swapRouter, collateralOut);
        uint256 usdcOut = IAerodromeCLRouter(swapRouter)
            .exactInputSingle(
                IAerodromeCLRouter.ExactInputSingleParams({
                    tokenIn: collateralToken,
                    tokenOut: asset(),
                    tickSpacing: poolTickSpacing,
                    recipient: address(this),
                    deadline: deadline,
                    amountIn: collateralOut,
                    amountOutMinimum: minUsdcOut,
                    sqrtPriceLimitX96: 0
                })
            );
        if (usdcOut < minUsdcOut) revert DeleverageSlippage(usdcOut, minUsdcOut);

        // 4. Grant Morpho the allowance it needs to pull the flashloan back.
        //    `safeTransferFrom` inside `flashLoan` consumes it exactly.
        IERC20(asset()).forceApprove(address(morpho), assets);

        emit Deleveraged(assets, collateralOut, usdcOut);
    }

    // ------------------------------------------------------------------------
    // Strategist execution path
    // ------------------------------------------------------------------------

    /// @notice Perform an arbitrary external call from the vault. This is how
    ///         the deploy-time loop entry script drives the Morpho position
    ///         (approvals, supply, borrow, swap) from the vault's own balance,
    ///         so the vault itself holds the position the NAV component reads.
    /// @dev Strategist-only; a trusted demo role (see `strategist`). Guards:
    ///      (1) caller must be the strategist; (2) `target` must not be the
    ///      vault itself, so `execute` can never re-enter request/claim/NAV
    ///      paths; (3) after the call, the vault's asset balance must remain
    ///      at or above the escrow floor `totalPendingDepositAssets +
    ///      totalClaimableRedeemAssets` — strategy capital is only the
    ///      folded-in share pool; escrowed pending deposits and reserved
    ///      redemption payouts can never be spent. Calling the asset token is
    ///      allowed (approvals need it); the floor covers misuse. Reverts
    ///      from `target` are bubbled with their original revert data.
    ///
    ///      The floor is evaluated at the end of this call only. Allowances
    ///      granted through `execute` persist beyond it, so approvals are
    ///      expected to be exact-amount and revoked once the entry sequence
    ///      completes. Emits `Executed` once the floor check passes.
    /// @param target Contract to call (never this vault).
    /// @param data   Full calldata for the target.
    /// @return result The target's raw return data.
    function execute(address target, bytes calldata data) external returns (bytes memory result) {
        if (msg.sender != strategist) revert NotStrategist();
        if (target == address(this)) revert SelfCallForbidden();

        bool success;
        (success, result) = target.call(data);
        if (!success) {
            // Bubble the target's revert data unchanged.
            assembly ("memory-safe") {
                revert(add(result, 0x20), mload(result))
            }
        }

        uint256 floor = totalPendingDepositAssets + totalClaimableRedeemAssets;
        uint256 balance = IERC20(asset()).balanceOf(address(this));
        if (balance < floor) revert EscrowFloorBreached(balance, floor);

        emit Executed(target, data);
    }

    /// @notice Strategist-only recovery path that skips the escrow-floor
    ///         check. Only unlocks when the vault is ALREADY stuck (balance
    ///         < floor); once ordinary strategy actions restore the floor
    ///         it refuses to run, so ordinary `execute` reasserts the
    ///         invariant.
    /// @dev Same shape as `execute` minus the post-call floor guard.
    ///      Motivation: when a plan_deleverage revert leaves
    ///      `totalClaimableRedeemAssets` raised against an idle balance
    ///      that never materialised, the standard `execute` path refuses
    ///      every intermediate step of a manual unwind (repay is
    ///      floor-under-water, withdraw is floor-under-water). This path
    ///      lets the strategist walk out of that state (repay, withdraw,
    ///      swap, back to solvent) without every step reasserting a floor
    ///      the sequence is trying to restore. The pre-check makes it
    ///      strictly a recovery tool: at any point above floor it reverts.
    ///      `msg.sender == strategist` + no self-call keeps the trust
    ///      surface identical to `execute`.
    function emergencyExecute(address target, bytes calldata data) external returns (bytes memory result) {
        if (msg.sender != strategist) revert NotStrategist();
        if (target == address(this)) revert SelfCallForbidden();

        uint256 floor = totalPendingDepositAssets + totalClaimableRedeemAssets;
        uint256 balance = IERC20(asset()).balanceOf(address(this));
        if (balance >= floor) revert VaultNotStuck(balance, floor);

        bool success;
        (success, result) = target.call(data);
        if (!success) {
            assembly ("memory-safe") {
                revert(add(result, 0x20), mload(result))
            }
        }

        emit Executed(target, data);
    }

    // ------------------------------------------------------------------------
    // ERC-7540 request flow: deposits
    // ------------------------------------------------------------------------

    /// @notice Escrow `assets` from `owner` and queue a deposit request for
    ///         `controller`. Fulfilled at the next accepted NAV strike.
    /// @dev Reverts with `QueueFull` when `controller` is not already queued
    ///      and the deposit queue holds `MAX_QUEUE_LENGTH` controllers.
    function requestDeposit(uint256 assets, address controller, address owner) external returns (uint256) {
        if (assets == 0) revert ZeroAmount();
        if (breachFlags != 0) revert VaultBreached(breachFlags);
        if (msg.sender != owner && !_operators[owner][msg.sender]) revert NotOwnerOrOperator();

        IERC20(asset()).safeTransferFrom(owner, address(this), assets);

        if (_pendingDepositAssets[controller] == 0) {
            if (_depositQueue.length >= MAX_QUEUE_LENGTH) revert QueueFull();
            _depositQueue.push(controller);
        }
        _pendingDepositAssets[controller] += assets;
        totalPendingDepositAssets += assets;

        emit DepositRequest(controller, owner, REQUEST_ID, msg.sender, assets);
        return REQUEST_ID;
    }

    /// @notice Pending (unfulfilled) deposit assets for `controller`.
    function pendingDepositRequest(uint256, address controller) external view returns (uint256) {
        return _pendingDepositAssets[controller];
    }

    /// @notice Fulfilled deposit assets for `controller`, claimable via
    ///         `deposit`/`mint`.
    function claimableDepositRequest(uint256, address controller) external view returns (uint256) {
        return _claimableDepositAssets[controller];
    }

    // ------------------------------------------------------------------------
    // ERC-7540 request flow: redemptions
    // ------------------------------------------------------------------------

    /// @notice Escrow `shares` from `owner` and queue a redemption request for
    ///         `controller`. Non-owner callers need operator approval or ERC-20
    ///         share allowance. Fulfilled at the next accepted NAV strike.
    /// @dev Reverts with `QueueFull` when `controller` is not already queued
    ///      and the redeem queue holds `MAX_QUEUE_LENGTH` controllers.
    function requestRedeem(uint256 shares, address controller, address owner) external returns (uint256) {
        if (shares == 0) revert ZeroAmount();
        if (breachFlags != 0) revert VaultBreached(breachFlags);
        if (msg.sender != owner && !_operators[owner][msg.sender]) {
            _spendAllowance(owner, msg.sender, shares);
        }

        _transfer(owner, address(this), shares);

        if (_pendingRedeemShares[controller] == 0) {
            if (_redeemQueue.length >= MAX_QUEUE_LENGTH) revert QueueFull();
            _redeemQueue.push(controller);
        }
        _pendingRedeemShares[controller] += shares;
        totalPendingRedeemShares += shares;

        emit RedeemRequest(controller, owner, REQUEST_ID, msg.sender, shares);
        return REQUEST_ID;
    }

    /// @notice Pending (unfulfilled) redemption shares for `controller`.
    function pendingRedeemRequest(uint256, address controller) external view returns (uint256) {
        return _pendingRedeemShares[controller];
    }

    /// @notice Fulfilled redemption shares for `controller`, claimable via
    ///         `redeem`/`withdraw`.
    function claimableRedeemRequest(uint256, address controller) external view returns (uint256) {
        return _claimableRedeemShares[controller];
    }

    // ------------------------------------------------------------------------
    // ERC-7540 operator model
    // ------------------------------------------------------------------------

    /// @notice Grant or revoke `operator`'s right to manage the caller's
    ///         requests (and, transitively, their assets and shares).
    function setOperator(address operator, bool approved) external returns (bool) {
        _operators[msg.sender][operator] = approved;
        emit OperatorSet(msg.sender, operator, approved);
        return true;
    }

    /// @notice True if `operator` may manage requests for `controller`.
    function isOperator(address controller, address operator) external view returns (bool) {
        return _operators[controller][operator];
    }

    // ------------------------------------------------------------------------
    // Claim paths (7540 repurposing of the 4626 entry points)
    // ------------------------------------------------------------------------

    /// @notice Claim fulfilled deposit assets for `msg.sender` as controller.
    /// @dev Does NOT transfer assets in (that happened at `requestDeposit`).
    function deposit(uint256 assets, address receiver) public override returns (uint256) {
        return _claimDeposit(assets, receiver, msg.sender);
    }

    /// @notice ERC-7540 overload: claim on behalf of `controller`.
    function deposit(uint256 assets, address receiver, address controller) external returns (uint256) {
        return _claimDeposit(assets, receiver, controller);
    }

    /// @notice Claim fulfilled deposit shares for `msg.sender` as controller.
    function mint(uint256 shares, address receiver) public override returns (uint256) {
        return _claimMint(shares, receiver, msg.sender);
    }

    /// @notice ERC-7540 overload: claim on behalf of `controller`.
    function mint(uint256 shares, address receiver, address controller) external returns (uint256) {
        return _claimMint(shares, receiver, controller);
    }

    /// @notice Claim fulfilled redemption payout by shares. The third
    ///         parameter is the 7540 `controller` (4626's `owner`).
    function redeem(uint256 shares, address receiver, address controller) public override returns (uint256) {
        _requireControllerOrOperator(controller);
        if (shares == 0) revert ZeroAmount();

        uint256 claimableShares = _claimableRedeemShares[controller];
        if (shares > claimableShares) revert ExceedsClaimable(shares, claimableShares);
        (uint256 sharesClaimed, uint256 assets) =
            _splitClaim(shares, claimableShares, _claimableRedeemAssets[controller]);

        _claimableRedeemShares[controller] = claimableShares - sharesClaimed;
        _claimableRedeemAssets[controller] -= assets;
        totalClaimableRedeemAssets -= assets;

        IERC20(asset()).safeTransfer(receiver, assets);
        emit Withdraw(msg.sender, receiver, controller, assets, sharesClaimed);
        return assets;
    }

    /// @notice Claim fulfilled redemption payout by assets. The third
    ///         parameter is the 7540 `controller` (4626's `owner`).
    function withdraw(uint256 assets, address receiver, address controller) public override returns (uint256) {
        _requireControllerOrOperator(controller);
        if (assets == 0) revert ZeroAmount();

        uint256 claimableAssets = _claimableRedeemAssets[controller];
        if (assets > claimableAssets) revert ExceedsClaimable(assets, claimableAssets);
        (uint256 assetsClaimed, uint256 shares) =
            _splitClaim(assets, claimableAssets, _claimableRedeemShares[controller]);

        _claimableRedeemAssets[controller] = claimableAssets - assetsClaimed;
        _claimableRedeemShares[controller] -= shares;
        totalClaimableRedeemAssets -= assetsClaimed;

        IERC20(asset()).safeTransfer(receiver, assetsClaimed);
        emit Withdraw(msg.sender, receiver, controller, assetsClaimed, shares);
        return shares;
    }

    function _claimDeposit(uint256 assets, address receiver, address controller) internal returns (uint256) {
        _requireControllerOrOperator(controller);
        if (assets == 0) revert ZeroAmount();

        uint256 claimableAssets = _claimableDepositAssets[controller];
        if (assets > claimableAssets) revert ExceedsClaimable(assets, claimableAssets);
        (uint256 assetsClaimed, uint256 shares) =
            _splitClaim(assets, claimableAssets, _claimableDepositShares[controller]);

        _claimableDepositAssets[controller] = claimableAssets - assetsClaimed;
        _claimableDepositShares[controller] -= shares;

        _transfer(address(this), receiver, shares);
        emit Deposit(controller, receiver, assetsClaimed, shares);
        return shares;
    }

    function _claimMint(uint256 shares, address receiver, address controller) internal returns (uint256) {
        _requireControllerOrOperator(controller);
        if (shares == 0) revert ZeroAmount();

        uint256 claimableShares = _claimableDepositShares[controller];
        if (shares > claimableShares) revert ExceedsClaimable(shares, claimableShares);
        (uint256 sharesClaimed, uint256 assets) =
            _splitClaim(shares, claimableShares, _claimableDepositAssets[controller]);

        _claimableDepositShares[controller] = claimableShares - sharesClaimed;
        _claimableDepositAssets[controller] -= assets;

        _transfer(address(this), receiver, sharesClaimed);
        emit Deposit(controller, receiver, assets, sharesClaimed);
        return assets;
    }

    /// @dev Price a partial claim against one of a controller's claimable
    ///      buckets. `requested` is denominated in the side the caller chose
    ///      (`ownTotal`); `counterTotal` is the other side of the same bucket,
    ///      priced pro rata off it.
    ///
    ///      Both sides floor, so a claim that empties one side must empty the
    ///      other in the same call. Otherwise the leftover reports as claimable
    ///      forever — a phantom `maxDeposit`/`maxMint`/`maxWithdraw`/`maxRedeem`
    ///      that no later claim can consume — and on the redeem side it strands
    ///      real reserved USDC inside `totalClaimableRedeemAssets`. Rounding
    ///      dust therefore settles to whoever closes the bucket, not to the
    ///      vault. Callers must have already rejected `requested > ownTotal`,
    ///      which also rules out `ownTotal == 0`.
    /// @return own     Amount consumed from the requested side.
    /// @return counter Amount consumed from the other side.
    function _splitClaim(uint256 requested, uint256 ownTotal, uint256 counterTotal)
        private
        pure
        returns (uint256 own, uint256 counter)
    {
        counter = (requested * counterTotal) / ownTotal;
        if (requested == ownTotal || counter == counterTotal) return (ownTotal, counterTotal);
        return (requested, counter);
    }

    function _requireControllerOrOperator(address controller) internal view {
        if (msg.sender != controller && !_operators[controller][msg.sender]) revert NotControllerOrOperator();
    }

    // ------------------------------------------------------------------------
    // 4626 view overrides
    // ------------------------------------------------------------------------

    /// @notice The attested NAV: what backs outstanding shares. Excludes
    ///         pending deposit escrow and reserved redemption payouts.
    function totalAssets() public view override returns (uint256) {
        return nav;
    }

    /// @notice Claimable deposit assets for `controller` (7540 semantics).
    function maxDeposit(address controller) public view override returns (uint256) {
        return _claimableDepositAssets[controller];
    }

    /// @notice Claimable deposit shares for `controller` (7540 semantics).
    function maxMint(address controller) public view override returns (uint256) {
        return _claimableDepositShares[controller];
    }

    /// @notice Claimable redemption assets for `controller` (7540 semantics).
    function maxWithdraw(address controller) public view override returns (uint256) {
        return _claimableRedeemAssets[controller];
    }

    /// @notice Claimable redemption shares for `controller` (7540 semantics).
    function maxRedeem(address controller) public view override returns (uint256) {
        return _claimableRedeemShares[controller];
    }

    /// @dev ERC-7540: preview functions MUST revert for async flows.
    function previewDeposit(uint256) public pure override returns (uint256) {
        revert AsyncFlowOnly();
    }

    /// @dev ERC-7540: preview functions MUST revert for async flows.
    function previewMint(uint256) public pure override returns (uint256) {
        revert AsyncFlowOnly();
    }

    /// @dev ERC-7540: preview functions MUST revert for async flows.
    function previewWithdraw(uint256) public pure override returns (uint256) {
        revert AsyncFlowOnly();
    }

    /// @dev ERC-7540: preview functions MUST revert for async flows.
    function previewRedeem(uint256) public pure override returns (uint256) {
        revert AsyncFlowOnly();
    }

    // ------------------------------------------------------------------------
    // ERC-165 / ERC-7575
    // ------------------------------------------------------------------------

    /// @notice ERC-165. Interface IDs fixed by EIP-7540: operator methods
    ///         (0xe3bc4e65), ERC-7575 (0x2f0a18c5), async deposit
    ///         (0xce3bbe50), async redeem (0x620ee8e4).
    function supportsInterface(bytes4 interfaceId) public pure returns (bool) {
        return interfaceId == 0x01ffc9a7 // ERC-165
            || interfaceId == 0xe3bc4e65 // ERC-7540 operator methods
            || interfaceId == 0x2f0a18c5 // ERC-7575
            || interfaceId == 0xce3bbe50 // ERC-7540 async deposit
            || interfaceId == 0x620ee8e4; // ERC-7540 async redeem
    }

    /// @notice ERC-7575: the share token is this contract itself.
    function share() external view returns (address) {
        return address(this);
    }

    // ------------------------------------------------------------------------
    // VAULT-02 / VAULT-03: attested NAV updates settle the epoch
    // ------------------------------------------------------------------------

    /// @inheritdoc IWavsServiceHandler
    /// @dev The only way NAV moves. Guards, in order: (0) the payload's
    ///      handler field must be this vault — an attestation is scoped to
    ///      exactly one handler, even though the service manager validating
    ///      it is shared service-wide; (1) the service manager reverts unless
    ///      the registered operator quorum signed these exact envelope bytes
    ///      (VAULT-02); (2) each `eventId` is accepted at most once
    ///      (VAULT-03 replay); (3) `inputsBlock` must be a height the chain
    ///      has actually reached, so a single corrupt quorum cannot sign an
    ///      unreachable height and freeze NAV behind the staleness floor
    ///      forever; (4) `inputsBlock` must strictly increase, so a
    ///      delayed-but-valid envelope can never move NAV back to an
    ///      earlier read of the position (VAULT-03 staleness). An accepted
    ///      update then records the attested NAV and fulfills ALL pending
    ///      deposit and redemption requests at that price in this same
    ///      transaction (single epoch per strike). Bootstrap: the first
    ///      fulfillment with zero share supply prices 1 share per USDC base
    ///      unit.
    function handleSignedEnvelope(Envelope calldata envelope, SignatureData calldata signatureData) external override {
        BoundNavResult memory result = abi.decode(envelope.payload, (BoundNavResult));
        address handler = result.handler;
        uint256 attestedNav = result.nav;
        uint256 inputsBlock = result.inputsBlock;
        bytes32 configHash = result.configHash;
        if (handler != address(this)) revert HandlerMismatch(handler);

        // Reverts unless the operator quorum signed this exact envelope.
        serviceManager.validate(envelope, signatureData);

        if (processed[envelope.eventId]) revert AlreadyProcessed(envelope.eventId);
        processed[envelope.eventId] = true;

        if (inputsBlock > block.number) revert FutureInputsBlock(inputsBlock, block.number);
        if (inputsBlock <= lastInputsBlock) revert StaleInputsBlock(inputsBlock, lastInputsBlock);

        nav = attestedNav;
        lastInputsBlock = inputsBlock;
        updateCount += 1;
        lastConfigHash = configHash;
        /* Mirror the operator quorum's breach verdict so `requestDeposit` /
           `requestRedeem` refuse new capital while a strategist-configured
           guard is live. Existing pending claims fulfill above regardless
           because a breach is exactly when redeemers most need to exit. */
        breachFlags = result.breachFlags;

        _fulfillDeposits();
        // NOTE: `_fulfillRedeems` now runs INSIDE `executePlanSelf` (Khaled
        // review). If the plan can't free enough USDC to cover the fresh
        // claims, the whole self-call reverts and the fulfilment rolls
        // back with it, so `totalClaimableRedeemAssets` never sits raised
        // against a balance the plan failed to lift.

        emit NavUpdated(
            envelope.eventId,
            attestedNav,
            inputsBlock,
            updateCount,
            configHash,
            result.leverageBps,
            result.ltvBps,
            result.reserveBps,
            result.supplyApyBps,
            result.hoursSinceUpdate,
            result.breachFlags
        );

        /* Plan + redemption fulfilment run atomically inside `executePlanSelf`.
           NAV settlement and DEPOSIT fulfilment above already committed; if
           the plan or its downstream fulfilment reverts, only the plan's own
           writes AND the redemption bookkeeping roll back. Shares stay in
           `_pendingRedeemShares` for the next strike to try again. The
           try/catch here keeps NAV settlement independent of plan success. */
        bytes32 planHash = keccak256(abi.encode(result.plan.targets, result.plan.calldatas, result.plan.timestamp));
        try this.executePlanSelf(result.plan) {
            emit PlanExecuted(planHash, result.plan.targets.length);
        } catch (bytes memory reason) {
            emit PlanRejected(planHash, reason);
        }
    }

    /// @inheritdoc IWavsServiceHandler
    function getServiceManager() external view override returns (address) {
        return address(serviceManager);
    }

    /// @dev Fulfill every pending deposit at the attested price. Minted shares
    ///      are escrowed in the vault until claimed; each fulfilled deposit
    ///      folds its assets into `nav`, which keeps the share price invariant
    ///      across the loop (nav and supply scale together).
    ///
    ///      Unpriceable deposits are refunded, never reverted and never minted
    ///      at zero shares. With shares outstanding, a deposit has no price if
    ///      the attested NAV is zero (total loss) or if the amount is too small
    ///      to buy one share at the attested price. Reverting would brick every
    ///      future NAV update, since there is no cancelation flow to drain the
    ///      queue; minting zero shares would donate the deposit to existing
    ///      holders. Both are worse than handing the assets back, so the
    ///      escrowed USDC returns to the controller and the request closes.
    ///      The bootstrap branch never refunds: shares equal assets, which
    ///      `requestDeposit` already forces to be non-zero.
    function _fulfillDeposits() private {
        uint256 n = _depositQueue.length;
        for (uint256 i = 0; i < n; i++) {
            address controller = _depositQueue[i];
            uint256 assets = _pendingDepositAssets[controller];

            uint256 supply = totalSupply();
            uint256 shares;
            if (supply == 0) {
                // Bootstrap: 1 share per USDC base unit. The deposit is folded
                // into `nav` exactly as in the priced branch, so any attested
                // value already standing (a residual position left behind by a
                // full exit) survives the re-bootstrap and belongs to the
                // incoming holder, who is by definition the whole pool.
                shares = assets;
                nav += assets;
            } else {
                shares = nav == 0 ? 0 : (assets * supply) / nav;
                if (shares == 0) {
                    // Unpriceable: release the escrow back to the controller.
                    _pendingDepositAssets[controller] = 0;
                    totalPendingDepositAssets -= assets;

                    IERC20(asset()).safeTransfer(controller, assets);

                    emit DepositRequestRefunded(controller, assets);
                    continue;
                }
                nav += assets;
            }

            _pendingDepositAssets[controller] = 0;
            totalPendingDepositAssets -= assets;
            _claimableDepositAssets[controller] += assets;
            _claimableDepositShares[controller] += shares;

            _mint(address(this), shares);

            emit DepositRequestFulfilled(controller, assets, shares);
        }
        delete _depositQueue;
    }

    /// @dev Fulfill every pending redemption at the attested price (the same
    ///      effective price as deposits this strike). Escrowed shares are
    ///      burned; the payout is carved out of `nav` and reserved for claims.
    ///
    ///      Reservation is accounting, not liquidity: claims pay from the
    ///      vault's idle USDC, so the strategy keeps at least
    ///      `totalClaimableRedeemAssets` idle after each strike. v2's attested
    ///      delever action automates this.
    function _fulfillRedeems() private {
        uint256 n = _redeemQueue.length;
        for (uint256 i = 0; i < n; i++) {
            address controller = _redeemQueue[i];
            uint256 shares = _pendingRedeemShares[controller];

            uint256 assets = (shares * nav) / totalSupply();

            _pendingRedeemShares[controller] = 0;
            totalPendingRedeemShares -= shares;
            _claimableRedeemShares[controller] += shares;
            _claimableRedeemAssets[controller] += assets;
            totalClaimableRedeemAssets += assets;

            _burn(address(this), shares);
            nav -= assets;

            emit RedeemRequestFulfilled(controller, shares, assets);
        }
        delete _redeemQueue;
    }
}
