// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {LineageRegistry} from "./LineageRegistry.sol";

/// @title ExecutionRegistry
/// @notice Registers provider signers and verifies canonical UsageProof
///         evidence — the cryptographic boundary between 0G's execution
///         evidence and Cascade's (not-yet-built) AttributionSettlement.
///
/// @dev What this contract establishes, precisely, and nothing more:
///
///      1. "This EIP-712-typed proof was signed by a key registered to
///         provider P" — a real, on-chain-checked ECDSA binding.
///      2. "The proof's claimed model commitment matches what's registered
///         for modelId in LineageRegistry" — a real, on-chain-checked
///         equality, or the call reverts.
///      3. "This specific execution has not been consumed before" —
///         real, on-chain replay protection.
///
///      What it does NOT establish: that a registered signer address is a
///      genuine 0G-attested TEE key (see docs/adr/0005 — that check is a
///      client-side/off-chain responsibility today), or that a provider
///      marked `CascadeWrapper` is actually running the audited Cascade
///      wrapper (see docs/adr/0006 — that flag is an owner-attested
///      placeholder pending Phase 7). Both limitations are load-bearing,
///      not oversights — see docs/trust-model.md before treating this
///      contract's output as a stronger guarantee than it makes.
contract ExecutionRegistry is Ownable, EIP712 {
    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    enum ProviderMode {
        Standard,
        CascadeWrapper
    }

    /// @notice The canonical, EIP-712-typed statement of one inference event.
    /// @dev Deliberately carries no payment, recipient, or user field — see
    ///      docs/adr/0003 and docs/protocol-spec.md §6. Attribution/payment
    ///      is Phase 4's concern, built on top of what this struct verifies,
    ///      never inside it.
    struct UsageProof {
        bytes32 modelId;
        bytes32 modelCommitment;
        bytes32 requestHash;
        bytes32 responseHash;
        bytes32 chatId;
        uint64 epoch;
        uint64 issuedAt;
    }

    /// @notice Everything downstream settlement needs, derived from trusted
    ///         state — never echoed back from attacker-controlled calldata
    ///         for fields that can be derived instead. See
    ///         docs/protocol-spec.md §7 ("Verification API").
    struct VerifiedUsage {
        address signer;
        address provider;
        bytes32 modelId;
        bytes32 executionId;
        bytes32 requestHash;
        bytes32 responseHash;
        LineageRegistry.ConfidenceLevel servingConfidence;
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    bytes32 public constant USAGE_PROOF_TYPEHASH = keccak256(
        "UsageProof(bytes32 modelId,bytes32 modelCommitment,bytes32 requestHash,bytes32 responseHash,bytes32 chatId,uint64 epoch,uint64 issuedAt)"
    );

    LineageRegistry public immutable lineageRegistry;

    /// @notice How long after `issuedAt` a proof remains acceptable. Defense
    ///         in depth against very stale submissions — NOT the replay
    ///         protection mechanism itself (that's `executionConsumed`,
    ///         keyed deterministically, not by time). See
    ///         docs/threat-model.md #7 ("avoid relying solely on
    ///         timestamps").
    uint64 public proofValidityWindow = 30 days;

    mapping(address => address) public providerOfSigner;
    mapping(address => ProviderMode) public providerMode;
    mapping(bytes32 => bool) public executionConsumed;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event SignerRegistered(address indexed provider, address indexed signer);
    event SignerRevoked(address indexed provider, address indexed signer);
    event ProviderModeUpdated(address indexed provider, ProviderMode mode);
    event UsageProofConsumed(
        bytes32 indexed executionId, address indexed provider, bytes32 indexed modelId, bytes32 requestHash
    );
    event ParameterUpdated(string name, uint256 value);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error SignerAlreadyRegistered();
    error NotSignerOwner();
    error UnregisteredSigner();
    error ModelCommitmentMismatch();
    error ProofExpired();
    error ProofNotYetValid();
    error ExecutionAlreadyConsumed();
    error ZeroAddress();

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    constructor(address lineageRegistryAddress)
        Ownable(msg.sender)
        EIP712("Cascade", "1")
    {
        if (lineageRegistryAddress == address(0)) revert ZeroAddress();
        lineageRegistry = LineageRegistry(lineageRegistryAddress);
    }

    // ---------------------------------------------------------------------
    // Provider / signer registration
    // ---------------------------------------------------------------------

    /// @notice Registers `msg.sender` as the provider behind `signerAddress`.
    ///         A provider may register multiple signer addresses (e.g. one
    ///         per enclave instance); each resolves back to this provider.
    /// @dev Self-registration only. Cascade does not verify off-chain that
    ///      `signerAddress` is a genuine 0G-attested TEE key — see the
    ///      contract-level NatSpec above and docs/adr/0005.
    function registerSigner(address signerAddress) external {
        if (signerAddress == address(0)) revert ZeroAddress();
        if (providerOfSigner[signerAddress] != address(0)) revert SignerAlreadyRegistered();
        providerOfSigner[signerAddress] = msg.sender;
        emit SignerRegistered(msg.sender, signerAddress);
    }

    /// @notice Revokes a previously registered signer. Only the registering
    ///         provider may revoke its own signer. Does not affect usage
    ///         proofs already consumed under that signer.
    function revokeSigner(address signerAddress) external {
        if (providerOfSigner[signerAddress] != msg.sender) revert NotSignerOwner();
        providerOfSigner[signerAddress] = address(0);
        emit SignerRevoked(msg.sender, signerAddress);
    }

    /// @notice Sets a provider's serving mode. Owner-gated placeholder — see
    ///         docs/adr/0006. Not a cryptographic claim until Phase 7
    ///         replaces this with a real wrapper-measurement check.
    function setProviderMode(address provider, ProviderMode mode) external onlyOwner {
        providerMode[provider] = mode;
        emit ProviderModeUpdated(provider, mode);
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function setProofValidityWindow(uint64 value) external onlyOwner {
        proofValidityWindow = value;
        emit ParameterUpdated("proofValidityWindow", value);
    }

    // ---------------------------------------------------------------------
    // Canonical hashing (point 11 — single source of truth for the SDK,
    // relayer, and tests to reuse rather than re-deriving this encoding)
    // ---------------------------------------------------------------------

    /// @notice The EIP-712 struct hash of a UsageProof (pre-domain-separator).
    function hashUsageProof(UsageProof calldata proof) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                USAGE_PROOF_TYPEHASH,
                proof.modelId,
                proof.modelCommitment,
                proof.requestHash,
                proof.responseHash,
                proof.chatId,
                proof.epoch,
                proof.issuedAt
            )
        );
    }

    /// @notice The final digest a signer actually signs — domain-separated,
    ///         binding chainId and this contract's address (cross-chain and
    ///         cross-contract replay protection, per EIP-712 itself).
    function hashTypedDataDigest(UsageProof calldata proof) external view returns (bytes32) {
        return _hashTypedDataV4(hashUsageProof(proof));
    }

    /// @notice Deterministic replay-protection identifier. Derived, not
    ///         signer-chosen, so it cannot be gamed by picking a
    ///         convenient nonce — see docs/threat-model.md #1, #7.
    function hashExecutionId(address provider, bytes32 modelId, bytes32 requestHash, bytes32 responseHash)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(provider, modelId, requestHash, responseHash));
    }

    // ---------------------------------------------------------------------
    // Verification
    // ---------------------------------------------------------------------

    /// @notice Pure verification — does not touch replay-protection state.
    ///         Safe to call repeatedly, off-chain or on-chain, to check a
    ///         proof before submitting it for real settlement.
    function verifyUsageProof(UsageProof calldata proof, bytes calldata signature)
        external
        view
        returns (VerifiedUsage memory)
    {
        return _verify(proof, signature);
    }

    /// @notice Verifies and consumes a proof atomically. This is the
    ///         function Phase 4's AttributionSettlement will actually call.
    ///         Reverts if the proof was already consumed.
    function consumeUsageProof(UsageProof calldata proof, bytes calldata signature)
        external
        returns (VerifiedUsage memory usage)
    {
        usage = _verify(proof, signature);
        if (executionConsumed[usage.executionId]) revert ExecutionAlreadyConsumed();
        executionConsumed[usage.executionId] = true;
        emit UsageProofConsumed(usage.executionId, usage.provider, usage.modelId, proof.requestHash);
    }

    function _verify(UsageProof calldata proof, bytes calldata signature)
        internal
        view
        returns (VerifiedUsage memory)
    {
        if (block.timestamp > uint256(proof.issuedAt) + proofValidityWindow) revert ProofExpired();
        if (proof.issuedAt > block.timestamp) revert ProofNotYetValid();

        bytes32 digest = _hashTypedDataV4(hashUsageProof(proof));
        address signer = ECDSA.recover(digest, signature);

        address provider = providerOfSigner[signer];
        if (provider == address(0)) revert UnregisteredSigner();

        LineageRegistry.Model memory model = lineageRegistry.getModel(proof.modelId);
        if (model.modelCommitment != proof.modelCommitment) revert ModelCommitmentMismatch();

        LineageRegistry.ConfidenceLevel servingConfidence = (providerMode[provider] == ProviderMode.CascadeWrapper)
            ? LineageRegistry.ConfidenceLevel.CryptographicallyBound
            : LineageRegistry.ConfidenceLevel.Declared;

        bytes32 executionId = hashExecutionId(provider, proof.modelId, proof.requestHash, proof.responseHash);

        return VerifiedUsage({
            signer: signer,
            provider: provider,
            modelId: proof.modelId,
            executionId: executionId,
            requestHash: proof.requestHash,
            responseHash: proof.responseHash,
            servingConfidence: servingConfidence
        });
    }
}
