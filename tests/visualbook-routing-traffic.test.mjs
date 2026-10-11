import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const C = createRequire(import.meta.url)("../packages/visualbook/calculations.cjs");
const compute = (name, input) => C.compute(name, input).result;
test("top-k ties, probability conventions and counts agree with analytic examples", () => {
  const scores = [[3, 1, 0], [2, 3, 1], [3, 2, 1]];
  const one = compute("top-k-route", { scores, k: 1 });
  assert.deepEqual(one.selected, [[0], [1], [0]]);
  assert.deepEqual(one.counts, [2, 1, 0]);
  assert.deepEqual(one.weights, [[1, 0, 0], [0, 1, 0], [1, 0, 0]]);
  const two = compute("top-k-route", { scores, k: 2 });
  assert.equal(two.assignments, 6);
  assert.deepEqual(two.counts, [3, 3, 0]);
  assert.ok(Math.abs(two.weights[0][0] - 1 / (1 + Math.exp(-2))) < 1e-14);
  assert.ok(two.weights.every(row => Math.abs(row.reduce((a, b) => a + b) - 1) < 1e-14));
  assert.equal(two.probability[0][2] > 0, true);
  assert.equal(two.weights[0][2], 0);
  assert.deepEqual(compute("top-k-route", { scores: [[1, 1, 1]], k: 2 }).selected, [[0, 1]]);
  assert.deepEqual(compute("top-k-route", { scores: scores.map(row => row.map(x => x + 10000)), k: 2 }).weights, two.weights);
  assert.throws(() => compute("top-k-route", { scores, k: 4 }));
  assert.throws(() => compute("top-k-route", { scores, temperature: 0 }));
});
test("GEMM ledger separates conventional hardware FLOPs from exact scalar operations", () => {
  const r = compute("matmul-traffic", { m: 2, k: 3, n: 4, bytesPerElement: 2 });
  assert.deepEqual([r.aElements, r.bElements, r.cElements], [6, 12, 8]);
  assert.equal(r.bytes, 52);
  assert.equal(r.flops, 48);
  assert.equal(r.exactScalarOps, 40); // Eight outputs: three multiplies and two additions each.
  assert.equal(r.intensity, 12 / 13);
  const batch = compute("matmul-traffic", { m: 328, k: 4096, n: 11008 });
  assert.ok(Math.abs(batch.intensity - 1 / (1 / 328 + 1 / 4096 + 1 / 11008)) < 1e-10);
  assert.equal(batch.bMiB, 86);
  assert.throws(() => compute("matmul-traffic", { m: 1e6, n: 1e6, k: 1e6 }));
});
test("decode sharing preserves FLOPs, changes dense KV traffic and tends to group-size intensity", () => {
  const mha = compute("decode-attention-traffic", {}), gqa = compute("decode-attention-traffic", { kvHeads: 8 }), mqa = compute("decode-attention-traffic", { kvHeads: 1 });
  assert.equal(mha.flops, gqa.flops);
  assert.equal(mha.queryOutputBytes, gqa.queryOutputBytes);
  assert.equal(mha.kvBytes, gqa.kvBytes * 4);
  assert.equal(mha.intensity, 2048 / 2049);
  assert.equal(gqa.intensity, 4 * 2048 / (2048 + 4));
  assert.equal(mqa.intensity, 32 * 2048 / (2048 + 32));
  assert.throws(() => compute("decode-attention-traffic", { kvHeads: 3 }));
});
