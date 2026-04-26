// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

// Mock low interest model for V2 (block.timestamp accrual)
// Compatible with iTokenV2 and used for liquidation DoS PoC

contract MockLowRateSecondModel {
    bool public constant isInterestRateSecondModel = true;
    bool public constant isInterestRateModel = true;

    // 0.05% per second
    uint256 public constant BORROW_RATE = 0.0005e18;

    function getBorrowRate(
        uint256, // cash
        uint256, // borrows
        uint256  // reserves
    )
        external
        pure
        returns (uint256)
    {
        return BORROW_RATE;
    }
}