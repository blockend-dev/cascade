import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { ZgStorageClient } from "../src/storage";

/**
 * Verifies the real upload round-trip using the EXISTING production
 * download path (wrapper/src/storage.ts's ZgStorageClient) — the same
 * code the wrapper itself uses at runtime, not a separate one-off
 * download implementation. Downloads the just-uploaded root hash to a
 * separate output path and confirms byte-for-byte equality with the
 * original artifact.
 */

const ROOT_HASH = process.argv[2];
if (!ROOT_HASH) {
  console.error("Usage: verify-download.ts <rootHash>");
  process.exit(1);
}

const ORIGINAL_PATH = path.join(__dirname, "..", "demo-artifact", "cascade-demo-model.safetensors");
const DOWNLOADED_PATH = path.join(__dirname, "..", "demo-artifact", "cascade-demo-model.downloaded.safetensors");
const STORAGE_INDEXER_URL = process.env.STORAGE_INDEXER_URL || "https://indexer-storage-turbo.0g.ai";

function sha256(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

async function main() {
  if (fs.existsSync(DOWNLOADED_PATH)) fs.unlinkSync(DOWNLOADED_PATH);

  const client = new ZgStorageClient(STORAGE_INDEXER_URL);
  console.log(`Downloading ${ROOT_HASH} (with Merkle-proof verification) to ${DOWNLOADED_PATH}...`);
  const result = await client.downloadVerified(ROOT_HASH, DOWNLOADED_PATH);

  if (!result.ok) {
    console.error("Download+verify FAILED:", result.error);
    process.exitCode = 1;
    return;
  }
  console.log("Download+proof-verification: OK");

  const originalHash = sha256(ORIGINAL_PATH);
  const downloadedHash = sha256(DOWNLOADED_PATH);
  console.log("Original  SHA256:", originalHash);
  console.log("Downloaded SHA256:", downloadedHash);

  const originalBytes = fs.readFileSync(ORIGINAL_PATH);
  const downloadedBytes = fs.readFileSync(DOWNLOADED_PATH);
  const identical = originalHash === downloadedHash && originalBytes.equals(downloadedBytes) && originalBytes.length === downloadedBytes.length;

  console.log(`Original size: ${originalBytes.length} bytes, Downloaded size: ${downloadedBytes.length} bytes`);
  console.log(identical ? "\n✓ BYTE-FOR-BYTE IDENTICAL — round trip verified." : "\n✗ MISMATCH — round trip NOT verified.");
  if (!identical) process.exitCode = 1;
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exitCode = 1;
});
