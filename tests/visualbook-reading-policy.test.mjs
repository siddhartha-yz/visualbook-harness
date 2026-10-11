import test from 'node:test';import assert from 'node:assert/strict';import {createRequire}from'node:module';
const {readingSpec,assignMarginSides}=createRequire(import.meta.url)('../packages/visualbook/reading.cjs');
test('automatic margins use both sides, preserve explicit sides and share an anchor without mutation',()=>{
 const first={},second={},left={marginSide:'left'},peer={},third={};
 const entries=[{anchorIndex:3,item:second},{anchorIndex:1,item:first},{anchorIndex:5,item:left},{anchorIndex:5,item:peer},{anchorIndex:8,item:third}];
 const before=JSON.stringify(entries),r=assignMarginSides(entries);
 assert.equal(r.get(first),'right');assert.equal(r.get(second),'left');assert.equal(r.get(left),'left');assert.equal(r.get(peer),'right');assert.equal(r.get(third),'left');
 assert.equal(JSON.stringify(entries),before);assert.equal(readingSpec({placement:'margin'}).marginSide,'auto');
 assert.throws(()=>readingSpec({placement:'margin',marginSide:'auto'}));
 assert.throws(()=>readingSpec({placement:'body',marginSide:'right'}));
});
