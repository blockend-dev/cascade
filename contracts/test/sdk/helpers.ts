import { ethers } from "hardhat";
import { CascadeAddresses } from "../../../sdk/src/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyContract = any;

export function randomHash(): string {
  return ethers.keccak256(ethers.randomBytes(32));
}

export async function deployCascadeStack(): Promise<{
  addresses: CascadeAddresses;
  contracts: {
    cascadeRegistry: AnyContract;
    executionRegistry: AnyContract;
    attributionSettlement: AnyContract;
    trainingProvenanceRegistry: AnyContract;
  };
  owner: AnyContract;
  resolver: AnyContract;
  signers: AnyContract[];
}> {
  const signers = await ethers.getSigners();
  const [owner, resolver] = signers;

  const CascadeFactory = await ethers.getContractFactory("CascadeRegistry");
  const cascadeRegistry: AnyContract = await CascadeFactory.deploy(resolver.address);
  await cascadeRegistry.waitForDeployment();

  const ExecFactory = await ethers.getContractFactory("ExecutionRegistry");
  const executionRegistry: AnyContract = await ExecFactory.deploy(await cascadeRegistry.getAddress());
  await executionRegistry.waitForDeployment();

  const SettlementFactory = await ethers.getContractFactory("AttributionSettlement");
  const attributionSettlement: AnyContract = await SettlementFactory.deploy(
    await cascadeRegistry.getAddress(),
    await executionRegistry.getAddress()
  );
  await attributionSettlement.waitForDeployment();

  const ProvenanceFactory = await ethers.getContractFactory("TrainingProvenanceRegistry");
  const trainingProvenanceRegistry: AnyContract = await ProvenanceFactory.deploy(
    await cascadeRegistry.getAddress(),
    await executionRegistry.getAddress()
  );
  await trainingProvenanceRegistry.waitForDeployment();

  const addresses: CascadeAddresses = {
    cascadeRegistry: await cascadeRegistry.getAddress(),
    executionRegistry: await executionRegistry.getAddress(),
    attributionSettlement: await attributionSettlement.getAddress(),
    trainingProvenanceRegistry: await trainingProvenanceRegistry.getAddress(),
  };

  return {
    addresses,
    contracts: { cascadeRegistry, executionRegistry, attributionSettlement, trainingProvenanceRegistry },
    owner,
    resolver,
    signers: signers.slice(2),
  };
}
