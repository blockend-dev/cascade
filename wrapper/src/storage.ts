import { Indexer } from "@0gfoundation/0g-storage-ts-sdk";
import { DownloadResult, StorageClient } from "./types";

/**
 * Wraps `@0gfoundation/0g-storage-ts-sdk`'s `Indexer.download`, confirmed
 * against its published type definitions (ADR 0011):
 *
 *   download(rootHash: string, filePath: string, proof?: boolean): Promise<Error | null>
 *
 * `proof: true` is not optional here — it's the SDK's own Merkle-proof
 * verification during download, and it is the entire verification
 * mechanism this wrapper relies on. This class does not, and must not,
 * attempt its own re-derivation of 0G Storage's chunk/tree hashing — that
 * algorithm has not been confirmed from primary source in this
 * repository's research, and guessing at it would be exactly the mistake
 * prior phases were built to avoid.
 */
export class ZgStorageClient implements StorageClient {
  private readonly indexer: Indexer;

  constructor(indexerUrl: string) {
    this.indexer = new Indexer(indexerUrl);
  }

  async downloadVerified(rootHash: string, outputPath: string): Promise<DownloadResult> {
    const err = await this.indexer.download(rootHash, outputPath, true);
    if (err !== null) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    return { ok: true };
  }
}
