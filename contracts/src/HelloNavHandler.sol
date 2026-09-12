// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IPriimeServiceHandler} from "./interfaces/priime/IPriimeServiceHandler.sol";
import {IPriimeServiceManager} from "./interfaces/priime/IPriimeServiceManager.sol";

/// @title HelloNavHandler
/// @notice Minimal Priime service handler for the verifiable-vaults M1 demo: the
///         on-chain end of the pipeline where an attested NAV strike lands.
/// @dev The operator set signs the envelope the `priime-hello-nav` component
///      produced; the aggregator submits it here. This contract validates the
///      signatures via the service manager, guards against replay on
///      `eventId`, decodes the `(nav, blockNumber)` payload, and records it.
contract HelloNavHandler is IPriimeServiceHandler {
    /// @notice Service manager (POA stake registry) that validates operator sigs.
    IPriimeServiceManager public immutable serviceManager;

    /// @notice Most recent attested NAV (base units) and the block it referenced.
    uint256 public latestNav;
    uint256 public latestBlockNumber;
    /// @notice Number of strikes successfully recorded.
    uint256 public strikeCount;
    /// @notice Replay guard: each envelope `eventId` is processed at most once.
    mapping(bytes20 => bool) public processed;

    event NavAttested(bytes20 indexed eventId, uint256 nav, uint256 blockNumber, uint256 strikeCount);

    error AlreadyProcessed(bytes20 eventId);
    error ZeroServiceManager();

    constructor(IPriimeServiceManager _serviceManager) {
        if (address(_serviceManager) == address(0)) revert ZeroServiceManager();
        serviceManager = _serviceManager;
    }

    /// @inheritdoc IPriimeServiceHandler
    function handleSignedEnvelope(Envelope calldata envelope, SignatureData calldata signatureData) external override {
        // Reverts unless the operator quorum signed this exact envelope.
        serviceManager.validate(envelope, signatureData);

        if (processed[envelope.eventId]) revert AlreadyProcessed(envelope.eventId);
        processed[envelope.eventId] = true;

        (uint256 nav, uint256 blockNumber) = abi.decode(envelope.payload, (uint256, uint256));
        latestNav = nav;
        latestBlockNumber = blockNumber;
        strikeCount += 1;

        emit NavAttested(envelope.eventId, nav, blockNumber, strikeCount);
    }

    /// @inheritdoc IPriimeServiceHandler
    function getServiceManager() external view override returns (address) {
        return address(serviceManager);
    }
}
