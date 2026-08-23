import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { createCascadeClient } from "../../../sdk/src/client";
import { signUsageProof } from "../../../sdk/src/eip712";
import { buildContractCatalog, normalize } from "../../../indexer/src/normalize";
import { fetchRawLogs } from "../../../indexer/src/ingestion";
import { ingestEvent } from "../../../indexer/src/projection";
import { createIndexer } from "../../../indexer/src/sync";
import { rebuildProjections } from "../../../indexer/src/reorg";
import * as query from "../../../indexer/src/query";
import { deployCascadeStack, freshIndexer, testConfig, randomHash } from "./helpers";

async function fixture() {
  return deployCascadeStack();
}

const ALL_ADDRESSES = (addresses: Awaited<ReturnType<typeof deployCascadeStack>>["addresses"]) => [
  addresses.cascadeRegistry,
  addresses.executionRegistry,
  addresses.attributionSettlement,
  addresses.trainingProvenanceRegistry,
];

describe("Indexer idempotency", () => {
  it("re-ingesting the identical canonical event twice does not duplicate rows or double-count balances", async () => {
    const { addresses, signers } = await loadFixture(fixture);
    const { db, indexer } = freshIndexer(addresses);
    const client = createCascadeClient({ provider: ethers.provider, signer: signers[0], addresses });
    await client.write.registerModel(randomHash(), "0g-storage://x");
    await indexer.syncToHead();

    const before = query.getEvents(db, { limit: 100 });
    const eventCountBefore = before.items.length;
    expect(eventCountBefore).to.be.greaterThan(0);

    // Re-fetch and re-ingest the exact same historical range a second time.
    const catalog = buildContractCatalog(addresses);
    const batch = await fetchRawLogs(ethers.provider, ALL_ADDRESSES(addresses), 0, await ethers.provider.getBlockNumber());
    const events = normalize(batch, 31337n, catalog);
    for (const event of events) {
      ingestEvent(db, event); // deliberately reprocessing everything already stored
    }

    const after = query.getEvents(db, { limit: 100 });
    expect(after.items).to.have.lengthOf(eventCountBefore);
  });

  it("settlement credits are not double-counted when OwnerCredited is ingested twice", async () => {
    const { addresses, signers } = await loadFixture(fixture);
    const { db, indexer } = freshIndexer(addresses);
    const providerSigner = signers[0];
    const ownerSigner = signers[1];

    const providerClient = createCascadeClient({ provider: ethers.provider, signer: providerSigner, addresses });
    await providerClient.write.registerProviderSigner(providerSigner.address);
    const ownerClient = createCascadeClient({ provider: ethers.provider, signer: ownerSigner, addresses });
    const commitment = randomHash();
    const { modelId } = await ownerClient.write.registerModel(commitment, "0g-storage://x");

    const domain = await providerClient.usageProofDomain();
    const proof = {
      modelId,
      modelCommitment: commitment,
      requestHash: randomHash(),
      responseHash: randomHash(),
      chatId: randomHash(),
      epoch: await providerClient.read.getCurrentEpoch(),
      issuedAt: BigInt(await time.latest()),
    };
    const sig = await signUsageProof(providerSigner, domain, proof);
    await providerClient.usage.submitUsageProof(proof, sig);

    const fee = await providerClient.read.getAttributionFeePerExecution();
    await indexer.syncToHead();
    const balanceAfterOnce = query.getClaimable(db, ownerSigner.address);
    expect(balanceAfterOnce).to.equal(fee);

    // Sync again — nothing new on chain, must not re-apply the credit.
    await indexer.syncToHead();
    expect(query.getClaimable(db, ownerSigner.address)).to.equal(fee);

    // And a manual full replay of the whole events table must land on
    // exactly the same balance, not a multiple of it.
    rebuildProjections(db);
    expect(query.getClaimable(db, ownerSigner.address)).to.equal(fee);
  });

  it("overlapping RPC block ranges do not produce duplicate events", async () => {
    const { addresses, signers } = await loadFixture(fixture);
    const { db } = freshIndexer(addresses);
    const client = createCascadeClient({ provider: ethers.provider, signer: signers[0], addresses });
    await client.write.registerModel(randomHash(), "0g-storage://a");
    await client.write.registerModel(randomHash(), "0g-storage://b");

    const head = await ethers.provider.getBlockNumber();
    const catalog = buildContractCatalog(addresses);

    // Two overlapping fetch windows covering the same blocks twice.
    const batchA = await fetchRawLogs(ethers.provider, ALL_ADDRESSES(addresses), 0, head);
    const batchB = await fetchRawLogs(ethers.provider, ALL_ADDRESSES(addresses), 0, head); // fully overlapping, not just partially

    for (const event of normalize(batchA, 31337n, catalog)) ingestEvent(db, event);
    for (const event of normalize(batchB, 31337n, catalog)) ingestEvent(db, event);

    const page = query.getEvents(db, { eventName: "ModelRegistered", limit: 100 });
    expect(page.items).to.have.lengthOf(2); // not 4
  });

  it("a fresh indexer instance pointed at the same database resumes correctly after a simulated restart", async () => {
    const { addresses, signers } = await loadFixture(fixture);
    const { db } = freshIndexer(addresses);
    const client = createCascadeClient({ provider: ethers.provider, signer: signers[0], addresses });
    await client.write.registerModel(randomHash(), "0g-storage://x");

    const firstProcess = createIndexer(db, ethers.provider, testConfig({ addresses }));
    await firstProcess.syncToHead();
    const statusAfterFirst = await firstProcess.getSyncStatus();

    await client.write.registerModel(randomHash(), "0g-storage://y");

    // Simulate a process restart: a brand new indexer instance, same
    // underlying database (no in-memory state carried over except what
    // the database itself holds).
    const secondProcess = createIndexer(db, ethers.provider, testConfig({ addresses }));
    await secondProcess.syncToHead();
    const statusAfterSecond = await secondProcess.getSyncStatus();

    expect(statusAfterSecond.lastIndexedBlock).to.be.greaterThan(statusAfterFirst.lastIndexedBlock!);
    const page = query.getEvents(db, { eventName: "ModelRegistered", limit: 100 });
    expect(page.items).to.have.lengthOf(2);
  });

  it("rebuild-from-genesis on a database opened fresh from an empty file produces the same projection as the original sync", async () => {
    const { addresses, signers } = await loadFixture(fixture);
    const { db, indexer } = freshIndexer(addresses);
    const client = createCascadeClient({ provider: ethers.provider, signer: signers[0], addresses });
    const { modelId } = await client.write.registerModel(randomHash(), "0g-storage://x");
    await indexer.syncToHead();

    const originalModel = query.getModel(db, modelId);
    expect(originalModel).to.not.be.null;

    const { db: freshDb, indexer: freshIndexerInstance } = freshIndexer(addresses);
    await freshIndexerInstance.syncToHead();

    const rebuiltModel = query.getModel(freshDb, modelId);
    expect(rebuiltModel).to.deep.equal(originalModel);
  });
});
