// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IWavsServiceHandler} from "./interfaces/wavs/IWavsServiceHandler.sol";

/// @notice Test-only stand-in for the WAVS service manager. `validate` is a
///         no-op so a hand-crafted envelope can exercise `HelloNavHandler` on
///         anvil without standing up the operator set. Selector matches
///         `IWavsServiceManager.validate`, so the handler's call resolves.
///         The real M1 Pipeline phase replaces this with the POA-deployed
///         `WavsServiceManager`.
contract MockServiceManager {
    function validate(IWavsServiceHandler.Envelope calldata, IWavsServiceHandler.SignatureData calldata)
        external
        view
    {}
}
