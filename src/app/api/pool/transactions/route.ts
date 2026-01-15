/**
 * GET /api/pool/transactions
 * 
 * Get all liquidity transactions for a wallet address (deposits + withdrawals)
 */

import { NextRequest } from 'next/server';
import { extractTokenFromHeader, getUserFromToken } from '@/lib/auth';
import { errorResponse, unauthorizedResponse, paginatedResponse, handleError } from '@/lib/api-response';
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
    const type = searchParams.get('type'); // DEPOSIT, WITHDRAW, or null for all
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

    // Build where clause
    const whereClause: any = { lpId: lp.id };
    if (type === 'DEPOSIT' || type === 'WITHDRAW') {
      whereClause.type = type;
    }

    // Get transactions with pagination
    const [transactions, total] = await Promise.all([
      prisma.liquidityTransaction.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.liquidityTransaction.count({
        where: whereClause
      })
    ]);

    const formattedTransactions = transactions.map(tx => ({
      id: tx.id,
      type: tx.type,
      amount: tx.amount.toString(),
      shares: tx.shares.toString(),
      txHash: tx.txHash,
      blockNumber: tx.blockNumber,
      timestamp: tx.createdAt,
      explorerUrl: `https://sepolia.etherscan.io/tx/${tx.txHash}`
    }));

    return paginatedResponse(formattedTransactions, { page, limit, total });

  } catch (error) {
    return handleError(error);
  }
}
