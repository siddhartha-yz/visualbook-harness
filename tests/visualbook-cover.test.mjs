import test from "node:test";
import assert from "node:assert/strict";
import { build } from "../tools/visualbook.mjs";
test("an extracted H3 is one accessible chapter cover, preserving its source anchor and content", () => {
  const source={title:"当前章节",sourceSha256:"cover-control",blocks:[
    {id:"chapter-one",type:"heading",depth:3,raw:"### 当前章节",html:"<h3>当前章节</h3>",sha256:"heading-control",math:{expected:0}},
    {id:"paragraph",type:"paragraph",raw:"正文",html:"<p>正文</p>",sha256:"paragraph-control",math:{expected:0}},
  ]};
  const unchanged=JSON.stringify(source),html=build(source,{figures:[]});
  assert.equal((html.match(/<h1>当前章节<\/h1>/g)??[]).length,1);
  assert.equal((html.match(/id="chapter-one"/g)??[]).length,1);
  assert.ok(!html.includes("<h3>当前章节</h3>"));
  assert.equal(JSON.stringify(source),unchanged);
});
