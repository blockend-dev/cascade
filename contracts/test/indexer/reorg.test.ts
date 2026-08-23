import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, takeSnapshot } from "@nomicfoundation/hardhat-network-helpers";
import { createCascadeClient } from "../../../sdk/src/client";
import { readSyncState } from "../../../indexer/src/reorg";
import * as query from "../../../indexer/src/query";
import { deployCascadeStack, freshIndexer, randomHash } from "./helpers";

async function fixture() {
  return deployCascadeStack();
}

describe("Indexer reorg safety (real chain rollback via evm_snapshot/evm_revert, not simulated)", () => {
  it("rolls back a reorged event and re-ingests the new canonical history in its place", async () => {
    const { addresses, signers } = await loadFixture(fixture);
    const { db, indexer } = freshIndexer(addresses);
    const client = createCascadeClient({ provider: ethers.provider, signer: signers[0], addresses });

    const { modelId: survivorId } = await client.write.registerModel(randomHash(), "0g-storage://survivor");
    await indexer.syncToHead();
    expect(query.getModel(db, survivorId)).to.not.be.null;

    const snapshot = await takeSnapshot();

    const { modelId: staleId } = await client.write.registerModel(randomHash(), "0g-storage://stale-branch");
    await indexer.syncToHead();
    expect(query.getModel(db, staleId)).to.not.be.null; // indexed on the soon-to-be-abandoned branch

    const staleTip = readSyncState(db, 31337n);
    expect(staleTip).to.not.be.null;

    // Real chain rollback — not a mock, not a simulated event removal.
    await snapshot.restore();

    // A different transaction lands at the same block height the stale
    // one occupied, producing a genuinely different block hash there.
    const { modelId: canonicalId } = await client.write.registerModel(randomHash(), "0g-storage://canonical-branch");

    const result = await indexer.syncToHead();
    expect(result.reorgsRecovered).to.be.greaterThan(0);

    // The stale branch's model must be gone; the new canonical one present.
    expect(query.getModel(db, staleId)).to.be.null;
    expect(query.getModel(db, canonicalId)).to.not.be.null;
    expect(query.getModel(db, survivorId)).to.not.be.null; // pre-fork state untouched

    const newTip = readSyncState(db, 31337n);
    expect(newTip!.lastBlockHash).to.not.equal(staleTip!.lastBlockHash);

    // No event from the abandoned branch survives in the raw log either.
    const page = query.getEvents(db, { eventName: "ModelRegistered", limit: 100 });
    const projectedIds = page.items.map((e) => (e.payload as { modelId: string }).modelId);
    expect(projectedIds).to.include(canonicalId);
    expect(projectedIds).to.not.include(staleId);
  });

  it("a reorg with no locally retained canonical block left to walk back to falls back to a full wipe and clean resync", async () => {
    const { addresses, signers } = await loadFixture(fixture);
    const { db, indexer } = freshIndexer(addresses);
    const client = createCascadeClient({ provider: ethers.provider, signer: signers[0], addresses });

    const { modelId: firstId } = await client.write.registerModel(randomHash(), "0g-storage://first");
    await indexer.syncToHead();

    const snapshot = await takeSnapshot();
    const { modelId: staleId } = await client.write.registerModel(randomHash(), "0g-storage://stale");
    await indexer.syncToHead();

    // Force the "no candidate matches" path directly: with an empty
    // events table, the backward walk (reorg.ts's recoverFromReorg) has
    // nothing left to compare against the live chain, however far back
    // it looks — this is what "a reorg deeper than all locally retained
    // history" reduces to, without needing to actually replay hundreds
    // of blocks to construct that condition.
    db.exec(`DELETE FROM events;`);

    await snapshot.restore();
    const { modelId: canonicalId } = await client.write.registerModel(randomHash(), "0g-storage://canonical");

    const result = await indexer.syncToHead();
    expect(result.reorgsRecovered).to.be.greaterThan(0);
    expect(result.eventsIngested).to.be.greaterThan(0);

    expect(query.getModel(db, firstId)).to.not.be.null; // re-ingested fresh from genesis
    expect(query.getModel(db, staleId)).to.be.null;
    expect(query.getModel(db, canonicalId)).to.not.be.null;
  });
});
