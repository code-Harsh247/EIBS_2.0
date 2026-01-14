// Liquidity Pool Contract ABI (with privacy-preserving signatures)
export const LIQUIDITY_POOL_ABI = [
  // ERC-4626 View Functions
  "function asset() view returns (address)",
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function convertToShares(uint256 assets) view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function maxDeposit(address receiver) view returns (uint256)",
  "function maxWithdraw(address owner) view returns (uint256)",
  "function maxRedeem(address owner) view returns (uint256)",
  "function previewDeposit(uint256 assets) view returns (uint256)",
  "function previewWithdraw(uint256 assets) view returns (uint256)",
  "function previewRedeem(uint256 shares) view returns (uint256)",
  
  // ERC-4626 Mutative Functions
  "function deposit(uint256 assets, address receiver) returns (uint256 shares)",
  "function withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)",
  
  // Pool Specific View Functions
  "function oracle() view returns (address)",
  "function owner() view returns (address)",
  "function identitySBT() view returns (address)",
  "function maxUtilizationBps() view returns (uint256)",
  "function protocolFeeBps() view returns (uint256)",
  "function totalActiveLoans() view returns (uint256)",
  "function accumulatedFees() view returns (uint256)",
  "function utilizationRate() view returns (uint256)",
  "function availableForLoans() view returns (uint256)",
  "function estimatedAPY() view returns (uint256)",
  "function getLoan(uint256 tokenId) view returns (tuple(uint256 principal, uint256 expectedYield, uint256 fundedAt, bool isActive, bytes32 documentHash))",
  "function usedNonces(bytes32 nonce) view returns (bool)",
  
  // Pool Specific Mutative Functions (privacy-preserving: uses documentHash, no buyer)
  "function fundLoan(bytes32 documentHash, uint256 amount, uint256 dueDate, address seller, uint8 riskScore, uint256 expectedYieldBps, string publicMetadataURI, bytes32 nonce, bytes signature) returns (uint256 tokenId)",
  "function repayLoan(uint256 tokenId, uint256 actualYield)",
  "function depositRepayment(uint256 amount)",
  
  // Admin Functions
  "function setInvoiceNFT(address _invoiceNFT)",
  "function setIdentitySBT(address _identitySBT)",
  "function setOracle(address _oracle)",
  "function setMaxUtilization(uint256 _maxUtilizationBps)",
  "function setProtocolFee(uint256 _protocolFeeBps)",
  "function withdrawFees()",
  
  // Events (privacy-preserving: uses documentHash)
  "event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)",
  "event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)",
  "event LoanFunded(uint256 indexed tokenId, bytes32 indexed documentHash, uint256 amount, address seller)",
  "event LoanRepaid(uint256 indexed tokenId, bytes32 indexed documentHash, uint256 principal, uint256 yield)",
  "event IdentitySBTUpdated(address indexed oldSBT, address indexed newSBT)"
] as const;

// Invoice NFT Contract ABI (privacy-preserving: documentHash instead of invoiceId)
export const INVOICE_NFT_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function getInvoice(uint256 tokenId) view returns (tuple(bytes32 documentHash, uint256 amount, uint256 dueDate, address seller, uint8 riskScore, bool isRepaid, uint256 fundedAt, string publicMetadataURI))",
  "function getTokenIdByDocumentHash(bytes32 documentHash) view returns (uint256)",
  "function isDocumentFinanced(bytes32 documentHash) view returns (bool)",
  "function mint(address to, bytes32 documentHash, uint256 amount, uint256 dueDate, address seller, uint8 riskScore, string publicMetadataURI) returns (uint256 tokenId)",
  "function markRepaid(uint256 tokenId)",
  "function transferFrom(address from, address to, uint256 tokenId)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  "event InvoiceMinted(uint256 indexed tokenId, bytes32 indexed documentHash, uint256 amount, uint8 riskScore)",
  "event InvoiceRepaid(uint256 indexed tokenId, bytes32 indexed documentHash)"
] as const;

// Identity SBT Contract ABI (Soulbound Token for KYB verification)
export const IDENTITY_SBT_ABI = [
  // View Functions
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function owner() view returns (address)",
  "function balanceOf(address owner) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function isVerifiedBusiness(address wallet) view returns (bool)",
  "function isBlacklisted(address wallet) view returns (bool)",
  "function getBlacklistReason(address wallet) view returns (string)",
  "function getBusinessInfo(address wallet) view returns (tuple(string businessId, uint8 riskTier, uint256 verifiedAt, string metadataURI))",
  "function getTokenByWallet(address wallet) view returns (uint256)",
  
  // Admin Functions
  "function mint(address wallet, string businessId, uint8 riskTier, string metadataURI) returns (uint256 tokenId)",
  "function burn(uint256 tokenId)",
  "function blacklist(address wallet, string reason)",
  "function removeFromBlacklist(address wallet)",
  "function updateRiskTier(uint256 tokenId, uint8 newRiskTier)",
  "function updateMetadataURI(uint256 tokenId, string newMetadataURI)",
  "function transferOwnership(address newOwner)",
  
  // Events
  "event BusinessVerified(address indexed wallet, uint256 indexed tokenId, string businessId, uint8 riskTier)",
  "event VerificationRevoked(address indexed wallet, uint256 indexed tokenId)",
  "event BusinessBlacklisted(address indexed wallet, string reason)",
  "event BlacklistRemoved(address indexed wallet)",
  "event RiskTierUpdated(uint256 indexed tokenId, uint8 oldTier, uint8 newTier)"
] as const;

// ERC20 ABI (for USDC)
export const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)"
] as const;
