import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { extractTokenFromHeader, getUserFromToken, permissions } from '@/lib/auth';
import { updateUserSchema } from '@/lib/validations';
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

// GET /api/users/[id] - Get user by ID
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const authHeader = request.headers.get('authorization');
    const token = extractTokenFromHeader(authHeader);

    if (!token) {
      return unauthorizedResponse('No token provided');
    }

    const currentUser = await getUserFromToken(token);
    if (!currentUser) {
      return unauthorizedResponse('Invalid token');
    }

    // Only admin or self can view user details
    if (!permissions.canManageUsers(currentUser.role) && currentUser.id !== id) {
      return forbiddenResponse('You do not have permission to view this user');
    }

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        emailVerified: true,
        createdAt: true,
        lastLoginAt: true,
        company: {
          select: {
            id: true,
            name: true,
            registrationNo: true,
          },
        },
      },
    });

    if (!user) {
      return notFoundResponse('User not found');
    }

    return successResponse(user);
  } catch (error) {
    return handleError(error);
  }
}

// PATCH /api/users/[id] - Update user (Admin only)
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const authHeader = request.headers.get('authorization');
    const token = extractTokenFromHeader(authHeader);

    if (!token) {
      return unauthorizedResponse('No token provided');
    }

    const currentUser = await getUserFromToken(token);
    if (!currentUser) {
      return unauthorizedResponse('Invalid token');
    }

    // Check permission
    if (!permissions.canManageUsers(currentUser.role)) {
      return forbiddenResponse('You do not have permission to update users');
    }

    const existingUser = await prisma.user.findUnique({
      where: { id },
      select: { email: true, role: true, isActive: true },
    });

    if (!existingUser) {
      return notFoundResponse('User not found');
    }

    const body = await request.json();
    const validatedData = updateUserSchema.parse(body);

    // Update user
    const updatedUser = await prisma.user.update({
      where: { id },
      data: validatedData,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        companyId: true,
      },
    });

    // Create audit log
    const ipAddress = request.headers.get('x-forwarded-for') || 'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    await createAuditLog({
      userId: currentUser.id,
      action: 'UPDATE',
      entityType: 'User',
      entityId: id,
      oldValue: existingUser,
      newValue: validatedData,
      ipAddress,
      userAgent,
    });

    return successResponse(updatedUser, 'User updated successfully');
  } catch (error) {
    if (error instanceof ZodError) {
      return handleZodError(error);
    }
    return handleError(error);
  }
}

// DELETE /api/users/[id] - Deactivate user (Admin only)
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const authHeader = request.headers.get('authorization');
    const token = extractTokenFromHeader(authHeader);

    if (!token) {
      return unauthorizedResponse('No token provided');
    }

    const currentUser = await getUserFromToken(token);
    if (!currentUser) {
      return unauthorizedResponse('Invalid token');
    }

    // Check permission
    if (!permissions.canManageUsers(currentUser.role)) {
      return forbiddenResponse('You do not have permission to deactivate users');
    }

    // Cannot deactivate self
    if (currentUser.id === id) {
      return errorResponse('You cannot deactivate your own account', 400);
    }

    const existingUser = await prisma.user.findUnique({
      where: { id },
    });

    if (!existingUser) {
      return notFoundResponse('User not found');
    }

    // Soft delete - deactivate
    await prisma.user.update({
      where: { id },
      data: { isActive: false },
    });

    // Create audit log
    const ipAddress = request.headers.get('x-forwarded-for') || 'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    await createAuditLog({
      userId: currentUser.id,
      action: 'DELETE',
      entityType: 'User',
      entityId: id,
      oldValue: { email: existingUser.email, isActive: true },
      newValue: { isActive: false },
      ipAddress,
      userAgent,
    });

    return successResponse(null, 'User deactivated successfully');
  } catch (error) {
    return handleError(error);
  }
}
