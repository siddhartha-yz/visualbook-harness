/* Actual renders and changed-input witnesses for the algebra library; no model/artistic score. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {build,preview,staticExport} from './visualbook.mjs';
const root=path.resolve(import.meta.dirname,'..'),out=path.resolve(process.argv[2]);
if(!out.startsWith(path.join(root,'work')+path.sep)||fs.existsSync(out))throw Error('Use a fresh ignored work directory');
fs.mkdirSync(out,{recursive:true});
const ids=['row-reduction','rank-nullity','basis-coordinates','basis-decomposition','residue-field','residue-zero-divisors','residue-systems','jordan-blocks','nilpotent-kernels','polynomial-division','polynomial-remainder','polynomial-bezout','quotient-cosets','solution-coset','cofactor-expansion','dual-contours','quadratic-congruence','quadratic-inertia','quadratic-degeneracy'];
const reports=[];
for(let offset=0;offset<ids.length;offset+=4) {
  const group=ids.slice(offset,offset+4),dir=path.join(out,'group-'+offset);fs.mkdirSync(dir);
  const source={title:'高等代数工具图形核对',sourceSha256:'maintainer-control',blocks:group.map((id,i)=>({id:'control-'+i,raw:'控制样本',type:'paragraph',sha256:'maintainer-control',math:{expected:0},html:'<p>工具核对：'+id+'。实际教材会使用课程内容与对应算例。</p>'}))};
  const plan={figures:group.map((id,i)=>({id,design:id,afterAnchor:'control-'+i}))};
  const file=path.join(dir,'book.html');fs.writeFileSync(file,build(source,plan));
  fs.writeFileSync(path.join(dir,'source.json'),JSON.stringify(source,null,2)+'\n');fs.writeFileSync(path.join(dir,'book.json'),JSON.stringify(plan,null,2)+'\n');
  const report=await preview(file,path.join(dir,'preview'));reports.push(report);
  if(!report.findings.length)staticExport(file,path.join(dir,'preview'),path.join(dir,'exported.html'));
}
const findings=reports.flatMap(r=>r.findings);
fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify({designs:ids.length,viewports:[375,1280,1920],findings,scope:'Actual tool rendering, layout/math witnesses; not model generation or artistic verdict'},null,2)+'\n');
console.log(JSON.stringify({passed:!findings.length,designs:ids.length,findings}));
if(findings.length)process.exitCode=1;
