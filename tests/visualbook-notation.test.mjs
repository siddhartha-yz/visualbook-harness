import test from 'node:test';
import assert from 'node:assert/strict';
import {bareSpacingCommands,mathNotationFindings} from '../packages/visualbook/notation.mjs';
test('Bare spacing after separators is a finding while real commands stay valid',()=>{
 assert.deepEqual(bareSpacingCommands(String.raw`x=1,\qquad y=2;\quad z=3`),[]);
 assert.deepEqual(bareSpacingCommands('x=1,qquad y=2; quad z=3').map(x=>x.command),['qquad','quad']);
});
test('Literal text and operator labels are protected including nested braces',()=>{
 assert.deepEqual(bareSpacingCommands(String.raw`\text{中文🌱,quad {inner;qquad}}+\operatorname{label,qquad}(x)`),[]);
});
test('Prose and code with the same word are excluded by math-node scope',()=>{
 const tree={type:'root',children:[{type:'code',value:'x,qquad'},{type:'text',value:'word,quad'},{type:'math',value:'x,qquad y',position:{start:{line:7}}}]};
 const findings=mathNotationFindings(tree);assert.equal(findings.length,1);assert.equal(findings[0].line,7);
});
