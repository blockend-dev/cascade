import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyContract = any;

export const USAGE_PROOF_TYPES = {
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

export const CHALLENGE_WINDOW_SECONDS = 3 * 24 * 60 * 60;

export function randomHash(): string {
  return ethers.keccak256(ethers.randomBytes(32));
}

export async function domainFor(registryAddress: string) {
  const network = await ethers.provider.getNetwork();
  return { name: "Cascade", version: "1", chainId: network.chainId, verifyingContract: registryAddress };
}

export async function signProof(signer: any, domain: any, proof: Record<string, unknown>) {
  return signer.signTypedData(domain, USAGE_PROOF_TYPES, proof);
}

export async function deployCascadeStack() {
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

export async function registerModel(cascadeRegistry: AnyContract, ownerSigner: any, commitment = randomHash()) {
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

export async function buildAndSignProof(
  execRegistry: AnyContract,
  signer: any,
  modelId: string,
  modelCommitment: string,
  epoch: bigint,
  overrides: Record<string, unknown> = {}
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
    ...overrides,
  };
  const signature = await signProof(signer, domain, proof);
  return { proof, signature };
}

/** Serializes a bigint-bearing UsageProof the way HTTP JSON transport
 *  would — bigints become strings — and back, exercising the same
 *  boundary the relayer's real ingestion path crosses. */
export function throughJson<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v))
  );
}
