/**
 * POST /api/kyb/submit
 * 
 * Submit KYB (Know Your Business) verification
 * Hackathon version: Auto-approves and marks as verified in database
 * 
 * In production, this would:
 * - Upload documents to IPFS
 * - Require admin review
 * - Mint Soul Bound Token (SBT) NFT on blockchain
 */

import { NextRequest, NextResponse } from 'next/server';
import { successResponse, errorResponse, unauthorizedResponse } from '@/lib/api-response';
import { extractTokenFromHeader, getUserFromToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function POST(request: NextRequest) {
  try {
    // Authenticate user
    const authHeader = request.headers.get('authorization');
    const token = extractTokenFromHeader(authHeader);

    if (!token) {
      return unauthorizedResponse('No token provided');
    }

    const user = await getUserFromToken(token);
    if (!user) {
      return unauthorizedResponse('Invalid token');
    }

    if (!user.companyId) {
      return errorResponse('User must be associated with a company', 400);
    }

    // Get KYB data from request
    const body = await request.json();
    const {
      companyName,
      registrationNumber,
      taxId,
      country,
      address,
      city,
      postalCode,
      businessEmail,
      businessPhone,
      website,
      verificationLevel = 'STANDARD',
    } = body;

    // Validate required fields
    if (!companyName || !registrationNumber || !businessEmail || !country) {
      return errorResponse(
        'Missing required fields: companyName, registrationNumber, businessEmail, country',
        400
      );
    }

    // Update company with KYB information and auto-verify
    const company = await prisma.company.update({
      where: { id: user.companyId },
      data: {
        name: companyName,
        registrationNumber,
        taxId,
        country,
        address,
        city,
        postalCode,
        businessEmail,
        businessPhone,
        website,
        // Auto-verify for hackathon
        isKYBVerified: true,
        kybVerifiedAt: new Date(),
        verificationLevel,
      },
    });

    return successResponse(
      {
        company: {
          id: company.id,
          name: company.name,
          registrationNumber: company.registrationNumber,
          isKYBVerified: company.isKYBVerified,
          kybVerifiedAt: company.kybVerifiedAt,
          verificationLevel: company.verificationLevel,
        },
        message: '✅ KYB verification completed successfully!',
        note: 'Hackathon mode: Auto-verified. In production, this would require admin review and mint an SBT NFT.',
      },
      201
    );
  } catch (error: any) {
    console.error('KYB submission error:', error);
    return errorResponse(error.message, 500);
  }
}
