// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

// Mock low interest model for V1 (block.number accrual)
// Rate stays below maxBorrowRate and is used to accrue debt in PoC

contract MockLowRateModel {
    bool public constant isInterestRateModel = true;

    // 0.05% per block
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