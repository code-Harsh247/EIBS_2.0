import { NextRequest } from 'next/server';
import { extractTokenFromHeader, getUserFromToken, permissions } from '@/lib/auth';
import { 
  successResponse, 
  errorResponse, 
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

// POST /api/invoices/[id]/blockchain/record - Record invoice on blockchain
export async function POST(request: NextRequest, { params }: RouteParams) {
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
      return forbiddenResponse('You do not have permission to record invoices on blockchain');
    }

    // Get invoice
    const invoice = await getInvoiceById(id);
    if (!invoice) {
      return notFoundResponse('Invoice not found');
    }

    // Check if already recorded
    if (invoice.blockchainHash) {
      return errorResponse('Invoice has already been recorded on blockchain', 400);
    }

    // Only approved invoices can be recorded
    if (invoice.status !== 'APPROVED') {
      return errorResponse('Only approved invoices can be recorded on blockchain', 400);
    }

    // Record on blockchain
    const result = await blockchainService.recordInvoice(id);

    if (!result.success) {
      return errorResponse(result.error || 'Failed to record on blockchain', 500);
    }

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
        transactionHash: result.transactionHash,
        invoiceHash: result.invoiceHash,
      },
      ipAddress,
      userAgent,
    });

    return successResponse({
      invoiceId: id,
      transactionHash: result.transactionHash,
      invoiceHash: result.invoiceHash,
    }, 'Invoice recorded on blockchain successfully');
  } catch (error) {
    return handleError(error);
  }
}
