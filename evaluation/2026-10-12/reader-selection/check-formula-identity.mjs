// Source-preservation check for this two-chapter experiment.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
const root=path.resolve('work/reader-evaluation-20261012');
const get=name=>import(pathToFileURL(path.resolve('work/visualbook/runtime/node_modules',name,'index.js')));
const [{unified},{default:parse},{default:math},{parse:htmlParse}]=await Promise.all([get('unified'),get('remark-parse'),get('remark-math'),import(pathToFileURL(path.resolve('work/visualbook/runtime/node_modules/parse5/dist/index.js')))]);
const parser=unified().use(parse).use(math), input=JSON.parse(fs.readFileSync(root+'/prototype-inputs.json'));
function walk(n,fn){fn(n);for(const c of n.children??n.childNodes??[])walk(c,fn)}
function text(n){if(n.nodeName==='#text')return n.value;return(n.childNodes??[]).map(text).join('')}
const rows=[];
for(const c of input.chapters){
 const raw=fs.readFileSync(c.originalSource,'utf8');
 if(crypto.createHash('sha256').update(raw).digest('hex')!==c.sourceSha256)throw Error('Frozen original source identity changed: '+c.id);
 const original=[];walk(parser.parse(raw),n=>{if(['math','inlineMath'].includes(n.type))original.push(n.value.trim())});
 const rendered=[];walk(htmlParse(fs.readFileSync(path.resolve(process.argv[2]??root+'/book02/_book')+'/'+c.id+'.html','utf8')),n=>{if(n.tagName==='span'&&n.attrs?.some(a=>a.name==='class'&&a.value.split(' ').includes('math'))){const s=text(n).trim();rendered.push(s.slice(2,-2).trim())}});
 const differences=[];for(let i=0;i<Math.max(original.length,rendered.length);i++)if(original[i]!==rendered[i])differences.push({index:i,original:original[i],rendered:rendered[i]});
 rows.push({chapter:c.id,originalCount:original.length,renderedCount:rendered.length,exactOrderedTexEquality:differences.length===0,differences});
}
fs.writeFileSync(root+'/replayed-formula-identity.json',JSON.stringify({scope:'Ordered source AST TeX versus Quarto pre-typeset math spans; trim outer whitespace only. This is source preservation, not mathematical correctness.',rows},null,2)+'\n');
console.log(rows.map(({differences,...row})=>({...row,differenceCount:differences.length})));
if(rows.some(row=>!row.exactOrderedTexEquality))process.exitCode=1;
