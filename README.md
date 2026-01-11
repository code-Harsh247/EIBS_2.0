# EIBS 2.0 - Enterprise Invoice Blockchain System

A secure invoice management platform with blockchain verification built with Next.js 14, Prisma, and Ethereum.

## Features

- 🔐 **Authentication & Authorization** - JWT-based auth with role-based access control
- 📄 **Invoice Management** - Full CRUD operations for invoices with status workflows
- 🏢 **Company Management** - Multi-tenant support with buyer/seller relationships
- ⛓️ **Blockchain Verification** - Immutable invoice records on Ethereum
- 📊 **Audit Logging** - Complete audit trail for compliance
- 💳 **Payment Tracking** - Track partial and full payments
- 📈 **Statistics & Reporting** - Dashboard with key metrics

## Tech Stack

- **Framework:** Next.js 14 (App Router)
- **Database:** PostgreSQL with Prisma ORM
- **Authentication:** JWT with bcrypt
- **Blockchain:** Ethereum (Solidity smart contracts, ethers.js)
- **Validation:** Zod
- **Language:** TypeScript

## Prerequisites

- Node.js 18+
- Supabase account (free tier works)
- (Optional) Ethereum node access (Infura/Alchemy) for blockchain features

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **Project Settings** > **Database** > **Connection string**
3. Copy the connection strings (both Transaction and Session modes)

### 3. Configure Environment

Copy the example environment file:

```bash
cp .env.example .env
```

Update `.env` with your Supabase credentials:

```env
# Transaction mode (port 6543) - for Prisma queries
DATABASE_URL="postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true"

# Session mode (port 5432) - for migrations
DIRECT_URL="postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-us-east-1.pooler.supabase.com:5432/postgres"

JWT_SECRET="your-secure-jwt-secret"
```

### 4. Set Up Database

Generate Prisma client and push schema to Supabase:

```bash
npm run db:generate
npm run db:push
```

(Optional) Seed the database with sample data:

```bash
npm run db:seed
```

### 5. Start Development Server

```bash
npm run dev
```

The API will be available at `http://localhost:3000/api`

## API Endpoints

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/logout` | Logout |
| GET | `/api/auth/me` | Get current user |
| PATCH | `/api/auth/me` | Update profile |
| PUT | `/api/auth/me` | Change password |

### Invoices

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/invoices` | List invoices |
| POST | `/api/invoices` | Create invoice |
| GET | `/api/invoices/stats` | Get statistics |
| GET | `/api/invoices/:id` | Get invoice |
| PATCH | `/api/invoices/:id` | Update invoice |
| DELETE | `/api/invoices/:id` | Delete invoice |
| POST | `/api/invoices/:id/approve` | Approve invoice |
| POST | `/api/invoices/:id/reject` | Reject invoice |

### Blockchain

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/invoices/:id/blockchain` | Get blockchain record |
| POST | `/api/invoices/:id/blockchain/record` | Record on blockchain |
| GET | `/api/invoices/:id/blockchain/verify` | Verify blockchain hash |

### Companies

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/companies` | List companies |
| POST | `/api/companies` | Create company |
| GET | `/api/companies/:id` | Get company |
| PATCH | `/api/companies/:id` | Update company |
| DELETE | `/api/companies/:id` | Deactivate company |

### Users (Admin)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/users` | List users |
| POST | `/api/users` | Create user |
| GET | `/api/users/:id` | Get user |
| PATCH | `/api/users/:id` | Update user |
| DELETE | `/api/users/:id` | Deactivate user |

### Payments

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/payments` | List payments |
| POST | `/api/payments` | Record payment |

### Audit Logs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/audit-logs` | Get audit logs |

## User Roles

- **ADMIN** - Full system access
- **ACCOUNTANT** - Create/manage invoices
- **AUDITOR** - Read-only access to all data
- **USER** - View invoices for their company

## Blockchain Integration

The system uses a Solidity smart contract (`contracts/InvoiceVerification.sol`) to record invoice hashes on Ethereum. This provides:

- **Immutability** - Once recorded, invoice data cannot be altered
- **Verification** - Anyone can verify an invoice hasn't been tampered with
- **Audit Trail** - On-chain record of when invoices were verified

### Deploying the Smart Contract

1. Install Hardhat or Remix
2. Compile `contracts/InvoiceVerification.sol`
3. Deploy to your preferred network (Sepolia testnet recommended for testing)
4. Update `CONTRACT_ADDRESS` in your `.env` file

## Project Structure

```
├── contracts/              # Solidity smart contracts
├── prisma/
│   ├── schema.prisma      # Database schema
│   └── seed.ts            # Database seed script
├── src/
│   ├── app/
│   │   ├── api/           # API routes
│   │   │   ├── auth/
│   │   │   ├── invoices/
│   │   │   ├── companies/
│   │   │   ├── users/
│   │   │   ├── payments/
│   │   │   └── audit-logs/
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── lib/               # Utility libraries
│   │   ├── prisma.ts
│   │   ├── auth.ts
│   │   ├── validations.ts
│   │   └── api-response.ts
│   ├── services/          # Business logic
│   │   ├── blockchain.ts
│   │   ├── invoice.ts
│   │   └── audit.ts
│   └── types/             # TypeScript types
└── package.json
```

## Scripts

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # Run ESLint
npm run db:generate  # Generate Prisma client
npm run db:push      # Push schema to database
npm run db:migrate   # Run migrations
npm run db:studio    # Open Prisma Studio
npm run db:seed      # Seed database
```

## License

MIT
