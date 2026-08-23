import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { createCascadeClient } from "../../../sdk/src/client";
import { signUsageProof, signTrainingProvenanceClaim } from "../../../sdk/src/eip712";
import { ConfidenceLevel, EdgeStatus as SdkEdgeStatus, ModelStatus as SdkModelStatus } from "../../../sdk/src/types";
import * as query from "../../../indexer/src/query";
import { deployCascadeStack, freshIndexer, randomHash } from "./helpers";

const MIN_STAKE = ethers.parseEther("0.01");
const CHALLENGE_WINDOW_SECONDS = 3 * 24 * 60 * 60;

async function fixture() {
  return deployCascadeStack();
}

describe("Indexer projections — full scenario, cross-checked against direct SDK/contract reads", () => {
  it("projects models, lineage, providers, provenance, executions, and settlement identically to the chain's own state", async () => {
    const { addresses, signers } = await loadFixture(fixture);
    const { db, indexer } = freshIndexer(addresses);
    const [providerSigner, rootOwner, childOwner] = signers;

    const providerClient = createCascadeClient({ provider: ethers.provider, signer: providerSigner, addresses });
    await providerClient.write.registerProviderSigner(providerSigner.address);

    const rootClient = createCascadeClient({ provider: ethers.provider, signer: rootOwner, addresses });
    const rootCommitment = randomHash();
    const { modelId: rootId } = await rootClient.write.registerModel(rootCommitment, "0g-storage://root");

    const childClient = createCascadeClient({ provider: ethers.provider, signer: childOwner, addresses });
    const childCommitment = randomHash();
    const { modelId: childId } = await childClient.write.registerModel(childCommitment, "0g-storage://child");

    const { edgeId } = await childClient.write.registerLineageEdge(
      childId,
      rootId,
      ConfidenceLevel.CryptographicallyBound,
      3000,
      ethers.ZeroHash,
      MIN_STAKE
    );
    await time.increase(CHALLENGE_WINDOW_SECONDS + 1);
    await childClient.write.finalizeEdge(edgeId);

    // Training provenance for the child, base = root.
    const provDomain = await childClient.trainingProvenanceClaimDomain();
    const claim = {
      childModelId: childId,
      baseModelId: rootId,
      baseModelHash: rootCommitment,
      datasetRootHash: randomHash(),
      scriptHash: randomHash(),
      resultRootHash: childCommitment,
      taskId: randomHash(),
      evidenceURI: "0g-storage://task",
      issuedAt: BigInt(await time.latest()),
    };
    const provSig = await signTrainingProvenanceClaim(providerSigner, provDomain, claim);
    await childClient.write.registerProvenance(claim, provSig);

    // Usage proof -> settle -> claim.
    const usageDomain = await providerClient.usageProofDomain();
    const proof = {
      modelId: childId,
      modelCommitment: childCommitment,
      requestHash: randomHash(),
      responseHash: randomHash(),
      chatId: randomHash(),
      epoch: await providerClient.read.getCurrentEpoch(),
      issuedAt: BigInt(await time.latest()),
    };
    const sig = await signUsageProof(providerSigner, usageDomain, proof);
    const { executionId } = await providerClient.usage.submitUsageProof(proof, sig);

    const fee = await providerClient.read.getAttributionFeePerExecution();
    const rootShare = (fee * 3000n) / 10000n;
    const childShare = fee - rootShare;

    await rootClient.write.claimAttribution();

    // --- Sync the indexer, then verify every projection ---
    await indexer.syncToHead();

    const modelRow = query.getModel(db, childId);
    expect(modelRow).to.not.be.null;
    expect(modelRow!.owner).to.equal(childOwner.address);
    expect(modelRow!.modelCommitment).to.equal(childCommitment);
    expect(modelRow!.status).to.equal("Active");
    // Cross-check against the chain directly (category C comparison).
    const chainModel = await childClient.read.getModel(childId);
    expect(modelRow!.owner).to.equal(chainModel.owner);
    expect(Number(modelRow!.status === "Active" ? SdkModelStatus.Active : SdkModelStatus.Revoked)).to.equal(chainModel.status);

    const edgeRow = query.getEdge(db, edgeId);
    expect(edgeRow).to.not.be.null;
    expect(edgeRow!.status).to.equal("Finalized");
    expect(edgeRow!.royaltyBps).to.equal(3000);
    expect(edgeRow!.confidenceLevel).to.equal(ConfidenceLevel.CryptographicallyBound);
    const chainEdge = await childClient.read.getEdge(edgeId);
    expect(Number(chainEdge.status)).to.equal(SdkEdgeStatus.Finalized);
    // NOT chainEdge.stake here: CascadeRegistry zeroes its own `stake`
    // field once an edge is finalized (the stake has been returned to
    // the registrant — see CascadeRegistry.finalizeEdge). The indexer's
    // `edges.stake` intentionally retains the amount staked AT
    // REGISTRATION (a fact emitted once, in LineageEdgeRegistered, that
    // never changes), not a live "currently held" balance — these are
    // different, both-correct semantics, not a discrepancy.
    expect(edgeRow!.stake).to.equal(MIN_STAKE);

    const lineage = query.getModelLineage(db, childId);
    expect(lineage.parents.map((e) => e.edgeId)).to.deep.equal([edgeId]);
    expect(query.getChildren(db, rootId).map((e) => e.edgeId)).to.deep.equal([edgeId]);

    const providerSummary = query.getProvider(db, providerSigner.address);
    expect(providerSummary.signerCount).to.equal(1);
    const providerSigners = query.getProviderSigners(db, providerSigner.address);
    expect(providerSigners).to.have.lengthOf(1);
    expect(providerSigners[0].signer.toLowerCase()).to.equal(providerSigner.address.toLowerCase());
    expect(providerSigners[0].active).to.equal(true);

    const provenanceRow = query.getTrainingProvenance(db, childId);
    expect(provenanceRow).to.not.be.null;
    expect(provenanceRow!.baseModelId).to.equal(rootId);
    expect(provenanceRow!.provider).to.equal(providerSigner.address);
    expect(provenanceRow!.commitment).to.equal(await childClient.read.getEvidenceHash(childId));

    const executionRow = query.getExecution(db, executionId);
    expect(executionRow).to.not.be.null;
    expect(executionRow!.provider).to.equal(providerSigner.address);
    expect(executionRow!.modelId).to.equal(childId);
    expect(executionRow!.amount).to.equal(fee);
    expect(executionRow!.servingConfidence).to.equal(ConfidenceLevel.Declared); // Standard mode provider, not CascadeWrapper

    const attribution = query.getExecutionAttribution(db, executionId);
    expect(attribution.edgeAttributions).to.have.lengthOf(1);
    expect(attribution.edgeAttributions[0].amount).to.equal(rootShare);
    expect(attribution.ownerCredits.map((c) => c.owner).sort()).to.deep.equal(
      [rootOwner.address, childOwner.address].sort()
    );
    const conservedTotal = attribution.ownerCredits.reduce((sum, c) => sum + c.amount, 0n);
    expect(conservedTotal).to.equal(fee); // conservation: every wei funded is credited to exactly one owner

    // rootOwner already claimed -> claimable is 0 there, but the credit + claim history still exist.
    expect(query.getClaimable(db, rootOwner.address)).to.equal(0n);
    expect(query.getClaimable(db, rootOwner.address)).to.equal(await providerClient.read.getClaimable(rootOwner.address));
    expect(query.getClaimable(db, childOwner.address)).to.equal(childShare);
    expect(query.getClaimable(db, childOwner.address)).to.equal(await providerClient.read.getClaimable(childOwner.address));

    const claims = query.getClaims(db, rootOwner.address);
    expect(claims).to.have.lengthOf(1);
    expect(claims[0].amount).to.equal(rootShare);
  });

  it("listModels and getEvents paginate deterministically in canonical chain order", async () => {
    const { addresses, signers } = await loadFixture(fixture);
    const { db, indexer } = freshIndexer(addresses);
    const client = createCascadeClient({ provider: ethers.provider, signer: signers[0], addresses });

    const modelIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const { modelId } = await client.write.registerModel(randomHash(), `0g-storage://m${i}`);
      modelIds.push(modelId);
    }
    await indexer.syncToHead();

    const page1 = query.listModels(db, { limit: 2 });
    expect(page1.items).to.have.lengthOf(2);
    expect(page1.items.map((m) => m.modelId)).to.deep.equal(modelIds.slice(0, 2));
    expect(page1.nextCursor).to.not.be.null;

    const page2 = query.listModels(db, { limit: 2, cursor: page1.nextCursor! });
    expect(page2.items.map((m) => m.modelId)).to.deep.equal(modelIds.slice(2, 4));

    const page3 = query.listModels(db, { limit: 2, cursor: page2.nextCursor! });
    expect(page3.items.map((m) => m.modelId)).to.deep.equal(modelIds.slice(4, 5));
    expect(page3.nextCursor).to.be.null;

    const eventsPage = query.getEvents(db, { eventName: "ModelRegistered", limit: 3 });
    expect(eventsPage.items).to.have.lengthOf(3);
    expect(eventsPage.items.every((e) => e.eventName === "ModelRegistered")).to.equal(true);
    // Ascending (blockNumber, logIndex) order, never insertion/physical order.
    for (let i = 1; i < eventsPage.items.length; i++) {
      const prev = eventsPage.items[i - 1];
      const cur = eventsPage.items[i];
      expect(cur.blockNumber > prev.blockNumber || (cur.blockNumber === prev.blockNumber && cur.logIndex > prev.logIndex)).to.equal(true);
    }
  });
});
