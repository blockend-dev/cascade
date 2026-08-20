// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AttributionSettlement} from "../AttributionSettlement.sol";
import {CascadeRegistry} from "../CascadeRegistry.sol";

/// @notice Test-only contract. Registers itself as a model owner, then
///         attempts to re-enter `AttributionSettlement.claim()` from its
///         own receive() hook — proves the checks-effects-interactions
///         ordering (balance zeroed before the external call) plus the
///         `nonReentrant` guard actually hold, rather than just asserting
///         it in prose. Not part of the protocol; lives under src/mocks
///         precisely so it's obviously test support, not production code.
contract ReentrantClaimer {
    AttributionSettlement public immutable settlement;
    bool public reentryAttempted;
    bool public reentrySucceeded;

    constructor(address settlementAddress) {
        settlement = AttributionSettlement(settlementAddress);
    }

    function registerModel(address cascadeRegistryAddress, bytes32 commitment, string calldata uri, bytes32 salt)
        external
        returns (bytes32)
    {
        return CascadeRegistry(cascadeRegistryAddress).registerModel(commitment, uri, salt);
    }

    function attack() external {
        settlement.claim();
    }

    receive() external payable {
        if (!reentryAttempted) {
            reentryAttempted = true;
            try settlement.claim() {
                reentrySucceeded = true;
            } catch {
                reentrySucceeded = false;
            }
        }
    }
}
