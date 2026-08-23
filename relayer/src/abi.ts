/**
 * Re-exports the SDK's generated ABIs (`sdk/src/abis`, themselves
 * generated from `contracts/artifacts` — ADR 0012) rather than
 * hand-maintaining a second, independently-transcribed copy. This file
 * previously hand-wrote these fragments; that copy was the exact class
 * of bug ADR 0012 exists to prevent (`CascadeRegistry.getModel` was once
 * transcribed here as five flat return values instead of one tuple —
 * see ADR 0012's own account of that bug). Consuming the generated ABI
 * directly makes that specific class of error structurally impossible
 * through this path: there is no longer a hand-transcription step here
 * at all.
 *
 * Callers (`verifier.ts`, `submitter.ts`) are unaffected — the exported
 * names and their use as `ethers.Contract` ABIs are unchanged; the
 * generated ABIs are supersets of what this package previously
 * hand-picked; ethers.Contract does not care which shape it was given
 * versus which functions actually get called.
 */
export {
  CASCADE_REGISTRY_ABI,
  EXECUTION_REGISTRY_ABI,
  ATTRIBUTION_SETTLEMENT_ABI,
} from "../../sdk/src/abis";
