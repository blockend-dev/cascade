import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { createCascadeClient } from "../../../sdk/src/client";
import { ConfidenceLevel, EdgeStatus } from "../../../sdk/src/types";
import { signUsageProof } from "../../../sdk/src/eip712";
import { deployCascadeStack, randomHash } from "./helpers";

const MIN_STAKE = ethers.parseEther("0.01");
const CHALLENGE_WINDOW_SECONDS = 3 * 24 * 60 * 60;

async function fixture() {
  return deployCascadeStack();
}

describe("SDK end-to-end — register, sign, submit, settle, claim through the SDK alone", () => {
  it("carries a two-hop lineage graph from registration through a claimed payout, touching nothing but sdk/src", async () => {
    const { addresses, signers } = await loadFixture(fixture);
    const [providerSigner, rootOwner, childOwner, grandchildOwner] = signers;

    const providerClient = createCascadeClient({ provider: ethers.provider, signer: providerSigner, addresses });
    await providerClient.write.registerProviderSigner(providerSigner.address);

    const rootClient = createCascadeClient({ provider: ethers.provider, signer: rootOwner, addresses });
    const childClient = createCascadeClient({ provider: ethers.provider, signer: childOwner, addresses });
    const grandchildClient = createCascadeClient({ provider: ethers.provider, signer: grandchildOwner, addresses });

    // Two-hop lineage: grandchild -> child -> root.
    const { modelId: rootId } = await rootClient.write.registerModel(randomHash(), "0g-storage://root");
    const { modelId: childId } = await childClient.write.registerModel(randomHash(), "0g-storage://child");
    const grandchildCommitment = randomHash();
    const { modelId: grandchildId } = await grandchildClient.write.registerModel(
      grandchildCommitment,
      "0g-storage://grandchild"
    );

    const { edgeId: childToRoot } = await childClient.write.registerLineageEdge(
      childId,
      rootId,
      ConfidenceLevel.CryptographicallyBound,
      3000, // 30%
      ethers.ZeroHash,
      MIN_STAKE
    );
    const { edgeId: grandchildToChild } = await grandchildClient.write.registerLineageEdge(
      grandchildId,
      childId,
      ConfidenceLevel.CryptographicallyBound,
      4000, // 40%
      ethers.ZeroHash,
      MIN_STAKE
    );

    await time.increase(CHALLENGE_WINDOW_SECONDS + 1);
    await childClient.write.finalizeEdge(childToRoot);
    await grandchildClient.write.finalizeEdge(grandchildToChild);

    expect((await grandchildClient.read.getEdge(childToRoot)).status).to.equal(EdgeStatus.Finalized);
    expect((await grandchildClient.read.getEdge(grandchildToChild)).status).to.equal(EdgeStatus.Finalized);

    // Provider signs and the SDK submits a usage proof against the grandchild model.
    const domain = await providerClient.usageProofDomain();
    const proof = {
      modelId: grandchildId,
      modelCommitment: grandchildCommitment,
      requestHash: randomHash(),
      responseHash: randomHash(),
      chatId: randomHash(),
      epoch: await providerClient.read.getCurrentEpoch(),
      issuedAt: BigInt(await time.latest()),
    };
    const signature = await signUsageProof(providerSigner, domain, proof);

    const verified = await providerClient.usage.verifyUsageProof(proof, signature);
    expect(verified.modelId).to.equal(grandchildId);

    const { executionId } = await providerClient.usage.submitUsageProof(proof, signature);
    expect(executionId).to.not.equal(ethers.ZeroHash);

    // settleExecution's replay protection (Phase 3's own, not re-implemented) rejects a
    // second submission of the identical proof.
    await expect(providerClient.usage.submitUsageProof(proof, signature)).to.be.reverted;

    const fee = await providerClient.read.getAttributionFeePerExecution();
    const grandchildShare = fee - (fee * 4000n) / 10000n; // residual after the one direct-parent edge
    const childShareFromGrandchild = (fee * 4000n) / 10000n;
    const childResidual = childShareFromGrandchild - (childShareFromGrandchild * 3000n) / 10000n;
    const rootShare = (childShareFromGrandchild * 3000n) / 10000n;

    expect(await grandchildClient.read.getClaimable(grandchildOwner.address)).to.equal(grandchildShare);
    expect(await childClient.read.getClaimable(childOwner.address)).to.equal(childResidual);
    expect(await rootClient.read.getClaimable(rootOwner.address)).to.equal(rootShare);
    // Conservation: every wei funded into the settlement is credited to exactly one owner.
    expect(grandchildShare + childResidual + rootShare).to.equal(fee);

    const balanceBefore = await ethers.provider.getBalance(rootOwner.address);
    const receipt = await rootClient.write.claimAttribution();
    const gasSpent = receipt.gasUsed * receipt.gasPrice;
    const balanceAfter = await ethers.provider.getBalance(rootOwner.address);
    expect(balanceAfter).to.equal(balanceBefore + rootShare - gasSpent);
    expect(await rootClient.read.getClaimable(rootOwner.address)).to.equal(0n);
  });
});
