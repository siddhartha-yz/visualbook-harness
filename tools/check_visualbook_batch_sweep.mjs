/* Same reusable scene with different numerical assumptions; no author. */
import fs from "node:fs"; import path from "node:path"; import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { importMarkdown } from "../packages/visualbook/import.mjs";
import { build, preview } from "./visualbook.mjs";
const root = path.resolve(import.meta.dirname, ".."), out = path.resolve(process.argv[2]);
if (fs.existsSync(out)) throw Error("Use fresh evidence"); fs.mkdirSync(out, { recursive:true });
const cases = [
  {id:"exact-tie", values:{inputDim:4,outputDim:4,computeTFLOPS:.001,memoryGBPS:1,maxBatch:4,samples:4}, batch:2, max:4},
  {id:"no-crossing", values:{inputDim:4,outputDim:4,computeTFLOPS:.004,memoryGBPS:1,maxBatch:4,samples:4}, batch:2, max:4},
  {id:"fp32", values:{bytesPerElement:4}, batch:320, max:1024}
], records=[];
for (const c of cases) {
  const directory=out+"/"+c.id; fs.mkdirSync(directory);
  const md=directory+"/source.md";fs.writeFileSync(md,"### 批量账本维护者控制\n\n同一设计在不同矩阵和精度条件下的真实渲染，不是模型生成或学习效果评审。\n");
  const source=importMarkdown(md,{id:c.id});
  const overrides=Object.entries(c.values).map(([key,value])=>({path:"/scene/calculations/0/inputs/"+key,value}));
  overrides.push({path:"/params/0/value",value:c.batch},{path:"/params/0/max",value:c.max});
  const plan={figures:[{id:"budget",design:"gemm-batch-balance",afterAnchor:source.blocks[1].id,
    summary:`D=${c.values.inputDim??4096}，F=${c.values.outputDim??11008}，每元素${c.values.bytesPerElement??2}字节；横轴B、纵轴FLOP/Byte。给定理想速率，一次读A/W、一次写C；维护者数据变体。`,overrides,...(c.max<1024?{presets:[]}:{})}]};
  const file=directory+"/book.html";fs.writeFileSync(file,build(source,plan));
  const report=await preview(file,directory+"/preview");assert.equal(report.findings.length,0);
  records.push({id:c.id,source,plan,file,values:c.values,renderCases:report.viewports.length});
}
const {chromium}=await import(pathToFileURL(root+"/work/visualbook/runtime/node_modules/playwright-core/index.mjs"));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH??chromium.executablePath()}),states=[];
function plot(v){if(v&&typeof v==='object'){if(Array.isArray(v.layers))return v;for(const x of Object.values(v)){const r=plot(x);if(r)return r;}}}
try{
 for(const c of records){const page=await browser.newPage({viewport:{width:375,height:900}});await page.goto(pathToFileURL(c.file).href);
  for(const batch of c.id==='fp32'?[1,320,1024]:[1,2,3,4]){
   const actual=await page.evaluate(({batch,values})=>{const i=VisualBookRuntime.instances[0];i.setParams({batch});if(i.error)throw Error(i.error);return {facts:i.facts,budget:VisualBookCalculations.compute('matmul-batch-sweep',{...values,batch:i.params.batch}).result};},{batch,values:c.values}),budget=actual.budget, drawn=plot(actual.facts);
   assert.ok(drawn);assert.deepEqual(drawn.layers.find(l=>l.id==='exact').points,budget.intensityCurve);states.push({id:c.id,batch,inputs:c.values,budget,facts:actual.facts});
   if(c.id==='exact-tie'){assert.equal(budget.criticalBatch,2);assert.equal(budget.selected.bound,batch>=2?'compute':'memory');}
   if(c.id==='no-crossing'){assert.equal(budget.criticalBatch,null);assert.ok((await page.locator('.vh-canvas').textContent()).includes('无有限分界'));}
  }await page.close();
 }
}finally{await browser.close();}
fs.writeFileSync(out+"/states.json",JSON.stringify({states,scope:"Actual runtime of the same reused scene. Independent arithmetic is separate; no model calls or art score."},null,2)+"\n");
fs.writeFileSync(out+"/control.json",JSON.stringify({passed:true,modelCalls:0,variants:records.map(c=>({id:c.id,renderCases:c.renderCases,inputs:c.values})),runtimeStates:states.length,
 scope:"Real three-width rendering and actual parameter states for a finite exact tie, impossible crossing, FP32 traffic. Same native scene, changed data only; no claim of broad artistic or generation quality."},null,2)+"\n");
console.log(JSON.stringify({passed:true,variants:3,runtimeStates:states.length,modelCalls:0}));
