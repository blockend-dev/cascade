import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import {
  ModelNotActiveError,
  ModelNotFoundError,
  VerificationFailedError,
  verifyAndLoad,
} from "../../../wrapper/src/lifecycle";
import { DownloadResult, ModelBackend, StorageClient, WrapperConfig } from "../../../wrapper/src/types";
import { deployCascadeRegistry, randomHash, registerModel } from "./helpers";

class FakeStorageClient implements StorageClient {
  public calls: Array<{ rootHash: string; outputPath: string }> = [];
  constructor(private readonly behavior: (rootHash: string) => DownloadResult) {}

  async downloadVerified(rootHash: string, outputPath: string): Promise<DownloadResult> {
    this.calls.push({ rootHash, outputPath });
    return this.behavior(rootHash);
  }
}

class FakeModelBackend implements ModelBackend {
  public loadedPath: string | null = null;
  public loadCount = 0;
  private failLoad: string | null = null;
  ready = false;

  constructor(failLoad: string | null = null) {
    this.failLoad = failLoad;
  }

  async load(modelPath: string): Promise<void> {
    this.loadCount++;
    if (this.failLoad) throw new Error(this.failLoad);
    this.loadedPath = modelPath;
    this.ready = true;
  }

  async complete(): Promise<never> {
    throw new Error("not used in these tests");
  }
}

async function fixture() {
  const stack = await deployCascadeRegistry();
  const modelOwner = stack.signers[0];
  const { modelId, commitment } = await registerModel(stack.cascadeRegistry, modelOwner);
  return { ...stack, modelOwner, modelId, commitment };
}

function baseConfig(cascadeRegistryAddress: string, modelId: string): WrapperConfig {
  return {
    rpcUrl: "unused-in-tests",
    cascadeRegistryAddress,
    modelId,
    storageIndexerUrl: "unused-in-tests",
    httpPort: 0,
    cacheDir: "/tmp/cascade-wrapper-test-cache",
  };
}

describe("wrapper lifecycle: verifyAndLoad", () => {
  it("downloads exactly the registered commitment — never a separately-configured value — and loads it", async () => {
    const { cascadeRegistry, modelId, commitment } = await loadFixture(fixture);
    const config = baseConfig(await cascadeRegistry.getAddress(), modelId);
    const storage = new FakeStorageClient(() => ({ ok: true }));
    const backend = new FakeModelBackend();

    const result = await verifyAndLoad(config, ethers.provider, storage, backend);

    expect(result.modelCommitment).to.equal(commitment);
    expect(storage.calls.length).to.equal(1);
    expect(storage.calls[0].rootHash).to.equal(commitment); // the registered value, not a config field
    expect(backend.ready).to.equal(true);
    expect(backend.loadedPath).to.equal(result.modelPath);
  });

  it("fails closed if the modelId was never registered", async () => {
    const { cascadeRegistry } = await loadFixture(fixture);
    const config = baseConfig(await cascadeRegistry.getAddress(), randomHash());
    const storage = new FakeStorageClient(() => ({ ok: true }));
    const backend = new FakeModelBackend();

    await expect(verifyAndLoad(config, ethers.provider, storage, backend)).to.be.rejectedWith(ModelNotFoundError);
    expect(backend.loadCount).to.equal(0); // never reached load — failed before it
  });

  it("fails closed if the model has been revoked", async () => {
    const { cascadeRegistry, modelOwner, modelId } = await loadFixture(fixture);
    await cascadeRegistry.connect(modelOwner).revokeModel(modelId);
    const config = baseConfig(await cascadeRegistry.getAddress(), modelId);
    const storage = new FakeStorageClient(() => ({ ok: true }));
    const backend = new FakeModelBackend();

    await expect(verifyAndLoad(config, ethers.provider, storage, backend)).to.be.rejectedWith(ModelNotActiveError);
    expect(backend.loadCount).to.equal(0);
  });

  it("fails closed if 0G Storage download/proof verification fails — never falls back to loading anyway", async () => {
    const { cascadeRegistry, modelId } = await loadFixture(fixture);
    const config = baseConfig(await cascadeRegistry.getAddress(), modelId);
    const storage = new FakeStorageClient(() => ({ ok: false, error: "proof verification failed" }));
    const backend = new FakeModelBackend();

    await expect(verifyAndLoad(config, ethers.provider, storage, backend)).to.be.rejectedWith(
      VerificationFailedError
    );
    expect(backend.loadCount).to.equal(0); // download failed before load was ever attempted
  });

  it("propagates a backend load failure rather than reporting success", async () => {
    const { cascadeRegistry, modelId } = await loadFixture(fixture);
    const config = baseConfig(await cascadeRegistry.getAddress(), modelId);
    const storage = new FakeStorageClient(() => ({ ok: true }));
    const backend = new FakeModelBackend("simulated backend load failure");

    await expect(verifyAndLoad(config, ethers.provider, storage, backend)).to.be.rejectedWith(
      "simulated backend load failure"
    );
    expect(backend.ready).to.equal(false);
  });

  it("two wrapper instances configured for the same modelId always request the same commitment — no per-instance override exists", async () => {
    const { cascadeRegistry, modelId, commitment } = await loadFixture(fixture);
    const config = baseConfig(await cascadeRegistry.getAddress(), modelId);
    const storageA = new FakeStorageClient(() => ({ ok: true }));
    const storageB = new FakeStorageClient(() => ({ ok: true }));

    await verifyAndLoad(config, ethers.provider, storageA, new FakeModelBackend());
    await verifyAndLoad(config, ethers.provider, storageB, new FakeModelBackend());

    expect(storageA.calls[0].rootHash).to.equal(commitment);
    expect(storageB.calls[0].rootHash).to.equal(commitment);
  });

  it("downloading a different registered model's commitment is impossible without changing config.modelId (no runtime override path exists)", async () => {
    const { cascadeRegistry, modelOwner, modelId, commitment } = await loadFixture(fixture);
    const other = await registerModel(cascadeRegistry, modelOwner);
    expect(other.commitment).to.not.equal(commitment);

    const config = baseConfig(await cascadeRegistry.getAddress(), modelId); // still the original modelId
    const storage = new FakeStorageClient(() => ({ ok: true }));
    const result = await verifyAndLoad(config, ethers.provider, storage, new FakeModelBackend());

    expect(result.modelCommitment).to.equal(commitment);
    expect(result.modelCommitment).to.not.equal(other.commitment);
  });
});
