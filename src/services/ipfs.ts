/**
 * IPFS Service for Split Metadata Privacy Architecture
 * 
 * Uploads PUBLIC metadata to IPFS via Pinata.
 * NEVER uploads private data (client names, addresses, etc.)
 * 
 * Public Metadata includes:
 * - Invoice amount range (e.g., "$1,000-$5,000")
 * - Industry sector
 * - Risk score
 * - Due date
 * - Document hash (for integrity verification)
 */

import crypto from 'crypto';

// Types
export interface PublicMetadata {
  version: string;
  type: 'invoice';
  documentHash: string;
  amountRange: string;
  currency: string;
  sector: string;
  riskScore: number;
  dueDate: string;
  createdAt: string;
  verificationStatus: 'pending' | 'verified' | 'rejected';
}

export interface IPFSUploadResult {
  success: boolean;
  ipfsHash?: string;
  ipfsUri?: string;
  gatewayUrl?: string;
  error?: string;
}

export interface PrivateInvoiceData {
  invoiceId: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  buyerName: string;
  buyerAddress?: string;
  sellerName: string;
  sellerAddress?: string;
  issueDate: string;
  dueDate: string;
  description?: string;
  lineItems?: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    amount: number;
  }>;
}

class IPFSService {
  private pinataApiKey: string;
  private pinataSecretKey: string;
  private pinataGateway: string;
  private isConfigured: boolean;

  constructor() {
    this.pinataApiKey = process.env.PINATA_API_KEY || '';
    this.pinataSecretKey = process.env.PINATA_SECRET_KEY || '';
    this.pinataGateway = process.env.PINATA_GATEWAY || 'https://gateway.pinata.cloud';
    this.isConfigured = !!(this.pinataApiKey && this.pinataSecretKey);
  }

  /**
   * Generate a deterministic document hash from private invoice data
   * This hash is stored on-chain for integrity verification
   */
  generateDocumentHash(privateData: PrivateInvoiceData): string {
    // Sort keys alphabetically for deterministic hashing
    const sortedData = {
      amount: privateData.amount.toString(),
      buyerAddress: privateData.buyerAddress || '',
      buyerName: privateData.buyerName,
      currency: privateData.currency,
      description: privateData.description || '',
      dueDate: privateData.dueDate,
      invoiceId: privateData.invoiceId,
      invoiceNumber: privateData.invoiceNumber,
      issueDate: privateData.issueDate,
      lineItems: JSON.stringify(privateData.lineItems || []),
      sellerAddress: privateData.sellerAddress || '',
      sellerName: privateData.sellerName,
    };

    const dataString = JSON.stringify(sortedData);
    const hash = crypto.createHash('sha256').update(dataString).digest('hex');
    return `0x${hash}`;
  }

  /**
   * Generate amount range for public metadata (privacy-preserving)
   */
  private getAmountRange(amount: number): string {
    if (amount < 1000) return 'Under $1,000';
    if (amount < 5000) return '$1,000 - $5,000';
    if (amount < 10000) return '$5,000 - $10,000';
    if (amount < 25000) return '$10,000 - $25,000';
    if (amount < 50000) return '$25,000 - $50,000';
    if (amount < 100000) return '$50,000 - $100,000';
    if (amount < 500000) return '$100,000 - $500,000';
    return 'Over $500,000';
  }

  /**
   * Infer industry sector from description (simplified)
   */
  private inferSector(description?: string): string {
    if (!description) return 'General';
    
    const desc = description.toLowerCase();
    if (desc.includes('software') || desc.includes('tech') || desc.includes('development')) {
      return 'Technology';
    }
    if (desc.includes('construction') || desc.includes('building')) {
      return 'Construction';
    }
    if (desc.includes('manufacturing') || desc.includes('production')) {
      return 'Manufacturing';
    }
    if (desc.includes('consulting') || desc.includes('advisory')) {
      return 'Professional Services';
    }
    if (desc.includes('retail') || desc.includes('wholesale')) {
      return 'Retail/Wholesale';
    }
    if (desc.includes('transport') || desc.includes('logistics') || desc.includes('shipping')) {
      return 'Logistics';
    }
    if (desc.includes('health') || desc.includes('medical') || desc.includes('pharma')) {
      return 'Healthcare';
    }
    return 'General';
  }

  /**
   * Create public metadata from private invoice data
   * This ONLY contains non-sensitive information
   */
  createPublicMetadata(
    privateData: PrivateInvoiceData,
    documentHash: string,
    riskScore: number = 50
  ): PublicMetadata {
    return {
      version: '1.0',
      type: 'invoice',
      documentHash,
      amountRange: this.getAmountRange(privateData.amount),
      currency: privateData.currency,
      sector: this.inferSector(privateData.description),
      riskScore,
      dueDate: privateData.dueDate,
      createdAt: new Date().toISOString(),
      verificationStatus: 'pending',
    };
  }

  /**
   * Upload public metadata to IPFS via Pinata
   */
  async uploadToIPFS(metadata: PublicMetadata): Promise<IPFSUploadResult> {
    if (!this.isConfigured) {
      // Return mock result for development/testing
      console.warn('IPFS: Pinata not configured, using mock IPFS URI');
      const mockHash = `Qm${crypto.randomBytes(22).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 44)}`;
      return {
        success: true,
        ipfsHash: mockHash,
        ipfsUri: `ipfs://${mockHash}`,
        gatewayUrl: `${this.pinataGateway}/ipfs/${mockHash}`,
      };
    }

    try {
      const response = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'pinata_api_key': this.pinataApiKey,
          'pinata_secret_api_key': this.pinataSecretKey,
        },
        body: JSON.stringify({
          pinataContent: metadata,
          pinataMetadata: {
            name: `invoice-${metadata.documentHash.slice(0, 10)}`,
            keyvalues: {
              type: 'invoice-metadata',
              documentHash: metadata.documentHash,
              riskScore: metadata.riskScore.toString(),
            },
          },
          pinataOptions: {
            cidVersion: 1,
          },
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Pinata upload failed: ${error}`);
      }

      const result = await response.json();
      const ipfsHash = result.IpfsHash;

      return {
        success: true,
        ipfsHash,
        ipfsUri: `ipfs://${ipfsHash}`,
        gatewayUrl: `${this.pinataGateway}/ipfs/${ipfsHash}`,
      };
    } catch (error) {
      console.error('IPFS upload error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Fetch metadata from IPFS
   */
  async fetchFromIPFS(ipfsUri: string): Promise<PublicMetadata | null> {
    try {
      // Convert ipfs:// URI to gateway URL
      const ipfsHash = ipfsUri.replace('ipfs://', '');
      const gatewayUrl = `${this.pinataGateway}/ipfs/${ipfsHash}`;

      const response = await fetch(gatewayUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch from IPFS: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('IPFS fetch error:', error);
      return null;
    }
  }

  /**
   * Full workflow: Generate hash, create public metadata, upload to IPFS
   */
  async processInvoiceForIPFS(
    privateData: PrivateInvoiceData,
    riskScore: number = 50
  ): Promise<{
    documentHash: string;
    publicMetadata: PublicMetadata;
    ipfsResult: IPFSUploadResult;
  }> {
    // Step 1: Generate deterministic document hash
    const documentHash = this.generateDocumentHash(privateData);

    // Step 2: Create public metadata (no private info)
    const publicMetadata = this.createPublicMetadata(privateData, documentHash, riskScore);

    // Step 3: Upload to IPFS
    const ipfsResult = await this.uploadToIPFS(publicMetadata);

    return {
      documentHash,
      publicMetadata,
      ipfsResult,
    };
  }

  /**
   * Check if IPFS/Pinata is configured
   */
  isIPFSConfigured(): boolean {
    return this.isConfigured;
  }
}

// Export singleton instance
export const ipfsService = new IPFSService();
