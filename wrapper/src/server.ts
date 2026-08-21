import * as http from "node:http";
import { ChatCompletionRequest, ModelBackend } from "./types";

const MAX_BODY_BYTES = 1 * 1024 * 1024;

/**
 * Minimal OpenAI-compatible HTTP surface — 0G's documented provider
 * requirement is exactly "implement the OpenAI API Interface for
 * compatibility" (ADR 0011), nothing more specific about framework or
 * routing beyond that. `POST /v1/chat/completions` is the one endpoint
 * implemented; a production backend would extend this, not replace the
 * verify-then-serve gate around it.
 *
 * Critically: this function is only ever called by index.ts *after* a
 * verified model load succeeds. There is no code path that starts this
 * server first and loads the model later — see index.ts.
 */
export function startServer(backend: ModelBackend, port: number): http.Server {
  if (!backend.ready) {
    // Defense in depth — index.ts already guarantees this, but a server
    // that could accidentally be started against an unloaded backend
    // would defeat the entire fail-closed guarantee.
    throw new Error("startServer called before the model backend finished a verified load");
  }

  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
      res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "not found" }));
      return;
    }

    let received = 0;
    const chunks: Buffer[] = [];
    let aborted = false;

    req.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > MAX_BODY_BYTES) {
        if (!aborted) {
          aborted = true;
          res.writeHead(413, { Connection: "close" }).end();
        }
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (aborted) return;
      void handleChatCompletion(backend, chunks, res);
    });
  });

  server.listen(port);
  return server;
}

async function handleChatCompletion(
  backend: ModelBackend,
  chunks: Buffer[],
  res: http.ServerResponse
): Promise<void> {
  let request: ChatCompletionRequest;
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || !Array.isArray(parsed.messages)) {
      throw new Error("body must be an object with a messages array");
    }
    request = parsed as ChatCompletionRequest;
  } catch (err) {
    res
      .writeHead(400, { "Content-Type": "application/json" })
      .end(JSON.stringify({ error: `invalid request: ${err instanceof Error ? err.message : String(err)}` }));
    return;
  }

  try {
    const completion = await backend.complete(request);
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(completion));
  } catch (err) {
    res
      .writeHead(500, { "Content-Type": "application/json" })
      .end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  }
}
