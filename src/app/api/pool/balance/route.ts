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

const balanceSchema = z.object({
  address: z.string().min(1, 'Wallet address is required')
});

// POST /api/pool/balance - Get LP balance
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
    const validation = balanceSchema.safeParse(body);

    if (!validation.success) {
      return errorResponse(validation.error.errors[0].message, 400);
    }

    const { address } = validation.data;
    const balance = await liquidityPoolService.getLPBalance(address);

    return successResponse({
      address,
      ...balance,
      shareToken: 'lUSDC',
      currency: 'USDC'
    });
  } catch (error) {
    return handleError(error);
  }
}
