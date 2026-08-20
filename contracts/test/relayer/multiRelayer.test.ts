import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { Submitter } from "../../../relayer/src/submitter";
import { Verifier } from "../../../relayer/src/verifier";
import { ProofStatus } from "../../../relayer/src/types";
import { RelayerConfig } from "../../../relayer/src/config";
import { buildAndSignProof, deployCascadeStack, registerModel } from "./helpers";

function testConfig(): RelayerConfig {
  return {
    rpcUrl: "unused-in-tests",
    chainId: 31337n,
    cascadeRegistryAddress: "",
    executionRegistryAddress: "",
    attributionSettlementAddress: "",
    httpPort: 0,
    confirmations: 1,
    confirmationTimeoutMs: 30_000,
    maxSubmissionAttempts: 3,
    retryBaseDelayMs: 10,
    retryMaxDelayMs: 50,
    gasBumpPerAttempt: 0.2,
  };
}

async function fixture() {
  const stack = await deployCascadeStack();
  const providerSigner = stack.signers[0];
  const modelOwner = stack.signers[1];
  const relayerA = stack.signers[2];
  const relayerB = stack.signers[3];
  const relayerC = stack.signers[4];

  await stack.execRegistry.connect(providerSigner).registerSigner(providerSigner.address);
  const { modelId, commitment } = await registerModel(stack.cascadeRegistry, modelOwner);

  const settlementAddress = await stack.settlement.getAddress();
  const execAddress = await stack.execRegistry.getAddress();

  const verifier = new Verifier(ethers.provider, execAddress, { currentEpoch: () => stack.settlement.currentEpoch() });

  const makeSubmitter = (relayerSigner: any) =>
    new Submitter(relayerSigner, ethers.provider, settlementAddress, testConfig());

  return {
    ...stack,
    providerSigner,
    modelOwner,
    modelId,
    commitment,
    verifier,
    relayerA,
    relayerB,
    relayerC,
    makeSubmitter,
  };
}

describe("multi-relayer safety", () => {
  it("exactly one of two racing relayers settles; the other observes a duplicate", async () => {
    const { execRegistry, providerSigner, modelId, commitment, verifier, makeSubmitter, relayerA, relayerB, settlement, modelOwner } =
      await loadFixture(fixture);
    const { proof, signature } = await buildAndSignProof(execRegistry, providerSigner, modelId, commitment, 1n);

    const verification = await verifier.verify({ proof, signature });
    expect(verification.ok).to.equal(true);
    if (!verification.ok) return;

    const submitterA = makeSubmitter(relayerA);
    const submitterB = makeSubmitter(relayerB);

    const [outcomeA, outcomeB] = await Promise.all([
      submitterA.submit(proof, signature, verification.usage),
      submitterB.submit(proof, signature, verification.usage),
    ]);

    const statuses = [outcomeA.status, outcomeB.status].sort();
    expect(statuses).to.deep.equal([ProofStatus.DUPLICATE, ProofStatus.SETTLED].sort());

    // Exactly one fee's worth was credited — not zero, not two.
    const fee = await settlement.attributionFeePerExecution();
    expect(await settlement.claimable(modelOwner.address)).to.equal(fee);
  });

  it("three independent relayers racing the same proof still settle exactly once", async () => {
    const {
      execRegistry,
      providerSigner,
      modelId,
      commitment,
      verifier,
      makeSubmitter,
      relayerA,
      relayerB,
      relayerC,
      settlement,
      modelOwner,
    } = await loadFixture(fixture);
    const { proof, signature } = await buildAndSignProof(execRegistry, providerSigner, modelId, commitment, 1n);
    const verification = await verifier.verify({ proof, signature });
    if (!verification.ok) throw new Error("expected valid proof");

    const submitters = [makeSubmitter(relayerA), makeSubmitter(relayerB), makeSubmitter(relayerC)];
    const outcomes = await Promise.all(submitters.map((s) => s.submit(proof, signature, verification.usage)));

    const settledCount = outcomes.filter((o) => o.status === ProofStatus.SETTLED).length;
    const duplicateCount = outcomes.filter((o) => o.status === ProofStatus.DUPLICATE).length;
    expect(settledCount).to.equal(1);
    expect(duplicateCount).to.equal(2);

    const fee = await settlement.attributionFeePerExecution();
    expect(await settlement.claimable(modelOwner.address)).to.equal(fee);
  });

  it("economic outcome is identical regardless of which relayer wins the race", async () => {
    // Run the race twice against independent graphs and confirm the
    // credited recipient/amount depends only on registry state, never on
    // relayer identity, timing, or who happened to win.
    const { execRegistry, providerSigner, modelId, commitment, verifier, makeSubmitter, relayerA, relayerB, settlement, modelOwner } =
      await loadFixture(fixture);

    for (let round = 0; round < 2; round++) {
      const { proof, signature } = await buildAndSignProof(execRegistry, providerSigner, modelId, commitment, 1n);
      const verification = await verifier.verify({ proof, signature });
      if (!verification.ok) throw new Error("expected valid proof");

      // Alternate who "wins" by staggering start order — outcome should
      // not depend on it.
      const submitters = round % 2 === 0 ? [makeSubmitter(relayerA), makeSubmitter(relayerB)] : [makeSubmitter(relayerB), makeSubmitter(relayerA)];
      await Promise.all(submitters.map((s) => s.submit(proof, signature, verification.usage)));
    }

    const fee = await settlement.attributionFeePerExecution();
    expect(await settlement.claimable(modelOwner.address)).to.equal(fee * 2n); // one credit per round, always to modelOwner
  });

  it("neither relayer can redirect the recipient or alter the amount, win or lose", async () => {
    const { execRegistry, providerSigner, modelId, commitment, verifier, makeSubmitter, relayerA, relayerB, settlement, modelOwner } =
      await loadFixture(fixture);
    const { proof, signature } = await buildAndSignProof(execRegistry, providerSigner, modelId, commitment, 1n);
    const verification = await verifier.verify({ proof, signature });
    if (!verification.ok) throw new Error("expected valid proof");

    await Promise.all([
      makeSubmitter(relayerA).submit(proof, signature, verification.usage),
      makeSubmitter(relayerB).submit(proof, signature, verification.usage),
    ]);

    // Neither relayerA nor relayerB — the actual transaction senders —
    // ever appear as a credited recipient. Only the registered model
    // owner does.
    expect(await settlement.claimable(relayerA.address)).to.equal(0);
    expect(await settlement.claimable(relayerB.address)).to.equal(0);
    const fee = await settlement.attributionFeePerExecution();
    expect(await settlement.claimable(modelOwner.address)).to.equal(fee);
  });
});
