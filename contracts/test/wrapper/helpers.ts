import { ethers } from "hardhat";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyContract = any;

export function randomHash(): string {
  return ethers.keccak256(ethers.randomBytes(32));
}

export async function deployCascadeRegistry() {
  const [owner, resolver, ...rest] = await ethers.getSigners();
  const CascadeFactory = await ethers.getContractFactory("CascadeRegistry");
  const cascadeRegistry: AnyContract = await CascadeFactory.deploy(resolver.address);
  await cascadeRegistry.waitForDeployment();
  return { cascadeRegistry, owner, resolver, signers: rest };
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
