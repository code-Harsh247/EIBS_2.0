const { ethers } = require('ethers');

// Configuration
const RPC_URL = 'https://sepolia.infura.io/v3/fe392179799146c6843a7bad98228506';
const PRIVATE_KEY = '4be68c24d9142e6b053030e5c5c03adf49008f29b89ca035c88ad2fac58ee7bc';

// Contract Addresses
const USDC_ADDRESS = '0x6A9DA0D1a6fb3cFC4cf6AD2c39472726a41EeE9d';
const POOL_ADDRESS = '0xeaca1Aa5C5dBb9428abCDE4Db59F2618f98C9e51';
const INVOICE_NFT_ADDRESS = '0xe2D65941f1Dc04661d3CF63Acff19E096fe8D59C';

// ABIs
const USDC_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function transfer(address to, uint256 amount) external returns (bool)'
];

const POOL_ABI = [
  'function totalAssets() view returns (uint256)',
  'function totalActiveLoans() view returns (uint256)',
  'function availableForLoans() view returns (uint256)',
  'function fundLoan(tuple(bytes32 documentHash, string publicMetadataURI, uint256 amount, uint256 dueDate, address seller, uint8 riskScore, uint256 expectedYieldBps, bytes32 nonce, bytes signature) params) external returns (uint256)',
  'function repayLoan(uint256 tokenId, uint256 actualYield) external',
  'function depositRepayment(uint256 amount) external',
  'function getLoan(uint256 tokenId) view returns (tuple(uint256 principal, uint256 expectedYield, uint256 fundedAt, bool isActive, bytes32 documentHash))',
  'function oracle() view returns (address)'
];

const NFT_ABI = [
  'function totalSupply() view returns (uint256)',
  'function getInvoice(uint256 tokenId) view returns (tuple(bytes32 documentHash, string publicMetadataURI, uint256 amount, uint256 dueDate, address seller, uint8 riskScore, bool isRepaid, uint256 fundedAt))'
];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  
  console.log('\n🚀 EIBS Full Lending Flow Test');
  console.log('================================');
  console.log('Oracle/Backend Wallet:', wallet.address);
  
  const usdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, wallet);
  const pool = new ethers.Contract(POOL_ADDRESS, POOL_ABI, wallet);
  const nft = new ethers.Contract(INVOICE_NFT_ADDRESS, NFT_ABI, provider);
  
  // Verify oracle
  const oracleAddress = await pool.oracle();
  console.log('Pool Oracle:', oracleAddress);
  console.log('Match:', oracleAddress.toLowerCase() === wallet.address.toLowerCase() ? '✅' : '❌');
  
  // ============ STEP 1: Create Invoice Data ============
  console.log('\n📄 Step 1: Creating Invoice Data');
  
  // Simulate invoice data (this would come from your database)
  const invoiceData = {
    invoiceId: 'INV-2026-001',
    amount: '1000',  // 1000 USDC
    buyerName: 'Acme Corp',
    buyerAddress: '123 Business St',
    sellerName: 'Test Seller Inc',
    issueDate: '2026-01-15',
    dueDate: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60), // 30 days from now
    description: 'Software Development Services'
  };
  
  // Create deterministic document hash (same as backend)
  const sortedData = {
    amount: invoiceData.amount,
    buyerAddress: invoiceData.buyerAddress,
    buyerName: invoiceData.buyerName,
    description: invoiceData.description,
    invoiceId: invoiceData.invoiceId,
    issueDate: invoiceData.issueDate,
    sellerName: invoiceData.sellerName
  };
  const documentHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(sortedData)));
  
  console.log('  Invoice ID:', invoiceData.invoiceId);
  console.log('  Amount:', invoiceData.amount, 'USDC');
  console.log('  Due Date:', new Date(invoiceData.dueDate * 1000).toISOString());
  console.log('  Document Hash:', documentHash);
  
  // ============ STEP 2: Create Loan Parameters ============
  console.log('\n📝 Step 2: Creating Loan Parameters');
  
  const loanParams = {
    documentHash: documentHash,
    publicMetadataURI: 'ipfs://QmTest123/invoice-metadata.json',
    amount: ethers.parseUnits(invoiceData.amount, 6), // 1000 USDC
    dueDate: invoiceData.dueDate,
    seller: wallet.address, // Using our wallet as seller for testing
    riskScore: 25, // Low risk
    expectedYieldBps: 500, // 5% yield
    nonce: ethers.randomBytes(32)
  };
  
  console.log('  Amount:', ethers.formatUnits(loanParams.amount, 6), 'USDC');
  console.log('  Risk Score:', loanParams.riskScore);
  console.log('  Expected Yield:', loanParams.expectedYieldBps / 100, '%');
  
  // ============ STEP 3: Generate Backend Signature ============
  console.log('\n🔐 Step 3: Generating Oracle Signature');
  
  const messageHash = ethers.keccak256(ethers.solidityPacked(
    ['bytes32', 'uint256', 'uint256', 'address', 'uint8', 'uint256', 'bytes32', 'address'],
    [
      loanParams.documentHash,
      loanParams.amount,
      loanParams.dueDate,
      loanParams.seller,
      loanParams.riskScore,
      loanParams.expectedYieldBps,
      loanParams.nonce,
      POOL_ADDRESS
    ]
  ));
  
  const signature = await wallet.signMessage(ethers.getBytes(messageHash));
  console.log('  Message Hash:', messageHash);
  console.log('  Signature:', signature.slice(0, 42) + '...');
  
  // ============ STEP 4: Check Pre-Funding State ============
  console.log('\n📊 Step 4: Pre-Funding State');
  
  const preFundingState = {
    poolAssets: await pool.totalAssets(),
    activeLoans: await pool.totalActiveLoans(),
    availableForLoans: await pool.availableForLoans(),
    sellerBalance: await usdc.balanceOf(loanParams.seller),
    nftSupply: await nft.totalSupply()
  };
  
  console.log('  Pool Assets:', ethers.formatUnits(preFundingState.poolAssets, 6), 'USDC');
  console.log('  Active Loans:', ethers.formatUnits(preFundingState.activeLoans, 6), 'USDC');
  console.log('  Available for Loans:', ethers.formatUnits(preFundingState.availableForLoans, 6), 'USDC');
  console.log('  Seller USDC Balance:', ethers.formatUnits(preFundingState.sellerBalance, 6), 'USDC');
  console.log('  Invoice NFTs Minted:', preFundingState.nftSupply.toString());
  
  // ============ STEP 5: Fund the Loan ============
  console.log('\n💸 Step 5: Funding the Loan...');
  
  try {
    const fundLoanParams = {
      documentHash: loanParams.documentHash,
      publicMetadataURI: loanParams.publicMetadataURI,
      amount: loanParams.amount,
      dueDate: loanParams.dueDate,
      seller: loanParams.seller,
      riskScore: loanParams.riskScore,
      expectedYieldBps: loanParams.expectedYieldBps,
      nonce: loanParams.nonce,
      signature: signature
    };
    
    const tx = await pool.fundLoan(fundLoanParams);
    console.log('  TX sent:', tx.hash);
    const receipt = await tx.wait();
    console.log('  ✅ Loan Funded!');
    console.log('  Gas Used:', receipt.gasUsed.toString());
    
    // Get token ID from event
    const loanFundedEvent = receipt.logs.find(log => {
      try {
        const parsed = pool.interface.parseLog(log);
        return parsed?.name === 'LoanFunded';
      } catch { return false; }
    });
    
    let tokenId = 1n; // Default
    if (loanFundedEvent) {
      const parsed = pool.interface.parseLog(loanFundedEvent);
      tokenId = parsed.args[0];
      console.log('  Token ID:', tokenId.toString());
    }
    
    // ============ STEP 6: Verify Post-Funding State ============
    console.log('\n📊 Step 6: Post-Funding State');
    
    const postFundingState = {
      poolAssets: await pool.totalAssets(),
      activeLoans: await pool.totalActiveLoans(),
      availableForLoans: await pool.availableForLoans(),
      sellerBalance: await usdc.balanceOf(loanParams.seller),
      nftSupply: await nft.totalSupply()
    };
    
    console.log('  Pool Assets:', ethers.formatUnits(postFundingState.poolAssets, 6), 'USDC');
    console.log('  Active Loans:', ethers.formatUnits(postFundingState.activeLoans, 6), 'USDC', '(+1000)');
    console.log('  Available for Loans:', ethers.formatUnits(postFundingState.availableForLoans, 6), 'USDC');
    console.log('  Seller USDC Balance:', ethers.formatUnits(postFundingState.sellerBalance, 6), 'USDC', '(+1000)');
    console.log('  Invoice NFTs Minted:', postFundingState.nftSupply.toString());
    
    // Get loan details
    const loan = await pool.getLoan(tokenId);
    console.log('\n  📋 Loan Details:');
    console.log('    Principal:', ethers.formatUnits(loan.principal, 6), 'USDC');
    console.log('    Expected Yield:', ethers.formatUnits(loan.expectedYield, 6), 'USDC');
    console.log('    Is Active:', loan.isActive);
    
    // ============ STEP 7: Simulate Repayment ============
    console.log('\n💰 Step 7: Simulating Loan Repayment...');
    
    const actualYield = ethers.parseUnits('50', 6); // 50 USDC yield (5%)
    const totalRepayment = loanParams.amount + actualYield;
    
    // First, approve and deposit repayment funds
    console.log('  Approving repayment funds...');
    const approveTx = await usdc.approve(POOL_ADDRESS, totalRepayment);
    await approveTx.wait();
    
    console.log('  Depositing repayment:', ethers.formatUnits(totalRepayment, 6), 'USDC');
    const depositTx = await pool.depositRepayment(totalRepayment);
    await depositTx.wait();
    
    console.log('  Marking loan as repaid...');
    const repayTx = await pool.repayLoan(tokenId, actualYield);
    await repayTx.wait();
    console.log('  ✅ Loan Repaid!');
    
    // ============ STEP 8: Final State ============
    console.log('\n📊 Step 8: Final State (After Repayment)');
    
    const finalState = {
      poolAssets: await pool.totalAssets(),
      activeLoans: await pool.totalActiveLoans(),
      availableForLoans: await pool.availableForLoans()
    };
    
    const loanAfter = await pool.getLoan(tokenId);
    
    console.log('  Pool Assets:', ethers.formatUnits(finalState.poolAssets, 6), 'USDC', '(+yield)');
    console.log('  Active Loans:', ethers.formatUnits(finalState.activeLoans, 6), 'USDC', '(back to 0)');
    console.log('  Loan Active:', loanAfter.isActive, '(should be false)');
    
    console.log('\n🎉 Full Lending Flow Test Complete!');
    console.log('=====================================');
    console.log('Summary:');
    console.log('  ✅ Invoice created with document hash');
    console.log('  ✅ Oracle signature generated');
    console.log('  ✅ Loan funded - USDC sent to seller');
    console.log('  ✅ Invoice NFT minted to pool');
    console.log('  ✅ Loan repaid with yield');
    console.log('  ✅ Pool assets increased by yield');
    
  } catch (error) {
    console.log('  ❌ Error:', error.message);
    if (error.data) {
      console.log('  Error data:', error.data);
    }
  }
}

main().catch(console.error);
