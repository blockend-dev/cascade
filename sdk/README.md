# @cascade/sdk

A thin, typed TypeScript client over Cascade's four contracts —
`CascadeRegistry`, `ExecutionRegistry`, `AttributionSettlement`, and
`TrainingProvenanceRegistry`. It wraps protocol logic; it never
reimplements it. Every non-trivial computation (EIP-712 verification,
execution identity, confidence composition, settlement arithmetic,
provenance cross-checks) is a call into the contract that actually owns
that logic, not a local re-derivation. See
[docs/adr/0012](../docs/adr/0012-sdk-abi-authority-and-boundaries.md) for
the reasoning.

## Install / build

```bash
cd sdk
npm install
npm run generate-abis   # regenerates sdk/src/abis/*.ts from contracts/artifacts
npm run build            # tsc -> dist/
```

`generate-abis` requires `contracts/` to have been compiled first
(`npx hardhat compile` in `contracts/`). The generated ABI files are
committed, so installing and using the SDK doesn't itself require a
Solidity toolchain — only *changing* a contract and wanting the SDK to
pick it up does.

## Quick start

```typescript
import { ethers } from "ethers";
import { createCascadeClient } from "@cascade/sdk";

const provider = new ethers.JsonRpcProvider("http://localhost:8545");
const signer = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);

const client = createCascadeClient({
  provider,
  signer, // omit for a read-only client
  addresses: {
    cascadeRegistry: "0x...",
    executionRegistry: "0x...",
    attributionSettlement: "0x...",
    trainingProvenanceRegistry: "0x...",
  },
});
```

A client built without `signer` can do everything under `client.read`
and `client.usage.verifyUsageProof`; any write or `submitUsageProof`
call throws a clear `Error` ("This operation requires a signer...")
rather than an opaque ethers failure or a silent no-op.

## Reading state

```typescript
const model = await client.read.getModel(modelId);
// { owner, modelCommitment, metadataURI, status, createdAt }

const edge = await client.read.getEdge(edgeId);
const confidence = await client.read.pathConfidence(childModelId, ancestorModelId);
const params = await client.read.getCascadeRegistryParameters();
// { maxParentBps, maxDepth, maxParentsPerModel, minStake, challengeBondAmount, challengeWindow, resolver }

const claimable = await client.read.getClaimable(ownerAddress);
const provenance = await client.read.getProvenance(childModelId);
```

`client.read` covers model/lineage state, provider/signer state,
execution-consumption state, settlement/claimable state, and Level 2
provenance state — 19 functions total, listed in
[src/client.ts](src/client.ts). None of them mutate state; all are safe
without a signer.

## Registering a model and lineage

```typescript
const { modelId, receipt } = await client.write.registerModel(
  modelCommitment, // bytes32 content hash, e.g. a 0G Storage root
  "0g-storage://<manifest-uri>"
);

const { edgeId } = await client.write.registerLineageEdge(
  childModelId,
  parentModelId,
  ConfidenceLevel.CryptographicallyBound,
  3000, // royaltyBps, 30% of whatever flows into the child
  evidenceHash,
  minStake // must be >= CascadeRegistry's configured minStake
);

// After the challenge window elapses with no successful challenge:
await client.write.finalizeEdge(edgeId);
```

`registerModel` generates a random 32-byte salt itself if you don't
supply one — you only need to pass one if your application has its own
reason to control it.

## Signing and submitting a usage proof

Verification always goes through the contract's own logic
(`ExecutionRegistry.verifyUsageProof`) — the SDK never recovers a
signer or checks expiry/replay itself.

```typescript
import { signUsageProof } from "@cascade/sdk";

const domain = await client.usageProofDomain(); // { name, version, chainId, verifyingContract }
const proof = {
  modelId,
  modelCommitment,
  requestHash,
  responseHash,
  chatId,
  epoch: await client.read.getCurrentEpoch(),
  issuedAt: BigInt(Math.floor(Date.now() / 1000)),
};
const signature = await signUsageProof(providerSigner, domain, proof);

// Check validity without spending gas:
const verified = await client.usage.verifyUsageProof(proof, signature);

// Submit for real settlement:
const { executionId, receipt } = await client.usage.submitUsageProof(proof, signature);
```

**`client.usage.submitUsageProof` is not the canonical submission
path.** It is a single-attempt call with no retry, no fee-bump
replacement, and no multi-relayer race handling — useful for scripts,
tests, and simple integrations. Production traffic should submit
through the Phase 5 relayer (`relayer/`, see
[docs/relayer.md](../docs/relayer.md)), which this SDK does not
replace or compete with.

## Claiming attribution

```typescript
const owed = await client.read.getClaimable(myAddress);
if (owed > 0n) {
  await client.write.claimAttribution();
}
```

## Registering training provenance (Level 2)

```typescript
import { signTrainingProvenanceClaim } from "@cascade/sdk";

const domain = await client.trainingProvenanceClaimDomain();
const claim = {
  childModelId,
  baseModelId,
  baseModelHash,
  datasetRootHash,
  scriptHash,
  resultRootHash, // must equal the child model's registered commitment
  taskId,
  evidenceURI: "0g-storage://<task-manifest>",
  issuedAt: BigInt(Math.floor(Date.now() / 1000)),
};
const signature = await signTrainingProvenanceClaim(providerSigner, domain, claim);

const { commitment } = await client.write.registerProvenance(claim, signature);
const matches = await client.read.matchesEdge(childModelId, baseModelId, commitment);
```

A registered claim is circumstantial, accountable evidence that a
specific registered provider signed it — not a cryptographic proof
that the provider's enclave actually computed the declared output from
the declared inputs. See
[docs/trust-model.md](../docs/trust-model.md) before treating
`getProvenance`/`matchesEdge` results as stronger than that.

## Decoding errors

```typescript
try {
  await client.write.updateMetadataURI(modelId, newUri);
} catch (err) {
  const decoded = client.decodeError(err);
  // { contract: "CascadeRegistry", name: "NotModelOwner", args: [...], raw }
  console.error(`${decoded.contract}.${decoded.name}`);
}
```

`decodeError` tries every deployed contract's custom-error ABI in
turn; if the error doesn't match any of them (a plain JS error, a
network failure, a revert from an unrelated contract) it returns
`{ contract: "unknown", name: "UnknownError", ... }` rather than
throwing, so it's always safe to call from a `catch` block.

## Querying events

```typescript
import { queryEvents } from "@cascade/sdk";

const registrations = await queryEvents(
  client.contracts.cascadeRegistry,
  "ModelRegistered",
  [], // indexed-arg filter values, positional
  0,  // fromBlock
  "latest"
);
```

`queryEvents` is not part of `client.read` — it operates on one raw
`ethers.Contract` at a time (`client.contracts.cascadeRegistry`,
`.executionRegistry`, `.attributionSettlement`,
`.trainingProvenanceRegistry`), rather than the client's bundled view.

## Wrapper information (read-only)

```typescript
const requiredCommitment = await client.wrapperInfo.getRequiredModelCommitment(modelId);
const eligibility = await client.wrapperInfo.getWrapperEligibility(providerAddress);
// { provider, mode, isCascadeWrapperMode }
```

These are read-only lookups about a wrapper deployment's *on-chain*
configuration. They do not run, verify, or manage a wrapper process —
that lifecycle belongs entirely to `wrapper/`.

## What this SDK deliberately does not expose

- **No second execution ID.** `hashExecutionId` is one function, on
  `ExecutionRegistry`; `client.read.computeExecutionId` calls it, it
  does not recompute it.
- **No second confidence model.** Lineage confidence
  (`CascadeRegistry`) and serving confidence (`ExecutionRegistry`) stay
  on their own two axes, exactly as ADR 0006 established; the SDK
  never merges them into a single client-side score.
- **No second settlement mechanism.** `submitUsageProof` calls
  `AttributionSettlement.settleExecution` and nothing else computes a
  payout amount or recipient; the SDK cannot be used to attribute to
  an address or amount the contract itself didn't derive.
- **No client-controlled recipient or amount.** There is no SDK
  function that takes a recipient address or payout amount as a
  parameter anywhere in the write or usage API.
- **No claims stronger than the three confidence levels permit.**
  `wrapperInfo` and provenance reads describe exactly what they
  observed on-chain, with the same trust-model caveats the underlying
  contracts document — never an inferred stronger guarantee.
- **No retry/backoff/fee-bump submission logic.** That belongs to
  `relayer/`; duplicating it here would be a second, competing
  submission path.
- **No 0G Storage proof verification.** That lives in
  `wrapper/src/storage.ts`; this SDK does not touch storage proofs at
  all.

## Testing

SDK tests live under `contracts/test/sdk/` (not `sdk/` itself) so they
can run against real deployed contracts on Hardhat's local network,
consistent with every other package in this repository — no mocks.

```bash
cd contracts
npx hardhat test test/sdk
```

Covers: EIP-712 digest parity with the contracts'
`hashTypedDataDigest` for both `UsageProof` and
`TrainingProvenanceClaim`; read-only vs signer-bound client behavior;
model/lineage registration and challenge/finalize round trips; error
decoding; a full two-hop-lineage end-to-end flow from registration
through a claimed payout; adversarial cases (wrong domain, wrong
verifying contract, tampered fields, unregistered signers, commitment
mismatches, expired proofs, double submission); Level 2 provenance
round trips; and a guard test that fails if `sdk/src/abis/*.ts` drifts
from the currently compiled contract artifacts.
