/**
 * GET /api/pool/my-position
 * 
 * Get LP position summary for the authenticated user's wallet address
 */

import { NextRequest } from 'next/server';
import { extractTokenFromHeader, getUserFromToken } from '@/lib/auth';
import { successResponse, errorResponse, unauthorizedResponse, handleError } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import { liquidityPoolService } from '@/services/liquidity-pool';

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

    // Get wallet address from query param
    const { searchParams } = new URL(request.url);
    const walletAddress = searchParams.get('address');

    if (!walletAddress) {
      return errorResponse('Wallet address is required', 400);
    }

    // Get LP record from database
    const lp = await prisma.liquidityProvider.findUnique({
      where: { walletAddress: walletAddress.toLowerCase() },
      include: {
        transactions: {
          orderBy: { createdAt: 'desc' },
          take: 10, // Last 10 transactions
        }
      }
    });

    if (!lp) {
      return successResponse({
        walletAddress,
        hasPosition: false,
        message: 'No liquidity position found for this address'
      });
    }

    // Get current on-chain balance
    let onChainBalance;
    try {
      onChainBalance = await liquidityPoolService.getLPBalance(walletAddress);
    } catch (error) {
      console.error('Failed to fetch on-chain balance:', error);
      onChainBalance = {
        shares: '0',
        underlyingValue: '0',
        maxWithdraw: '0'
      };
    }

    // Calculate metrics
    const totalDeposited = Number(lp.totalDeposited);
    const totalWithdrawn = Number(lp.totalWithdrawn);
    const netDeposit = totalDeposited - totalWithdrawn;
    const currentValue = Number(onChainBalance.underlyingValue);
    const gainLoss = currentValue - netDeposit;
    const gainLossPercent = netDeposit > 0 ? (gainLoss / netDeposit) * 100 : 0;

    // Count transactions by type
    const depositCount = await prisma.liquidityTransaction.count({
      where: { lpId: lp.id, type: 'DEPOSIT' }
    });

    const withdrawCount = await prisma.liquidityTransaction.count({
      where: { lpId: lp.id, type: 'WITHDRAW' }
    });

    return successResponse({
      walletAddress,
      hasPosition: true,
      position: {
        // Database values
        totalDeposited: lp.totalDeposited.toString(),
        totalWithdrawn: lp.totalWithdrawn.toString(),
        netDeposit: netDeposit.toFixed(6),
        dbShares: lp.currentShares.toString(),
        
        // On-chain values (source of truth)
        currentShares: onChainBalance.shares,
        currentValue: onChainBalance.underlyingValue,
        maxWithdrawable: onChainBalance.maxWithdraw,
        
        // Performance
        gainLoss: gainLoss.toFixed(6),
        gainLossPercent: gainLossPercent.toFixed(2),
        
        // Statistics
        depositCount,
        withdrawCount,
        firstDepositAt: lp.createdAt,
        lastActivity: lp.updatedAt,
      },
      recentTransactions: lp.transactions.map(tx => ({
        id: tx.id,
        type: tx.type,
        amount: tx.amount.toString(),
        shares: tx.shares.toString(),
        txHash: tx.txHash,
        blockNumber: tx.blockNumber,
        createdAt: tx.createdAt,
      }))
    });

  } catch (error) {
    return handleError(error);
  }
}
