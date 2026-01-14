const { ethers } = require('ethers');

// Configuration
const RPC_URL = 'https://sepolia.infura.io/v3/fe392179799146c6843a7bad98228506';
const PRIVATE_KEY = '4be68c24d9142e6b053030e5c5c03adf49008f29b89ca035c88ad2fac58ee7bc';

// Contract Addresses
const USDC_ADDRESS = '0x6A9DA0D1a6fb3cFC4cf6AD2c39472726a41EeE9d';
const POOL_ADDRESS = '0xeaca1Aa5C5dBb9428abCDE4Db59F2618f98C9e51';
const IDENTITY_SBT_ADDRESS = '0xE6637a4477B7763826ddD032a02a0Fc7B43999f0';
const INVOICE_NFT_ADDRESS = '0xe2D65941f1Dc04661d3CF63Acff19E096fe8D59C';

// ABIs
const USDC_ABI = [
  'function mint(address to, uint256 amount) external',
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)'
];

const POOL_ABI = [
  'function totalAssets() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function deposit(uint256 assets, address receiver) external returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function availableForLoans() view returns (uint256)'
];

const SBT_ABI = [
  'function isVerifiedBusiness(address) view returns (bool)',
  'function totalSupply() view returns (uint256)',
  'function mint(address wallet, string businessId, uint8 riskTier, string metadataURI) external returns (uint256)'
];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  
  console.log('\n🚀 EIBS Full System Test');
  console.log('========================');
  console.log('Wallet:', wallet.address);
  
  const usdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, wallet);
  const pool = new ethers.Contract(POOL_ADDRESS, POOL_ABI, wallet);
  const sbt = new ethers.Contract(IDENTITY_SBT_ADDRESS, SBT_ABI, wallet);
  
  // Step 1: Check current state
  console.log('\n📊 Step 1: Current State');
  const usdcBalance = await usdc.balanceOf(wallet.address);
  console.log('  USDC Balance:', ethers.formatUnits(usdcBalance, 6), 'USDC');
  
  const isVerified = await sbt.isVerifiedBusiness(wallet.address);
  console.log('  KYB Verified:', isVerified);
  
  // Step 2: Mint SBT if not verified
  if (!isVerified) {
    console.log('\n🪪 Step 2: Minting IdentitySBT for KYB verification...');
    try {
      const tx = await sbt.mint(
        wallet.address,
        'BIZ-001',
        1, // Low risk
        'ipfs://test-metadata'
      );
      console.log('  TX sent:', tx.hash);
      await tx.wait();
      console.log('  ✅ SBT Minted! Wallet is now KYB verified.');
    } catch (e) {
      console.log('  ❌ Error:', e.message);
    }
  } else {
    console.log('\n✅ Step 2: Already KYB verified');
  }
  
  // Step 3: Approve USDC for pool
  console.log('\n💰 Step 3: Approving USDC for pool...');
  const depositAmount = ethers.parseUnits('10000', 6); // 10,000 USDC
  const allowance = await usdc.allowance(wallet.address, POOL_ADDRESS);
  
  if (allowance < depositAmount) {
    const approveTx = await usdc.approve(POOL_ADDRESS, ethers.MaxUint256);
    console.log('  TX sent:', approveTx.hash);
    await approveTx.wait();
    console.log('  ✅ USDC approved for pool');
  } else {
    console.log('  ✅ Already approved');
  }
  
  // Step 4: Deposit into pool
  console.log('\n🏦 Step 4: Depositing 10,000 USDC into pool...');
  const poolSharesBefore = await pool.balanceOf(wallet.address);
  
  if (poolSharesBefore === 0n) {
    try {
      const depositTx = await pool.deposit(depositAmount, wallet.address);
      console.log('  TX sent:', depositTx.hash);
      await depositTx.wait();
      console.log('  ✅ Deposit successful!');
    } catch (e) {
      console.log('  ❌ Error:', e.message);
    }
  } else {
    console.log('  ✅ Already have pool shares');
  }
  
  // Step 5: Final state
  console.log('\n📊 Step 5: Final State');
  const finalUsdcBalance = await usdc.balanceOf(wallet.address);
  const poolShares = await pool.balanceOf(wallet.address);
  const poolTotalAssets = await pool.totalAssets();
  const availableForLoans = await pool.availableForLoans();
  const finalIsVerified = await sbt.isVerifiedBusiness(wallet.address);
  
  console.log('  USDC Balance:', ethers.formatUnits(finalUsdcBalance, 6), 'USDC');
  console.log('  lUSDC Shares:', ethers.formatUnits(poolShares, 6), 'lUSDC');
  console.log('  Pool Total Assets:', ethers.formatUnits(poolTotalAssets, 6), 'USDC');
  console.log('  Available for Loans:', ethers.formatUnits(availableForLoans, 6), 'USDC');
  console.log('  KYB Verified:', finalIsVerified);
  
  console.log('\n✅ Test Complete!');
}

main().catch(console.error);
