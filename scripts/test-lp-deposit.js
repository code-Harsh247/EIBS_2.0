/**
 * Test script for LP deposit
 * Deposits USDC into the liquidity pool and triggers event listener
 */

const { ethers } = require('ethers');
require('dotenv').config();

const LIQUIDITY_POOL_ABI = [
  "function deposit(uint256 assets, address receiver) external returns (uint256)",
  "function totalAssets() external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)"
];

const USDC_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)"
];

async function testDeposit() {
  try {
    // Configuration
    const poolAddress = process.env.LIQUIDITY_POOL_ADDRESS;
    const usdcAddress = process.env.USDC_ADDRESS;
    const privateKey = process.env.PRIVATE_KEY;
    
    // Convert WebSocket URL to HTTP
    let rpcUrl = process.env.BLOCKCHAIN_RPC_URL;
    if (rpcUrl.startsWith('wss://')) {
      rpcUrl = rpcUrl.replace('wss://', 'https://').replace('/ws/', '/v3/');
    }

    if (!poolAddress || !usdcAddress || !privateKey || !rpcUrl) {
      console.error('❌ Missing required environment variables:');
      if (!poolAddress) console.error('   - LIQUIDITY_POOL_ADDRESS');
      if (!usdcAddress) console.error('   - USDC_ADDRESS');
      if (!privateKey) console.error('   - PRIVATE_KEY');
      if (!rpcUrl) console.error('   - BLOCKCHAIN_RPC_URL');
      process.exit(1);
    }

    // Connect to blockchain
    console.log('🔌 Connecting to Sepolia testnet...');
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    
    const pool = new ethers.Contract(poolAddress, LIQUIDITY_POOL_ABI, wallet);
    const usdc = new ethers.Contract(usdcAddress, USDC_ABI, wallet);
    
    // Get wallet balance
    const usdcBalance = await usdc.balanceOf(wallet.address);
    const usdcDecimals = await usdc.decimals();
    
    console.log('✅ Connected to blockchain');
    console.log('📍 Wallet Address:', wallet.address);
    console.log('💰 USDC Balance:', ethers.formatUnits(usdcBalance, usdcDecimals), 'USDC');
    console.log('📍 Pool Address:', poolAddress);
    console.log('📍 USDC Address:', usdcAddress);
    
    // Deposit amount (default 1000 USDC, or specify via command line)
    const depositAmountUSDC = process.argv[2] ? parseFloat(process.argv[2]) : 1000;
    const depositAmount = ethers.parseUnits(depositAmountUSDC.toString(), usdcDecimals);
    
    if (usdcBalance < depositAmount) {
      console.error('❌ Insufficient USDC balance');
      console.error(`   Required: ${depositAmountUSDC} USDC`);
      console.error(`   Available: ${ethers.formatUnits(usdcBalance, usdcDecimals)} USDC`);
      console.log('\n💡 Get test USDC from: https://faucet.circle.com/');
      process.exit(1);
    }
    
    console.log('\n💰 Testing LP Deposit...');
    console.log('   Amount:', depositAmountUSDC, 'USDC');
    
    // Step 1: Approve USDC
    console.log('\n1️⃣  Approving USDC...');
    const approveTx = await usdc.approve(poolAddress, depositAmount);
    console.log('   TX Hash:', approveTx.hash);
    console.log('   Waiting for confirmation...');
    await approveTx.wait();
    console.log('   ✅ Approved!');
    
    // Step 2: Deposit
    console.log('\n2️⃣  Depositing USDC to pool...');
    const depositTx = await pool.deposit(depositAmount, wallet.address);
    console.log('   TX Hash:', depositTx.hash);
    console.log('   Waiting for confirmation...');
    
    const receipt = await depositTx.wait();
    console.log('   ✅ Deposit confirmed!');
    console.log('   Block:', receipt.blockNumber);
    console.log('   Gas used:', receipt.gasUsed.toString());
    
    // Check new share balance
    const shares = await pool.balanceOf(wallet.address);
    console.log('   Your Shares:', ethers.formatEther(shares));
    
    // Explorer link
    const explorerUrl = process.env.BLOCK_EXPLORER_URL || 'https://sepolia.etherscan.io';
    console.log('\n🔍 View on Explorer:');
    console.log(`   ${explorerUrl}/tx/${depositTx.hash}`);
    
    console.log('\n✨ Success! Check your event listener logs for:');
    console.log('   💰 Deposit detected:');
    console.log(`      Owner: ${wallet.address}`);
    console.log(`      Assets: ${depositAmountUSDC} USDC`);
    console.log('      ✅ Saved to database');
    
    console.log('\n📊 Verify in API:');
    console.log(`   GET http://localhost:3000/api/pool/my-position?address=${wallet.address}`);
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.code === 'INSUFFICIENT_FUNDS') {
      console.log('\n💡 You need Sepolia ETH for gas fees');
      console.log('   Get from: https://sepoliafaucet.com/');
    }
    process.exit(1);
  }
}

console.log('🚀 LP Deposit Test Script\n');
testDeposit();
