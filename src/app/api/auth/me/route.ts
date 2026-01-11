import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { 
  extractTokenFromHeader, 
  getUserFromToken,
  hashPassword,
  verifyPassword 
} from '@/lib/auth';
import { updateProfileSchema, changePasswordSchema } from '@/lib/validations';
import { 
  successResponse, 
  errorResponse, 
  unauthorizedResponse,
  handleError,
  handleZodError 
} from '@/lib/api-response';
import { createAuditLog } from '@/services/audit';
import { ZodError } from 'zod';

// GET /api/auth/me - Get current user profile
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const token = extractTokenFromHeader(authHeader);

    if (!token) {
      return unauthorizedResponse('No token provided');
    }

    const authUser = await getUserFromToken(token);
    if (!authUser) {
      return unauthorizedResponse('Invalid token');
    }

    // Get full user profile
    const user = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        companyId: true,
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
      return unauthorizedResponse('User not found');
    }

    return successResponse(user);
  } catch (error) {
    return handleError(error);
  }
}

// PATCH /api/auth/me - Update current user profile
export async function PATCH(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const token = extractTokenFromHeader(authHeader);

    if (!token) {
      return unauthorizedResponse('No token provided');
    }

    const authUser = await getUserFromToken(token);
    if (!authUser) {
      return unauthorizedResponse('Invalid token');
    }

    const body = await request.json();
    const validatedData = updateProfileSchema.parse(body);

    // Check if email is being changed and if it's already taken
    if (validatedData.email && validatedData.email !== authUser.email) {
      const existingUser = await prisma.user.findUnique({
        where: { email: validatedData.email },
      });
      if (existingUser) {
        return errorResponse('Email already in use', 409);
      }
    }

    // Get old values for audit
    const oldUser = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: { firstName: true, lastName: true, email: true },
    });

    // Update user
    const updatedUser = await prisma.user.update({
      where: { id: authUser.id },
      data: validatedData,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        companyId: true,
        company: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    // Create audit log
    const ipAddress = request.headers.get('x-forwarded-for') || 'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    await createAuditLog({
      userId: authUser.id,
      action: 'UPDATE',
      entityType: 'User',
      entityId: authUser.id,
      oldValue: oldUser,
      newValue: validatedData,
      ipAddress,
      userAgent,
    });

    return successResponse(updatedUser, 'Profile updated successfully');
  } catch (error) {
    if (error instanceof ZodError) {
      return handleZodError(error);
    }
    return handleError(error);
  }
}

// PUT /api/auth/me - Change password
export async function PUT(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const token = extractTokenFromHeader(authHeader);

    if (!token) {
      return unauthorizedResponse('No token provided');
    }

    const authUser = await getUserFromToken(token);
    if (!authUser) {
      return unauthorizedResponse('Invalid token');
    }

    const body = await request.json();
    const validatedData = changePasswordSchema.parse(body);

    // Get user with password
    const user = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: { password: true },
    });

    if (!user) {
      return unauthorizedResponse('User not found');
    }

    // Verify current password
    const isValidPassword = await verifyPassword(validatedData.currentPassword, user.password);
    if (!isValidPassword) {
      return errorResponse('Current password is incorrect', 400);
    }

    // Hash new password
    const hashedPassword = await hashPassword(validatedData.newPassword);

    // Update password
    await prisma.user.update({
      where: { id: authUser.id },
      data: { password: hashedPassword },
    });

    // Create audit log
    const ipAddress = request.headers.get('x-forwarded-for') || 'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    await createAuditLog({
      userId: authUser.id,
      action: 'UPDATE',
      entityType: 'User',
      entityId: authUser.id,
      newValue: { passwordChanged: true },
      ipAddress,
      userAgent,
    });

    return successResponse(null, 'Password changed successfully');
  } catch (error) {
    if (error instanceof ZodError) {
      return handleZodError(error);
    }
    return handleError(error);
  }
}
