import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { createCascadeClient } from "../../../sdk/src/client";
import { createIndexer } from "../../../indexer/src/sync";
import { openDb } from "../../../indexer/src/db";
import * as query from "../../../indexer/src/query";
import { deployCascadeStack, testConfig, randomHash } from "./helpers";

async function fixture() {
  return deployCascadeStack();
}

describe("Indexer sync — confirmation depth and status reporting", () => {
  it("never ingests a block newer than head - confirmations, and catches up once enough new blocks are mined", async () => {
    const { addresses, signers } = await loadFixture(fixture);
    const client = createCascadeClient({ provider: ethers.provider, signer: signers[0], addresses });
    const db = openDb(":memory:");
    const indexer = createIndexer(db, ethers.provider, testConfig({ addresses, confirmations: 3 }));

    const { modelId, receipt } = await client.write.registerModel(randomHash(), "0g-storage://x");
    const registrationBlock = receipt.blockNumber;

    await indexer.syncToHead();

    // Fewer than `confirmations` blocks have been mined since — the
    // registration's own block is not yet "safe", so it must not be
    // projected yet, and the indexer's own reported position must be
    // strictly behind it.
    expect(query.getModel(db, modelId)).to.be.null;
    const statusBeforeConfirmations = await indexer.getSyncStatus();
    expect(statusBeforeConfirmations.lastIndexedBlock!).to.be.lessThan(registrationBlock);

    // Mine 3 filler blocks (plain transfers) to push the head far enough ahead.
    for (let i = 0; i < 3; i++) {
      await signers[0].sendTransaction({ to: signers[1].address, value: 0n });
    }
    await indexer.syncToHead();
    expect(query.getModel(db, modelId)).to.not.be.null;

    const statusAfter = await indexer.getSyncStatus();
    expect(statusAfter.lagBlocks).to.equal(0);
    expect(statusAfter.chainId).to.equal(31337n);
  });

  it("getSyncStatus reports lag accurately before catching up, and zero once fully synced", async () => {
    const { addresses, signers } = await loadFixture(fixture);
    const db = openDb(":memory:");
    const client = createCascadeClient({ provider: ethers.provider, signer: signers[0], addresses });
    await client.write.registerModel(randomHash(), "0g-storage://x");

    const indexer = createIndexer(db, ethers.provider, testConfig({ addresses, confirmations: 0, chunkBlocks: 1 }));
    const before = await indexer.getSyncStatus();
    expect(before.lastIndexedBlock).to.be.null;
    expect(before.lagBlocks).to.be.greaterThan(0);

    // With chunkBlocks = 1, a single tick advances at most one block.
    await indexer.syncToHead(1);
    const afterOneTick = await indexer.getSyncStatus();
    expect(afterOneTick.lastIndexedBlock).to.equal(0);
    expect(afterOneTick.lagBlocks).to.be.greaterThan(0);

    await indexer.syncToHead(); // finish catching up
    const final = await indexer.getSyncStatus();
    expect(final.lagBlocks).to.equal(0);
  });
});
