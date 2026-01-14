import { NextRequest } from 'next/server';
import { 
  successResponse, 
  handleError 
} from '@/lib/api-response';
import { liquidityPoolService } from '@/services/liquidity-pool';

// GET /api/pool - Get pool statistics
export async function GET(_request: NextRequest) {
  try {
    const stats = await liquidityPoolService.getPoolStats();
    const addresses = liquidityPoolService.getContractAddresses();

    return successResponse({
      stats,
      contracts: addresses
    });
  } catch (error) {
    return handleError(error);
  }
}
