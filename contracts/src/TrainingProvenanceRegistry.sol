// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {CascadeRegistry} from "./CascadeRegistry.sol";
import {ExecutionRegistry} from "./ExecutionRegistry.sol";

/// @title TrainingProvenanceRegistry
/// @notice Structured on-chain representation of a Level 2
///         ("AttestedTraining") provenance claim — 0G fine-tuning's signed
///         declared inputs plus a checked output-commitment, exactly as
///         scoped in docs/protocol-spec.md §5 and no further.
///
/// @dev What a registered record actually establishes: a specific,
///      identifiable 0G provider (a registered `ExecutionRegistry` signer)
///      signed a non-repudiable claim naming a base model, a dataset root,
///      a training script, and a resulting model commitment — and that
///      claim's resulting/base commitments match what's actually
///      registered in `CascadeRegistry` for those models.
///
///      What it does NOT establish: that the provider's enclave actually
///      computed the declared output from the declared inputs. That
///      atomic input→output binding was never confirmed to exist in 0G's
///      public fine-tuning implementation (see prior research: The
///      Cascade Gate, The Cascade Verdict) and this contract makes no
///      claim that it does. A registered record is circumstantial,
///      accountable evidence — a real party is on the hook for having
///      signed it — not a cryptographic proof of derivation. See
///      docs/trust-model.md before treating this contract's output as
///      anything stronger.
///
///      This contract has no knowledge of, and no effect on, Level 1
///      (`servingConfidence`, entirely owned by `ExecutionRegistry` and
///      the not-yet-built Phase 7 wrapper) or Level 3 (bare declared
///      claims in `CascadeRegistry`). See docs/adr/0010.
contract TrainingProvenanceRegistry is EIP712 {
    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    /// @notice The signed claim. Every field is provider-attested — see
    ///         contract-level NatSpec for exactly what that does and does
    ///         not establish.
    struct TrainingProvenanceClaim {
        bytes32 childModelId;
        bytes32 baseModelId;
        bytes32 baseModelHash;
        bytes32 datasetRootHash;
        bytes32 scriptHash;
        bytes32 resultRootHash;
        bytes32 taskId;
        string evidenceURI;
        uint64 issuedAt;
    }

    /// @notice The stored record. `provider` and `registrant` are derived
    ///         at registration time, never signed fields themselves.
    struct TrainingProvenance {
        bytes32 baseModelId;
        bytes32 baseModelHash;
        bytes32 datasetRootHash;
        bytes32 scriptHash;
        bytes32 resultRootHash;
        bytes32 taskId;
        string evidenceURI;
        address provider;
        address registrant;
        uint64 issuedAt;
        uint64 registeredAt;
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    bytes32 public constant TRAINING_PROVENANCE_CLAIM_TYPEHASH = keccak256(
        "TrainingProvenanceClaim(bytes32 childModelId,bytes32 baseModelId,bytes32 baseModelHash,bytes32 datasetRootHash,bytes32 scriptHash,bytes32 resultRootHash,bytes32 taskId,string evidenceURI,uint64 issuedAt)"
    );

    CascadeRegistry public immutable cascadeRegistry;
    ExecutionRegistry public immutable executionRegistry;

    mapping(bytes32 => TrainingProvenance) private _provenanceOf;
    mapping(bytes32 => bool) public provenanceExists;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event ProvenanceRegistered(
        bytes32 indexed childModelId,
        bytes32 indexed baseModelId,
        address indexed provider,
        address registrant,
        bytes32 commitment,
        bytes32 taskId
    );

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error NotModelOwner();
    error ProvenanceAlreadyRegistered();
    error UnregisteredProvider();
    error ResultCommitmentMismatch();
    error BaseModelCommitmentMismatch();
    error ProvenanceNotFound();
    error ZeroAddress();

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    constructor(address cascadeRegistryAddress, address executionRegistryAddress) EIP712("Cascade", "1") {
        if (cascadeRegistryAddress == address(0) || executionRegistryAddress == address(0)) revert ZeroAddress();
        cascadeRegistry = CascadeRegistry(cascadeRegistryAddress);
        executionRegistry = ExecutionRegistry(executionRegistryAddress);
    }

    // ---------------------------------------------------------------------
    // Registration
    // ---------------------------------------------------------------------

    /// @notice Registers a Level 2 provenance record for `claim.childModelId`.
    /// @dev Dual authorization (docs/adr/0010): `msg.sender` must be the
    ///      child model's registered `CascadeRegistry` owner, AND the
    ///      claim must carry a registered `ExecutionRegistry` provider
    ///      signer's signature. Neither alone is sufficient. Records are
    ///      immutable — there is no update function, and a second
    ///      registration for the same `childModelId` reverts.
    function registerProvenance(TrainingProvenanceClaim calldata claim, bytes calldata signature)
        external
        returns (bytes32 commitment)
    {
        if (provenanceExists[claim.childModelId]) revert ProvenanceAlreadyRegistered();

        CascadeRegistry.Model memory childModel = cascadeRegistry.getModel(claim.childModelId);
        if (childModel.owner != msg.sender) revert NotModelOwner();

        CascadeRegistry.Model memory baseModel = cascadeRegistry.getModel(claim.baseModelId);

        if (childModel.modelCommitment != claim.resultRootHash) revert ResultCommitmentMismatch();
        if (baseModel.modelCommitment != claim.baseModelHash) revert BaseModelCommitmentMismatch();

        commitment = hashClaim(claim);
        bytes32 digest = _hashTypedDataV4(commitment);
        address signer = ECDSA.recover(digest, signature);

        address provider = executionRegistry.providerOfSigner(signer);
        if (provider == address(0)) revert UnregisteredProvider();

        _provenanceOf[claim.childModelId] = TrainingProvenance({
            baseModelId: claim.baseModelId,
            baseModelHash: claim.baseModelHash,
            datasetRootHash: claim.datasetRootHash,
            scriptHash: claim.scriptHash,
            resultRootHash: claim.resultRootHash,
            taskId: claim.taskId,
            evidenceURI: claim.evidenceURI,
            provider: provider,
            registrant: msg.sender,
            issuedAt: claim.issuedAt,
            registeredAt: uint64(block.timestamp)
        });
        provenanceExists[claim.childModelId] = true;

        emit ProvenanceRegistered(claim.childModelId, claim.baseModelId, provider, msg.sender, commitment, claim.taskId);
    }

    // ---------------------------------------------------------------------
    // Canonical hashing — mirrors ExecutionRegistry.hashUsageProof /
    // hashTypedDataDigest so the SDK, relayer, and off-chain auditors use
    // the same encoding this contract does, not a reimplementation of it.
    // ---------------------------------------------------------------------

    function hashClaim(TrainingProvenanceClaim calldata claim) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                TRAINING_PROVENANCE_CLAIM_TYPEHASH,
                claim.childModelId,
                claim.baseModelId,
                claim.baseModelHash,
                claim.datasetRootHash,
                claim.scriptHash,
                claim.resultRootHash,
                claim.taskId,
                keccak256(bytes(claim.evidenceURI)),
                claim.issuedAt
            )
        );
    }

    function hashTypedDataDigest(TrainingProvenanceClaim calldata claim) external view returns (bytes32) {
        return _hashTypedDataV4(hashClaim(claim));
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getProvenance(bytes32 childModelId) external view returns (TrainingProvenance memory) {
        if (!provenanceExists[childModelId]) revert ProvenanceNotFound();
        return _provenanceOf[childModelId];
    }

    /// @notice The `evidenceHash` a `CascadeRegistry` Level 2 lineage edge
    ///         for `childModelId` should carry, by convention — see
    ///         docs/adr/0010. Not enforced by `CascadeRegistry` itself.
    function evidenceHashOf(bytes32 childModelId) external view returns (bytes32) {
        if (!provenanceExists[childModelId]) revert ProvenanceNotFound();
        return _hashRecord(childModelId, _provenanceOf[childModelId]);
    }

    /// @notice Convenience check for challengers/auditors: does a
    ///         registered provenance record for `childModelId` exist,
    ///         name `expectedBaseModelId` as its base, and hash to
    ///         `expectedEvidenceHash`? A `false` result means a
    ///         `CascadeRegistry` edge claiming that pairing is either
    ///         unbacked or misrepresented — challengeable through
    ///         `CascadeRegistry`'s existing mechanism (docs/adr/0010).
    function matchesEdge(bytes32 childModelId, bytes32 expectedBaseModelId, bytes32 expectedEvidenceHash)
        external
        view
        returns (bool)
    {
        if (!provenanceExists[childModelId]) return false;
        TrainingProvenance memory record = _provenanceOf[childModelId];
        if (record.baseModelId != expectedBaseModelId) return false;
        return _hashRecord(childModelId, record) == expectedEvidenceHash;
    }

    function _hashRecord(bytes32 childModelId, TrainingProvenance memory record) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                TRAINING_PROVENANCE_CLAIM_TYPEHASH,
                childModelId,
                record.baseModelId,
                record.baseModelHash,
                record.datasetRootHash,
                record.scriptHash,
                record.resultRootHash,
                record.taskId,
                keccak256(bytes(record.evidenceURI)),
                record.issuedAt
            )
        );
    }
}
