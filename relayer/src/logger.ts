/**
 * Minimal structured JSON logger. No external dependency — this is the
 * entire observability stack Phase 5 needs; see docs/relayer.md
 * "Observability" for why a bigger stack wasn't introduced.
 *
 * Redaction is deliberate and load-bearing: never log a private key,
 * signature-signing material, or raw request bodies that might carry
 * user content. Fields are allow-listed per call site rather than
 * blocklisted, so a new caller can't accidentally leak something by
 * forgetting to redact it.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  [key: string]: string | number | boolean | null | undefined;
}

const REDACTED = "[redacted]";
const SENSITIVE_KEYS = new Set(["privateKey", "private_key", "secret", "signature", "signingKey"]);

function redact(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = SENSITIVE_KEYS.has(key) ? REDACTED : value;
  }
  return out;
}

function emit(level: LogLevel, event: string, fields: LogFields = {}) {
  const record = {
    ts: new Date().toISOString(),
    level,
    event,
    ...redact(fields),
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(record));
}

export const logger = {
  debug: (event: string, fields?: LogFields) => emit("debug", event, fields),
  info: (event: string, fields?: LogFields) => emit("info", event, fields),
  warn: (event: string, fields?: LogFields) => emit("warn", event, fields),
  error: (event: string, fields?: LogFields) => emit("error", event, fields),
};
