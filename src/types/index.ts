import { User, Company, Invoice, InvoiceItem, Payment, BlockchainTransaction, AuditLog } from '@prisma/client';

// User types
export type UserWithCompany = User & {
  company: Company | null;
};

export type SafeUser = Omit<User, 'password'>;

// Invoice types
export type InvoiceWithRelations = Invoice & {
  items: InvoiceItem[];
  seller: Company;
  buyer: Company;
  createdBy: SafeUser;
  blockchainTx: BlockchainTransaction | null;
  payments: Payment[];
};

export type InvoiceListItem = Invoice & {
  seller: Pick<Company, 'id' | 'name'>;
  buyer: Pick<Company, 'id' | 'name'>;
  _count: {
    items: number;
    payments: number;
  };
};

// Company types
export type CompanyWithCounts = Company & {
  _count: {
    users: number;
    soldInvoices: number;
    boughtInvoices: number;
  };
};

// Blockchain types
export interface BlockchainVerificationResult {
  isValid: boolean;
  storedHash?: string;
  currentHash?: string;
  timestamp?: Date;
  recorder?: string;
  message: string;
}

export interface BlockchainRecordResult {
  success: boolean;
  transactionHash?: string;
  invoiceHash?: string;
  error?: string;
}

// API Response types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  errors?: Record<string, string[]>;
  message?: string;
  pagination?: PaginationInfo;
}

export interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// Auth types
export interface LoginResponse {
  user: SafeUser & { company: Pick<Company, 'id' | 'name'> | null };
  token: string;
}

export interface JWTPayload {
  userId: string;
  email: string;
  role: string;
  companyId: string | null;
}

// Dashboard statistics
export interface DashboardStats {
  invoices: {
    total: number;
    byStatus: Record<string, number>;
    byPaymentStatus: Record<string, number>;
    totalAmount: number;
  };
  recentActivity: AuditLog[];
}

// Export report types
export interface InvoiceExportData {
  invoiceNumber: string;
  seller: string;
  buyer: string;
  issueDate: string;
  dueDate: string;
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  status: string;
  paymentStatus: string;
  items: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    amount: number;
  }>;
}
