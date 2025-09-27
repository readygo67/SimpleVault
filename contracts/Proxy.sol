// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";

contract SimpleProxy is ERC1967Proxy {

    constructor(address _implementation, bytes memory _data) ERC1967Proxy(_implementation, _data){
        ERC1967Utils.changeAdmin(msg.sender);
    }

    modifier onlyAdmin() {
        require(msg.sender == ERC1967Utils.getAdmin(), "not admin");
        _;
    }

    function admin() external view returns (address) {
        return ERC1967Utils.getAdmin();
    }

    function upgradeTo(address newImplementation) external onlyAdmin {
        ERC1967Utils.upgradeToAndCall(newImplementation,  "");
    }

    function upgradeToAndCall(address newImplementation, bytes calldata data)  external payable onlyAdmin
    {
        ERC1967Utils.upgradeToAndCall(newImplementation, data);
    }


    function implementation() public view returns (address) {
        return _implementation();
    }

    receive() external payable {} //make compiler happy

}
