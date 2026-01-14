# EIBS Liquidity Pool - Development Summary

## Overview

This document summarizes the ERC-4626 Liquidity Pool system developed for the EIBS (Enterprise Invoice Blockchain System) project. The system enables invoice financing through DeFi mechanics.

---

## Smart Contracts (4 New Files)

| Contract | File | Purpose |
|----------|------|---------|
| **InvoiceLiquidityPool** | `contracts/InvoiceLiquidityPool.sol` | ERC-4626 vault - LPs deposit USDC, earn yield from invoice financing |
| **InvoiceNFT** | `contracts/InvoiceNFT.sol` | Tokenizes invoices as NFTs - pool holds NFT until buyer pays |
| **MockUSDC** | `contracts/MockUSDC.sol` | Test stablecoin for Sepolia testing |
| **ERC20** | `contracts/ERC20.sol` | Base token implementation for lUSDC shares |

## Interfaces (3 Files)

| Interface | File | Purpose |
|-----------|------|---------|
| **IERC20** | `contracts/interfaces/IERC20.sol` | Standard token interface |
| **IERC4626** | `contracts/interfaces/IERC4626.sol` | Vault standard interface |
| **IInvoiceNFT** | `contracts/interfaces/IInvoiceNFT.sol` | Invoice NFT interface |

---

## Backend APIs (7 New Endpoints)

| Endpoint | Method | What It Does |
|----------|--------|--------------|
| `/api/pool` | GET | Pool stats (TVL, APY, utilization) |
| `/api/pool/balance` | POST | LP's share balance & value |
| `/api/pool/deposit/preview` | POST | Preview shares for deposit |
| `/api/pool/withdraw/preview` | POST | Preview USDC for withdrawal |
| `/api/pool/loans/fund` | POST | Generate signed loan authorization |
| `/api/pool/loans/repay` | POST | Process repayment (oracle only) |
| `/api/pool/loans/[id]` | GET | Get loan details |

---

## Key Features Implemented

| Feature | Description |
|---------|-------------|
| **deposit() / withdraw()** | LPs deposit USDC → get lUSDC shares → earn yield |
| **fundLoan()** | Backend signs loan approvals, prevents unauthorized funding |
| **repayLoan()** | Only backend can confirm fiat→crypto conversion |
| **90% Utilization Cap** | Always keeps 10% liquid for withdrawals |
| **10% Protocol Fee** | Platform takes cut of yield for operations |
| **totalAssets()** | Tracks cash + active loans for APY calculation |

---

## Core Functions Explained

### 1. `fundLoan()` - Finance an Invoice

Converts an approved invoice into cash for the seller.

```
Seller has $10,000 invoice → Backend approves & signs → Pool pays $9,500 to seller
                                                        (5% discount for early payment)
```

- Buyer owes $10,000, due in 60 days
- Seller needs cash now
- Pool buys the invoice at a discount
- Seller gets instant payment
- Pool earns the difference when buyer pays

**Security:** Requires backend signature to prevent unauthorized funding.

### 2. `repayLoan()` - Complete the Cycle

Called when the buyer pays the invoice (fiat → crypto conversion).

```
Buyer pays $10,000 (fiat) → Backend converts to USDC → Calls repayLoan() → Pool receives funds
```

- Marks the loan as complete
- Returns principal ($9,500) to pool
- Calculates yield ($500)
- Takes protocol fee (10% of yield = $50)
- Remaining yield ($450) increases LP share value

**Access:** Only the backend oracle can call this.

### 3. Protocol Fees - Platform Revenue

Takes a cut of the profits for running the platform.

```
Yield: $500 (what pool earned)
Fee:   $50  (10% goes to platform)
LPs:   $450 (90% goes to liquidity providers)
```

---

## Payment Flow

```
Traditional World          │         Crypto World
                           │
Buyer pays $10,000 (fiat)  │
         ↓                 │
Your bank receives it      │
         ↓                 │
Backend confirms payment   │──────→  Calls repayLoan()
                           │              ↓
                           │         Pool gets USDC
```

**Note:** The buyer never touches crypto. They just pay their invoice normally!

---

## Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        LIQUIDITY POOL                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   INVESTORS (LPs)              SELLERS              BUYERS      │
│        │                          │                    │        │
│   Deposit USDC                Has invoice         Owes money    │
│        ↓                          │                    │        │
│   Get lUSDC shares                ↓                    │        │
│        │              Backend approves invoice         │        │
│        │                          ↓                    │        │
│        │              fundLoan() - Seller gets USDC    │        │
│        │              Pool gets Invoice NFT            │        │
│        │                          │                    │        │
│        │                          │         Pays fiat  │        │
│        │                          │            ↓       │        │
│        │                    Backend converts to USDC   │        │
│        │                          ↓                    │        │
│        │              repayLoan() - Pool gets USDC     │        │
│        │                          │                    │        │
│        ↓                          ↓                    │        │
│   lUSDC worth more!         NFT burned                 │        │
│   (earned yield)            Loan complete              │        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Files Added

```
contracts/
├── InvoiceLiquidityPool.sol   ← Main vault contract
├── InvoiceNFT.sol             ← Invoice tokenization
├── MockUSDC.sol               ← Test token
├── ERC20.sol                  ← Base implementation
├── DEPLOYMENT.md              ← Deployment guide
└── interfaces/
    ├── IERC20.sol
    ├── IERC4626.sol
    └── IInvoiceNFT.sol

src/lib/
└── contract-abis.ts           ← Contract ABIs for ethers.js

src/services/
└── liquidity-pool.ts          ← Pool interaction service

src/app/api/pool/
├── route.ts                   ← GET pool stats
├── balance/route.ts           ← POST LP balance
├── deposit/preview/route.ts   ← POST preview deposit
├── withdraw/preview/route.ts  ← POST preview withdraw
└── loans/
    ├── fund/route.ts          ← POST fund loan (signature)
    ├── repay/route.ts         ← POST repay loan
    └── [id]/route.ts          ← GET loan details
```

---

## Environment Variables Required

After deploying contracts, add these to `.env`:

```env
LIQUIDITY_POOL_ADDRESS="<deployed-pool-address>"
INVOICE_NFT_ADDRESS="<deployed-nft-address>"
USDC_ADDRESS="<usdc-address>"
```

---

## Next Steps

1. **Deploy contracts** to Sepolia (see `contracts/DEPLOYMENT.md`)
2. **Test the flow** end-to-end
3. **Build frontend** for LP dashboard and invoice management

---

## Related Documentation

- [Deployment Guide](../contracts/DEPLOYMENT.md)
- [API Documentation](./API.md) *(to be created)*

---

*Last Updated: January 15, 2026*
