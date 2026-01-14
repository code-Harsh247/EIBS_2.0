// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title IdentitySBT (Soulbound Token)
 * @dev Non-transferable ERC-721 token for KYB-verified businesses
 * @notice Only verified businesses can participate in invoice financing
 * 
 * Soulbound = Cannot be transferred, only minted/burned by admin
 * Used to gate access to fundLoan() and other sensitive operations
 */
contract IdentitySBT {
    // ============ State Variables ============

    string public name = "EIBS Business Identity";
    string public symbol = "EIBS-ID";

    // Admin (backend oracle) who can mint/burn
    address public admin;

    // Token counter
    uint256 private _tokenIdCounter;

    // Token ownership
    mapping(uint256 => address) private _owners;
    
    // Owner to token ID (one token per address)
    mapping(address => uint256) private _addressToTokenId;

    // Token metadata URI
    mapping(uint256 => string) private _tokenURIs;

    // Business verification data
    struct BusinessInfo {
        string businessId;       // Off-chain business ID reference
        uint256 verifiedAt;      // Timestamp of verification
        uint8 riskTier;          // 1=Low, 2=Medium, 3=High risk
        bool isActive;           // Can be deactivated without burning
    }
    mapping(uint256 => BusinessInfo) public businessInfo;

    // Blacklist tracking
    mapping(address => bool) public isBlacklisted;

    // ============ Events ============

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event BusinessVerified(address indexed wallet, uint256 indexed tokenId, string businessId);
    event BusinessDeactivated(address indexed wallet, uint256 indexed tokenId, string reason);
    event BusinessReactivated(address indexed wallet, uint256 indexed tokenId);
    event BusinessBlacklisted(address indexed wallet, string reason);
    event AdminTransferred(address indexed oldAdmin, address indexed newAdmin);

    // ============ Errors ============

    error Unauthorized();
    error AlreadyVerified();
    error NotVerified();
    error SoulboundTokenCannotBeTransferred();
    error Blacklisted();
    error ZeroAddress();
    error TokenDoesNotExist();

    // ============ Modifiers ============

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized();
        _;
    }

    modifier notBlacklisted(address wallet) {
        if (isBlacklisted[wallet]) revert Blacklisted();
        _;
    }

    // ============ Constructor ============

    constructor(address _admin) {
        if (_admin == address(0)) revert ZeroAddress();
        admin = _admin;
    }

    // ============ ERC-721 View Functions ============

    function balanceOf(address owner) public view returns (uint256) {
        if (owner == address(0)) revert ZeroAddress();
        return _addressToTokenId[owner] != 0 ? 1 : 0;
    }

    function ownerOf(uint256 tokenId) public view returns (address) {
        address owner = _owners[tokenId];
        if (owner == address(0)) revert TokenDoesNotExist();
        return owner;
    }

    function tokenURI(uint256 tokenId) public view returns (string memory) {
        if (_owners[tokenId] == address(0)) revert TokenDoesNotExist();
        return _tokenURIs[tokenId];
    }

    function totalSupply() public view returns (uint256) {
        return _tokenIdCounter;
    }

    /**
     * @dev Get token ID for a wallet address
     */
    function getTokenId(address wallet) public view returns (uint256) {
        uint256 tokenId = _addressToTokenId[wallet];
        if (tokenId == 0) revert NotVerified();
        return tokenId;
    }

    /**
     * @dev Check if an address is a verified business
     */
    function isVerifiedBusiness(address wallet) public view returns (bool) {
        if (isBlacklisted[wallet]) return false;
        uint256 tokenId = _addressToTokenId[wallet];
        if (tokenId == 0) return false;
        return businessInfo[tokenId].isActive;
    }

    /**
     * @dev Get business info for a wallet
     */
    function getBusinessInfo(address wallet) public view returns (BusinessInfo memory) {
        uint256 tokenId = _addressToTokenId[wallet];
        if (tokenId == 0) revert NotVerified();
        return businessInfo[tokenId];
    }

    // ============ Soulbound Transfer Blocks ============

    /**
     * @dev Blocked - Soulbound tokens cannot be transferred
     */
    function transferFrom(address, address, uint256) public pure {
        revert SoulboundTokenCannotBeTransferred();
    }

    /**
     * @dev Blocked - Soulbound tokens cannot be transferred
     */
    function safeTransferFrom(address, address, uint256) public pure {
        revert SoulboundTokenCannotBeTransferred();
    }

    /**
     * @dev Blocked - Soulbound tokens cannot be transferred
     */
    function safeTransferFrom(address, address, uint256, bytes memory) public pure {
        revert SoulboundTokenCannotBeTransferred();
    }

    /**
     * @dev Blocked - No approvals needed for soulbound tokens
     */
    function approve(address, uint256) public pure {
        revert SoulboundTokenCannotBeTransferred();
    }

    /**
     * @dev Blocked - No approvals needed for soulbound tokens
     */
    function setApprovalForAll(address, bool) public pure {
        revert SoulboundTokenCannotBeTransferred();
    }

    function getApproved(uint256) public pure returns (address) {
        return address(0);
    }

    function isApprovedForAll(address, address) public pure returns (bool) {
        return false;
    }

    // ============ Admin Functions ============

    /**
     * @dev Mint a verification token to a business after KYB
     * @param wallet The business's wallet address
     * @param businessId Off-chain business identifier
     * @param riskTier Risk tier (1=Low, 2=Medium, 3=High)
     * @param metadataURI IPFS URI with verification details
     */
    function mint(
        address wallet,
        string calldata businessId,
        uint8 riskTier,
        string calldata metadataURI
    ) external onlyAdmin notBlacklisted(wallet) returns (uint256 tokenId) {
        if (wallet == address(0)) revert ZeroAddress();
        if (_addressToTokenId[wallet] != 0) revert AlreadyVerified();
        require(riskTier >= 1 && riskTier <= 3, "Invalid risk tier");

        _tokenIdCounter++;
        tokenId = _tokenIdCounter;

        _owners[tokenId] = wallet;
        _addressToTokenId[wallet] = tokenId;
        _tokenURIs[tokenId] = metadataURI;

        businessInfo[tokenId] = BusinessInfo({
            businessId: businessId,
            verifiedAt: block.timestamp,
            riskTier: riskTier,
            isActive: true
        });

        emit Transfer(address(0), wallet, tokenId);
        emit BusinessVerified(wallet, tokenId, businessId);
    }

    /**
     * @dev Burn a verification token (permanent removal)
     * @param tokenId Token to burn
     */
    function burn(uint256 tokenId) external onlyAdmin {
        address owner = _owners[tokenId];
        if (owner == address(0)) revert TokenDoesNotExist();

        delete _addressToTokenId[owner];
        delete _owners[tokenId];
        delete _tokenURIs[tokenId];
        delete businessInfo[tokenId];

        emit Transfer(owner, address(0), tokenId);
    }

    /**
     * @dev Deactivate a business (temporary suspension)
     */
    function deactivate(uint256 tokenId, string calldata reason) external onlyAdmin {
        if (_owners[tokenId] == address(0)) revert TokenDoesNotExist();
        businessInfo[tokenId].isActive = false;
        emit BusinessDeactivated(_owners[tokenId], tokenId, reason);
    }

    /**
     * @dev Reactivate a suspended business
     */
    function reactivate(uint256 tokenId) external onlyAdmin {
        if (_owners[tokenId] == address(0)) revert TokenDoesNotExist();
        businessInfo[tokenId].isActive = true;
        emit BusinessReactivated(_owners[tokenId], tokenId);
    }

    /**
     * @dev Blacklist an address permanently
     */
    function blacklist(address wallet, string calldata reason) external onlyAdmin {
        isBlacklisted[wallet] = true;
        
        // Also burn their token if they have one
        uint256 tokenId = _addressToTokenId[wallet];
        if (tokenId != 0) {
            delete _addressToTokenId[wallet];
            delete _owners[tokenId];
            delete _tokenURIs[tokenId];
            delete businessInfo[tokenId];
            emit Transfer(wallet, address(0), tokenId);
        }
        
        emit BusinessBlacklisted(wallet, reason);
    }

    /**
     * @dev Update risk tier for a business
     */
    function updateRiskTier(uint256 tokenId, uint8 newTier) external onlyAdmin {
        if (_owners[tokenId] == address(0)) revert TokenDoesNotExist();
        require(newTier >= 1 && newTier <= 3, "Invalid risk tier");
        businessInfo[tokenId].riskTier = newTier;
    }

    /**
     * @dev Transfer admin role
     */
    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        emit AdminTransferred(admin, newAdmin);
        admin = newAdmin;
    }

    // ============ ERC-165 Interface Support ============

    function supportsInterface(bytes4 interfaceId) public pure returns (bool) {
        return
            interfaceId == 0x01ffc9a7 || // ERC165
            interfaceId == 0x80ac58cd || // ERC721
            interfaceId == 0x5b5e139f;   // ERC721Metadata
    }
}
