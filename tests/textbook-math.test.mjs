import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function inspect(text) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'synthetic-textbook-math-'));
  try {
    const file=path.join(dir,'chapter.md');fs.writeFileSync(file,text);
    const before=fs.readFileSync(file);
    const result=spawnSync(process.execPath,[path.join(root,'tools/check_textbook_math.mjs'),file],{encoding:'utf8'});
    assert.equal(result.signal,null,result.stderr);
    const record=JSON.parse(result.stdout);
    assert.equal(record.chapterSha256,crypto.createHash('sha256').update(before).digest('hex'));
    assert.deepEqual(fs.readFileSync(file),before);
    assert.equal(record.modelCalls,0);
    return {status:result.status,record};
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
}
test('missing spacing backslash is rejected with original line, source is untouched',()=>{
  const {status,record}=inspect('# Synthetic notation fixture\n\n$$\nx=1, qquad y=2\n$$\n');
  assert.equal(status,2);assert.equal(record.ready,false);
  assert.match(record.findings[0],/math line 3: qquad/);
});
test('intentional words, code and correct TeX commands are accepted',()=>{
  const {status,record}=inspect('# Synthetic notation fixture\n\nThe prose word qquad and code `$x=1, qquad y=2$` are intentional.\n\n'+String.raw`
$$
x=1,\qquad y=2
$$

$\text{quad {label}}+\operatorname{qquad}(x)$
`);
  assert.equal(status,0);assert.equal(record.ready,true);
  assert.equal(record.formulasExpected,2);assert.equal(record.formulasRendered,2);
});
test('unsupported TeX cannot pass a renderable-formula gate',()=>{
  const {status,record}=inspect(String.raw`# Synthetic notation fixture

$$
\DefinitelyUnsupportedMacro{x}
$$
`);
  assert.equal(status,2);assert.equal(record.ready,false);assert.match(record.findings[0],/Undefined control sequence/);
});
test('rendering success makes no assertion that a denominator is nonzero',()=>{
  const {status,record}=inspect(String.raw`# Synthetic notation fixture

$\frac{1}{0}$
`);
  assert.equal(status,0);assert.equal(record.ready,true);
  assert.match(record.scope,/no semantic, theorem/);
});
