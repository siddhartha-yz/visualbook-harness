// Read-only producer preflight using the same parser/rendering rules as the reader.
// No formula rewriting, model call, browser layout test or mathematical proof.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {importMarkdown} from '../packages/visualbook/import.mjs';

const [file]=process.argv.slice(2);
if(!file) throw Error('Use: node tools/check_textbook_math.mjs chapter.md');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
let record={ready:false,modelCalls:0,scope:'Shared Markdown/KaTeX parsing and conservative notation gate; no semantic, theorem, browser layout or teacher certification.'};
try {
  const before=fs.readFileSync(file);
  record.chapterSha256=sha(before);
  const source=importMarkdown(file,{id:'textbook-preflight'});
  if(record.chapterSha256!==source.sourceSha256 || sha(fs.readFileSync(file))!==record.chapterSha256) throw Error('Chapter changed during read-only preflight');
  record={...record,ready:true,formulasExpected:source.adaptation.mathExpected,formulasRendered:source.adaptation.mathRendered,findings:[]};
} catch(error) {
  record={...record,findings:[String(error.message??error)]};
}
process.stdout.write(JSON.stringify(record)+'\n');
if(!record.ready) process.exitCode=2;
