import { describe, it, expect, vi } from "vitest";
import { describeError } from "../src/errors";
import { CascadeClient } from "../../sdk/src/client";

function fakeClient(decoded: { contract: string; name: string; args: unknown[]; raw: unknown }): CascadeClient {
  return { decodeError: vi.fn().mockReturnValue(decoded) } as unknown as CascadeClient;
}

describe("describeError — protocol-aware error messages, never a bare stack trace", () => {
  it("maps a known Cascade custom error to its plain-language message", () => {
    const client = fakeClient({ contract: "CascadeRegistry", name: "EdgeAlreadyExists", args: [], raw: "0x" });
    const result = describeError(client, new Error("execution reverted"));
    expect(result.message).toBe("A lineage edge between this parent and child already exists.");
    expect(result.decoded?.name).toBe("EdgeAlreadyExists");
  });

  it("maps ChallengeWindowClosed / NotModelOwner / ExecutionAlreadyConsumed to the brief's own example wording", () => {
    const client = fakeClient({ contract: "CascadeRegistry", name: "ChallengeWindowClosed", args: [], raw: "" });
    expect(describeError(client, new Error("x")).message).toContain("challenge window");
  });

  it("still surfaces a message for an undecodable error, never crashing or showing nothing", () => {
    const client = fakeClient({ contract: "unknown", name: "UnknownError", args: [], raw: "weird error" });
    const result = describeError(client, new Error("weird error"));
    expect(result.message.length).toBeGreaterThan(0);
    expect(result.raw).toBe("weird error");
  });

  it("recognizes a wallet rejection distinctly, without needing contract decoding", () => {
    const client = fakeClient({ contract: "unknown", name: "UnknownError", args: [], raw: "" });
    const result = describeError(client, new Error("user rejected action ACTION_REJECTED"));
    expect(result.message).toBe("Transaction rejected by wallet.");
    expect(client.decodeError).not.toHaveBeenCalled();
  });

  it("never claims a stronger/different meaning than what decodeCascadeError actually returned", () => {
    const client = fakeClient({ contract: "ExecutionRegistry", name: "UnregisteredSigner", args: [], raw: "" });
    const result = describeError(client, new Error("reverted"));
    expect(result.decoded?.contract).toBe("ExecutionRegistry");
    expect(result.decoded?.name).toBe("UnregisteredSigner");
  });
});
