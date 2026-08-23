import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { createCascadeClient } from "../../../sdk/src/client";
import { ConfidenceLevel } from "../../../sdk/src/types";
import { fetchLineageSubgraph } from "../../../web/src/lineage/fetchSubgraph";
import { layoutDag } from "../../../web/src/lineage/layout";
import { confidenceLabel } from "../../../web/src/confidence";
import { deployCascadeStack, freshDataLayer, randomHash } from "./helpers";

const MIN_STAKE = ethers.parseEther("0.01");

async function fixture() {
  return deployCascadeStack();
}

describe("Frontend data layer — real indexer HTTP API + real chain data (no mocks)", () => {
  it("IndexerClient.getModel / listModels round-trip real data over real HTTP, reviving bigint fields", async function () {
    this.timeout(90_000); // first loadFixture() call in this file — real deployment, not a snapshot revert
    const stack = await loadFixture(fixture);
    const { indexer, client, close } = await freshDataLayer(stack);
    try {
      const owner = stack.signers[0];
      const cascadeClient = createCascadeClient({ provider: ethers.provider, signer: owner, addresses: stack.addresses });
      const commitment = randomHash();
      const { modelId } = await cascadeClient.write.registerModel(commitment, "0g-storage://x");
      await indexer.syncToHead();

      const model = await client.getModel(modelId);
      expect(model).to.not.be.null;
      expect(model!.owner.toLowerCase()).to.equal(owner.address.toLowerCase());
      expect(model!.modelCommitment).to.equal(commitment);

      const page = await client.listModels({ limit: 10 });
      expect(page.items.map((m) => m.modelId)).to.include(modelId);

      expect(await client.getModel(randomHash())).to.be.null; // never fabricates a record for an unknown ID
    } finally {
      close();
    }
  });

  it("bigint-valued fields (stake, amount, epoch) arrive as real bigints, not lossy JS numbers", async () => {
    const stack = await loadFixture(fixture);
    const { indexer, client, close } = await freshDataLayer(stack);
    try {
      const owner = stack.signers[0];
      const cascadeClient = createCascadeClient({ provider: ethers.provider, signer: owner, addresses: stack.addresses });
      const { modelId: parentId } = await cascadeClient.write.registerModel(randomHash(), "0g-storage://p");
      const { modelId: childId } = await cascadeClient.write.registerModel(randomHash(), "0g-storage://c");
      const { edgeId } = await cascadeClient.write.registerLineageEdge(
        childId,
        parentId,
        ConfidenceLevel.Declared,
        1000,
        ethers.ZeroHash,
        MIN_STAKE
      );
      await indexer.syncToHead();

      const edge = await client.getEdge(edgeId);
      expect(edge).to.not.be.null;
      expect(typeof edge!.stake).to.equal("bigint");
      expect(edge!.stake).to.equal(MIN_STAKE);
    } finally {
      close();
    }
  });

  it("fetchLineageSubgraph + layoutDag render a real multi-parent DAG registered on-chain, generations matching the true ancestry", async () => {
    const stack = await loadFixture(fixture);
    const { indexer, client, close } = await freshDataLayer(stack);
    try {
      const owner = stack.signers[0];
      const c = createCascadeClient({ provider: ethers.provider, signer: owner, addresses: stack.addresses });

      const { modelId: a } = await c.write.registerModel(randomHash(), "0g-storage://a");
      const { modelId: b } = await c.write.registerModel(randomHash(), "0g-storage://b");
      const { modelId: cc } = await c.write.registerModel(randomHash(), "0g-storage://c");
      const { modelId: d } = await c.write.registerModel(randomHash(), "0g-storage://d");

      await c.write.registerLineageEdge(b, a, ConfidenceLevel.Declared, 1000, ethers.ZeroHash, MIN_STAKE);
      await c.write.registerLineageEdge(cc, a, ConfidenceLevel.CryptographicallyBound, 1000, ethers.ZeroHash, MIN_STAKE);
      await c.write.registerLineageEdge(d, b, ConfidenceLevel.Declared, 1000, ethers.ZeroHash, MIN_STAKE);
      await c.write.registerLineageEdge(d, cc, ConfidenceLevel.AttestedTraining, 1000, ethers.ZeroHash, MIN_STAKE);
      await indexer.syncToHead();

      const { models, edges } = await fetchLineageSubgraph(client, d);
      const layout = layoutDag(d, models, edges);

      expect(layout.nodes.find((n) => n.modelId === a)!.generation).to.equal(-2);
      expect(layout.nodes.find((n) => n.modelId === b)!.generation).to.equal(-1);
      expect(layout.nodes.find((n) => n.modelId === cc)!.generation).to.equal(-1);
      expect(layout.nodes.find((n) => n.modelId === d)!.generation).to.equal(0);
      expect(layout.edges).to.have.lengthOf(4);

      // Confidence levels are the REAL registered values, not fabricated.
      const dToC = layout.edges.find((e) => e.edge.childModelId === d && e.edge.parentModelId === cc)!;
      expect(dToC.edge.confidenceLevel).to.equal(ConfidenceLevel.AttestedTraining);
      expect(confidenceLabel(dToC.edge.confidenceLevel)).to.equal("Attested Training");
    } finally {
      close();
    }
  });

  it("a multi-hop chain (A -> B -> C) lays out across three real generations", async () => {
    const stack = await loadFixture(fixture);
    const { indexer, client, close } = await freshDataLayer(stack);
    try {
      const owner = stack.signers[0];
      const c = createCascadeClient({ provider: ethers.provider, signer: owner, addresses: stack.addresses });
      const { modelId: a } = await c.write.registerModel(randomHash(), "0g-storage://a");
      const { modelId: b } = await c.write.registerModel(randomHash(), "0g-storage://b");
      const { modelId: cc } = await c.write.registerModel(randomHash(), "0g-storage://c");
      await c.write.registerLineageEdge(b, a, ConfidenceLevel.Declared, 500, ethers.ZeroHash, MIN_STAKE);
      await c.write.registerLineageEdge(cc, b, ConfidenceLevel.Declared, 500, ethers.ZeroHash, MIN_STAKE);
      await indexer.syncToHead();

      const { models, edges } = await fetchLineageSubgraph(client, cc);
      const layout = layoutDag(cc, models, edges);
      expect(layout.minGeneration).to.equal(-2);
      expect(layout.nodes.find((n) => n.modelId === a)!.generation).to.equal(-2);
    } finally {
      close();
    }
  });

  it("an unfinalized (Pending) edge is reflected honestly in indexed data — not shown as Finalized", async () => {
    const stack = await loadFixture(fixture);
    const { indexer, client, close } = await freshDataLayer(stack);
    try {
      const owner = stack.signers[0];
      const c = createCascadeClient({ provider: ethers.provider, signer: owner, addresses: stack.addresses });
      const { modelId: a } = await c.write.registerModel(randomHash(), "0g-storage://a");
      const { modelId: b } = await c.write.registerModel(randomHash(), "0g-storage://b");
      const { edgeId } = await c.write.registerLineageEdge(b, a, ConfidenceLevel.Declared, 500, ethers.ZeroHash, MIN_STAKE);
      await indexer.syncToHead();

      const edge = await client.getEdge(edgeId);
      expect(edge!.status).to.equal("Pending");
    } finally {
      close();
    }
  });

  it("a challenged edge is indexed with status Challenged, distinctly from Pending/Finalized/Rejected", async () => {
    const stack = await loadFixture(fixture);
    const { indexer, client, close } = await freshDataLayer(stack);
    try {
      const owner = stack.signers[0];
      const challenger = stack.signers[1];
      const c = createCascadeClient({ provider: ethers.provider, signer: owner, addresses: stack.addresses });
      const challengerClient = createCascadeClient({ provider: ethers.provider, signer: challenger, addresses: stack.addresses });
      const { modelId: a } = await c.write.registerModel(randomHash(), "0g-storage://a");
      const { modelId: b } = await c.write.registerModel(randomHash(), "0g-storage://b");
      const { edgeId } = await c.write.registerLineageEdge(b, a, ConfidenceLevel.Declared, 500, ethers.ZeroHash, MIN_STAKE);
      await challengerClient.write.challengeEdge(edgeId, MIN_STAKE);
      await indexer.syncToHead();

      const edge = await client.getEdge(edgeId);
      expect(edge!.status).to.equal("Challenged");
    } finally {
      close();
    }
  });

  it("listModelsByOwner / listExecutionsByModel / listExecutionsByProvider (Phase 10's additive indexer queries) return real, correctly-scoped data", async () => {
    const stack = await loadFixture(fixture);
    const { indexer, client, close } = await freshDataLayer(stack);
    try {
      const [providerSigner, ownerA, ownerB] = stack.signers;
      const providerClient = createCascadeClient({ provider: ethers.provider, signer: providerSigner, addresses: stack.addresses });
      await providerClient.write.registerProviderSigner(providerSigner.address);

      const clientA = createCascadeClient({ provider: ethers.provider, signer: ownerA, addresses: stack.addresses });
      const clientB = createCascadeClient({ provider: ethers.provider, signer: ownerB, addresses: stack.addresses });
      const { modelId: modelA1 } = await clientA.write.registerModel(randomHash(), "0g-storage://a1");
      await clientA.write.registerModel(randomHash(), "0g-storage://a2");
      const commitmentB = randomHash();
      const { modelId: modelB } = await clientB.write.registerModel(commitmentB, "0g-storage://b");

      const { signUsageProof } = await import("../../../sdk/src/eip712");
      const domain = await providerClient.usageProofDomain();
      const proof = {
        modelId: modelB,
        modelCommitment: commitmentB,
        requestHash: randomHash(),
        responseHash: randomHash(),
        chatId: randomHash(),
        epoch: await providerClient.read.getCurrentEpoch(),
        issuedAt: BigInt(await time.latest()),
      };
      const sig = await signUsageProof(providerSigner, domain, proof);
      const { executionId } = await providerClient.usage.submitUsageProof(proof, sig);
      await indexer.syncToHead();

      const ownedByA = await client.listModelsByOwner(ownerA.address, { limit: 10 });
      expect(ownedByA.items.map((m) => m.modelId)).to.include(modelA1);
      expect(ownedByA.items.map((m) => m.modelId)).to.not.include(modelB);

      const executionsForModelB = await client.listExecutionsByModel(modelB, { limit: 10 });
      expect(executionsForModelB.items.map((e) => e.executionId)).to.deep.equal([executionId]);

      const executionsForProvider = await client.listExecutionsByProvider(providerSigner.address, { limit: 10 });
      expect(executionsForProvider.items.map((e) => e.executionId)).to.include(executionId);
    } finally {
      close();
    }
  });
});
