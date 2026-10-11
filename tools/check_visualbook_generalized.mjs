/* Actual bounded dimension-band variants; synthetic fixtures, no model/teacher score. */
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {build,preview,staticExport} from './visualbook.mjs';
const root=path.resolve(import.meta.dirname,'..'),out=path.resolve(process.argv[2]);
if(!out.startsWith(path.join(root,'work')+path.sep)||fs.existsSync(out))throw Error('Use a fresh ignored directory');
fs.mkdirSync(out,{recursive:true});
const variants=[
 {id:'largest',input:[[2,1,0,0,0,0],[0,2,1,0,0,0],[0,0,2,0,0,0],[0,0,0,2,1,0],[0,0,0,0,2,0],[0,0,0,0,0,5]],eigenvalue:2},
 {id:'one',input:[[7]],eigenvalue:7},
 {id:'rational',input:[['1/2',1,0],[0,'1/2',0],[0,0,'3/2']],eigenvalue:'1/2'},
 {id:'absent',input:[[0,-1],[1,0]],eigenvalue:0},
];
const source={title:'维数条带的边界样本',sourceSha256:'synthetic-maintainer-generalized',blocks:variants.map(v=>({id:v.id,type:'paragraph',raw:'Synthetic finite control.',html:'<p>合成控制：明确指定一个有理数，查看核的维数。没有对应特征值时，核维数可一直为零。</p>',math:{expected:0},sha256:'synthetic-maintainer-generalized'}))};
const plan={figures:variants.map(v=>({id:v.id,afterAnchor:v.id,design:'generalized-eigen-kernels',overrides:[{path:'/scene/calculations/0/inputs/input',value:v.input},{path:'/scene/calculations/0/inputs/eigenvalue',value:v.eigenvalue}]}))};
const file=path.join(out,'book.html');fs.writeFileSync(path.join(out,'source.json'),JSON.stringify(source,null,2)+'\n');fs.writeFileSync(path.join(out,'book.json'),JSON.stringify(plan,null,2)+'\n');fs.writeFileSync(file,build(source,plan));
const report=await preview(file,path.join(out,'preview'));fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify({variants:variants.length,widths:[375,1280,1920],findings:report.findings,scope:'Actual synthetic fixture rendering and recorded exact calculations. No model generation, course coverage, aesthetic score or teacher review.'},null,2)+'\n');assert.deepEqual(report.findings,[]);
const trace=JSON.parse(fs.readFileSync(path.join(out,'preview/calculation-input.json')));for(const variant of variants){const states=trace.states.filter(s=>s.id===variant.id);assert(states.length>0);for(const state of states)for(const row of state.calculations){assert.deepEqual(row.inputs.input,variant.input);assert.equal(row.inputs.eigenvalue,variant.eigenvalue);}}
staticExport(file,path.join(out,'preview'),path.join(out,'exported.html'));console.log(JSON.stringify({variants:variants.length,findings:report.findings}));
