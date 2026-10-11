import test from 'node:test';import assert from 'node:assert/strict';
import {bookNavigation} from '../packages/visualbook/book-navigation.mjs';
test('navigation preserves source links and exact reviewed main, with safe native links',()=>{
 const html='<head></head><body><header><a href="index.html">VisualBook</a><a href="https://example.org">原版</a></header><main data-source-sha="abc"><p>原文</p><svg>图</svg></main><script>runtime</script></body>';
 const chapters=[{id:'one',title:'第一章'},{id:'two',title:'<第二章>'},{id:'three',title:'最后章'}];
 for(let i=0;i<3;i++){
  const built=bookNavigation(html,chapters,i);
  assert.equal(built.match(/<main[\s\S]*?<\/main>/)[0],html.match(/<main[\s\S]*?<\/main>/)[0]);
  assert.ok(built.includes('href="https://example.org"'));assert.ok(built.includes('<script>runtime</script>'));
  assert.equal(built.includes('rel="prev"'),i>0);assert.equal(built.includes('rel="next"'),i<2);
 }
 assert.ok(bookNavigation(html,chapters,0).includes('&lt;第二章&gt;'));
 assert.throws(()=>bookNavigation(html,[{id:'../escape',title:'x'}],0));
 assert.throws(()=>bookNavigation(html,chapters,3));
});
