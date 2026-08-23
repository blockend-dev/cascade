/**
 * Minimal structured JSON logger — same pattern as
 * relayer/src/logger.ts and wrapper's own equivalent (no shared code
 * across packages here; each package is independently runnable, per
 * this repository's convention). Enough for this phase's observability
 * needs (docs/indexer.md §11): no external dependency.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  [key: string]: string | number | boolean | null | undefined;
}

function log(level: LogLevel, event: string, fields: LogFields = {}): void {
  const line = JSON.stringify({ level, event, ts: new Date().toISOString(), ...fields });
  if (level === "error") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

export const logger = {
  debug: (event: string, fields?: LogFields) => log("debug", event, fields),
  info: (event: string, fields?: LogFields) => log("info", event, fields),
  warn: (event: string, fields?: LogFields) => log("warn", event, fields),
  error: (event: string, fields?: LogFields) => log("error", event, fields),
};
