import { ethers } from "ethers";

/**
 * Thin wrapper around `contract.queryFilter` — exists so callers don't
 * need to reach into ethers' filter-construction API directly for the
 * common case of "all events of this name, optionally narrowed by
 * indexed args, in this block range."
 *
 * Deliberately operates on a single raw `ethers.Contract` (e.g.
 * `client.contracts.cascadeRegistry`) rather than the bundled
 * `Contracts` object every read/write/usage function takes — event
 * queries are inherently per-contract, and forcing this into that
 * uniform shape would just mean picking one contract out of the bundle
 * internally anyway. Not part of `client.read` for the same reason;
 * call it directly: `queryEvents(client.contracts.cascadeRegistry, "ModelRegistered")`.
 */
export async function queryEvents(
  contract: ethers.Contract,
  eventName: string,
  filterArgs: unknown[] = [],
  fromBlock?: ethers.BlockTag,
  toBlock?: ethers.BlockTag
): Promise<ethers.EventLog[]> {
  const filter = contract.filters[eventName](...filterArgs);
  const logs = await contract.queryFilter(filter, fromBlock, toBlock);
  return logs.filter((l): l is ethers.EventLog => "args" in l);
}
