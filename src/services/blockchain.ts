import { ethers } from 'ethers';
import CryptoJS from 'crypto-js';
import { prisma } from '../lib/prisma';
import { Invoice, InvoiceItem, BlockchainTxStatus } from '@prisma/client';

// Contract ABI for Invoice Verification
const INVOICE_CONTRACT_ABI = [
  'function recordInvoice(bytes32 invoiceHash, string calldata invoiceId) external',
  'function verifyInvoice(bytes32 invoiceHash) external view returns (bool exists, uint256 timestamp, address recorder)',
  'function getInvoiceRecord(string calldata invoiceId) external view returns (bytes32 hash, uint256 timestamp, address recorder)',
  'event InvoiceRecorded(bytes32 indexed invoiceHash, string invoiceId, address indexed recorder, uint256 timestamp)',
];

export interface InvoiceHashData {
  invoiceNumber: string;
  sellerId: string;
  buyerId: string;
  totalAmount: string;
  issueDate: string;
  items: Array<{
    description: string;
    quantity: string;
    unitPrice: string;
    amount: string;
  }>;
}

export interface BlockchainConfig {
  rpcUrl: string;
  privateKey: string;
  contractAddress: string;
  networkId: string;
}

export interface VerificationResult {
  isValid: boolean;
  storedHash?: string;
  currentHash?: string;
  timestamp?: Date;
  recorder?: string;
  message: string;
}

export class BlockchainService {
  private provider: ethers.JsonRpcProvider | null = null;
  private wallet: ethers.Wallet | null = null;
  private contract: ethers.Contract | null = null;
  private config: BlockchainConfig;

  constructor() {
    // Convert WebSocket URL to HTTP for JsonRpcProvider
    const rpcUrl = process.env.BLOCKCHAIN_RPC_URL || '';
    const httpRpcUrl = rpcUrl.startsWith('wss://') 
      ? rpcUrl.replace('wss://', 'https://').replace('/ws/', '/v3/')
      : rpcUrl;
    
    this.config = {
      rpcUrl: httpRpcUrl,
      privateKey: process.env.PRIVATE_KEY || '',
      contractAddress: process.env.CONTRACT_ADDRESS || '',
      networkId: process.env.BLOCKCHAIN_NETWORK || 'sepolia',
    };
  }

  // Initialize blockchain connection
  private async initialize(): Promise<boolean> {
    if (!this.config.rpcUrl || !this.config.privateKey) {
      console.warn('Blockchain configuration missing. Running in simulation mode.');
      return false;
    }

    try {
      this.provider = new ethers.JsonRpcProvider(this.config.rpcUrl);
      this.wallet = new ethers.Wallet(this.config.privateKey, this.provider);
      
      if (this.config.contractAddress) {
        this.contract = new ethers.Contract(
          this.config.contractAddress,
          INVOICE_CONTRACT_ABI,
          this.wallet
        );
      }
      return true;
    } catch (error) {
      console.error('Failed to initialize blockchain connection:', error);
      return false;
    }
  }

  // Generate SHA-256 hash of invoice data
  static generateInvoiceHash(invoice: Invoice & { items: InvoiceItem[] }): string {
    const hashData: InvoiceHashData = {
      invoiceNumber: invoice.invoiceNumber,
      sellerId: invoice.sellerId,
      buyerId: invoice.buyerId,
      totalAmount: invoice.totalAmount.toString(),
      issueDate: invoice.issueDate.toISOString(),
      items: invoice.items.map((item) => ({
        description: item.description,
        quantity: item.quantity.toString(),
        unitPrice: item.unitPrice.toString(),
        amount: item.amount.toString(),
      })),
    };

    const jsonString = JSON.stringify(hashData, Object.keys(hashData).sort());
    return CryptoJS.SHA256(jsonString).toString(CryptoJS.enc.Hex);
  }

  // Record invoice on blockchain
  async recordInvoice(invoiceId: string): Promise<{
    success: boolean;
    transactionHash?: string;
    invoiceHash?: string;
    error?: string;
  }> {
    try {
      // Get invoice with items
      const invoice = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: { items: true },
      });

      if (!invoice) {
        return { success: false, error: 'Invoice not found' };
      }

      // Generate hash
      const invoiceHash = BlockchainService.generateInvoiceHash(invoice);
      const hashBytes32 = '0x' + invoiceHash;

      const isConnected = await this.initialize();

      if (!isConnected || !this.contract) {
        // Simulation mode - store locally without blockchain
        const simulatedTxHash = '0x' + CryptoJS.SHA256(invoiceHash + Date.now()).toString();

        await prisma.$transaction([
          prisma.blockchainTransaction.create({
            data: {
              invoiceId: invoice.id,
              transactionHash: simulatedTxHash,
              networkId: 'simulation',
              invoiceHash: invoiceHash,
              status: BlockchainTxStatus.CONFIRMED,
              confirmedAt: new Date(),
            },
          }),
          prisma.invoice.update({
            where: { id: invoice.id },
            data: {
              blockchainHash: invoiceHash,
              blockchainTxId: simulatedTxHash,
              isVerified: true,
              verifiedAt: new Date(),
            },
          }),
        ]);

        return {
          success: true,
          transactionHash: simulatedTxHash,
          invoiceHash: invoiceHash,
        };
      }

      // Create pending transaction record
      const txRecord = await prisma.blockchainTransaction.create({
        data: {
          invoiceId: invoice.id,
          transactionHash: 'pending',
          networkId: this.config.networkId,
          invoiceHash: invoiceHash,
          status: BlockchainTxStatus.PENDING,
        },
      });

      // Send transaction to blockchain
      const tx = await this.contract.recordInvoice(hashBytes32, invoice.invoiceNumber);
      const receipt = await tx.wait();

      // Update transaction record
      await prisma.$transaction([
        prisma.blockchainTransaction.update({
          where: { id: txRecord.id },
          data: {
            transactionHash: receipt.hash,
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed.toString(),
            status: BlockchainTxStatus.CONFIRMED,
            confirmedAt: new Date(),
          },
        }),
        prisma.invoice.update({
          where: { id: invoice.id },
          data: {
            blockchainHash: invoiceHash,
            blockchainTxId: receipt.hash,
            isVerified: true,
            verifiedAt: new Date(),
          },
        }),
      ]);

      return {
        success: true,
        transactionHash: receipt.hash,
        invoiceHash: invoiceHash,
      };
    } catch (error) {
      console.error('Error recording invoice on blockchain:', error);
      
      // Update transaction status to failed if exists
      if (invoiceId) {
        await prisma.blockchainTransaction.updateMany({
          where: { 
            invoiceId,
            status: BlockchainTxStatus.PENDING,
          },
          data: {
            status: BlockchainTxStatus.FAILED,
            errorMessage: error instanceof Error ? error.message : 'Unknown error',
          },
        });
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to record on blockchain',
      };
    }
  }

  // Verify invoice hash against blockchain
  async verifyInvoice(invoiceId: string): Promise<VerificationResult> {
    try {
      const invoice = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: { 
          items: true,
          blockchainTx: true,
        },
      });

      if (!invoice) {
        return { isValid: false, message: 'Invoice not found' };
      }

      if (!invoice.blockchainHash || !invoice.blockchainTx) {
        return { isValid: false, message: 'Invoice has not been recorded on blockchain' };
      }

      // Regenerate hash from current invoice data
      const currentHash = BlockchainService.generateInvoiceHash(invoice);
      const storedHash = invoice.blockchainHash;

      // Compare hashes
      const isValid = currentHash === storedHash;

      const isConnected = await this.initialize();

      if (isConnected && this.contract) {
        // Verify against actual blockchain
        try {
          const hashBytes32 = '0x' + storedHash;
          const [exists, timestamp, recorder] = await this.contract.verifyInvoice(hashBytes32);

          if (!exists) {
            return {
              isValid: false,
              storedHash,
              currentHash,
              message: 'Invoice hash not found on blockchain',
            };
          }

          return {
            isValid,
            storedHash,
            currentHash,
            timestamp: new Date(Number(timestamp) * 1000),
            recorder,
            message: isValid 
              ? 'Invoice verified successfully on blockchain'
              : 'Invoice data has been modified since blockchain recording',
          };
        } catch (error) {
          console.error('Blockchain verification error:', error);
        }
      }

      // Local verification (simulation mode)
      return {
        isValid,
        storedHash,
        currentHash,
        timestamp: invoice.blockchainTx.confirmedAt || undefined,
        message: isValid
          ? 'Invoice hash verified successfully (local verification)'
          : 'Invoice data has been modified since recording',
      };
    } catch (error) {
      console.error('Error verifying invoice:', error);
      return {
        isValid: false,
        message: error instanceof Error ? error.message : 'Verification failed',
      };
    }
  }

  // Get blockchain transaction details
  async getTransactionDetails(invoiceId: string) {
    const transaction = await prisma.blockchainTransaction.findUnique({
      where: { invoiceId },
      include: {
        invoice: {
          select: {
            invoiceNumber: true,
            totalAmount: true,
          },
        },
      },
    });

    if (!transaction) {
      return null;
    }

    return {
      transactionHash: transaction.transactionHash,
      blockNumber: transaction.blockNumber,
      networkId: transaction.networkId,
      invoiceHash: transaction.invoiceHash,
      status: transaction.status,
      gasUsed: transaction.gasUsed,
      createdAt: transaction.createdAt,
      confirmedAt: transaction.confirmedAt,
      invoice: transaction.invoice,
    };
  }

  // Batch verify multiple invoices
  async batchVerify(invoiceIds: string[]): Promise<Map<string, VerificationResult>> {
    const results = new Map<string, VerificationResult>();

    for (const id of invoiceIds) {
      const result = await this.verifyInvoice(id);
      results.set(id, result);
    }

    return results;
  }

  /**
   * Sign a document hash with the admin private key
   * Used for PDF-enhanced invoice verification
   * 
   * @param documentHash - The hash to sign (0x prefixed)
   * @returns Signature object with signature, signer address, and timestamp
   */
  async signDocumentHash(documentHash: string): Promise<{
    success: boolean;
    signature?: string;
    signerAddress?: string;
    timestamp?: number;
    error?: string;
  }> {
    try {
      const isConnected = await this.initialize();

      if (!isConnected || !this.wallet) {
        // Simulation mode
        const timestamp = Date.now();
        const simulatedSignature = '0x' + CryptoJS.SHA256(documentHash + timestamp).toString() + 
          CryptoJS.SHA256('simulation').toString().slice(0, 64);
        
        return {
          success: true,
          signature: simulatedSignature,
          signerAddress: '0x' + CryptoJS.SHA256('simulation-address').toString().slice(0, 40),
          timestamp,
        };
      }

      const timestamp = Date.now();
      
      // Create message to sign: documentHash + timestamp
      const messageHash = ethers.solidityPackedKeccak256(
        ['bytes32', 'uint256'],
        [documentHash, timestamp]
      );

      // Sign the message
      const signature = await this.wallet.signMessage(ethers.getBytes(messageHash));
      const signerAddress = await this.wallet.getAddress();

      return {
        success: true,
        signature,
        signerAddress,
        timestamp,
      };
    } catch (error) {
      console.error('Document signing error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Signing failed',
      };
    }
  }

  /**
   * Verify a document hash signature
   * 
   * @param documentHash - The original hash that was signed
   * @param signature - The signature to verify
   * @param timestamp - The timestamp used in signing
   * @returns Verification result with recovered signer address
   */
  async verifyDocumentSignature(
    documentHash: string,
    signature: string,
    timestamp: number
  ): Promise<{
    isValid: boolean;
    recoveredAddress?: string;
    expectedAddress?: string;
    error?: string;
  }> {
    try {
      const isConnected = await this.initialize();

      if (!isConnected || !this.wallet) {
        // Simulation mode - always valid
        return {
          isValid: true,
          recoveredAddress: '0x' + CryptoJS.SHA256('simulation-address').toString().slice(0, 40),
          expectedAddress: '0x' + CryptoJS.SHA256('simulation-address').toString().slice(0, 40),
        };
      }

      // Recreate the message hash
      const messageHash = ethers.solidityPackedKeccak256(
        ['bytes32', 'uint256'],
        [documentHash, timestamp]
      );

      // Recover the signer address
      const recoveredAddress = ethers.verifyMessage(ethers.getBytes(messageHash), signature);
      const expectedAddress = await this.wallet.getAddress();

      return {
        isValid: recoveredAddress.toLowerCase() === expectedAddress.toLowerCase(),
        recoveredAddress,
        expectedAddress,
      };
    } catch (error) {
      console.error('Signature verification error:', error);
      return {
        isValid: false,
        error: error instanceof Error ? error.message : 'Verification failed',
      };
    }
  }
}

// Export singleton instance
export const blockchainService = new BlockchainService();
