/* Whole-book navigation, separate from immutable chapter prose and figures. */
import fs from 'node:fs';
const esc = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');

export function validateBookGroups(groups, records) {
  if(groups === undefined || groups === null)return null;
  if(!Array.isArray(groups)||groups.length<1||groups.length>12)throw Error('Use1..12 explicit book groups');
  for(const group of groups) {
    if(typeof group.title!=='string'||!group.title.trim()||group.title.length>80||!Array.isArray(group.chapters)||group.chapters.length<1)throw Error('Book groups need short titles and nonempty chapter lists');
    if(group.description!==undefined&&(typeof group.description!=='string'||group.description.length>180))throw Error('Group description must be a short plain-text sentence');
  }
  const assigned=groups.flatMap(group=>group.chapters),actual=records.map(record=>record.id);
  if(assigned.length!==actual.length||assigned.some((id,index)=>id!==actual[index]))throw Error('Groups must cover every chapter exactly once in its original order');
  return groups;
}

export function bookIndex(manifest, records, css) {
  if(!Array.isArray(records)||records.length<1||records.length>32||new Set(records.map(r=>r.id)).size!==records.length||records.some(r=>!(/^[a-z][a-z0-9-]*$/.test(r.id))||r.file!==r.id+'.html'))throw Error('Book index requires1..32 distinct local chapter files');
  const groups=validateBookGroups(manifest.groups,records);
  const title=manifest.title??'读懂变化',description=manifest.description??'保留完整教材，边读边看关系怎样变化。';
  const lookup=new Map(records.map((record,index)=>[record.id,{...record,index}]));
  const longBook=records.length>8||groups!==null;
  const chapter=id=>{
    const c=lookup.get(id),tag=longBook?'h3':'h2';
    return `<article class="book-link">${longBook?`<span class="book-number" aria-hidden="true">${String(c.index+1).padStart(2,'0')}</span>`:''}<div><${tag}><a href="${esc(c.file)}">${esc(c.title)}</a></${tag}>${manifest.labels?.[id]?`<p>${esc(manifest.labels[id])}</p>`:''}</div></article>`;
  };
  const contents=groups?groups.map((group,index)=>`<section class="book-group" aria-labelledby="book-group-${index}"><header><div class="book-group-number">${String(index+1).padStart(2,'0')}</div><h2 id="book-group-${index}">${esc(group.title)}</h2>${group.description?`<p>${esc(group.description)}</p>`:''}</header><div class="book-chapters">${group.chapters.map(chapter).join('')}</div></section>`).join(''):`<section class="book-chapters" aria-label="章节目录">${records.map(record=>chapter(record.id)).join('')}</section>`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'"><title>${esc(title)}</title><style>${css}</style></head><body><main class="library${longBook?' book-long':''}"><header class="book-cover"><div class="eyebrow">VISUALBOOK</div><h1>${esc(title)}</h1><p>${esc(description)}</p>${longBook?`<div class="book-count">${records.length} 章 · 从目录选择，也可以按章节顺序读</div>`:''}</header>${contents}<p class="source-note">课程来源与回看位置随章保留。图解先给稳定画面，必要时可主动查看变化。</p></main></body></html>`;
}

if(process.argv[1]===import.meta.filename) {
  const manifest=process.argv[2]==='--groups'
    ? {groups:JSON.parse(fs.readFileSync(process.argv[3])),chapters:JSON.parse(fs.readFileSync(process.argv[4])).chapters}
    : JSON.parse(fs.readFileSync(process.argv[2]));
  const groups=validateBookGroups(manifest.groups,manifest.chapters);
  console.log(JSON.stringify({groups:groups?.length??0,chapters:manifest.chapters.length,modelCalls:0}));
}
