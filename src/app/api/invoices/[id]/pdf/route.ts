/**
 * Invoice PDF Upload and Retrieval API
 * 
 * POST /api/invoices/[id]/pdf - Upload PDF and generate signed documentHash
 * GET /api/invoices/[id]/pdf - Get signed URL for PDF download
 * DELETE /api/invoices/[id]/pdf - Remove PDF from invoice
 */

import { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/api-response';
import { extractTokenFromHeader, getUserFromToken, permissions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createAuditLog } from '@/services/audit';
import { ipfsService, PrivateInvoiceData } from '@/services/ipfs';
import { blockchainService } from '@/services/blockchain';
import {
  uploadPdfToStorage,
  getSignedPdfUrl,
  deletePdfFromStorage,
  getInvoicePdfPath,
  isSupabaseConfigured,
} from '@/lib/supabase';

// Max file size: 10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// Allowed MIME types
const ALLOWED_MIME_TYPES = ['application/pdf'];

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/invoices/[id]/pdf
 * Upload PDF, store in Supabase, generate documentHash with PDF, sign it
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;

    // Authentication
    const token = extractTokenFromHeader(request.headers.get('authorization'));
    if (!token) {
      return errorResponse('Authentication required', 401);
    }

    const user = await getUserFromToken(token);
    if (!user) {
      return errorResponse('Invalid or expired token', 401);
    }

    // Check permission
    if (!permissions.canCreateInvoice(user.role)) {
      return errorResponse('You do not have permission to upload invoice PDFs', 403);
    }

    // Check Supabase configuration
    if (!isSupabaseConfigured()) {
      return errorResponse('Storage service is not configured', 503);
    }

    // Get invoice with items
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        seller: { select: { id: true, name: true, walletAddress: true } },
        buyer: { select: { id: true, name: true, walletAddress: true } },
        items: true,
      },
    });

    if (!invoice) {
      return errorResponse('Invoice not found', 404);
    }

    // Check ownership for non-admin users
    if (user.role !== 'ADMIN' && invoice.createdById !== user.id) {
      return errorResponse('You do not have permission to modify this invoice', 403);
    }

    // Parse multipart form data
    const formData = await request.formData();
    const file = formData.get('pdf') as File | null;
    const riskScoreStr = formData.get('riskScore') as string | null;

    if (!file) {
      return errorResponse('No PDF file provided', 400);
    }

    // Validate file type
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return errorResponse(`Invalid file type. Only PDF files are allowed. Received: ${file.type}`, 400);
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return errorResponse(`File size exceeds maximum allowed (${MAX_FILE_SIZE / 1024 / 1024}MB)`, 400);
    }

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const pdfBuffer = Buffer.from(arrayBuffer);

    // Generate storage path
    const storagePath = getInvoicePdfPath(id, file.name);

    // Upload to Supabase Storage
    const uploadResult = await uploadPdfToStorage(pdfBuffer, storagePath);
    if (!uploadResult.success) {
      return errorResponse(`Failed to upload PDF: ${uploadResult.error}`, 500);
    }

    // Prepare private data for hash generation
    const privateData: PrivateInvoiceData = {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      amount: Number(invoice.totalAmount),
      currency: invoice.currency,
      buyerName: invoice.buyer.name,
      buyerAddress: invoice.buyer.walletAddress || undefined,
      sellerName: invoice.seller.name,
      sellerAddress: invoice.seller.walletAddress || undefined,
      issueDate: invoice.issueDate.toISOString().split('T')[0],
      dueDate: invoice.dueDate.toISOString().split('T')[0],
      description: invoice.notes || undefined,
      lineItems: invoice.items.map(item => ({
        description: item.description,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        amount: Number(item.amount),
      })),
    };

    // Parse risk score (default to existing or 50)
    const riskScore = riskScoreStr 
      ? parseInt(riskScoreStr, 10) 
      : (invoice.riskScore || 50);

    // Generate document hash INCLUDING the PDF buffer
    const ipfsResult = await ipfsService.processInvoiceForIPFS(
      privateData,
      riskScore,
      pdfBuffer // Include PDF in hash
    );

    if (!ipfsResult.ipfsResult.success) {
      // Cleanup: Remove uploaded PDF on IPFS failure
      await deletePdfFromStorage(storagePath);
      return errorResponse(`Failed to upload metadata to IPFS: ${ipfsResult.ipfsResult.error}`, 500);
    }

    // Sign the document hash with admin private key
    const signatureResult = await blockchainService.signDocumentHash(ipfsResult.documentHash);
    if (!signatureResult.success) {
      // Cleanup on signing failure
      await deletePdfFromStorage(storagePath);
      return errorResponse(`Failed to sign document hash: ${signatureResult.error}`, 500);
    }

    // Store old values for audit
    const oldValues = {
      pdfUrl: invoice.pdfUrl,
      documentHash: invoice.documentHash,
      publicMetadataURI: invoice.publicMetadataURI,
      riskScore: invoice.riskScore,
    };

    // Update invoice in database
    const updatedInvoice = await prisma.invoice.update({
      where: { id },
      data: {
        pdfUrl: storagePath,
        documentHash: ipfsResult.documentHash,
        publicMetadataURI: ipfsResult.ipfsResult.ipfsUri,
        riskScore: riskScore,
      },
      select: {
        id: true,
        invoiceNumber: true,
        pdfUrl: true,
        documentHash: true,
        publicMetadataURI: true,
        riskScore: true,
      },
    });

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
      newValue: {
        pdfUrl: storagePath,
        documentHash: ipfsResult.documentHash,
        publicMetadataURI: ipfsResult.ipfsResult.ipfsUri,
        riskScore: riskScore,
      },
      ipAddress,
      userAgent,
    });

    return successResponse(
      {
        invoice: updatedInvoice,
        pdf: {
          storagePath: storagePath,
          size: file.size,
          hash: ipfsResult.pdfHash,
        },
        documentHash: ipfsResult.documentHash,
        signature: {
          value: signatureResult.signature,
          signerAddress: signatureResult.signerAddress,
          timestamp: signatureResult.timestamp,
        },
        ipfs: {
          uri: ipfsResult.ipfsResult.ipfsUri,
          gatewayUrl: ipfsResult.ipfsResult.gatewayUrl,
        },
        publicMetadata: ipfsResult.publicMetadata,
      },
      'PDF uploaded and signed successfully',
      201
    );
  } catch (error) {
    console.error('PDF upload error:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to upload PDF',
      500
    );
  }
}

/**
 * GET /api/invoices/[id]/pdf
 * Get signed URL for PDF download
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;

    // Authentication
    const token = extractTokenFromHeader(request.headers.get('authorization'));
    if (!token) {
      return errorResponse('Authentication required', 401);
    }

    const user = await getUserFromToken(token);
    if (!user) {
      return errorResponse('Invalid or expired token', 401);
    }

    // Check Supabase configuration
    if (!isSupabaseConfigured()) {
      return errorResponse('Storage service is not configured', 503);
    }

    // Get invoice
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      select: {
        id: true,
        invoiceNumber: true,
        pdfUrl: true,
        documentHash: true,
        createdById: true,
        seller: { select: { id: true, name: true } },
        buyer: { select: { id: true, name: true } },
      },
    });

    if (!invoice) {
      return errorResponse('Invoice not found', 404);
    }

    // Check ownership for non-admin/auditor users
    const canViewAll = permissions.canViewAllInvoices(user.role);
    if (!canViewAll && invoice.createdById !== user.id) {
      return errorResponse('You do not have permission to access this invoice PDF', 403);
    }

    if (!invoice.pdfUrl) {
      return errorResponse('No PDF attached to this invoice', 404);
    }

    // Get signed URL (valid for 1 hour)
    const signedUrlResult = await getSignedPdfUrl(invoice.pdfUrl, 3600);
    if (!signedUrlResult.success) {
      return errorResponse(`Failed to generate download URL: ${signedUrlResult.error}`, 500);
    }

    return successResponse({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      downloadUrl: signedUrlResult.signedUrl,
      expiresIn: 3600,
      documentHash: invoice.documentHash,
    });
  } catch (error) {
    console.error('PDF retrieval error:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to retrieve PDF',
      500
    );
  }
}

/**
 * DELETE /api/invoices/[id]/pdf
 * Remove PDF from invoice
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;

    // Authentication
    const token = extractTokenFromHeader(request.headers.get('authorization'));
    if (!token) {
      return errorResponse('Authentication required', 401);
    }

    const user = await getUserFromToken(token);
    if (!user) {
      return errorResponse('Invalid or expired token', 401);
    }

    // Only admins can delete PDFs
    if (user.role !== 'ADMIN') {
      return errorResponse('Only administrators can delete invoice PDFs', 403);
    }

    // Check Supabase configuration
    if (!isSupabaseConfigured()) {
      return errorResponse('Storage service is not configured', 503);
    }

    // Get invoice
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      select: {
        id: true,
        invoiceNumber: true,
        pdfUrl: true,
        documentHash: true,
        publicMetadataURI: true,
        riskScore: true,
      },
    });

    if (!invoice) {
      return errorResponse('Invoice not found', 404);
    }

    if (!invoice.pdfUrl) {
      return errorResponse('No PDF attached to this invoice', 404);
    }

    // Store old values for audit
    const oldValues = {
      pdfUrl: invoice.pdfUrl,
      documentHash: invoice.documentHash,
      publicMetadataURI: invoice.publicMetadataURI,
      riskScore: invoice.riskScore,
    };

    // Delete from Supabase Storage
    const deleteResult = await deletePdfFromStorage(invoice.pdfUrl);
    if (!deleteResult.success) {
      console.warn(`Failed to delete PDF from storage: ${deleteResult.error}`);
      // Continue anyway to clear database reference
    }

    // Update invoice - clear PDF related fields
    // Note: We keep documentHash/publicMetadataURI as they may have been 
    // generated without PDF originally
    const updatedInvoice = await prisma.invoice.update({
      where: { id },
      data: {
        pdfUrl: null,
        // Optionally clear hash if you want to force regeneration
        // documentHash: null,
        // publicMetadataURI: null,
      },
      select: {
        id: true,
        invoiceNumber: true,
        pdfUrl: true,
        documentHash: true,
      },
    });

    // Create audit log
    const ipAddress = request.headers.get('x-forwarded-for') || 'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    await createAuditLog({
      userId: user.id,
      invoiceId: id,
      action: 'DELETE',
      entityType: 'InvoicePDF',
      entityId: id,
      oldValue: oldValues,
      newValue: { pdfUrl: null },
      ipAddress,
      userAgent,
    });

    return successResponse(
      {
        invoice: updatedInvoice,
        deleted: true,
      },
      'PDF deleted successfully'
    );
  } catch (error) {
    console.error('PDF deletion error:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to delete PDF',
      500
    );
  }
}
