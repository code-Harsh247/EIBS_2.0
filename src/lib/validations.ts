import { z } from 'zod';

// ============================================
// AUTH SCHEMAS
// ============================================

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

export const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  companyId: z.string().optional(),
});

export const updateProfileSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
});

// ============================================
// COMPANY SCHEMAS
// ============================================

export const createCompanySchema = z.object({
  name: z.string().min(1, 'Company name is required').max(255),
  registrationNo: z.string().min(1, 'Registration number is required'),
  taxId: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  postalCode: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  website: z.string().url().optional(),
  walletAddress: z.string().optional(),
});

export const updateCompanySchema = createCompanySchema.partial();

// ============================================
// INVOICE SCHEMAS
// ============================================

export const invoiceItemSchema = z.object({
  description: z.string().min(1, 'Description is required'),
  quantity: z.number().positive('Quantity must be positive'),
  unitPrice: z.number().nonnegative('Unit price must be non-negative'),
  taxRate: z.number().min(0).max(100).default(0),
  productCode: z.string().optional(),
  unit: z.string().default('pcs'),
});

export const createInvoiceSchema = z.object({
  invoiceNumber: z.string().optional(), // Auto-generated if not provided
  buyerId: z.string().min(1, 'Buyer is required'),
  issueDate: z.string().or(z.date()).transform((val) => new Date(val)),
  dueDate: z.string().or(z.date()).transform((val) => new Date(val)),
  currency: z.string().default('USD'),
  notes: z.string().optional(),
  terms: z.string().optional(),
  discountAmount: z.number().nonnegative().default(0),
  items: z.array(invoiceItemSchema).min(1, 'At least one item is required'),
});

export const updateInvoiceSchema = z.object({
  buyerId: z.string().optional(),
  issueDate: z.string().or(z.date()).transform((val) => new Date(val)).optional(),
  dueDate: z.string().or(z.date()).transform((val) => new Date(val)).optional(),
  currency: z.string().optional(),
  notes: z.string().optional(),
  terms: z.string().optional(),
  discountAmount: z.number().nonnegative().optional(),
  status: z.enum(['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'ARCHIVED']).optional(),
  items: z.array(invoiceItemSchema).optional(),
});

export const invoiceFilterSchema = z.object({
  status: z.enum(['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'ARCHIVED']).optional(),
  paymentStatus: z.enum(['UNPAID', 'PARTIAL', 'PAID', 'OVERDUE', 'REFUNDED']).optional(),
  sellerId: z.string().optional(),
  buyerId: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  search: z.string().optional(),
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
  sortBy: z.enum(['createdAt', 'invoiceNumber', 'totalAmount', 'dueDate']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// ============================================
// PAYMENT SCHEMAS
// ============================================

export const createPaymentSchema = z.object({
  invoiceId: z.string().min(1, 'Invoice ID is required'),
  amount: z.number().positive('Amount must be positive'),
  paymentDate: z.string().or(z.date()).transform((val) => new Date(val)),
  paymentMethod: z.string().optional(),
  reference: z.string().optional(),
  notes: z.string().optional(),
});

// ============================================
// BLOCKCHAIN SCHEMAS
// ============================================

export const verifyInvoiceSchema = z.object({
  invoiceId: z.string().min(1, 'Invoice ID is required'),
});

export const blockchainRecordSchema = z.object({
  invoiceId: z.string().min(1, 'Invoice ID is required'),
  invoiceHash: z.string().min(1, 'Invoice hash is required'),
});

// ============================================
// USER MANAGEMENT SCHEMAS
// ============================================

export const createUserSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  role: z.enum(['ADMIN', 'USER', 'ACCOUNTANT', 'AUDITOR']).default('USER'),
  companyId: z.string().optional(),
});

export const updateUserSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  role: z.enum(['ADMIN', 'USER', 'ACCOUNTANT', 'AUDITOR']).optional(),
  companyId: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

// Type exports
export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>;
export type InvoiceFilterInput = z.infer<typeof invoiceFilterSchema>;
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
