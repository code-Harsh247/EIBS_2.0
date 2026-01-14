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

const previewWithdrawSchema = z.object({
  amount: z.string().min(1, 'Amount is required')
});

// POST /api/pool/withdraw/preview - Preview withdraw (shares to burn)
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
    const validation = previewWithdrawSchema.safeParse(body);

    if (!validation.success) {
      return errorResponse(validation.error.errors[0].message, 400);
    }

    const { amount } = validation.data;
    const preview = await liquidityPoolService.previewWithdraw(amount);

    return successResponse({
      withdrawAmount: amount,
      sharesBurned: preview.shares,
      currency: 'USDC',
      shareToken: 'lUSDC'
    });
  } catch (error) {
    return handleError(error);
  }
}
