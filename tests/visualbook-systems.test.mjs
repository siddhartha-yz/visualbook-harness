import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const C=createRequire(import.meta.url)("../packages/visualbook/calculations.cjs");
const compute=(op,input)=>C.compute(op,input).result;
test("decimal roofline units and the bottleneck crossover match analytic controls",()=>{
 for(const intensity of [1,30,989000/3350,600]){
  const r=compute('roofline',{flops:3.35e9*intensity,bytes:3.35e9});
  assert.ok(Math.abs(r.intensity-intensity)<1e-10);
  assert.equal(r.transferMs,1);
  assert.ok(Math.abs(r.computeMs-intensity/(989000/3350))<1e-12);
  assert.equal(r.idealMs,Math.max(r.computeMs,1));
 }
 assert.throws(()=>compute('roofline',{flops:1,bytes:0}));
});
test("rotary coordinates preserve norms and depend on relative, not common position",()=>{
 for(const dimension of [2,4,8,16]){
  const q=Array.from({length:dimension},(_,i)=>(i%3)-1),k=Array.from({length:dimension},(_,i)=>1/(i+1));
  const first=compute('rotary-pairs',{q,k,m:3,n:7});
  for(const shift of [-100,0,.5,1000]){
   const r=compute('rotary-pairs',{q,k,m:3,n:7,shift});
   assert.ok(Math.abs(r.dot-first.dot)<1e-10);
   assert.ok(Math.abs(r.relativeDot-r.dot)<1e-10);
   for(const p of r.pairs)assert.ok(Math.abs(Math.hypot(...p.rotatedQ)-p.qNorm)<1e-12);
  }
 }
 assert.throws(()=>compute('rotary-pairs',{q:[1,2,3],k:[1,2,3]}));
});
test("KV budget uses both K and V and preserves exact MiB head-group ratios",()=>{
 const full=compute('cache-footprint',{kvHeads:32}),grouped=compute('cache-footprint',{kvHeads:8}),single=compute('cache-footprint',{kvHeads:1});
 assert.equal(full.totalBytes/2**20,1024);
 assert.equal(grouped.totalBytes/2**20,256);
 assert.equal(single.totalBytes/2**20,32);
 assert.equal(grouped.savingFraction,.75);
 assert.equal(grouped.keyBytes,grouped.valueBytes);
 assert.equal(grouped.totalMiB,256);
 assert.throws(()=>compute('cache-footprint',{queryHeads:32,kvHeads:3}));
 assert.throws(()=>compute('cache-footprint',{tokens:1.5}));
 assert.throws(()=>compute('cache-footprint',{layers:1e6,batch:1e6,tokens:4608,queryHeads:1,kvHeads:1,headDim:1,bytesPerElement:1}),/exact integer range/);
});
test("collective output semantics agree with fixed independent examples",()=>{
 const input=[[1,2,3,4],[5,6,7,8]];
 assert.deepEqual(compute('collective',{input,kind:'allreduce'}).output,[[6,8,10,12],[6,8,10,12]]);
 assert.deepEqual(compute('collective',{input,kind:'reduce-scatter'}).output,[[6,8],[10,12]]);
 assert.deepEqual(compute('collective',{input,kind:'allgather'}).output,[[1,2,3,4,5,6,7,8],[1,2,3,4,5,6,7,8]]);
 assert.deepEqual(compute('collective',{input,kind:'broadcast',root:1}).output,[[5,6,7,8],[5,6,7,8]]);
 assert.deepEqual(compute('collective',{input,kind:'alltoall'}).output,[[1,2,5,6],[3,4,7,8]]);
 const scattered=compute('collective',{input,kind:'reduce-scatter'}).output;
 assert.deepEqual(compute('collective',{input:scattered,kind:'allgather'}).output,compute('collective',{input,kind:'allreduce'}).output);
 const three=[[1,2,3],[4,5,6],[7,8,9]];
 assert.deepEqual(compute('collective',{input:three,kind:'alltoall'}).output,[[1,4,7],[2,5,8],[3,6,9]]);
 assert.throws(()=>compute('collective',{input:[[1,2,3],[4,5,6]],kind:'alltoall'}));
 assert.throws(()=>compute('collective',{input:[[1,2,3],[4,5,6]],kind:'reduce-scatter'}));
});
