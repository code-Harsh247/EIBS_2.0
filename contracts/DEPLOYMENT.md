# EIBS Liquidity Pool - Deployment Guide

## Overview

This guide walks you through deploying the ERC-4626 Liquidity Pool contracts to Sepolia testnet.

## Contracts to Deploy

1. **InvoiceNFT** - ERC721-like NFT representing tokenized invoices
2. **InvoiceLiquidityPool** - ERC-4626 vault for USDC deposits and invoice financing

## Prerequisites

- MetaMask wallet with Sepolia ETH (for gas)
- Test USDC on Sepolia (or we'll use a mock)

## Deployment Order

### Step 1: Get Test USDC Address

For Sepolia testnet, you can use these options:

**Option A: Use Existing Test USDC**
- Circle's Sepolia USDC: `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`

**Option B: Deploy Mock USDC (for testing)**
Deploy this simple mock contract first:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./ERC20.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC", 6) {}
    
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
```

### Step 2: Deploy InvoiceNFT

1. Open Remix IDE (https://remix.ethereum.org)
2. Create `InvoiceNFT.sol` with the contract code
3. Compile with Solidity 0.8.19
4. Deploy with constructor parameter:
   - `_oracle`: Your backend wallet address (same as PRIVATE_KEY address)

**Save the deployed address!**

### Step 3: Deploy InvoiceLiquidityPool

Deploy with constructor parameters:
- `_asset`: USDC address (from Step 1)
- `_oracle`: Your backend wallet address
- `_feeRecipient`: Address to receive protocol fees

**Save the deployed address!**

### Step 4: Link Contracts

After deploying the LiquidityPool, call:
```
setInvoiceNFT(invoiceNFTAddress)
```

Also, on the InvoiceNFT contract, transfer ownership:
```
transferOwnership(liquidityPoolAddress)
```

### Step 5: Update .env

```env
LIQUIDITY_POOL_ADDRESS="<deployed-pool-address>"
INVOICE_NFT_ADDRESS="<deployed-nft-address>"
USDC_ADDRESS="<usdc-address>"
```

## Contract Functions Reference

### For LPs (Liquidity Providers)

| Function | Description |
|----------|-------------|
| `deposit(amount, receiver)` | Deposit USDC, receive lUSDC shares |
| `withdraw(amount, receiver, owner)` | Withdraw USDC by burning shares |
| `redeem(shares, receiver, owner)` | Redeem shares for USDC |

### For Backend Oracle

| Function | Description |
|----------|-------------|
| `fundLoan(...)` | Fund an approved invoice (requires signature) |
| `repayLoan(tokenId, yield)` | Mark loan as repaid, distribute yield |
| `depositRepayment(amount)` | Deposit fiat-converted repayment |

### View Functions

| Function | Description |
|----------|-------------|
| `totalAssets()` | Total USDC under management |
| `utilizationRate()` | Percentage of funds in active loans |
| `availableForLoans()` | USDC available for new loans |
| `estimatedAPY()` | Estimated annual yield |

## Testing the Pool

### 1. Deposit as LP

```javascript
// Approve USDC spending first
await usdc.approve(poolAddress, amount);

// Deposit
await pool.deposit(amount, yourAddress);
```

### 2. Fund an Invoice

```bash
# Call backend API to get signature
POST /api/pool/loans/fund
{
  "invoiceId": "xxx",
  "sellerAddress": "0x...",
  "buyerAddress": "0x..."
}

# Returns signature data for on-chain call
```

### 3. Repay Loan

```bash
# When fiat payment arrives, call backend
POST /api/pool/loans/repay
{
  "tokenId": "1",
  "actualYield": "100.50"
}
```

## Security Considerations

1. **Signature Verification**: All loan funding requires valid backend signature
2. **Utilization Cap**: Maximum 90% of pool can be in active loans
3. **Oracle Trust**: Only the oracle can mark loans as repaid
4. **Nonce Protection**: Each funding signature can only be used once

## Gas Estimates (Sepolia)

| Operation | Estimated Gas |
|-----------|---------------|
| Deploy InvoiceNFT | ~2,500,000 |
| Deploy LiquidityPool | ~3,500,000 |
| deposit() | ~80,000 |
| fundLoan() | ~250,000 |
| repayLoan() | ~100,000 |
| withdraw() | ~70,000 |
