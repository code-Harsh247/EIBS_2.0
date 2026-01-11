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
import { getInvoiceById, updateInvoiceStatus } from '@/services/invoice';
import { createAuditLog } from '@/services/audit';
import { InvoiceStatus } from '@prisma/client';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/invoices/[id]/approve - Approve invoice
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
    if (!permissions.canApproveInvoice(user.role)) {
      return forbiddenResponse('You do not have permission to approve invoices');
    }

    // Get existing invoice
    const existingInvoice = await getInvoiceById(id);
    if (!existingInvoice) {
      return notFoundResponse('Invoice not found');
    }

    // Can only approve pending invoices
    if (existingInvoice.status !== InvoiceStatus.PENDING) {
      return errorResponse('Only pending invoices can be approved', 400);
    }

    // Update status
    const updatedInvoice = await updateInvoiceStatus(id, InvoiceStatus.APPROVED);

    // Create audit log
    const ipAddress = request.headers.get('x-forwarded-for') || 'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    await createAuditLog({
      userId: user.id,
      invoiceId: id,
      action: 'APPROVE',
      entityType: 'Invoice',
      entityId: id,
      oldValue: { status: existingInvoice.status },
      newValue: { status: InvoiceStatus.APPROVED },
      ipAddress,
      userAgent,
    });

    return successResponse(updatedInvoice, 'Invoice approved successfully');
  } catch (error) {
    return handleError(error);
  }
}
