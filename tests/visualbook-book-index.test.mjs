import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBookGroups,bookIndex} from '../packages/visualbook/book-index.mjs';
const records=[{id:'alpha',file:'alpha.html',title:'Alpha < chapter'},{id:'beta',file:'beta.html',title:'Beta'}];
test('groups cannot hide, repeat or reorder chapters',()=>{
 for(const chapters of [['alpha'],['alpha','alpha'],['beta','alpha']])assert.throws(()=>validateBookGroups([{title:'Group',chapters}],records),/every chapter/);
 assert.equal(validateBookGroups([{title:'Group',chapters:['alpha','beta']}],records).length,1);
});
test('static index escapes source labels and retains every local link',()=>{
 const html=bookIndex({title:'Title <script>',groups:[{title:'Group < title',chapters:['alpha','beta']}],labels:{alpha:'<img src=x>'}},records,'');
 assert.ok(html.includes('Title &lt;script&gt;'));assert.ok(html.includes('&lt;img src=x&gt;'));assert.ok(html.includes('href="alpha.html"'));assert.ok(html.includes('href="beta.html"'));assert.ok(html.includes('aria-labelledby="book-group-0"'));assert.ok(!html.includes('<script>'));assert.throws(()=>bookIndex({},[{...records[0],file:'https://example.com/'}],''),/local chapter/);
});
