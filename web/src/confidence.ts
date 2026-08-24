import { ConfidenceLevel } from "../../sdk/src/types";

/**
 * The single source of truth for how confidence values are labeled in
 * this UI. Every component that displays a confidence level imports
 * from here — never hand-writes a label — so the exact wording
 * `docs/protocol-spec.md` §1 establishes can't drift per-component.
 *
 * Never substitute stronger language: "Declared" never becomes
 * "Verified"; "Attested Training" never becomes "Proof of Training";
 * nothing here is ever called "trustless." See docs/frontend.md §3.
 */

export interface ConfidenceInfo {
  level: ConfidenceLevel;
  /** The exact label from docs/protocol-spec.md §1. */
  label: string;
  /** User-facing level number — note this runs in the OPPOSITE
   *  direction from the enum's own ascending-strength ordering; see
   *  protocol-spec.md §1 for why. */
  userFacingLevel: 1 | 2 | 3;
  /** What this level actually establishes. Plain language, no overreach. */
  establishes: string;
  /** What it explicitly does NOT establish. */
  doesNotEstablish: string;
}

export const CONFIDENCE_INFO: Record<ConfidenceLevel, ConfidenceInfo> = {
  [ConfidenceLevel.Declared]: {
    level: ConfidenceLevel.Declared,
    label: "Declared",
    userFacingLevel: 3,
    establishes:
      "The registrant staked a bond and publicly declared this relationship. It survived its challenge window unchallenged, or a challenge against it failed.",
    doesNotEstablish:
      "No cryptographic or attested evidence backs this claim — its credibility is purely economic (the stake at risk), not technical.",
  },
  [ConfidenceLevel.AttestedTraining]: {
    level: ConfidenceLevel.AttestedTraining,
    label: "Attested Training",
    userFacingLevel: 2,
    establishes:
      "A specific, identifiable 0G provider (a registered signer) signed a non-repudiable claim naming a base model, dataset root, training script, and resulting commitment, and that claim's commitments match what's registered on-chain.",
    doesNotEstablish:
      "That the provider's enclave actually computed the declared output from the declared inputs. This is circumstantial, accountable evidence — a real party is on the hook for having signed it — not a hardware-backed guarantee that derivation actually happened as declared.",
  },
  [ConfidenceLevel.CryptographicallyBound]: {
    level: ConfidenceLevel.CryptographicallyBound,
    label: "Cryptographically Bound",
    userFacingLevel: 1,
    establishes:
      "The response was served through the Cascade-authored attested wrapper, which verifies the loaded model's hash against the registered commitment before serving, inside a measured TEE launch configuration.",
    doesNotEstablish:
      "That the frontend itself has independently confirmed the TDX/GPU attestation quote — see the Verification panel for exactly what is and isn't checked, and by whom.",
  },
};

export function confidenceLabel(level: ConfidenceLevel): string {
  return CONFIDENCE_INFO[level]?.label ?? `Unknown (${level})`;
}

/** Weakest-link: never computed independently here from raw levels —
 *  only ever used to LABEL a value the contract itself already
 *  computed (e.g. edge_attributions.effectiveConfidence). Exists so
 *  call sites don't need to import `Math.min` and reason about the
 *  enum's ascending-strength ordering themselves. */
export function weaker(a: ConfidenceLevel, b: ConfidenceLevel): ConfidenceLevel {
  return a < b ? a : b;
}

export { ConfidenceLevel };
