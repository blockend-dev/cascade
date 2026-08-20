import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

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

enum ConfidenceLevel {
  Declared = 0,
  AttestedTraining = 1,
  CryptographicallyBound = 2,
}

enum ProviderMode {
  Standard = 0,
  CascadeWrapper = 1,
}

const CHALLENGE_WINDOW_SECONDS = 3 * 24 * 60 * 60;
const MIN_STAKE = ethers.parseEther("0.01");
const BPS_DENOMINATOR = 10_000n;

function randomHash(): string {
  return ethers.keccak256(ethers.randomBytes(32));
}

async function domainFor(registryAddress: string) {
  const network = await ethers.provider.getNetwork();
  return { name: "Cascade", version: "1", chainId: network.chainId, verifyingContract: registryAddress };
}

async function signProof(signer: any, domain: any, proof: Record<string, unknown>) {
  return signer.signTypedData(domain, USAGE_PROOF_TYPES, proof);
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

  const SettlementFactory = await ethers.getContractFactory("AttributionSettlement");
  const settlement: AnyContract = await SettlementFactory.deploy(
    await cascadeRegistry.getAddress(),
    await execRegistry.getAddress()
  );
  await settlement.waitForDeployment();

  return { cascadeRegistry, execRegistry, settlement, owner, resolver, signers: signers.slice(2) };
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

async function registerEdge(
  cascadeRegistry: AnyContract,
  childSigner: any,
  childId: string,
  parentId: string,
  confidence: ConfidenceLevel,
  royaltyBps: number,
  stake = MIN_STAKE
) {
  await cascadeRegistry
    .connect(childSigner)
    .registerLineageEdge(childId, parentId, confidence, royaltyBps, ethers.ZeroHash, { value: stake });
  return cascadeRegistry.computeEdgeId(childId, parentId);
}

async function finalizeEdge(cascadeRegistry: AnyContract, edgeId: string) {
  await time.increase(CHALLENGE_WINDOW_SECONDS + 1);
  await cascadeRegistry.finalizeEdge(edgeId);
}

async function registerAndFinalizeEdge(
  cascadeRegistry: AnyContract,
  childSigner: any,
  childId: string,
  parentId: string,
  confidence: ConfidenceLevel,
  royaltyBps: number
) {
  const edgeId = await registerEdge(cascadeRegistry, childSigner, childId, parentId, confidence, royaltyBps);
  await finalizeEdge(cascadeRegistry, edgeId);
  return edgeId;
}

async function buildAndSignProof(
  execRegistry: AnyContract,
  signer: any,
  modelId: string,
  modelCommitment: string,
  epoch: bigint
) {
  const domain = await domainFor(await execRegistry.getAddress());
  const now = await time.latest();
  const proof = {
    modelId,
    modelCommitment,
    requestHash: randomHash(),
    responseHash: randomHash(),
    chatId: randomHash(),
    epoch,
    issuedAt: BigInt(now),
  };
  const signature = await signProof(signer, domain, proof);
  return { proof, signature };
}

/** Sum every OwnerCredited amount emitted by a settleExecution receipt. */
function sumOwnerCredited(settlement: AnyContract, receipt: any): bigint {
  let total = 0n;
  for (const log of receipt.logs) {
    try {
      const parsed = settlement.interface.parseLog(log);
      if (parsed?.name === "OwnerCredited") total += parsed.args.amount as bigint;
    } catch {
      /* not one of ours */
    }
  }
  return total;
}

function ownerCreditsByAddress(settlement: AnyContract, receipt: any): Map<string, bigint> {
  const map = new Map<string, bigint>();
  for (const log of receipt.logs) {
    try {
      const parsed = settlement.interface.parseLog(log);
      if (parsed?.name === "OwnerCredited") {
        const owner = parsed.args.owner as string;
        map.set(owner, (map.get(owner) ?? 0n) + (parsed.args.amount as bigint));
      }
    } catch {
      /* not one of ours */
    }
  }
  return map;
}

function edgeAttributions(settlement: AnyContract, receipt: any) {
  const out: Array<{ child: string; parent: string; amount: bigint; confidence: number }> = [];
  for (const log of receipt.logs) {
    try {
      const parsed = settlement.interface.parseLog(log);
      if (parsed?.name === "EdgeAttributed") {
        out.push({
          child: parsed.args.childModelId,
          parent: parsed.args.parentModelId,
          amount: parsed.args.amount as bigint,
          confidence: Number(parsed.args.effectiveConfidence),
        });
      }
    } catch {
      /* not one of ours */
    }
  }
  return out;
}

async function fundAndSettle(
  settlement: AnyContract,
  execRegistry: AnyContract,
  submitter: any,
  proof: any,
  signature: string,
  fee: bigint
) {
  const tx = await settlement.connect(submitter).settleExecution(proof, signature, { value: fee });
  return tx.wait();
}

describe("AttributionSettlement", () => {
  describe("normal settlement", () => {
    it("one model, no ancestors — the served model's owner gets the full fee", async () => {
      const { cascadeRegistry, execRegistry, settlement, signers } = await loadFixture(deployFixture);
      const [modelOwner, providerSigner, submitter] = signers;
      await execRegistry.connect(providerSigner).registerSigner(providerSigner.address);
      const { modelId, commitment } = await registerModel(cascadeRegistry, modelOwner);

      const fee = await settlement.attributionFeePerExecution();
      const { proof, signature } = await buildAndSignProof(execRegistry, providerSigner, modelId, commitment, 1n);
      const receipt = await fundAndSettle(settlement, execRegistry, submitter, proof, signature, fee);

      expect(await settlement.claimable(modelOwner.address)).to.equal(fee);
      expect(sumOwnerCredited(settlement, receipt)).to.equal(fee);
    });

    it("one parent — the fee splits exactly between parent and child owner", async () => {
      const { cascadeRegistry, execRegistry, settlement, signers } = await loadFixture(deployFixture);
      const [parentOwner, childOwner, providerSigner, submitter] = signers;
      await execRegistry.connect(providerSigner).registerSigner(providerSigner.address);
      const { modelId: parentId } = await registerModel(cascadeRegistry, parentOwner);
      const { modelId: childId, commitment } = await registerModel(cascadeRegistry, childOwner);
      await registerAndFinalizeEdge(cascadeRegistry, childOwner, childId, parentId, ConfidenceLevel.Declared, 2000); // 20%

      await settlement.setAttributionFeePerExecution(10_000); // round number for exact bps math
      const fee = 10_000n;
      const { proof, signature } = await buildAndSignProof(execRegistry, providerSigner, childId, commitment, 1n);
      await fundAndSettle(settlement, execRegistry, submitter, proof, signature, fee);

      expect(await settlement.claimable(parentOwner.address)).to.equal(2_000n); // 20% of 10,000
      expect(await settlement.claimable(childOwner.address)).to.equal(8_000n); // residual
    });

    it("multiple parents — shares sum correctly and residual is exact", async () => {
      const { cascadeRegistry, execRegistry, settlement, signers } = await loadFixture(deployFixture);
      const [parentA, parentB, childOwner, providerSigner, submitter] = signers;
      await execRegistry.connect(providerSigner).registerSigner(providerSigner.address);
      const { modelId: aId } = await registerModel(cascadeRegistry, parentA);
      const { modelId: bId } = await registerModel(cascadeRegistry, parentB);
      const { modelId: childId, commitment } = await registerModel(cascadeRegistry, childOwner);
      await registerAndFinalizeEdge(cascadeRegistry, childOwner, childId, aId, ConfidenceLevel.Declared, 1500);
      await registerAndFinalizeEdge(cascadeRegistry, childOwner, childId, bId, ConfidenceLevel.Declared, 2500);

      await settlement.setAttributionFeePerExecution(10_000);
      const fee = 10_000n;
      const { proof, signature } = await buildAndSignProof(execRegistry, providerSigner, childId, commitment, 1n);
      await fundAndSettle(settlement, execRegistry, submitter, proof, signature, fee);

      expect(await settlement.claimable(parentA.address)).to.equal(1_500n);
      expect(await settlement.claimable(parentB.address)).to.equal(2_500n);
      expect(await settlement.claimable(childOwner.address)).to.equal(6_000n);
    });

    it("multi-hop lineage cascades multiplicatively (A<-B<-C)", async () => {
      const { cascadeRegistry, execRegistry, settlement, signers } = await loadFixture(deployFixture);
      const [ownerA, ownerB, ownerC, providerSigner, submitter] = signers;
      await execRegistry.connect(providerSigner).registerSigner(providerSigner.address);
      const { modelId: aId } = await registerModel(cascadeRegistry, ownerA);
      const { modelId: bId } = await registerModel(cascadeRegistry, ownerB);
      const { modelId: cId, commitment } = await registerModel(cascadeRegistry, ownerC);

      await registerAndFinalizeEdge(cascadeRegistry, ownerC, cId, bId, ConfidenceLevel.Declared, 1000); // C->B 10%
      await registerAndFinalizeEdge(cascadeRegistry, ownerB, bId, aId, ConfidenceLevel.Declared, 2000); // B->A 20%

      await settlement.setAttributionFeePerExecution(10_000);
      const fee = 10_000n;
      const { proof, signature } = await buildAndSignProof(execRegistry, providerSigner, cId, commitment, 1n);
      await fundAndSettle(settlement, execRegistry, submitter, proof, signature, fee);

      // C keeps 90% = 9000. B receives 1000, keeps 80% of it = 800, forwards 20% = 200 to A.
      expect(await settlement.claimable(ownerC.address)).to.equal(9_000n);
      expect(await settlement.claimable(ownerB.address)).to.equal(800n);
      expect(await settlement.claimable(ownerA.address)).to.equal(200n);
    });

    it("diamond DAG — a shared ancestor is credited via both independent paths", async () => {
      const { cascadeRegistry, execRegistry, settlement, signers } = await loadFixture(deployFixture);
      const [ownerA, ownerB, ownerC, ownerD, providerSigner, submitter] = signers;
      await execRegistry.connect(providerSigner).registerSigner(providerSigner.address);
      const { modelId: aId } = await registerModel(cascadeRegistry, ownerA);
      const { modelId: bId } = await registerModel(cascadeRegistry, ownerB);
      const { modelId: cId } = await registerModel(cascadeRegistry, ownerC);
      const { modelId: dId, commitment } = await registerModel(cascadeRegistry, ownerD);

      await registerAndFinalizeEdge(cascadeRegistry, ownerB, bId, aId, ConfidenceLevel.Declared, 1000);
      await registerAndFinalizeEdge(cascadeRegistry, ownerC, cId, aId, ConfidenceLevel.Declared, 1000);
      await registerAndFinalizeEdge(cascadeRegistry, ownerD, dId, bId, ConfidenceLevel.Declared, 2000);
      await registerAndFinalizeEdge(cascadeRegistry, ownerD, dId, cId, ConfidenceLevel.Declared, 2000);

      await settlement.setAttributionFeePerExecution(10_000);
      const fee = 10_000n;
      const { proof, signature } = await buildAndSignProof(execRegistry, providerSigner, dId, commitment, 1n);
      const receipt = await fundAndSettle(settlement, execRegistry, submitter, proof, signature, fee);

      // D->B 20% = 2000, B keeps 90% of 2000 = 1800, forwards 10% = 200 to A.
      // D->C 20% = 2000, C keeps 90% of 2000 = 1800, forwards 10% = 200 to A.
      expect(await settlement.claimable(ownerA.address)).to.equal(400n); // 200 + 200, credited via two separate paths
      expect(await settlement.claimable(ownerB.address)).to.equal(1_800n);
      expect(await settlement.claimable(ownerC.address)).to.equal(1_800n);
      expect(await settlement.claimable(ownerD.address)).to.equal(6_000n);
      expect(sumOwnerCredited(settlement, receipt)).to.equal(fee);
    });

    it("multiple executions in one epoch accumulate claimable balances", async () => {
      const { cascadeRegistry, execRegistry, settlement, signers } = await loadFixture(deployFixture);
      const [modelOwner, providerSigner, submitter] = signers;
      await execRegistry.connect(providerSigner).registerSigner(providerSigner.address);
      const { modelId, commitment } = await registerModel(cascadeRegistry, modelOwner);
      const fee = await settlement.attributionFeePerExecution();

      for (let i = 0; i < 3; i++) {
        const { proof, signature } = await buildAndSignProof(execRegistry, providerSigner, modelId, commitment, 1n);
        await fundAndSettle(settlement, execRegistry, submitter, proof, signature, fee);
      }

      expect(await settlement.claimable(modelOwner.address)).to.equal(fee * 3n);
    });

    it("multiple models settle independently within the same epoch", async () => {
      const { cascadeRegistry, execRegistry, settlement, signers } = await loadFixture(deployFixture);
      const [ownerX, ownerY, providerSigner, submitter] = signers;
      await execRegistry.connect(providerSigner).registerSigner(providerSigner.address);
      const { modelId: xId, commitment: xCommit } = await registerModel(cascadeRegistry, ownerX);
      const { modelId: yId, commitment: yCommit } = await registerModel(cascadeRegistry, ownerY);
      const fee = await settlement.attributionFeePerExecution();

      const px = await buildAndSignProof(execRegistry, providerSigner, xId, xCommit, 1n);
      await fundAndSettle(settlement, execRegistry, submitter, px.proof, px.signature, fee);
      const py = await buildAndSignProof(execRegistry, providerSigner, yId, yCommit, 1n);
      await fundAndSettle(settlement, execRegistry, submitter, py.proof, py.signature, fee);

      expect(await settlement.claimable(ownerX.address)).to.equal(fee);
      expect(await settlement.claimable(ownerY.address)).to.equal(fee);
    });

    it("only accepts proofs for the current epoch", async () => {
      const { cascadeRegistry, execRegistry, settlement, signers } = await loadFixture(deployFixture);
      const [modelOwner, providerSigner, submitter] = signers;
      await execRegistry.connect(providerSigner).registerSigner(providerSigner.address);
      const { modelId, commitment } = await registerModel(cascadeRegistry, modelOwner);
      const fee = await settlement.attributionFeePerExecution();

      const stale = await buildAndSignProof(execRegistry, providerSigner, modelId, commitment, 999n);
      await expect(
        settlement.connect(submitter).settleExecution(stale.proof, stale.signature, { value: fee })
      ).to.be.revertedWithCustomError(settlement, "InvalidEpoch");

      await settlement.advanceEpoch();
      const forNewEpoch = await buildAndSignProof(execRegistry, providerSigner, modelId, commitment, 2n);
      await expect(
        settlement.connect(submitter).settleExecution(forNewEpoch.proof, forNewEpoch.signature, { value: fee })
      ).to.not.be.reverted;
    });

    it("claiming transfers the full balance and zeroes it", async () => {
      const { cascadeRegistry, execRegistry, settlement, signers } = await loadFixture(deployFixture);
      const [modelOwner, providerSigner, submitter] = signers;
      await execRegistry.connect(providerSigner).registerSigner(providerSigner.address);
      const { modelId, commitment } = await registerModel(cascadeRegistry, modelOwner);
      const fee = await settlement.attributionFeePerExecution();
      const { proof, signature } = await buildAndSignProof(execRegistry, providerSigner, modelId, commitment, 1n);
      await fundAndSettle(settlement, execRegistry, submitter, proof, signature, fee);

      const before = await ethers.provider.getBalance(modelOwner.address);
      const tx = await settlement.connect(modelOwner).claim();
      const receipt = await tx.wait();
      const gasCost = receipt!.gasUsed * receipt!.gasPrice;
      const after = await ethers.provider.getBalance(modelOwner.address);

      expect(after).to.equal(before + fee - gasCost);
      expect(await settlement.claimable(modelOwner.address)).to.equal(0);
    });
  });

  describe("confidence composition (min(lineage, serving), per edge)", () => {
    async function settleWithConfidences(
      lineageConfidence: ConfidenceLevel,
      servingMode: ProviderMode
    ): Promise<number> {
      const { cascadeRegistry, execRegistry, settlement, owner, signers } = await loadFixture(deployFixture);
      const [parentOwner, childOwner, providerSigner, submitter] = signers;
      await execRegistry.connect(providerSigner).registerSigner(providerSigner.address);
      if (servingMode === ProviderMode.CascadeWrapper) {
        await execRegistry.connect(owner).setProviderMode(providerSigner.address, ProviderMode.CascadeWrapper);
      }
      const { modelId: parentId } = await registerModel(cascadeRegistry, parentOwner);
      const { modelId: childId, commitment } = await registerModel(cascadeRegistry, childOwner);
      await registerAndFinalizeEdge(cascadeRegistry, childOwner, childId, parentId, lineageConfidence, 1000);

      const fee = await settlement.attributionFeePerExecution();
      const { proof, signature } = await buildAndSignProof(execRegistry, providerSigner, childId, commitment, 1n);
      const receipt = await fundAndSettle(settlement, execRegistry, submitter, proof, signature, fee);
      const attributions = edgeAttributions(settlement, receipt);
      expect(attributions.length).to.equal(1);
      return attributions[0].confidence;
    }

    const cases: Array<[string, ConfidenceLevel, ProviderMode, ConfidenceLevel]> = [
      [
        "CryptographicallyBound serving + CryptographicallyBound lineage -> CryptographicallyBound",
        ConfidenceLevel.CryptographicallyBound,
        ProviderMode.CascadeWrapper,
        ConfidenceLevel.CryptographicallyBound,
      ],
      [
        "CryptographicallyBound serving + AttestedTraining lineage -> AttestedTraining",
        ConfidenceLevel.AttestedTraining,
        ProviderMode.CascadeWrapper,
        ConfidenceLevel.AttestedTraining,
      ],
      [
        "CryptographicallyBound serving + Declared lineage -> Declared",
        ConfidenceLevel.Declared,
        ProviderMode.CascadeWrapper,
        ConfidenceLevel.Declared,
      ],
      [
        "Declared serving + CryptographicallyBound lineage -> Declared (serving is the bottleneck)",
        ConfidenceLevel.CryptographicallyBound,
        ProviderMode.Standard,
        ConfidenceLevel.Declared,
      ],
      [
        "Declared serving + AttestedTraining lineage -> Declared",
        ConfidenceLevel.AttestedTraining,
        ProviderMode.Standard,
        ConfidenceLevel.Declared,
      ],
      [
        "Declared serving + Declared lineage -> Declared",
        ConfidenceLevel.Declared,
        ProviderMode.Standard,
        ConfidenceLevel.Declared,
      ],
    ];

    for (const [label, lineageConfidence, servingMode, expected] of cases) {
      it(label, async () => {
        const effective = await settleWithConfidences(lineageConfidence, servingMode);
        expect(effective).to.equal(expected);
      });
    }

    it("a stronger serving confidence never upgrades a weaker lineage edge", async () => {
      const effective = await settleWithConfidences(ConfidenceLevel.Declared, ProviderMode.CascadeWrapper);
      expect(effective).to.equal(ConfidenceLevel.Declared); // not upgraded to CryptographicallyBound
    });

    it("confidence composition never gates payment — a Declared-confidence edge is still paid in full", async () => {
      const { cascadeRegistry, execRegistry, settlement, signers } = await loadFixture(deployFixture);
      const [parentOwner, childOwner, providerSigner, submitter] = signers;
      await execRegistry.connect(providerSigner).registerSigner(providerSigner.address);
      const { modelId: parentId } = await registerModel(cascadeRegistry, parentOwner);
      const { modelId: childId, commitment } = await registerModel(cascadeRegistry, childOwner);
      await registerAndFinalizeEdge(cascadeRegistry, childOwner, childId, parentId, ConfidenceLevel.Declared, 1000);

      await settlement.setAttributionFeePerExecution(10_000);
      const fee = 10_000n;
      const { proof, signature } = await buildAndSignProof(execRegistry, providerSigner, childId, commitment, 1n);
      await fundAndSettle(settlement, execRegistry, submitter, proof, signature, fee);

      expect(await settlement.claimable(parentOwner.address)).to.equal(1_000n); // full registered share, despite Declared confidence
    });
  });

  describe("replay", () => {
    it("the same execution cannot settle twice", async () => {
      const { cascadeRegistry, execRegistry, settlement, signers } = await loadFixture(deployFixture);
      const [modelOwner, providerSigner, submitter] = signers;
      await execRegistry.connect(providerSigner).registerSigner(providerSigner.address);
      const { modelId, commitment } = await registerModel(cascadeRegistry, modelOwner);
      const fee = await settlement.attributionFeePerExecution();
      const { proof, signature } = await buildAndSignProof(execRegistry, providerSigner, modelId, commitment, 1n);

      await fundAndSettle(settlement, execRegistry, submitter, proof, signature, fee);
      await expect(
        settlement.connect(submitter).settleExecution(proof, signature, { value: fee })
      ).to.be.revertedWithCustomError(execRegistry, "ExecutionAlreadyConsumed");
    });

    it("distinct executions settle independently, even for the same model in the same epoch", async () => {
      const { cascadeRegistry, execRegistry, settlement, signers } = await loadFixture(deployFixture);
      const [modelOwner, providerSigner, submitter] = signers;
      await execRegistry.connect(providerSigner).registerSigner(providerSigner.address);
      const { modelId, commitment } = await registerModel(cascadeRegistry, modelOwner);
      const fee = await settlement.attributionFeePerExecution();

      const p1 = await buildAndSignProof(execRegistry, providerSigner, modelId, commitment, 1n);
      const p2 = await buildAndSignProof(execRegistry, providerSigner, modelId, commitment, 1n);
      await fundAndSettle(settlement, execRegistry, submitter, p1.proof, p1.signature, fee);
      await expect(settlement.connect(submitter).settleExecution(p2.proof, p2.signature, { value: fee })).to.not.be
        .reverted;
      expect(await settlement.claimable(modelOwner.address)).to.equal(fee * 2n);
    });
  });

  describe("security", () => {
    it("a relayer distinct from every party involved cannot redirect the recipient", async () => {
      const { cascadeRegistry, execRegistry, settlement, signers } = await loadFixture(deployFixture);
      const [modelOwner, providerSigner, relayer] = signers;
      await execRegistry.connect(providerSigner).registerSigner(providerSigner.address);
      const { modelId, commitment } = await registerModel(cascadeRegistry, modelOwner);
      const fee = await settlement.attributionFeePerExecution();
      const { proof, signature } = await buildAndSignProof(execRegistry, providerSigner, modelId, commitment, 1n);

      await fundAndSettle(settlement, execRegistry, relayer, proof, signature, fee);
      expect(await settlement.claimable(modelOwner.address)).to.equal(fee); // never relayer.address
      expect(await settlement.claimable(relayer.address)).to.equal(0);
    });

    it("rejects incorrect funding (too little or too much)", async () => {
      const { cascadeRegistry, execRegistry, settlement, signers } = await loadFixture(deployFixture);
      const [modelOwner, providerSigner, submitter] = signers;
      await execRegistry.connect(providerSigner).registerSigner(providerSigner.address);
      const { modelId, commitment } = await registerModel(cascadeRegistry, modelOwner);
      const fee = await settlement.attributionFeePerExecution();
      const { proof, signature } = await buildAndSignProof(execRegistry, providerSigner, modelId, commitment, 1n);

      await expect(
        settlement.connect(submitter).settleExecution(proof, signature, { value: fee - 1n })
      ).to.be.revertedWithCustomError(settlement, "IncorrectFunding");
      await expect(
        settlement.connect(submitter).settleExecution(proof, signature, { value: fee + 1n })
      ).to.be.revertedWithCustomError(settlement, "IncorrectFunding");
    });

    it("a tampered proof reverts before any funds move or balance changes", async () => {
      const { cascadeRegistry, execRegistry, settlement, signers } = await loadFixture(deployFixture);
      const [modelOwner, providerSigner, submitter] = signers;
      await execRegistry.connect(providerSigner).registerSigner(providerSigner.address);
      const { modelId, commitment } = await registerModel(cascadeRegistry, modelOwner);
      const otherModel = await registerModel(cascadeRegistry, modelOwner);
      const fee = await settlement.attributionFeePerExecution();
      const { proof, signature } = await buildAndSignProof(execRegistry, providerSigner, modelId, commitment, 1n);

      const tampered = { ...proof, modelId: otherModel.modelId };
      await expect(
        settlement.connect(submitter).settleExecution(tampered, signature, { value: fee })
      ).to.be.revertedWithCustomError(execRegistry, "UnregisteredSigner");
      expect(await settlement.claimable(modelOwner.address)).to.equal(0);
    });

    it("unauthorized claim fails — an address with no balance cannot claim", async () => {
      const { settlement, signers } = await loadFixture(deployFixture);
      const [stranger] = signers;
      await expect(settlement.connect(stranger).claim()).to.be.revertedWithCustomError(settlement, "NothingToClaim");
    });

    it("double claim fails", async () => {
      const { cascadeRegistry, execRegistry, settlement, signers } = await loadFixture(deployFixture);
      const [modelOwner, providerSigner, submitter] = signers;
      await execRegistry.connect(providerSigner).registerSigner(providerSigner.address);
      const { modelId, commitment } = await registerModel(cascadeRegistry, modelOwner);
      const fee = await settlement.attributionFeePerExecution();
      const { proof, signature } = await buildAndSignProof(execRegistry, providerSigner, modelId, commitment, 1n);
      await fundAndSettle(settlement, execRegistry, submitter, proof, signature, fee);

      await settlement.connect(modelOwner).claim();
      await expect(settlement.connect(modelOwner).claim()).to.be.revertedWithCustomError(
        settlement,
        "NothingToClaim"
      );
    });

    it("reentrancy: a malicious claimant cannot claim twice from within its own receive()", async () => {
      const { cascadeRegistry, execRegistry, settlement, signers } = await loadFixture(deployFixture);
      const [providerSigner, submitter] = signers;
      await execRegistry.connect(providerSigner).registerSigner(providerSigner.address);

      const ReentrantFactory = await ethers.getContractFactory("ReentrantClaimer");
      const attacker: AnyContract = await ReentrantFactory.deploy(await settlement.getAddress());
      await attacker.waitForDeployment();

      const commitment = randomHash();
      const salt = ethers.randomBytes(32);
      const tx = await attacker.registerModel(await cascadeRegistry.getAddress(), commitment, "0g-storage://x", salt);
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

      const fee = await settlement.attributionFeePerExecution();
      const { proof, signature } = await buildAndSignProof(execRegistry, providerSigner, modelId, commitment, 1n);
      await fundAndSettle(settlement, execRegistry, submitter, proof, signature, fee);

      await attacker.attack();
      expect(await attacker.reentryAttempted()).to.equal(true);
      expect(await attacker.reentrySucceeded()).to.equal(false); // second claim() reverted inside the try/catch
      expect(await ethers.provider.getBalance(await attacker.getAddress())).to.equal(fee); // only paid once
      expect(await settlement.claimable(await attacker.getAddress())).to.equal(0);
    });

    it("an unfinalized (pending, unchallenged-but-not-yet-finalizable) edge receives no attribution", async () => {
      const { cascadeRegistry, execRegistry, settlement, signers } = await loadFixture(deployFixture);
      const [parentOwner, childOwner, providerSigner, submitter] = signers;
      await execRegistry.connect(providerSigner).registerSigner(providerSigner.address);
      const { modelId: parentId } = await registerModel(cascadeRegistry, parentOwner);
      const { modelId: childId, commitment } = await registerModel(cascadeRegistry, childOwner);
      await registerEdge(cascadeRegistry, childOwner, childId, parentId, ConfidenceLevel.Declared, 1000); // not finalized

      const fee = await settlement.attributionFeePerExecution();
      const { proof, signature } = await buildAndSignProof(execRegistry, providerSigner, childId, commitment, 1n);
      const receipt = await fundAndSettle(settlement, execRegistry, submitter, proof, signature, fee);

      expect(edgeAttributions(settlement, receipt).length).to.equal(0);
      expect(await settlement.claimable(parentOwner.address)).to.equal(0);
      expect(await settlement.claimable(childOwner.address)).to.equal(fee); // full residual, parent skipped
    });

    it("a challenged (unresolved) edge receives no attribution while the dispute is open", async () => {
      // Challenged status alone (regardless of eventual resolution) is
      // enough to exclude an edge — AttributionSettlement only ever
      // traverses Finalized edges. No need to actually resolve the
      // challenge for this test.
      const { cascadeRegistry, execRegistry, settlement, signers } = await loadFixture(deployFixture);
      const [parentOwner, childOwner, providerSigner, submitter, challenger] = signers;
      await execRegistry.connect(providerSigner).registerSigner(providerSigner.address);
      const { modelId: parentId } = await registerModel(cascadeRegistry, parentOwner);
      const { modelId: childId, commitment } = await registerModel(cascadeRegistry, childOwner);
      const edgeId = await registerEdge(cascadeRegistry, childOwner, childId, parentId, ConfidenceLevel.Declared, 1000);

      await cascadeRegistry.connect(challenger).challengeEdge(edgeId, { value: MIN_STAKE });

      const fee = await settlement.attributionFeePerExecution();
      const { proof, signature } = await buildAndSignProof(execRegistry, providerSigner, childId, commitment, 1n);
      const receipt = await fundAndSettle(settlement, execRegistry, submitter, proof, signature, fee);

      expect(edgeAttributions(settlement, receipt).length).to.equal(0);
      expect(await settlement.claimable(childOwner.address)).to.equal(fee);
    });

    it("depth-bound: ancestors beyond CascadeRegistry.maxDepth receive no credit", async () => {
      const { cascadeRegistry, execRegistry, settlement, signers, owner } = await loadFixture(deployFixture);
      await cascadeRegistry.connect(owner).setMaxDepth(2);
      const providerSigner = signers[0];
      const submitter = signers[1];
      await execRegistry.connect(providerSigner).registerSigner(providerSigner.address);

      // Chain of 4: model0 <- model1 <- model2 <- model3 (served)
      const owners = signers.slice(2, 6);
      const models: Array<{ modelId: string; commitment: string }> = [];
      for (let i = 0; i < 4; i++) {
        models.push(await registerModel(cascadeRegistry, owners[i]));
      }
      for (let i = 1; i < 4; i++) {
        await registerAndFinalizeEdge(
          cascadeRegistry,
          owners[i],
          models[i].modelId,
          models[i - 1].modelId,
          ConfidenceLevel.Declared,
          5000 // 50% each hop, within the 50% per-child cap
        );
      }

      await settlement.setAttributionFeePerExecution(10_000);
      const fee = 10_000n;
      const { proof, signature } = await buildAndSignProof(
        execRegistry,
        providerSigner,
        models[3].modelId,
        models[3].commitment,
        1n
      );
      const receipt = await fundAndSettle(settlement, execRegistry, submitter, proof, signature, fee);

      // maxDepth=2: model3 (depth0) -> model2 (depth1) -> model1 (depth2, last one whose OWN
      // parent edge is still traversed) -> model0 never reached.
      const credits = ownerCreditsByAddress(settlement, receipt);
      expect(credits.get(owners[0].address) ?? 0n).to.equal(0n); // model0's owner: unreached
      expect(sumOwnerCredited(settlement, receipt)).to.equal(fee); // conservation still holds — the amount that
      // would have flowed to model0 stays folded into model1's residual instead.
    });
  });

  describe("accounting invariants", () => {
    it("conservation holds with uneven, non-dividing basis points (rounding dust folds into the nearer owner)", async () => {
      const { cascadeRegistry, execRegistry, settlement, signers } = await loadFixture(deployFixture);
      const [parentOwner, childOwner, providerSigner, submitter] = signers;
      await execRegistry.connect(providerSigner).registerSigner(providerSigner.address);
      const { modelId: parentId } = await registerModel(cascadeRegistry, parentOwner);
      const { modelId: childId, commitment } = await registerModel(cascadeRegistry, childOwner);
      await registerAndFinalizeEdge(cascadeRegistry, childOwner, childId, parentId, ConfidenceLevel.Declared, 3333); // 33.33%

      await settlement.setAttributionFeePerExecution(9_999); // deliberately not a clean multiple
      const fee = 9_999n;
      const { proof, signature } = await buildAndSignProof(execRegistry, providerSigner, childId, commitment, 1n);
      const receipt = await fundAndSettle(settlement, execRegistry, submitter, proof, signature, fee);

      const parentShare = (fee * 3333n) / BPS_DENOMINATOR; // floors to 3332
      expect(await settlement.claimable(parentOwner.address)).to.equal(parentShare);
      expect(await settlement.claimable(childOwner.address)).to.equal(fee - parentShare); // dust folded in here
      expect(sumOwnerCredited(settlement, receipt)).to.equal(fee); // exact conservation, no dust pool needed
    });

    it("randomized DAGs conserve total value across many trials", async () => {
      const { cascadeRegistry, execRegistry, settlement, owner, signers } = await loadFixture(deployFixture);
      const providerSigner = signers[0];
      const submitter = signers[1];
      await execRegistry.connect(providerSigner).registerSigner(providerSigner.address);
      await settlement.setAttributionFeePerExecution(10_000);
      const fee = 10_000n;

      const pool = signers.slice(2, 12); // 10 owners
      const models: Array<{ modelId: string; commitment: string }> = [];
      for (const s of pool) models.push(await registerModel(cascadeRegistry, s));

      // Random forest: each node i>0 gets a random earlier node as parent with a random bps <= 5000.
      for (let i = 1; i < models.length; i++) {
        const parentIdx = Math.floor(Math.random() * i);
        const bps = 100 + Math.floor(Math.random() * 4900);
        await registerAndFinalizeEdge(
          cascadeRegistry,
          pool[i],
          models[i].modelId,
          models[parentIdx].modelId,
          ConfidenceLevel.Declared,
          bps
        );
      }

      for (const leafModel of [models[9], models[7], models[5]]) {
        const { proof, signature } = await buildAndSignProof(
          execRegistry,
          providerSigner,
          leafModel.modelId,
          leafModel.commitment,
          1n
        );
        const receipt = await fundAndSettle(settlement, execRegistry, submitter, proof, signature, fee);
        expect(sumOwnerCredited(settlement, receipt)).to.equal(fee);
      }
    });

    it("attribution is deterministic — equivalent proofs against the same graph produce the same split", async () => {
      const { cascadeRegistry, execRegistry, settlement, signers } = await loadFixture(deployFixture);
      const [parentOwner, childOwner, providerSigner, submitter] = signers;
      await execRegistry.connect(providerSigner).registerSigner(providerSigner.address);
      const { modelId: parentId } = await registerModel(cascadeRegistry, parentOwner);
      const { modelId: childId, commitment } = await registerModel(cascadeRegistry, childOwner);
      await registerAndFinalizeEdge(cascadeRegistry, childOwner, childId, parentId, ConfidenceLevel.Declared, 1750);

      await settlement.setAttributionFeePerExecution(10_000);
      const fee = 10_000n;
      const p1 = await buildAndSignProof(execRegistry, providerSigner, childId, commitment, 1n);
      await fundAndSettle(settlement, execRegistry, submitter, p1.proof, p1.signature, fee);
      const parentAfterFirst = await settlement.claimable(parentOwner.address);

      const p2 = await buildAndSignProof(execRegistry, providerSigner, childId, commitment, 1n);
      await fundAndSettle(settlement, execRegistry, submitter, p2.proof, p2.signature, fee);
      const parentAfterSecond = await settlement.claimable(parentOwner.address);

      expect(parentAfterSecond - parentAfterFirst).to.equal(parentAfterFirst); // identical per-execution delta
    });
  });

  describe("regression", () => {
    it("Phase 1-3 test suites are unaffected by AttributionSettlement's existence", async () => {
      // Structural check only — the actual regression coverage is the
      // CascadeRegistry.test.ts and ExecutionRegistry.test.ts files
      // themselves, run as part of the same `npm test` invocation.
      const { cascadeRegistry, execRegistry } = await loadFixture(deployFixture);
      expect(await cascadeRegistry.getAddress()).to.properAddress;
      expect(await execRegistry.getAddress()).to.properAddress;
    });
  });
});
