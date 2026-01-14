// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @dev Interface for Invoice NFT contract
 * @notice Privacy-preserving: Only stores document hash, no private invoice details on-chain
 */
interface IInvoiceNFT {
    struct InvoiceData {
        bytes32 documentHash;      // SHA256 of invoice document (no private data on-chain)
        uint256 amount;            // Funding amount
        uint256 dueDate;           // Payment due date
        address seller;            // Seller's wallet
        uint8 riskScore;           // 0-100 risk assessment
        bool isRepaid;             // Repayment status
        uint256 fundedAt;          // Timestamp when funded
        string publicMetadataURI;  // IPFS URI for non-sensitive metadata
    }

    function mint(
        address to,
        bytes32 documentHash,
        uint256 amount,
        uint256 dueDate,
        address seller,
        uint8 riskScore,
        string calldata publicMetadataURI
    ) external returns (uint256 tokenId);

    function getInvoice(uint256 tokenId) external view returns (InvoiceData memory);
    function markRepaid(uint256 tokenId) external;
    function burn(uint256 tokenId) external;
    function ownerOf(uint256 tokenId) external view returns (address);
    function transferFrom(address from, address to, uint256 tokenId) external;
    function getTokenIdByDocumentHash(bytes32 documentHash) external view returns (uint256);
    function isDocumentFinanced(bytes32 documentHash) external view returns (bool);
}
