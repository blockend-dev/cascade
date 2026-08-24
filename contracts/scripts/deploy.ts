import * as fs from "fs";
import * as path from "path";
import { ethers, network } from "hardhat";

/**
 * Production/real-network deployment script for the four Cascade
 * contracts. Deliberately separate from `contracts/test/sdk/helpers.ts`'s
 * `deployCascadeStack()` — that helper exists only for tests, uses
 * Hardhat's auto-generated signers, and picks an arbitrary signer as
 * "resolver" for test convenience. This script never imports it and
 * never shares its assumptions; every value here is either a real
 * constructor dependency read back from a just-deployed contract, or an
 * operator-supplied configuration value (docs/deployment.md).
 *
 * Deployment order is dependency order, not arbitrary — verified
 * directly against each contract's constructor before writing this:
 *
 *   CascadeRegistry(resolver)
 *   ExecutionRegistry(cascadeRegistry)
 *   AttributionSettlement(cascadeRegistry, executionRegistry)
 *   TrainingProvenanceRegistry(cascadeRegistry, executionRegistry)
 *
 * No contract's constructor takes an address that isn't itself the
 * output of an earlier step in this same list. No post-deployment
 * wiring call exists anywhere in these contracts (confirmed by reading
 * all four constructors and their full source) — every cross-contract
 * reference is immutable, set once, at construction.
 */

const CONFIRMATIONS = process.env.CONFIRMATIONS ? Number(process.env.CONFIRMATIONS) : 1;

/** Waits for the configured number of confirmations and returns the
 *  block the deployment transaction actually landed in — recorded in
 *  the deployment JSON specifically so `indexer/.env`'s `START_BLOCK`
 *  can be set exactly, not estimated (a gap found and fixed after this
 *  script's first real deployment: it previously logged an
 *  instruction to "set START_BLOCK to the deployment block" without
 *  ever telling the operator what that block number was). */
async function confirmAndGetBlock(tx: {
  deploymentTransaction(): { wait(confirmations?: number): Promise<{ blockNumber: number } | null> } | null;
}): Promise<number | null> {
  const deploymentTx = tx.deploymentTransaction();
  if (!deploymentTx) return null;
  const receipt = await deploymentTx.wait(Math.max(CONFIRMATIONS, 1));
  return receipt ? receipt.blockNumber : null;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No deployer signer available — check DEPLOYER_PRIVATE_KEY / network accounts config.");

  const resolverEnv = process.env.RESOLVER_ADDRESS;
  const resolver = resolverEnv && resolverEnv.trim() !== "" ? resolverEnv.trim() : deployer.address;
  if (!ethers.isAddress(resolver)) {
    throw new Error(`RESOLVER_ADDRESS is not a valid address: ${resolverEnv}`);
  }
  if (!resolverEnv) {
    console.warn(
      `[deploy] RESOLVER_ADDRESS not set — defaulting the challenge resolver to the deploying account ` +
        `(${deployer.address}). This is a real, documented centralization point (docs/threat-model.md's ` +
        `"Resolver" entry, ADR 0004) — fine for a local/test deployment, not a decision to make silently ` +
        `for a real one. Set RESOLVER_ADDRESS explicitly for anything beyond local/test use.`
    );
  }

  const chainId = (await ethers.provider.getNetwork()).chainId;
  console.log(`Deploying to network "${network.name}" (chainId ${chainId}) as ${deployer.address}`);
  console.log(`Resolver: ${resolver}`);
  console.log(`Confirmations per deployment: ${CONFIRMATIONS}`);

  console.log("\n1/4 Deploying CascadeRegistry...");
  const CascadeRegistryFactory = await ethers.getContractFactory("CascadeRegistry");
  const cascadeRegistry = await CascadeRegistryFactory.deploy(resolver);
  await cascadeRegistry.waitForDeployment();
  const cascadeRegistryBlock = await confirmAndGetBlock(cascadeRegistry);
  const cascadeRegistryAddress = await cascadeRegistry.getAddress();
  console.log(`   CascadeRegistry: ${cascadeRegistryAddress}`);

  console.log("\n2/4 Deploying ExecutionRegistry...");
  const ExecutionRegistryFactory = await ethers.getContractFactory("ExecutionRegistry");
  const executionRegistry = await ExecutionRegistryFactory.deploy(cascadeRegistryAddress);
  await executionRegistry.waitForDeployment();
  await confirmAndGetBlock(executionRegistry);
  const executionRegistryAddress = await executionRegistry.getAddress();
  console.log(`   ExecutionRegistry: ${executionRegistryAddress}`);

  console.log("\n3/4 Deploying AttributionSettlement...");
  const AttributionSettlementFactory = await ethers.getContractFactory("AttributionSettlement");
  const attributionSettlement = await AttributionSettlementFactory.deploy(cascadeRegistryAddress, executionRegistryAddress);
  await attributionSettlement.waitForDeployment();
  await confirmAndGetBlock(attributionSettlement);
  const attributionSettlementAddress = await attributionSettlement.getAddress();
  console.log(`   AttributionSettlement: ${attributionSettlementAddress}`);

  console.log("\n4/4 Deploying TrainingProvenanceRegistry...");
  const TrainingProvenanceRegistryFactory = await ethers.getContractFactory("TrainingProvenanceRegistry");
  const trainingProvenanceRegistry = await TrainingProvenanceRegistryFactory.deploy(cascadeRegistryAddress, executionRegistryAddress);
  await trainingProvenanceRegistry.waitForDeployment();
  await confirmAndGetBlock(trainingProvenanceRegistry);
  const trainingProvenanceRegistryAddress = await trainingProvenanceRegistry.getAddress();
  console.log(`   TrainingProvenanceRegistry: ${trainingProvenanceRegistryAddress}`);

  // ---------------------------------------------------------------------
  // Post-deployment verification — read each cross-contract reference
  // back from chain state and assert it matches what this script just
  // deployed. Catches a wrong-order deploy, a copy-paste address error,
  // or an RPC that silently routed a transaction somewhere unexpected —
  // immediately, not the first time someone tries to use the system.
  // ---------------------------------------------------------------------
  console.log("\nVerifying deployment wiring...");
  const checks: Array<[string, boolean]> = [
    ["CascadeRegistry.resolver() == configured resolver", (await cascadeRegistry.resolver()).toLowerCase() === resolver.toLowerCase()],
    ["ExecutionRegistry.cascadeRegistry() == CascadeRegistry", (await executionRegistry.cascadeRegistry()) === cascadeRegistryAddress],
    ["AttributionSettlement.cascadeRegistry() == CascadeRegistry", (await attributionSettlement.cascadeRegistry()) === cascadeRegistryAddress],
    ["AttributionSettlement.executionRegistry() == ExecutionRegistry", (await attributionSettlement.executionRegistry()) === executionRegistryAddress],
    ["TrainingProvenanceRegistry.cascadeRegistry() == CascadeRegistry", (await trainingProvenanceRegistry.cascadeRegistry()) === cascadeRegistryAddress],
    ["TrainingProvenanceRegistry.executionRegistry() == ExecutionRegistry", (await trainingProvenanceRegistry.executionRegistry()) === executionRegistryAddress],
  ];
  for (const [description, ok] of checks) {
    if (!ok) throw new Error(`Deployment verification failed: ${description}`);
    console.log(`   ✓ ${description}`);
  }

  // ---------------------------------------------------------------------
  // Record the deployment — separate from anything test-only. Never
  // overwrites a prior deployment record for the same network silently.
  // ---------------------------------------------------------------------
  const deployment = {
    network: network.name,
    chainId: chainId.toString(),
    deployer: deployer.address,
    resolver,
    deployedAt: new Date().toISOString(),
    // The earliest of the four deployment blocks (CascadeRegistry's,
    // deployed first) — the correct, exact value for indexer/.env's
    // START_BLOCK, not an estimate.
    deploymentBlock: cascadeRegistryBlock,
    addresses: {
      cascadeRegistry: cascadeRegistryAddress,
      executionRegistry: executionRegistryAddress,
      attributionSettlement: attributionSettlementAddress,
      trainingProvenanceRegistry: trainingProvenanceRegistryAddress,
    },
  };

  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${network.name}.json`);
  if (fs.existsSync(outFile) && network.name !== "hardhat") {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupFile = path.join(outDir, `${network.name}.${stamp}.json`);
    fs.copyFileSync(outFile, backupFile);
    console.log(`\nExisting deployment record found — backed up to ${backupFile}`);
  }
  fs.writeFileSync(outFile, JSON.stringify(deployment, null, 2) + "\n");
  console.log(`\nWrote deployment record: ${outFile}`);

  console.log("\nSupply these to relayer/.env and indexer/.env (unprefixed):");
  console.log(`  CASCADE_REGISTRY_ADDRESS=${deployment.addresses.cascadeRegistry}`);
  console.log(`  EXECUTION_REGISTRY_ADDRESS=${deployment.addresses.executionRegistry}`);
  console.log(`  ATTRIBUTION_SETTLEMENT_ADDRESS=${deployment.addresses.attributionSettlement}`);
  console.log(`  TRAINING_PROVENANCE_REGISTRY_ADDRESS=${deployment.addresses.trainingProvenanceRegistry}`);
  console.log("\nSupply these to web/.env (VITE_-prefixed):");
  console.log(`  VITE_CASCADE_REGISTRY_ADDRESS=${deployment.addresses.cascadeRegistry}`);
  console.log(`  VITE_EXECUTION_REGISTRY_ADDRESS=${deployment.addresses.executionRegistry}`);
  console.log(`  VITE_ATTRIBUTION_SETTLEMENT_ADDRESS=${deployment.addresses.attributionSettlement}`);
  console.log(`  VITE_TRAINING_PROVENANCE_REGISTRY_ADDRESS=${deployment.addresses.trainingProvenanceRegistry}`);
  console.log(`\nAlso set indexer/.env's START_BLOCK=${deployment.deploymentBlock} so backfill doesn't scan from genesis unnecessarily.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
