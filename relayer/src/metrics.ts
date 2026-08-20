/** The small, fixed set of counters docs/relayer.md's Observability
 *  section asks for. No metrics backend/exporter — see that doc for why
 *  a bigger stack wasn't introduced for Phase 5. A production deployment
 *  can scrape `snapshot()` on an interval into whatever it already uses. */
export class Metrics {
  private counters: Record<string, number> = {
    proofsReceived: 0,
    proofsRejected: 0,
    proofsSettled: 0,
    proofsDuplicate: 0,
    transactionFailures: 0,
    retries: 0,
  };

  inc(name: string): void {
    this.counters[name] = (this.counters[name] ?? 0) + 1;
  }

  snapshot(): Record<string, number> {
    return { ...this.counters };
  }
}
