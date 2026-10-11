/* Literal numeric matrices only. This is not a general TeX interpreter. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const A=createRequire(import.meta.url)('./algebra.cjs');
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');

function cellLiteral(cell) {
  let text=cell.replace(/\s+/g,'').replace(/^(?:\\(?:,|!|;|:|quad|qquad))+/,'').replace(/(?:\\(?:,|!|;|:|quad|qquad))+$/,'');
  const fraction=/^([+-]?)\\(?:dfrac|tfrac|frac)\{([+-]?\d{1,32})\}\{(\d{1,32})\}$/.exec(text);
  if(fraction) {
    const numerator=BigInt(fraction[2])*(fraction[1]==='-'?-1n:1n);
    text=String(numerator)+'/'+fraction[3];
  } else text=text.replace(/^\+/,'');
  return A.coefficientLiterals([text]).values[0];
}

export function extractSourceMatrices(source,anchor) {
  if(!Array.isArray(source?.blocks)||typeof anchor!=='string')throw Error('Source blocks and actual anchor required');
  const blocks=source.blocks.filter(b=>b.id===anchor);
  if(blocks.length!==1)throw Error('Use exactly one actual source anchor');
  const block=blocks[0];
  if(typeof block.raw!=='string'||block.raw.length>32768||digest(block.raw)!==block.sha256)throw Error('Source block is too large or its raw hash changed');
  if(!['math','paragraph','list','table'].includes(block.type))throw Error('Matrix extraction requires a mathematical prose block, not code');
  const pattern=/\\begin\{(pmatrix|bmatrix|vmatrix|Vmatrix|array)\}/g;
  const matches=[...block.raw.matchAll(pattern)],records=[];
  for(const [index,match] of matches.slice(0,4).entries()) {
    const environment=match[1],from=match.index+match[0].length,endToken='\\end{'+environment+'}',end=block.raw.indexOf(endToken,from);
    const record={index,environment,raw:end<0?block.raw.slice(match.index):block.raw.slice(match.index,end+endToken.length),status:'unsupported'};
    try {
      if(end<0)throw Error('Missing matching matrix end');
      let body=block.raw.slice(from,end),spec=null,separators=[];
      if(environment==='array') {
        const columns=/^\s*\{([clr|: ]+)\}/.exec(body);
        if(!columns)throw Error('Only literal c/l/r array column specifications are supported');
        spec=columns[1].replace(/ /g,'');body=body.slice(columns[0].length);
        let column=0;for(const char of spec){if(/[clr]/.test(char))column++;else if(char==='|')separators.push(column);}
      }
      if(/\\(?:begin|end)\{|\\hline|\\multicolumn|\\cline/.test(body))throw Error('Nested or styled matrices need explicit review');
      const rows=body.trim().split(/\\\\(?:\[[+-]?[\d.]+(?:em|ex|pt|mm)\])?/);
      if(rows.at(-1).trim()==='')rows.pop();
      const cells=rows.map(row=>row.split('&'));
      if(!cells.length||cells.length>6||!cells[0].length||cells[0].length>8||cells.some(row=>row.length!==cells[0].length))throw Error('Use a rectangular 1..6 by 1..8 matrix');
      if(spec&&[...spec].filter(x=>/[clr]/.test(x)).length!==cells[0].length)throw Error('Array column count differs from numeric cells');
      const exact=cells.map(row=>row.map(cellLiteral));
      const values=exact.map(row=>row.map(value=>{const [n,d='1']=value.split('/');return Number(n)/Number(d);}));
      separators=[...new Set(separators)];
      if(separators.some(i=>i===0||i===cells[0].length))throw Error('Outer array borders are not coefficient/RHS separators');
      Object.assign(record,{status:'literal-numeric-matrix',rows:cells.length,columns:cells[0].length,valuesExact:exact,values,
        separatorColumns:separators,coefficientColumns:separators.length===1?separators[0]:null,
        interpretation:environment==='vmatrix'||environment==='Vmatrix'?'Vertical delimiter syntax; mathematical meaning still needs source review.':'Literal matrix cells; no inferred theorem or parameter meaning.'});
    } catch(error){record.reason=String(error.message??error);}
    records.push(record);
  }
  return {anchor,sourceSha256:source.sourceSha256,blockSha256:block.sha256,matrices:records,totalMatches:matches.length,truncated:matches.length>4,
    scope:'Exact literal extraction from one immutable source block, not symbolic evaluation, source truth or mathematical certification. Unsupported cells are never guessed.'};
}

if(process.argv[1]===import.meta.filename) {
  const file=process.argv[2],bytes=fs.readFileSync(file),result=extractSourceMatrices(JSON.parse(bytes),process.argv[3]);
  console.log(JSON.stringify({...result,sourceJsonSha256:digest(bytes),parserSha256:digest(fs.readFileSync(import.meta.filename))}));
}
