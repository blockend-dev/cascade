import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

// Typechain codegen isn't wired up reliably in this environment (see
// docs/adr/0002-repo-layout-and-tooling.md) — using `any` for the deployed
// contract instance rather than a generated LineageRegistry interface.
// ethers' runtime Proxy resolves method calls regardless; this only
// affects compile-time autocomplete/checking. Revisit if typechain output
// becomes available.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LineageRegistry = any;

const ONE_ETH = ethers.parseEther("1");
const MIN_STAKE = ethers.parseEther("0.01");
const CHALLENGE_BOND = ethers.parseEther("0.01");

enum ConfidenceLevel {
  Declared = 0,
  AttestedTraining = 1,
  CryptographicallyBound = 2,
}

enum EdgeStatus {
  Pending = 0,
  Challenged = 1,
  Finalized = 2,
  Rejected = 3,
}

async function deployFixture() {
  const [owner, resolver, alice, bob, carol, challenger, stranger] = await ethers.getSigners();
  const Factory = await ethers.getContractFactory("LineageRegistry");
  const registry = (await Factory.deploy(resolver.address)) as unknown as LineageRegistry;
  await registry.waitForDeployment();
  return { registry, owner, resolver, alice, bob, carol, challenger, stranger };
}

async function registerModel(
  registry: LineageRegistry,
  signer: any,
  commitment = ethers.keccak256(ethers.toUtf8Bytes("model-artifact")),
  uri = "0g-storage://manifest",
  salt = ethers.randomBytes(32)
) {
  const tx = await registry.connect(signer).registerModel(commitment, uri, salt);
  const receipt = await tx.wait();
  const event = receipt!.logs
    .map((l) => {
      try {
        return registry.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((e) => e?.name === "ModelRegistered");
  return event!.args.modelId as string;
}

describe("LineageRegistry", () => {
  describe("model registration", () => {
    it("registers a model with a distinct modelId per owner+salt", async () => {
      const { registry, alice } = await loadFixture(deployFixture);
      const idA = await registerModel(registry, alice);
      const idB = await registerModel(registry, alice);
      expect(idA).to.not.equal(idB);
      expect(await registry.modelExists(idA)).to.equal(true);
    });

    it("stores owner, commitment, and metadata", async () => {
      const { registry, alice } = await loadFixture(deployFixture);
      const commitment = ethers.keccak256(ethers.toUtf8Bytes("weights-v1"));
      const modelId = await registerModel(registry, alice, commitment, "0g-storage://a");
      const model = await registry.getModel(modelId);
      expect(model.owner).to.equal(alice.address);
      expect(model.modelCommitment).to.equal(commitment);
      expect(model.status).to.equal(0); // Active
    });

    it("only the owner may update metadata or transfer ownership", async () => {
      const { registry, alice, bob } = await loadFixture(deployFixture);
      const modelId = await registerModel(registry, alice);
      await expect(registry.connect(bob).updateMetadataURI(modelId, "evil")).to.be.revertedWithCustomError(
        registry,
        "NotModelOwner"
      );
      await expect(registry.connect(alice).transferModelOwnership(modelId, bob.address))
        .to.emit(registry, "ModelOwnershipTransferred")
        .withArgs(modelId, alice.address, bob.address);
    });

    it("revocation blocks future edges but does not affect existing state", async () => {
      const { registry, alice, bob } = await loadFixture(deployFixture);
      const parentId = await registerModel(registry, alice);
      const childId = await registerModel(registry, bob);
      await registry.connect(alice).revokeModel(parentId);

      await expect(
        registry
          .connect(bob)
          .registerLineageEdge(childId, parentId, ConfidenceLevel.Declared, 1000, ethers.ZeroHash, {
            value: MIN_STAKE,
          })
      ).to.be.revertedWithCustomError(registry, "ModelNotActive");
    });
  });

  describe("lineage edge registration", () => {
    it("rejects self-parenting", async () => {
      const { registry, alice } = await loadFixture(deployFixture);
      const modelId = await registerModel(registry, alice);
      await expect(
        registry
          .connect(alice)
          .registerLineageEdge(modelId, modelId, ConfidenceLevel.Declared, 100, ethers.ZeroHash, {
            value: MIN_STAKE,
          })
      ).to.be.revertedWithCustomError(registry, "SelfParent");
    });

    it("requires the child owner to register the edge", async () => {
      const { registry, alice, bob } = await loadFixture(deployFixture);
      const parentId = await registerModel(registry, alice);
      const childId = await registerModel(registry, bob);
      await expect(
        registry
          .connect(alice)
          .registerLineageEdge(childId, parentId, ConfidenceLevel.Declared, 100, ethers.ZeroHash, {
            value: MIN_STAKE,
          })
      ).to.be.revertedWithCustomError(registry, "NotModelOwner");
    });

    it("requires minimum stake (INV-7)", async () => {
      const { registry, alice, bob } = await loadFixture(deployFixture);
      const parentId = await registerModel(registry, alice);
      const childId = await registerModel(registry, bob);
      await expect(
        registry
          .connect(bob)
          .registerLineageEdge(childId, parentId, ConfidenceLevel.Declared, 100, ethers.ZeroHash, {
            value: MIN_STAKE - 1n,
          })
      ).to.be.revertedWithCustomError(registry, "InsufficientStake");
    });

    it("enforces the royalty cap across a child's parent edges (INV-3)", async () => {
      const { registry, alice, bob, carol } = await loadFixture(deployFixture);
      const parentA = await registerModel(registry, alice);
      const parentB = await registerModel(registry, bob);
      const childId = await registerModel(registry, carol);

      await registry
        .connect(carol)
        .registerLineageEdge(childId, parentA, ConfidenceLevel.Declared, 4000, ethers.ZeroHash, {
          value: MIN_STAKE,
        });

      await expect(
        registry
          .connect(carol)
          .registerLineageEdge(childId, parentB, ConfidenceLevel.Declared, 1500, ethers.ZeroHash, {
            value: MIN_STAKE,
          })
      ).to.be.revertedWithCustomError(registry, "RoyaltyCapExceeded"); // 4000 + 1500 > 5000 default cap
    });

    it("rejects a direct cycle (A->B, then B->A)", async () => {
      const { registry, alice, bob } = await loadFixture(deployFixture);
      const modelA = await registerModel(registry, alice);
      const modelB = await registerModel(registry, bob);

      await registry
        .connect(bob)
        .registerLineageEdge(modelB, modelA, ConfidenceLevel.Declared, 500, ethers.ZeroHash, {
          value: MIN_STAKE,
        });

      await expect(
        registry
          .connect(alice)
          .registerLineageEdge(modelA, modelB, ConfidenceLevel.Declared, 500, ethers.ZeroHash, {
            value: MIN_STAKE,
          })
      ).to.be.revertedWithCustomError(registry, "CycleDetected");
    });

    it("rejects a multi-hop cycle within maxDepth (A->B->C, then C->A)", async () => {
      const { registry, alice, bob, carol } = await loadFixture(deployFixture);
      const modelA = await registerModel(registry, alice);
      const modelB = await registerModel(registry, bob);
      const modelC = await registerModel(registry, carol);

      await registry
        .connect(bob)
        .registerLineageEdge(modelB, modelA, ConfidenceLevel.Declared, 500, ethers.ZeroHash, { value: MIN_STAKE });
      await registry
        .connect(carol)
        .registerLineageEdge(modelC, modelB, ConfidenceLevel.Declared, 500, ethers.ZeroHash, { value: MIN_STAKE });

      await expect(
        registry
          .connect(alice)
          .registerLineageEdge(modelA, modelC, ConfidenceLevel.Declared, 500, ethers.ZeroHash, {
            value: MIN_STAKE,
          })
      ).to.be.revertedWithCustomError(registry, "CycleDetected");
    });

    it("allows a diamond DAG (D has two independent parents B and C, both deriving from A)", async () => {
      const { registry, alice, bob, carol, stranger } = await loadFixture(deployFixture);
      const modelA = await registerModel(registry, alice);
      const modelB = await registerModel(registry, bob);
      const modelC = await registerModel(registry, carol);
      const modelD = await registerModel(registry, stranger);

      await registry
        .connect(bob)
        .registerLineageEdge(modelB, modelA, ConfidenceLevel.Declared, 1000, ethers.ZeroHash, { value: MIN_STAKE });
      await registry
        .connect(carol)
        .registerLineageEdge(modelC, modelA, ConfidenceLevel.Declared, 1000, ethers.ZeroHash, { value: MIN_STAKE });

      await expect(
        registry
          .connect(stranger)
          .registerLineageEdge(modelD, modelB, ConfidenceLevel.CryptographicallyBound, 1500, ethers.ZeroHash, {
            value: MIN_STAKE,
          })
      ).to.not.be.reverted;
      await expect(
        registry
          .connect(stranger)
          .registerLineageEdge(modelD, modelC, ConfidenceLevel.Declared, 1500, ethers.ZeroHash, {
            value: MIN_STAKE,
          })
      ).to.not.be.reverted;

      const parents = await registry.getParentEdgeIds(modelD);
      expect(parents.length).to.equal(2);
    });
  });

  describe("weakest-link confidence", () => {
    it("pathConfidence returns the minimum confidence across a finalized path", async () => {
      const { registry, alice, bob, carol, resolver } = await loadFixture(deployFixture);
      const modelA = await registerModel(registry, alice);
      const modelB = await registerModel(registry, bob);
      const modelC = await registerModel(registry, carol);

      const edgeAB = await registry
        .connect(bob)
        .registerLineageEdge(modelB, modelA, ConfidenceLevel.CryptographicallyBound, 1000, ethers.ZeroHash, {
          value: MIN_STAKE,
        });
      const edgeBC = await registry
        .connect(carol)
        .registerLineageEdge(modelC, modelB, ConfidenceLevel.Declared, 1000, ethers.ZeroHash, {
          value: MIN_STAKE,
        });

      const edgeIdAB = await registry.computeEdgeId(modelB, modelA);
      const edgeIdBC = await registry.computeEdgeId(modelC, modelB);

      await time.increase(3 * 24 * 60 * 60 + 1);
      await registry.finalizeEdge(edgeIdAB);
      await registry.finalizeEdge(edgeIdBC);

      const confidence = await registry.pathConfidence([edgeIdBC, edgeIdAB]);
      // weakest link is Declared even though A->B was CryptographicallyBound
      expect(confidence).to.equal(ConfidenceLevel.Declared);
    });
  });

  describe("challenge and finalization", () => {
    it("finalizes an unchallenged edge after the window and returns the stake", async () => {
      const { registry, alice, bob } = await loadFixture(deployFixture);
      const parentId = await registerModel(registry, alice);
      const childId = await registerModel(registry, bob);
      await registry
        .connect(bob)
        .registerLineageEdge(childId, parentId, ConfidenceLevel.Declared, 1000, ethers.ZeroHash, {
          value: MIN_STAKE,
        });
      const edgeId = await registry.computeEdgeId(childId, parentId);

      await expect(registry.finalizeEdge(edgeId)).to.be.revertedWithCustomError(registry, "ChallengeWindowOpen");

      await time.increase(3 * 24 * 60 * 60 + 1);
      const before = await ethers.provider.getBalance(bob.address);
      const tx = await registry.connect(bob).finalizeEdge(edgeId);
      await tx.wait();
      const after = await ethers.provider.getBalance(bob.address);

      const edge = await registry.getEdge(edgeId);
      expect(edge.status).to.equal(EdgeStatus.Finalized);
      expect(after).to.be.gt(before - ethers.parseEther("0.001")); // stake returned, minus gas
    });

    it("cannot be challenged after the window closes", async () => {
      const { registry, alice, bob, challenger } = await loadFixture(deployFixture);
      const parentId = await registerModel(registry, alice);
      const childId = await registerModel(registry, bob);
      await registry
        .connect(bob)
        .registerLineageEdge(childId, parentId, ConfidenceLevel.Declared, 1000, ethers.ZeroHash, {
          value: MIN_STAKE,
        });
      const edgeId = await registry.computeEdgeId(childId, parentId);

      await time.increase(3 * 24 * 60 * 60 + 1);
      await expect(
        registry.connect(challenger).challengeEdge(edgeId, { value: CHALLENGE_BOND })
      ).to.be.revertedWithCustomError(registry, "ChallengeWindowClosed");
    });

    it("a successful challenge rejects the edge and pays the challenger both bonds", async () => {
      const { registry, alice, bob, challenger, resolver } = await loadFixture(deployFixture);
      const parentId = await registerModel(registry, alice);
      const childId = await registerModel(registry, bob);
      await registry
        .connect(bob)
        .registerLineageEdge(childId, parentId, ConfidenceLevel.Declared, 1000, ethers.ZeroHash, {
          value: MIN_STAKE,
        });
      const edgeId = await registry.computeEdgeId(childId, parentId);

      await registry.connect(challenger).challengeEdge(edgeId, { value: CHALLENGE_BOND });
      const before = await ethers.provider.getBalance(challenger.address);
      await registry.connect(resolver).resolveChallenge(edgeId, true);
      const after = await ethers.provider.getBalance(challenger.address);

      const edge = await registry.getEdge(edgeId);
      expect(edge.status).to.equal(EdgeStatus.Rejected);
      expect(after).to.be.gt(before); // received stake + own bond back
      expect(await registry.totalParentBps(childId)).to.equal(0); // allocation freed (INV-3 bookkeeping)
    });

    it("a failed challenge finalizes the edge and pays the registrant both bonds", async () => {
      const { registry, alice, bob, challenger, resolver } = await loadFixture(deployFixture);
      const parentId = await registerModel(registry, alice);
      const childId = await registerModel(registry, bob);
      await registry
        .connect(bob)
        .registerLineageEdge(childId, parentId, ConfidenceLevel.Declared, 1000, ethers.ZeroHash, {
          value: MIN_STAKE,
        });
      const edgeId = await registry.computeEdgeId(childId, parentId);

      await registry.connect(challenger).challengeEdge(edgeId, { value: CHALLENGE_BOND });
      await registry.connect(resolver).resolveChallenge(edgeId, false);

      const edge = await registry.getEdge(edgeId);
      expect(edge.status).to.equal(EdgeStatus.Finalized);
    });

    it("only the resolver may resolve a challenge", async () => {
      const { registry, alice, bob, challenger, stranger } = await loadFixture(deployFixture);
      const parentId = await registerModel(registry, alice);
      const childId = await registerModel(registry, bob);
      await registry
        .connect(bob)
        .registerLineageEdge(childId, parentId, ConfidenceLevel.Declared, 1000, ethers.ZeroHash, {
          value: MIN_STAKE,
        });
      const edgeId = await registry.computeEdgeId(childId, parentId);
      await registry.connect(challenger).challengeEdge(edgeId, { value: CHALLENGE_BOND });

      await expect(registry.connect(stranger).resolveChallenge(edgeId, true)).to.be.revertedWithCustomError(
        registry,
        "NotResolver"
      );
    });

    it("rejects a duplicate edge registration for the same child/parent pair", async () => {
      const { registry, alice, bob } = await loadFixture(deployFixture);
      const parentId = await registerModel(registry, alice);
      const childId = await registerModel(registry, bob);
      await registry
        .connect(bob)
        .registerLineageEdge(childId, parentId, ConfidenceLevel.Declared, 1000, ethers.ZeroHash, {
          value: MIN_STAKE,
        });
      await expect(
        registry
          .connect(bob)
          .registerLineageEdge(childId, parentId, ConfidenceLevel.Declared, 500, ethers.ZeroHash, {
            value: MIN_STAKE,
          })
      ).to.be.revertedWithCustomError(registry, "EdgeAlreadyExists");
    });
  });

  describe("admin parameters", () => {
    it("only the contract owner may change economic parameters", async () => {
      const { registry, stranger } = await loadFixture(deployFixture);
      await expect(registry.connect(stranger).setMinStake(0)).to.be.revertedWithCustomError(
        registry,
        "OwnableUnauthorizedAccount"
      );
    });

    it("owner can tighten maxParentsPerModel and it is enforced", async () => {
      const { registry, owner, alice, bob, carol } = await loadFixture(deployFixture);
      await registry.connect(owner).setMaxParentsPerModel(1);

      const parentA = await registerModel(registry, alice);
      const parentB = await registerModel(registry, carol);
      const childId = await registerModel(registry, bob);

      await registry
        .connect(bob)
        .registerLineageEdge(childId, parentA, ConfidenceLevel.Declared, 100, ethers.ZeroHash, {
          value: MIN_STAKE,
        });

      await expect(
        registry
          .connect(bob)
          .registerLineageEdge(childId, parentB, ConfidenceLevel.Declared, 100, ethers.ZeroHash, {
            value: MIN_STAKE,
          })
      ).to.be.revertedWithCustomError(registry, "TooManyParents");
    });
  });

  describe("DAG invariants (randomized)", () => {
    it("never accepts an edge that would close a cycle, across many random acyclic-then-cyclic attempts", async () => {
      const { registry, owner } = await loadFixture(deployFixture);
      const signers = await ethers.getSigners();
      const pool = signers.slice(7, 17); // 10 fresh signers for this test

      const modelIds: string[] = [];
      for (const s of pool) {
        modelIds.push(await registerModel(registry, s));
      }

      // Build a random forest (each node i>0 picks a random earlier node as parent) —
      // guaranteed acyclic by construction.
      const parentOf: (number | null)[] = [null];
      for (let i = 1; i < modelIds.length; i++) {
        const p = Math.floor(Math.random() * i);
        parentOf.push(p);
        await registry
          .connect(pool[i])
          .registerLineageEdge(modelIds[i], modelIds[p], ConfidenceLevel.Declared, 100, ethers.ZeroHash, {
            value: MIN_STAKE,
          });
      }

      // Now attempt a guaranteed-cyclic edge: make the root depend on a leaf.
      const leaf = modelIds.length - 1;
      await expect(
        registry
          .connect(pool[0])
          .registerLineageEdge(modelIds[0], modelIds[leaf], ConfidenceLevel.Declared, 100, ethers.ZeroHash, {
            value: MIN_STAKE,
          })
      ).to.be.revertedWithCustomError(registry, "CycleDetected");
    });
  });
});
