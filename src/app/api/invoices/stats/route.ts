import { NextRequest } from 'next/server';
import { extractTokenFromHeader, getUserFromToken } from '@/lib/auth';
import { 
  successResponse, 
  unauthorizedResponse,
  handleError 
} from '@/lib/api-response';
import { getInvoiceStats } from '@/services/invoice';

// GET /api/invoices/stats - Get invoice statistics
export async function GET(request: NextRequest) {
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

    // Get stats based on user's role
    const viewAll = ['ADMIN', 'AUDITOR'].includes(user.role);
    const stats = await getInvoiceStats(viewAll ? undefined : user.companyId || undefined);

    return successResponse(stats);
  } catch (error) {
    return handleError(error);
  }
}
