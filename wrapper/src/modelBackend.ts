import * as fs from "node:fs";
import { ChatCompletionRequest, ChatCompletionResponse, ModelBackend } from "./types";

/**
 * Reference/stub backend — proves the verify-then-serve lifecycle end to
 * end without requiring GPU/TDX hardware this environment doesn't have.
 * See ADR 0011 and types.ts's header comment: swapping this for a real
 * inference engine (vLLM, TGI, a Python sidecar, etc.) is the documented
 * production integration point. What Cascade actually needs guaranteed —
 * verified-hash-before-load, fail-closed on mismatch, no runtime model
 * switching — lives in index.ts and storage.ts, not here.
 *
 * `load` deliberately reads and hashes the verified artifact's byte
 * length as a trivial, checkable "the file is real and non-empty" smoke
 * test — not a substitute for the SDK's own Merkle verification (already
 * done by the time this is called), just proof this stub genuinely
 * consumed the downloaded artifact rather than ignoring it.
 */
export class StubModelBackend implements ModelBackend {
  private loadedFromPath: string | null = null;
  private byteLength = 0;

  get ready(): boolean {
    return this.loadedFromPath !== null;
  }

  async load(modelPath: string): Promise<void> {
    const stats = await fs.promises.stat(modelPath); // throws if the file doesn't exist — fail closed, not silent
    if (stats.size === 0) {
      throw new Error(`Refusing to load empty model artifact at ${modelPath}`);
    }
    this.byteLength = stats.size;
    this.loadedFromPath = modelPath;
  }

  async complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    if (!this.ready) {
      throw new Error("ModelBackend.complete called before a verified load succeeded");
    }
    const lastUser = [...request.messages].reverse().find((m) => m.role === "user");
    return {
      id: `stub-${Date.now()}`,
      object: "chat.completion",
      model: request.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content:
              `[reference stub — not a real inference engine, see ADR 0011] ` +
              `Serving a verified ${this.byteLength}-byte artifact. Echo: ${lastUser?.content ?? ""}`,
          },
          finish_reason: "stop",
        },
      ],
    };
  }
}
