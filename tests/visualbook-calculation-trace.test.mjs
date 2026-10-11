import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const C=createRequire(import.meta.url)('../packages/visualbook/calculations.cjs');
test('Resolved calculation evidence follows dependencies and survives later state changes',()=>{
 const V={Board:class{},palette:{}};
 vm.runInNewContext(fs.readFileSync(new URL('../packages/visualbook/compose.js',import.meta.url),'utf8'),{window:{VisualBook:V,VisualBookCalculations:C}});
 V.components.tensor=(board,props)=>({values:props.values});
 const scene={type:'compose',calculations:[
  {id:'p',operation:'matrix-polynomial',inputs:{input:{$state:'a'},coefficients:[0,1]}},
  {id:'r',operation:'exact-row-reduction',inputs:{input:{$result:'p.value'}}}
 ],visual:{type:'tensor',props:{values:{$result:'r.final'}}}};
 const trace=[],state={a:[[2,0],[0,2]]};
 const facts=C.withTrace(trace,()=>V.renderScene({},scene,{params:{},state,progress:1}));
 assert.deepEqual(JSON.parse(JSON.stringify(facts)),{values:[[1,0],[0,1]]});
 assert.deepEqual(trace.map(x=>x.operation),['matrix-polynomial','exact-row-reduction']);
 const local=value=>JSON.parse(JSON.stringify(value));
 assert.deepEqual(local(trace[1].inputs.input),[[2,0],[0,2]]);
 state.a[0][0]=9;assert.deepEqual(local(trace[0].inputs.input),[[2,0],[0,2]]);
 assert.deepEqual(local(trace[0].result.value),[[2,0],[0,2]]);
 const next=[];C.withTrace(next,()=>V.renderScene({},scene,{params:{},state,progress:1}));
 assert.equal(next[0].inputs.input[0][0],9);assert.equal(trace[0].inputs.input[0][0],2);
});
test('Direct algebra calls are recorded once; failures restore the recorder',()=>{
 const A=createRequire(import.meta.url)('../packages/visualbook/algebra.cjs');
 const rows=[];
 C.withTrace(rows,()=>{
  A.modularTable({modulus:5});
  C.compute('residue-table',{modulus:6});
 });
 assert.deepEqual(rows.map(x=>x.origin),['algebra-kernel','compute']);
 assert.equal(rows[0].result.isField,true);assert.equal(rows[1].result.isField,false);
 assert.throws(()=>C.withTrace([],()=>C.compute('residue-table',{modulus:1})),/Residue/);
 A.modularTable({modulus:7});assert.equal(rows.length,2);
 const empty=[];C.withTrace(empty,()=>{});assert.equal(empty.length,0);
});
test('Per-figure cache isolates mutable results, input changes, invalid data and bounds',()=>{
 const cache=new Map(),rows=[];
 const call=input=>C.withTrace(rows,()=>C.compute('matrix-polynomial',input).result,{cache});
 const input={input:[[2,0],[0,2]],coefficients:[0,1]};
 const first=call(input);first.value[0][0]=99;
 const second=call(input);assert.equal(second.value[0][0],2);
 assert.equal(rows[0].cacheHit,false);assert.equal(rows[1].cacheHit,true);
 input.input[0][0]=3;assert.equal(call(input).value[0][0],3);assert.equal(rows[2].cacheHit,false);
 const A=createRequire(import.meta.url)('../packages/visualbook/algebra.cjs');
 C.withTrace(rows,()=>A.matrixPolynomial(input),{cache});assert.equal(rows.at(-1).cacheHit,true);
 for(let i=0;i<24;i++)call({input:[[i]],coefficients:[0,1]});assert.equal(cache.size,16);
 assert.throws(()=>call({input:[[NaN]],coefficients:[0,1]}),/finite/);
 assert.equal(cache.size,16);
 const fresh=[];C.withTrace(fresh,()=>C.compute('matrix-polynomial',input),{cache:new Map()});
 assert.equal(fresh[0].cacheHit,false);
});
