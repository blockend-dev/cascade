/**
 * Minimal, hand-maintained ABI fragments — only what the relayer actually
 * calls. Deliberately not generated from contracts/artifacts: a relayer is
 * an external, permissionless party that only needs the public interface,
 * not the Solidity source, and pulling from contracts/artifacts would
 * create a fragile cross-package build-order dependency for no real
 * benefit. If CascadeRegistry / ExecutionRegistry / AttributionSettlement's
 * public interface changes, this file must be updated to match — that
 * coupling is real and disclosed, not hidden.
 */

export const EXECUTION_REGISTRY_ABI = [
  "function providerOfSigner(address signer) view returns (address)",
  "function providerMode(address provider) view returns (uint8)",
  "function executionConsumed(bytes32 executionId) view returns (bool)",
  "function proofValidityWindow() view returns (uint64)",
  "function hashExecutionId(address provider, bytes32 modelId, bytes32 requestHash, bytes32 responseHash) pure returns (bytes32)",
  "function hashTypedDataDigest((bytes32 modelId, bytes32 modelCommitment, bytes32 requestHash, bytes32 responseHash, bytes32 chatId, uint64 epoch, uint64 issuedAt) proof) view returns (bytes32)",
  "function verifyUsageProof((bytes32 modelId, bytes32 modelCommitment, bytes32 requestHash, bytes32 responseHash, bytes32 chatId, uint64 epoch, uint64 issuedAt) proof, bytes signature) view returns (address signer, address provider, bytes32 modelId, bytes32 executionId, bytes32 requestHash, bytes32 responseHash, uint8 servingConfidence)",
  "event UsageProofConsumed(bytes32 indexed executionId, address indexed provider, bytes32 indexed modelId, bytes32 requestHash)",
  "error SignerAlreadyRegistered()",
  "error NotSignerOwner()",
  "error UnregisteredSigner()",
  "error ModelCommitmentMismatch()",
  "error ProofExpired()",
  "error ProofNotYetValid()",
  "error ExecutionAlreadyConsumed()",
  "error ZeroAddress()",
] as const;

export const ATTRIBUTION_SETTLEMENT_ABI = [
  "function attributionFeePerExecution() view returns (uint256)",
  "function currentEpoch() view returns (uint64)",
  "function claimable(address owner) view returns (uint256)",
  "function settleExecution((bytes32 modelId, bytes32 modelCommitment, bytes32 requestHash, bytes32 responseHash, bytes32 chatId, uint64 epoch, uint64 issuedAt) proof, bytes signature) payable returns (bytes32 executionId)",
  "event ExecutionSettled(bytes32 indexed executionId, bytes32 indexed modelId, address indexed provider, uint64 epoch, uint256 amount, uint8 servingConfidence)",
  "event OwnerCredited(bytes32 indexed executionId, bytes32 indexed modelId, address indexed owner, uint256 amount)",
  "error IncorrectFunding()",
  "error InvalidEpoch()",
  "error NothingToClaim()",
  "error TransferFailed()",
  "error ZeroAddress()",
] as const;

// CascadeRegistry.getModel returns a single `Model memory` struct — one
// tuple, not five flat return values; a flat-returns ABI fragment encodes
// differently on the wire and fails to decode even though it type-checks.
// Currently unused in this package (the relayer only talks to
// ExecutionRegistry directly), fixed anyway rather than left as a
// landmine for whenever it is used — see wrapper/src/abi.ts, where the
// same bug was live and caught by contracts/test/wrapper's tests.
export const CASCADE_REGISTRY_ABI = [
  "function getModel(bytes32 modelId) view returns (tuple(address owner, bytes32 modelCommitment, string metadataURI, uint8 status, uint64 createdAt))",
] as const;
