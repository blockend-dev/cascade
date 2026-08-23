import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { createCascadeClient } from "../../../sdk/src/client";
import { signUsageProof } from "../../../sdk/src/eip712";
import { ConfidenceLevel } from "../../../sdk/src/types";
import { buildContractCatalog, normalize } from "../../../indexer/src/normalize";
import * as query from "../../../indexer/src/query";
import { deployCascadeStack, freshIndexer, randomHash } from "./helpers";

const MIN_STAKE = ethers.parseEther("0.01");
const CHALLENGE_WINDOW_SECONDS = 3 * 24 * 60 * 60;

async function fixture() {
  return deployCascadeStack();
}

describe("Indexer security properties", () => {
  it("finalized vs rejected challenge outcomes are projected distinctly, and a rejected edge is excluded from settlement attribution", async () => {
    const { addresses, signers, resolver } = await loadFixture(fixture);
    const { db, indexer } = freshIndexer(addresses);
    const [providerSigner, rootOwner, childOwner, challenger] = signers;

    const providerClient = createCascadeClient({ provider: ethers.provider, signer: providerSigner, addresses });
    await providerClient.write.registerProviderSigner(providerSigner.address);
    const rootClient = createCascadeClient({ provider: ethers.provider, signer: rootOwner, addresses });
    const { modelId: rootId } = await rootClient.write.registerModel(randomHash(), "0g-storage://root");
    const childClient = createCascadeClient({ provider: ethers.provider, signer: childOwner, addresses });
    const childCommitment = randomHash();
    const { modelId: childId } = await childClient.write.registerModel(childCommitment, "0g-storage://child");

    const { edgeId } = await childClient.write.registerLineageEdge(
      childId,
      rootId,
      ConfidenceLevel.Declared,
      2000,
      ethers.ZeroHash,
      MIN_STAKE
    );

    const challengerClient = createCascadeClient({ provider: ethers.provider, signer: challenger, addresses });
    await challengerClient.write.challengeEdge(edgeId, MIN_STAKE);
    const resolverClient = createCascadeClient({ provider: ethers.provider, signer: resolver, addresses });
    await resolverClient.write.resolveChallenge(edgeId, true); // challenge upheld -> Rejected

    await indexer.syncToHead();
    const rejectedEdge = query.getEdge(db, edgeId);
    expect(rejectedEdge!.status).to.equal("Rejected");

    // Settle an execution against the child — the rejected edge must
    // receive no attribution at all.
    const domain = await providerClient.usageProofDomain();
    const proof = {
      modelId: childId,
      modelCommitment: childCommitment,
      requestHash: randomHash(),
      responseHash: randomHash(),
      chatId: randomHash(),
      epoch: await providerClient.read.getCurrentEpoch(),
      issuedAt: BigInt(await time.latest()),
    };
    const sig = await signUsageProof(providerSigner, domain, proof);
    const { executionId } = await providerClient.usage.submitUsageProof(proof, sig);
    await indexer.syncToHead();

    const attribution = query.getExecutionAttribution(db, executionId);
    expect(attribution.edgeAttributions).to.have.lengthOf(0); // rejected edge, no share
    expect(attribution.ownerCredits).to.have.lengthOf(1);
    expect(attribution.ownerCredits[0].owner).to.equal(childOwner.address);

    // A second, separate edge that IS finalized behaves oppositely.
    const { modelId: root2 } = await rootClient.write.registerModel(randomHash(), "0g-storage://root2");
    const { edgeId: finalizedEdgeId } = await childClient.write.registerLineageEdge(
      childId,
      root2,
      ConfidenceLevel.Declared,
      1000,
      ethers.ZeroHash,
      MIN_STAKE
    );
    await time.increase(CHALLENGE_WINDOW_SECONDS + 1);
    await childClient.write.finalizeEdge(finalizedEdgeId);
    await indexer.syncToHead();
    expect(query.getEdge(db, finalizedEdgeId)!.status).to.equal("Finalized");
  });

  it("lineage confidence and serving confidence never merge into one score", async () => {
    const { addresses, signers } = await loadFixture(fixture);
    const { db, indexer } = freshIndexer(addresses);
    const [providerSigner, rootOwner, childOwner] = signers;

    const providerClient = createCascadeClient({ provider: ethers.provider, signer: providerSigner, addresses });
    await providerClient.write.registerProviderSigner(providerSigner.address);
    // Provider stays in Standard mode -> serving confidence will be Declared, regardless of lineage confidence below.
    const rootClient = createCascadeClient({ provider: ethers.provider, signer: rootOwner, addresses });
    const { modelId: rootId } = await rootClient.write.registerModel(randomHash(), "0g-storage://root");
    const childClient = createCascadeClient({ provider: ethers.provider, signer: childOwner, addresses });
    const childCommitment = randomHash();
    const { modelId: childId } = await childClient.write.registerModel(childCommitment, "0g-storage://child");

    // Lineage edge declared at the STRONGEST level.
    const { edgeId } = await childClient.write.registerLineageEdge(
      childId,
      rootId,
      ConfidenceLevel.CryptographicallyBound,
      2000,
      ethers.ZeroHash,
      MIN_STAKE
    );
    await time.increase(CHALLENGE_WINDOW_SECONDS + 1);
    await childClient.write.finalizeEdge(edgeId);

    const domain = await providerClient.usageProofDomain();
    const proof = {
      modelId: childId,
      modelCommitment: childCommitment,
      requestHash: randomHash(),
      responseHash: randomHash(),
      chatId: randomHash(),
      epoch: await providerClient.read.getCurrentEpoch(),
      issuedAt: BigInt(await time.latest()),
    };
    const sig = await signUsageProof(providerSigner, domain, proof);
    const { executionId } = await providerClient.usage.submitUsageProof(proof, sig);
    await indexer.syncToHead();

    const edgeRow = query.getEdge(db, edgeId);
    const executionRow = query.getExecution(db, executionId);
    const attribution = query.getExecutionAttribution(db, executionId);

    // Lineage confidence stays CryptographicallyBound in its own table...
    expect(edgeRow!.confidenceLevel).to.equal(ConfidenceLevel.CryptographicallyBound);
    // ...serving confidence stays Declared (Standard provider mode) in a completely separate table...
    expect(executionRow!.servingConfidence).to.equal(ConfidenceLevel.Declared);
    // ...and the settlement's own effectiveConfidence is the weakest-link
    // min of the two — exactly what the contract computed, never
    // recomputed or overridden by the indexer.
    expect(attribution.edgeAttributions[0].effectiveConfidence).to.equal(ConfidenceLevel.Declared);
    expect(edgeRow!.confidenceLevel).to.not.equal(executionRow!.servingConfidence); // the two axes genuinely differ here
  });

  it("credits go to the CURRENT registered owner at settlement time, never a cached earlier owner (no fabricated recipient)", async () => {
    const { addresses, signers } = await loadFixture(fixture);
    const { db, indexer } = freshIndexer(addresses);
    const [providerSigner, originalOwner, newOwner] = signers;

    const providerClient = createCascadeClient({ provider: ethers.provider, signer: providerSigner, addresses });
    await providerClient.write.registerProviderSigner(providerSigner.address);
    const ownerClient = createCascadeClient({ provider: ethers.provider, signer: originalOwner, addresses });
    const commitment = randomHash();
    const { modelId } = await ownerClient.write.registerModel(commitment, "0g-storage://x");

    const domain = await providerClient.usageProofDomain();
    const firstProof = {
      modelId,
      modelCommitment: commitment,
      requestHash: randomHash(),
      responseHash: randomHash(),
      chatId: randomHash(),
      epoch: await providerClient.read.getCurrentEpoch(),
      issuedAt: BigInt(await time.latest()),
    };
    const firstSig = await signUsageProof(providerSigner, domain, firstProof);
    const { executionId: firstExecutionId } = await providerClient.usage.submitUsageProof(firstProof, firstSig);

    await ownerClient.write.transferModelOwnership(modelId, newOwner.address);

    const secondProof = {
      ...firstProof,
      requestHash: randomHash(),
      responseHash: randomHash(),
      issuedAt: BigInt(await time.latest()),
    };
    const secondSig = await signUsageProof(providerSigner, domain, secondProof);
    const { executionId: secondExecutionId } = await providerClient.usage.submitUsageProof(secondProof, secondSig);

    await indexer.syncToHead();

    const firstAttribution = query.getExecutionAttribution(db, firstExecutionId);
    const secondAttribution = query.getExecutionAttribution(db, secondExecutionId);
    expect(firstAttribution.ownerCredits[0].owner).to.equal(originalOwner.address);
    expect(secondAttribution.ownerCredits[0].owner).to.equal(newOwner.address);

    expect(query.getModel(db, modelId)!.owner).to.equal(newOwner.address);
  });

  it("querying an unknown execution ID returns null rather than a fabricated or mismatched record", async () => {
    const { addresses } = await loadFixture(fixture);
    const { db } = freshIndexer(addresses);
    expect(query.getExecution(db, randomHash())).to.be.null;
    expect(query.getModel(db, randomHash())).to.be.null;
    expect(query.getEdge(db, randomHash())).to.be.null;
    expect(query.getTrainingProvenance(db, randomHash())).to.be.null;
  });

  it("normalize() always returns events in canonical (blockNumber, logIndex) order regardless of input log order", async () => {
    const { addresses, signers } = await loadFixture(fixture);
    const client = createCascadeClient({ provider: ethers.provider, signer: signers[0], addresses });
    await client.write.registerModel(randomHash(), "0g-storage://a");
    await client.write.registerModel(randomHash(), "0g-storage://b");
    await client.write.registerModel(randomHash(), "0g-storage://c");

    const head = await ethers.provider.getBlockNumber();
    const logs = await ethers.provider.getLogs({ address: addresses.cascadeRegistry, fromBlock: 0, toBlock: head });
    expect(logs.length).to.be.greaterThanOrEqual(3);

    const shuffled = [...logs].reverse(); // deliberately out of canonical order
    const catalog = buildContractCatalog(addresses);
    const events = normalize({ logs: shuffled, blockTimestamps: new Map() }, 31337n, catalog);

    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1];
      const cur = events[i];
      expect(cur.blockNumber > prev.blockNumber || (cur.blockNumber === prev.blockNumber && cur.logIndex > prev.logIndex)).to.equal(
        true,
        "normalize() must sort regardless of input order"
      );
    }
  });

  it("a log from an unrecognized contract address is skipped rather than decoded speculatively", async () => {
    const { addresses } = await loadFixture(fixture);
    const catalog = buildContractCatalog(addresses);
    const fakeLog = {
      address: "0x000000000000000000000000000000000000dead",
      topics: ["0x" + "11".repeat(32)],
      data: "0x",
      blockNumber: 1,
      blockHash: "0x" + "22".repeat(32),
      transactionHash: "0x" + "33".repeat(32),
      transactionIndex: 0,
      index: 0,
    } as unknown as import("ethers").Log;

    const events = normalize({ logs: [fakeLog], blockTimestamps: new Map([[1, 12345]]) }, 31337n, catalog);
    expect(events).to.have.lengthOf(0);
  });

  it("a log at a known contract address whose topics don't match any known event is skipped, not fabricated into a payload", async () => {
    const { addresses } = await loadFixture(fixture);
    const catalog = buildContractCatalog(addresses);
    const garbledLog = {
      address: addresses.cascadeRegistry,
      topics: ["0x" + "ff".repeat(32)], // not a real event signature hash
      data: "0x",
      blockNumber: 1,
      blockHash: "0x" + "22".repeat(32),
      transactionHash: "0x" + "33".repeat(32),
      transactionIndex: 0,
      index: 0,
    } as unknown as import("ethers").Log;

    const events = normalize({ logs: [garbledLog], blockTimestamps: new Map([[1, 12345]]) }, 31337n, catalog);
    expect(events).to.have.lengthOf(0);
  });
});
