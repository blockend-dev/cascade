import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { createCascadeClient } from "../../../sdk/src/client";
import { signTrainingProvenanceClaim } from "../../../sdk/src/eip712";
import { deployCascadeStack, randomHash } from "./helpers";

async function fixture() {
  return deployCascadeStack();
}

describe("SDK TrainingProvenanceRegistry — read wrappers over Level 2 provenance", () => {
  it("hasProvenance and matchesEdge reflect on-chain state before and after registration", async () => {
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

    expect(await childClient.read.hasProvenance(childModelId)).to.equal(false);

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

    expect(await childClient.read.hasProvenance(childModelId)).to.equal(true);
    expect(await childClient.read.matchesEdge(childModelId, baseModelId, commitment)).to.equal(true);
    // A wrong base model or a wrong evidence hash both fail to match —
    // matchesEdge is not a loose "some provenance exists" check.
    expect(await childClient.read.matchesEdge(childModelId, randomHash(), commitment)).to.equal(false);
    expect(await childClient.read.matchesEdge(childModelId, baseModelId, randomHash())).to.equal(false);
  });

  it("rejects a provenance claim signed by a provider whose declared resultRootHash does not match the child model's registered commitment", async () => {
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
    const { modelId: childModelId } = await childClient.write.registerModel(randomHash(), "0g-storage://child");

    const domain = await childClient.trainingProvenanceClaimDomain();
    const claim = {
      childModelId,
      baseModelId,
      baseModelHash: baseCommitment,
      datasetRootHash: randomHash(),
      scriptHash: randomHash(),
      resultRootHash: randomHash(), // does not match the child's registered commitment
      taskId: randomHash(),
      evidenceURI: "0g-storage://task-manifest",
      issuedAt: BigInt(await time.latest()),
    };
    const signature = await signTrainingProvenanceClaim(providerSigner, domain, claim);

    await expect(childClient.write.registerProvenance(claim, signature)).to.be.reverted;
    expect(await childClient.read.hasProvenance(childModelId)).to.equal(false);
  });
});
