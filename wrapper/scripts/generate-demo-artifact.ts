import * as fs from "fs";
import * as path from "path";

/**
 * Generates a tiny, real, spec-valid safetensors file — not fabricated
 * metadata, an actual serialized model artifact (a trivial single-layer
 * linear model's real parameters: a 2x2 F32 weight matrix and a 2-element
 * F32 bias vector). Chosen over ONNX for this demo because the
 * safetensors format (https://github.com/huggingface/safetensors) is
 * simple enough to implement correctly by hand, from the public spec,
 * without adding a new npm dependency to this repository — consistent
 * with every other package's minimal-dependency discipline.
 *
 * Format (verified against the public spec):
 *   [8 bytes little-endian u64: header length N]
 *   [N bytes: UTF-8 JSON header — {"<name>": {"dtype","shape","data_offsets":[start,end]}, ...}]
 *   [raw tensor bytes, concatenated in the order the header's offsets describe]
 *
 * Deterministic: every value below is a fixed literal, not randomly
 * generated — running this script twice produces a byte-identical file,
 * so the resulting root hash is reproducible by anyone who runs it.
 */

const WEIGHT = [0.5, -0.25, 0.75, -1.0]; // shape [2, 2] — a real (if trivial) linear layer's weight matrix
const BIAS = [0.1, -0.1]; // shape [2]

function f32Bytes(values: number[]): Buffer {
  const buf = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => buf.writeFloatLE(v, i * 4));
  return buf;
}

function main() {
  const weightBytes = f32Bytes(WEIGHT);
  const biasBytes = f32Bytes(BIAS);

  const header = {
    __metadata__: {
      format: "cascade-demo-linear-model",
      description: "A trivial single-layer linear model (y = Wx + b) — a real, minimal, deterministic artifact for the Cascade 0G Storage integration demo. Not a production model.",
    },
    weight: { dtype: "F32", shape: [2, 2], data_offsets: [0, weightBytes.length] },
    bias: { dtype: "F32", shape: [2], data_offsets: [weightBytes.length, weightBytes.length + biasBytes.length] },
  };

  const headerJson = Buffer.from(JSON.stringify(header), "utf-8");
  const headerLen = Buffer.alloc(8);
  headerLen.writeBigUInt64LE(BigInt(headerJson.length), 0);

  const file = Buffer.concat([headerLen, headerJson, weightBytes, biasBytes]);

  const outPath = path.join(__dirname, "..", "demo-artifact", "cascade-demo-model.safetensors");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, file);

  console.log(`Wrote ${outPath} (${file.length} bytes)`);
  console.log(`weight = ${JSON.stringify(WEIGHT)} (shape [2,2])`);
  console.log(`bias   = ${JSON.stringify(BIAS)} (shape [2])`);
}

main();
