/**
 * Regenerates sdk/src/abis/*.ts from Hardhat's own compiled artifacts —
 * the authoritative source, not a hand-transcription of it. See ADR 0012
 * for why: a hand-maintained ABI fragment silently drifted from a real
 * contract's actual encoding in Phase 7 (CascadeRegistry.getModel's
 * struct-vs-flat-return-values bug) and was only caught by a test
 * happening to exercise it. This script removes that failure mode by
 * construction — there is nothing to hand-transcribe.
 *
 * Run after any change to a contract's public interface:
 *   cd contracts && npm run build
 *   cd ../sdk && npm run generate-abis
 *
 * The generated files ARE committed (so installing/using the SDK doesn't
 * require compiling contracts/ first) but must never be hand-edited —
 * each carries a header saying so.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const CONTRACTS = ["CascadeRegistry", "ExecutionRegistry", "AttributionSettlement", "TrainingProvenanceRegistry"];

const ARTIFACTS_DIR = path.resolve(__dirname, "../../contracts/artifacts/src");
const OUT_DIR = path.resolve(__dirname, "../src/abis");

function generate(name: string): void {
  const artifactPath = path.join(ARTIFACTS_DIR, `${name}.sol`, `${name}.json`);
  if (!fs.existsSync(artifactPath)) {
    throw new Error(
      `Missing compiled artifact for ${name} at ${artifactPath}. Run \`npm run build\` in contracts/ first.`
    );
  }
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  if (!Array.isArray(artifact.abi)) {
    throw new Error(`${artifactPath} has no "abi" array — is this actually a Hardhat artifact?`);
  }

  const header =
    `// GENERATED FILE — do not hand-edit. Source of truth: ` +
    `contracts/artifacts/src/${name}.sol/${name}.json (Hardhat's own compiled output).\n` +
    `// Regenerate with \`npm run generate-abis\` after any contract change — see ADR 0012.\n\n`;

  const constName = `${name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase()}_ABI`;
  const body = `export const ${constName} = ${JSON.stringify(artifact.abi, null, 2)} as const;\n`;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, `${name}.ts`), header + body);
  // eslint-disable-next-line no-console
  console.log(`wrote sdk/src/abis/${name}.ts (${artifact.abi.length} ABI entries)`);
}

function generateIndex(): void {
  const lines = CONTRACTS.map((name) => `export * from "./${name}";`);
  fs.writeFileSync(
    path.join(OUT_DIR, "index.ts"),
    `// GENERATED FILE — do not hand-edit. See generate-abis.ts.\n\n${lines.join("\n")}\n`
  );
}

for (const name of CONTRACTS) generate(name);
generateIndex();
