// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./ERC20.sol";
import "./interfaces/IERC20.sol";
import "./interfaces/IERC4626.sol";
import "./interfaces/IInvoiceNFT.sol";
import "./IdentitySBT.sol";

/**
 * @title InvoiceLiquidityPool
 * @dev ERC-4626 compliant vault for invoice financing
 * @notice LPs deposit USDC and receive lUSDC shares. The pool funds approved invoices.
 * 
 * SECURITY:
 * - Only KYB-verified businesses (with IdentitySBT) can borrow via fundLoan()
 * - Backend signature required for all loan funding
 * - Privacy-preserving: only document hashes stored on-chain
 * 
 * Flow:
 * 1. LPs deposit USDC → receive lUSDC shares
 * 2. Backend approves invoice with signature
 * 3. fundLoan() verifies identity + signature, transfers USDC to seller
 * 4. When fiat payment arrives, backend calls repayLoan()
 * 5. repayLoan() returns principal + yield to pool
 * 6. LPs can withdraw USDC (with yield) by burning lUSDC shares
 */
contract InvoiceLiquidityPool is ERC20 {
    // ============ State Variables ============

    // The underlying asset (USDC)
    IERC20 public immutable asset;
    
    // Invoice NFT contract
    IInvoiceNFT public invoiceNFT;

    // Identity SBT contract for KYB verification
    IdentitySBT public identitySBT;

    // Backend oracle address (trusted signer)
    address public oracle;

    // Contract owner
    address public owner;

    // Maximum utilization rate (in basis points, 9000 = 90%)
    uint256 public maxUtilizationBps = 9000;

    // Fee taken on yield (in basis points, 1000 = 10%)
    uint256 public protocolFeeBps = 1000;

    // Protocol fee recipient
    address public feeRecipient;

    // Total value of active loans (principal only)
    uint256 public totalActiveLoans;

    // Accumulated protocol fees
    uint256 public accumulatedFees;

    // Nonce for replay protection
    mapping(bytes32 => bool) public usedNonces;

    // Active loan tracking
    struct Loan {
        uint256 principal;      // Original funded amount
        uint256 expectedYield;  // Expected yield based on risk
        uint256 fundedAt;       // Timestamp when funded
        bool isActive;          // Whether loan is still active
        bytes32 documentHash;   // Privacy: only hash, no private data
    }
    mapping(uint256 => Loan) public loans; // tokenId => Loan

    // Struct for fundLoan parameters (reduces stack depth)
    struct FundLoanParams {
        bytes32 documentHash;
        string publicMetadataURI;
        uint256 amount;
        uint256 dueDate;
        address seller;
        uint8 riskScore;
        uint256 expectedYieldBps;
        bytes32 nonce;
        bytes signature;
    }

    // ============ Events ============

    event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares);
    event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares);
    event LoanFunded(uint256 indexed tokenId, bytes32 indexed documentHash, uint256 amount, address seller);
    event LoanRepaid(uint256 indexed tokenId, bytes32 indexed documentHash, uint256 principal, uint256 yield);
    event OracleUpdated(address indexed oldOracle, address indexed newOracle);
    event MaxUtilizationUpdated(uint256 oldValue, uint256 newValue);
    event ProtocolFeeUpdated(uint256 oldValue, uint256 newValue);
    event FeesWithdrawn(address indexed recipient, uint256 amount);
    event IdentitySBTUpdated(address indexed oldSBT, address indexed newSBT);

    // ============ Errors ============

    error Unauthorized();
    error ZeroAddress();
    error ZeroAmount();
    error InvalidSignature();
    error NonceAlreadyUsed();
    error ExceedsMaxUtilization();
    error InsufficientLiquidity();
    error LoanNotActive();
    error LoanAlreadyExists();
    error InvoiceExpired();
    error NotVerifiedBusiness();
    error BusinessBlacklisted();

    // ============ Modifiers ============

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier onlyOracle() {
        if (msg.sender != oracle) revert Unauthorized();
        _;
    }

    /**
     * @dev Requires caller to have a valid IdentitySBT (KYB verified)
     */
    modifier onlyVerifiedBusiness() {
        if (address(identitySBT) == address(0)) revert ZeroAddress();
        if (!identitySBT.isVerifiedBusiness(msg.sender)) revert NotVerifiedBusiness();
        _;
    }

    // ============ Constructor ============

    /**
     * @param _asset The underlying asset (USDC address)
     * @param _oracle Backend oracle/signer address
     * @param _feeRecipient Address to receive protocol fees
     */
    constructor(
        address _asset,
        address _oracle,
        address _feeRecipient
    ) ERC20("Liquid USDC", "lUSDC", 6) {
        if (_asset == address(0)) revert ZeroAddress();
        if (_oracle == address(0)) revert ZeroAddress();
        if (_feeRecipient == address(0)) revert ZeroAddress();

        asset = IERC20(_asset);
        oracle = _oracle;
        feeRecipient = _feeRecipient;
        owner = msg.sender;
    }

    // ============ ERC-4626 Core Functions ============

    /**
     * @notice Returns total assets under management
     * @dev Includes both idle USDC in vault + active loan principal
     */
    function totalAssets() public view returns (uint256) {
        return asset.balanceOf(address(this)) + totalActiveLoans - accumulatedFees;
    }

    /**
     * @notice Convert assets to shares
     */
    function convertToShares(uint256 assets) public view returns (uint256) {
        uint256 supply = totalSupply();
        return supply == 0 ? assets : (assets * supply) / totalAssets();
    }

    /**
     * @notice Convert shares to assets
     */
    function convertToAssets(uint256 shares) public view returns (uint256) {
        uint256 supply = totalSupply();
        return supply == 0 ? shares : (shares * totalAssets()) / supply;
    }

    /**
     * @notice Maximum deposit allowed
     */
    function maxDeposit(address) public pure returns (uint256) {
        return type(uint256).max;
    }

    /**
     * @notice Preview shares for a deposit
     */
    function previewDeposit(uint256 assets) public view returns (uint256) {
        return convertToShares(assets);
    }

    /**
     * @notice Deposit USDC and receive lUSDC shares
     * @param assets Amount of USDC to deposit
     * @param receiver Address to receive shares
     * @return shares Amount of lUSDC shares minted
     */
    function deposit(uint256 assets, address receiver) public returns (uint256 shares) {
        if (assets == 0) revert ZeroAmount();
        if (receiver == address(0)) revert ZeroAddress();

        shares = previewDeposit(assets);
        
        // Transfer USDC from sender to vault
        asset.transferFrom(msg.sender, address(this), assets);
        
        // Mint shares to receiver
        _mint(receiver, shares);

        emit Deposit(msg.sender, receiver, assets, shares);
    }

    /**
     * @notice Maximum mint allowed
     */
    function maxMint(address) public pure returns (uint256) {
        return type(uint256).max;
    }

    /**
     * @notice Preview assets needed for minting shares
     */
    function previewMint(uint256 shares) public view returns (uint256) {
        uint256 supply = totalSupply();
        return supply == 0 ? shares : (shares * totalAssets() + supply - 1) / supply;
    }

    /**
     * @notice Mint exact shares by depositing assets
     */
    function mint(uint256 shares, address receiver) public returns (uint256 assets) {
        if (shares == 0) revert ZeroAmount();
        if (receiver == address(0)) revert ZeroAddress();

        assets = previewMint(shares);
        
        asset.transferFrom(msg.sender, address(this), assets);
        _mint(receiver, shares);

        emit Deposit(msg.sender, receiver, assets, shares);
    }

    /**
     * @notice Maximum withdraw allowed for an owner
     */
    function maxWithdraw(address _owner) public view returns (uint256) {
        uint256 availableLiquidity = asset.balanceOf(address(this)) - accumulatedFees;
        uint256 ownerAssets = convertToAssets(balanceOf(_owner));
        return availableLiquidity < ownerAssets ? availableLiquidity : ownerAssets;
    }

    /**
     * @notice Preview shares needed for withdrawal
     */
    function previewWithdraw(uint256 assets) public view returns (uint256) {
        uint256 supply = totalSupply();
        return supply == 0 ? assets : (assets * supply + totalAssets() - 1) / totalAssets();
    }

    /**
     * @notice Withdraw USDC by burning lUSDC shares
     * @param assets Amount of USDC to withdraw
     * @param receiver Address to receive USDC
     * @param _owner Owner of the shares
     * @return shares Amount of lUSDC shares burned
     */
    function withdraw(uint256 assets, address receiver, address _owner) public returns (uint256 shares) {
        if (assets == 0) revert ZeroAmount();
        if (receiver == address(0)) revert ZeroAddress();
        
        uint256 availableLiquidity = asset.balanceOf(address(this)) - accumulatedFees;
        if (assets > availableLiquidity) revert InsufficientLiquidity();

        shares = previewWithdraw(assets);

        if (msg.sender != _owner) {
            uint256 allowed = allowance(_owner, msg.sender);
            if (allowed != type(uint256).max) {
                require(allowed >= shares, "ERC4626: withdraw exceeds allowance");
                _approve(_owner, msg.sender, allowed - shares);
            }
        }

        _burn(_owner, shares);
        asset.transfer(receiver, assets);

        emit Withdraw(msg.sender, receiver, _owner, assets, shares);
    }

    /**
     * @notice Maximum redeem allowed for an owner
     */
    function maxRedeem(address _owner) public view returns (uint256) {
        uint256 availableLiquidity = asset.balanceOf(address(this)) - accumulatedFees;
        uint256 ownerShares = balanceOf(_owner);
        uint256 maxAssets = convertToAssets(ownerShares);
        
        if (maxAssets <= availableLiquidity) {
            return ownerShares;
        }
        return convertToShares(availableLiquidity);
    }

    /**
     * @notice Preview assets for redeeming shares
     */
    function previewRedeem(uint256 shares) public view returns (uint256) {
        return convertToAssets(shares);
    }

    /**
     * @notice Redeem shares for USDC
     * @param shares Amount of lUSDC shares to redeem
     * @param receiver Address to receive USDC
     * @param _owner Owner of the shares
     * @return assets Amount of USDC returned
     */
    function redeem(uint256 shares, address receiver, address _owner) public returns (uint256 assets) {
        if (shares == 0) revert ZeroAmount();
        if (receiver == address(0)) revert ZeroAddress();

        assets = previewRedeem(shares);
        
        uint256 availableLiquidity = asset.balanceOf(address(this)) - accumulatedFees;
        if (assets > availableLiquidity) revert InsufficientLiquidity();

        if (msg.sender != _owner) {
            uint256 allowed = allowance(_owner, msg.sender);
            if (allowed != type(uint256).max) {
                require(allowed >= shares, "ERC4626: redeem exceeds allowance");
                _approve(_owner, msg.sender, allowed - shares);
            }
        }

        _burn(_owner, shares);
        asset.transfer(receiver, assets);

        emit Withdraw(msg.sender, receiver, _owner, assets, shares);
    }

    // ============ Loan Functions ============

    /**
     * @notice Fund a loan for an approved invoice
     * @dev Requires KYB verification (IdentitySBT) + backend signature
     * 
     * SECURITY:
     * - Caller must have valid IdentitySBT (onlyVerifiedBusiness)
     * - Backend signature prevents unauthorized funding
     * - Document hash prevents double-financing
     * 
     * PRIVACY:
     * - No client names/addresses stored on-chain
     * - Only document hash for integrity verification
     * - publicMetadataURI contains only generic info
     * 
     * @param params FundLoanParams struct containing all loan parameters
     */
    function fundLoan(FundLoanParams calldata params) external onlyVerifiedBusiness returns (uint256 tokenId) {
        // Verify nonce hasn't been used
        if (usedNonces[params.nonce]) revert NonceAlreadyUsed();
        usedNonces[params.nonce] = true;

        // Verify signature (includes documentHash for privacy)
        {
            bytes32 messageHash = keccak256(abi.encodePacked(
                params.documentHash,
                params.amount,
                params.dueDate,
                params.seller,
                params.riskScore,
                params.expectedYieldBps,
                params.nonce,
                address(this)
            ));
            bytes32 ethSignedHash = _toEthSignedMessageHash(messageHash);
            
            if (_recoverSigner(ethSignedHash, params.signature) != oracle) revert InvalidSignature();
        }

        // Check utilization cap
        {
            uint256 availableLiquidity = asset.balanceOf(address(this)) - accumulatedFees;
            uint256 maxLoanable = (totalAssets() * maxUtilizationBps) / 10000;
            if (totalActiveLoans + params.amount > maxLoanable) revert ExceedsMaxUtilization();
            if (params.amount > availableLiquidity) revert InsufficientLiquidity();
        }

        // Check due date
        if (params.dueDate <= block.timestamp) revert InvoiceExpired();

        // Mint Invoice NFT to the pool (privacy-preserving)
        tokenId = invoiceNFT.mint(
            address(this),
            params.documentHash,
            params.amount,
            params.dueDate,
            params.seller,
            params.riskScore,
            params.publicMetadataURI
        );

        // Check loan doesn't already exist
        if (loans[tokenId].isActive) revert LoanAlreadyExists();

        // Record loan
        loans[tokenId] = Loan({
            principal: params.amount,
            expectedYield: (params.amount * params.expectedYieldBps) / 10000,
            fundedAt: block.timestamp,
            isActive: true,
            documentHash: params.documentHash
        });

        // Update total active loans
        totalActiveLoans += params.amount;

        // Transfer USDC to seller
        asset.transfer(params.seller, params.amount);

        emit LoanFunded(tokenId, params.documentHash, params.amount, params.seller);
    }

    /**
     * @notice Repay a loan (called by oracle when fiat payment arrives)
     * @param tokenId Invoice NFT token ID
     * @param actualYield Actual yield received (could differ from expected)
     */
    function repayLoan(uint256 tokenId, uint256 actualYield) external onlyOracle {
        Loan storage loan = loans[tokenId];
        if (!loan.isActive) revert LoanNotActive();

        uint256 principal = loan.principal;
        uint256 totalRepayment = principal + actualYield;

        // Calculate protocol fee
        uint256 fee = (actualYield * protocolFeeBps) / 10000;
        
        // Mark loan as repaid
        loan.isActive = false;
        
        // Update totals
        totalActiveLoans -= principal;
        accumulatedFees += fee;

        // Mark NFT as repaid
        invoiceNFT.markRepaid(tokenId);

        // Note: The actual repayment funds should be sent to this contract
        // before calling repayLoan. This function just updates accounting.

        emit LoanRepaid(tokenId, loan.documentHash, principal, actualYield);
    }

    /**
     * @notice Deposit repayment funds (called by oracle)
     * @param amount Amount being repaid (principal + yield)
     */
    function depositRepayment(uint256 amount) external onlyOracle {
        asset.transferFrom(msg.sender, address(this), amount);
    }

    /**
     * @notice Burn a repaid invoice NFT (optional cleanup)
     * @param tokenId Invoice NFT token ID
     * @dev Can only burn after loan is marked as not active (repaid)
     */
    function burnRepaidInvoice(uint256 tokenId) external onlyOracle {
        Loan storage loan = loans[tokenId];
        if (loan.isActive) revert LoanNotActive(); // Loan must be repaid first
        
        invoiceNFT.burn(tokenId);
    }

    // ============ View Functions ============

    /**
     * @notice Get current utilization rate in basis points
     */
    function utilizationRate() external view returns (uint256) {
        uint256 total = totalAssets();
        if (total == 0) return 0;
        return (totalActiveLoans * 10000) / total;
    }

    /**
     * @notice Get available liquidity for new loans
     */
    function availableForLoans() external view returns (uint256) {
        uint256 maxLoanable = (totalAssets() * maxUtilizationBps) / 10000;
        if (totalActiveLoans >= maxLoanable) return 0;
        
        uint256 maxFromCap = maxLoanable - totalActiveLoans;
        uint256 actualLiquidity = asset.balanceOf(address(this)) - accumulatedFees;
        
        return maxFromCap < actualLiquidity ? maxFromCap : actualLiquidity;
    }

    /**
     * @notice Get loan details
     */
    function getLoan(uint256 tokenId) external view returns (Loan memory) {
        return loans[tokenId];
    }

    /**
     * @notice Get current APY estimate based on active loans
     */
    function estimatedAPY() external view returns (uint256) {
        if (totalActiveLoans == 0) return 0;
        
        // This is a simplified calculation
        // In production, you'd weight by time remaining and actual yield rates
        return (totalActiveLoans * 1000) / totalAssets(); // Returns in basis points
    }

    // ============ Admin Functions ============

    function setInvoiceNFT(address _invoiceNFT) external onlyOwner {
        if (_invoiceNFT == address(0)) revert ZeroAddress();
        invoiceNFT = IInvoiceNFT(_invoiceNFT);
    }

    function setOracle(address _oracle) external onlyOwner {
        if (_oracle == address(0)) revert ZeroAddress();
        emit OracleUpdated(oracle, _oracle);
        oracle = _oracle;
    }

    function setIdentitySBT(address _identitySBT) external onlyOwner {
        if (_identitySBT == address(0)) revert ZeroAddress();
        emit IdentitySBTUpdated(address(identitySBT), _identitySBT);
        identitySBT = IdentitySBT(_identitySBT);
    }

    function setMaxUtilization(uint256 _maxUtilizationBps) external onlyOwner {
        require(_maxUtilizationBps <= 10000, "Cannot exceed 100%");
        emit MaxUtilizationUpdated(maxUtilizationBps, _maxUtilizationBps);
        maxUtilizationBps = _maxUtilizationBps;
    }

    function setProtocolFee(uint256 _protocolFeeBps) external onlyOwner {
        require(_protocolFeeBps <= 5000, "Cannot exceed 50%");
        emit ProtocolFeeUpdated(protocolFeeBps, _protocolFeeBps);
        protocolFeeBps = _protocolFeeBps;
    }

    function setFeeRecipient(address _feeRecipient) external onlyOwner {
        if (_feeRecipient == address(0)) revert ZeroAddress();
        feeRecipient = _feeRecipient;
    }

    function withdrawFees() external onlyOwner {
        uint256 fees = accumulatedFees;
        accumulatedFees = 0;
        asset.transfer(feeRecipient, fees);
        emit FeesWithdrawn(feeRecipient, fees);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        owner = newOwner;
    }

    // ============ Internal Functions ============

    function _toEthSignedMessageHash(bytes32 hash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
    }

    function _recoverSigner(bytes32 hash, bytes memory signature) internal pure returns (address) {
        require(signature.length == 65, "Invalid signature length");

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }

        if (v < 27) {
            v += 27;
        }

        require(v == 27 || v == 28, "Invalid signature v value");

        return ecrecover(hash, v, r, s);
    }
}
