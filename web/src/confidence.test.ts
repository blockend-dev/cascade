import { describe, it, expect } from "vitest";
import { CONFIDENCE_INFO, confidenceLabel, weaker, ConfidenceLevel } from "./confidence";

const BANNED_WORDS = [/verified/i, /proof of training/i, /trustless/i, /cryptographic proof of derivation/i];

describe("confidence labeling — the language must never overstate the protocol", () => {
  it("uses the exact protocol-spec labels: Declared, Attested Training, Cryptographically Bound", () => {
    expect(confidenceLabel(ConfidenceLevel.Declared)).toBe("Declared");
    expect(confidenceLabel(ConfidenceLevel.AttestedTraining)).toBe("Attested Training");
    expect(confidenceLabel(ConfidenceLevel.CryptographicallyBound)).toBe("Cryptographically Bound");
  });

  it("maps user-facing level numbers in the OPPOSITE direction from the enum's ascending strength", () => {
    expect(CONFIDENCE_INFO[ConfidenceLevel.Declared].userFacingLevel).toBe(3);
    expect(CONFIDENCE_INFO[ConfidenceLevel.AttestedTraining].userFacingLevel).toBe(2);
    expect(CONFIDENCE_INFO[ConfidenceLevel.CryptographicallyBound].userFacingLevel).toBe(1);
  });

  it("never uses banned overstated language anywhere in the confidence copy", () => {
    for (const info of Object.values(CONFIDENCE_INFO)) {
      for (const text of [info.label, info.establishes, info.doesNotEstablish]) {
        for (const banned of BANNED_WORDS) {
          expect(text, `"${text}" must not match ${banned}`).not.toMatch(banned);
        }
      }
    }
  });

  it("every level's copy explicitly states what it does NOT establish", () => {
    for (const info of Object.values(CONFIDENCE_INFO)) {
      expect(info.doesNotEstablish.length).toBeGreaterThan(10);
    }
  });

  it("weaker() picks the weaker of two levels, matching the protocol's ascending-strength enum ordering", () => {
    expect(weaker(ConfidenceLevel.Declared, ConfidenceLevel.CryptographicallyBound)).toBe(ConfidenceLevel.Declared);
    expect(weaker(ConfidenceLevel.CryptographicallyBound, ConfidenceLevel.AttestedTraining)).toBe(ConfidenceLevel.AttestedTraining);
    expect(weaker(ConfidenceLevel.Declared, ConfidenceLevel.Declared)).toBe(ConfidenceLevel.Declared);
  });

  it("confidenceLabel() never throws or fabricates a label for an out-of-range value", () => {
    expect(confidenceLabel(99 as ConfidenceLevel)).toContain("Unknown");
  });
});
