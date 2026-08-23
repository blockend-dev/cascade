import * as http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { CascadeIndexer } from "./sync";
import * as query from "./query";

/**
 * Plain JSON serialization for the public HTTP boundary — deliberately
 * NOT `serialize.ts`'s `serializeJson`, which wraps bigints in a
 * `{__bigint__: "..."}` round-trip marker meant for this package's own
 * internal storage/replay of `events.payload_json` (a format only this
 * package's own `parseJson` ever reads back). An HTTP API consumed by
 * arbitrary clients (the frontend, or anyone else) gets a plain decimal
 * string instead — the conventional, client-agnostic way to carry a
 * `uint256` through JSON without precision loss, no bespoke unwrapping
 * required on the reading end.
 */
function toJsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = toJsonSafe(v);
    return out;
  }
  return value;
}
function serializeJson(value: unknown): string {
  return JSON.stringify(toJsonSafe(value));
}

/**
 * A thin, read-only HTTP JSON transport over `query.ts` — see ADR 0014
 * for why this exists (a browser cannot import `node:sqlite`). No
 * framework dependency, following the exact precedent
 * `relayer/src/ingestion.ts` and `wrapper/src/server.ts` already
 * established. Every route is an unmodified call into `query.ts`; this
 * file adds zero new query logic, only routing and JSON serialization
 * (bigints as decimal strings, the same convention `serialize.ts`
 * already uses for SQLite storage).
 *
 * Read-only by construction: there is no route that accepts a body or
 * performs a write. A caller cannot use this server to authorize a
 * transaction, however it crafts a request — see the frontend's own
 * threat-model doc (docs/frontend.md) for how the frontend is expected
 * to treat responses from this server (a cache, never an authority).
 */

interface Route {
  method: "GET";
  pattern: RegExp;
  params: string[];
  handler: (db: DatabaseSync, params: Record<string, string>, query: URLSearchParams) => unknown;
}

function paginationOpts(q: URLSearchParams): { limit?: number; cursor?: string } {
  const opts: { limit?: number; cursor?: string } = {};
  const limit = q.get("limit");
  if (limit) opts.limit = Number(limit);
  const cursor = q.get("cursor");
  if (cursor) opts.cursor = cursor;
  return opts;
}

function route(method: "GET", path: string, handler: Route["handler"]): Route {
  const params: string[] = [];
  const pattern = new RegExp(
    "^" +
      path
        .split("/")
        .map((segment) => {
          if (segment.startsWith(":")) {
            params.push(segment.slice(1));
            return "([^/]+)";
          }
          return segment;
        })
        .join("/") +
      "$"
  );
  return { method, pattern, params, handler };
}

function buildRoutes(): Route[] {
  return [
    route("GET", "/models", (db, _p, q) => query.listModels(db, paginationOpts(q))),
    route("GET", "/models/:modelId", (db, p) => query.getModel(db, p.modelId)),
    route("GET", "/models/:modelId/lineage", (db, p) => query.getModelLineage(db, p.modelId)),
    route("GET", "/models/owner/:address", (db, p, q) => query.listModelsByOwner(db, p.address, paginationOpts(q))),
    route("GET", "/edges/:edgeId", (db, p) => query.getEdge(db, p.edgeId)),
    route("GET", "/providers/:address", (db, p) => query.getProvider(db, p.address)),
    route("GET", "/providers/:address/signers", (db, p) => query.getProviderSigners(db, p.address)),
    route("GET", "/providers/:address/executions", (db, p, q) => query.listExecutionsByProvider(db, p.address, paginationOpts(q))),
    route("GET", "/provenance/:modelId", (db, p) => query.getTrainingProvenance(db, p.modelId)),
    route("GET", "/executions/:executionId", (db, p) => query.getExecution(db, p.executionId)),
    route("GET", "/executions/:executionId/attribution", (db, p) => query.getExecutionAttribution(db, p.executionId)),
    route("GET", "/executions/model/:modelId", (db, p, q) => query.listExecutionsByModel(db, p.modelId, paginationOpts(q))),
    route("GET", "/claimable/:address", (db, p) => query.getClaimable(db, p.address)),
    route("GET", "/claims/:address", (db, p) => query.getClaims(db, p.address)),
    route("GET", "/events", (db, _p, q) =>
      query.getEvents(db, {
        contractAddress: q.get("contract") ?? undefined,
        eventName: q.get("eventName") ?? undefined,
        fromBlock: q.get("fromBlock") ? Number(q.get("fromBlock")) : undefined,
        toBlock: q.get("toBlock") ? Number(q.get("toBlock")) : undefined,
        ...paginationOpts(q),
      })
    ),
  ];
}

/** Starts the query server. `getIndexer` is called once per request to
 *  fetch sync status — a function rather than a captured value so the
 *  server always reflects the live indexer, not a snapshot taken at
 *  startup. CORS is permissive (`*`) since this server serves no
 *  cookies/credentials and returns nothing a same-origin policy would
 *  need to protect — every response is already public on-chain data. */
export function startIndexerServer(db: DatabaseSync, getIndexer: () => CascadeIndexer, port: number): http.Server {
  const routes = buildRoutes();

  const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");

    if (req.method !== "GET") {
      res.writeHead(405).end(serializeJson({ error: "method not allowed" }));
      return;
    }

    const url = new URL(req.url ?? "/", "http://internal");

    if (url.pathname === "/sync-status") {
      try {
        const status = await getIndexer().getSyncStatus();
        res.writeHead(200).end(serializeJson(status));
      } catch (err) {
        res.writeHead(502).end(serializeJson({ error: "sync status unavailable", detail: String(err) }));
      }
      return;
    }

    for (const r of routes) {
      const match = url.pathname.match(r.pattern);
      if (!match) continue;
      const params: Record<string, string> = {};
      r.params.forEach((name, i) => (params[name] = decodeURIComponent(match[i + 1])));
      try {
        const result = r.handler(db, params, url.searchParams);
        if (result === null || result === undefined) {
          res.writeHead(404).end(serializeJson({ error: "not found" }));
        } else {
          res.writeHead(200).end(serializeJson(result));
        }
      } catch (err) {
        res.writeHead(500).end(serializeJson({ error: "query failed", detail: String(err) }));
      }
      return;
    }

    res.writeHead(404).end(serializeJson({ error: "not found" }));
  });

  server.listen(port);
  return server;
}
