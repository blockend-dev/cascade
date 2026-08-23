import { useCallback, useState } from "react";
import { useWallet } from "../wallet/WalletContext";
import { describeError, FriendlyError } from "../errors";

export type TxState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "confirmed"; hash: string }
  | { status: "failed"; error: FriendlyError };

/**
 * Wraps one write call from `sdk/src/client.ts`'s `write`/`usage`
 * namespaces with UI-visible lifecycle state. Never marks "confirmed"
 * merely because a hash came back — `action` is expected to be an
 * `async` function that itself awaits the SDK's own confirmation
 * semantics (`sendAndWait`, already used inside every `write.*`/`usage.*`
 * function — this hook does not re-implement or shortcut that).
 */
export function useTx<Args extends unknown[]>(action: (...args: Args) => Promise<{ receipt: { hash: string } } | { hash: string }>) {
  const { client } = useWallet();
  const [state, setState] = useState<TxState>({ status: "idle" });

  const run = useCallback(
    async (...args: Args) => {
      setState({ status: "pending" });
      try {
        const result = await action(...args);
        const hash = "receipt" in result ? result.receipt.hash : result.hash;
        setState({ status: "confirmed", hash });
        return result;
      } catch (err) {
        const friendly = describeError(client, err);
        setState({ status: "failed", error: friendly });
        throw err;
      }
    },
    [action, client]
  );

  const reset = useCallback(() => setState({ status: "idle" }), []);

  return { state, run, reset };
}
