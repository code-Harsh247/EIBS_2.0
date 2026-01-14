// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title InvoiceNFT
 * @dev ERC721-like NFT representing tokenized invoices for DeFi lending
 * @notice Privacy-preserving: Only stores hashes and public metadata URIs
 * 
 * PRIVACY MODEL:
 * - Private data (client names, addresses, PDF) stored off-chain
 * - documentHash ensures integrity without revealing content
 * - publicMetadataURI points to IPFS with only generic info (sector, amount range, risk)
 * - Prevents double-financing via hash collision detection
 */
contract InvoiceNFT {
    // Invoice data structure - PRIVACY PRESERVING
    struct InvoiceData {
        bytes32 documentHash;      // SHA-256 hash of full invoice data (for integrity)
        string publicMetadataURI;  // IPFS URI with non-sensitive metadata
        uint256 amount;            // Amount in stablecoin units (6 decimals for USDC)
        uint256 dueDate;           // Unix timestamp
        address seller;            // Seller wallet (no name stored)
        uint8 riskScore;           // 0-100, lower is better
        bool isRepaid;             // Whether loan has been repaid
        uint256 fundedAt;          // Timestamp when funded
    }

    // Token name and symbol
    string public name = "EIBS Invoice NFT";
    string public symbol = "EINV";

    // Token ID counter
    uint256 private _tokenIdCounter;

    // Owner of the contract (LiquidityPool)
    address public owner;

    // Backend oracle address (can mint and update)
    address public oracle;

    // Token ownership
    mapping(uint256 => address) private _owners;
    
    // Token approvals
    mapping(uint256 => address) private _tokenApprovals;
    
    // Operator approvals
    mapping(address => mapping(address => bool)) private _operatorApprovals;

    // Invoice data for each token
    mapping(uint256 => InvoiceData) private _invoices;

    // Document hash to token ID - PREVENTS DOUBLE FINANCING
    mapping(bytes32 => uint256) private _documentHashToTokenId;

    // Events
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event InvoiceMinted(uint256 indexed tokenId, bytes32 indexed documentHash, uint256 amount, uint8 riskScore);
    event InvoiceRepaid(uint256 indexed tokenId, bytes32 indexed documentHash);

    // Errors
    error Unauthorized();
    error ZeroAddress();
    error ZeroAmount();
    error InvalidDueDate();
    error InvalidRiskScore();
    error DocumentAlreadyFinanced();
    error TokenDoesNotExist();
    error AlreadyRepaid();
    error EmptyMetadataURI();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier onlyOracle() {
        if (msg.sender != oracle) revert Unauthorized();
        _;
    }

    modifier onlyOwnerOrOracle() {
        if (msg.sender != owner && msg.sender != oracle) revert Unauthorized();
        _;
    }

    constructor(address _oracle) {
        if (_oracle == address(0)) revert ZeroAddress();
        owner = msg.sender;
        oracle = _oracle;
    }

    // ============ NFT Core Functions ============

    function balanceOf(address _owner) public view returns (uint256) {
        require(_owner != address(0), "Zero address");
        uint256 count = 0;
        for (uint256 i = 1; i <= _tokenIdCounter; i++) {
            if (_owners[i] == _owner) count++;
        }
        return count;
    }

    function ownerOf(uint256 tokenId) public view returns (address) {
        address tokenOwner = _owners[tokenId];
        require(tokenOwner != address(0), "Token does not exist");
        return tokenOwner;
    }

    function approve(address to, uint256 tokenId) public {
        address tokenOwner = ownerOf(tokenId);
        require(to != tokenOwner, "Approval to current owner");
        require(
            msg.sender == tokenOwner || isApprovedForAll(tokenOwner, msg.sender),
            "Not authorized"
        );
        _tokenApprovals[tokenId] = to;
        emit Approval(tokenOwner, to, tokenId);
    }

    function getApproved(uint256 tokenId) public view returns (address) {
        require(_owners[tokenId] != address(0), "Token does not exist");
        return _tokenApprovals[tokenId];
    }

    function setApprovalForAll(address operator, bool approved) public {
        require(operator != msg.sender, "Approve to caller");
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function isApprovedForAll(address _owner, address operator) public view returns (bool) {
        return _operatorApprovals[_owner][operator];
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        require(_isApprovedOrOwner(msg.sender, tokenId), "Not authorized");
        _transfer(from, to, tokenId);
    }

    function _transfer(address from, address to, uint256 tokenId) internal {
        require(ownerOf(tokenId) == from, "Not owner");
        require(to != address(0), "Transfer to zero address");

        // Clear approvals
        delete _tokenApprovals[tokenId];

        _owners[tokenId] = to;
        emit Transfer(from, to, tokenId);
    }

    function _isApprovedOrOwner(address spender, uint256 tokenId) internal view returns (bool) {
        address tokenOwner = ownerOf(tokenId);
        return (spender == tokenOwner || 
                isApprovedForAll(tokenOwner, spender) || 
                getApproved(tokenId) == spender);
    }

    // ============ Invoice Functions ============

    /**
     * @dev Mint a new Invoice NFT with privacy-preserving metadata
     * @param to Address to mint to (usually the liquidity pool)
     * @param documentHash SHA-256 hash of full invoice data (prevents double financing)
     * @param publicMetadataURI IPFS URI containing only non-sensitive metadata
     * @param amount Invoice amount in stablecoin units
     * @param dueDate Invoice due date
     * @param seller Seller wallet address (no name/private info)
     * @param riskScore Risk score 0-100
     * @param publicMetadataURI IPFS URI with non-sensitive metadata
     * 
     * PRIVACY: No client names, addresses, or PDF links stored on-chain
     * Only hashes for integrity and generic metadata for transparency
     */
    function mint(
        address to,
        bytes32 documentHash,
        uint256 amount,
        uint256 dueDate,
        address seller,
        uint8 riskScore,
        string calldata publicMetadataURI
    ) external onlyOwnerOrOracle returns (uint256 tokenId) {
        if (to == address(0)) revert ZeroAddress();
        if (documentHash == bytes32(0)) revert ZeroAddress(); // Reusing error for empty hash
        if (bytes(publicMetadataURI).length == 0) revert EmptyMetadataURI();
        if (amount == 0) revert ZeroAmount();
        if (dueDate <= block.timestamp) revert InvalidDueDate();
        if (riskScore > 100) revert InvalidRiskScore();
        
        // PREVENT DOUBLE FINANCING - same invoice can't be funded twice
        if (_documentHashToTokenId[documentHash] != 0) revert DocumentAlreadyFinanced();

        _tokenIdCounter++;
        tokenId = _tokenIdCounter;

        _owners[tokenId] = to;
        _invoices[tokenId] = InvoiceData({
            documentHash: documentHash,
            publicMetadataURI: publicMetadataURI,
            amount: amount,
            dueDate: dueDate,
            seller: seller,
            riskScore: riskScore,
            isRepaid: false,
            fundedAt: block.timestamp
        });
        
        // Map hash to token for double-financing prevention
        _documentHashToTokenId[documentHash] = tokenId;

        emit Transfer(address(0), to, tokenId);
        emit InvoiceMinted(tokenId, documentHash, amount, riskScore);
    }

    /**
     * @dev Mark an invoice as repaid
     * @param tokenId The NFT token ID
     */
    function markRepaid(uint256 tokenId) external onlyOwnerOrOracle {
        if (_owners[tokenId] == address(0)) revert TokenDoesNotExist();
        if (_invoices[tokenId].isRepaid) revert AlreadyRepaid();
        
        _invoices[tokenId].isRepaid = true;
        emit InvoiceRepaid(tokenId, _invoices[tokenId].documentHash);
    }

    /**
     * @dev Burn an invoice NFT after loan is fully repaid
     * @param tokenId The NFT token ID to burn
     * @notice Can only be called by owner (LiquidityPool) or oracle
     * @notice Invoice must be marked as repaid before burning
     */
    function burn(uint256 tokenId) external onlyOwnerOrOracle {
        if (_owners[tokenId] == address(0)) revert TokenDoesNotExist();
        if (!_invoices[tokenId].isRepaid) revert Unauthorized(); // Must be repaid first
        
        address tokenOwner = _owners[tokenId];
        bytes32 documentHash = _invoices[tokenId].documentHash;
        
        // Clear ownership and approvals
        delete _tokenApprovals[tokenId];
        delete _owners[tokenId];
        
        // Clear invoice data
        delete _invoices[tokenId];
        
        // Remove document hash mapping (allows re-financing if needed in future)
        delete _documentHashToTokenId[documentHash];
        
        emit Transfer(tokenOwner, address(0), tokenId);
    }

    /**
     * @dev Get invoice data (privacy-preserving - no private details)
     */
    function getInvoice(uint256 tokenId) external view returns (InvoiceData memory) {
        if (_owners[tokenId] == address(0)) revert TokenDoesNotExist();
        return _invoices[tokenId];
    }

    /**
     * @dev Get token ID by document hash
     */
    function getTokenIdByHash(bytes32 documentHash) external view returns (uint256) {
        uint256 tokenId = _documentHashToTokenId[documentHash];
        if (tokenId == 0) revert TokenDoesNotExist();
        return tokenId;
    }

    /**
     * @dev Check if document hash has already been financed
     */
    function isDocumentFinanced(bytes32 documentHash) external view returns (bool) {
        return _documentHashToTokenId[documentHash] != 0;
    }

    /**
     * @dev Get token URI (returns public metadata URI)
     */
    function tokenURI(uint256 tokenId) external view returns (string memory) {
        if (_owners[tokenId] == address(0)) revert TokenDoesNotExist();
        return _invoices[tokenId].publicMetadataURI;
    }

    /**
     * @dev Get total number of invoices
     */
    function totalSupply() external view returns (uint256) {
        return _tokenIdCounter;
    }

    // ============ Admin Functions ============

    function setOracle(address _oracle) external onlyOwner {
        if (_oracle == address(0)) revert ZeroAddress();
        oracle = _oracle;
    }

    /**
     * @dev Set the liquidity pool as the owner (grants mint/burn permissions)
     * @param _liquidityPool Address of the InvoiceLiquidityPool contract
     * @notice This should be called after deploying the liquidity pool
     */
    function setLiquidityPool(address _liquidityPool) external onlyOwner {
        if (_liquidityPool == address(0)) revert ZeroAddress();
        owner = _liquidityPool;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        owner = newOwner;
    }
}
