import { NextRequest } from 'next/server';
import { extractTokenFromHeader, getUserFromToken } from '@/lib/auth';
import { 
  successResponse, 
  errorResponse,
  unauthorizedResponse,
  handleError 
} from '@/lib/api-response';
import { liquidityPoolService } from '@/services/liquidity-pool';
import { z } from 'zod';

const previewDepositSchema = z.object({
  amount: z.string().min(1, 'Amount is required')
});

// POST /api/pool/deposit/preview - Preview deposit (shares to receive)
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

    const body = await request.json();
    const validation = previewDepositSchema.safeParse(body);

    if (!validation.success) {
      return errorResponse(validation.error.errors[0].message, 400);
    }

    const { amount } = validation.data;
    const preview = await liquidityPoolService.previewDeposit(amount);

    return successResponse({
      depositAmount: amount,
      sharesReceived: preview.shares,
      currency: 'USDC',
      shareToken: 'lUSDC'
    });
  } catch (error) {
    return handleError(error);
  }
}
