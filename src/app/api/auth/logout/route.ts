import { NextRequest } from 'next/server';
import { 
  extractTokenFromHeader, 
  getUserFromToken, 
  invalidateSession 
} from '@/lib/auth';
import { 
  successResponse, 
  errorResponse, 
  unauthorizedResponse,
  handleError 
} from '@/lib/api-response';
import { createAuditLog } from '@/services/audit';

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

    // Invalidate session
    await invalidateSession(token);

    // Get request metadata
    const ipAddress = request.headers.get('x-forwarded-for') || 'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    // Create audit log
    await createAuditLog({
      userId: user.id,
      action: 'LOGOUT',
      entityType: 'User',
      entityId: user.id,
      ipAddress,
      userAgent,
    });

    return successResponse(null, 'Logout successful');
  } catch (error) {
    return handleError(error);
  }
}
