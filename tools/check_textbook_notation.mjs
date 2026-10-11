import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {prepareMathMarkdown} from '../packages/visualbook/markdown-math.mjs';
import {mathNotationFindings} from '../packages/visualbook/notation.mjs';
const root=path.resolve(import.meta.dirname,'..'),runtime=path.join(root,'work/visualbook/runtime/node_modules');
const load=name=>import(pathToFileURL(path.join(runtime,name,'index.js')));
const [{unified},{default:parse},{default:math}]=await Promise.all([load('unified'),load('remark-parse'),load('remark-math')]);
const raw=fs.readFileSync(process.argv[2],'utf8');
const tree=unified().use(parse).use(math).parse(prepareMathMarkdown(raw).text);
const findings=mathNotationFindings(tree);
console.log(JSON.stringify({status:findings.length?'failed':'passed',sourceSha256:crypto.createHash('sha256').update(raw).digest('hex'),findings,
 scope:'Conservative missing-backslash spacing-command check inside parsed math nodes; text/operator labels and code are excluded. Not a full TeX or mathematical check; no automatic source modification.',modelCalls:0}));
if(findings.length)process.exitCode=1;
