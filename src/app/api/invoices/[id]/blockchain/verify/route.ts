import { NextRequest } from 'next/server';
import { extractTokenFromHeader, getUserFromToken, permissions } from '@/lib/auth';
import { 
  successResponse, 
  unauthorizedResponse,
  forbiddenResponse,
  notFoundResponse,
  handleError 
} from '@/lib/api-response';
import { blockchainService } from '@/services/blockchain';
import { getInvoiceById } from '@/services/invoice';
import { createAuditLog } from '@/services/audit';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/invoices/[id]/blockchain/verify - Verify invoice on blockchain
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

    // Check permission
    if (!permissions.canVerifyBlockchain(user.role)) {
      return forbiddenResponse('You do not have permission to verify invoices');
    }

    // Get invoice
    const invoice = await getInvoiceById(id);
    if (!invoice) {
      return notFoundResponse('Invoice not found');
    }

    // Verify on blockchain
    const verificationResult = await blockchainService.verifyInvoice(id);

    // Create audit log
    const ipAddress = request.headers.get('x-forwarded-for') || 'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    await createAuditLog({
      userId: user.id,
      invoiceId: id,
      action: 'VERIFY',
      entityType: 'Invoice',
      entityId: id,
      newValue: { 
        verificationResult: verificationResult.isValid,
        message: verificationResult.message,
      },
      ipAddress,
      userAgent,
    });

    return successResponse({
      invoiceId: id,
      invoiceNumber: invoice.invoiceNumber,
      ...verificationResult,
    });
  } catch (error) {
    return handleError(error);
  }
}
