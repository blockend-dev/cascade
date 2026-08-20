import * as http from "node:http";
import { logger } from "./logger";
import { SignedUsageProof, UsageProofSource } from "./types";

const MAX_BODY_BYTES = 16 * 1024; // usage proofs are small, fixed-shape objects — no reason to accept more

/**
 * First concrete UsageProofSource: a plain HTTP POST endpoint. No
 * framework dependency (Node's http module is enough for one route) — see
 * docs/relayer.md "Source of usage proofs" for why Phase 9's indexer is
 * explicitly not built here. Swapping this for a queue/file/poll-based
 * source later means implementing the same two-method interface, nothing
 * about verification or submission changes.
 *
 * Treats every request body as hostile: size-capped, JSON-parsed inside a
 * try/catch, and never echoed back into logs verbatim (a malformed body
 * is logged by length and error only, not by content, avoiding both log
 * injection and accidental disclosure of anything sensitive a caller
 * mistakenly includes).
 */
export class HttpUsageProofSource implements UsageProofSource {
  private server?: http.Server;

  constructor(private readonly port: number) {}

  async start(onProof: (signed: SignedUsageProof) => void): Promise<void> {
    this.server = http.createServer((req, res) => {
      if (req.method !== "POST" || req.url !== "/proofs") {
        res.writeHead(404).end();
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
            logger.warn("proof_ingestion_rejected", { reason: "body too large", bytes: received });
            // Respond and let the connection close naturally once the
            // client finishes writing — destroying the socket mid-upload
            // races the client and can surface as a raw connection reset
            // instead of a clean 413. Chunks are already not being
            // collected past this point, so there's no unbounded growth
            // in our own memory regardless of how much more arrives.
            res.writeHead(413, { Connection: "close" }).end();
          }
          return;
        }
        chunks.push(chunk);
      });

      req.on("end", () => {
        if (aborted) return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch (err) {
          logger.warn("proof_ingestion_rejected", { reason: "invalid JSON" });
          res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "invalid JSON" }));
          return;
        }
        // Structural/cryptographic/on-chain validation happens downstream
        // in Verifier — this boundary only guarantees "parseable JSON,
        // bounded size" before handing off.
        logger.debug("proof_received", {});
        onProof(parsed as SignedUsageProof);
        res.writeHead(202, { "Content-Type": "application/json" }).end(JSON.stringify({ accepted: true }));
      });

      req.on("error", () => {
        // client disconnected mid-body — nothing to do
      });
    });

    await new Promise<void>((resolve) => this.server!.listen(this.port, resolve));
    logger.info("ingestion_started", { port: this.port });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve, reject) => {
      this.server!.close((err) => (err ? reject(err) : resolve()));
    });
    logger.info("ingestion_stopped", {});
  }
}
