/* Native one-click cases, atomic updates and reusable primitive boundaries. */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { build, preview, staticExport } from "./visualbook.mjs";
const root=path.resolve(import.meta.dirname,".."),out=path.resolve(process.argv[2]);
if(fs.existsSync(out))throw Error("Use a fresh evidence directory");
fs.mkdirSync(out,{recursive:true});
const source={title:"典型情况与工具边界",sourceSha256:"maintenance-control",blocks:[1,2,3,4].map(i=>({id:"case-"+i,type:"paragraph",raw:"维护样本",html:"<p>维护者控制，不是生成教材或学习效果证明。</p>",sha256:"maintenance-control",math:{expected:0}}))};
const plan={figures:[...['roofline-balance','kv-head-budget','collective-semantics'].map((design,i)=>({id:['roof','cache','collective'][i],design,afterAnchor:'case-'+(i+1)})),
{id:'atomic',title:'两个输入一次改变',afterAnchor:'case-4',interaction:'parameters',height:200,params:[{key:'a',label:'A',min:1,max:4,step:1,value:1},{key:'b',label:'B',min:1,max:4,step:1,value:1}],presets:[{id:'small',label:'较小输入',params:{a:1,b:1}},{id:'large',label:'较大输入',params:{a:2,b:3}}],code:"function draw({board,params}){window.__casePaints=(window.__casePaints||0)+1;board.text('sum',params.a+params.b,board.width/2,100,{anchor:'middle',size:22});return {a:params.a,b:params.b,sum:params.a+params.b};}"}]};
const file=out+'/book.html';fs.writeFileSync(file,build(source,plan));
const report=await preview(file,out+'/preview');assert.deepEqual(report.findings,[]);
staticExport(file,out+'/preview',out+'/offline.html');
const {chromium}=await import(pathToFileURL(root+'/work/visualbook/runtime/node_modules/playwright-core/index.mjs'));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH??chromium.executablePath()}),checks=[];
try{
 for(const width of [375,1280,1920]){
  const page=await browser.newPage({viewport:{width,height:950}});await page.goto(pathToFileURL(file).href);
  const get=id=>page.evaluate(id=>{const i=VisualBookRuntime.instances.find(i=>i.id===id);return {params:i.params,facts:i.facts,progress:i.progress};},id);
  for(const [id,name,expected]of [['roof','high',2e12],['cache','mqa',1],['collective','exchange','alltoall']]){
   await page.locator('#figure-'+id+' [data-preset="'+name+'"]').click();const facts=await get(id);
   assert.equal(Object.values(facts.params)[0],expected);assert.equal(await page.locator('#figure-'+id+' [data-preset="'+name+'"]').getAttribute('aria-pressed'),'true');
   assert.equal(await page.locator('#figure-'+id+' .vh-explore').getAttribute('open'),null);
   await page.locator('#figure-'+id+' summary').click();await page.locator('#figure-'+id+' .vh-reset').click();await page.locator('#figure-'+id+' summary').click();
   assert.notEqual(Object.values((await get(id)).params)[0],expected);
  }
  await page.locator('#figure-atomic [data-preset="large"]').scrollIntoViewIfNeeded();
  const before=await page.evaluate(()=>window.__casePaints);await page.locator('#figure-atomic [data-preset="large"]').click();
  assert.equal(await page.evaluate(()=>window.__casePaints),before+1);assert.deepEqual((await get('atomic')).facts,{a:2,b:3,sum:5});
  const valid=await get('atomic');
  const failure=await page.evaluate(()=>{try{VisualBookRuntime.instances.find(i=>i.id==='atomic').setParams({a:4,unknown:3});return null;}catch(e){return String(e);}});
  assert.match(failure,/Invalid parameter/);assert.deepEqual(await get('atomic'),valid);
  await page.mouse.wheel(0,50);assert.deepEqual(await get('atomic'),valid);
  await page.screenshot({path:out+'/'+width+'-cases.png'});checks.push({width,nativeCasesChangedInputs:true,resetRestoredDefaults:true,atomicSinglePaint:true,rejectedUpdatePreservedAllInputs:true,scrollPreservedValues:true});await page.close();
  const nojs=await browser.newPage({viewport:{width,height:950},javaScriptEnabled:false});await nojs.goto(pathToFileURL(out+'/offline.html').href);assert.equal(await nojs.locator('.vh-cases').first().isVisible(),false);assert.equal(await nojs.locator('.vh-static img').count(),4);await nojs.close();
 }
 const page=await browser.newPage();await page.goto(pathToFileURL(file).href);
 const boundaries=await page.evaluate(()=>{
  const V=VisualBook,create=(w,h)=>{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');const b=new V.Board(svg);b.begin(w,h);return b;},reject=(type,props,w=350,h=260)=>{try{V.components[type](create(w,h),props);return false;}catch{return true;}};
  const seq={atoms:['a','b','c'],rows:[{label:'组',groups:[{start:0,end:2},{start:2,end:3}]}]};
  const matrix=[[1,2],[3,4]],flow={matrix,sources:['A','B'],targets:['C','D']};
  const a=V.components['ribbon-flow'](create(400,300),flow),b=V.components['ribbon-flow'](create(400,300),{...flow,matrix:matrix.map(r=>r.map(x=>x*1e9))});
  return {crossingBarrier:reject('sequence-strips',{...seq,barriers:[1]}),omittedAtom:reject('sequence-strips',{...seq,rows:[{label:'组',groups:[{start:0,end:2}]}]}),barOutsideScale:reject('category-bars',{items:[{label:'A',value:2}],domain:[0,1]}),negativeFlow:reject('ribbon-flow',{...flow,matrix:[[-1,2],[3,4]]}),tinyTable:reject('matrix-table',{data:Array.from({length:4},()=>[1,2,3,4]),title:'表'},200,120),flowUnitInvariant:a.edges.every((e,i)=>Math.abs(e.thickness-b.edges[i].thickness)<1e-8)};
 });assert.ok(Object.values(boundaries).every(Boolean),JSON.stringify(boundaries));checks.push({boundaries});await page.close();
}finally{await browser.close();fs.writeFileSync(out+'/checks.json',JSON.stringify({checks,modelCalls:0,scope:'Actual Chromium native cases, atomic rejection, no-script fallback and six primitive boundary controls. No generated book, artistic score or learner validation.'},null,2)+'\n');}
console.log(JSON.stringify({passed:true,widths:3,boundaryChecks:6,modelCalls:0}));
