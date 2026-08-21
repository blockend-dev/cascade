/** Minimal, hand-maintained ABI fragment — same rationale as
 *  relayer/src/abi.ts: the wrapper only needs a read-only lookup of the
 *  registered model commitment, not the full CascadeRegistry interface. */
// CascadeRegistry.getModel returns a single `Model memory` struct — one
// tuple, not five flat return values. The ABI fragment must say so
// (`tuple(...)`) to decode correctly; a flat-returns declaration encodes
// differently on the wire and fails with "could not decode result data"
// even though it type-checks. Caught by contracts/test/wrapper's tests.
export const CASCADE_REGISTRY_ABI = [
  "function getModel(bytes32 modelId) view returns (tuple(address owner, bytes32 modelCommitment, string metadataURI, uint8 status, uint64 createdAt))",
] as const;
