import { NextRequest } from 'next/server';
import { extractTokenFromHeader, getUserFromToken, permissions } from '@/lib/auth';
import { 
  successResponse, 
  paginatedResponse,
  unauthorizedResponse,
  forbiddenResponse,
  handleError 
} from '@/lib/api-response';
import { getAuditLogs } from '@/services/audit';
import { AuditAction } from '@prisma/client';

// GET /api/audit-logs - Get audit logs (Admin/Auditor only)
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

    // Only admin and auditor can view audit logs
    if (!['ADMIN', 'AUDITOR'].includes(user.role)) {
      return forbiddenResponse('You do not have permission to view audit logs');
    }

    const { searchParams } = new URL(request.url);
    
    const options = {
      userId: searchParams.get('userId') || undefined,
      invoiceId: searchParams.get('invoiceId') || undefined,
      entityType: searchParams.get('entityType') || undefined,
      action: searchParams.get('action') as AuditAction | undefined,
      dateFrom: searchParams.get('dateFrom') ? new Date(searchParams.get('dateFrom')!) : undefined,
      dateTo: searchParams.get('dateTo') ? new Date(searchParams.get('dateTo')!) : undefined,
      page: parseInt(searchParams.get('page') || '1'),
      limit: parseInt(searchParams.get('limit') || '50'),
    };

    const { logs, total, page, limit } = await getAuditLogs(options);

    return paginatedResponse(logs, { page, limit, total });
  } catch (error) {
    return handleError(error);
  }
}
