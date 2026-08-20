import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

// See contracts/test/CascadeRegistry.test.ts — typechain isn't wired up
// reliably in this environment (docs/adr/0002); `any` stands in for
// generated contract types throughout this file.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyContract = any;

const USAGE_PROOF_TYPES = {
  UsageProof: [
    { name: "modelId", type: "bytes32" },
    { name: "modelCommitment", type: "bytes32" },
    { name: "requestHash", type: "bytes32" },
    { name: "responseHash", type: "bytes32" },
    { name: "chatId", type: "bytes32" },
    { name: "epoch", type: "uint64" },
    { name: "issuedAt", type: "uint64" },
  ],
};

enum ProviderMode {
  Standard = 0,
  CascadeWrapper = 1,
}

enum ConfidenceLevel {
  Declared = 0,
  AttestedTraining = 1,
  CryptographicallyBound = 2,
}

function randomHash(): string {
  return ethers.keccak256(ethers.randomBytes(32));
}

async function domainFor(registryAddress: string) {
  const network = await ethers.provider.getNetwork();
  return {
    name: "Cascade",
    version: "1",
    chainId: network.chainId,
    verifyingContract: registryAddress,
  };
}

async function signProof(
  signer: any,
  domain: { name: string; version: string; chainId: bigint; verifyingContract: string },
  proof: Record<string, unknown>
) {
  return signer.signTypedData(domain, USAGE_PROOF_TYPES, proof);
}

async function deployFixture() {
  const [owner, resolver, modelOwner, providerA, providerB, signerA, signerB, relayer, stranger] =
    await ethers.getSigners();

  const CascadeFactory = await ethers.getContractFactory("CascadeRegistry");
  const cascadeRegistry: AnyContract = await CascadeFactory.deploy(resolver.address);
  await cascadeRegistry.waitForDeployment();

  const ExecFactory = await ethers.getContractFactory("ExecutionRegistry");
  const execRegistry: AnyContract = await ExecFactory.deploy(await cascadeRegistry.getAddress());
  await execRegistry.waitForDeployment();

  const modelCommitment = randomHash();
  const salt = ethers.randomBytes(32);
  const tx = await cascadeRegistry.connect(modelOwner).registerModel(modelCommitment, "0g-storage://manifest", salt);
  const receipt = await tx.wait();
  const event = receipt!.logs
    .map((l: any) => {
      try {
        return cascadeRegistry.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((e: any) => e?.name === "ModelRegistered");
  const modelId = event!.args.modelId as string;

  await execRegistry.connect(providerA).registerSigner(signerA.address);

  return {
    cascadeRegistry,
    execRegistry,
    owner,
    resolver,
    modelOwner,
    providerA,
    providerB,
    signerA,
    signerB,
    relayer,
    stranger,
    modelId,
    modelCommitment,
  };
}

async function baseProof(modelId: string, modelCommitment: string, overrides: Partial<Record<string, unknown>> = {}) {
  // issuedAt must be sourced from the chain's own clock, not wall-clock
  // Date.now() — Hardhat's local network timestamp is not kept in sync
  // with real time, so a wall-clock value can end up ahead of
  // block.timestamp and trip ProofNotYetValid spuriously.
  const now = await time.latest();
  return {
    modelId,
    modelCommitment,
    requestHash: randomHash(),
    responseHash: randomHash(),
    chatId: randomHash(),
    epoch: 1n,
    issuedAt: BigInt(now),
    ...overrides,
  };
}

describe("ExecutionRegistry", () => {
  describe("signer registration", () => {
    it("registers a signer to the calling provider", async () => {
      const { execRegistry, providerA, signerA } = await loadFixture(deployFixture);
      expect(await execRegistry.providerOfSigner(signerA.address)).to.equal(providerA.address);
    });

    it("rejects re-registering an already-registered signer", async () => {
      const { execRegistry, providerB, signerA } = await loadFixture(deployFixture);
      await expect(execRegistry.connect(providerB).registerSigner(signerA.address)).to.be.revertedWithCustomError(
        execRegistry,
        "SignerAlreadyRegistered"
      );
    });

    it("only the registering provider may revoke its signer", async () => {
      const { execRegistry, providerA, providerB, signerA } = await loadFixture(deployFixture);
      await expect(execRegistry.connect(providerB).revokeSigner(signerA.address)).to.be.revertedWithCustomError(
        execRegistry,
        "NotSignerOwner"
      );
      await execRegistry.connect(providerA).revokeSigner(signerA.address);
      expect(await execRegistry.providerOfSigner(signerA.address)).to.equal(ethers.ZeroAddress);
    });
  });

  describe("valid proofs", () => {
    it("verifies a well-formed proof and derives provider/modelId/executionId", async () => {
      const { execRegistry, signerA, providerA, modelId, modelCommitment } = await loadFixture(deployFixture);
      const domain = await domainFor(await execRegistry.getAddress());
      const proof = await baseProof(modelId, modelCommitment);
      const signature = await signProof(signerA, domain, proof);

      const usage = await execRegistry.verifyUsageProof(proof, signature);
      expect(usage.signer).to.equal(signerA.address);
      expect(usage.provider).to.equal(providerA.address);
      expect(usage.modelId).to.equal(modelId);
      expect(usage.servingConfidence).to.equal(ConfidenceLevel.Declared);

      const expectedExecutionId = await execRegistry.hashExecutionId(
        providerA.address,
        modelId,
        proof.requestHash,
        proof.responseHash
      );
      expect(usage.executionId).to.equal(expectedExecutionId);
    });

    it("reports CryptographicallyBound only for CascadeWrapper-mode providers with a matching commitment", async () => {
      const { execRegistry, owner, signerA, providerA, modelId, modelCommitment } = await loadFixture(deployFixture);
      await execRegistry.connect(owner).setProviderMode(providerA.address, ProviderMode.CascadeWrapper);

      const domain = await domainFor(await execRegistry.getAddress());
      const proof = await baseProof(modelId, modelCommitment);
      const signature = await signProof(signerA, domain, proof);

      const usage = await execRegistry.verifyUsageProof(proof, signature);
      expect(usage.servingConfidence).to.equal(ConfidenceLevel.CryptographicallyBound);
    });

    it("never reports AttestedTraining as a serving confidence (ADR 0006)", async () => {
      const { execRegistry, owner, signerA, providerA, modelId, modelCommitment } = await loadFixture(deployFixture);
      // Exhaust both provider modes; neither should ever yield AttestedTraining.
      for (const mode of [ProviderMode.Standard, ProviderMode.CascadeWrapper]) {
        await execRegistry.connect(owner).setProviderMode(providerA.address, mode);
        const domain = await domainFor(await execRegistry.getAddress());
        const proof = await baseProof(modelId, modelCommitment);
        const signature = await signProof(signerA, domain, proof);
        const usage = await execRegistry.verifyUsageProof(proof, signature);
        expect(usage.servingConfidence).to.not.equal(ConfidenceLevel.AttestedTraining);
      }
    });

    it("a relayer distinct from the signer can submit; submitter identity never affects the derived provider", async () => {
      const { execRegistry, signerA, providerA, relayer, modelId, modelCommitment } = await loadFixture(
        deployFixture
      );
      const domain = await domainFor(await execRegistry.getAddress());
      const proof = await baseProof(modelId, modelCommitment);
      const signature = await signProof(signerA, domain, proof);

      const tx = await execRegistry.connect(relayer).consumeUsageProof(proof, signature);
      const receipt = await tx.wait();
      const event = receipt!.logs
        .map((l: any) => {
          try {
            return execRegistry.interface.parseLog(l);
          } catch {
            return null;
          }
        })
        .find((e: any) => e?.name === "UsageProofConsumed");
      expect(event!.args.provider).to.equal(providerA.address); // never relayer.address
    });
  });

  describe("model commitment cross-check", () => {
    it("reverts when the signed proof's commitment does not match the registered model", async () => {
      const { execRegistry, signerA, modelId } = await loadFixture(deployFixture);
      const domain = await domainFor(await execRegistry.getAddress());
      const wrongCommitment = randomHash();
      const proof = await baseProof(modelId, wrongCommitment); // signed honestly, but claims the wrong artifact
      const signature = await signProof(signerA, domain, proof);

      await expect(execRegistry.verifyUsageProof(proof, signature)).to.be.revertedWithCustomError(
        execRegistry,
        "ModelCommitmentMismatch"
      );
    });
  });

  describe("tamper resistance (each field is signature-bound)", () => {
    // Mutators for fields with no other semantic constraint — any change
    // invalidates the signature, so the contract's signature-verification
    // path is what should reject these.
    const fields: Array<[string, () => unknown]> = [
      ["modelId", () => randomHash()],
      ["requestHash", () => randomHash()],
      ["responseHash", () => randomHash()],
      ["chatId", () => randomHash()],
      ["epoch", () => 99n],
    ];

    for (const [field, mutate] of fields) {
      it(`rejects a proof with a modified ${field} after signing`, async () => {
        const { execRegistry, signerA, modelId, modelCommitment } = await loadFixture(deployFixture);
        const domain = await domainFor(await execRegistry.getAddress());
        const proof = await baseProof(modelId, modelCommitment);
        const signature = await signProof(signerA, domain, proof);

        const tampered = { ...proof, [field]: mutate() };
        await expect(execRegistry.verifyUsageProof(tampered, signature)).to.be.revertedWithCustomError(
          execRegistry,
          "UnregisteredSigner"
        );
      });
    }

    it("rejects a proof with a modified issuedAt after signing", async () => {
      // issuedAt has its own semantic freshness check ahead of signature
      // recovery (see ExecutionRegistry._verify), so this needs a mutated
      // value that stays inside the valid window to actually exercise the
      // signature-binding path rather than the freshness check — a
      // shifted-into-the-future value would (correctly) fail with
      // ProofExpired/ProofNotYetValid first, which is a different, already
      // separately-tested property.
      const { execRegistry, signerA, modelId, modelCommitment } = await loadFixture(deployFixture);
      const domain = await domainFor(await execRegistry.getAddress());
      const proof = await baseProof(modelId, modelCommitment);
      const signature = await signProof(signerA, domain, proof);

      const tampered = { ...proof, issuedAt: proof.issuedAt - 5n };
      await expect(execRegistry.verifyUsageProof(tampered, signature)).to.be.revertedWithCustomError(
        execRegistry,
        "UnregisteredSigner"
      );
    });

    it("rejects a proof with a modified modelCommitment after signing", async () => {
      // modelCommitment is signature-bound like every other field, but a
      // mismatch here could in principle recover to a technically-valid
      // signer if a collision existed — assert it still fails one way or
      // the other (either UnregisteredSigner from a broken signature, or
      // ModelCommitmentMismatch if it somehow still recovered correctly).
      const { execRegistry, signerA, modelId, modelCommitment } = await loadFixture(deployFixture);
      const domain = await domainFor(await execRegistry.getAddress());
      const proof = await baseProof(modelId, modelCommitment);
      const signature = await signProof(signerA, domain, proof);
      const tampered = { ...proof, modelCommitment: randomHash() };
      await expect(execRegistry.verifyUsageProof(tampered, signature)).to.be.reverted;
    });
  });

  describe("provider substitution", () => {
    it("cannot be forced to resolve to a different provider — there is no provider field to tamper with", async () => {
      const { execRegistry, providerA, providerB, signerA, signerB, modelId, modelCommitment } = await loadFixture(
        deployFixture
      );
      await execRegistry.connect(providerB).registerSigner(signerB.address);

      const domain = await domainFor(await execRegistry.getAddress());
      const proofA = await baseProof(modelId, modelCommitment);
      const sigA = await signProof(signerA, domain, proofA);
      const usageA = await execRegistry.verifyUsageProof(proofA, sigA);
      expect(usageA.provider).to.equal(providerA.address);
      expect(usageA.provider).to.not.equal(providerB.address);

      const proofB = await baseProof(modelId, modelCommitment);
      const sigB = await signProof(signerB, domain, proofB);
      const usageB = await execRegistry.verifyUsageProof(proofB, sigB);
      expect(usageB.provider).to.equal(providerB.address);
    });
  });

  describe("signature validity", () => {
    it("rejects a malformed signature", async () => {
      const { execRegistry, modelId, modelCommitment } = await loadFixture(deployFixture);
      const proof = await baseProof(modelId, modelCommitment);
      await expect(execRegistry.verifyUsageProof(proof, "0x1234")).to.be.reverted;
    });

    it("rejects a well-formed signature from an unregistered signer", async () => {
      const { execRegistry, stranger, modelId, modelCommitment } = await loadFixture(deployFixture);
      const domain = await domainFor(await execRegistry.getAddress());
      const proof = await baseProof(modelId, modelCommitment);
      const signature = await signProof(stranger, domain, proof);
      await expect(execRegistry.verifyUsageProof(proof, signature)).to.be.revertedWithCustomError(
        execRegistry,
        "UnregisteredSigner"
      );
    });
  });

  describe("replay protection", () => {
    it("consumeUsageProof rejects a resubmission of the same proof", async () => {
      const { execRegistry, signerA, modelId, modelCommitment } = await loadFixture(deployFixture);
      const domain = await domainFor(await execRegistry.getAddress());
      const proof = await baseProof(modelId, modelCommitment);
      const signature = await signProof(signerA, domain, proof);

      await execRegistry.consumeUsageProof(proof, signature);
      await expect(execRegistry.consumeUsageProof(proof, signature)).to.be.revertedWithCustomError(
        execRegistry,
        "ExecutionAlreadyConsumed"
      );
    });

    it("verifyUsageProof does not consume — the same proof can be checked repeatedly", async () => {
      const { execRegistry, signerA, modelId, modelCommitment } = await loadFixture(deployFixture);
      const domain = await domainFor(await execRegistry.getAddress());
      const proof = await baseProof(modelId, modelCommitment);
      const signature = await signProof(signerA, domain, proof);

      await execRegistry.verifyUsageProof(proof, signature);
      await expect(execRegistry.verifyUsageProof(proof, signature)).to.not.be.reverted;
    });

    it("a re-signed proof with only epoch changed produces a different signature but the same executionId, and still only settles once", async () => {
      // executionId is derived from (provider, modelId, requestHash, responseHash) —
      // deliberately epoch-independent, so two proofs describing the same
      // underlying execution can't be double-consumed just by relabeling
      // the epoch.
      const { execRegistry, signerA, modelId, modelCommitment } = await loadFixture(deployFixture);
      const domain = await domainFor(await execRegistry.getAddress());
      const shared = { requestHash: randomHash(), responseHash: randomHash() };
      const proof1 = await baseProof(modelId, modelCommitment, { ...shared, epoch: 1n });
      const proof2 = await baseProof(modelId, modelCommitment, { ...shared, epoch: 2n });
      const sig1 = await signProof(signerA, domain, proof1);
      const sig2 = await signProof(signerA, domain, proof2);

      await execRegistry.consumeUsageProof(proof1, sig1);
      await expect(execRegistry.consumeUsageProof(proof2, sig2)).to.be.revertedWithCustomError(
        execRegistry,
        "ExecutionAlreadyConsumed"
      );
    });

    it("rejects an expired proof", async () => {
      const { execRegistry, owner, signerA, modelId, modelCommitment } = await loadFixture(deployFixture);
      await execRegistry.connect(owner).setProofValidityWindow(60); // 60 seconds
      const domain = await domainFor(await execRegistry.getAddress());
      const proof = await baseProof(modelId, modelCommitment);
      const signature = await signProof(signerA, domain, proof);

      await time.increase(120);
      await expect(execRegistry.verifyUsageProof(proof, signature)).to.be.revertedWithCustomError(
        execRegistry,
        "ProofExpired"
      );
    });
  });

  describe("cross-chain and cross-contract replay", () => {
    it("rejects a proof signed under the wrong chainId", async () => {
      const { execRegistry, signerA, modelId, modelCommitment } = await loadFixture(deployFixture);
      const wrongDomain = {
        name: "Cascade",
        version: "1",
        chainId: 999999n,
        verifyingContract: await execRegistry.getAddress(),
      };
      const proof = await baseProof(modelId, modelCommitment);
      const signature = await signProof(signerA, wrongDomain, proof);
      await expect(execRegistry.verifyUsageProof(proof, signature)).to.be.revertedWithCustomError(
        execRegistry,
        "UnregisteredSigner"
      );
    });

    it("rejects a proof signed for a different ExecutionRegistry deployment", async () => {
      const { execRegistry, cascadeRegistry, signerA, providerA, modelId, modelCommitment } = await loadFixture(
        deployFixture
      );

      const ExecFactory = await ethers.getContractFactory("ExecutionRegistry");
      const secondRegistry: AnyContract = await ExecFactory.deploy(await cascadeRegistry.getAddress());
      await secondRegistry.waitForDeployment();
      await secondRegistry.connect(providerA).registerSigner(signerA.address); // registered on both, isolates domain as the cause

      const domainForFirst = await domainFor(await execRegistry.getAddress());
      const proof = await baseProof(modelId, modelCommitment);
      const signature = await signProof(signerA, domainForFirst, proof);

      await expect(execRegistry.verifyUsageProof(proof, signature)).to.not.be.reverted;
      await expect(secondRegistry.verifyUsageProof(proof, signature)).to.be.revertedWithCustomError(
        secondRegistry,
        "UnregisteredSigner"
      );
    });
  });

  describe("TypeScript / Solidity encoding cross-check", () => {
    it("ethers' EIP-712 digest matches the contract's own hashTypedDataDigest", async () => {
      const { execRegistry, modelId, modelCommitment } = await loadFixture(deployFixture);
      const domain = await domainFor(await execRegistry.getAddress());
      const proof = await baseProof(modelId, modelCommitment);

      const tsDigest = ethers.TypedDataEncoder.hash(domain, USAGE_PROOF_TYPES, proof);
      const solidityDigest = await execRegistry.hashTypedDataDigest(proof);
      expect(tsDigest).to.equal(solidityDigest);
    });
  });
});
