import { NextRequest } from 'next/server';
import { extractTokenFromHeader, getUserFromToken, permissions } from '@/lib/auth';
import { updateInvoiceSchema } from '@/lib/validations';
import { 
  successResponse, 
  errorResponse, 
  unauthorizedResponse,
  forbiddenResponse,
  notFoundResponse,
  handleError,
  handleZodError 
} from '@/lib/api-response';
import { getInvoiceById, updateInvoice, deleteInvoice } from '@/services/invoice';
import { createAuditLog } from '@/services/audit';
import { ZodError } from 'zod';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/invoices/[id] - Get invoice by ID
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

    const invoice = await getInvoiceById(id);

    if (!invoice) {
      return notFoundResponse('Invoice not found');
    }

    // Check access permission
    const canViewAll = permissions.canViewAllInvoices(user.role);
    const isOwner = user.companyId && 
      (invoice.sellerId === user.companyId || invoice.buyerId === user.companyId);

    if (!canViewAll && !isOwner) {
      return forbiddenResponse('You do not have access to this invoice');
    }

    // Create audit log for viewing
    const ipAddress = request.headers.get('x-forwarded-for') || 'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    await createAuditLog({
      userId: user.id,
      invoiceId: invoice.id,
      action: 'VIEW',
      entityType: 'Invoice',
      entityId: invoice.id,
      ipAddress,
      userAgent,
    });

    return successResponse(invoice);
  } catch (error) {
    return handleError(error);
  }
}

// PATCH /api/invoices/[id] - Update invoice
export async function PATCH(request: NextRequest, { params }: RouteParams) {
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

    // Get existing invoice
    const existingInvoice = await getInvoiceById(id);
    if (!existingInvoice) {
      return notFoundResponse('Invoice not found');
    }

    // Check permission - only seller company can update
    if (!permissions.canCreateInvoice(user.role)) {
      return forbiddenResponse('You do not have permission to update invoices');
    }

    if (user.companyId !== existingInvoice.sellerId) {
      return forbiddenResponse('You can only update invoices from your company');
    }

    // Can't update non-draft/non-pending invoices
    if (!['DRAFT', 'PENDING'].includes(existingInvoice.status)) {
      return errorResponse('Cannot update invoice with status: ' + existingInvoice.status, 400);
    }

    const body = await request.json();
    const validatedData = updateInvoiceSchema.parse(body);

    // Store old values for audit
    const oldValues = {
      status: existingInvoice.status,
      totalAmount: existingInvoice.totalAmount,
    };

    // Update invoice
    const updatedInvoice = await updateInvoice(id, validatedData);

    // Create audit log
    const ipAddress = request.headers.get('x-forwarded-for') || 'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    await createAuditLog({
      userId: user.id,
      invoiceId: id,
      action: 'UPDATE',
      entityType: 'Invoice',
      entityId: id,
      oldValue: oldValues,
      newValue: validatedData,
      ipAddress,
      userAgent,
    });

    return successResponse(updatedInvoice, 'Invoice updated successfully');
  } catch (error) {
    if (error instanceof ZodError) {
      return handleZodError(error);
    }
    return handleError(error);
  }
}

// DELETE /api/invoices/[id] - Delete invoice
export async function DELETE(request: NextRequest, { params }: RouteParams) {
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

    // Get existing invoice
    const existingInvoice = await getInvoiceById(id);
    if (!existingInvoice) {
      return notFoundResponse('Invoice not found');
    }

    // Check permission
    if (!permissions.canDeleteInvoice(user.role)) {
      return forbiddenResponse('You do not have permission to delete invoices');
    }

    try {
      await deleteInvoice(id);
    } catch (error) {
      if (error instanceof Error) {
        return errorResponse(error.message, 400);
      }
      throw error;
    }

    // Create audit log
    const ipAddress = request.headers.get('x-forwarded-for') || 'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    await createAuditLog({
      userId: user.id,
      invoiceId: id,
      action: 'DELETE',
      entityType: 'Invoice',
      entityId: id,
      oldValue: { invoiceNumber: existingInvoice.invoiceNumber },
      ipAddress,
      userAgent,
    });

    return successResponse(null, 'Invoice deleted successfully');
  } catch (error) {
    return handleError(error);
  }
}
