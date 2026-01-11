import { prisma } from '../lib/prisma';
import { Prisma, InvoiceStatus, PaymentStatus } from '@prisma/client';
import { CreateInvoiceInput, UpdateInvoiceInput, InvoiceFilterInput } from '../lib/validations';

// Generate unique invoice number
export async function generateInvoiceNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  
  const lastInvoice = await prisma.invoice.findFirst({
    where: {
      invoiceNumber: {
        startsWith: prefix,
      },
    },
    orderBy: {
      invoiceNumber: 'desc',
    },
  });

  let nextNumber = 1;
  if (lastInvoice) {
    const lastNumber = parseInt(lastInvoice.invoiceNumber.split('-').pop() || '0', 10);
    nextNumber = lastNumber + 1;
  }

  return `${prefix}${nextNumber.toString().padStart(4, '0')}`;
}

// Calculate invoice totals
export function calculateInvoiceTotals(items: Array<{
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  productCode?: string;
  unit?: string;
}>, discountAmount: number = 0) {
  let subtotal = 0;
  let taxAmount = 0;

  const calculatedItems = items.map((item) => {
    const lineAmount = item.quantity * item.unitPrice;
    const lineTax = lineAmount * (item.taxRate / 100);
    subtotal += lineAmount;
    taxAmount += lineTax;
    
    return {
      ...item,
      amount: lineAmount + lineTax,
    };
  });

  const totalAmount = subtotal + taxAmount - discountAmount;

  return {
    items: calculatedItems,
    subtotal,
    taxAmount,
    discountAmount,
    totalAmount,
  };
}

// Create invoice
export async function createInvoice(
  input: CreateInvoiceInput,
  sellerId: string,
  createdById: string
) {
  const invoiceNumber = input.invoiceNumber || await generateInvoiceNumber();
  
  const { items, subtotal, taxAmount, discountAmount, totalAmount } = calculateInvoiceTotals(
    input.items,
    input.discountAmount
  );

  return prisma.invoice.create({
    data: {
      invoiceNumber,
      sellerId,
      buyerId: input.buyerId,
      createdById,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      currency: input.currency,
      notes: input.notes,
      terms: input.terms,
      subtotal,
      taxAmount,
      discountAmount,
      totalAmount,
      items: {
        create: items.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          taxRate: item.taxRate,
          amount: item.amount,
          productCode: item.productCode,
          unit: item.unit,
        })),
      },
    },
    include: {
      items: true,
      seller: true,
      buyer: true,
      createdBy: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  });
}

// Get invoice by ID
export async function getInvoiceById(id: string) {
  return prisma.invoice.findUnique({
    where: { id },
    include: {
      items: true,
      seller: true,
      buyer: true,
      createdBy: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
        },
      },
      blockchainTx: true,
      payments: true,
    },
  });
}

// List invoices with filtering
export async function listInvoices(
  filters: InvoiceFilterInput,
  companyId?: string,
  viewAll: boolean = false
) {
  const where: Prisma.InvoiceWhereInput = {};

  // Apply company filter for non-admin users
  if (!viewAll && companyId) {
    where.OR = [
      { sellerId: companyId },
      { buyerId: companyId },
    ];
  }

  // Apply filters
  if (filters.status) where.status = filters.status;
  if (filters.paymentStatus) where.paymentStatus = filters.paymentStatus;
  if (filters.sellerId) where.sellerId = filters.sellerId;
  if (filters.buyerId) where.buyerId = filters.buyerId;

  // Date range filter
  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {};
    if (filters.dateFrom) where.createdAt.gte = new Date(filters.dateFrom);
    if (filters.dateTo) where.createdAt.lte = new Date(filters.dateTo);
  }

  // Search filter
  if (filters.search) {
    where.OR = [
      { invoiceNumber: { contains: filters.search, mode: 'insensitive' } },
      { seller: { name: { contains: filters.search, mode: 'insensitive' } } },
      { buyer: { name: { contains: filters.search, mode: 'insensitive' } } },
    ];
  }

  const orderBy: Prisma.InvoiceOrderByWithRelationInput = {
    [filters.sortBy]: filters.sortOrder,
  };

  const [invoices, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      include: {
        seller: {
          select: { id: true, name: true },
        },
        buyer: {
          select: { id: true, name: true },
        },
        _count: {
          select: { items: true, payments: true },
        },
      },
      orderBy,
      skip: (filters.page - 1) * filters.limit,
      take: filters.limit,
    }),
    prisma.invoice.count({ where }),
  ]);

  return { invoices, total, page: filters.page, limit: filters.limit };
}

// Update invoice
export async function updateInvoice(id: string, input: UpdateInvoiceInput) {
  const updateData: Prisma.InvoiceUpdateInput = {};

  if (input.buyerId) updateData.buyer = { connect: { id: input.buyerId } };
  if (input.issueDate) updateData.issueDate = input.issueDate;
  if (input.dueDate) updateData.dueDate = input.dueDate;
  if (input.currency) updateData.currency = input.currency;
  if (input.notes !== undefined) updateData.notes = input.notes;
  if (input.terms !== undefined) updateData.terms = input.terms;
  if (input.status) updateData.status = input.status;

  // If items are being updated, recalculate totals
  if (input.items) {
    const { items, subtotal, taxAmount, discountAmount, totalAmount } = calculateInvoiceTotals(
      input.items,
      input.discountAmount
    );

    // Delete existing items and create new ones
    await prisma.invoiceItem.deleteMany({ where: { invoiceId: id } });

    return prisma.invoice.update({
      where: { id },
      data: {
        ...updateData,
        subtotal,
        taxAmount,
        discountAmount: discountAmount ?? 0,
        totalAmount,
        items: {
          create: items.map((item) => ({
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            taxRate: item.taxRate,
            amount: item.amount,
            productCode: item.productCode,
            unit: item.unit,
          })),
        },
      },
      include: {
        items: true,
        seller: true,
        buyer: true,
      },
    });
  }

  return prisma.invoice.update({
    where: { id },
    data: updateData,
    include: {
      items: true,
      seller: true,
      buyer: true,
    },
  });
}

// Delete invoice
export async function deleteInvoice(id: string) {
  // Only allow deletion of draft invoices
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    select: { status: true },
  });

  if (!invoice) {
    throw new Error('Invoice not found');
  }

  if (invoice.status !== InvoiceStatus.DRAFT) {
    throw new Error('Only draft invoices can be deleted');
  }

  return prisma.invoice.delete({ where: { id } });
}

// Update invoice status
export async function updateInvoiceStatus(id: string, status: InvoiceStatus) {
  return prisma.invoice.update({
    where: { id },
    data: { status },
  });
}

// Update payment status
export async function updatePaymentStatus(id: string, paymentStatus: PaymentStatus) {
  return prisma.invoice.update({
    where: { id },
    data: { paymentStatus },
  });
}

// Get invoice statistics
export async function getInvoiceStats(companyId?: string) {
  const where: Prisma.InvoiceWhereInput = companyId
    ? { OR: [{ sellerId: companyId }, { buyerId: companyId }] }
    : {};

  const [total, byStatus, byPaymentStatus, totalAmount] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.groupBy({
      by: ['status'],
      where,
      _count: true,
    }),
    prisma.invoice.groupBy({
      by: ['paymentStatus'],
      where,
      _count: true,
    }),
    prisma.invoice.aggregate({
      where,
      _sum: { totalAmount: true },
    }),
  ]);

  return {
    total,
    byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
    byPaymentStatus: Object.fromEntries(byPaymentStatus.map((s) => [s.paymentStatus, s._count])),
    totalAmount: totalAmount._sum.totalAmount || 0,
  };
}
