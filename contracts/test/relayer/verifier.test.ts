import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { Verifier, validateStructure } from "../../../relayer/src/verifier";
import { ProofStatus } from "../../../relayer/src/types";
import {
  buildAndSignProof,
  deployCascadeStack,
  domainFor,
  randomHash,
  registerModel,
  signProof,
  throughJson,
} from "./helpers";

async function fixture() {
  const stack = await deployCascadeStack();
  const providerSigner = stack.signers[0];
  const modelOwner = stack.signers[1];
  await stack.execRegistry.connect(providerSigner).registerSigner(providerSigner.address);
  const { modelId, commitment } = await registerModel(stack.cascadeRegistry, modelOwner);

  const verifier = new Verifier(ethers.provider, await stack.execRegistry.getAddress(), {
    currentEpoch: () => stack.settlement.currentEpoch(),
  });

  return { ...stack, providerSigner, modelOwner, modelId, commitment, verifier };
}

describe("relayer Verifier", () => {
  describe("structural validation (no RPC)", () => {
    it("rejects a non-object payload", () => {
      const result = validateStructure("not an object");
      expect(result.ok).to.equal(false);
    });

    it("rejects a missing proof or signature", () => {
      expect(validateStructure({}).ok).to.equal(false);
      expect(validateStructure({ proof: {} }).ok).to.equal(false);
    });

    it("rejects malformed hash fields", () => {
      const bad = { proof: { modelId: "not-a-hash" }, signature: "0x" + "11".repeat(65) };
      const result = validateStructure(bad);
      expect(result.ok).to.equal(false);
    });

    it("rejects a wrong-length signature", () => {
      const bad = {
        proof: {
          modelId: randomHash(),
          modelCommitment: randomHash(),
          requestHash: randomHash(),
          responseHash: randomHash(),
          chatId: randomHash(),
          epoch: 1,
          issuedAt: 1,
        },
        signature: "0x1234",
      };
      expect(validateStructure(bad).ok).to.equal(false);
    });

    it("rejects an out-of-uint64-range epoch (huge integer defense)", () => {
      const bad = {
        proof: {
          modelId: randomHash(),
          modelCommitment: randomHash(),
          requestHash: randomHash(),
          responseHash: randomHash(),
          chatId: randomHash(),
          epoch: (1n << 64n).toString(), // exactly one past uint64 max
          issuedAt: 1,
        },
        signature: "0x" + "11".repeat(65),
      };
      expect(validateStructure(bad).ok).to.equal(false);
    });

    it("rejects a non-numeric epoch without throwing", () => {
      const bad = {
        proof: {
          modelId: randomHash(),
          modelCommitment: randomHash(),
          requestHash: randomHash(),
          responseHash: randomHash(),
          chatId: randomHash(),
          epoch: "not-a-number",
          issuedAt: 1,
        },
        signature: "0x" + "11".repeat(65),
      };
      expect(() => validateStructure(bad)).to.not.throw();
      expect(validateStructure(bad).ok).to.equal(false);
    });

    it("accepts a proof round-tripped through JSON (bigints as strings, the real HTTP-boundary shape)", async () => {
      const { execRegistry, providerSigner, modelId, commitment } = await loadFixture(fixture);
      const { proof, signature } = await buildAndSignProof(execRegistry, providerSigner, modelId, commitment, 1n);
      const wire = throughJson({ proof, signature });
      const result = validateStructure(wire);
      expect(result.ok).to.equal(true);
    });
  });

  describe("full pipeline — valid proof", () => {
    it("verifies and returns a VerifiedUsage derived entirely from chain state", async () => {
      const { execRegistry, providerSigner, modelId, commitment, verifier } = await loadFixture(fixture);
      const { proof, signature } = await buildAndSignProof(execRegistry, providerSigner, modelId, commitment, 1n);

      const outcome = await verifier.verify(throughJson({ proof, signature }));
      expect(outcome.ok).to.equal(true);
      if (outcome.ok) {
        expect(outcome.usage.modelId).to.equal(modelId);
        expect(outcome.usage.provider).to.equal(providerSigner.address);
        expect(outcome.usage.signer).to.equal(providerSigner.address);
      }
    });
  });

  describe("full pipeline — rejections", () => {
    it("rejects a garbage signature", async () => {
      const { execRegistry, modelId, commitment, verifier } = await loadFixture(fixture);
      const proof = {
        modelId,
        modelCommitment: commitment,
        requestHash: randomHash(),
        responseHash: randomHash(),
        chatId: randomHash(),
        epoch: 1n,
        issuedAt: BigInt(await time.latest()),
      };
      const outcome = await verifier.verify(throughJson({ proof, signature: "0x" + "ab".repeat(65) }));
      expect(outcome.ok).to.equal(false);
      if (!outcome.ok) expect(outcome.status).to.equal(ProofStatus.INVALID);
    });

    it("rejects a proof from an unregistered signer", async () => {
      const { execRegistry, modelId, commitment, verifier, signers } = await loadFixture(fixture);
      const stranger = signers[5];
      const { proof, signature } = await buildAndSignProof(execRegistry, stranger, modelId, commitment, 1n);
      const outcome = await verifier.verify(throughJson({ proof, signature }));
      expect(outcome.ok).to.equal(false);
      if (!outcome.ok) expect(outcome.status).to.equal(ProofStatus.INVALID);
    });

    it("rejects a proof signed under the wrong chainId", async () => {
      const { providerSigner, modelId, commitment, verifier, execRegistry } = await loadFixture(fixture);
      const wrongDomain = {
        name: "Cascade",
        version: "1",
        chainId: 999999n,
        verifyingContract: await execRegistry.getAddress(),
      };
      const proof = {
        modelId,
        modelCommitment: commitment,
        requestHash: randomHash(),
        responseHash: randomHash(),
        chatId: randomHash(),
        epoch: 1n,
        issuedAt: BigInt(await time.latest()),
      };
      const signature = await signProof(providerSigner, wrongDomain, proof);
      const outcome = await verifier.verify(throughJson({ proof, signature }));
      expect(outcome.ok).to.equal(false);
      if (!outcome.ok) expect(outcome.status).to.equal(ProofStatus.INVALID);
    });

    it("rejects a proof signed for a different ExecutionRegistry deployment", async () => {
      const { cascadeRegistry, providerSigner, modelId, commitment, verifier } = await loadFixture(fixture);
      const ExecFactory = await ethers.getContractFactory("ExecutionRegistry");
      const otherExec = await ExecFactory.deploy(await cascadeRegistry.getAddress());
      await otherExec.waitForDeployment();

      const wrongDomain = await domainFor(await otherExec.getAddress());
      const proof = {
        modelId,
        modelCommitment: commitment,
        requestHash: randomHash(),
        responseHash: randomHash(),
        chatId: randomHash(),
        epoch: 1n,
        issuedAt: BigInt(await time.latest()),
      };
      const signature = await signProof(providerSigner, wrongDomain, proof);
      const outcome = await verifier.verify(throughJson({ proof, signature }));
      expect(outcome.ok).to.equal(false);
      if (!outcome.ok) expect(outcome.status).to.equal(ProofStatus.INVALID);
    });

    it("rejects a proof honestly signed against a model commitment that doesn't match the registry", async () => {
      const { execRegistry, providerSigner, modelId, verifier } = await loadFixture(fixture);
      const { proof, signature } = await buildAndSignProof(execRegistry, providerSigner, modelId, randomHash(), 1n);
      const outcome = await verifier.verify(throughJson({ proof, signature }));
      expect(outcome.ok).to.equal(false);
      if (!outcome.ok) expect(outcome.status).to.equal(ProofStatus.INVALID);
    });

    it("rejects a proof tampered after signing (request hash)", async () => {
      const { execRegistry, providerSigner, modelId, commitment, verifier } = await loadFixture(fixture);
      const { proof, signature } = await buildAndSignProof(execRegistry, providerSigner, modelId, commitment, 1n);
      const tampered = { ...proof, requestHash: randomHash() };
      const outcome = await verifier.verify(throughJson({ proof: tampered, signature }));
      expect(outcome.ok).to.equal(false);
      if (!outcome.ok) expect(outcome.status).to.equal(ProofStatus.INVALID);
    });

    it("rejects a proof tampered after signing (response hash)", async () => {
      const { execRegistry, providerSigner, modelId, commitment, verifier } = await loadFixture(fixture);
      const { proof, signature } = await buildAndSignProof(execRegistry, providerSigner, modelId, commitment, 1n);
      const tampered = { ...proof, responseHash: randomHash() };
      const outcome = await verifier.verify(throughJson({ proof: tampered, signature }));
      expect(outcome.ok).to.equal(false);
      if (!outcome.ok) expect(outcome.status).to.equal(ProofStatus.INVALID);
    });

    it("flags an already-consumed execution distinctly, not as a generic invalid", async () => {
      const { execRegistry, providerSigner, modelId, commitment, verifier } = await loadFixture(fixture);
      const { proof, signature } = await buildAndSignProof(execRegistry, providerSigner, modelId, commitment, 1n);
      await execRegistry.consumeUsageProof(proof, signature);

      const outcome = await verifier.verify(throughJson({ proof, signature }));
      expect(outcome.ok).to.equal(false);
      if (!outcome.ok) expect(outcome.status).to.equal(ProofStatus.ALREADY_CONSUMED);
    });

    it("flags a future epoch as not-yet-open, distinctly from invalid", async () => {
      const { execRegistry, providerSigner, modelId, commitment, verifier } = await loadFixture(fixture);
      const { proof, signature } = await buildAndSignProof(execRegistry, providerSigner, modelId, commitment, 5n);
      const outcome = await verifier.verify(throughJson({ proof, signature }));
      expect(outcome.ok).to.equal(false);
      if (!outcome.ok) expect(outcome.status).to.equal(ProofStatus.EPOCH_NOT_YET_OPEN);
    });

    it("flags a past epoch as expired, distinctly from invalid", async () => {
      const { execRegistry, settlement, providerSigner, modelId, commitment, verifier, owner } = await loadFixture(
        fixture
      );
      const { proof, signature } = await buildAndSignProof(execRegistry, providerSigner, modelId, commitment, 1n);
      await settlement.connect(owner).advanceEpoch();
      const outcome = await verifier.verify(throughJson({ proof, signature }));
      expect(outcome.ok).to.equal(false);
      if (!outcome.ok) expect(outcome.status).to.equal(ProofStatus.EPOCH_EXPIRED);
    });
  });
});
