import { NextRequest } from 'next/server';
import { extractTokenFromHeader, getUserFromToken } from '@/lib/auth';
import { 
  successResponse, 
  unauthorizedResponse,
  notFoundResponse,
  handleError 
} from '@/lib/api-response';
import { blockchainService } from '@/services/blockchain';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/invoices/[id]/blockchain - Get blockchain transaction details
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

    // Get blockchain transaction details
    const transaction = await blockchainService.getTransactionDetails(id);

    if (!transaction) {
      return notFoundResponse('No blockchain record found for this invoice');
    }

    return successResponse(transaction);
  } catch (error) {
    return handleError(error);
  }
}
