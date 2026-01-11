import { NextRequest } from 'next/server';
import { extractTokenFromHeader, getUserFromToken, permissions } from '@/lib/auth';
import { createInvoiceSchema, invoiceFilterSchema } from '@/lib/validations';
import { 
  successResponse, 
  paginatedResponse,
  errorResponse, 
  unauthorizedResponse,
  forbiddenResponse,
  handleError,
  handleZodError 
} from '@/lib/api-response';
import { createInvoice, listInvoices } from '@/services/invoice';
import { createAuditLog } from '@/services/audit';
import { ZodError } from 'zod';

// GET /api/invoices - List invoices
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

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const filters = invoiceFilterSchema.parse({
      status: searchParams.get('status') || undefined,
      paymentStatus: searchParams.get('paymentStatus') || undefined,
      sellerId: searchParams.get('sellerId') || undefined,
      buyerId: searchParams.get('buyerId') || undefined,
      dateFrom: searchParams.get('dateFrom') || undefined,
      dateTo: searchParams.get('dateTo') || undefined,
      search: searchParams.get('search') || undefined,
      page: searchParams.get('page') ? parseInt(searchParams.get('page')!) : 1,
      limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 20,
      sortBy: searchParams.get('sortBy') || 'createdAt',
      sortOrder: searchParams.get('sortOrder') || 'desc',
    });

    // Check if user can view all invoices
    const viewAll = permissions.canViewAllInvoices(user.role);
    
    const { invoices, total, page, limit } = await listInvoices(
      filters,
      user.companyId || undefined,
      viewAll
    );

    return paginatedResponse(invoices, { page, limit, total });
  } catch (error) {
    if (error instanceof ZodError) {
      return handleZodError(error);
    }
    return handleError(error);
  }
}

// POST /api/invoices - Create invoice
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

    // Check permission
    if (!permissions.canCreateInvoice(user.role)) {
      return forbiddenResponse('You do not have permission to create invoices');
    }

    if (!user.companyId) {
      return errorResponse('You must be associated with a company to create invoices', 400);
    }

    const body = await request.json();
    const validatedData = createInvoiceSchema.parse(body);

    // Create invoice
    const invoice = await createInvoice(
      validatedData,
      user.companyId,
      user.id
    );

    // Create audit log
    const ipAddress = request.headers.get('x-forwarded-for') || 'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    await createAuditLog({
      userId: user.id,
      invoiceId: invoice.id,
      action: 'CREATE',
      entityType: 'Invoice',
      entityId: invoice.id,
      newValue: { invoiceNumber: invoice.invoiceNumber, totalAmount: invoice.totalAmount },
      ipAddress,
      userAgent,
    });

    return successResponse(invoice, 'Invoice created successfully', 201);
  } catch (error) {
    if (error instanceof ZodError) {
      return handleZodError(error);
    }
    return handleError(error);
  }
}
