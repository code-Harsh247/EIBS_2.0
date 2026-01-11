// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title InvoiceVerification
 * @dev Smart contract for recording and verifying invoice hashes on the blockchain
 * @notice This contract provides immutable proof of invoice existence and integrity
 */
contract InvoiceVerification {
    // Owner of the contract
    address public owner;
    
    // Mapping from invoice hash to invoice record
    mapping(bytes32 => InvoiceRecord) private invoiceRecords;
    
    // Mapping from invoice ID to invoice hash
    mapping(string => bytes32) private invoiceIdToHash;
    
    // Array of all recorded invoice hashes
    bytes32[] private allInvoiceHashes;
    
    // Structure to store invoice record details
    struct InvoiceRecord {
        bool exists;
        uint256 timestamp;
        address recorder;
        string invoiceId;
    }
    
    // Events
    event InvoiceRecorded(
        bytes32 indexed invoiceHash,
        string invoiceId,
        address indexed recorder,
        uint256 timestamp
    );
    
    event OwnershipTransferred(
        address indexed previousOwner,
        address indexed newOwner
    );
    
    // Modifiers
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can call this function");
        _;
    }
    
    /**
     * @dev Constructor sets the contract deployer as the owner
     */
    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }
    
    /**
     * @dev Record a new invoice hash on the blockchain
     * @param invoiceHash The SHA-256 hash of the invoice data
     * @param invoiceId The unique identifier of the invoice
     */
    function recordInvoice(bytes32 invoiceHash, string calldata invoiceId) external {
        require(invoiceHash != bytes32(0), "Invalid invoice hash");
        require(bytes(invoiceId).length > 0, "Invoice ID cannot be empty");
        require(!invoiceRecords[invoiceHash].exists, "Invoice hash already recorded");
        require(invoiceIdToHash[invoiceId] == bytes32(0), "Invoice ID already recorded");
        
        // Create the record
        invoiceRecords[invoiceHash] = InvoiceRecord({
            exists: true,
            timestamp: block.timestamp,
            recorder: msg.sender,
            invoiceId: invoiceId
        });
        
        // Store the mapping from ID to hash
        invoiceIdToHash[invoiceId] = invoiceHash;
        
        // Add to the list of all hashes
        allInvoiceHashes.push(invoiceHash);
        
        emit InvoiceRecorded(invoiceHash, invoiceId, msg.sender, block.timestamp);
    }
    
    /**
     * @dev Verify if an invoice hash exists on the blockchain
     * @param invoiceHash The hash to verify
     * @return exists Whether the hash exists
     * @return timestamp The timestamp when it was recorded
     * @return recorder The address that recorded it
     */
    function verifyInvoice(bytes32 invoiceHash) external view returns (
        bool exists,
        uint256 timestamp,
        address recorder
    ) {
        InvoiceRecord memory record = invoiceRecords[invoiceHash];
        return (record.exists, record.timestamp, record.recorder);
    }
    
    /**
     * @dev Get invoice record by invoice ID
     * @param invoiceId The invoice ID to look up
     * @return hash The invoice hash
     * @return timestamp The timestamp when it was recorded
     * @return recorder The address that recorded it
     */
    function getInvoiceRecord(string calldata invoiceId) external view returns (
        bytes32 hash,
        uint256 timestamp,
        address recorder
    ) {
        bytes32 invoiceHash = invoiceIdToHash[invoiceId];
        require(invoiceHash != bytes32(0), "Invoice not found");
        
        InvoiceRecord memory record = invoiceRecords[invoiceHash];
        return (invoiceHash, record.timestamp, record.recorder);
    }
    
    /**
     * @dev Get the total number of recorded invoices
     * @return count The total count
     */
    function getTotalInvoices() external view returns (uint256 count) {
        return allInvoiceHashes.length;
    }
    
    /**
     * @dev Get invoice hash by index
     * @param index The index in the array
     * @return invoiceHash The hash at that index
     */
    function getInvoiceHashByIndex(uint256 index) external view returns (bytes32 invoiceHash) {
        require(index < allInvoiceHashes.length, "Index out of bounds");
        return allInvoiceHashes[index];
    }
    
    /**
     * @dev Transfer ownership of the contract
     * @param newOwner The address of the new owner
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "New owner cannot be zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
    
    /**
     * @dev Batch verify multiple invoice hashes
     * @param invoiceHashes Array of hashes to verify
     * @return results Array of existence booleans
     */
    function batchVerify(bytes32[] calldata invoiceHashes) external view returns (bool[] memory results) {
        results = new bool[](invoiceHashes.length);
        for (uint256 i = 0; i < invoiceHashes.length; i++) {
            results[i] = invoiceRecords[invoiceHashes[i]].exists;
        }
        return results;
    }
}
