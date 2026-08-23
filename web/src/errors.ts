import { DecodedCascadeError } from "../../sdk/src/errors";
import { CascadeClient } from "../../sdk/src/client";

/** Plain-language messages for the Cascade custom errors a user is
 *  actually likely to hit through this UI's write flows. Anything not
 *  in this map still gets a message (decodeCascadeError itself never
 *  throws — SDK ADR 0012 / errors.ts), just the decoded
 *  `contract.name` shown directly with a "technical details" expander
 *  rather than a hand-written explanation, since we haven't written
 *  one for it yet — better than pretending certainty we don't have. */
const KNOWN_MESSAGES: Record<string, string> = {
  ModelAlreadyExists: "A model with this ID is already registered.",
  ModelNotFound: "No model is registered with this ID.",
  NotModelOwner: "This action requires being the model's registered owner — ownership may have changed.",
  ModelNotActive: "This model has been revoked and can no longer be used here.",
  EdgeAlreadyExists: "A lineage edge between this parent and child already exists.",
  EdgeNotFound: "No lineage edge exists with this ID.",
  SelfParent: "A model cannot declare itself as its own parent.",
  CycleDetected: "This lineage edge would create a cycle in the ancestry graph.",
  TooManyParents: "This model has already reached the maximum number of parent edges.",
  RoyaltyCapExceeded: "This edge's royalty share would exceed the maximum allowed total for this model.",
  InsufficientStake: "The stake sent is below the protocol's minimum required stake.",
  InsufficientChallengeBond: "The bond sent is below the protocol's minimum required challenge bond.",
  EdgeNotPending: "This edge is not in a state that allows this action (it may already be finalized, challenged, or rejected).",
  EdgeNotChallenged: "This edge has not been challenged.",
  ChallengeWindowOpen: "The challenge window for this edge has not closed yet.",
  ChallengeWindowClosed: "The challenge window for this edge has already closed.",
  NotResolver: "Only the registered challenge resolver may take this action.",
  SignerAlreadyRegistered: "This signer address is already registered to a provider.",
  NotSignerOwner: "Only the provider that registered this signer may revoke it.",
  UnregisteredSigner: "This proof was signed by a key that isn't registered to any provider.",
  ModelCommitmentMismatch: "The proof's model commitment doesn't match what's currently registered for this model.",
  ProofExpired: "This usage proof is older than the protocol's validity window.",
  ProofNotYetValid: "This usage proof's issued time is in the future.",
  ExecutionAlreadyConsumed: "This usage proof has already been consumed — it cannot be settled twice.",
  IncorrectFunding: "The transaction's value doesn't match the protocol's required attribution fee exactly.",
  InvalidEpoch: "This proof's epoch doesn't match the settlement contract's current epoch.",
  NothingToClaim: "There is no claimable balance for this address.",
  ProvenanceAlreadyRegistered: "Training provenance has already been registered for this model — records are immutable.",
  UnregisteredProvider: "This claim was signed by a key that isn't registered to any provider.",
  ResultCommitmentMismatch: "The claim's resulting commitment doesn't match the child model's registered commitment.",
  BaseModelCommitmentMismatch: "The claim's base-model commitment doesn't match the base model's registered commitment.",
};

export interface FriendlyError {
  message: string;
  decoded: DecodedCascadeError | null;
  raw: string;
}

/** Turns any error caught from a Cascade write/usage call into a
 *  message worth showing a user, plus the full decoded/raw detail for
 *  an expandable "technical details" section — never just a bare
 *  ethers stack trace (docs/frontend.md §7). */
export function describeError(client: CascadeClient, err: unknown): FriendlyError {
  if (err instanceof Error && /user rejected|ACTION_REJECTED/i.test(err.message)) {
    return { message: "Transaction rejected by wallet.", decoded: null, raw: err.message };
  }
  const decoded = client.decodeError(err);
  const message = decoded.contract !== "unknown" && KNOWN_MESSAGES[decoded.name] ? KNOWN_MESSAGES[decoded.name] : decoded.name !== "UnknownError" ? `${decoded.contract}: ${decoded.name}` : "An unexpected error occurred.";
  return { message, decoded, raw: err instanceof Error ? err.message : String(err) };
}
