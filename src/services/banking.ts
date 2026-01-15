/**
 * Banking Service - Virtual Account Number (VAN) Management
 * 
 * Provides VAN generation and assignment for invoice settlement.
 * VANs enable automated payment routing and reconciliation.
 * 
 * VAN Format: vLIQ-[SELLER_PREFIX]-[YYMMDD]-[SEQUENCE]
 * Example: vLIQ-ACME-260115-001
 */

import { prisma } from '../lib/prisma';

export interface VanAssignmentResult {
  invoiceId: string;
  invoiceNumber: string;
  vanId: string;
  sellerName: string;
  assignedAt: Date;
}

export interface VanGenerationResult {
  vanId: string;
  sellerPrefix: string;
  dateComponent: string;
  sequence: string;
}

/**
 * Banking Service for VAN management
 */
export class BankingService {
  /**
   * Generate a deterministic Virtual Account Number for an invoice
   * 
   * Format: vLIQ-[SELLER_PREFIX]-[YYMMDD]-[SEQUENCE]
   * - SELLER_PREFIX: First 4 uppercase letters of seller name
   * - YYMMDD: Date component for uniqueness
   * - SEQUENCE: 3-digit sequence number for same seller/date combinations
   * 
   * @param invoiceId - The invoice ID to generate VAN for
   * @returns VAN generation result with the new VAN ID
   */
  static async generateVan(invoiceId: string): Promise<VanGenerationResult> {
    // Fetch the invoice with seller information
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        seller: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!invoice) {
      throw new Error(`Invoice not found: ${invoiceId}`);
    }

    if (!invoice.seller) {
      throw new Error(`Invoice has no associated seller: ${invoiceId}`);
    }

    // Generate seller prefix (first 4 uppercase letters, alphanumeric only)
    const sellerPrefix = invoice.seller.name
      .replace(/[^a-zA-Z0-9]/g, '') // Remove non-alphanumeric
      .toUpperCase()
      .slice(0, 4)
      .padEnd(4, 'X'); // Pad with X if less than 4 chars

    // Generate date component (YYMMDD)
    const now = new Date();
    const dateComponent = [
      now.getFullYear().toString().slice(-2),
      (now.getMonth() + 1).toString().padStart(2, '0'),
      now.getDate().toString().padStart(2, '0'),
    ].join('');

    // Find existing VANs with same prefix and date to determine sequence
    const basePattern = `vLIQ-${sellerPrefix}-${dateComponent}-`;
    
    const existingVans = await prisma.invoice.findMany({
      where: {
        vanId: {
          startsWith: basePattern,
        },
      },
      select: {
        vanId: true,
      },
      orderBy: {
        vanId: 'desc',
      },
    });

    // Determine next sequence number
    let nextSequence = 1;
    if (existingVans.length > 0 && existingVans[0].vanId) {
      const lastVan = existingVans[0].vanId;
      const lastSequence = parseInt(lastVan.split('-').pop() || '0', 10);
      nextSequence = lastSequence + 1;
    }

    const sequence = nextSequence.toString().padStart(3, '0');
    const vanId = `${basePattern}${sequence}`;

    // Verify no collision (defensive check)
    const collision = await prisma.invoice.findFirst({
      where: { vanId },
    });

    if (collision) {
      // Extremely rare: increment sequence and retry
      const retrySequence = (nextSequence + 1).toString().padStart(3, '0');
      const retryVanId = `${basePattern}${retrySequence}`;
      
      // Check again
      const retryCollision = await prisma.invoice.findFirst({
        where: { vanId: retryVanId },
      });

      if (retryCollision) {
        throw new Error(`VAN collision detected and retry failed: ${vanId}`);
      }

      return {
        vanId: retryVanId,
        sellerPrefix,
        dateComponent,
        sequence: retrySequence,
      };
    }

    return {
      vanId,
      sellerPrefix,
      dateComponent,
      sequence,
    };
  }

  /**
   * Assign a VAN to an invoice and persist to database
   * 
   * @param invoiceId - The invoice ID to assign VAN to
   * @returns VAN assignment result with full details
   */
  static async assignVanToInvoice(invoiceId: string): Promise<VanAssignmentResult> {
    // Check if invoice already has a VAN
    const existingInvoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        invoiceNumber: true,
        vanId: true,
        status: true,
        seller: {
          select: { name: true },
        },
      },
    });

    if (!existingInvoice) {
      throw new Error(`Invoice not found: ${invoiceId}`);
    }

    // If VAN already assigned, return existing
    if (existingInvoice.vanId) {
      console.log(`VAN already assigned to invoice ${invoiceId}: ${existingInvoice.vanId}`);
      return {
        invoiceId: existingInvoice.id,
        invoiceNumber: existingInvoice.invoiceNumber,
        vanId: existingInvoice.vanId,
        sellerName: existingInvoice.seller?.name || 'Unknown',
        assignedAt: new Date(),
      };
    }

    // Generate new VAN
    const vanResult = await this.generateVan(invoiceId);

    // Update invoice with VAN
    const updatedInvoice = await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        vanId: vanResult.vanId,
      },
      include: {
        seller: {
          select: { name: true },
        },
      },
    });

    console.log(`VAN assigned to invoice ${invoiceId}: ${vanResult.vanId}`);

    return {
      invoiceId: updatedInvoice.id,
      invoiceNumber: updatedInvoice.invoiceNumber,
      vanId: vanResult.vanId,
      sellerName: updatedInvoice.seller?.name || 'Unknown',
      assignedAt: new Date(),
    };
  }

  /**
   * Find an invoice by its Virtual Account Number
   * Used by Settlement Webhook to route incoming payments
   * 
   * @param vanId - The VAN to look up
   * @returns Invoice details or null if not found
   */
  static async getInvoiceByVan(vanId: string) {
    const invoice = await prisma.invoice.findFirst({
      where: { vanId },
      include: {
        seller: {
          select: {
            id: true,
            name: true,
            walletAddress: true,
          },
        },
        buyer: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!invoice) {
      return null;
    }

    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      vanId: invoice.vanId,
      totalAmount: invoice.totalAmount,
      currency: invoice.currency,
      status: invoice.status,
      paymentStatus: invoice.paymentStatus,
      dueDate: invoice.dueDate,
      seller: invoice.seller,
      buyer: invoice.buyer,
      documentHash: invoice.documentHash,
      pdfUrl: invoice.pdfUrl,
    };
  }

  /**
   * Validate VAN format
   * 
   * @param vanId - The VAN to validate
   * @returns True if valid format
   */
  static isValidVanFormat(vanId: string): boolean {
    // Format: vLIQ-XXXX-YYMMDD-NNN
    const vanRegex = /^vLIQ-[A-Z0-9]{4}-\d{6}-\d{3}$/;
    return vanRegex.test(vanId);
  }

  /**
   * Parse VAN components
   * 
   * @param vanId - The VAN to parse
   * @returns Parsed components or null if invalid
   */
  static parseVan(vanId: string): {
    prefix: string;
    sellerCode: string;
    date: string;
    sequence: string;
  } | null {
    if (!this.isValidVanFormat(vanId)) {
      return null;
    }

    const parts = vanId.split('-');
    return {
      prefix: parts[0], // vLIQ
      sellerCode: parts[1], // ACME
      date: parts[2], // 260115
      sequence: parts[3], // 001
    };
  }

  /**
   * Get all invoices for a seller by VAN prefix
   * Useful for settlement reports
   * 
   * @param sellerPrefix - The 4-character seller prefix
   * @returns List of invoices with matching VANs
   */
  static async getInvoicesBySellerPrefix(sellerPrefix: string) {
    const pattern = `vLIQ-${sellerPrefix.toUpperCase()}-`;
    
    return prisma.invoice.findMany({
      where: {
        vanId: {
          startsWith: pattern,
        },
      },
      include: {
        seller: {
          select: { id: true, name: true },
        },
        buyer: {
          select: { id: true, name: true },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}

// Export singleton-style access
export const bankingService = BankingService;
