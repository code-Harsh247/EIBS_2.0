import { ethers, Wallet, Contract, JsonRpcProvider } from 'ethers';
import { LIQUIDITY_POOL_ABI, INVOICE_NFT_ABI, ERC20_ABI } from '@/lib/contract-abis';
import crypto from 'crypto';

// Contract addresses (set via environment variables)
const LIQUIDITY_POOL_ADDRESS = process.env.LIQUIDITY_POOL_ADDRESS || '';
const INVOICE_NFT_ADDRESS = process.env.INVOICE_NFT_ADDRESS || '';
const USDC_ADDRESS = process.env.USDC_ADDRESS || '';
const BLOCKCHAIN_RPC_URL = process.env.BLOCKCHAIN_RPC_URL || '';
const PRIVATE_KEY = process.env.PRIVATE_KEY || '';

// Risk-based yield rates (in basis points)
// Lower risk = lower yield, higher risk = higher yield
const YIELD_RATES: Record<string, number> = {
  'AAA': 200,   // 2% yield for lowest risk
  'AA': 300,    // 3%
  'A': 400,     // 4%
  'BBB': 600,   // 6%
  'BB': 800,    // 8%
  'B': 1000,    // 10%
  'CCC': 1500,  // 15% for highest acceptable risk
};

// Risk score to rating mapping
function riskScoreToRating(score: number): string {
  if (score <= 10) return 'AAA';
  if (score <= 20) return 'AA';
  if (score <= 35) return 'A';
  if (score <= 50) return 'BBB';
  if (score <= 65) return 'BB';
  if (score <= 80) return 'B';
  return 'CCC';
}

function getProvider(): JsonRpcProvider {
  if (!BLOCKCHAIN_RPC_URL) {
    throw new Error('BLOCKCHAIN_RPC_URL not configured');
  }
  return new ethers.JsonRpcProvider(BLOCKCHAIN_RPC_URL);
}

function getSigner(): Wallet {
  if (!PRIVATE_KEY) {
    throw new Error('PRIVATE_KEY not configured');
  }
  return new ethers.Wallet(PRIVATE_KEY, getProvider());
}

function getLiquidityPoolContract(signerOrProvider?: Wallet | JsonRpcProvider): Contract {
  if (!LIQUIDITY_POOL_ADDRESS) {
    throw new Error('LIQUIDITY_POOL_ADDRESS not configured');
  }
  return new ethers.Contract(
    LIQUIDITY_POOL_ADDRESS,
    LIQUIDITY_POOL_ABI,
    signerOrProvider || getProvider()
  );
}

function getInvoiceNFTContract(signerOrProvider?: Wallet | JsonRpcProvider): Contract {
  if (!INVOICE_NFT_ADDRESS) {
    throw new Error('INVOICE_NFT_ADDRESS not configured');
  }
  return new ethers.Contract(
    INVOICE_NFT_ADDRESS,
    INVOICE_NFT_ABI,
    signerOrProvider || getProvider()
  );
}

function getUSDCContract(signerOrProvider?: Wallet | JsonRpcProvider): Contract {
  if (!USDC_ADDRESS) {
    throw new Error('USDC_ADDRESS not configured');
  }
  return new ethers.Contract(
    USDC_ADDRESS,
    ERC20_ABI,
    signerOrProvider || getProvider()
  );
}

export interface PoolStats {
  totalAssets: string;
  totalSupply: string;
  totalActiveLoans: string;
  availableForLoans: string;
  utilizationRate: number;
  estimatedAPY: number;
  maxUtilization: number;
  protocolFee: number;
}

export interface LoanSignatureData {
  documentHash: string;  // Privacy: SHA256 of invoice document
  amount: string;        // In USDC units (6 decimals)
  dueDate: number;
  seller: string;
  riskScore: number;
  expectedYieldBps: number;
  nonce: string;
  signature: string;
  publicMetadataURI: string;  // IPFS URI for non-sensitive metadata
}

export interface LoanInfo {
  tokenId: string;
  documentHash: string;
  principal: string;
  expectedYield: string;
  fundedAt: number;
  isActive: boolean;
  dueDate: number;
  seller: string;
  riskScore: number;
}

class LiquidityPoolService {
  /**
   * Get pool statistics
   */
  async getPoolStats(): Promise<PoolStats> {
    const pool = getLiquidityPoolContract();
    
    const [
      totalAssets,
      totalSupply,
      totalActiveLoans,
      availableForLoans,
      utilizationRate,
      estimatedAPY,
      maxUtilizationBps,
      protocolFeeBps
    ] = await Promise.all([
      pool.totalAssets(),
      pool.totalSupply(),
      pool.totalActiveLoans(),
      pool.availableForLoans(),
      pool.utilizationRate(),
      pool.estimatedAPY(),
      pool.maxUtilizationBps(),
      pool.protocolFeeBps()
    ]);

    return {
      totalAssets: ethers.formatUnits(totalAssets, 6),
      totalSupply: ethers.formatUnits(totalSupply, 6),
      totalActiveLoans: ethers.formatUnits(totalActiveLoans, 6),
      availableForLoans: ethers.formatUnits(availableForLoans, 6),
      utilizationRate: Number(utilizationRate) / 100, // Convert bps to percentage
      estimatedAPY: Number(estimatedAPY) / 100,
      maxUtilization: Number(maxUtilizationBps) / 100,
      protocolFee: Number(protocolFeeBps) / 100
    };
  }

  /**
   * Get LP balance (shares and underlying value)
   */
  async getLPBalance(address: string): Promise<{
    shares: string;
    underlyingValue: string;
    maxWithdraw: string;
  }> {
    const pool = getLiquidityPoolContract();
    
    const [shares, underlyingValue, maxWithdraw] = await Promise.all([
      pool.balanceOf(address),
      pool.convertToAssets(await pool.balanceOf(address)),
      pool.maxWithdraw(address)
    ]);

    return {
      shares: ethers.formatUnits(shares, 6),
      underlyingValue: ethers.formatUnits(underlyingValue, 6),
      maxWithdraw: ethers.formatUnits(maxWithdraw, 6)
    };
  }

  /**
   * Calculate expected yield for an invoice based on risk score
   */
  calculateExpectedYield(amount: bigint, riskScore: number): {
    yieldBps: number;
    yieldAmount: string;
    rating: string;
  } {
    const rating = riskScoreToRating(riskScore);
    const yieldBps = YIELD_RATES[rating] || YIELD_RATES['BBB'];
    const yieldAmount = (amount * BigInt(yieldBps)) / BigInt(10000);

    return {
      yieldBps,
      yieldAmount: ethers.formatUnits(yieldAmount, 6),
      rating
    };
  }

  /**
   * Generate a signed loan approval for an invoice
   * This is called by the backend to authorize funding
   * @param documentHash - SHA256 hash of the invoice document (privacy-preserving)
   * @param amountUsdc - Amount in USDC
   * @param dueDate - Unix timestamp of due date
   * @param sellerAddress - Seller's wallet address
   * @param riskScore - Risk score 0-100
   * @param publicMetadataURI - IPFS URI for non-sensitive metadata
   */
  async generateLoanSignature(
    documentHash: string,
    amountUsdc: string,
    dueDate: number,
    sellerAddress: string,
    riskScore: number,
    publicMetadataURI: string
  ): Promise<LoanSignatureData> {
    // Validate inputs
    if (riskScore < 0 || riskScore > 100) {
      throw new Error('Risk score must be between 0 and 100');
    }
    if (dueDate <= Math.floor(Date.now() / 1000)) {
      throw new Error('Due date must be in the future');
    }
    if (!ethers.isAddress(sellerAddress)) {
      throw new Error('Invalid seller address');
    }
    // Validate documentHash is a proper bytes32 hex string
    if (!/^0x[0-9a-fA-F]{64}$/.test(documentHash)) {
      throw new Error('Invalid document hash: must be a 32-byte hex string');
    }

    const amount = ethers.parseUnits(amountUsdc, 6);
    const { yieldBps } = this.calculateExpectedYield(amount, riskScore);

    // Generate unique nonce
    const nonce = '0x' + crypto.randomBytes(32).toString('hex');

    // Create message hash matching contract's expected format (privacy-preserving)
    // Note: No buyer address, no invoiceId - only documentHash for privacy
    const messageHash = ethers.solidityPackedKeccak256(
      ['bytes32', 'uint256', 'uint256', 'address', 'uint8', 'uint256', 'bytes32', 'address'],
      [documentHash, amount, dueDate, sellerAddress, riskScore, yieldBps, nonce, LIQUIDITY_POOL_ADDRESS]
    );

    // Sign the message
    const signer = getSigner();
    const signature = await signer.signMessage(ethers.getBytes(messageHash));

    return {
      documentHash,
      amount: amountUsdc,
      dueDate,
      seller: sellerAddress,
      riskScore,
      expectedYieldBps: yieldBps,
      nonce,
      signature,
      publicMetadataURI
    };
  }

  /**
   * Repay a loan (called when fiat payment is received)
   */
  async repayLoan(
    tokenId: string,
    actualYieldUsdc: string
  ): Promise<{ transactionHash: string }> {
    const signer = getSigner();
    const pool = getLiquidityPoolContract(signer);
    const usdc = getUSDCContract(signer);

    // Get loan info to calculate total repayment
    const loan = await pool.getLoan(tokenId);
    if (!loan.isActive) {
      throw new Error('Loan is not active');
    }

    const actualYield = ethers.parseUnits(actualYieldUsdc, 6);
    const totalRepayment = loan.principal + actualYield;

    // First, deposit the repayment funds to the pool
    // (Oracle must have USDC balance)
    const depositTx = await usdc.approve(LIQUIDITY_POOL_ADDRESS, totalRepayment);
    await depositTx.wait();

    const depositRepaymentTx = await pool.depositRepayment(totalRepayment);
    await depositRepaymentTx.wait();

    // Then mark the loan as repaid
    const repayTx = await pool.repayLoan(tokenId, actualYield);
    const receipt = await repayTx.wait();

    return {
      transactionHash: receipt.hash
    };
  }

  /**
   * Get loan details by token ID
   */
  async getLoanByTokenId(tokenId: string): Promise<LoanInfo> {
    const pool = getLiquidityPoolContract();
    const nft = getInvoiceNFTContract();

    const [loan, invoice] = await Promise.all([
      pool.getLoan(tokenId),
      nft.getInvoice(tokenId)
    ]);

    return {
      tokenId,
      documentHash: invoice.documentHash,
      principal: ethers.formatUnits(loan.principal, 6),
      expectedYield: ethers.formatUnits(loan.expectedYield, 6),
      fundedAt: Number(loan.fundedAt),
      isActive: loan.isActive,
      dueDate: Number(invoice.dueDate),
      seller: invoice.seller,
      riskScore: Number(invoice.riskScore)
    };
  }

  /**
   * Get loan details by document hash
   */
  async getLoanByDocumentHash(documentHash: string): Promise<LoanInfo | null> {
    const nft = getInvoiceNFTContract();

    try {
      const tokenId = await nft.getTokenIdByDocumentHash(documentHash);
      return this.getLoanByTokenId(tokenId.toString());
    } catch {
      return null; // Invoice not funded yet
    }
  }

  /**
   * Check if a document has been funded (prevents double-financing)
   */
  async isDocumentFunded(documentHash: string): Promise<boolean> {
    const nft = getInvoiceNFTContract();
    try {
      return await nft.isDocumentFinanced(documentHash);
    } catch {
      return false;
    }
  }

  /**
   * Preview deposit (how many shares for X assets)
   */
  async previewDeposit(amountUsdc: string): Promise<{ shares: string }> {
    const pool = getLiquidityPoolContract();
    const amount = ethers.parseUnits(amountUsdc, 6);
    const shares = await pool.previewDeposit(amount);
    return { shares: ethers.formatUnits(shares, 6) };
  }

  /**
   * Preview withdraw (how many shares to burn for X assets)
   */
  async previewWithdraw(amountUsdc: string): Promise<{ shares: string }> {
    const pool = getLiquidityPoolContract();
    const amount = ethers.parseUnits(amountUsdc, 6);
    const shares = await pool.previewWithdraw(amount);
    return { shares: ethers.formatUnits(shares, 6) };
  }

  /**
   * Preview redeem (how many assets for X shares)
   */
  async previewRedeem(sharesAmount: string): Promise<{ assets: string }> {
    const pool = getLiquidityPoolContract();
    const shares = ethers.parseUnits(sharesAmount, 6);
    const assets = await pool.previewRedeem(shares);
    return { assets: ethers.formatUnits(assets, 6) };
  }

  /**
   * Get contract addresses (for frontend)
   */
  getContractAddresses(): {
    liquidityPool: string;
    invoiceNFT: string;
    usdc: string;
  } {
    return {
      liquidityPool: LIQUIDITY_POOL_ADDRESS,
      invoiceNFT: INVOICE_NFT_ADDRESS,
      usdc: USDC_ADDRESS
    };
  }
}

export const liquidityPoolService = new LiquidityPoolService();
