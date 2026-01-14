# EIBS 2.0 Security & Privacy Architecture

## Overview

This document describes the two key security and privacy layers implemented in the EIBS blockchain system:

1. **Identity Access Control (Soulbound Token)** - KYB verification via non-transferable NFTs
2. **Split Metadata Privacy** - Document hashes on-chain, private data off-chain

---

## 1. Identity Access Control (IdentitySBT)

### What is a Soulbound Token?

A Soulbound Token (SBT) is a non-transferable NFT that represents identity/credentials. Once minted to a wallet, it cannot be transferred, sold, or traded - it's "bound" to that wallet forever (unless burned by admin).

### Contract: `IdentitySBT.sol`

```
Location: contracts/IdentitySBT.sol
```

### Key Features

| Feature | Description |
|---------|-------------|
| **Non-Transferable** | All transfer functions are blocked (transferFrom, safeTransferFrom) |
| **One Token Per Wallet** | A wallet can only have one SBT |
| **Admin-Only Minting** | Only the contract owner can mint after KYB verification |
| **Blacklisting** | Bad actors can be permanently blocked |
| **Risk Tiers** | Businesses are assigned risk tiers (1-5, 1 = lowest risk) |

### Business Verification Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  1. Business submits KYB documents (off-chain)                  │
│     - Company registration                                       │
│     - Director identification                                    │
│     - Financial statements                                       │
├─────────────────────────────────────────────────────────────────┤
│  2. Admin verifies documents                                     │
│     - Manual review or third-party KYB service                   │
│     - Assigns risk tier (1-5)                                    │
├─────────────────────────────────────────────────────────────────┤
│  3. Admin mints IdentitySBT                                      │
│     identitySBT.mint(                                            │
│       walletAddress,                                             │
│       "COMPANY_REG_123",   // Business ID                        │
│       2,                   // Risk tier (1-5)                    │
│       "ipfs://..."        // Metadata URI (non-sensitive)        │
│     )                                                            │
├─────────────────────────────────────────────────────────────────┤
│  4. Business can now call fundLoan()                             │
│     The onlyVerifiedBusiness modifier checks:                    │
│     - identitySBT.isVerifiedBusiness(msg.sender) == true         │
│     - identitySBT.isBlacklisted(msg.sender) == false             │
└─────────────────────────────────────────────────────────────────┘
```

### Usage in LiquidityPool

The `InvoiceLiquidityPool` contract uses the `onlyVerifiedBusiness` modifier:

```solidity
modifier onlyVerifiedBusiness() {
    if (address(identitySBT) != address(0)) {
        if (identitySBT.isBlacklisted(msg.sender)) {
            revert BusinessBlacklisted();
        }
        if (!identitySBT.isVerifiedBusiness(msg.sender)) {
            revert NotVerifiedBusiness();
        }
    }
    _;
}

function fundLoan(...) external onlyVerifiedBusiness returns (uint256) {
    // Only KYB-verified businesses can fund invoices
}
```

### Admin Functions

| Function | Description |
|----------|-------------|
| `mint(wallet, businessId, riskTier, metadataURI)` | Mint SBT after KYB |
| `burn(tokenId)` | Revoke verification |
| `blacklist(wallet, reason)` | Permanently block bad actor |
| `removeFromBlacklist(wallet)` | Remove from blacklist |
| `updateRiskTier(tokenId, newTier)` | Update risk assessment |

---

## 2. Split Metadata Privacy

### The Problem

Storing invoice details on-chain exposes private business information:
- Invoice numbers
- Buyer/seller relationships
- Transaction amounts
- Payment terms

Anyone can read blockchain data, which creates privacy concerns.

### The Solution: Document Hash

Instead of storing private data, we store only:

| On-Chain | Off-Chain |
|----------|-----------|
| `bytes32 documentHash` | Invoice number, buyer, seller details |
| `uint256 amount` | Full invoice document |
| `uint256 dueDate` | Business relationships |
| `address seller` | Payment history |
| `uint8 riskScore` | Sensitive metadata |
| `string publicMetadataURI` | (stored in database) |

### How Document Hash Works

```
┌─────────────────────────────────────────────────────────────────┐
│  Backend generates hash from invoice data:                       │
│                                                                  │
│  // CRITICAL: Fields MUST be sorted alphabetically              │
│  // Uses issueDate as salt (NOT Date.now())                     │
│                                                                  │
│  const normalizedData = {                                        │
│    buyerId: "buyer-uuid",           // Alphabetical order        │
│    dueDate: "2025-02-15T00:00:00.000Z",                          │
│    invoiceNumber: "INV-2025-001",                                │
│    issueDate: "2025-01-15T00:00:00.000Z",  // Salt from invoice │
│    sellerId: "seller-uuid",                                      │
│    totalAmount: "50000.00"                                       │
│  };                                                              │
│                                                                  │
│  // Double-safety: stringify with sorted keys                    │
│  const data = JSON.stringify(normalizedData,                     │
│    Object.keys(normalizedData).sort()                            │
│  );                                                              │
│                                                                  │
│  documentHash = SHA256(data)                                     │
│  // => 0x7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd2  │
└─────────────────────────────────────────────────────────────────┘
```

> ⚠️ **IMPORTANT**: The hash MUST be deterministic. Same invoice = same hash.
> - ❌ Never use `Date.now()` - changes every call
> - ❌ Never use random ordering - JS objects aren't ordered
> - ✅ Always sort fields alphabetically
> - ✅ Use invoice's `issueDate` as the timestamp salt

### Privacy-Preserving Contract Changes

**InvoiceNFT.sol (Updated)**

```solidity
struct InvoiceData {
    bytes32 documentHash;      // SHA256 of invoice document
    uint256 amount;            // Funding amount (public)
    uint256 dueDate;           // Payment due date (public)
    address seller;            // Seller's wallet (public)
    uint8 riskScore;           // Risk assessment (public)
    bool isRepaid;             // Status
    uint256 fundedAt;          // Timestamp
    string publicMetadataURI;  // IPFS for non-sensitive metadata
}

// Prevents double-financing using hash
mapping(bytes32 => uint256) private _documentHashToTokenId;

function isDocumentFinanced(bytes32 documentHash) external view returns (bool) {
    return _documentHashToTokenId[documentHash] != 0;
}
```

**InvoiceLiquidityPool.sol (Updated)**

```solidity
function fundLoan(
    bytes32 documentHash,        // Privacy: only hash, no invoiceId
    uint256 amount,
    uint256 dueDate,
    address seller,
    // address buyer removed - privacy
    uint8 riskScore,
    uint256 expectedYieldBps,
    string calldata publicMetadataURI,
    bytes32 nonce,
    bytes calldata signature
) external onlyVerifiedBusiness returns (uint256 tokenId)
```

### What's Stored Where?

```
┌─────────────────────────────────────────────────────────────────┐
│                        ON-CHAIN (PUBLIC)                         │
├─────────────────────────────────────────────────────────────────┤
│  • Document Hash (bytes32)                                       │
│  • Funding Amount                                                │
│  • Due Date                                                      │
│  • Seller Wallet Address                                         │
│  • Risk Score (0-100)                                            │
│  • Repayment Status                                              │
│  • IPFS URI for generic metadata                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     OFF-CHAIN (DATABASE)                         │
├─────────────────────────────────────────────────────────────────┤
│  • Invoice Number (INV-2025-001)                                 │
│  • Buyer Company Name                                            │
│  • Seller Company Name                                           │
│  • Full Invoice PDF                                              │
│  • Business Relationship Data                                    │
│  • Payment History                                               │
│  • KYB Documents                                                 │
│  • Document Hash (for correlation)                               │
└─────────────────────────────────────────────────────────────────┘
```

### Correlation Between On-Chain and Off-Chain

The backend stores `documentHash` in the audit log, allowing correlation:

```typescript
await createAuditLog({
  userId: user.id,
  action: AuditAction.LOAN_AUTHORIZED,
  entityType: 'INVOICE',
  entityId: invoice.id,
  newValue: {
    invoiceNumber: invoice.invoiceNumber,  // Private - only in DB
    documentHash: documentHash,            // Correlates with on-chain
    amount: invoice.totalAmount.toString(),
    riskScore
  }
});
```

---

## Deployment Order

1. **Deploy MockUSDC** (or use real USDC address)
2. **Deploy IdentitySBT**
3. **Deploy InvoiceNFT**
4. **Deploy InvoiceLiquidityPool** with:
   - USDC address
   - InvoiceNFT address
   - Oracle (backend signer) address
   - Owner address
5. **Configure LiquidityPool**:
   ```
   pool.setIdentitySBT(identitySBTAddress)
   pool.setInvoiceNFT(invoiceNFTAddress)
   ```
6. **Set InvoiceNFT minter**:
   ```
   invoiceNFT.setLiquidityPool(poolAddress)
   ```

---

## Environment Variables

Add to `.env`:

```env
LIQUIDITY_POOL_ADDRESS="0x..."
INVOICE_NFT_ADDRESS="0x..."
USDC_ADDRESS="0x..."
IDENTITY_SBT_ADDRESS="0x..."
```

---

## API Changes

### POST /api/pool/loans/fund

**Request (Updated):**
```json
{
  "invoiceId": "uuid-from-database",
  "sellerAddress": "0x...",
  "publicMetadataURI": "ipfs://..." // Optional
}
```

**Response (Updated):**
```json
{
  "success": true,
  "data": {
    "message": "Loan authorization generated (privacy-preserving)",
    "signatureData": {
      "documentHash": "0x7f83b1...",
      "amount": "50000.00",
      "dueDate": 1739404800,
      "seller": "0x...",
      "riskScore": 25,
      "expectedYieldBps": 400,
      "nonce": "0x...",
      "signature": "0x...",
      "publicMetadataURI": "ipfs://..."
    },
    "privacy": {
      "note": "Only documentHash is stored on-chain. No private invoice details are exposed.",
      "documentHash": "0x7f83b1...",
      "invoiceNumberStored": false,
      "buyerAddressStored": false
    }
  }
}
```

---

## Security Considerations

### IdentitySBT Security

| Risk | Mitigation |
|------|------------|
| Admin key compromise | Use multisig for owner |
| False KYB approval | Third-party KYB verification |
| Business goes rogue | Blacklist functionality |

### Privacy Considerations

| Risk | Mitigation |
|------|------------|
| Hash collision | SHA256 + timestamp makes collision infeasible |
| Correlation attacks | Minimal on-chain data (no buyer, no invoice ID) |
| IPFS metadata leak | publicMetadataURI contains only non-sensitive info |

---

## Summary

| Feature | Implementation |
|---------|----------------|
| **KYB Verification** | IdentitySBT (Soulbound Token) |
| **Access Control** | `onlyVerifiedBusiness` modifier |
| **Blacklisting** | `blacklist(wallet, reason)` |
| **Privacy** | Document hash instead of invoice ID |
| **Double-Financing Prevention** | `isDocumentFinanced(hash)` check |
| **Off-Chain Correlation** | documentHash stored in audit logs |
