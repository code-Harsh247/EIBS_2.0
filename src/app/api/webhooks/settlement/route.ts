/**
 * Settlement Webhook - Receives payment notifications and triggers blockchain repayment
 * 
 * POST /api/webhooks/settlement
 * 
 * This webhook is called by banking partners when a payment is received
 * to a Virtual Account Number (VAN). It triggers the on-chain repayment flow.
 * 
 * Security: Validates x-webhook-secret header against WEBHOOK_SECRET env var
 */

import { NextRequest } from 'next/server';
import { ethers } from 'ethers';
import { successResponse, errorResponse } from '@/lib/api-response';
import { BankingService } from '@/services/banking';
import { liquidityPoolService } from '@/services/liquidity-pool';
import { prisma } from '@/lib/prisma';
import { createAuditLog } from '@/services/audit';
import { LIQUIDITY_POOL_ABI } from '@/lib/contract-abis';
import { PaymentStatus, InvoiceStatus, BlockchainTxStatus } from '@prisma/client';

// Environment variables
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'dev-webhook-secret';
const BLOCKCHAIN_RPC_URL = process.env.BLOCKCHAIN_RPC_URL || '';
const PRIVATE_KEY = process.env.PRIVATE_KEY || '';
const LIQUIDITY_POOL_ADDRESS = process.env.LIQUIDITY_POOL_ADDRESS || '';

interface SettlementPayload {
  vanId: string;
  amount: number; // Amount in cents or smallest unit
  currency: string;
  reference?: string;
  timestamp?: string;
}

/**
 * Validate webhook secret
 */
function validateWebhookSecret(request: NextRequest): boolean {
  const secret = request.headers.get('x-webhook-secret');
  return secret === WEBHOOK_SECRET;
}

/**
 * Get signer for blockchain transactions
 */
function getSigner() {
  if (!BLOCKCHAIN_RPC_URL || !PRIVATE_KEY) {
    throw new Error('Blockchain configuration missing');
  }
  const provider = new ethers.JsonRpcProvider(BLOCKCHAIN_RPC_URL);
  return new ethers.Wallet(PRIVATE_KEY, provider);
}

/**
 * Execute on-chain loan repayment
 */
async function executeRepayment(
  tokenId: string,
  actualYield: bigint
): Promise<{ txHash: string; success: boolean }> {
  const signer = getSigner();
  const pool = new ethers.Contract(LIQUIDITY_POOL_ADDRESS, LIQUIDITY_POOL_ABI, signer);

  try {
    // Call repayLoan on the contract
    const tx = await pool.repayLoan(tokenId, actualYield);
    const receipt = await tx.wait();

    return {
      txHash: receipt.hash,
      success: true,
    };
  } catch (error) {
    console.error('Repayment transaction failed:', error);
    throw error;
  }
}

/**
 * POST /api/webhooks/settlement
 * 
 * Receives payment notification and triggers blockchain repayment
 */
export async function POST(request: NextRequest) {
  try {
    // Step 1: Validate webhook secret
    if (!validateWebhookSecret(request)) {
      console.warn('Settlement webhook: Invalid secret');
      return errorResponse('Unauthorized', 401);
    }

    // Step 2: Parse payload
    const payload: SettlementPayload = await request.json();

    if (!payload.vanId || !payload.amount || !payload.currency) {
      return errorResponse('Missing required fields: vanId, amount, currency', 400);
    }

    console.log(`Settlement webhook received: VAN=${payload.vanId}, Amount=${payload.amount} ${payload.currency}`);

    // Step 3: Lookup invoice by VAN
    const invoice = await BankingService.getInvoiceByVan(payload.vanId);

    if (!invoice) {
      console.error(`Settlement webhook: Invoice not found for VAN ${payload.vanId}`);
      return errorResponse(`Invoice not found for VAN: ${payload.vanId}`, 404);
    }

    // Validate invoice status
    if (invoice.status !== InvoiceStatus.APPROVED) {
      return errorResponse(`Invoice is not approved. Current status: ${invoice.status}`, 400);
    }

    if (invoice.paymentStatus === PaymentStatus.PAID) {
      return errorResponse('Invoice is already paid', 400);
    }

    // Step 4: Get documentHash and lookup tokenId from blockchain
    const documentHash = invoice.documentHash;

    if (!documentHash) {
      return errorResponse('Invoice has no documentHash - cannot process blockchain repayment', 400);
    }

    // Get loan info using documentHash
    const loan = await liquidityPoolService.getLoanByDocumentHash(documentHash);

    if (!loan) {
      console.error(`Settlement webhook: No active loan found for documentHash ${documentHash}`);
      return errorResponse('No active loan found for this invoice', 404);
    }

    if (!loan.isActive) {
      return errorResponse('Loan is not active', 400);
    }

    // Step 5: Calculate yield
    const receivedAmount = BigInt(Math.round(payload.amount * 1e6 / 100)); // Convert cents to USDC (6 decimals)
    const principalBigInt = ethers.parseUnits(loan.principal, 6);
    
    let actualYield: bigint;
    if (receivedAmount > principalBigInt) {
      actualYield = receivedAmount - principalBigInt;
    } else {
      // If received less than principal, yield is 0 (partial payment or loss)
      actualYield = BigInt(0);
      console.warn(`Settlement: Received amount (${receivedAmount}) is less than principal (${principalBigInt})`);
    }

    console.log(`Settlement calculation:
      Received: ${ethers.formatUnits(receivedAmount, 6)} USDC
      Principal: ${loan.principal} USDC
      Yield: ${ethers.formatUnits(actualYield, 6)} USDC
      TokenId: ${loan.tokenId}`);

    // Step 6: Execute blockchain repayment
    let txResult;
    let isSimulation = false;

    if (!BLOCKCHAIN_RPC_URL || !PRIVATE_KEY || !LIQUIDITY_POOL_ADDRESS) {
      // Simulation mode - no blockchain configured
      isSimulation = true;
      txResult = {
        txHash: `0xsim_${Date.now().toString(16)}_${invoice.id.slice(0, 8)}`,
        success: true,
      };
      console.log('Settlement: Running in SIMULATION mode (no blockchain configured)');
    } else {
      txResult = await executeRepayment(loan.tokenId, actualYield);
    }

    // Step 7: Update database
    const now = new Date();

    // Create payment record
    const payment = await prisma.payment.create({
      data: {
        invoiceId: invoice.id,
        amount: Number(ethers.formatUnits(receivedAmount, 6)),
        paymentDate: now,
        paymentMethod: 'BANK_TRANSFER',
        reference: payload.reference || `VAN:${payload.vanId}`,
        notes: `Settlement via webhook. TX: ${txResult.txHash}`,
      },
    });

    // Update invoice status
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        paymentStatus: PaymentStatus.PAID,
        status: InvoiceStatus.APPROVED, // Keep approved but mark as paid
      },
    });

    // Create/update blockchain transaction record
    await prisma.blockchainTransaction.upsert({
      where: { invoiceId: invoice.id },
      update: {
        status: BlockchainTxStatus.CONFIRMED,
        confirmedAt: now,
      },
      create: {
        invoiceId: invoice.id,
        transactionHash: txResult.txHash,
        networkId: isSimulation ? 'simulation' : 'sepolia',
        invoiceHash: documentHash,
        status: BlockchainTxStatus.CONFIRMED,
        confirmedAt: now,
      },
    });

    // Create audit log
    await createAuditLog({
      invoiceId: invoice.id,
      action: 'UPDATE',
      entityType: 'Settlement',
      entityId: invoice.id,
      oldValue: {
        paymentStatus: invoice.paymentStatus,
        loanActive: true,
      },
      newValue: {
        paymentStatus: PaymentStatus.PAID,
        loanActive: false,
        receivedAmount: ethers.formatUnits(receivedAmount, 6),
        actualYield: ethers.formatUnits(actualYield, 6),
        txHash: txResult.txHash,
      },
      ipAddress: request.headers.get('x-forwarded-for') || 'webhook',
      userAgent: request.headers.get('user-agent') || 'webhook-client',
    });

    console.log(`Settlement complete: Invoice ${invoice.invoiceNumber} marked as PAID, TX: ${txResult.txHash}`);

    return successResponse({
      success: true,
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        vanId: invoice.vanId,
      },
      payment: {
        id: payment.id,
        amount: ethers.formatUnits(receivedAmount, 6),
        currency: 'USDC',
      },
      loan: {
        tokenId: loan.tokenId,
        principal: loan.principal,
        actualYield: ethers.formatUnits(actualYield, 6),
      },
      blockchain: {
        txHash: txResult.txHash,
        isSimulation,
      },
    }, 'Settlement processed successfully');

  } catch (error) {
    console.error('Settlement webhook error:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Settlement processing failed',
      500
    );
  }
}

/**
 * GET /api/webhooks/settlement
 * Health check for webhook endpoint
 */
export async function GET() {
  return successResponse({
    status: 'healthy',
    endpoint: '/api/webhooks/settlement',
    method: 'POST',
    requiredHeaders: ['x-webhook-secret'],
    payloadFormat: {
      vanId: 'string (required)',
      amount: 'number (required, in cents)',
      currency: 'string (required)',
      reference: 'string (optional)',
      timestamp: 'string (optional, ISO 8601)',
    },
  });
}
