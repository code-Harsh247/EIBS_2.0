import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { extractTokenFromHeader, getUserFromToken, permissions } from '@/lib/auth';
import { createPaymentSchema } from '@/lib/validations';
import { 
  successResponse, 
  paginatedResponse,
  errorResponse, 
  unauthorizedResponse,
  forbiddenResponse,
  notFoundResponse,
  handleError,
  handleZodError 
} from '@/lib/api-response';
import { getInvoiceById, updatePaymentStatus } from '@/services/invoice';
import { createAuditLog } from '@/services/audit';
import { ZodError } from 'zod';
import { PaymentStatus, Prisma } from '@prisma/client';

// GET /api/payments - List payments
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

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const invoiceId = searchParams.get('invoiceId');

    const where: Prisma.PaymentWhereInput = {};

    if (invoiceId) {
      where.invoiceId = invoiceId;
    }

    // Filter by company if not admin
    if (!['ADMIN', 'AUDITOR'].includes(user.role) && user.companyId) {
      where.invoice = {
        OR: [
          { sellerId: user.companyId },
          { buyerId: user.companyId },
        ],
      };
    }

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        include: {
          invoice: {
            select: {
              id: true,
              invoiceNumber: true,
              totalAmount: true,
              seller: { select: { name: true } },
              buyer: { select: { name: true } },
            },
          },
        },
        orderBy: { paymentDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.payment.count({ where }),
    ]);

    return paginatedResponse(payments, { page, limit, total });
  } catch (error) {
    return handleError(error);
  }
}

// POST /api/payments - Record payment
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
      return forbiddenResponse('You do not have permission to record payments');
    }

    const body = await request.json();
    const validatedData = createPaymentSchema.parse(body);

    // Get invoice
    const invoice = await getInvoiceById(validatedData.invoiceId);
    if (!invoice) {
      return notFoundResponse('Invoice not found');
    }

    // Check if user has access to this invoice
    if (user.companyId !== invoice.sellerId && user.companyId !== invoice.buyerId) {
      return forbiddenResponse('You do not have access to this invoice');
    }

    // Calculate total payments including this one
    const existingPayments = await prisma.payment.aggregate({
      where: { invoiceId: validatedData.invoiceId },
      _sum: { amount: true },
    });

    const totalPaid = (existingPayments._sum.amount?.toNumber() || 0) + validatedData.amount;
    const invoiceTotal = invoice.totalAmount.toNumber();

    // Determine new payment status
    let newPaymentStatus: PaymentStatus;
    if (totalPaid >= invoiceTotal) {
      newPaymentStatus = PaymentStatus.PAID;
    } else if (totalPaid > 0) {
      newPaymentStatus = PaymentStatus.PARTIAL;
    } else {
      newPaymentStatus = PaymentStatus.UNPAID;
    }

    // Create payment and update invoice status
    const [payment] = await prisma.$transaction([
      prisma.payment.create({
        data: {
          invoiceId: validatedData.invoiceId,
          amount: validatedData.amount,
          paymentDate: validatedData.paymentDate,
          paymentMethod: validatedData.paymentMethod,
          reference: validatedData.reference,
          notes: validatedData.notes,
        },
        include: {
          invoice: {
            select: {
              invoiceNumber: true,
            },
          },
        },
      }),
      prisma.invoice.update({
        where: { id: validatedData.invoiceId },
        data: { paymentStatus: newPaymentStatus },
      }),
    ]);

    // Create audit log
    const ipAddress = request.headers.get('x-forwarded-for') || 'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    await createAuditLog({
      userId: user.id,
      invoiceId: validatedData.invoiceId,
      action: 'CREATE',
      entityType: 'Payment',
      entityId: payment.id,
      newValue: { 
        amount: validatedData.amount, 
        paymentStatus: newPaymentStatus,
      },
      ipAddress,
      userAgent,
    });

    return successResponse(payment, 'Payment recorded successfully', 201);
  } catch (error) {
    if (error instanceof ZodError) {
      return handleZodError(error);
    }
    return handleError(error);
  }
}
