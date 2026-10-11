/* Capture actual finite runtime states. Verification lives in separate Python. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'../../..'),[bookDir,output]=process.argv.slice(2);
const {chromium}=await import(pathToFileURL(root+'/work/visualbook/runtime/node_modules/playwright-core/index.mjs'));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH??chromium.executablePath()});
const records=[],identities={};
try{
 for(const chapter of ['tokenization','position','hardware','communication','cache']){
  const file=path.resolve(bookDir,chapter,'book.html');identities[chapter]=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  await page.goto(pathToFileURL(file).href);await page.evaluate(()=>document.fonts.ready);
  const states=await page.evaluate(chapter=>{
   const result=[];
   function capture(i){result.push(structuredClone({chapter,id:i.id,params:i.params,progress:i.progress,facts:i.facts}));}
   for(const i of VisualBookRuntime.instances){
    if(i.id==='shared-shift'){for(let p=0;p<=8;p++){i.setProgress(p/8);capture(i);}}
    else if(i.id==='frequency-scales'){for(const shift of [0,1,2,4,8,12]){i.setParams({shift});capture(i);}}
    else if(i.id==='gemm-balance'){for(let batch=1;batch<=1024;batch++){i.setParams({batch});capture(i);}}
    else if(i.id==='shared-private'){for(let batch=1;batch<=8;batch++)for(let context=256;context<=4096;context+=256){i.setParams({batch,context});capture(i);}}
    else capture(i);
   }return result;
  },chapter);
  records.push(...states);await page.close();
 }
}finally{await browser.close();}
fs.writeFileSync(output,JSON.stringify({status:'captured',records,identities,scope:'Actual runtime values at finite poses, not independent verification. No source, plan or HTML changes.'},null,2)+'\n');
console.log(JSON.stringify({output,states:records.length}));
