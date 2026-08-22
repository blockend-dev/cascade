import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { createCascadeClient } from "../../../sdk/src/client";
import {
  signTrainingProvenanceClaim,
  signUsageProof,
  trainingProvenanceClaimDigest,
  usageProofDigest,
} from "../../../sdk/src/eip712";
import { deployCascadeStack, randomHash } from "./helpers";

async function fixture() {
  return deployCascadeStack();
}

describe("SDK EIP-712 — construction, signing, and encoding parity with the contracts", () => {
  it("a locally computed UsageProof digest matches ExecutionRegistry.hashTypedDataDigest exactly", async () => {
    const { addresses, signers } = await loadFixture(fixture);
    const client = createCascadeClient({ provider: ethers.provider, addresses });
    const domain = await client.usageProofDomain();

    const proof = {
      modelId: randomHash(),
      modelCommitment: randomHash(),
      requestHash: randomHash(),
      responseHash: randomHash(),
      chatId: randomHash(),
      epoch: 1n,
      issuedAt: BigInt(await time.latest()),
    };

    const localDigest = usageProofDigest(domain, proof);
    const onChainDigest = await client.contracts.executionRegistry.hashTypedDataDigest(proof);
    expect(localDigest).to.equal(onChainDigest);
  });

  it("a locally computed TrainingProvenanceClaim digest matches TrainingProvenanceRegistry.hashTypedDataDigest exactly", async () => {
    const { addresses } = await loadFixture(fixture);
    const client = createCascadeClient({ provider: ethers.provider, addresses });
    const domain = await client.trainingProvenanceClaimDomain();

    const claim = {
      childModelId: randomHash(),
      baseModelId: randomHash(),
      baseModelHash: randomHash(),
      datasetRootHash: randomHash(),
      scriptHash: randomHash(),
      resultRootHash: randomHash(),
      taskId: randomHash(),
      evidenceURI: "0g-storage://manifest",
      issuedAt: BigInt(await time.latest()),
    };

    const localDigest = trainingProvenanceClaimDigest(domain, claim);
    const onChainDigest = await client.contracts.trainingProvenanceRegistry.hashTypedDataDigest(claim);
    expect(localDigest).to.equal(onChainDigest);
  });

  it("a proof signed via the SDK verifies successfully through ExecutionRegistry.verifyUsageProof", async () => {
    const { addresses, signers } = await loadFixture(fixture);
    const providerSigner = signers[0];
    const modelOwner = signers[1];
    const client = createCascadeClient({ provider: ethers.provider, signer: providerSigner, addresses });

    await client.write.registerProviderSigner(providerSigner.address);
    const ownerClient = createCascadeClient({ provider: ethers.provider, signer: modelOwner, addresses });
    const commitment = randomHash();
    const { modelId } = await ownerClient.write.registerModel(commitment, "0g-storage://x");

    const domain = await client.usageProofDomain();
    const proof = {
      modelId,
      modelCommitment: commitment,
      requestHash: randomHash(),
      responseHash: randomHash(),
      chatId: randomHash(),
      epoch: 1n,
      issuedAt: BigInt(await time.latest()),
    };
    const signature = await signUsageProof(providerSigner, domain, proof);

    const usage = await client.usage.verifyUsageProof(proof, signature);
    expect(usage.provider).to.equal(providerSigner.address);
    expect(usage.modelId).to.equal(modelId);
  });

  it("a claim signed via the SDK registers successfully through TrainingProvenanceRegistry", async () => {
    const { addresses, signers } = await loadFixture(fixture);
    const providerSigner = signers[0];
    const baseOwner = signers[1];
    const childOwner = signers[2];

    const providerClient = createCascadeClient({ provider: ethers.provider, signer: providerSigner, addresses });
    await providerClient.write.registerProviderSigner(providerSigner.address);

    const baseClient = createCascadeClient({ provider: ethers.provider, signer: baseOwner, addresses });
    const baseCommitment = randomHash();
    const { modelId: baseModelId } = await baseClient.write.registerModel(baseCommitment, "0g-storage://base");

    const childClient = createCascadeClient({ provider: ethers.provider, signer: childOwner, addresses });
    const childCommitment = randomHash();
    const { modelId: childModelId } = await childClient.write.registerModel(childCommitment, "0g-storage://child");

    const domain = await childClient.trainingProvenanceClaimDomain();
    const claim = {
      childModelId,
      baseModelId,
      baseModelHash: baseCommitment,
      datasetRootHash: randomHash(),
      scriptHash: randomHash(),
      resultRootHash: childCommitment,
      taskId: randomHash(),
      evidenceURI: "0g-storage://task-manifest",
      issuedAt: BigInt(await time.latest()),
    };
    const signature = await signTrainingProvenanceClaim(providerSigner, domain, claim);

    const { commitment } = await childClient.write.registerProvenance(claim, signature);
    expect(commitment).to.equal(await childClient.read.getEvidenceHash(childModelId));

    const record = await childClient.read.getProvenance(childModelId);
    expect(record.provider).to.equal(providerSigner.address);
    expect(record.baseModelId).to.equal(baseModelId);
  });
});
