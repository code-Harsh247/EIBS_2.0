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
import { getInvoiceById, updateInvoice } from '@/services/invoice';
import { ipfsService, PrivateInvoiceData } from '@/services/ipfs';
import { createAuditLog } from '@/services/audit';
import prisma from '@/lib/prisma';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/invoices/[id]/metadata/generate
 * 
 * Generates split metadata for an invoice:
 * 1. Creates deterministic document hash from private data
 * 2. Generates public metadata (no private info)
 * 3. Uploads public metadata to IPFS
 * 4. Stores documentHash and publicMetadataURI in database
 */
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

    // Check permission (ADMIN or ACCOUNTANT can generate metadata)
    if (!permissions.canApproveInvoice(user.role)) {
      return forbiddenResponse('You do not have permission to generate invoice metadata');
    }

    // Get invoice with all related data
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        seller: true,
        buyer: true,
        items: true,
      },
    });

    if (!invoice) {
      return notFoundResponse('Invoice not found');
    }

    // Check if metadata already exists
    if (invoice.documentHash && invoice.publicMetadataURI) {
      return errorResponse('Metadata already generated for this invoice', 400);
    }

    // Parse optional risk score from request body
    let riskScore = 50; // Default
    try {
      const body = await request.json();
      if (body.riskScore !== undefined) {
        riskScore = Math.min(100, Math.max(0, parseInt(body.riskScore)));
      }
    } catch {
      // No body or invalid JSON, use defaults
    }

    // Prepare private data for hashing
    const privateData: PrivateInvoiceData = {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      amount: Number(invoice.totalAmount),
      currency: invoice.currency,
      buyerName: invoice.buyer.name,
      buyerAddress: invoice.buyer.address || undefined,
      sellerName: invoice.seller.name,
      sellerAddress: invoice.seller.address || undefined,
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

    // Process: Generate hash, create public metadata, upload to IPFS
    const result = await ipfsService.processInvoiceForIPFS(privateData, riskScore);

    if (!result.ipfsResult.success) {
      return errorResponse(`Failed to upload to IPFS: ${result.ipfsResult.error}`, 500);
    }

    // Update invoice with metadata
    const updatedInvoice = await prisma.invoice.update({
      where: { id },
      data: {
        documentHash: result.documentHash,
        riskScore: riskScore,
        publicMetadataURI: result.ipfsResult.ipfsUri,
      },
      include: {
        seller: { select: { id: true, name: true } },
        buyer: { select: { id: true, name: true } },
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
      oldValue: { documentHash: null, publicMetadataURI: null },
      newValue: { 
        documentHash: result.documentHash,
        publicMetadataURI: result.ipfsResult.ipfsUri,
        riskScore,
      },
      ipAddress,
      userAgent,
    });

    return successResponse({
      invoice: {
        id: updatedInvoice.id,
        invoiceNumber: updatedInvoice.invoiceNumber,
        documentHash: updatedInvoice.documentHash,
        riskScore: updatedInvoice.riskScore,
        publicMetadataURI: updatedInvoice.publicMetadataURI,
      },
      publicMetadata: result.publicMetadata,
      ipfs: {
        hash: result.ipfsResult.ipfsHash,
        uri: result.ipfsResult.ipfsUri,
        gatewayUrl: result.ipfsResult.gatewayUrl,
      },
    }, 'Invoice metadata generated and uploaded to IPFS');
  } catch (error) {
    return handleError(error);
  }
}

/**
 * GET /api/invoices/[id]/metadata/generate
 * 
 * Retrieves the current metadata status for an invoice
 */
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

    const invoice = await prisma.invoice.findUnique({
      where: { id },
      select: {
        id: true,
        invoiceNumber: true,
        documentHash: true,
        riskScore: true,
        publicMetadataURI: true,
        status: true,
      },
    });

    if (!invoice) {
      return notFoundResponse('Invoice not found');
    }

    // Fetch public metadata from IPFS if available
    let publicMetadata = null;
    if (invoice.publicMetadataURI) {
      publicMetadata = await ipfsService.fetchFromIPFS(invoice.publicMetadataURI);
    }

    return successResponse({
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        documentHash: invoice.documentHash,
        riskScore: invoice.riskScore,
        publicMetadataURI: invoice.publicMetadataURI,
        status: invoice.status,
        hasMetadata: !!(invoice.documentHash && invoice.publicMetadataURI),
      },
      publicMetadata,
      ipfsConfigured: ipfsService.isIPFSConfigured(),
    });
  } catch (error) {
    return handleError(error);
  }
}
