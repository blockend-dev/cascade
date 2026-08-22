import { ethers } from "ethers";

/**
 * Minimal transaction helper — waits for a receipt and throws a clear
 * error on revert. Deliberately does not retry, bump gas, or handle
 * dropped/replaced transactions: that operational robustness is
 * `relayer/`'s job (see docs/relayer.md "Transaction management"), not
 * this SDK's. Use this for scripts, tests, and simple integrations; use
 * the relayer for anything production-grade submitting usage proofs at
 * scale.
 */
export async function sendAndWait(
  txPromise: Promise<ethers.ContractTransactionResponse>,
  confirmations = 1
): Promise<ethers.ContractTransactionReceipt> {
  const tx = await txPromise;
  const receipt = await tx.wait(confirmations);
  if (!receipt || receipt.status !== 1) {
    throw new Error(`Transaction ${tx.hash} did not confirm successfully`);
  }
  return receipt;
}
