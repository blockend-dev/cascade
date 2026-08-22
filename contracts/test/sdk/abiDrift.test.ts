import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import {
  CASCADE_REGISTRY_ABI,
  EXECUTION_REGISTRY_ABI,
  ATTRIBUTION_SETTLEMENT_ABI,
  TRAINING_PROVENANCE_REGISTRY_ABI,
} from "../../../sdk/src/abis";

/**
 * sdk/src/abis/*.ts is generated from contracts/artifacts by
 * sdk/scripts/generate-abis.ts (docs/adr/0012). This test is the guard
 * against silent drift: if someone edits a contract and forgets to
 * re-run `npm run generate-abis` in sdk/, or hand-edits a generated file,
 * this fails loudly instead of the SDK quietly shipping a stale ABI —
 * exactly the class of bug that motivated generation in the first place
 * (see the Phase 7 CascadeRegistry.getModel tuple-vs-flat-values bug
 * documented in the ADR).
 */
const ARTIFACTS_DIR = path.resolve(__dirname, "../../artifacts/src");

function loadArtifactAbi(contractName: string): unknown[] {
  const artifactPath = path.join(ARTIFACTS_DIR, `${contractName}.sol`, `${contractName}.json`);
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf-8"));
  return artifact.abi;
}

describe("SDK generated ABIs — no drift from the compiled contract artifacts", () => {
  const cases: Array<[string, readonly unknown[]]> = [
    ["CascadeRegistry", CASCADE_REGISTRY_ABI],
    ["ExecutionRegistry", EXECUTION_REGISTRY_ABI],
    ["AttributionSettlement", ATTRIBUTION_SETTLEMENT_ABI],
    ["TrainingProvenanceRegistry", TRAINING_PROVENANCE_REGISTRY_ABI],
  ];

  for (const [contractName, generatedAbi] of cases) {
    it(`${contractName}'s generated ABI matches its current compiled artifact exactly`, () => {
      const artifactAbi = loadArtifactAbi(contractName);
      expect(JSON.parse(JSON.stringify(generatedAbi))).to.deep.equal(artifactAbi);
    });
  }

  it("getModel's generated ABI entry returns a single tuple, not flattened fields (the exact bug generation exists to prevent)", () => {
    const getModel = (CASCADE_REGISTRY_ABI as unknown as Array<Record<string, unknown>>).find(
      (entry) => entry.type === "function" && entry.name === "getModel"
    );
    expect(getModel, "getModel entry should exist in the generated ABI").to.exist;
    const outputs = getModel!.outputs as Array<Record<string, unknown>>;
    expect(outputs).to.have.lengthOf(1);
    expect(outputs[0].type).to.equal("tuple");
    expect(outputs[0].components).to.be.an("array").that.is.not.empty;
  });
});
