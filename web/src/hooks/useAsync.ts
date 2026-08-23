import { useEffect, useState } from "react";

export type AsyncState<T> =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "ready"; data: T };

/** Minimal async-fetch hook — deliberately not a caching/query library
 *  (ADR 0015: no new state-management dependency). Re-runs whenever
 *  `deps` changes; guards against setting state after unmount/stale
 *  requests via a per-call cancellation flag. */
export function useAsync<T>(fn: () => Promise<T>, deps: React.DependencyList): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fn()
      .then((data) => !cancelled && setState({ status: "ready", data }))
      .catch((error) => !cancelled && setState({ status: "error", error }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
