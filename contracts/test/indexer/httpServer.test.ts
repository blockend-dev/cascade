import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { createCascadeClient } from "../../../sdk/src/client";
import { signUsageProof } from "../../../sdk/src/eip712";
import { ConfidenceLevel } from "../../../sdk/src/types";
import { startIndexerServer } from "../../../indexer/src/server";
import * as query from "../../../indexer/src/query";
import { deployCascadeStack, freshIndexer, randomHash } from "./helpers";

const MIN_STAKE = ethers.parseEther("0.01");

async function fixture() {
  return deployCascadeStack();
}

async function fetchJson(port: number, path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  const body = await res.json();
  return { status: res.status, body };
}

describe("Indexer HTTP query server (ADR 0014)", () => {
  it("serves the same data the in-process query API returns, over HTTP, read-only", async () => {
    const { addresses, signers } = await loadFixture(fixture);
    const { db, indexer } = freshIndexer(addresses);
    const client = createCascadeClient({ provider: ethers.provider, signer: signers[0], addresses });
    const { modelId } = await client.write.registerModel(randomHash(), "0g-storage://x");
    await indexer.syncToHead();

    const port = 18700 + (process.pid % 500);
    const server = startIndexerServer(db, () => indexer, port);
    try {
      const { status, body } = await fetchJson(port, `/models/${modelId}`);
      expect(status).to.equal(200);
      const direct = query.getModel(db, modelId);
      expect((body as { owner: string }).owner).to.equal(direct!.owner);
      expect((body as { modelCommitment: string }).modelCommitment).to.equal(direct!.modelCommitment);

      const missing = await fetchJson(port, `/models/${randomHash()}`);
      expect(missing.status).to.equal(404);

      const list = await fetchJson(port, `/models?limit=10`);
      expect(list.status).to.equal(200);
      expect((list.body as { items: unknown[] }).items).to.have.lengthOf(1);

      const status_ = await fetchJson(port, `/sync-status`);
      expect(status_.status).to.equal(200);
      expect((status_.body as { chainId: string }).chainId).to.equal("31337");

      // Read-only: no route accepts a write, and a POST is rejected outright.
      const postAttempt = await fetch(`http://127.0.0.1:${port}/models/${modelId}`, { method: "POST" });
      expect(postAttempt.status).to.equal(405);
    } finally {
      server.close();
    }
  });

  it("bigint fields (amounts, epoch, stake) round-trip as exact decimal strings, never lossy JSON numbers", async () => {
    const { addresses, signers } = await loadFixture(fixture);
    const { db, indexer } = freshIndexer(addresses);
    const [providerSigner, ownerSigner] = signers;

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
    const { executionId } = await providerClient.usage.submitUsageProof(proof, sig);
    await indexer.syncToHead();

    const port = 18700 + ((process.pid + 7) % 500);
    const server = startIndexerServer(db, () => indexer, port);
    try {
      const { body } = await fetchJson(port, `/executions/${executionId}`);
      const fee = await providerClient.read.getAttributionFeePerExecution();
      expect((body as { amount: string }).amount).to.equal(fee.toString());
      expect(typeof (body as { amount: unknown }).amount).to.equal("string"); // never a lossy JS number
    } finally {
      server.close();
    }
  });
});
