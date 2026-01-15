# EIBS 2.0 - API & Smart Contract Reference

**Last Updated:** January 15, 2026  
**Base URL:** `http://localhost:3000/api`  
**Blockchain Network:** Ethereum Sepolia Testnet

---

## Table of Contents

- [Authentication APIs](#authentication-apis)
- [Invoice APIs](#invoice-apis)
- [Company APIs](#company-apis)
- [User APIs](#user-apis)
- [Payment APIs](#payment-apis)
- [Liquidity Pool APIs](#liquidity-pool-apis)
- [Audit Log APIs](#audit-log-apis)
- [Health Check APIs](#health-check-apis)
- [Smart Contracts](#smart-contracts)

---

## Authentication

All authenticated endpoints require a Bearer token in the `Authorization` header:

```
Authorization: Bearer <token>
```

### User Roles
- `ADMIN` - Full system access
- `ACCOUNTANT` - Create and manage invoices
- `USER` - Basic user access
- `AUDITOR` - Read-only access to all data

---

## Authentication APIs

### POST `/auth/register`
Register a new user account.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "firstName": "John",
  "lastName": "Doe",
  "companyId": "clx123abc" // Optional
}
```

**Response:** `201 Created`
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "clx123abc",
      "email": "user@example.com",
      "firstName": "John",
      "lastName": "Doe",
      "role": "USER"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

---

### POST `/auth/login`
Authenticate user and receive access token.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "clx123abc",
      "email": "user@example.com",
      "role": "ADMIN",
      "company": {
        "id": "clx456def",
        "name": "Acme Corp"
      }
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": "7d"
  }
}
```

---

### GET `/auth/me`
Get current authenticated user information.

**Headers:** `Authorization: Bearer <token>`

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "id": "clx123abc",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "role": "ADMIN",
    "company": {
      "id": "clx456def",
      "name": "Acme Corp"
    }
  }
}
```

---

### POST `/auth/logout`
Invalidate current session token.

**Headers:** `Authorization: Bearer <token>`

**Response:** `200 OK`
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

---

## Invoice APIs

### GET `/invoices`
List invoices with filtering, searching, and pagination.

**Headers:** `Authorization: Bearer <token>`

**Query Parameters:**
- `status` - Filter by status: `DRAFT`, `PENDING`, `APPROVED`, `REJECTED`
- `paymentStatus` - Filter by payment: `UNPAID`, `PARTIALLY_PAID`, `PAID`, `OVERDUE`
- `sellerId` - Filter by seller company ID
- `buyerId` - Filter by buyer company ID
- `dateFrom` - Filter by date (ISO 8601)
- `dateTo` - Filter by date (ISO 8601)
- `search` - Search by invoice number or notes
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 20)
- `sortBy` - Sort field (default: `createdAt`)
- `sortOrder` - Sort direction: `asc` or `desc` (default: `desc`)

**Response:** `200 OK`
```json
{
  "success": true,
  "data": [
    {
      "id": "clx789ghi",
      "invoiceNumber": "INV-2026-0001",
      "seller": { "id": "clx456def", "name": "Acme Corp" },
      "buyer": { "id": "clx123abc", "name": "Widget Inc" },
      "totalAmount": "5000.00",
      "status": "APPROVED",
      "paymentStatus": "UNPAID",
      "dueDate": "2026-02-15T00:00:00.000Z",
      "pdfUrl": "invoices/clx789ghi/invoice.pdf",
      "documentHash": "0x7a3f9e2b...",
      "isVerified": true
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "totalPages": 3
  }
}
```

---

### POST `/invoices`
Create a new invoice.

**Headers:** `Authorization: Bearer <token>`  
**Permission:** `ADMIN`, `ACCOUNTANT`

**Request Body:**
```json
{
  "sellerId": "clx456def",
  "buyerId": "clx123abc",
  "issueDate": "2026-01-15",
  "dueDate": "2026-02-15",
  "currency": "USD",
  "items": [
    {
      "description": "Software Development Services",
      "quantity": 40,
      "unitPrice": 125.00
    }
  ],
  "notes": "Payment due within 30 days",
  "terms": "Net 30"
}
```

**Response:** `201 Created`
```json
{
  "success": true,
  "data": {
    "id": "clx789ghi",
    "invoiceNumber": "INV-2026-0001",
    "subtotal": "5000.00",
    "taxAmount": "0.00",
    "totalAmount": "5000.00",
    "status": "DRAFT",
    "paymentStatus": "UNPAID"
  }
}
```

---

### GET `/invoices/[id]`
Get invoice details by ID.

**Headers:** `Authorization: Bearer <token>`

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "id": "clx789ghi",
    "invoiceNumber": "INV-2026-0001",
    "seller": {
      "id": "clx456def",
      "name": "Acme Corp",
      "walletAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1"
    },
    "buyer": {
      "id": "clx123abc",
      "name": "Widget Inc"
    },
    "items": [
      {
        "description": "Software Development Services",
        "quantity": "40.00",
        "unitPrice": "125.00",
        "amount": "5000.00"
      }
    ],
    "subtotal": "5000.00",
    "taxAmount": "0.00",
    "totalAmount": "5000.00",
    "issueDate": "2026-01-15T00:00:00.000Z",
    "dueDate": "2026-02-15T00:00:00.000Z",
    "status": "APPROVED",
    "paymentStatus": "UNPAID",
    "vanId": "vLIQ-ACME-260115-001",
    "pdfUrl": "invoices/clx789ghi/invoice.pdf",
    "documentHash": "0x7a3f9e2b...",
    "riskScore": 30,
    "publicMetadataURI": "ipfs://Qm...",
    "isVerified": true,
    "blockchainTxId": "0xabc123...",
    "createdAt": "2026-01-15T10:30:00.000Z"
  }
}
```

---

### PATCH `/invoices/[id]`
Update invoice details (only DRAFT/PENDING status).

**Headers:** `Authorization: Bearer <token>`  
**Permission:** `ADMIN`, `ACCOUNTANT`

**Request Body:** (all fields optional)
```json
{
  "dueDate": "2026-03-01",
  "notes": "Updated payment terms",
  "terms": "Net 45"
}
```

**Response:** `200 OK`

---

### DELETE `/invoices/[id]`
Delete invoice (only DRAFT status).

**Headers:** `Authorization: Bearer <token>`  
**Permission:** `ADMIN`

**Response:** `200 OK`

---

### POST `/invoices/[id]/approve`
Approve a pending invoice and assign Virtual Account Number (VAN) for settlement.

**Headers:** `Authorization: Bearer <token>`  
**Permission:** `ADMIN`

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "id": "clx789ghi",
    "invoiceNumber": "INV-2026-0001",
    "status": "APPROVED",
    "vanId": "vLIQ-ACME-260115-001",
    "settlement": {
      "vanId": "vLIQ-ACME-260115-001",
      "assignedAt": "2026-01-15T12:00:00.000Z",
      "instructions": "Payments to this invoice should reference VAN: vLIQ-ACME-260115-001"
    }
  },
  "message": "Invoice approved successfully"
}
```

**VAN Format:** `vLIQ-[SELLER]-[YYMMDD]-[SEQ]`
- `vLIQ` - Virtual Liquidity prefix
- `SELLER` - First 4 chars of seller name (uppercase)
- `YYMMDD` - Date of VAN assignment
- `SEQ` - 3-digit sequence number

---

### POST `/invoices/[id]/reject`
Reject a pending invoice.

**Headers:** `Authorization: Bearer <token>`  
**Permission:** `ADMIN`

**Request Body:**
```json
{
  "reason": "Invalid tax calculation"
}
```

**Response:** `200 OK`

---

### POST `/invoices/[id]/metadata/generate`
Generate privacy-preserving metadata and upload to IPFS.

**Headers:** `Authorization: Bearer <token>`  
**Permission:** `ADMIN`, `ACCOUNTANT`

**Request Body:**
```json
{
  "riskScore": 30 // Optional, 0-100 (lower is better)
}
```

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "invoice": {
      "id": "clx789ghi",
      "documentHash": "0x7a3f9e2b...",
      "riskScore": 30,
      "publicMetadataURI": "ipfs://Qm..."
    },
    "publicMetadata": {
      "version": "1.0",
      "type": "invoice",
      "documentHash": "0x7a3f9e2b...",
      "amountRange": "$1,000 - $5,000",
      "currency": "USD",
      "sector": "Technology",
      "riskScore": 30,
      "dueDate": "2026-02-15"
    },
    "ipfs": {
      "ipfsHash": "Qm...",
      "ipfsUri": "ipfs://Qm...",
      "gatewayUrl": "https://gateway.pinata.cloud/ipfs/Qm..."
    }
  }
}
```

---

### POST `/invoices/[id]/pdf`
Upload PDF to invoice with blockchain signing.

**Headers:** `Authorization: Bearer <token>`  
**Permission:** `ADMIN`, `ACCOUNTANT`

**Request Body:** `multipart/form-data`
- `pdf` (File) - PDF file (max 10MB)
- `riskScore` (Text) - Optional risk score 0-100

**Response:** `201 Created`
```json
{
  "success": true,
  "data": {
    "invoice": {
      "id": "clx789ghi",
      "invoiceNumber": "INV-2026-0001",
      "pdfUrl": "invoices/clx789ghi/invoice.pdf",
      "documentHash": "0x9f2e1c4d...",
      "publicMetadataURI": "ipfs://Qm...",
      "riskScore": 30
    },
    "pdf": {
      "storagePath": "invoices/clx789ghi/invoice.pdf",
      "size": 245678,
      "hash": "7a3f9e2b..."
    },
    "documentHash": "0x9f2e1c4d...",
    "signature": {
      "value": "0xabc123...",
      "signerAddress": "0x742d35Cc...",
      "timestamp": 1705324800000
    },
    "ipfs": {
      "uri": "ipfs://Qm...",
      "gatewayUrl": "https://gateway.pinata.cloud/ipfs/Qm..."
    },
    "publicMetadata": {
      "version": "1.0",
      "type": "invoice",
      "documentHash": "0x9f2e1c4d...",
      "amountRange": "$1,000 - $5,000",
      "sector": "Technology",
      "riskScore": 30
    }
  },
  "message": "PDF uploaded and signed successfully"
}
```

---

### GET `/invoices/[id]/pdf`
Get signed download URL for invoice PDF.

**Headers:** `Authorization: Bearer <token>`

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "invoiceId": "clx789ghi",
    "invoiceNumber": "INV-2026-0001",
    "downloadUrl": "https://gwrsaobqxtbfawewccnc.supabase.co/storage/v1/object/sign/...",
    "expiresIn": 3600,
    "documentHash": "0x9f2e1c4d..."
  }
}
```

---

### DELETE `/invoices/[id]/pdf`
Remove PDF from invoice.

**Headers:** `Authorization: Bearer <token>`  
**Permission:** `ADMIN`

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "invoice": {
      "id": "clx789ghi",
      "pdfUrl": null
    },
    "deleted": true
  },
  "message": "PDF deleted successfully"
}
```

---

### GET `/invoices/stats`
Get invoice statistics.

**Headers:** `Authorization: Bearer <token>`

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "totalInvoices": 156,
    "totalAmount": "1250000.00",
    "statusBreakdown": {
      "DRAFT": 12,
      "PENDING": 8,
      "APPROVED": 120,
      "REJECTED": 16
    },
    "paymentBreakdown": {
      "UNPAID": 45,
      "PARTIALLY_PAID": 5,
      "PAID": 100,
      "OVERDUE": 6
    }
  }
}
```

---

### POST `/invoices/[id]/blockchain/record`
Record invoice hash on blockchain.

**Headers:** `Authorization: Bearer <token>`  
**Permission:** `ADMIN`, `ACCOUNTANT`, `AUDITOR`

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "transactionHash": "0xabc123...",
    "invoiceHash": "0x7a3f9e2b...",
    "blockchainNetwork": "sepolia",
    "timestamp": "2026-01-15T12:00:00.000Z"
  }
}
```

---

### GET `/invoices/[id]/blockchain/verify`
Verify invoice hash on blockchain.

**Headers:** `Authorization: Bearer <token>`  
**Permission:** `ADMIN`, `ACCOUNTANT`, `AUDITOR`

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "isValid": true,
    "storedHash": "0x7a3f9e2b...",
    "currentHash": "0x7a3f9e2b...",
    "timestamp": "2026-01-15T12:00:00.000Z",
    "recorder": "0x742d35Cc...",
    "message": "Invoice hash matches blockchain record"
  }
}
```

---

## Company APIs

### GET `/companies`
List all companies.

**Headers:** `Authorization: Bearer <token>`

**Query Parameters:**
- `search` - Search by name or registration number
- `isActive` - Filter by active status (true/false)
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 20)

**Response:** `200 OK`
```json
{
  "success": true,
  "data": [
    {
      "id": "clx456def",
      "name": "Acme Corp",
      "registrationNo": "ABC123456",
      "taxId": "12-3456789",
      "address": "123 Main St",
      "city": "New York",
      "country": "USA",
      "walletAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1",
      "isActive": true
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 15,
    "totalPages": 1
  }
}
```

---

### POST `/companies`
Create a new company.

**Headers:** `Authorization: Bearer <token>`  
**Permission:** `ADMIN`

**Request Body:**
```json
{
  "name": "Acme Corp",
  "registrationNo": "ABC123456",
  "taxId": "12-3456789",
  "address": "123 Main St",
  "city": "New York",
  "state": "NY",
  "country": "USA",
  "postalCode": "10001",
  "phone": "+1-555-0100",
  "email": "info@acme.com",
  "website": "https://acme.com",
  "walletAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1"
}
```

**Response:** `201 Created`

---

### GET `/companies/[id]`
Get company details.

**Headers:** `Authorization: Bearer <token>`

**Response:** `200 OK`

---

### PATCH `/companies/[id]`
Update company information.

**Headers:** `Authorization: Bearer <token>`  
**Permission:** `ADMIN`

**Response:** `200 OK`

---

### DELETE `/companies/[id]`
Delete company.

**Headers:** `Authorization: Bearer <token>`  
**Permission:** `ADMIN`

**Response:** `200 OK`

---

## User APIs

### GET `/users`
List all users.

**Headers:** `Authorization: Bearer <token>`  
**Permission:** `ADMIN`

**Query Parameters:**
- `role` - Filter by role
- `companyId` - Filter by company
- `isActive` - Filter by active status
- `search` - Search by name or email
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 20)

**Response:** `200 OK`

---

### POST `/users`
Create a new user.

**Headers:** `Authorization: Bearer <token>`  
**Permission:** `ADMIN`

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "firstName": "John",
  "lastName": "Doe",
  "role": "ACCOUNTANT",
  "companyId": "clx456def"
}
```

**Response:** `201 Created`

---

### GET `/users/[id]`
Get user details.

**Headers:** `Authorization: Bearer <token>`  
**Permission:** `ADMIN` or own account

**Response:** `200 OK`

---

### PATCH `/users/[id]`
Update user information.

**Headers:** `Authorization: Bearer <token>`  
**Permission:** `ADMIN` or own account

**Response:** `200 OK`

---

### DELETE `/users/[id]`
Delete user account.

**Headers:** `Authorization: Bearer <token>`  
**Permission:** `ADMIN`

**Response:** `200 OK`

---

## Payment APIs

### GET `/payments`
List all payments.

**Headers:** `Authorization: Bearer <token>`

**Query Parameters:**
- `invoiceId` - Filter by invoice
- `status` - Filter by payment status
- `page` - Page number
- `limit` - Items per page

**Response:** `200 OK`

---

### POST `/payments`
Record a payment.

**Headers:** `Authorization: Bearer <token>`  
**Permission:** `ADMIN`, `ACCOUNTANT`

**Request Body:**
```json
{
  "invoiceId": "clx789ghi",
  "amount": "5000.00",
  "paymentDate": "2026-01-20",
  "paymentMethod": "BANK_TRANSFER",
  "reference": "TXN123456",
  "notes": "Payment received via wire transfer"
}
```

**Response:** `201 Created`

---

## Liquidity Pool APIs

### GET `/pool`
Get liquidity pool information.

**Headers:** `Authorization: Bearer <token>`

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "totalAssets": "1000000.000000",
    "totalShares": "950000.000000",
    "sharePrice": "1.052632",
    "totalActiveLoans": "500000.000000",
    "utilizationRate": "50.00",
    "availableLiquidity": "500000.000000",
    "totalLPs": 15,
    "apy": "8.5"
  }
}
```

---

### POST `/pool/balance`
Get LP balance for a wallet address.

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1"
}
```

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1",
    "shares": "10000.000000",
    "assets": "10526.320000",
    "shareToken": "lUSDC",
    "currency": "USDC"
  }
}
```

---

### POST `/pool/deposit/preview`
Preview deposit (shares to receive).

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "amount": "10000.000000"
}
```

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "depositAmount": "10000.000000",
    "sharesReceived": "9500.000000",
    "currency": "USDC",
    "shareToken": "lUSDC"
  }
}
```

---

### POST `/pool/withdraw/preview`
Preview withdrawal (shares to burn).

**Headers:** `Authorization: Bearer <token>`

**Request Body:**
```json
{
  "amount": "10000.000000"
}
```

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "withdrawAmount": "10000.000000",
    "sharesBurned": "9500.000000",
    "currency": "USDC",
    "shareToken": "lUSDC"
  }
}
```

---

### POST `/pool/loans/fund`
Fund an invoice (create loan).

**Headers:** `Authorization: Bearer <token>`  
**Permission:** `ADMIN`

**Request Body:**
```json
{
  "invoiceId": "clx789ghi",
  "sellerAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1",
  "publicMetadataURI": "ipfs://Qm..."
}
```

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "tokenId": "1",
    "invoice": {
      "id": "clx789ghi",
      "invoiceNumber": "INV-2026-0001"
    },
    "loan": {
      "principal": "5000.000000",
      "expectedYield": "212.500000",
      "dueDate": "2026-02-15T00:00:00.000Z",
      "documentHash": "0x9f2e1c4d..."
    },
    "signature": {
      "documentHash": "0x9f2e1c4d...",
      "nonce": "0xabc123...",
      "signature": "0xdef456..."
    }
  }
}
```

---

### POST `/pool/loans/repay`
Repay a loan (oracle function).

**Headers:** `Authorization: Bearer <token>`  
**Permission:** `ADMIN`

**Request Body:**
```json
{
  "tokenId": "1",
  "actualYield": "212.500000"
}
```

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "tokenId": "1",
    "principal": "5000.000000",
    "actualYield": "212.500000",
    "totalRepaid": "5212.500000",
    "invoice": {
      "id": "clx789ghi",
      "paymentStatus": "PAID"
    }
  }
}
```

---

### GET `/pool/loans/[id]`
Get loan details by token ID or invoice ID.

**Headers:** `Authorization: Bearer <token>`

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "tokenId": "1",
    "documentHash": "0x9f2e1c4d...",
    "principal": "5000.000000",
    "expectedYield": "212.500000",
    "dueDate": "2026-02-15T00:00:00.000Z",
    "fundedAt": "2026-01-15T12:00:00.000Z",
    "isActive": true,
    "isRepaid": false
  }
}
```

---

## Audit Log APIs

### GET `/audit-logs`
Get audit trail of system actions.

**Headers:** `Authorization: Bearer <token>`  
**Permission:** `ADMIN`, `AUDITOR`

**Query Parameters:**
- `userId` - Filter by user
- `invoiceId` - Filter by invoice
- `entityType` - Filter by entity type
- `action` - Filter by action (CREATE, UPDATE, DELETE, APPROVE, REJECT)
- `dateFrom` - Start date
- `dateTo` - End date
- `page` - Page number
- `limit` - Items per page

**Response:** `200 OK`
```json
{
  "success": true,
  "data": [
    {
      "id": "clx999xyz",
      "userId": "clx123abc",
      "user": {
        "email": "admin@example.com",
        "firstName": "Admin",
        "lastName": "User"
      },
      "invoiceId": "clx789ghi",
      "invoice": {
        "invoiceNumber": "INV-2026-0001"
      },
      "action": "UPDATE",
      "entityType": "Invoice",
      "entityId": "clx789ghi",
      "oldValue": { "status": "PENDING" },
      "newValue": { "status": "APPROVED" },
      "ipAddress": "192.168.1.100",
      "userAgent": "Mozilla/5.0...",
      "createdAt": "2026-01-15T12:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 1234,
    "totalPages": 25
  }
}
```

---

## Health Check APIs

### GET `/health`
Check API health status.

**No authentication required**

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "timestamp": "2026-01-15T12:00:00.000Z",
    "uptime": 345600,
    "services": {
      "database": "connected",
      "blockchain": "connected",
      "ipfs": "configured",
      "storage": "configured"
    }
  }
}
```

---

## Smart Contracts

### Network Configuration
- **Network:** Ethereum Sepolia Testnet
- **RPC URL:** `https://sepolia.infura.io/v3/...`
- **Chain ID:** 11155111
- **Block Explorer:** https://sepolia.etherscan.io

---

### 1. InvoiceVerification Contract

**Purpose:** Record and verify invoice hashes on-chain for immutable proof of existence.

**Address:** `TBD` (Set in `CONTRACT_ADDRESS` environment variable)

#### Key Functions

##### `recordInvoice(bytes32 invoiceHash, string invoiceId)`
Records an invoice hash on the blockchain.

**Parameters:**
- `invoiceHash` - SHA-256 hash of invoice data (bytes32)
- `invoiceId` - Unique invoice identifier (string)

**Emits:** `InvoiceRecorded(invoiceHash, invoiceId, recorder, timestamp)`

**Restrictions:**
- Invoice hash must not already exist
- Invoice ID must be unique

---

##### `verifyInvoice(bytes32 invoiceHash) → (bool, uint256, address)`
Verifies if an invoice hash exists on-chain.

**Returns:**
- `exists` - Whether the hash exists (bool)
- `timestamp` - When it was recorded (uint256)
- `recorder` - Address that recorded it (address)

---

##### `getInvoiceRecord(string invoiceId) → (bytes32, uint256, address)`
Get invoice record by invoice ID.

**Returns:**
- `hash` - The stored hash (bytes32)
- `timestamp` - Recording timestamp (uint256)
- `recorder` - Recorder address (address)

---

### 2. InvoiceNFT Contract

**Purpose:** ERC-721 NFT representing tokenized invoices for DeFi lending with privacy preservation.

**Address:** `TBD`

#### Privacy Model
- ❌ No client names or addresses stored on-chain
- ✅ Only stores `documentHash` (SHA-256 of invoice + PDF)
- ✅ `publicMetadataURI` points to IPFS with generic info only
- ✅ Prevents double-financing via hash collision detection

#### Key Functions

##### `mintInvoice(address seller, bytes32 documentHash, string publicMetadataURI, uint256 amount, uint256 dueDate, uint8 riskScore) → uint256`
Mint a new invoice NFT.

**Parameters:**
- `seller` - Seller wallet address
- `documentHash` - SHA-256 hash of invoice data + PDF (bytes32)
- `publicMetadataURI` - IPFS URI with public metadata (string)
- `amount` - Invoice amount in USDC (6 decimals) (uint256)
- `dueDate` - Due date as Unix timestamp (uint256)
- `riskScore` - Risk score 0-100 (uint8)

**Returns:** Token ID (uint256)

**Emits:** `InvoiceMinted(tokenId, documentHash, amount, riskScore)`

**Restrictions:**
- Only callable by oracle
- Document hash must be unique (prevents double-financing)
- Amount must be > 0
- Due date must be in the future
- Risk score must be ≤ 100

---

##### `markAsRepaid(uint256 tokenId)`
Mark an invoice as repaid.

**Emits:** `InvoiceRepaid(tokenId, documentHash)`

**Restrictions:**
- Only callable by owner or oracle
- Cannot repay twice

---

##### `getInvoice(uint256 tokenId) → InvoiceData`
Get invoice details.

**Returns:** InvoiceData struct with:
- `documentHash` (bytes32)
- `publicMetadataURI` (string)
- `amount` (uint256)
- `dueDate` (uint256)
- `seller` (address)
- `riskScore` (uint8)
- `isRepaid` (bool)
- `fundedAt` (uint256)

---

##### `isDocumentFinanced(bytes32 documentHash) → bool`
Check if a document hash has already been financed.

**Returns:** True if hash exists (prevents double-financing)

---

### 3. InvoiceLiquidityPool Contract

**Purpose:** ERC-4626 compliant vault for invoice financing. LPs deposit USDC and receive lUSDC shares.

**Address:** `TBD`

#### Key Features
- ✅ ERC-4626 standard compliance
- ✅ Signature-based loan approval
- ✅ KYB verification via IdentitySBT
- ✅ Privacy-preserving (only hashes on-chain)
- ✅ Automated yield distribution

#### Key Functions

##### `deposit(uint256 assets, address receiver) → uint256`
Deposit USDC to receive lUSDC shares.

**Returns:** Number of shares minted

**Emits:** `Deposit(sender, owner, assets, shares)`

---

##### `withdraw(uint256 assets, address receiver, address owner) → uint256`
Withdraw USDC by burning lUSDC shares.

**Returns:** Number of shares burned

**Emits:** `Withdraw(sender, receiver, owner, assets, shares)`

---

##### `fundLoan(bytes32 documentHash, string publicMetadataURI, uint256 amount, uint256 dueDate, address seller, uint8 riskScore, uint256 expectedYieldBps, bytes32 nonce, bytes signature) → uint256`
Fund an approved invoice (create loan).

**Parameters:**
- `documentHash` - SHA-256 of invoice + PDF (bytes32)
- `publicMetadataURI` - IPFS URI (string)
- `amount` - Loan amount in USDC (uint256)
- `dueDate` - Unix timestamp (uint256)
- `seller` - Seller wallet address (address)
- `riskScore` - 0-100 (uint8)
- `expectedYieldBps` - Expected yield in basis points (uint256)
- `nonce` - Unique nonce for replay protection (bytes32)
- `signature` - Backend signature (bytes)

**Returns:** NFT token ID (uint256)

**Emits:** `LoanFunded(tokenId, documentHash, amount, seller)`

**Restrictions:**
- Caller must have valid IdentitySBT (KYB verified)
- Caller must not be blacklisted
- Signature must be valid
- Nonce must not be reused
- Pool must have sufficient liquidity
- Must not exceed max utilization rate

---

##### `repayLoan(uint256 tokenId, uint256 actualYield)`
Repay a loan (oracle function).

**Parameters:**
- `tokenId` - Invoice NFT token ID (uint256)
- `actualYield` - Actual yield received (uint256)

**Emits:** `LoanRepaid(tokenId, documentHash, principal, yield)`

**Restrictions:**
- Only callable by oracle
- Loan must be active

---

##### `totalAssets() → uint256`
Get total USDC in the pool (including active loans).

---

##### `convertToShares(uint256 assets) → uint256`
Calculate shares for a given USDC amount.

---

##### `convertToAssets(uint256 shares) → uint256`
Calculate USDC value of shares.

---

##### `previewDeposit(uint256 assets) → uint256`
Preview shares to receive for deposit.

---

##### `previewWithdraw(uint256 assets) → uint256`
Preview shares to burn for withdrawal.

---

### 4. IdentitySBT Contract

**Purpose:** Soulbound Token (non-transferable) for KYB-verified businesses.

**Address:** `TBD`

#### Key Features
- ✅ Non-transferable (Soulbound)
- ✅ One token per address
- ✅ Can be activated/deactivated
- ✅ Blacklist support

#### Key Functions

##### `verifyBusiness(address wallet, string businessId, uint8 riskTier, string tokenURI)`
Mint SBT for a verified business.

**Restrictions:**
- Only callable by admin
- Wallet must not be blacklisted
- One token per address

**Emits:** `BusinessVerified(wallet, tokenId, businessId)`

---

##### `deactivateBusiness(address wallet, string reason)`
Deactivate a business (keeps token, revokes access).

**Emits:** `BusinessDeactivated(wallet, tokenId, reason)`

---

##### `reactivateBusiness(address wallet)`
Reactivate a previously deactivated business.

**Emits:** `BusinessReactivated(wallet, tokenId)`

---

##### `blacklistBusiness(address wallet, string reason)`
Add business to blacklist (permanent ban).

**Emits:** `BusinessBlacklisted(wallet, reason)`

---

##### `isVerifiedBusiness(address wallet) → bool`
Check if a wallet has an active SBT and is not blacklisted.

---

##### `getBusinessInfo(address wallet) → (string, uint256, uint8, bool)`
Get business verification details.

**Returns:**
- `businessId` (string)
- `verifiedAt` (uint256)
- `riskTier` (uint8) - 1=Low, 2=Medium, 3=High
- `isActive` (bool)

---

### 5. MockUSDC Contract

**Purpose:** ERC-20 token for testing (simulates USDC on Sepolia).

**Address:** `TBD`

**Decimals:** 6 (matches real USDC)

#### Key Functions
- `mint(address to, uint256 amount)` - Mint test USDC (public for testing)
- Standard ERC-20 functions: `transfer`, `approve`, `transferFrom`, etc.

---

## Error Codes

### HTTP Status Codes
- `200` - Success
- `201` - Created
- `400` - Bad Request (validation error)
- `401` - Unauthorized (no token or invalid token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `500` - Internal Server Error
- `503` - Service Unavailable

### Common Error Responses
```json
{
  "success": false,
  "error": "Error message here",
  "errors": {
    "field": ["Validation error 1", "Validation error 2"]
  }
}
```

---

## Environment Variables

### Required Configuration
```env
# Database
DATABASE_URL="postgresql://..."
DIRECT_URL="postgresql://..."

# JWT Authentication
JWT_SECRET="your-secret-key"
JWT_EXPIRES_IN="7d"

# Blockchain
BLOCKCHAIN_RPC_URL="https://sepolia.infura.io/v3/..."
PRIVATE_KEY="0x..."
CONTRACT_ADDRESS="0x..."
BLOCKCHAIN_NETWORK="sepolia"

# Supabase Storage
NEXT_PUBLIC_SUPABASE_URL="https://....supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# IPFS (Pinata)
PINATA_API_KEY="..."
PINATA_SECRET_KEY="..."
PINATA_GATEWAY="https://gateway.pinata.cloud"
```

---

## Rate Limiting

Currently no rate limiting is implemented. Recommended for production:
- 100 requests per minute per IP for public endpoints
- 1000 requests per minute per token for authenticated endpoints

---

## Versioning

**Current Version:** 1.0  
**API Version:** v1 (implicit, no version prefix)

Future versions will use URL prefixes: `/api/v2/...`

---

## Support

For API issues or questions:
- GitHub Issues: [Link to repository]
- Email: support@eibs.example.com

---

**Last Updated:** January 15, 2026
