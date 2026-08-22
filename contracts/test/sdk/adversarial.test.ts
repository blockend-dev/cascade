import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { createCascadeClient } from "../../../sdk/src/client";
import { signUsageProof, usageProofDomain } from "../../../sdk/src/eip712";
import { UsageProof } from "../../../sdk/src/types";
import { deployCascadeStack, randomHash } from "./helpers";

async function fixture() {
  return deployCascadeStack();
}

async function baseProof(
  modelId: string,
  commitment: string
): Promise<UsageProof> {
  return {
    modelId,
    modelCommitment: commitment,
    requestHash: randomHash(),
    responseHash: randomHash(),
    chatId: randomHash(),
    epoch: 1n,
    issuedAt: BigInt(await time.latest()),
  };
}

describe("SDK adversarial — encoding, tampering, and contract interoperability", () => {
  it("rejects a proof signed by a registered key over the WRONG DOMAIN (mismatched chainId)", async () => {
    const { addresses, signers } = await loadFixture(fixture);
    const providerSigner = signers[0];
    const modelOwner = signers[1];

    const client = createCascadeClient({ provider: ethers.provider, signer: providerSigner, addresses });
    await client.write.registerProviderSigner(providerSigner.address);
    const ownerClient = createCascadeClient({ provider: ethers.provider, signer: modelOwner, addresses });
    const commitment = randomHash();
    const { modelId } = await ownerClient.write.registerModel(commitment, "0g-storage://x");

    const proof = await baseProof(modelId, commitment);
    // Sign against a domain with the wrong chainId — same signer, same
    // contract address, only the domain separator differs.
    const wrongDomain = usageProofDomain(999999n, addresses.executionRegistry);
    const badSignature = await signUsageProof(providerSigner, wrongDomain, proof);

    await expect(client.usage.verifyUsageProof(proof, badSignature)).to.be.reverted;
  });

  it("rejects a proof signed against the wrong verifyingContract (cross-contract replay)", async () => {
    const { addresses, signers } = await loadFixture(fixture);
    const providerSigner = signers[0];
    const modelOwner = signers[1];

    const client = createCascadeClient({ provider: ethers.provider, signer: providerSigner, addresses });
    await client.write.registerProviderSigner(providerSigner.address);
    const ownerClient = createCascadeClient({ provider: ethers.provider, signer: modelOwner, addresses });
    const commitment = randomHash();
    const { modelId } = await ownerClient.write.registerModel(commitment, "0g-storage://x");

    const proof = await baseProof(modelId, commitment);
    // A plausible-looking but wrong verifyingContract (the registry itself,
    // not the execution registry that actually verifies UsageProof).
    const chainId = await client.chainId();
    const wrongDomain = usageProofDomain(chainId, addresses.cascadeRegistry);
    const badSignature = await signUsageProof(providerSigner, wrongDomain, proof);

    await expect(client.usage.verifyUsageProof(proof, badSignature)).to.be.reverted;
  });

  it("any single-field tamper after signing invalidates the signature (no bit of the proof is unchecked)", async () => {
    const { addresses, signers } = await loadFixture(fixture);
    const providerSigner = signers[0];
    const modelOwner = signers[1];

    const client = createCascadeClient({ provider: ethers.provider, signer: providerSigner, addresses });
    await client.write.registerProviderSigner(providerSigner.address);
    const ownerClient = createCascadeClient({ provider: ethers.provider, signer: modelOwner, addresses });
    const commitment = randomHash();
    const { modelId } = await ownerClient.write.registerModel(commitment, "0g-storage://x");

    const domain = await client.usageProofDomain();
    const proof = await baseProof(modelId, commitment);
    const signature = await signUsageProof(providerSigner, domain, proof);

    const tamperedFields: Array<Partial<UsageProof>> = [
      { responseHash: randomHash() },
      { requestHash: randomHash() },
      { chatId: randomHash() },
      { epoch: 2n },
    ];

    for (const patch of tamperedFields) {
      const tampered = { ...proof, ...patch };
      await expect(client.usage.verifyUsageProof(tampered, signature)).to.be.reverted;
    }
  });

  it("rejects a well-formed, correctly signed proof from a signer that was never registered", async () => {
    const { addresses, signers } = await loadFixture(fixture);
    const unregisteredSigner = signers[0];
    const modelOwner = signers[1];

    const client = createCascadeClient({ provider: ethers.provider, signer: unregisteredSigner, addresses });
    const ownerClient = createCascadeClient({ provider: ethers.provider, signer: modelOwner, addresses });
    const commitment = randomHash();
    const { modelId } = await ownerClient.write.registerModel(commitment, "0g-storage://x");

    const domain = await client.usageProofDomain();
    const proof = await baseProof(modelId, commitment);
    const signature = await signUsageProof(unregisteredSigner, domain, proof);

    let decoded;
    try {
      await client.usage.verifyUsageProof(proof, signature);
      expect.fail("expected verifyUsageProof to revert");
    } catch (err) {
      decoded = client.decodeError(err);
    }
    expect(decoded.name).to.equal("UnregisteredSigner");
    expect(decoded.contract).to.equal("ExecutionRegistry");
  });

  it("rejects a proof whose modelCommitment does not match the model's registered commitment", async () => {
    const { addresses, signers } = await loadFixture(fixture);
    const providerSigner = signers[0];
    const modelOwner = signers[1];

    const client = createCascadeClient({ provider: ethers.provider, signer: providerSigner, addresses });
    await client.write.registerProviderSigner(providerSigner.address);
    const ownerClient = createCascadeClient({ provider: ethers.provider, signer: modelOwner, addresses });
    const { modelId } = await ownerClient.write.registerModel(randomHash(), "0g-storage://x");

    const domain = await client.usageProofDomain();
    // Sign with a commitment that does not match what was registered on-chain.
    const proof = await baseProof(modelId, randomHash());
    const signature = await signUsageProof(providerSigner, domain, proof);

    let decoded;
    try {
      await client.usage.verifyUsageProof(proof, signature);
      expect.fail("expected verifyUsageProof to revert");
    } catch (err) {
      decoded = client.decodeError(err);
    }
    expect(decoded.name).to.equal("ModelCommitmentMismatch");
  });

  it("rejects an expired proof (issuedAt older than the proof validity window)", async () => {
    const { addresses, signers } = await loadFixture(fixture);
    const providerSigner = signers[0];
    const modelOwner = signers[1];

    const client = createCascadeClient({ provider: ethers.provider, signer: providerSigner, addresses });
    await client.write.registerProviderSigner(providerSigner.address);
    const ownerClient = createCascadeClient({ provider: ethers.provider, signer: modelOwner, addresses });
    const commitment = randomHash();
    const { modelId } = await ownerClient.write.registerModel(commitment, "0g-storage://x");

    const validityWindow = await client.read.getProofValidityWindow();
    const domain = await client.usageProofDomain();
    const proof: UsageProof = {
      ...(await baseProof(modelId, commitment)),
      issuedAt: BigInt(await time.latest()) - validityWindow - 10n,
    };
    const signature = await signUsageProof(providerSigner, domain, proof);

    let decoded;
    try {
      await client.usage.verifyUsageProof(proof, signature);
      expect.fail("expected verifyUsageProof to revert");
    } catch (err) {
      decoded = client.decodeError(err);
    }
    expect(decoded.name).to.equal("ProofExpired");
  });

  it("rejects double submission of an identical proof (execution-identity replay protection is not bypassable through the SDK)", async () => {
    const { addresses, signers } = await loadFixture(fixture);
    const providerSigner = signers[0];
    const modelOwner = signers[1];

    const client = createCascadeClient({ provider: ethers.provider, signer: providerSigner, addresses });
    await client.write.registerProviderSigner(providerSigner.address);
    const ownerClient = createCascadeClient({ provider: ethers.provider, signer: modelOwner, addresses });
    const commitment = randomHash();
    const { modelId } = await ownerClient.write.registerModel(commitment, "0g-storage://x");

    const domain = await client.usageProofDomain();
    const proof = await baseProof(modelId, commitment);
    const signature = await signUsageProof(providerSigner, domain, proof);

    const { executionId } = await client.usage.submitUsageProof(proof, signature);
    expect(await client.read.isExecutionConsumed(executionId)).to.equal(true);

    let decoded;
    try {
      await client.usage.submitUsageProof(proof, signature);
      expect.fail("expected the second submission to revert");
    } catch (err) {
      decoded = client.decodeError(err);
    }
    expect(decoded.name).to.equal("ExecutionAlreadyConsumed");
  });
});
