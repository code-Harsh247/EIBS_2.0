import { NextRequest } from 'next/server';
import { extractTokenFromHeader, getUserFromToken, permissions } from '@/lib/auth';
import { 
  successResponse, 
  errorResponse,
  unauthorizedResponse,
  forbiddenResponse,
  notFoundResponse,
  handleError 
} from '@/lib/api-response';
import { liquidityPoolService } from '@/services/liquidity-pool';
import { getInvoiceById } from '@/services/invoice';
import { createAuditLog } from '@/services/audit';
import { AuditAction } from '@prisma/client';
import { z } from 'zod';
import crypto from 'crypto';

const fundLoanSchema = z.object({
  invoiceId: z.string().min(1, 'Invoice ID is required'),
  sellerAddress: z.string().min(1, 'Seller wallet address is required'),
  // Note: buyerAddress removed for privacy - not stored on-chain
  publicMetadataURI: z.string().optional() // IPFS URI for non-sensitive metadata
});

/**
 * Generate document hash from invoice data
 * This is used for on-chain storage instead of private invoice details
 * 
 * CRITICAL: This hash must be DETERMINISTIC and REPRODUCIBLE
 * - Fields are sorted alphabetically before hashing
 * - Uses invoice issueDate as salt (not Date.now())
 * - Same invoice data = same hash (enables double-financing check)
 */
function generateDocumentHash(invoice: {
  invoiceNumber: string;
  totalAmount: { toString(): string };
  dueDate: Date;
  issueDate: Date;
  sellerId: string;
  buyerId: string;
}): string {
  // Create object with fields in ALPHABETICAL ORDER
  // This ensures consistent hashing regardless of JS object property order
  const normalizedData = {
    buyerId: invoice.buyerId,
    dueDate: invoice.dueDate.toISOString(),
    invoiceNumber: invoice.invoiceNumber,
    issueDate: invoice.issueDate.toISOString(), // Use invoice date as salt, NOT Date.now()
    sellerId: invoice.sellerId,
    totalAmount: invoice.totalAmount.toString()
  };
  
  // Use JSON.stringify with sorted keys as extra safety
  const data = JSON.stringify(normalizedData, Object.keys(normalizedData).sort());
  
  const hash = crypto.createHash('sha256').update(data).digest('hex');
  return '0x' + hash;
}

// POST /api/pool/loans/fund - Generate signature to fund an invoice
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const token = extractTokenFromHeader(authHeader);

    if (!token) {
      return unauthorizedResponse('No token provided');
    }

    const user = await getUserFromToken(token);
    if (!user) {
      return unauthorizedResponse('Invalid token');
    }

    // Only admin can generate loan signatures
    if (!permissions.canManageUsers(user.role)) {
      return forbiddenResponse('Only admins can authorize loan funding');
    }

    const body = await request.json();
    const validation = fundLoanSchema.safeParse(body);

    if (!validation.success) {
      return errorResponse(validation.error.errors[0].message, 400);
    }

    const { invoiceId, sellerAddress, publicMetadataURI } = validation.data;

    // Get invoice from database
    const invoice = await getInvoiceById(invoiceId);
    if (!invoice) {
      return notFoundResponse('Invoice not found');
    }

    // Validate invoice is approved
    if (invoice.status !== 'APPROVED') {
      return errorResponse('Only approved invoices can be funded', 400);
    }

    // Generate document hash for privacy (no private data on-chain)
    const documentHash = generateDocumentHash(invoice);

    // Check if already funded using document hash
    const isFunded = await liquidityPoolService.isDocumentFunded(documentHash);
    if (isFunded) {
      return errorResponse('Invoice has already been funded', 400);
    }

    // Calculate risk score (simplified - you'd have a proper credit scoring system)
    const riskScore = calculateRiskScore(invoice);

    // Calculate due date in Unix timestamp
    const dueDate = Math.floor(invoice.dueDate.getTime() / 1000);

    // Generate signed loan approval (privacy-preserving)
    const signatureData = await liquidityPoolService.generateLoanSignature(
      documentHash,
      invoice.totalAmount.toString(),
      dueDate,
      sellerAddress,
      riskScore,
      publicMetadataURI || '' // IPFS URI for non-sensitive metadata
    );

    // Get yield info
    const yieldInfo = liquidityPoolService.calculateExpectedYield(
      BigInt(Math.floor(parseFloat(invoice.totalAmount.toString()) * 1e6)),
      riskScore
    );

    // Create audit log (off-chain, includes private data)
    await createAuditLog({
      userId: user.id,
      action: AuditAction.APPROVE, // Loan authorization = approval
      entityType: 'INVOICE',
      entityId: invoice.id,
      newValue: {
        invoiceNumber: invoice.invoiceNumber,
        documentHash: documentHash,
        amount: invoice.totalAmount.toString(),
        riskScore,
        yieldBps: signatureData.expectedYieldBps,
        loanAuthorized: true
      }
    });

    return successResponse({
      message: 'Loan authorization generated (privacy-preserving)',
      signatureData,
      riskRating: yieldInfo.rating,
      expectedYield: yieldInfo.yieldAmount,
      expectedYieldPercentage: yieldInfo.yieldBps / 100,
      privacy: {
        note: 'Only documentHash is stored on-chain. No private invoice details are exposed.',
        documentHash: signatureData.documentHash,
        invoiceNumberStored: false,
        buyerAddressStored: false
      },
      instructions: 'Use this signature to call fundLoan() on the LiquidityPool contract. Seller must have a verified IdentitySBT.'
    });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * Calculate risk score for an invoice (0-100, lower is better)
 * This is a simplified version - in production you'd have ML models, credit checks, etc.
 */
function calculateRiskScore(invoice: {
  totalAmount: { toString(): string };
  dueDate: Date;
  issueDate: Date;
  seller?: { name: string } | null;
  buyer?: { name: string } | null;
}): number {
  let score = 30; // Base score

  // Factor 1: Invoice amount (higher = more risk)
  const amount = parseFloat(invoice.totalAmount.toString());
  if (amount > 100000) score += 20;
  else if (amount > 50000) score += 10;
  else if (amount > 10000) score += 5;

  // Factor 2: Days until due (shorter = less risk)
  const daysUntilDue = Math.floor((invoice.dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (daysUntilDue < 30) score -= 10;
  else if (daysUntilDue > 90) score += 15;
  else if (daysUntilDue > 60) score += 5;

  // Factor 3: Buyer/Seller reputation (placeholder - would check payment history)
  if (invoice.buyer && invoice.seller) {
    score -= 5; // Known companies
  }

  // Clamp to 0-100
  return Math.max(0, Math.min(100, score));
}
