/**
 * GET /api/pool/my-withdrawals
 * 
 * Get all withdrawal transactions for a wallet address
 */

import { NextRequest } from 'next/server';
import { extractTokenFromHeader, getUserFromToken } from '@/lib/auth';
import { successResponse, errorResponse, unauthorizedResponse, paginatedResponse, handleError } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';

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

    // Get parameters
    const { searchParams } = new URL(request.url);
    const walletAddress = searchParams.get('address');
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);

    if (!walletAddress) {
      return errorResponse('Wallet address is required', 400);
    }

    // Get LP record
    const lp = await prisma.liquidityProvider.findUnique({
      where: { walletAddress: walletAddress.toLowerCase() }
    });

    if (!lp) {
      return paginatedResponse([], { page, limit, total: 0 });
    }

    // Get withdrawals with pagination
    const [withdrawals, total] = await Promise.all([
      prisma.liquidityTransaction.findMany({
        where: {
          lpId: lp.id,
          type: 'WITHDRAW'
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.liquidityTransaction.count({
        where: {
          lpId: lp.id,
          type: 'WITHDRAW'
        }
      })
    ]);

    const formattedWithdrawals = withdrawals.map(withdrawal => ({
      id: withdrawal.id,
      amount: withdrawal.amount.toString(),
      shares: withdrawal.shares.toString(),
      txHash: withdrawal.txHash,
      blockNumber: withdrawal.blockNumber,
      timestamp: withdrawal.createdAt,
      explorerUrl: `https://sepolia.etherscan.io/tx/${withdrawal.txHash}`
    }));

    return paginatedResponse(formattedWithdrawals, { page, limit, total });

  } catch (error) {
    return handleError(error);
  }
}
