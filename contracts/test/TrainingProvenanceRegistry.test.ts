import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyContract = any;

const CLAIM_TYPES = {
  TrainingProvenanceClaim: [
    { name: "childModelId", type: "bytes32" },
    { name: "baseModelId", type: "bytes32" },
    { name: "baseModelHash", type: "bytes32" },
    { name: "datasetRootHash", type: "bytes32" },
    { name: "scriptHash", type: "bytes32" },
    { name: "resultRootHash", type: "bytes32" },
    { name: "taskId", type: "bytes32" },
    { name: "evidenceURI", type: "string" },
    { name: "issuedAt", type: "uint64" },
  ],
};

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
  return { name: "Cascade", version: "1", chainId: network.chainId, verifyingContract: registryAddress };
}

async function signClaim(signer: any, domain: any, claim: Record<string, unknown>) {
  return signer.signTypedData(domain, CLAIM_TYPES, claim);
}

async function registerModel(cascadeRegistry: AnyContract, ownerSigner: any, commitment = randomHash()) {
  const salt = ethers.randomBytes(32);
  const tx = await cascadeRegistry.connect(ownerSigner).registerModel(commitment, "0g-storage://manifest", salt);
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
  return { modelId: event!.args.modelId as string, commitment };
}

async function deployFixture() {
  const signers = await ethers.getSigners();
  const [owner, resolver] = signers;

  const CascadeFactory = await ethers.getContractFactory("CascadeRegistry");
  const cascadeRegistry: AnyContract = await CascadeFactory.deploy(resolver.address);
  await cascadeRegistry.waitForDeployment();

  const ExecFactory = await ethers.getContractFactory("ExecutionRegistry");
  const execRegistry: AnyContract = await ExecFactory.deploy(await cascadeRegistry.getAddress());
  await execRegistry.waitForDeployment();

  const ProvenanceFactory = await ethers.getContractFactory("TrainingProvenanceRegistry");
  const provenanceRegistry: AnyContract = await ProvenanceFactory.deploy(
    await cascadeRegistry.getAddress(),
    await execRegistry.getAddress()
  );
  await provenanceRegistry.waitForDeployment();

  const rest = signers.slice(2);
  const providerSigner = rest[0];
  const baseOwner = rest[1];
  const childOwner = rest[2];
  const stranger = rest[3];

  await execRegistry.connect(providerSigner).registerSigner(providerSigner.address);
  const base = await registerModel(cascadeRegistry, baseOwner);
  const child = await registerModel(cascadeRegistry, childOwner);

  return {
    cascadeRegistry,
    execRegistry,
    provenanceRegistry,
    owner,
    resolver,
    providerSigner,
    baseOwner,
    childOwner,
    stranger,
    base,
    child,
    signers: rest,
  };
}

async function baseClaim(base: { modelId: string; commitment: string }, child: { modelId: string; commitment: string }) {
  return {
    childModelId: child.modelId,
    baseModelId: base.modelId,
    baseModelHash: base.commitment,
    datasetRootHash: randomHash(),
    scriptHash: randomHash(),
    resultRootHash: child.commitment,
    taskId: randomHash(),
    evidenceURI: "0g-storage://task-manifest",
    issuedAt: BigInt(await time.latest()),
  };
}

describe("TrainingProvenanceRegistry", () => {
  describe("valid registration", () => {
    it("registers a provenance record signed by a registered provider, submitted by the child model's owner", async () => {
      const { provenanceRegistry, providerSigner, childOwner, base, child } = await loadFixture(deployFixture);
      const claim = await baseClaim(base, child);
      const domain = await domainFor(await provenanceRegistry.getAddress());
      const signature = await signClaim(providerSigner, domain, claim);

      await expect(provenanceRegistry.connect(childOwner).registerProvenance(claim, signature))
        .to.emit(provenanceRegistry, "ProvenanceRegistered")
        .withArgs(
          child.modelId,
          base.modelId,
          providerSigner.address,
          childOwner.address,
          await provenanceRegistry.hashClaim(claim),
          claim.taskId
        );

      const record = await provenanceRegistry.getProvenance(child.modelId);
      expect(record.provider).to.equal(providerSigner.address);
      expect(record.registrant).to.equal(childOwner.address);
      expect(record.baseModelId).to.equal(base.modelId);
    });

    it("evidenceHashOf matches CascadeRegistry's evidenceHash expectations and matchesEdge confirms the pairing", async () => {
      const { provenanceRegistry, providerSigner, childOwner, base, child } = await loadFixture(deployFixture);
      const claim = await baseClaim(base, child);
      const domain = await domainFor(await provenanceRegistry.getAddress());
      const signature = await signClaim(providerSigner, domain, claim);
      await provenanceRegistry.connect(childOwner).registerProvenance(claim, signature);

      const evidenceHash = await provenanceRegistry.evidenceHashOf(child.modelId);
      expect(evidenceHash).to.equal(await provenanceRegistry.hashClaim(claim));
      expect(await provenanceRegistry.matchesEdge(child.modelId, base.modelId, evidenceHash)).to.equal(true);
      expect(await provenanceRegistry.matchesEdge(child.modelId, base.modelId, randomHash())).to.equal(false);
      expect(await provenanceRegistry.matchesEdge(child.modelId, randomHash(), evidenceHash)).to.equal(false);
    });
  });

  describe("forged provenance", () => {
    it("rejects a garbage signature", async () => {
      const { provenanceRegistry, childOwner, base, child } = await loadFixture(deployFixture);
      const claim = await baseClaim(base, child);
      await expect(
        provenanceRegistry.connect(childOwner).registerProvenance(claim, "0x" + "ab".repeat(65))
      ).to.be.reverted;
    });

    it("rejects a validly-formed signature from an address that isn't a registered provider signer", async () => {
      const { provenanceRegistry, childOwner, stranger, base, child } = await loadFixture(deployFixture);
      const claim = await baseClaim(base, child);
      const domain = await domainFor(await provenanceRegistry.getAddress());
      const signature = await signClaim(stranger, domain, claim);
      await expect(
        provenanceRegistry.connect(childOwner).registerProvenance(claim, signature)
      ).to.be.revertedWithCustomError(provenanceRegistry, "UnregisteredProvider");
    });
  });

  describe("commitment cross-checks", () => {
    it("rejects a claim whose resultRootHash does not match the registered child model's commitment", async () => {
      const { provenanceRegistry, providerSigner, childOwner, base, child } = await loadFixture(deployFixture);
      const claim = { ...(await baseClaim(base, child)), resultRootHash: randomHash() };
      const domain = await domainFor(await provenanceRegistry.getAddress());
      const signature = await signClaim(providerSigner, domain, claim);
      await expect(
        provenanceRegistry.connect(childOwner).registerProvenance(claim, signature)
      ).to.be.revertedWithCustomError(provenanceRegistry, "ResultCommitmentMismatch");
    });

    it("rejects a claim whose baseModelHash does not match the registered base model's commitment", async () => {
      const { provenanceRegistry, providerSigner, childOwner, base, child } = await loadFixture(deployFixture);
      const claim = { ...(await baseClaim(base, child)), baseModelHash: randomHash() };
      const domain = await domainFor(await provenanceRegistry.getAddress());
      const signature = await signClaim(providerSigner, domain, claim);
      await expect(
        provenanceRegistry.connect(childOwner).registerProvenance(claim, signature)
      ).to.be.revertedWithCustomError(provenanceRegistry, "BaseModelCommitmentMismatch");
    });
  });

  describe("tamper resistance (dataset / training configuration / any signed field)", () => {
    it("rejects a claim tampered after signing (datasetRootHash) — the 'mismatched dataset' case", async () => {
      const { provenanceRegistry, providerSigner, childOwner, base, child } = await loadFixture(deployFixture);
      const claim = await baseClaim(base, child);
      const domain = await domainFor(await provenanceRegistry.getAddress());
      const signature = await signClaim(providerSigner, domain, claim);

      const tampered = { ...claim, datasetRootHash: randomHash() };
      await expect(provenanceRegistry.connect(childOwner).registerProvenance(tampered, signature)).to.be
        .reverted;
    });

    it("rejects a claim tampered after signing (scriptHash) — the 'mismatched training configuration' case", async () => {
      const { provenanceRegistry, providerSigner, childOwner, base, child } = await loadFixture(deployFixture);
      const claim = await baseClaim(base, child);
      const domain = await domainFor(await provenanceRegistry.getAddress());
      const signature = await signClaim(providerSigner, domain, claim);

      const tampered = { ...claim, scriptHash: randomHash() };
      await expect(provenanceRegistry.connect(childOwner).registerProvenance(tampered, signature)).to.be
        .reverted;
    });

    it("rejects a claim tampered after signing (evidenceURI, a dynamic field)", async () => {
      const { provenanceRegistry, providerSigner, childOwner, base, child } = await loadFixture(deployFixture);
      const claim = await baseClaim(base, child);
      const domain = await domainFor(await provenanceRegistry.getAddress());
      const signature = await signClaim(providerSigner, domain, claim);

      const tampered = { ...claim, evidenceURI: "0g-storage://a-different-manifest" };
      await expect(provenanceRegistry.connect(childOwner).registerProvenance(tampered, signature)).to.be
        .reverted;
    });
  });

  describe("provider attribution", () => {
    it("correctly attributes the registered provider even when multiple providers are registered", async () => {
      const { provenanceRegistry, execRegistry, childOwner, base, child, signers } = await loadFixture(deployFixture);
      const secondProvider = signers[4];
      await execRegistry.connect(secondProvider).registerSigner(secondProvider.address);

      const claim = await baseClaim(base, child);
      const domain = await domainFor(await provenanceRegistry.getAddress());
      const signature = await signClaim(secondProvider, domain, claim);
      await provenanceRegistry.connect(childOwner).registerProvenance(claim, signature);

      const record = await provenanceRegistry.getProvenance(child.modelId);
      expect(record.provider).to.equal(secondProvider.address);
    });
  });

  describe("unauthorized registration", () => {
    it("rejects registration submitted by anyone other than the child model's owner", async () => {
      const { provenanceRegistry, providerSigner, stranger, base, child } = await loadFixture(deployFixture);
      const claim = await baseClaim(base, child);
      const domain = await domainFor(await provenanceRegistry.getAddress());
      const signature = await signClaim(providerSigner, domain, claim);
      await expect(
        provenanceRegistry.connect(stranger).registerProvenance(claim, signature)
      ).to.be.revertedWithCustomError(provenanceRegistry, "NotModelOwner");
    });
  });

  describe("replay and immutability", () => {
    it("rejects a second registration for the same childModelId (replay)", async () => {
      const { provenanceRegistry, providerSigner, childOwner, base, child } = await loadFixture(deployFixture);
      const claim = await baseClaim(base, child);
      const domain = await domainFor(await provenanceRegistry.getAddress());
      const signature = await signClaim(providerSigner, domain, claim);
      await provenanceRegistry.connect(childOwner).registerProvenance(claim, signature);

      await expect(
        provenanceRegistry.connect(childOwner).registerProvenance(claim, signature)
      ).to.be.revertedWithCustomError(provenanceRegistry, "ProvenanceAlreadyRegistered");
    });

    it("rejects an attempted 'correction' — no update path exists, immutability is absolute", async () => {
      const { provenanceRegistry, providerSigner, childOwner, base, child } = await loadFixture(deployFixture);
      const claim = await baseClaim(base, child);
      const domain = await domainFor(await provenanceRegistry.getAddress());
      const signature = await signClaim(providerSigner, domain, claim);
      await provenanceRegistry.connect(childOwner).registerProvenance(claim, signature);

      // A different, freshly and honestly signed claim for the same
      // child, e.g. "fixing" the dataset hash — still rejected, because
      // registration is a one-shot operation per childModelId by design.
      const correctedClaim = { ...claim, datasetRootHash: randomHash() };
      const correctedSignature = await signClaim(providerSigner, domain, correctedClaim);
      await expect(
        provenanceRegistry.connect(childOwner).registerProvenance(correctedClaim, correctedSignature)
      ).to.be.revertedWithCustomError(provenanceRegistry, "ProvenanceAlreadyRegistered");

      const record = await provenanceRegistry.getProvenance(child.modelId);
      expect(record.datasetRootHash).to.equal(claim.datasetRootHash); // original value, untouched
    });
  });

  describe("cross-chain and cross-contract replay", () => {
    it("rejects a claim signed under the wrong chainId", async () => {
      const { provenanceRegistry, providerSigner, childOwner, base, child } = await loadFixture(deployFixture);
      const claim = await baseClaim(base, child);
      const wrongDomain = {
        name: "Cascade",
        version: "1",
        chainId: 999999n,
        verifyingContract: await provenanceRegistry.getAddress(),
      };
      const signature = await signClaim(providerSigner, wrongDomain, claim);
      await expect(
        provenanceRegistry.connect(childOwner).registerProvenance(claim, signature)
      ).to.be.revertedWithCustomError(provenanceRegistry, "UnregisteredProvider");
    });

    it("rejects a claim signed for a different TrainingProvenanceRegistry deployment", async () => {
      const { provenanceRegistry, cascadeRegistry, execRegistry, providerSigner, childOwner, base, child } =
        await loadFixture(deployFixture);
      const ProvenanceFactory = await ethers.getContractFactory("TrainingProvenanceRegistry");
      const otherRegistry = await ProvenanceFactory.deploy(
        await cascadeRegistry.getAddress(),
        await execRegistry.getAddress()
      );
      await otherRegistry.waitForDeployment();

      const claim = await baseClaim(base, child);
      const wrongDomain = await domainFor(await otherRegistry.getAddress());
      const signature = await signClaim(providerSigner, wrongDomain, claim);

      await expect(
        provenanceRegistry.connect(childOwner).registerProvenance(claim, signature)
      ).to.be.revertedWithCustomError(provenanceRegistry, "UnregisteredProvider");
    });
  });

  describe("confidence-axis separation (ADR 0006) — Level 2 evidence cannot become Level 1", () => {
    it("labeling a Level-2-evidenced edge as CryptographicallyBound in CascadeRegistry has no effect on settlement — serving confidence still caps it at Declared", async () => {
      const { cascadeRegistry, execRegistry, provenanceRegistry, providerSigner, childOwner, base, child } =
        await loadFixture(deployFixture);
      const claim = await baseClaim(base, child);
      const domain = await domainFor(await provenanceRegistry.getAddress());
      const signature = await signClaim(providerSigner, domain, claim);
      await provenanceRegistry.connect(childOwner).registerProvenance(claim, signature);
      const evidenceHash = await provenanceRegistry.evidenceHashOf(child.modelId);

      // Mislabel it as Level 1 in CascadeRegistry — nothing stops the
      // caller from doing this; CascadeRegistry doesn't know about
      // TrainingProvenanceRegistry at all (ADR 0010).
      await cascadeRegistry
        .connect(childOwner)
        .registerLineageEdge(child.modelId, base.modelId, ConfidenceLevel.CryptographicallyBound, 1000, evidenceHash, {
          value: ethers.parseEther("0.01"),
        });
      const edgeId = await cascadeRegistry.computeEdgeId(child.modelId, base.modelId);
      await time.increase(3 * 24 * 60 * 60 + 1);
      await cascadeRegistry.finalizeEdge(edgeId);

      const SettlementFactory = await ethers.getContractFactory("AttributionSettlement");
      const settlement = await SettlementFactory.deploy(
        await cascadeRegistry.getAddress(),
        await execRegistry.getAddress()
      );
      await settlement.waitForDeployment();
      await settlement.setAttributionFeePerExecution(10_000);

      const now = BigInt(await time.latest());
      const usageDomain = { name: "Cascade", version: "1", chainId: (await ethers.provider.getNetwork()).chainId, verifyingContract: await execRegistry.getAddress() };
      const usageProof = {
        modelId: child.modelId,
        modelCommitment: child.commitment,
        requestHash: randomHash(),
        responseHash: randomHash(),
        chatId: randomHash(),
        epoch: 1n,
        issuedAt: now,
      };
      const usageTypes = {
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
      const usageSignature = await providerSigner.signTypedData(usageDomain, usageTypes, usageProof);

      const tx = await settlement.settleExecution(usageProof, usageSignature, { value: 10_000n });
      const receipt = await tx.wait();
      const attributed = receipt!.logs
        .map((l: any) => {
          try {
            return settlement.interface.parseLog(l);
          } catch {
            return null;
          }
        })
        .find((e: any) => e?.name === "EdgeAttributed");

      // servingConfidence is Declared (no wrapper/CascadeWrapper mode set
      // anywhere in this test) regardless of what the lineage edge claims
      // — effectiveConfidence = min(CryptographicallyBound, Declared) = Declared.
      expect(Number(attributed!.args.effectiveConfidence)).to.equal(ConfidenceLevel.Declared);
    });
  });

  describe("AttestedTraining remains invalid as a serving confidence", () => {
    it("ExecutionRegistry never reports AttestedTraining regardless of TrainingProvenanceRegistry activity", async () => {
      const { execRegistry, providerSigner, child } = await loadFixture(deployFixture);
      const domain = { name: "Cascade", version: "1", chainId: (await ethers.provider.getNetwork()).chainId, verifyingContract: await execRegistry.getAddress() };
      const usageTypes = {
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
      const usageProof = {
        modelId: child.modelId,
        modelCommitment: child.commitment,
        requestHash: randomHash(),
        responseHash: randomHash(),
        chatId: randomHash(),
        epoch: 1n,
        issuedAt: BigInt(await time.latest()),
      };
      const usageSignature = await providerSigner.signTypedData(domain, usageTypes, usageProof);
      const usage = await execRegistry.verifyUsageProof(usageProof, usageSignature);
      expect(Number(usage.servingConfidence)).to.not.equal(ConfidenceLevel.AttestedTraining);
    });
  });
});
