// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.10;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract USDT is ERC20("USDT", "USDT"){

    // override decimals to 6
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    // mint function for testing
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}