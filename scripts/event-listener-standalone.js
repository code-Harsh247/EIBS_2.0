/**
 * Standalone Event Listener Process
 * Runs independently from Next.js to avoid webpack issues with WebSocket
 */

const { ethers } = require('ethers');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Contract addresses and ABIs
const LIQUIDITY_POOL_ADDRESS = process.env.LIQUIDITY_POOL_ADDRESS;
const BLOCK_EXPLORER_URL = process.env.BLOCK_EXPLORER_URL || 'https://sepolia.etherscan.io';

const ERC4626_ABI = [
  'event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)',
  'event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)',
  'function balanceOf(address account) view returns (uint256)',
  'function totalAssets() view returns (uint256)',
];

let provider;
let contract;
let isRunning = false;

// Track processed transactions to prevent duplicates
const processedTxHashes = new Set();

async function start() {
  if (isRunning) {
    console.log('⚠️  Event listener is already running');
    return;
  }

  if (!process.env.BLOCKCHAIN_RPC_URL?.startsWith('wss://')) {
    console.error('❌ BLOCKCHAIN_RPC_URL must be a WebSocket URL (wss://)');
    process.exit(1);
  }

  if (!LIQUIDITY_POOL_ADDRESS) {
    console.error('❌ LIQUIDITY_POOL_ADDRESS not configured');
    process.exit(1);
  }

  try {
    console.log('🔌 Connecting to blockchain WebSocket...');
    provider = new ethers.WebSocketProvider(process.env.BLOCKCHAIN_RPC_URL);
    contract = new ethers.Contract(LIQUIDITY_POOL_ADDRESS, ERC4626_ABI, provider);

    // Test connection
    await provider.getNetwork();
    console.log('✅ Connected to blockchain');

    // Set up event listeners
    contract.on('Deposit', handleDeposit);
    contract.on('Withdraw', handleWithdraw);

    isRunning = true;
    console.log('👂 Listening for Deposit and Withdraw events...');
    console.log(`📍 Pool Address: ${LIQUIDITY_POOL_ADDRESS}\n`);

    // Optional: Sync recent historical events
    await syncRecentEvents();
  } catch (error) {
    console.error('❌ Failed to start event listener:', error.message);
    process.exit(1);
  }
}

async function handleDeposit(sender, owner, assets, shares, event) {
  const txHash = event.log.transactionHash;
  
  if (processedTxHashes.has(txHash)) {
    return; // Already processed
  }

  try {
    console.log(`\n💰 Deposit detected:`);
    console.log(`   Owner: ${owner}`);
    console.log(`   Assets: ${ethers.formatUnits(assets, 6)} USDC`);
    console.log(`   Shares: ${ethers.formatEther(shares)}`);
    console.log(`   TX: ${BLOCK_EXPLORER_URL}/tx/${txHash}`);

    // Create or update LP record
    const lp = await prisma.liquidityProvider.upsert({
      where: { walletAddress: owner.toLowerCase() },
      create: {
        walletAddress: owner.toLowerCase(),
        totalDeposited: ethers.formatUnits(assets, 6),
        totalWithdrawn: '0',
        currentShares: ethers.formatEther(shares),
        totalYieldEarned: '0',
      },
      update: {
        totalDeposited: {
          increment: ethers.formatUnits(assets, 6),
        },
        currentShares: {
          increment: ethers.formatEther(shares),
        },
      },
    });

    // Create transaction record
    await prisma.liquidityTransaction.create({
      data: {
        lpId: lp.id,
        type: 'DEPOSIT',
        amount: ethers.formatUnits(assets, 6),
        shares: ethers.formatEther(shares),
        txHash,
        blockNumber: event.log.blockNumber,
      },
    });

    processedTxHashes.add(txHash);
    console.log('   ✅ Saved to database');
  } catch (error) {
    console.error('   ❌ Error processing deposit:', error.message);
  }
}

async function handleWithdraw(sender, receiver, owner, assets, shares, event) {
  const txHash = event.log.transactionHash;
  
  if (processedTxHashes.has(txHash)) {
    return;
  }

  try {
    console.log(`\n📤 Withdraw detected:`);
    console.log(`   Owner: ${owner}`);
    console.log(`   Assets: ${ethers.formatUnits(assets, 6)} USDC`);
    console.log(`   Shares: ${ethers.formatEther(shares)}`);
    console.log(`   TX: ${BLOCK_EXPLORER_URL}/tx/${txHash}`);

    // Update LP record
    const lp = await prisma.liquidityProvider.update({
      where: { walletAddress: owner.toLowerCase() },
      data: {
        totalWithdrawn: {
          increment: ethers.formatUnits(assets, 6),
        },
        currentShares: {
          decrement: ethers.formatEther(shares),
        },
      },
    });

    // Create transaction record
    await prisma.liquidityTransaction.create({
      data: {
        lpId: lp.id,
        type: 'WITHDRAW',
        amount: ethers.formatUnits(assets, 6),
        shares: ethers.formatEther(shares),
        txHash,
        blockNumber: event.log.blockNumber,
      },
    });

    processedTxHashes.add(txHash);
    console.log('   ✅ Saved to database');
  } catch (error) {
    console.error('   ❌ Error processing withdrawal:', error.message);
  }
}

async function syncRecentEvents() {
  try {
    const currentBlock = await provider.getBlockNumber();
    const fromBlock = currentBlock - 1000; // Last ~1000 blocks (~3-4 hours on Sepolia)

    console.log(`🔄 Syncing events from block ${fromBlock} to ${currentBlock}...`);

    const depositFilter = contract.filters.Deposit();
    const withdrawFilter = contract.filters.Withdraw();

    const [deposits, withdrawals] = await Promise.all([
      contract.queryFilter(depositFilter, fromBlock, currentBlock),
      contract.queryFilter(withdrawFilter, fromBlock, currentBlock),
    ]);

    console.log(`   Found ${deposits.length} deposits and ${withdrawals.length} withdrawals`);

    // Process historical events
    for (const event of deposits) {
      await handleDeposit(
        event.args.sender,
        event.args.owner,
        event.args.assets,
        event.args.shares,
        { log: event }
      );
    }

    for (const event of withdrawals) {
      await handleWithdraw(
        event.args.sender,
        event.args.receiver,
        event.args.owner,
        event.args.assets,
        event.args.shares,
        { log: event }
      );
    }

    console.log('✅ Historical sync complete\n');
  } catch (error) {
    console.error('⚠️  Failed to sync historical events:', error.message);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n\n👋 Shutting down event listener...');
  if (provider) {
    await provider.destroy();
  }
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  if (provider) {
    await provider.destroy();
  }
  await prisma.$disconnect();
  process.exit(0);
});

// Start the listener
console.log('🚀 Starting Liquidity Pool Event Listener\n');
start().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
