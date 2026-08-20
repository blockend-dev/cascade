import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { CascadeRelayer } from "../../../relayer/src/relayer";
import { Submitter } from "../../../relayer/src/submitter";
import { Verifier } from "../../../relayer/src/verifier";
import { HttpUsageProofSource } from "../../../relayer/src/ingestion";
import { ProofStatus } from "../../../relayer/src/types";
import { RelayerConfig } from "../../../relayer/src/config";
import { buildAndSignProof, deployCascadeStack, registerModel, throughJson } from "./helpers";

function testConfig(overrides: Partial<RelayerConfig> = {}): RelayerConfig {
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
    ...overrides,
  };
}

/** A no-op ingestion source — these tests feed proofs directly via
 *  relayer.handle() rather than over HTTP; that boundary is covered
 *  separately in ingestion.test.ts. */
class NullSource {
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
}

async function fixture() {
  const stack = await deployCascadeStack();
  const providerSigner = stack.signers[0];
  const modelOwner = stack.signers[1];
  const relayerSigner = stack.signers[2]; // deliberately distinct from provider and model owner

  await stack.execRegistry.connect(providerSigner).registerSigner(providerSigner.address);
  const { modelId, commitment } = await registerModel(stack.cascadeRegistry, modelOwner);

  const execAddress = await stack.execRegistry.getAddress();
  const settlementAddress = await stack.settlement.getAddress();

  const buildRelayerInstance = () => {
    const submitter = new Submitter(relayerSigner, ethers.provider, settlementAddress, testConfig());
    const verifier = new Verifier(ethers.provider, execAddress, { currentEpoch: () => submitter.currentEpoch() });
    return new CascadeRelayer(verifier, submitter, new NullSource() as any);
  };

  return { ...stack, providerSigner, modelOwner, relayerSigner, modelId, commitment, buildRelayerInstance };
}

describe("CascadeRelayer orchestration", () => {
  it("settles a valid proof end to end and updates metrics", async () => {
    const { execRegistry, providerSigner, modelId, commitment, buildRelayerInstance, settlement, modelOwner } =
      await loadFixture(fixture);
    const relayer = buildRelayerInstance();
    const { proof, signature } = await buildAndSignProof(execRegistry, providerSigner, modelId, commitment, 1n);

    const outcome = await relayer.handle(throughJson({ proof, signature }));
    expect((outcome as any).status).to.equal(ProofStatus.SETTLED);

    const fee = await settlement.attributionFeePerExecution();
    expect(await settlement.claimable(modelOwner.address)).to.equal(fee);
    expect(relayer.getMetrics().proofsSettled).to.equal(1);
  });

  it("rejects malformed input without crashing and records it as rejected, not settled", async () => {
    const { buildRelayerInstance } = await loadFixture(fixture);
    const relayer = buildRelayerInstance();

    const outcome = await relayer.handle({ garbage: true });
    expect((outcome as any).status).to.equal(ProofStatus.REJECTED_MALFORMED);
    expect(relayer.getMetrics().proofsRejected).to.equal(1);
    expect(relayer.getMetrics().proofsSettled).to.equal(0);
  });

  it("a duplicate local delivery of the same proof settles only once", async () => {
    const { execRegistry, providerSigner, modelId, commitment, buildRelayerInstance, settlement, modelOwner } =
      await loadFixture(fixture);
    const relayer = buildRelayerInstance();
    const { proof, signature } = await buildAndSignProof(execRegistry, providerSigner, modelId, commitment, 1n);
    const wire = throughJson({ proof, signature });

    const first = await relayer.handle(wire);
    const second = await relayer.handle(wire); // same proof delivered again, e.g. by a retried HTTP POST

    expect((first as any).status).to.equal(ProofStatus.SETTLED);
    expect([ProofStatus.DUPLICATE, ProofStatus.ALREADY_CONSUMED]).to.include((second as any).status);

    const fee = await settlement.attributionFeePerExecution();
    expect(await settlement.claimable(modelOwner.address)).to.equal(fee); // not fee * 2
  });

  it("survives restart: a fresh relayer instance with empty local state correctly detects an already-settled execution from chain state alone", async () => {
    const { execRegistry, providerSigner, modelId, commitment, buildRelayerInstance, settlement, modelOwner } =
      await loadFixture(fixture);

    const firstProcess = buildRelayerInstance();
    const { proof, signature } = await buildAndSignProof(execRegistry, providerSigner, modelId, commitment, 1n);
    const wire = throughJson({ proof, signature });
    const firstOutcome = await firstProcess.handle(wire);
    expect((firstOutcome as any).status).to.equal(ProofStatus.SETTLED);

    // Simulate a process restart: brand new relayer instance, brand new
    // (empty) ExecutionStore, no memory of the first process's work.
    const secondProcess = buildRelayerInstance();
    const secondOutcome = await secondProcess.handle(wire);

    expect((secondOutcome as any).status).to.equal(ProofStatus.ALREADY_CONSUMED);
    const fee = await settlement.attributionFeePerExecution();
    expect(await settlement.claimable(modelOwner.address)).to.equal(fee); // still exactly one credit
  });

  it("funds settlement with the exact live protocol fee, not a hardcoded value", async () => {
    const { execRegistry, providerSigner, modelId, commitment, buildRelayerInstance, settlement, modelOwner, owner } =
      await loadFixture(fixture);
    await settlement.connect(owner).setAttributionFeePerExecution(12_345n); // deliberately non-default

    const relayer = buildRelayerInstance();
    const { proof, signature } = await buildAndSignProof(execRegistry, providerSigner, modelId, commitment, 1n);
    const outcome = await relayer.handle(throughJson({ proof, signature }));

    expect((outcome as any).status).to.equal(ProofStatus.SETTLED);
    expect(await settlement.claimable(modelOwner.address)).to.equal(12_345n);
  });

  it("the relayer's own signing address never receives attribution", async () => {
    const { execRegistry, providerSigner, modelId, commitment, buildRelayerInstance, settlement, relayerSigner } =
      await loadFixture(fixture);
    const relayer = buildRelayerInstance();
    const { proof, signature } = await buildAndSignProof(execRegistry, providerSigner, modelId, commitment, 1n);
    await relayer.handle(throughJson({ proof, signature }));

    expect(await settlement.claimable(relayerSigner.address)).to.equal(0);
  });

  it("a permanently invalid proof (bad model commitment) never reaches submission", async () => {
    const { execRegistry, providerSigner, modelId, buildRelayerInstance, settlement, modelOwner } = await loadFixture(
      fixture
    );
    const relayer = buildRelayerInstance();
    const { proof, signature } = await buildAndSignProof(execRegistry, providerSigner, modelId, ethers.keccak256("0x00"), 1n);

    const outcome = await relayer.handle(throughJson({ proof, signature }));
    expect((outcome as any).status ?? (outcome as any).ok).to.not.equal(ProofStatus.SETTLED);
    expect(await settlement.claimable(modelOwner.address)).to.equal(0);
  });

  it("an epoch-ineligible proof is not submitted, and does not become permanently unsettleable if the epoch later opens", async () => {
    const { execRegistry, providerSigner, modelId, commitment, buildRelayerInstance, settlement, modelOwner, owner } =
      await loadFixture(fixture);
    const relayer = buildRelayerInstance();
    const { proof, signature } = await buildAndSignProof(execRegistry, providerSigner, modelId, commitment, 2n); // future epoch

    const early = await relayer.handle(throughJson({ proof, signature }));
    expect((early as any).status).to.equal(ProofStatus.EPOCH_NOT_YET_OPEN);
    expect(await settlement.claimable(modelOwner.address)).to.equal(0);

    await settlement.connect(owner).advanceEpoch(); // now epoch 2 is current
    const later = await relayer.handle(throughJson({ proof, signature }));
    expect((later as any).status).to.equal(ProofStatus.SETTLED);
  });
});

describe("HTTP ingestion boundary", () => {
  it("accepts a well-formed proof over HTTP and rejects a malformed one without crashing the server", async () => {
    const port = 18787 + Math.floor(Math.random() * 1000);
    const source = new HttpUsageProofSource(port);
    const received: unknown[] = [];
    await source.start((signed) => received.push(signed));

    try {
      const ok = await fetch(`http://127.0.0.1:${port}/proofs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proof: { modelId: "0x00" }, signature: "0xdead" }),
      });
      expect(ok.status).to.equal(202); // ingestion accepts anything parseable; Verifier does the real rejection
      expect(received.length).to.equal(1);

      const badJson = await fetch(`http://127.0.0.1:${port}/proofs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not json",
      });
      expect(badJson.status).to.equal(400);

      // Server must still be alive after a malformed request.
      const stillAlive = await fetch(`http://127.0.0.1:${port}/proofs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proof: {}, signature: "0x" }),
      });
      expect(stillAlive.status).to.equal(202);
    } finally {
      await source.stop();
    }
  });

  it("rejects an oversized body rather than buffering it unbounded", async () => {
    const port = 19787 + Math.floor(Math.random() * 1000);
    const source = new HttpUsageProofSource(port);
    await source.start(() => {});
    try {
      const huge = "x".repeat(64 * 1024);
      const res = await fetch(`http://127.0.0.1:${port}/proofs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: huge,
      });
      expect(res.status).to.equal(413);
    } finally {
      await source.stop();
    }
  });
});
