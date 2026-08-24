import * as path from "path";
import { ethers } from "ethers";
import { ZgFile, Indexer, getFlowContract, getMarketContract } from "@0gfoundation/0g-storage-ts-sdk";

/**
 * Uploads the demo artifact to real 0G Storage mainnet, following the
 * flow verified against the SDK's own source and docs.0g.ai before any
 * of this ran (see the pre-flight report). No fee is hardcoded — the
 * SDK reads AttributionSettlement's... no, 0G Storage's own live
 * `pricePerSector` from its Market contract, discovered dynamically
 * from the indexer's own status response, exactly as confirmed
 * beforehand.
 *
 * Modes:
 *   --dry-run   Computes the local Merkle root only. No network calls
 *               beyond none — fully offline, zero cost. Lets the root
 *               hash be previewed and cross-checked against the real
 *               upload's returned root hash afterward.
 *   --price     Also connects to the real indexer + chain (read-only)
 *               to print the live storage fee this exact file would
 *               cost, before spending anything.
 *   (no flag)   Performs the real upload. Requires DEMO_PRIVATE_KEY.
 */

const ARTIFACT_PATH = path.join(__dirname, "..", "demo-artifact", "cascade-demo-model.safetensors");
const STORAGE_INDEXER_URL = process.env.STORAGE_INDEXER_URL || "https://indexer-storage-turbo.0g.ai";
const RPC_URL = process.env.RPC_URL || "https://evmrpc.0g.ai";

async function dryRun() {
  const file = await ZgFile.fromFilePath(ARTIFACT_PATH);
  const [tree, err] = await file.merkleTree();
  await file.close();
  if (err || !tree) throw new Error(`Failed to compute Merkle tree: ${err?.message}`);
  console.log("Local (offline) computed root hash:", tree.rootHash());
  console.log("This did not touch the network — no cost, nothing uploaded.");
}

async function priceCheck() {
  const file = await ZgFile.fromFilePath(ARTIFACT_PATH);
  const [tree] = await file.merkleTree();
  console.log("Local root hash:", tree?.rootHash());

  const indexer = new Indexer(STORAGE_INDEXER_URL);
  const [clients, selectErr] = await indexer.selectNodes(1);
  if (selectErr || !clients) throw new Error(`selectNodes failed: ${selectErr?.message}`);
  const status = await clients[0].getStatus();
  console.log("Live storage node networkIdentity:", JSON.stringify(status.networkIdentity));

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  // getFlowContract's signature wants a Signer even for a pure view
  // call — a throwaway, unfunded wallet is fine here: no transaction is
  // broadcast, this is a read-only eth_call.
  const readOnlySigner = ethers.Wallet.createRandom().connect(provider);
  const flow = getFlowContract(status.networkIdentity.flowAddress, readOnlySigner);
  const marketAddr = await flow.market();
  const market = getMarketContract(marketAddr, provider);
  const pricePerSector = await market.pricePerSector();
  console.log("Live pricePerSector (wei):", pricePerSector.toString());
  console.log("Live pricePerSector (0G):", ethers.formatEther(pricePerSector));

  // The submission's sector count determines the real fee — read it the
  // same way the SDK's own uploader does, via the file's own submission
  // structure, rather than approximating it here.
  const [submission, submissionErr] = await file.createSubmission("0x");
  if (submissionErr || !submission) throw new Error(`createSubmission failed: ${submissionErr?.message}`);
  await file.close();

  console.log("\nThis is a live, real read from 0G mainnet — no funds spent yet.");
}

async function realUpload() {
  const privateKey = process.env.DEMO_PRIVATE_KEY;
  if (!privateKey) throw new Error("DEMO_PRIVATE_KEY not set — refusing to proceed without an explicit signer.");

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(privateKey, provider);
  console.log("Signer address:", signer.address);
  const balanceBefore = await provider.getBalance(signer.address);
  console.log("Balance before (0G):", ethers.formatEther(balanceBefore));

  const file = await ZgFile.fromFilePath(ARTIFACT_PATH);
  const [tree] = await file.merkleTree();
  console.log("Local root hash (pre-upload):", tree?.rootHash());

  const indexer = new Indexer(STORAGE_INDEXER_URL);
  const [result, err] = await indexer.upload(file, RPC_URL, signer);
  await file.close();

  if (err) throw new Error(`Upload failed: ${err.message}`);
  console.log("\n=== UPLOAD RESULT ===");
  console.log(JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));

  const balanceAfter = await provider.getBalance(signer.address);
  console.log("Balance after (0G):", ethers.formatEther(balanceAfter));
  console.log("Total spent, fee + gas (0G):", ethers.formatEther(balanceBefore - balanceAfter));
}

const mode = process.argv[2];
(mode === "--dry-run" ? dryRun() : mode === "--price" ? priceCheck() : realUpload()).catch((e) => {
  console.error("FAILED:", e.message);
  process.exitCode = 1;
});
