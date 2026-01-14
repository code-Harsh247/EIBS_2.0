import { NextRequest } from 'next/server';
import { extractTokenFromHeader, getUserFromToken } from '@/lib/auth';
import { 
  successResponse, 
  errorResponse,
  unauthorizedResponse,
  notFoundResponse,
  handleError 
} from '@/lib/api-response';
import { liquidityPoolService } from '@/services/liquidity-pool';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/pool/loans/[id] - Get loan details
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const authHeader = request.headers.get('authorization');
    const token = extractTokenFromHeader(authHeader);

    if (!token) {
      return unauthorizedResponse('No token provided');
    }

    const user = await getUserFromToken(token);
    if (!user) {
      return unauthorizedResponse('Invalid token');
    }

    // Try to get by token ID first, then by invoice ID
    let loan = null;
    
    // Check if id is numeric (token ID)
    if (/^\d+$/.test(id)) {
      try {
        loan = await liquidityPoolService.getLoanByTokenId(id);
      } catch {
        // Not found by token ID
      }
    }

    // If not found, try by invoice ID
    if (!loan) {
      loan = await liquidityPoolService.getLoanByInvoiceId(id);
    }

    if (!loan) {
      return notFoundResponse('Loan not found');
    }

    // Calculate yield info
    const yieldInfo = liquidityPoolService.calculateExpectedYield(
      BigInt(Math.floor(parseFloat(loan.principal) * 1e6)),
      loan.riskScore
    );

    return successResponse({
      ...loan,
      riskRating: yieldInfo.rating,
      expectedYieldPercentage: yieldInfo.yieldBps / 100
    });
  } catch (error) {
    return handleError(error);
  }
}
