// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract Vault is ERC20 {
    using SafeERC20 for IERC20;
    uint256 constant public BASE = 1e18;
    address public owner;

    IERC20 public immutable underlyingToken;
    uint256 public immutable initialExchangeMultiplier;  // initialExchangeMultiplier = 10^(vToken.decimals - underlyingToken.decimals()), 1 underylingToken can exchange # vToken

    uint256 private totalUnderlyingAsset;
    uint256 public lastAccurateBlock;
    uint256 public interestPerBlock; // fraction per block with 1e18 precision

    event Deposit(address indexed user, uint256 amount, uint256 shares);
    event Withdraw(address indexed user, uint256 shares, uint256 amount);
    event Accrued(uint256 blocks, uint256 added);
    event PerBlockRateUpdated(uint256 oldRate, uint256 newRate);
    event OwnerChanged(address oldOwner, address newOwner);

    constructor(IERC20Metadata _underlyingToken, uint256 _interestPerBlock) ERC20("vUSDT", "vUSDT") {
        require(address(_underlyingToken) != address(0), "invalid underlying token");
        underlyingToken = _underlyingToken;
        owner = msg.sender;
        interestPerBlock = _interestPerBlock;
        lastAccurateBlock = block.number;

        uint8 underlyingTokenDecimals = _underlyingToken.decimals();
        uint8 selfDecimals = decimals();
        require(selfDecimals >= underlyingTokenDecimals, "self decimals < underlying token's decimals");
        initialExchangeMultiplier = 10 ** (selfDecimals - underlyingTokenDecimals);
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "only owner");
        _;
    }

    function setInterestRate(uint256 newRate) external onlyOwner {
        uint256 oldRate = interestPerBlock;
        interestPerBlock = newRate;
        emit PerBlockRateUpdated(oldRate, newRate);
    }

    function setOwner(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero owner");
        address oldOwner = owner;
        owner = newOwner;
        emit OwnerChanged(oldOwner, newOwner);
    }

    /// @notice accure the interest
    function _accrue() internal {
        uint256 currentBlock = block.number;
        if (currentBlock <= lastAccurateBlock) {
            return;
        }
        uint256 blocksPassed = currentBlock - lastAccurateBlock;
        lastAccurateBlock = currentBlock;

        if (totalUnderlyingAsset == 0 || interestPerBlock == 0) {
            emit Accrued(blocksPassed, 0);
            return;
        }

        uint256 interest = totalUnderlyingAsset * interestPerBlock * blocksPassed / BASE;

        if (interest > 0) {
            totalUnderlyingAsset += interest;
        }
        emit Accrued(blocksPassed, interest);
    }

    /// @notice Returns total underlying assets including accrued interest up to current block
    function totalUnderlyingAssetNow() public view returns (uint256) {
        uint256 currentBlock = block.number;
        if (currentBlock <= lastAccurateBlock) {
            return totalUnderlyingAsset;
        }
        if (totalUnderlyingAsset == 0 || interestPerBlock == 0) {
            return totalUnderlyingAsset;
        }
        uint256 blocksPassed = currentBlock - lastAccurateBlock;
        uint256 interest = totalUnderlyingAsset * interestPerBlock * blocksPassed / BASE;
        return totalUnderlyingAsset + interest;
    }

    /// @notice Convert asset amount to shares given current state (view variant)
    function convertToShares(uint256 amount) public view returns (uint256) {
        uint256 totalSupplyNow = totalSupply();
        uint256 _totalUnderlyingAssetNow = totalUnderlyingAssetNow();

        if (totalSupplyNow == 0 || _totalUnderlyingAssetNow == 0) {
            return amount * initialExchangeMultiplier;
        } else {
            return amount * totalSupplyNow / _totalUnderlyingAssetNow;
        }
    }

    /// @notice Convert shares to assets given current state (view variant)
    function convertToAssets(uint256 shares) public view returns (uint256) {
        uint256 totalSupplyNow = totalSupply();
        uint256 _totalUnderlyingAssetNow = totalUnderlyingAssetNow();

        if (totalSupplyNow == 0 || _totalUnderlyingAssetNow == 0) {
            return shares / initialExchangeMultiplier;
        }else{
            return shares * _totalUnderlyingAssetNow / totalSupplyNow  ;
        }
    }


    function deposit(uint256 amount) public returns (uint256 shares) {
        require(amount > 0, "zero amount");
        _accrue();

        underlyingToken.safeTransferFrom(msg.sender, address(this), amount);

        uint256 totalSupplyNow = totalSupply();

        if (totalSupplyNow == 0 || totalUnderlyingAsset == 0) {
            shares = amount * initialExchangeMultiplier;
        } else {
            shares = amount * totalSupplyNow / totalUnderlyingAsset;
        }
        require(shares > 0, "zero shares");

        // update totalUnderlyingAsset
        totalUnderlyingAsset += amount;

        // mint shares to,update totalSupply
        _mint(msg.sender, shares);

        emit Deposit(msg.sender, amount, shares);
    }

    /// @notice Withdraw by burning shares, receive underlying Token
    function withdraw(uint256 shares) external returns (uint256 amount) {
        require(shares > 0, "zero shares");
        _accrue();

        require(balanceOf(msg.sender) >= shares, "insufficient shares");
        // compute assets to return
        uint256 totalSupplyNow = totalSupply();
        amount = shares * totalUnderlyingAsset / totalSupplyNow  ;

        require(amount > 0, "zero amount");

        // burn shares and update accounting
        _burn(msg.sender, shares);
        totalUnderlyingAsset -= amount;

        // transfer underlying to user
        underlyingToken.safeTransfer(msg.sender, amount);

        emit Withdraw(msg.sender, shares, amount);
    }
}