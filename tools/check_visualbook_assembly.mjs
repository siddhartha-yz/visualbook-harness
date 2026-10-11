/* End-to-end chapter navigation and deterministic local packaging; no author. */
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';
import {spawnSync}from'node:child_process';import{pathToFileURL}from'node:url';
import{importMarkdown}from'../packages/visualbook/import.mjs';
import{captureReaderPng}from'./visualbook_capture.mjs';
const root=path.resolve(import.meta.dirname,'..'),out=path.resolve(process.argv[2]);
if(fs.existsSync(out))throw Error('Use fresh evidence');fs.mkdirSync(out,{recursive:true});
const chapters=[];
for(const id of ['one','two']){
 const md=out+'/'+id+'.md';fs.writeFileSync(md,'### '+id+'\n\n本章原文与图解。\n');
 const source=importMarkdown(md,{id}),sourceFile=out+'/'+id+'.source.json',planFile=out+'/'+id+'.plan.json';fs.writeFileSync(sourceFile,JSON.stringify(source));
 fs.writeFileSync(planFile,JSON.stringify({figures:[{id:'sample',afterAnchor:source.blocks[1].id,title:'静态关系',interaction:'static',code:"function draw({board}){board.circle('node',board.width/2,110,32,VisualBook.palette.blue);return {nodes:1};}"}]}));
 chapters.push({id,source:sourceFile,plan:planFile,arm:'maintainer-fixture'});
}
fs.writeFileSync(out+'/manifest.json',JSON.stringify({title:'两章阅读控制',navigation:true,chapters}));
const assembly=spawnSync(process.execPath,[root+'/tools/assemble_visualbook.mjs',out+'/manifest.json',out+'/book'],{encoding:'utf8'});
fs.writeFileSync(out+'/assembly.log',assembly.stdout+assembly.stderr);assert.equal(assembly.status,0);
const record=JSON.parse(fs.readFileSync(out+'/book/build-record.json')),sha=v=>crypto.createHash('sha256').update(v).digest('hex');
assert.ok(record.records.every(r=>r.exported.sha256===r.finalHtmlSha256&&r.exported.preNavigationSha256!==r.finalHtmlSha256));
function pack(name,exit){const r=spawnSync('python3',[root+'/tools/package_visualbook.py',out+'/book',out+'/'+name+'.zip'],{encoding:'utf8'});fs.writeFileSync(out+'/'+name+'.log',r.stdout+r.stderr);assert.equal(r.status,exit);return r.status?null:JSON.parse(r.stdout);}
const a=pack('archive-a',0),b=pack('archive-b',0);assert.equal(a.archiveSha256,b.archiveSha256);
const{chromium}=await import(pathToFileURL(root+'/work/visualbook/runtime/node_modules/playwright-core/index.mjs'));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH??chromium.executablePath()}),checks=[],captureFailures=[];
try{
 for(const width of [375,1280,1920])for(const javaScriptEnabled of [true,false])for(let n=0;n<2;n++){
  const page=await browser.newPage({viewport:{width,height:900},javaScriptEnabled}),requests=[];page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
  await page.goto(pathToFileURL(out+'/book/'+chapters[n].id+'.html').href);await page.waitForFunction(()=>document.fonts.status==='loaded',{},{timeout:20000,polling:100});
  // Disabled-page callbacks do not run; allow a bounded compositor settle without page JS.
  await page.waitForTimeout(100);
  assert.equal(await page.locator('h1').count(),1);assert.equal(await page.locator('.vh-book-links [rel=prev]').count(),n);
  assert.equal(await page.locator('.vh-book-links [rel=next]').count(),1-n);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));assert.equal(requests.length,0);
  const source=JSON.parse(fs.readFileSync(chapters[n].source));
  assert.equal(await page.locator('body').getAttribute('data-source-sha'),source.sourceSha256);
  for(const block of source.blocks)assert.equal(await page.locator('#'+block.id).getAttribute('data-source-sha256'),block.sha256);
  if(!javaScriptEnabled)assert.ok(await page.locator('.vh-static img').evaluateAll(ns=>ns.length===1&&ns.every(n=>n.complete&&n.naturalWidth>0&&n.alt==='静态关系的静态图')));
  if(width===375||width===1920)await captureReaderPng(page,{path:out+`/${width}-${chapters[n].id}-${javaScriptEnabled}.png`},captureFailures);
  if(n===0){await page.locator('.vh-book-links [rel=next]').click();assert.ok(page.url().endsWith('two.html'));}
  else{await page.locator('.vh-book-continue a').click();assert.ok(page.url().endsWith('index.html'));}
  checks.push({width,javaScriptEnabled,chapter:chapters[n].id,sourceIdentityPreserved:true,actualNativeNavigation:true,externalRequests:requests.length});await page.close();
 }
}finally{await browser.close();fs.writeFileSync(out+'/reader-cases.json',JSON.stringify(checks,null,2)+'\n');fs.writeFileSync(out+'/capture-failures.json',JSON.stringify(captureFailures,null,2)+'\n');}
const reader=spawnSync('python3',[root+'/tools/deliver_visualbook.py',out+'/book',out+'/delivery'],{encoding:'utf8'});
fs.writeFileSync(out+'/collection.log',reader.stdout+reader.stderr);assert.equal(reader.status,0);
const readerReport=JSON.parse(fs.readFileSync(out+'/delivery/reader/report.json'));assert.equal(readerReport.cases.length,12);assert.equal(readerReport.findings.length,0);
const delivered=JSON.parse(fs.readFileSync(out+'/delivery/delivery-record.json'));assert.equal(delivered.ready,true);assert.equal(delivered.package.archiveSha256,a.archiveSha256);
fs.appendFileSync(out+'/book/one.html','\n');pack('changed-reader',1);assert.ok(!fs.existsSync(out+'/changed-reader.zip'));
const changed=spawnSync('python3',[root+'/tools/deliver_visualbook.py',out+'/book',out+'/delivery-changed'],{encoding:'utf8'});
fs.writeFileSync(out+'/collection-changed.log',changed.stdout+changed.stderr);assert.equal(changed.status,2);
assert.match(JSON.parse(fs.readFileSync(out+'/delivery-changed/reader/report.json')).error,/changed/);
assert.equal(JSON.parse(fs.readFileSync(out+'/delivery-changed/delivery-record.json')).ready,false);assert.ok(!fs.existsSync(out+'/delivery-changed/book.zip'));
fs.writeFileSync(out+'/control.json',JSON.stringify({passed:true,modelCalls:0,readerCases:checks.length,deterministicArchiveSha256:a.archiveSha256,changedHtmlRejected:true,scope:'Actual local assembly, three widths, script on/off, native chapter links, source identity, ZIP reproducibility and changed-HTML refusal. Maintainer fixtures, not model output or learner review.'},null,2)+'\n');
console.log(JSON.stringify({passed:true,modelCalls:0,readerCases:checks.length}));
