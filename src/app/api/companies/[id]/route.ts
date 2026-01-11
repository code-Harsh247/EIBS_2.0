import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { extractTokenFromHeader, getUserFromToken, permissions } from '@/lib/auth';
import { updateCompanySchema } from '@/lib/validations';
import { 
  successResponse, 
  errorResponse, 
  unauthorizedResponse,
  forbiddenResponse,
  notFoundResponse,
  handleError,
  handleZodError 
} from '@/lib/api-response';
import { createAuditLog } from '@/services/audit';
import { ZodError } from 'zod';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/companies/[id] - Get company by ID
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

    const company = await prisma.company.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            users: true,
            soldInvoices: true,
            boughtInvoices: true,
          },
        },
      },
    });

    if (!company) {
      return notFoundResponse('Company not found');
    }

    return successResponse(company);
  } catch (error) {
    return handleError(error);
  }
}

// PATCH /api/companies/[id] - Update company
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

    // Check permission - admin or own company
    const canManage = permissions.canManageCompany(user.role);
    const isOwnCompany = user.companyId === id;

    if (!canManage && !isOwnCompany) {
      return forbiddenResponse('You do not have permission to update this company');
    }

    const existingCompany = await prisma.company.findUnique({
      where: { id },
    });

    if (!existingCompany) {
      return notFoundResponse('Company not found');
    }

    const body = await request.json();
    const validatedData = updateCompanySchema.parse(body);

    // Check if registration number is being changed and is already taken
    if (validatedData.registrationNo && validatedData.registrationNo !== existingCompany.registrationNo) {
      const duplicate = await prisma.company.findUnique({
        where: { registrationNo: validatedData.registrationNo },
      });
      if (duplicate) {
        return errorResponse('Registration number already in use', 409);
      }
    }

    // Update company
    const updatedCompany = await prisma.company.update({
      where: { id },
      data: validatedData,
    });

    // Create audit log
    const ipAddress = request.headers.get('x-forwarded-for') || 'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    await createAuditLog({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'Company',
      entityId: id,
      oldValue: { name: existingCompany.name },
      newValue: validatedData,
      ipAddress,
      userAgent,
    });

    return successResponse(updatedCompany, 'Company updated successfully');
  } catch (error) {
    if (error instanceof ZodError) {
      return handleZodError(error);
    }
    return handleError(error);
  }
}

// DELETE /api/companies/[id] - Deactivate company
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

    // Only admin can deactivate
    if (!permissions.canManageCompany(user.role)) {
      return forbiddenResponse('You do not have permission to deactivate companies');
    }

    const existingCompany = await prisma.company.findUnique({
      where: { id },
    });

    if (!existingCompany) {
      return notFoundResponse('Company not found');
    }

    // Soft delete - deactivate
    await prisma.company.update({
      where: { id },
      data: { isActive: false },
    });

    // Create audit log
    const ipAddress = request.headers.get('x-forwarded-for') || 'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    await createAuditLog({
      userId: user.id,
      action: 'DELETE',
      entityType: 'Company',
      entityId: id,
      oldValue: { name: existingCompany.name, isActive: true },
      newValue: { isActive: false },
      ipAddress,
      userAgent,
    });

    return successResponse(null, 'Company deactivated successfully');
  } catch (error) {
    return handleError(error);
  }
}
