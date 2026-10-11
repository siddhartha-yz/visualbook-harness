import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const C = createRequire(import.meta.url)("../packages/visualbook/calculations.cjs");
const sweep = input => C.compute("matmul-batch-sweep", input).result;
test("small analytic GEMM crosses at exactly two, with a finite intensity ceiling", () => {
  const r = sweep({ batch:2, inputDim:4, outputDim:4, computeTFLOPS:.001, memoryGBPS:1, minBatch:1, maxBatch:4, samples:4 });
  assert.equal(r.criticalBatch,2); assert.equal(r.firstComputeBoundBatch,2); assert.equal(r.intensityCeiling,2);
  assert.deepEqual(r.intensityCurve,[[1,2/3],[2,1],[3,6/5],[4,4/3]]);
  assert.deepEqual(r.weightOnlyCurve,[[1,1],[2,2],[3,3],[4,4]]);
  assert.equal(r.selected.bound,"compute"); assert.equal(r.selected.flops,64); assert.equal(r.selected.bytes,64);
  const impossible=sweep({ batch:2,inputDim:4,outputDim:4,computeTFLOPS:.004,memoryGBPS:1,maxBatch:4 });
  assert.equal(impossible.criticalBatch,null); assert.equal(impossible.firstComputeBoundBatch,null);
});
test("the course's 327/328 boundary uses full traffic, not B greater than crossover", () => {
  const before=sweep({batch:327}),after=sweep({batch:328});
  assert.equal(before.selected.bound,"memory");assert.equal(after.selected.bound,"compute");
  assert.equal(after.firstComputeBoundBatch,328);
  assert.ok(Math.abs(after.criticalBatch-20254720/61823)<1e-8); // Independent exact rational derivation.
  assert.equal(sweep({bytesPerElement:4}).weightOnlyCurve.at(-1)[1],512);
  assert.throws(()=>sweep({batch:1,minBatch:2}),/range/);assert.throws(()=>sweep({samples:130}),/bounded/);
  assert.throws(()=>sweep({minBatch:2,maxBatch:2}),/range/);
  assert.throws(()=>sweep({inputDim:1000000,outputDim:1000000,maxBatch:1000000}),/exact integer/);
});
