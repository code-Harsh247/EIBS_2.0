import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { extractTokenFromHeader, getUserFromToken, permissions } from '@/lib/auth';
import { createCompanySchema } from '@/lib/validations';
import { 
  successResponse, 
  paginatedResponse,
  errorResponse, 
  unauthorizedResponse,
  forbiddenResponse,
  handleError,
  handleZodError 
} from '@/lib/api-response';
import { createAuditLog } from '@/services/audit';
import { ZodError } from 'zod';

// GET /api/companies - List companies
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const token = extractTokenFromHeader(authHeader);

    if (!token) {
      return unauthorizedResponse('No token provided');
    }

    const user = await getUserFromToken(token);
    if (!user) {
      return unauthorizedResponse('Invalid token');
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const search = searchParams.get('search');

    const where: any = { isActive: true };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { registrationNo: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [companies, total] = await Promise.all([
      prisma.company.findMany({
        where,
        select: {
          id: true,
          name: true,
          registrationNo: true,
          taxId: true,
          city: true,
          country: true,
          email: true,
          phone: true,
          createdAt: true,
        },
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.company.count({ where }),
    ]);

    return paginatedResponse(companies, { page, limit, total });
  } catch (error) {
    return handleError(error);
  }
}

// POST /api/companies - Create company
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const token = extractTokenFromHeader(authHeader);

    if (!token) {
      return unauthorizedResponse('No token provided');
    }

    const user = await getUserFromToken(token);
    if (!user) {
      return unauthorizedResponse('Invalid token');
    }

    // Check permission
    if (!permissions.canManageCompany(user.role)) {
      return forbiddenResponse('You do not have permission to create companies');
    }

    const body = await request.json();
    const validatedData = createCompanySchema.parse(body);

    // Check if registration number already exists
    const existingCompany = await prisma.company.findUnique({
      where: { registrationNo: validatedData.registrationNo },
    });

    if (existingCompany) {
      return errorResponse('Company with this registration number already exists', 409);
    }

    // Create company
    const company = await prisma.company.create({
      data: validatedData,
    });

    // Create audit log
    const ipAddress = request.headers.get('x-forwarded-for') || 'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    await createAuditLog({
      userId: user.id,
      action: 'CREATE',
      entityType: 'Company',
      entityId: company.id,
      newValue: { name: company.name, registrationNo: company.registrationNo },
      ipAddress,
      userAgent,
    });

    return successResponse(company, 'Company created successfully', 201);
  } catch (error) {
    if (error instanceof ZodError) {
      return handleZodError(error);
    }
    return handleError(error);
  }
}
