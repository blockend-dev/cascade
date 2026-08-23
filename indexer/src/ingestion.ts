import { ethers } from "ethers";

/**
 * INGESTION — reads blockchain logs. Nothing in this module decodes an
 * event, applies a projection, or knows what a "Cascade event" even is;
 * that's normalize.ts and projection.ts's job respectively. This module
 * only knows how to turn an address list + block range into raw
 * `ethers.Log`s and the block timestamps they need.
 */

export interface RawLogBatch {
  logs: ethers.Log[];
  blockTimestamps: Map<number, number>;
}

/** Fetches every log from `addresses` in `[fromBlock, toBlock]`
 *  (inclusive) in one `eth_getLogs` call — not one call per contract
 *  address, avoiding an N+1 request pattern per chunk — plus the block
 *  timestamp for each distinct block number touched, fetched once per
 *  block rather than once per log. */
export async function fetchRawLogs(
  provider: ethers.Provider,
  addresses: string[],
  fromBlock: number,
  toBlock: number
): Promise<RawLogBatch> {
  if (fromBlock > toBlock) return { logs: [], blockTimestamps: new Map() };

  const logs = await provider.getLogs({ address: addresses, fromBlock, toBlock });
  const blockTimestamps = await fetchBlockTimestamps(provider, Array.from(new Set(logs.map((l) => l.blockNumber))));
  return { logs, blockTimestamps };
}

async function fetchBlockTimestamps(provider: ethers.Provider, blockNumbers: number[]): Promise<Map<number, number>> {
  const timestamps = new Map<number, number>();
  await Promise.all(
    blockNumbers.map(async (bn) => {
      const block = await provider.getBlock(bn);
      timestamps.set(bn, block ? Number(block.timestamp) : 0);
    })
  );
  return timestamps;
}
