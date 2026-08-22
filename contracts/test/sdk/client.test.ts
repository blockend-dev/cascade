import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { createCascadeClient } from "../../../sdk/src/client";
import { ConfidenceLevel, EdgeStatus, ModelStatus } from "../../../sdk/src/types";
import { deployCascadeStack, randomHash } from "./helpers";

const MIN_STAKE = ethers.parseEther("0.01");
const CHALLENGE_WINDOW_SECONDS = 3 * 24 * 60 * 60;

async function fixture() {
  const stack = await deployCascadeStack();
  return stack;
}

describe("SDK client", () => {
  describe("read-only vs signer-bound", () => {
    it("a read-only client (no signer) can read chain state", async () => {
      const { addresses } = await loadFixture(fixture);
      const client = createCascadeClient({ provider: ethers.provider, addresses });
      const params = await client.read.getCascadeRegistryParameters();
      expect(params.maxDepth).to.be.a("number");
    });

    it("a read-only client throws a clear error on any write attempt, not an opaque ethers error", async () => {
      const { addresses } = await loadFixture(fixture);
      const client = createCascadeClient({ provider: ethers.provider, addresses });
      let message = "";
      try {
        await client.write.registerModel(randomHash(), "0g-storage://x");
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }
      expect(message).to.include("requires a signer");
    });

    it("a signer-bound client can both read and write", async () => {
      const { addresses, signers } = await loadFixture(fixture);
      const client = createCascadeClient({ provider: ethers.provider, signer: signers[0], addresses });
      const { modelId } = await client.write.registerModel(randomHash(), "0g-storage://x");
      const model = await client.read.getModel(modelId);
      expect(model.owner).to.equal(signers[0].address);
    });
  });

  describe("model + lineage round trip", () => {
    it("registers a model and reads it back with matching fields", async () => {
      const { addresses, signers } = await loadFixture(fixture);
      const client = createCascadeClient({ provider: ethers.provider, signer: signers[0], addresses });
      const commitment = randomHash();
      const { modelId } = await client.write.registerModel(commitment, "0g-storage://manifest");

      const model = await client.read.getModel(modelId);
      expect(model.modelCommitment).to.equal(commitment);
      expect(model.status).to.equal(ModelStatus.Active);
    });

    it("registers a lineage edge, challenges nothing, and finalizes it after the window", async () => {
      const { addresses, signers } = await loadFixture(fixture);
      const parentClient = createCascadeClient({ provider: ethers.provider, signer: signers[0], addresses });
      const childClient = createCascadeClient({ provider: ethers.provider, signer: signers[1], addresses });

      const { modelId: parentId } = await parentClient.write.registerModel(randomHash(), "0g-storage://p");
      const { modelId: childId } = await childClient.write.registerModel(randomHash(), "0g-storage://c");

      const { edgeId } = await childClient.write.registerLineageEdge(
        childId,
        parentId,
        ConfidenceLevel.Declared,
        1000,
        ethers.ZeroHash,
        MIN_STAKE
      );

      let edge = await childClient.read.getEdge(edgeId);
      expect(edge.status).to.equal(EdgeStatus.Pending);

      await time.increase(CHALLENGE_WINDOW_SECONDS + 1);
      await childClient.write.finalizeEdge(edgeId);

      edge = await childClient.read.getEdge(edgeId);
      expect(edge.status).to.equal(EdgeStatus.Finalized);
    });

    it("a challenged edge can be resolved by the registered resolver via the SDK", async () => {
      const { addresses, signers, resolver } = await loadFixture(fixture);
      const parentClient = createCascadeClient({ provider: ethers.provider, signer: signers[0], addresses });
      const childClient = createCascadeClient({ provider: ethers.provider, signer: signers[1], addresses });
      const challengerClient = createCascadeClient({ provider: ethers.provider, signer: signers[2], addresses });
      const resolverClient = createCascadeClient({ provider: ethers.provider, signer: resolver, addresses });

      const { modelId: parentId } = await parentClient.write.registerModel(randomHash(), "0g-storage://p");
      const { modelId: childId } = await childClient.write.registerModel(randomHash(), "0g-storage://c");
      const { edgeId } = await childClient.write.registerLineageEdge(
        childId,
        parentId,
        ConfidenceLevel.Declared,
        1000,
        ethers.ZeroHash,
        MIN_STAKE
      );

      await challengerClient.write.challengeEdge(edgeId, MIN_STAKE);
      await resolverClient.write.resolveChallenge(edgeId, false); // challenge fails -> finalized

      const edge = await childClient.read.getEdge(edgeId);
      expect(edge.status).to.equal(EdgeStatus.Finalized);
    });
  });

  describe("error decoding", () => {
    it("decodes a real on-chain revert into a named, typed error", async () => {
      const { addresses, signers } = await loadFixture(fixture);
      const ownerClient = createCascadeClient({ provider: ethers.provider, signer: signers[0], addresses });
      const strangerClient = createCascadeClient({ provider: ethers.provider, signer: signers[1], addresses });

      const { modelId } = await ownerClient.write.registerModel(randomHash(), "0g-storage://x");

      let decoded;
      try {
        await strangerClient.write.updateMetadataURI(modelId, "0g-storage://hijacked");
      } catch (err) {
        decoded = strangerClient.decodeError(err);
      }
      expect(decoded?.name).to.equal("NotModelOwner");
      expect(decoded?.contract).to.equal("CascadeRegistry");
    });

    it("returns an 'unknown' shape rather than throwing for a non-Cascade error", () => {
      const client = createCascadeClient({
        provider: ethers.provider,
        addresses: {
          cascadeRegistry: ethers.ZeroAddress,
          executionRegistry: ethers.ZeroAddress,
          attributionSettlement: ethers.ZeroAddress,
          trainingProvenanceRegistry: ethers.ZeroAddress,
        },
      });
      const decoded = client.decodeError(new Error("plain JS error, not a contract revert"));
      expect(decoded.contract).to.equal("unknown");
    });
  });
});
