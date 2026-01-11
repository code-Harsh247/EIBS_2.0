import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { 
  hashPassword, 
  generateToken, 
  createSession 
} from '@/lib/auth';
import { registerSchema } from '@/lib/validations';
import { 
  successResponse, 
  errorResponse, 
  handleError, 
  handleZodError 
} from '@/lib/api-response';
import { createAuditLog } from '@/services/audit';
import { ZodError } from 'zod';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validatedData = registerSchema.parse(body);

    // Check if email already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: validatedData.email },
    });

    if (existingUser) {
      return errorResponse('Email already registered', 409);
    }

    // If companyId provided, verify it exists
    if (validatedData.companyId) {
      const company = await prisma.company.findUnique({
        where: { id: validatedData.companyId },
      });
      if (!company) {
        return errorResponse('Company not found', 400);
      }
    }

    // Hash password
    const hashedPassword = await hashPassword(validatedData.password);

    // Create user
    const user = await prisma.user.create({
      data: {
        email: validatedData.email,
        password: hashedPassword,
        firstName: validatedData.firstName,
        lastName: validatedData.lastName,
        companyId: validatedData.companyId,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        companyId: true,
        createdAt: true,
      },
    });

    // Generate token
    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      companyId: user.companyId,
    });

    // Create session
    const ipAddress = request.headers.get('x-forwarded-for') || 'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';
    await createSession(user.id, token, ipAddress, userAgent);

    // Create audit log
    await createAuditLog({
      userId: user.id,
      action: 'CREATE',
      entityType: 'User',
      entityId: user.id,
      newValue: { email: user.email },
      ipAddress,
      userAgent,
    });

    return successResponse(
      { user, token },
      'Registration successful',
      201
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return handleZodError(error);
    }
    return handleError(error);
  }
}
