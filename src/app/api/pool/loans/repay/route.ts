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
import { createAuditLog } from '@/services/audit';
import { prisma } from '@/lib/prisma';
import { AuditAction } from '@prisma/client';
import { z } from 'zod';

const repayLoanSchema = z.object({
  tokenId: z.string().min(1, 'Token ID is required'),
  actualYield: z.string().min(1, 'Actual yield is required')
});

// POST /api/pool/loans/repay - Repay a loan (oracle function)
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

    // Only admin can trigger loan repayment
    if (!permissions.canManageUsers(user.role)) {
      return forbiddenResponse('Only admins can process loan repayments');
    }

    const body = await request.json();
    const validation = repayLoanSchema.safeParse(body);

    if (!validation.success) {
      return errorResponse(validation.error.errors[0].message, 400);
    }

    const { tokenId, actualYield } = validation.data;

    // Get loan details
    const loan = await liquidityPoolService.getLoanByTokenId(tokenId);
    if (!loan) {
      return notFoundResponse('Loan not found');
    }

    if (!loan.isActive) {
      return errorResponse('Loan has already been repaid', 400);
    }

    // Process repayment on blockchain
    const result = await liquidityPoolService.repayLoan(tokenId, actualYield);

    // Update invoice in database
    const invoice = await prisma.invoice.findFirst({
      where: { invoiceNumber: loan.invoiceId }
    });

    if (invoice) {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { paymentStatus: 'PAID' }
      });

      // Create payment record
      await prisma.payment.create({
        data: {
          invoiceId: invoice.id,
          amount: parseFloat(loan.principal) + parseFloat(actualYield),
          paymentDate: new Date(),
          paymentMethod: 'BLOCKCHAIN_REPAYMENT',
          reference: result.transactionHash
        }
      });
    }

    // Create audit log
    await createAuditLog({
      userId: user.id,
      action: AuditAction.LOAN_REPAID,
      entityType: 'INVOICE',
      entityId: invoice?.id || tokenId,
      newValue: {
        tokenId,
        invoiceId: loan.invoiceId,
        principal: loan.principal,
        actualYield,
        transactionHash: result.transactionHash
      }
    });

    return successResponse({
      message: 'Loan repaid successfully',
      tokenId,
      invoiceId: loan.invoiceId,
      principal: loan.principal,
      actualYield,
      transactionHash: result.transactionHash
    });
  } catch (error) {
    return handleError(error);
  }
}
