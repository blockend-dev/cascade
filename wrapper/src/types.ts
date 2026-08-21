/**
 * See ADR 0011 for the full architecture. Two boundaries this file exists
 * to keep explicit:
 *
 * 1. StorageClient — the wrapper never re-derives 0G Storage's Merkle
 *    verification itself (the tree/chunking algorithm isn't something
 *    this codebase has confirmed from primary source, and reimplementing
 *    cryptography from an assumption would be exactly the mistake prior
 *    research warned against). Verification is delegated entirely to
 *    `@0gfoundation/0g-storage-ts-sdk`'s own `proof: true` download option
 *    — confirmed from its published type definitions, not inferred.
 * 2. ModelBackend — actually running inference requires GPU/TDX hardware
 *    this environment doesn't have. This interface is the documented
 *    integration seam for a real engine (vLLM, TGI, etc.); the shipped
 *    implementation is a reference stub sufficient to prove the
 *    verify-then-serve lifecycle, not a production inference engine.
 */

export interface DownloadResult {
  ok: boolean;
  error?: string;
}

export interface StorageClient {
  /** Downloads `rootHash` to `outputPath` with Merkle-proof verification
   *  enabled. Must fail closed: any error (network, proof mismatch,
   *  missing file) is reported, never silently ignored. */
  downloadVerified(rootHash: string, outputPath: string): Promise<DownloadResult>;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
}

export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  model: string;
  choices: Array<{
    index: number;
    message: ChatMessage;
    finish_reason: "stop";
  }>;
}

export interface ModelBackend {
  /** Loads the verified model artifact from `modelPath`. Must throw (not
   *  silently no-op) if loading fails — the server must not start serving
   *  on a failed load. */
  load(modelPath: string): Promise<void>;
  /** Serves one OpenAI-compatible chat completion request. */
  complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
  readonly ready: boolean;
}

export interface WrapperConfig {
  rpcUrl: string;
  cascadeRegistryAddress: string;
  /** The CascadeRegistry modelId this wrapper instance is configured to
   *  serve. Fixed for the process lifetime — there is no runtime
   *  model-switching capability, by design (docs/threat-model.md #19-20). */
  modelId: string;
  storageIndexerUrl: string;
  httpPort: number;
  cacheDir: string;
}
