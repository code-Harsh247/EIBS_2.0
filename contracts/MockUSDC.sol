// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./ERC20.sol";

/**
 * @title MockUSDC
 * @dev A simple mock USDC token for testing on Sepolia
 * @notice This is for TESTING ONLY - not for production use
 */
contract MockUSDC is ERC20 {
    address public owner;

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor() ERC20("Mock USDC", "USDC", 6) {
        owner = msg.sender;
        // Mint initial supply to deployer (1,000,000 USDC)
        _mint(msg.sender, 1_000_000 * 10**6);
    }

    /**
     * @dev Mint tokens to any address (for testing)
     * @param to Address to mint to
     * @param amount Amount to mint (in smallest units, 6 decimals)
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /**
     * @dev Faucet - get 1000 USDC for testing
     */
    function faucet() external {
        _mint(msg.sender, 1000 * 10**6);
    }

    /**
     * @dev Burn tokens
     */
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}
