// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VaultV1} from "./VaultV1.sol";

contract VaultV2 is VaultV1 { //for demo
    bool public paused;

    event Paused(bool status);

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit Paused(_paused);
    }

    function version() external override pure returns (string memory) {
        return "V2";
    }
}