/**
 * GET /api/kyb/verification-status/:address
 * 
 * Check KYB verification status for a wallet address
 * Hackathon version: Database-backed verification (no blockchain SBT)
 */

import { NextRequest, NextResponse } from 'next/server';
import { successResponse, errorResponse } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';

export async function GET(
  request: NextRequest,
  { params }: { params: { address: string } }
) {
  try {
    const { address } = params;

    if (!address) {
      return errorResponse('Wallet address is required', 400);
    }

    // Find company by wallet address
    const company = await prisma.company.findFirst({
      where: {
        walletAddress: {
          equals: address.toLowerCase(),
          mode: 'insensitive',
        },
      },
      select: {
        id: true,
        name: true,
        registrationNumber: true,
        isKYBVerified: true,
        kybVerifiedAt: true,
        verificationLevel: true,
        walletAddress: true,
      },
    });

    if (!company) {
      return successResponse({
        isVerified: false,
        message: 'Company not registered. Please complete registration first.',
      });
    }

    return successResponse({
      isVerified: company.isKYBVerified,
      companyId: company.id,
      companyName: company.name,
      registrationNumber: company.registrationNumber,
      verificationLevel: company.verificationLevel || 'STANDARD',
      verifiedAt: company.kybVerifiedAt,
      walletAddress: company.walletAddress,
      message: company.isKYBVerified 
        ? 'Company is KYB verified' 
        : 'KYB verification pending',
    });
  } catch (error: any) {
    console.error('KYB verification check error:', error);
    return errorResponse(error.message, 500);
  }
}
