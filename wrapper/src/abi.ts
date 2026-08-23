/**
 * Re-exports the SDK's generated ABI (`sdk/src/abis`, generated from
 * `contracts/artifacts` — ADR 0012) rather than hand-maintaining a
 * second, independently-transcribed copy. This file previously
 * hand-wrote `CASCADE_REGISTRY_ABI` with `getModel` declared as five
 * flat return values instead of the single `Model` tuple it actually
 * returns — the exact bug ADR 0012 exists to prevent, caught by
 * `contracts/test/wrapper`'s own tests at the time. Consuming the
 * generated ABI directly makes that class of error structurally
 * impossible through this path: there is no hand-transcription step
 * here any more.
 *
 * `lifecycle.ts`'s usage (`new ethers.Contract(address, CASCADE_REGISTRY_ABI, provider)`)
 * is unaffected — the generated ABI is a superset of the single
 * function this package calls.
 */
export { CASCADE_REGISTRY_ABI } from "../../sdk/src/abis";
