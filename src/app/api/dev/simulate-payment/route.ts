/**
 * Simulate Payment - Dev Tool for Testing Settlement Flow
 * 
 * POST /api/dev/simulate-payment
 * 
 * This endpoint simulates a bank payment being received for testing purposes.
 * It internally triggers the settlement webhook logic.
 * 
 * ⚠️ DEVELOPMENT ONLY - This endpoint should be disabled in production
 */

import { NextRequest } from 'next/server';
import { ethers } from 'ethers';
import { successResponse, errorResponse } from '@/lib/api-response';
import { BankingService } from '@/services/banking';
import { liquidityPoolService } from '@/services/liquidity-pool';
import { prisma } from '@/lib/prisma';
import { createAuditLog } from '@/services/audit';
import { PaymentStatus, InvoiceStatus, BlockchainTxStatus } from '@prisma/client';
import { LIQUIDITY_POOL_ABI } from '@/lib/contract-abis';

// Environment variables
const BLOCKCHAIN_RPC_URL = process.env.BLOCKCHAIN_RPC_URL || '';
const PRIVATE_KEY = process.env.PRIVATE_KEY || '';
const LIQUIDITY_POOL_ADDRESS = process.env.LIQUIDITY_POOL_ADDRESS || '';
const NODE_ENV = process.env.NODE_ENV || 'development';

interface SimulatePaymentPayload {
  invoiceId: string;
  overrideAmount?: number; // Optional: override the payment amount (in USDC)
}

/**
 * Execute on-chain loan repayment (same as webhook)
 */
async function executeRepayment(
  tokenId: string,
  actualYield: bigint
): Promise<{ txHash: string; success: boolean }> {
  const provider = new ethers.JsonRpcProvider(BLOCKCHAIN_RPC_URL);
  const signer = new ethers.Wallet(PRIVATE_KEY, provider);
  const pool = new ethers.Contract(LIQUIDITY_POOL_ADDRESS, LIQUIDITY_POOL_ABI, signer);

  const tx = await pool.repayLoan(tokenId, actualYield);
  const receipt = await tx.wait();

  return {
    txHash: receipt.hash,
    success: true,
  };
}

/**
 * POST /api/dev/simulate-payment
 * 
 * Simulates a payment for testing the settlement flow
 */
export async function POST(request: NextRequest) {
  try {
    // Production guard
    if (NODE_ENV === 'production') {
      return errorResponse('This endpoint is disabled in production', 403);
    }

    const payload: SimulatePaymentPayload = await request.json();

    if (!payload.invoiceId) {
      return errorResponse('Missing required field: invoiceId', 400);
    }

    // Step 1: Fetch invoice with all related data
    const invoice = await prisma.invoice.findUnique({
      where: { id: payload.invoiceId },
      include: {
        seller: true,
        buyer: true,
      },
    });

    if (!invoice) {
      return errorResponse('Invoice not found', 404);
    }

    // Validate invoice has VAN assigned
    if (!invoice.vanId) {
      return errorResponse('Invoice does not have a VAN assigned. Please approve the invoice first.', 400);
    }

    // Validate invoice status
    if (invoice.status !== InvoiceStatus.APPROVED) {
      return errorResponse(`Invoice is not approved. Current status: ${invoice.status}`, 400);
    }

    if (invoice.paymentStatus === PaymentStatus.PAID) {
      return errorResponse('Invoice is already paid', 400);
    }

    // Step 2: Get documentHash and lookup tokenId
    const documentHash = invoice.documentHash;

    if (!documentHash) {
      return errorResponse('Invoice has no documentHash - cannot process blockchain repayment', 400);
    }

    const loan = await liquidityPoolService.getLoanByDocumentHash(documentHash);

    if (!loan) {
      console.warn('No active loan found for invoice - proceeding with simulation anyway');
    }

    // Step 3: Determine payment amount
    const paymentAmountUsdc = payload.overrideAmount ?? Number(invoice.totalAmount);
    const receivedAmount = ethers.parseUnits(paymentAmountUsdc.toString(), 6);

    // Step 4: Calculate yield
    let actualYield = BigInt(0);
    let tokenId = loan?.tokenId || '0';

    if (loan && loan.isActive) {
      const principalBigInt = ethers.parseUnits(loan.principal, 6);
      if (receivedAmount > principalBigInt) {
        actualYield = receivedAmount - principalBigInt;
      }
      tokenId = loan.tokenId;
    }

    console.log(`Simulate Payment:
      Invoice: ${invoice.invoiceNumber}
      VAN: ${invoice.vanId}
      Amount: ${paymentAmountUsdc} USDC
      Principal: ${loan?.principal || 'N/A'} USDC
      Yield: ${ethers.formatUnits(actualYield, 6)} USDC
      TokenId: ${tokenId}`);

    // Step 5: Execute blockchain repayment (or simulate)
    let txResult;
    let isSimulation = false;

    const canExecuteBlockchain = 
      BLOCKCHAIN_RPC_URL && 
      PRIVATE_KEY && 
      LIQUIDITY_POOL_ADDRESS && 
      loan?.isActive;

    if (canExecuteBlockchain) {
      try {
        txResult = await executeRepayment(tokenId, actualYield);
      } catch (blockchainError) {
        console.error('Blockchain execution failed, falling back to simulation:', blockchainError);
        isSimulation = true;
        txResult = {
          txHash: `0xsim_dev_${Date.now().toString(16)}_${invoice.id.slice(0, 8)}`,
          success: true,
        };
      }
    } else {
      isSimulation = true;
      txResult = {
        txHash: `0xsim_dev_${Date.now().toString(16)}_${invoice.id.slice(0, 8)}`,
        success: true,
      };
      console.log('Simulate Payment: Running in SIMULATION mode');
    }

    // Step 6: Update database
    const now = new Date();

    // Create payment record
    const payment = await prisma.payment.create({
      data: {
        invoiceId: invoice.id,
        amount: paymentAmountUsdc,
        paymentDate: now,
        paymentMethod: 'BANK_TRANSFER',
        reference: `SIMULATED:${invoice.vanId}`,
        notes: `Simulated payment. TX: ${txResult.txHash}`,
      },
    });

    // Update invoice status
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        paymentStatus: PaymentStatus.PAID,
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
        networkId: isSimulation ? 'simulation-dev' : 'sepolia',
        invoiceHash: documentHash,
        status: BlockchainTxStatus.CONFIRMED,
        confirmedAt: now,
      },
    });

    // Create audit log
    await createAuditLog({
      invoiceId: invoice.id,
      action: 'UPDATE',
      entityType: 'SimulatedPayment',
      entityId: invoice.id,
      oldValue: {
        paymentStatus: invoice.paymentStatus,
      },
      newValue: {
        paymentStatus: PaymentStatus.PAID,
        simulatedAmount: paymentAmountUsdc,
        txHash: txResult.txHash,
        isSimulation,
      },
      ipAddress: request.headers.get('x-forwarded-for') || 'localhost',
      userAgent: 'dev-simulate-payment',
    });

    console.log(`Simulated Payment complete: Invoice ${invoice.invoiceNumber} marked as PAID`);

    return successResponse({
      success: true,
      message: 'Payment simulated successfully',
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        vanId: invoice.vanId,
        seller: invoice.seller?.name,
        buyer: invoice.buyer?.name,
      },
      payment: {
        id: payment.id,
        amount: paymentAmountUsdc,
        currency: 'USDC',
        reference: payment.reference,
      },
      loan: loan ? {
        tokenId: loan.tokenId,
        principal: loan.principal,
        actualYield: ethers.formatUnits(actualYield, 6),
        wasActive: loan.isActive,
      } : null,
      blockchain: {
        txHash: txResult.txHash,
        isSimulation,
        reason: isSimulation ? 'Blockchain not configured or loan not active' : 'Real blockchain transaction',
      },
      devNote: '⚠️ This is a DEV endpoint - disabled in production',
    }, 'Payment simulation completed');

  } catch (error) {
    console.error('Simulate payment error:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Payment simulation failed',
      500
    );
  }
}

/**
 * GET /api/dev/simulate-payment
 * Documentation and status for the dev endpoint
 */
export async function GET() {
  const isEnabled = NODE_ENV !== 'production';

  return successResponse({
    endpoint: '/api/dev/simulate-payment',
    status: isEnabled ? 'enabled' : 'disabled',
    environment: NODE_ENV,
    method: 'POST',
    description: 'Simulates a bank payment for testing the settlement flow',
    payload: {
      invoiceId: 'string (required) - The ID of the invoice to simulate payment for',
      overrideAmount: 'number (optional) - Override the payment amount in USDC (defaults to invoice totalAmount)',
    },
    prerequisites: [
      'Invoice must exist',
      'Invoice must have VAN assigned (approved status)',
      'Invoice paymentStatus must not be PAID',
    ],
    example: {
      invoiceId: 'clx1234567890',
      overrideAmount: 10500, // Optional: simulate $10,500 payment
    },
    warnings: [
      '⚠️ This endpoint is for DEVELOPMENT/TESTING only',
      '⚠️ Disabled in production environment',
      '⚠️ Creates real database records',
    ],
  });
}
