// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IWavsServiceHandler} from "./interfaces/wavs/IWavsServiceHandler.sol";
import {IWavsServiceManager} from "./interfaces/wavs/IWavsServiceManager.sol";

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
/// @dev Demo scale, own capital only: no caps, no fees, no cancelation flow,
///      not audited, not for public depositors. Fulfillment iterates every
///      pending controller in one transaction; that is unbounded gas and
///      acceptable only at demo participant counts.
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
///      revert. Partial claims use floor division; dust favors the vault.
contract PriimeVault is ERC4626, IWavsServiceHandler {
    using SafeERC20 for IERC20;

    /// @notice Fungible request model: every request is requestId 0.
    uint256 public constant REQUEST_ID = 0;

    /// @notice Service manager (POA stake registry) that validates operator sigs.
    IWavsServiceManager public immutable serviceManager;

    /// @notice Trusted demo role that drives the strategy from the vault's own
    ///         balance via `execute` (Morpho supply/borrow/swap, approvals).
    ///         Own capital, unaudited: the strategist is trusted by
    ///         construction. v2's attested actions replace this role: the
    ///         operator quorum will authorize actions, whereas today it only
    ///         attests NAV.
    address public immutable strategist;

    /// @notice Latest attested NAV in asset base units; what backs outstanding
    ///         shares. `totalAssets()` returns this.
    uint256 public nav;
    /// @notice `inputs_block` of the last accepted NAV update (staleness guard).
    uint256 public lastInputsBlock;
    /// @notice Number of NAV updates successfully recorded.
    uint256 public updateCount;
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

    // ERC-7540 events.
    event DepositRequest(
        address indexed controller, address indexed owner, uint256 indexed requestId, address sender, uint256 assets
    );
    event RedeemRequest(
        address indexed controller, address indexed owner, uint256 indexed requestId, address sender, uint256 shares
    );
    event OperatorSet(address indexed controller, address indexed operator, bool approved);
    // Implementation events.
    event NavUpdated(bytes20 indexed eventId, uint256 nav, uint256 inputsBlock, uint256 updateCount);
    event DepositRequestFulfilled(address indexed controller, uint256 assets, uint256 shares);
    event RedeemRequestFulfilled(address indexed controller, uint256 shares, uint256 assets);

    error ZeroServiceManager();
    error ZeroStrategist();
    error NotStrategist();
    error SelfCallForbidden();
    error EscrowFloorBreached(uint256 balance, uint256 floor);
    error ZeroAmount();
    error ZeroNav();
    error HandlerMismatch(address handler);
    error AlreadyProcessed(bytes20 eventId);
    error StaleInputsBlock(uint256 inputsBlock, uint256 lastInputsBlock);
    error NotOwnerOrOperator();
    error NotControllerOrOperator();
    error ExceedsClaimable(uint256 requested, uint256 claimable);
    error AsyncFlowOnly();

    constructor(IWavsServiceManager _serviceManager, IERC20 _asset, address _strategist)
        ERC4626(_asset)
        ERC20("Priime Vault Share", "pvUSDC")
    {
        if (address(_serviceManager) == address(0)) revert ZeroServiceManager();
        if (_strategist == address(0)) revert ZeroStrategist();
        serviceManager = _serviceManager;
        strategist = _strategist;
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
    ///      completes.
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
    }

    // ------------------------------------------------------------------------
    // ERC-7540 request flow: deposits
    // ------------------------------------------------------------------------

    /// @notice Escrow `assets` from `owner` and queue a deposit request for
    ///         `controller`. Fulfilled at the next accepted NAV strike.
    function requestDeposit(uint256 assets, address controller, address owner) external returns (uint256) {
        if (assets == 0) revert ZeroAmount();
        if (msg.sender != owner && !_operators[owner][msg.sender]) revert NotOwnerOrOperator();

        IERC20(asset()).safeTransferFrom(owner, address(this), assets);

        if (_pendingDepositAssets[controller] == 0) _depositQueue.push(controller);
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
    function requestRedeem(uint256 shares, address controller, address owner) external returns (uint256) {
        if (shares == 0) revert ZeroAmount();
        if (msg.sender != owner && !_operators[owner][msg.sender]) {
            _spendAllowance(owner, msg.sender, shares);
        }

        _transfer(owner, address(this), shares);

        if (_pendingRedeemShares[controller] == 0) _redeemQueue.push(controller);
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
        uint256 assets = (shares * _claimableRedeemAssets[controller]) / claimableShares;

        _claimableRedeemShares[controller] = claimableShares - shares;
        _claimableRedeemAssets[controller] -= assets;
        totalClaimableRedeemAssets -= assets;

        IERC20(asset()).safeTransfer(receiver, assets);
        emit Withdraw(msg.sender, receiver, controller, assets, shares);
        return assets;
    }

    /// @notice Claim fulfilled redemption payout by assets. The third
    ///         parameter is the 7540 `controller` (4626's `owner`).
    function withdraw(uint256 assets, address receiver, address controller) public override returns (uint256) {
        _requireControllerOrOperator(controller);
        if (assets == 0) revert ZeroAmount();

        uint256 claimableAssets = _claimableRedeemAssets[controller];
        if (assets > claimableAssets) revert ExceedsClaimable(assets, claimableAssets);
        uint256 shares = (assets * _claimableRedeemShares[controller]) / claimableAssets;

        _claimableRedeemAssets[controller] = claimableAssets - assets;
        _claimableRedeemShares[controller] -= shares;
        totalClaimableRedeemAssets -= assets;

        IERC20(asset()).safeTransfer(receiver, assets);
        emit Withdraw(msg.sender, receiver, controller, assets, shares);
        return shares;
    }

    function _claimDeposit(uint256 assets, address receiver, address controller) internal returns (uint256) {
        _requireControllerOrOperator(controller);
        if (assets == 0) revert ZeroAmount();

        uint256 claimableAssets = _claimableDepositAssets[controller];
        if (assets > claimableAssets) revert ExceedsClaimable(assets, claimableAssets);
        uint256 shares = (assets * _claimableDepositShares[controller]) / claimableAssets;

        _claimableDepositAssets[controller] = claimableAssets - assets;
        _claimableDepositShares[controller] -= shares;

        _transfer(address(this), receiver, shares);
        emit Deposit(controller, receiver, assets, shares);
        return shares;
    }

    function _claimMint(uint256 shares, address receiver, address controller) internal returns (uint256) {
        _requireControllerOrOperator(controller);
        if (shares == 0) revert ZeroAmount();

        uint256 claimableShares = _claimableDepositShares[controller];
        if (shares > claimableShares) revert ExceedsClaimable(shares, claimableShares);
        uint256 assets = (shares * _claimableDepositAssets[controller]) / claimableShares;

        _claimableDepositShares[controller] = claimableShares - shares;
        _claimableDepositAssets[controller] -= assets;

        _transfer(address(this), receiver, shares);
        emit Deposit(controller, receiver, assets, shares);
        return assets;
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
    ///      (VAULT-03 replay); (3) `inputsBlock` must strictly increase,
    ///      so a delayed-but-valid envelope can never move NAV back to an
    ///      earlier read of the position (VAULT-03 staleness). An accepted
    ///      update then records the attested NAV and fulfills ALL pending
    ///      deposit and redemption requests at that price in this same
    ///      transaction (single epoch per strike). Bootstrap: the first
    ///      fulfillment with zero share supply prices 1 share per USDC base
    ///      unit.
    function handleSignedEnvelope(Envelope calldata envelope, SignatureData calldata signatureData) external override {
        (address handler, uint256 attestedNav, uint256 inputsBlock) =
            abi.decode(envelope.payload, (address, uint256, uint256));
        if (handler != address(this)) revert HandlerMismatch(handler);

        // Reverts unless the operator quorum signed this exact envelope.
        serviceManager.validate(envelope, signatureData);

        if (processed[envelope.eventId]) revert AlreadyProcessed(envelope.eventId);
        processed[envelope.eventId] = true;

        if (inputsBlock <= lastInputsBlock) revert StaleInputsBlock(inputsBlock, lastInputsBlock);

        nav = attestedNav;
        lastInputsBlock = inputsBlock;
        updateCount += 1;

        _fulfillDeposits();
        _fulfillRedeems();

        emit NavUpdated(envelope.eventId, attestedNav, inputsBlock, updateCount);
    }

    /// @inheritdoc IWavsServiceHandler
    function getServiceManager() external view override returns (address) {
        return address(serviceManager);
    }

    /// @dev Fulfill every pending deposit at the attested price. Minted shares
    ///      are escrowed in the vault until claimed; each fulfilled deposit
    ///      folds its assets into `nav`, which keeps the share price invariant
    ///      across the loop (nav and supply scale together).
    function _fulfillDeposits() private {
        uint256 n = _depositQueue.length;
        for (uint256 i = 0; i < n; i++) {
            address controller = _depositQueue[i];
            uint256 assets = _pendingDepositAssets[controller];

            uint256 supply = totalSupply();
            uint256 shares;
            if (supply == 0) {
                shares = assets; // bootstrap: 1 share per USDC base unit
                // Bootstrap replaces any pre-supply NAV: the share pool is
                // backed only by assets actually folded in.
                nav = assets;
            } else {
                if (nav == 0) revert ZeroNav();
                shares = (assets * supply) / nav;
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
