import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {prepareMathMarkdown} from "../packages/visualbook/markdown-math.mjs";
import {importMarkdown} from "../packages/visualbook/import.mjs";
test("embedded multiline math fences preserve original text, offsets and later paragraphs",()=>{
 const raw="# 位置\n\n$$A=\\begin{pmatrix}\n1 & 2 \\\\\n3 & 4\n\\end{pmatrix}$$\n\n后面的正文 $x$ 不能被吞掉。\n";
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vh-fence-'));
 try{const file=path.join(dir,'input.md');fs.writeFileSync(file,raw);const b=importMarkdown(file);
 assert.equal(b.sourceSha256,crypto.createHash('sha256').update(raw).digest('hex'));
 assert.equal(b.adaptation.displayFenceAdapted,1);assert.equal(b.adaptation.mathExpected,2);assert.equal(b.adaptation.mathRendered,2);
 assert.equal(b.blocks[1].raw,raw.slice(raw.indexOf('$$'),raw.lastIndexOf('$$')+2));
 assert.ok(b.blocks[2].raw.startsWith('后面的正文'));assert.equal(b.blocks[2].line,8);
 }finally{fs.rmSync(dir,{recursive:true});}
});
test("code fences are data and unclosed display math fails instead of swallowing source",()=>{
 const raw="```text\n$$ a\nnot closed\n```\n";assert.equal(prepareMathMarkdown(raw).text,raw);
 assert.throws(()=>prepareMathMarkdown('$$a\nno closing'),/Unclosed/);
 const input="前文 $x$\n\n$$a$$\n";assert.equal(prepareMathMarkdown(input).text,input);
});
test("display fences inside list items retain indentation and all later source",()=>{
 const raw="1. 推导：\n\n   $$A=\\begin{pmatrix}\n   1 & 2 \\\\\n   3 & 4\n   \\end{pmatrix}$$\n\n2. 下一条 $x$。\n\n最后的正文。\n";
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vh-list-math-'));
 try{const file=path.join(dir,'input.md');fs.writeFileSync(file,raw);const b=importMarkdown(file);
 assert.equal(b.adaptation.mathExpected,2);assert.equal(b.adaptation.mathRendered,2);
 assert.equal(b.blocks.at(-1).raw,'最后的正文。');assert.ok(b.blocks[0].raw.includes('2. 下一条'));
 assert.equal(b.blocks[0].type,'list');
 }finally{fs.rmSync(dir,{recursive:true});}
});
test("a quoted multiline formula retains its source even when continuation lines omit quote markers",()=>{
 const raw="> 关系：\n> \n> $$f = a_{\nbla}+b_{\nbla}=2x$$\n\n后文 $y$。\n";
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vh-quote-math-'));
 try{const file=path.join(dir,'input.md');fs.writeFileSync(file,raw);const b=importMarkdown(file);
 assert.equal(b.adaptation.mathExpected,2);assert.equal(b.adaptation.mathRendered,2);
 assert.equal(b.adaptation.quotedMathLinesJoined,2);
 assert.equal(b.blocks[0].type,'blockquote');assert.equal(b.blocks[0].raw,raw.slice(0,raw.indexOf('\n\n后文')));
 assert.equal(b.blocks.at(-1).raw,'后文 $y$。');
 assert.equal(b.sourceSha256,crypto.createHash('sha256').update(raw).digest('hex'));
 // The adapter fixes the Markdown container, never guesses missing TeX letters.
 assert.ok(b.blocks[0].html.includes('bla'));
 const code="> ```text\n> $$ not math\n> ```\n";assert.equal(prepareMathMarkdown(code).text,code);
 }finally{fs.rmSync(dir,{recursive:true});}
});
