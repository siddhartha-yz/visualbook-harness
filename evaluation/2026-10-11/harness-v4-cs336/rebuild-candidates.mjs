/* Rebuild finite raw candidates from owned plans and the user's unchanged books. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'../../..'), [textbooks,output]=process.argv.slice(2);
if(!textbooks||!output)throw Error('Provide original textbook directory and fresh work/ output');
const out=path.resolve(output),work=fs.realpathSync(root+'/work');
if(fs.existsSync(out)||!out.startsWith(work+path.sep)||fs.realpathSync(path.dirname(out))!==work)throw Error('Use a fresh immediate child of ignored work/');
fs.mkdirSync(out);
const evidence=import.meta.dirname,selection=JSON.parse(fs.readFileSync(evidence+'/selection.json')),
 identities=JSON.parse(fs.readFileSync(evidence+'/candidate-identities.json')).records;
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
execFileSync('python3',[root+'/tools/reproduce_visualbook_snapshot.py',evidence+'/toolchain-04.json',out+'/toolchain'],{stdio:'inherit'});
fs.mkdirSync(out+'/toolchain/work/visualbook',{recursive:true});
fs.symlinkSync(root+'/work/visualbook/runtime',out+'/toolchain/work/visualbook/runtime','dir');
const {importMarkdown}=await import(pathToFileURL(out+'/toolchain/packages/visualbook/import.mjs'));
const {build}=await import(pathToFileURL(out+'/toolchain/tools/visualbook.mjs'));
const records=[];
for(const section of selection.sections){
 const s=section.selected,id=section.id,bytes=fs.readFileSync(path.resolve(textbooks,s.file));
 if(sha(bytes)!==s.fileSha256)throw Error('Original source changed: '+id);
 const lines=bytes.toString('utf8').match(/[^\n]*\n|[^\n]+$/g)??[],raw=lines.slice(s.startLine-1,s.endLine).join('');
 if(sha(raw)!==s.sha256)throw Error('Selected exact section changed: '+id);
 const directory=out+'/'+id;fs.mkdirSync(directory);fs.writeFileSync(directory+'/input.md',raw);
 const source=importMarkdown(directory+'/input.md',{id,sourceName:'CS336 本地二次整理教材',sourceUrl:'',license:null});
 const planFile=evidence+'/plans/'+id+'/book.json',planBytes=fs.readFileSync(planFile),expected=identities.find(r=>r.id===id);
 if(sha(planBytes)!==expected.planSha256)throw Error('Recorded plan changed: '+id);
 const html=build(source,JSON.parse(planBytes));fs.writeFileSync(directory+'/book.html',html);
 fs.writeFileSync(directory+'/source.json',JSON.stringify(source,null,2)+'\n');fs.copyFileSync(planFile,directory+'/book.json');
 if(sha(html)!==expected.rawHtmlSha256)throw Error('Raw candidate HTML changed: '+id);
 records.push({id,sourceSha256:sha(raw),planSha256:sha(planBytes),rawHtmlSha256:sha(html),matches:true});
}
fs.writeFileSync(out+'/report.json',JSON.stringify({passed:true,modelCalls:0,records,scope:'Exact five raw candidate HTMLs from original local books, recorded plans and toolchain-04. Source JSON path metadata differs at a new location. No model reproduction, reader check, art review or navigation/ZIP assembly claimed.'},null,2)+'\n');
console.log(JSON.stringify({passed:true,candidates:records.length,modelCalls:0}));
