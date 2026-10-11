import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {extractSourceMatrices} from '../packages/visualbook/source-matrices.mjs';
const source=raw=>({sourceSha256:'synthetic-source',blocks:[{id:'source-001',type:'math',raw,sha256:crypto.createHash('sha256').update(raw).digest('hex')}]});

test('Read multiple original numeric matrices without rewriting the source',()=>{
 const book=source(String.raw`A=\begin{pmatrix}1&2\\-3&4\end{pmatrix},B=\begin{bmatrix}5\\6\end{bmatrix}`),before=JSON.stringify(book);
 const r=extractSourceMatrices(book,'source-001');
 assert.deepEqual(r.matrices.map(x=>x.valuesExact),[[['1','2'],['-3','4']],[['5'],['6']]]);
 assert.equal(JSON.stringify(book),before);assert.equal(r.truncated,false);
});
test('Exact fractions and decimals preserve value and signs',()=>{
 const r=extractSourceMatrices(source(String.raw`\begin{pmatrix}-\frac{3}{2}&\dfrac{-2}{4}\\0.1&+2\end{pmatrix}`),'source-001');
 assert.deepEqual(r.matrices[0].valuesExact,[['-3/2','-1/2'],['1/10','2']]);
});
test('Array separator identifies actual coefficient and RHS columns',()=>{
 const r=extractSourceMatrices(source(String.raw`\left(\begin{array}{cc|c}1&2&3\\2&4&7\end{array}\right)`),'source-001');
 assert.equal(r.matrices[0].coefficientColumns,2);assert.deepEqual(r.matrices[0].separatorColumns,[2]);
});
test('Variables, expressions and interior spacing are not guessed as numbers',()=>{
 for(const cell of [String.raw`a_{11}`,String.raw`1+2`,String.raw`1\quad2`,String.raw`\sqrt{2}`,String.raw`\text{execute something}`]) {
  const r=extractSourceMatrices(source(String.raw`\begin{pmatrix}`+cell+String.raw`\end{pmatrix}`),'source-001');
  assert.equal(r.matrices[0].status,'unsupported');assert.equal(r.matrices[0].valuesExact,undefined);
 }
});
test('Malformed, nested and shape-inconsistent matrices remain explicit failures',()=>{
 for(const raw of [String.raw`\begin{pmatrix}1&2\\3\end{pmatrix}`,String.raw`\begin{array}{ccc}1&2\end{array}`,String.raw`\begin{pmatrix}1`,String.raw`\begin{pmatrix}\begin{pmatrix}1\end{pmatrix}\end{pmatrix}`])
  assert.equal(extractSourceMatrices(source(raw),'source-001').matrices[0].status,'unsupported');
});
test('Reject stale, duplicate, missing or code source anchors',()=>{
 const book=source(String.raw`\begin{pmatrix}1\end{pmatrix}`);
 assert.throws(()=>extractSourceMatrices(book,'unknown'),/actual source anchor/);
 book.blocks.push({...book.blocks[0]});assert.throws(()=>extractSourceMatrices(book,'source-001'),/exactly one/);book.blocks.pop();
 book.blocks[0].raw+=' ';assert.throws(()=>extractSourceMatrices(book,'source-001'),/hash changed/);
 const code=source(String.raw`\begin{pmatrix}1\end{pmatrix}`);code.blocks[0].type='code';assert.throws(()=>extractSourceMatrices(code,'source-001'),/not code/);
});
