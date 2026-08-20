/** Bounded exponential backoff with jitter. Never used for a permanently
 *  invalid proof — see submitter.ts, which classifies failures before
 *  deciding whether this function is even called. */
export function backoffDelayMs(attempt: number, baseMs: number, maxMs: number): number {
  const exponential = baseMs * 2 ** attempt;
  const capped = Math.min(exponential, maxMs);
  const jitter = Math.random() * capped * 0.5; // up to +50% jitter, avoids thundering-herd resubmission
  return Math.floor(capped * 0.5 + jitter);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
