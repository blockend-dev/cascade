import { ethers } from "ethers";
import { Contracts } from "./contracts";

export interface DecodedCascadeError {
  contract: "CascadeRegistry" | "ExecutionRegistry" | "AttributionSettlement" | "TrainingProvenanceRegistry" | "unknown";
  name: string;
  args: Record<string, unknown>;
  raw: string;
}

/**
 * Decodes a revert against every deployed Cascade contract's own error
 * set — using each contract's real `Interface` (from the generated ABI),
 * not a hand-maintained list of error selectors. Returns a best-effort
 * "unknown" result rather than throwing if nothing matches, so a caller
 * can always safely inspect `.name` without a try/catch of their own.
 */
export function decodeCascadeError(error: unknown, contracts: Contracts): DecodedCascadeError {
  const data = extractRevertData(error);
  if (!data) {
    return { contract: "unknown", name: "UnknownError", args: {}, raw: describeError(error) };
  }

  const candidates: Array<[DecodedCascadeError["contract"], ethers.Interface]> = [
    ["CascadeRegistry", contracts.cascadeRegistry.interface],
    ["ExecutionRegistry", contracts.executionRegistry.interface],
    ["AttributionSettlement", contracts.attributionSettlement.interface],
    ["TrainingProvenanceRegistry", contracts.trainingProvenanceRegistry.interface],
  ];

  for (const [contractName, iface] of candidates) {
    try {
      const parsed = iface.parseError(data);
      if (parsed) {
        const args: Record<string, unknown> = {};
        parsed.fragment.inputs.forEach((input, i) => {
          args[input.name || `arg${i}`] = parsed.args[i];
        });
        return { contract: contractName, name: parsed.name, args, raw: data };
      }
    } catch {
      // not this contract's error — try the next one
    }
  }

  return { contract: "unknown", name: "UnknownError", args: {}, raw: data };
}

function extractRevertData(error: unknown): string | null {
  const e = error as { data?: string; error?: { data?: string }; info?: { error?: { data?: string } } };
  return e?.data ?? e?.error?.data ?? e?.info?.error?.data ?? null;
}

function describeError(error: unknown): string {
  const e = error as { shortMessage?: string; reason?: string; message?: string };
  return e?.shortMessage ?? e?.reason ?? e?.message ?? String(error);
}
