// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IPriimeServiceHandler} from "./interfaces/priime/IPriimeServiceHandler.sol";

/// @notice Test-only stand-in for the Priime service manager. `validate` is a
///         no-op so a hand-crafted envelope can exercise `HelloNavHandler` on
///         anvil without standing up the operator set. Selector matches
///         `IPriimeServiceManager.validate`, so the handler's call resolves.
///         The real M1 Pipeline phase replaces this with the POA-deployed
///         `WavsServiceManager`.
contract MockServiceManager {
    function validate(IPriimeServiceHandler.Envelope calldata, IPriimeServiceHandler.SignatureData calldata)
        external
        view {}
}
