/* Actual reading defaults, gutter flow and native disclosure behavior. No model. */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { build, preview, staticExport } from "./visualbook.mjs";
const root = path.resolve(import.meta.dirname,".."), out=path.resolve(process.argv[2]??"work/reading-"+Date.now());
if(fs.existsSync(out))throw Error("Evidence exists");
fs.mkdirSync(out,{recursive:true});
const blocks=Array.from({length:12},(_,i)=>({id:"reading-"+i,type:i%4===0?"heading":"paragraph",depth:2,sha256:"maintenance-reading",raw:i%4===0?"## 局部关系 "+i:"当前段落解释同一幅图中的关系。",math:{expected:0},html:i%4===0?`<h2>局部关系 ${i}</h2>`:`<p>${"当前段落解释同一幅图中的关系，正文保持可读的行宽，图解的位置由工具负责。".repeat(4)}</p>`}));
const base={height:250,afterAnchor:"reading-2",title:"读图之后，有需要再探索",durationMs:1000,initialProgress:.5,params:[{key:"scale",label:"比例",min:1,max:3,step:.1,value:1}],code:"function draw({board,progress,params}){board.line('track',24,135,board.width-24,135);board.circle('point',24+(board.width-48)*progress,135,9,VisualBook.palette.orange);board.text('number',(progress*params.scale).toFixed(2),board.width/2,70,{anchor:'middle',size:20});return {value:progress*params.scale};}"};
const plan={figures:[{...base,id:"quiet",placement:"wide"},{...base,id:"full",afterAnchor:"reading-6",presentation:"exploration"},{id:"aside",title:"局部几何",afterAnchor:"reading-9",height:200,interaction:"static",placement:"margin",code:"function draw({board}){const x=board.width/2;board.circle('ring',x,90,54,VisualBook.palette.faint);board.line('radius',x,90,x+38,52,VisualBook.palette.orange,3);board.text('label','一个二维平面',x,175,{anchor:'middle',size:13});return {radius:54};}"}],annotations:[{id:"note-auto-next",afterAnchor:"reading-7",kind:"condition",text:"未指定左右时，提示自动进入另一侧页边。",placement:"margin"},{id:"note-left",afterAnchor:"reading-9",kind:"condition",text:"左侧也可以放局部提示，仍与当前段落对齐。",placement:"margin",marginSide:"left"},{id:"note-bound",afterAnchor:"reading-5",kind:"condition",text:"这一提示紧贴原文。窄屏时仍能读到，不藏进菜单。",placement:"margin"}]};
const file=path.join(out,"reading.html");fs.writeFileSync(file,build({title:"阅读模式与页面空间",sourceSha256:"maintenance-reading",blocks},plan));
const report=await preview(file,path.join(out,"preview"));
fs.writeFileSync(path.join(out,"preview-status.json"),JSON.stringify({findings:report.findings},null,2));
assert.deepEqual(report.findings,[]);
const exported=path.join(out,"offline.html");staticExport(file,path.join(out,"preview"),exported);
const engine=process.argv[3]??"chromium";if(!["chromium","firefox"].includes(engine))throw Error("Use chromium or firefox");
const { [engine]:launcher }=await import(pathToFileURL(path.join(root,"work/visualbook/runtime/node_modules/playwright-core/index.mjs")));
const browser=await launcher.launch({headless:true,executablePath:engine==="chromium"?(process.env.CHROMIUM_PATH??launcher.executablePath()):launcher.executablePath()}),checks=[];
try{
for(const width of [375,960,1200,1280,1920]){
 const page=await browser.newPage({viewport:{width,height:1000}});await page.goto(pathToFileURL(file).href);
 const quiet=page.locator('#figure-quiet'), more=quiet.locator('details');await quiet.scrollIntoViewIfNeeded();
 assert.equal(await more.getAttribute('open'),null);
 assert.equal(await quiet.locator('.vh-progress').isVisible(),false);
 assert.equal(await quiet.locator('.vh-play').isVisible(),true);
 const initial=await page.evaluate(()=>({p:VisualBookRuntime.instances[0].progress,facts:VisualBookRuntime.instances[0].facts}));
 await page.mouse.wheel(0,90);await page.waitForTimeout(80);
 assert.deepEqual(await page.evaluate(()=>({p:VisualBookRuntime.instances[0].progress,facts:VisualBookRuntime.instances[0].facts})),initial);
 await quiet.locator('summary').click();assert.equal(await quiet.locator('.vh-progress').isVisible(),true);
 assert.deepEqual(await page.evaluate(()=>({p:VisualBookRuntime.instances[0].progress,facts:VisualBookRuntime.instances[0].facts})),initial);
 await quiet.locator('[data-param="scale"]').focus();await page.keyboard.press('ArrowRight');
 assert.ok(await page.evaluate(()=>VisualBookRuntime.instances[0].facts.value>.5));
 await quiet.locator('.vh-reset').click();await quiet.locator('summary').click();
 await quiet.locator('.vh-play').evaluate(n=>n.addEventListener('click',()=>window.__readingPlayStart=VisualBookRuntime.instances[0].progress));
 await quiet.locator('.vh-play').click();assert.equal(await page.evaluate(()=>window.__readingPlayStart),0);
 await page.waitForFunction(()=>VisualBookRuntime.instances[0].progress===1&&!VisualBookRuntime.instances[0].playing);
 await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>VisualBookRuntime.instances[0].progress),1);
 const layout=await page.evaluate(()=>{const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};return{main:rect('main'),source:rect('#reading-2'),wide:rect('#figure-quiet'),text:rect('#reading-9'),margin:rect('#figure-aside'),next:rect('#reading-10'),note:rect('#note-bound'),noteLeft:rect('#note-left'),noteAuto:rect('#note-auto-next'),autoSource:rect('#reading-7'),autoNext:rect('#reading-8'),toc:rect('.vh-toc')};});
 assert.ok(layout.source.width<=744);
 if(width>=1200){assert.ok(layout.wide.width>layout.source.width+200);assert.ok(layout.margin.x>=layout.text.x+layout.text.width);assert.ok(layout.noteLeft.x+layout.noteLeft.width<=layout.text.x);assert.ok(layout.noteAuto.x+layout.noteAuto.width<=layout.autoSource.x);}
 else {assert.ok(layout.margin.y>=layout.text.y+layout.text.height);assert.ok(layout.noteLeft.y>=layout.text.y+layout.text.height);assert.ok(layout.noteAuto.y>=layout.autoSource.y+layout.autoSource.height);assert.ok(layout.autoNext.y>=layout.noteAuto.y+layout.noteAuto.height-2);}
 assert.ok(layout.next.y>=Math.max(layout.margin.y+layout.margin.height,layout.noteLeft.y+layout.noteLeft.height)-2);
 assert.ok(await page.locator('#figure-full .vh-progress').isVisible());
 await page.screenshot({path:path.join(out,`${width}-reading-context.png`)});
 checks.push({width,layout,quietVisibleControls:1,initialState:initial,disclosurePreservedState:true,parameterChangedNumerics:true,playStoppedAtEnd:true,scrollDidNotAdvance:true});await page.close();
 const nojs=await browser.newPage({viewport:{width,height:1000},javaScriptEnabled:false});await nojs.goto(pathToFileURL(exported).href);
 const images=await nojs.locator('.vh-static img').evaluateAll(ns=>ns.map(n=>({decoded:n.complete&&n.naturalWidth>0,alt:n.alt})));
 assert.ok(images.length===3&&images.every(i=>i.decoded));assert.equal(await nojs.locator('#note-bound').isVisible(),true);
 assert.equal(await nojs.locator('.vh-reading-actions').first().isVisible(),false);await nojs.close();
}
const reduced=await browser.newPage({reducedMotion:'reduce'});await reduced.goto(pathToFileURL(file).href);assert.equal(await reduced.locator('#figure-quiet .vh-play').isDisabled(),true);await reduced.close();
}finally{await browser.close();fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({engine,checks,scope:'Maintainer fixtures, actual native browser input; finite widths, not artistic or learner validation'},null,2)+'\n');}
console.log(JSON.stringify({out,widths:checks.length,modelCalls:0}));
