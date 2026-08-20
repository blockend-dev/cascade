import { ethers } from "ethers";

/**
 * Abstraction boundary for the relayer's transaction-signing key. The
 * relayer only ever needs an ethers.Signer — how that signer is backed
 * (a raw private key in dev, a KMS/HSM/remote-signing service in
 * production) is deliberately not this module's concern. Swapping the
 * implementation never requires touching submitter.ts or relayer.ts.
 *
 * Phase 5 does not build HSM/KMS integration itself (no such
 * infrastructure exists elsewhere in this repository yet) — this
 * function is the seam where it would plug in later.
 */
export function createSigner(privateKey: string | undefined, provider: ethers.Provider): ethers.Signer {
  if (!privateKey) {
    throw new Error(
      "No signer configured. Set RELAYER_PRIVATE_KEY for development, or wire an external signer " +
        "(KMS/HSM) into createSigner() here for production — the rest of the relayer only depends " +
        "on the ethers.Signer interface, not on how it's backed."
    );
  }
  return new ethers.Wallet(privateKey, provider);
}
