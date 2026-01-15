/**
 * Liquidity Pool Event Listener
 * 
 * Listens to blockchain events from the Liquidity Pool contract and syncs them to the database.
 * This service runs in the background to track LP deposits, withdrawals, and yield distributions.
 */

import { ethers } from 'ethers';
import { prisma } from '@/lib/prisma';
import { LIQUIDITY_POOL_ABI } from '@/lib/contract-abis';

const LIQUIDITY_POOL_ADDRESS = process.env.LIQUIDITY_POOL_ADDRESS || '';
const BLOCKCHAIN_RPC_URL = process.env.BLOCKCHAIN_RPC_URL || '';
const ENABLE_EVENT_LISTENER = process.env.ENABLE_EVENT_LISTENER === 'true';

interface DepositEvent {
  sender: string;
  owner: string;
  assets: bigint;
  shares: bigint;
  event: ethers.EventLog;
}

interface WithdrawEvent {
  sender: string;
  receiver: string;
  owner: string;
  assets: bigint;
  shares: bigint;
  event: ethers.EventLog;
}

class LiquidityEventListener {
  private provider: ethers.WebSocketProvider | null = null;
  private poolContract: ethers.Contract | null = null;
  private isRunning = false;

  /**
   * Initialize the event listener
   */
  async start() {
    if (!ENABLE_EVENT_LISTENER) {
      console.log('Liquidity event listener is disabled (ENABLE_EVENT_LISTENER=false)');
      return;
    }

    if (!BLOCKCHAIN_RPC_URL || !LIQUIDITY_POOL_ADDRESS) {
      console.error('Cannot start liquidity event listener: Missing BLOCKCHAIN_RPC_URL or LIQUIDITY_POOL_ADDRESS');
      return;
    }

    if (this.isRunning) {
      console.log('Liquidity event listener is already running');
      return;
    }

    try {
      // Use WebSocket for real-time events
      const wsUrl = BLOCKCHAIN_RPC_URL.replace('https://', 'wss://').replace('http://', 'ws://');
      this.provider = new ethers.WebSocketProvider(wsUrl);
      
      this.poolContract = new ethers.Contract(
        LIQUIDITY_POOL_ADDRESS,
        LIQUIDITY_POOL_ABI,
        this.provider
      );

      // Listen to Deposit events
      this.poolContract.on('Deposit', this.handleDeposit.bind(this));
      
      // Listen to Withdraw events
      this.poolContract.on('Withdraw', this.handleWithdraw.bind(this));

      this.isRunning = true;
      console.log(`✅ Liquidity event listener started for pool: ${LIQUIDITY_POOL_ADDRESS}`);
    } catch (error) {
      console.error('Failed to start liquidity event listener:', error);
      throw error;
    }
  }

  /**
   * Stop the event listener
   */
  async stop() {
    if (!this.isRunning) {
      return;
    }

    try {
      if (this.poolContract) {
        this.poolContract.removeAllListeners();
      }
      
      if (this.provider) {
        await this.provider.destroy();
      }

      this.isRunning = false;
      console.log('Liquidity event listener stopped');
    } catch (error) {
      console.error('Error stopping liquidity event listener:', error);
    }
  }

  /**
   * Handle Deposit event
   */
  private async handleDeposit(sender: string, owner: string, assets: bigint, shares: bigint, event: ethers.EventLog) {
    try {
      console.log(`💰 Deposit detected: ${ethers.formatUnits(assets, 6)} USDC by ${owner}`);

      const txHash = event.log.transactionHash;
      const blockNumber = event.log.blockNumber;
      const walletAddress = owner.toLowerCase();

      // Check if transaction already processed
      const existing = await prisma.liquidityTransaction.findUnique({
        where: { txHash }
      });

      if (existing) {
        console.log(`Transaction ${txHash} already processed, skipping`);
        return;
      }

      // Get or create LP record
      let lp = await prisma.liquidityProvider.findUnique({
        where: { walletAddress }
      });

      if (!lp) {
        lp = await prisma.liquidityProvider.create({
          data: {
            walletAddress,
            totalDeposited: 0,
            totalWithdrawn: 0,
            currentShares: 0,
            totalYieldEarned: 0,
          }
        });
        console.log(`Created new LP record for ${walletAddress}`);
      }

      // Create transaction record
      await prisma.liquidityTransaction.create({
        data: {
          lpId: lp.id,
          type: 'DEPOSIT',
          amount: ethers.formatUnits(assets, 6),
          shares: ethers.formatUnits(shares, 6),
          txHash,
          blockNumber,
        }
      });

      // Update LP aggregated totals
      await prisma.liquidityProvider.update({
        where: { id: lp.id },
        data: {
          totalDeposited: {
            increment: ethers.formatUnits(assets, 6)
          },
          currentShares: {
            increment: ethers.formatUnits(shares, 6)
          }
        }
      });

      console.log(`✅ Deposit processed: ${ethers.formatUnits(assets, 6)} USDC → ${ethers.formatUnits(shares, 6)} shares`);
    } catch (error) {
      console.error('Error handling deposit event:', error);
    }
  }

  /**
   * Handle Withdraw event
   */
  private async handleWithdraw(
    sender: string,
    receiver: string,
    owner: string,
    assets: bigint,
    shares: bigint,
    event: ethers.EventLog
  ) {
    try {
      console.log(`💸 Withdraw detected: ${ethers.formatUnits(assets, 6)} USDC by ${owner}`);

      const txHash = event.log.transactionHash;
      const blockNumber = event.log.blockNumber;
      const walletAddress = owner.toLowerCase();

      // Check if transaction already processed
      const existing = await prisma.liquidityTransaction.findUnique({
        where: { txHash }
      });

      if (existing) {
        console.log(`Transaction ${txHash} already processed, skipping`);
        return;
      }

      // Get LP record
      const lp = await prisma.liquidityProvider.findUnique({
        where: { walletAddress }
      });

      if (!lp) {
        console.error(`LP record not found for ${walletAddress}`);
        return;
      }

      // Create transaction record
      await prisma.liquidityTransaction.create({
        data: {
          lpId: lp.id,
          type: 'WITHDRAW',
          amount: ethers.formatUnits(assets, 6),
          shares: ethers.formatUnits(shares, 6),
          txHash,
          blockNumber,
        }
      });

      // Update LP aggregated totals
      await prisma.liquidityProvider.update({
        where: { id: lp.id },
        data: {
          totalWithdrawn: {
            increment: ethers.formatUnits(assets, 6)
          },
          currentShares: {
            decrement: ethers.formatUnits(shares, 6)
          }
        }
      });

      console.log(`✅ Withdraw processed: ${ethers.formatUnits(shares, 6)} shares → ${ethers.formatUnits(assets, 6)} USDC`);
    } catch (error) {
      console.error('Error handling withdraw event:', error);
    }
  }

  /**
   * Sync historical events (for backfilling)
   */
  async syncHistoricalEvents(fromBlock: number = 0, toBlock: number | string = 'latest') {
    if (!BLOCKCHAIN_RPC_URL || !LIQUIDITY_POOL_ADDRESS) {
      throw new Error('Missing BLOCKCHAIN_RPC_URL or LIQUIDITY_POOL_ADDRESS');
    }

    const provider = new ethers.JsonRpcProvider(BLOCKCHAIN_RPC_URL);
    const pool = new ethers.Contract(LIQUIDITY_POOL_ADDRESS, LIQUIDITY_POOL_ABI, provider);

    console.log(`Syncing historical events from block ${fromBlock} to ${toBlock}...`);

    // Query Deposit events
    const depositFilter = pool.filters.Deposit();
    const depositEvents = await pool.queryFilter(depositFilter, fromBlock, toBlock);
    
    console.log(`Found ${depositEvents.length} deposit events`);
    
    for (const event of depositEvents) {
      if (event instanceof ethers.EventLog) {
        const [sender, owner, assets, shares] = event.args;
        await this.handleDeposit(sender, owner, assets, shares, event);
      }
    }

    // Query Withdraw events
    const withdrawFilter = pool.filters.Withdraw();
    const withdrawEvents = await pool.queryFilter(withdrawFilter, fromBlock, toBlock);
    
    console.log(`Found ${withdrawEvents.length} withdraw events`);
    
    for (const event of withdrawEvents) {
      if (event instanceof ethers.EventLog) {
        const [sender, receiver, owner, assets, shares] = event.args;
        await this.handleWithdraw(sender, receiver, owner, assets, shares, event);
      }
    }

    console.log('Historical sync complete');
  }
}

export const liquidityEventListener = new LiquidityEventListener();
