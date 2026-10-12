import test from "node:test";
import assert from "node:assert/strict";
import {
  renderingMath,
  countMath,
  inspectMath,
} from "../packages/visualbook/math.mjs";
test("standalone display adaptation contains HTML math metadata rather than raw text", () => {
  const node = { type: "math", value: "\\frac{1}{2} + \\sum_i x_i" };
  const converted = renderingMath(node);
  assert.equal(
    converted.data.hChildren[0].properties.className[1],
    "math-display",
  );
  assert.equal(converted.data.hChildren[0].children[0].value, node.value);
  assert.deepEqual(node, { type: "math", value: "\\frac{1}{2} + \\sum_i x_i" });
});
test("line-break adaptation changes the value actually consumed by HTML compiler", () => {
  const converted = renderingMath({
    type: "math",
    value: "a=b\\\\ c=d",
    data: { hChildren: [{ value: "old" }] },
  });
  assert.equal(
    converted.data.hChildren[0].children[0].value,
    "\\begin{aligned}\na=b\\\\ c=d\n\\end{aligned}",
  );
});
test("formula with no renderer error still fails when it was not rendered", () => {
  assert.throws(
    () =>
      inspectMath(
        { type: "root", children: [{ type: "text", value: "\\frac{1}{2}" }] },
        1,
      ),
    /expected=1, rendered=0/,
  );
  assert.throws(
    () =>
      inspectMath(
        { properties: { className: ["language-math"] }, children: [] },
        1,
      ),
    /pending=1/,
  );
});
test("counts nested inline formulas separately from code text", () => {
  assert.equal(
    countMath({
      type: "paragraph",
      children: [
        { type: "inlineMath", value: "x" },
        { type: "inlineCode", value: "$x$" },
        { type: "strong", children: [{ type: "inlineMath", value: "y" }] },
      ],
    }),
    2,
  );
});
test("a trailing display index range remains one unit without changing source", () => {
  const source = {type:"math", value:"x_k=d_k,\\qquad k=1,\\ldots,r,"}, report={};
  const rendered=renderingMath(source,report);
  assert.equal(source.value,"x_k=d_k,\\qquad k=1,\\ldots,r,");
  assert.equal(rendered.data.hChildren[0].children[0].value,"x_k=d_k,\\allowbreak\\qquad {k=1,\\ldots,r,}");
  assert.equal(report.indexRangeGrouped,1);
});
test("index grouping leaves inline math and explicit environments alone", () => {
  for(const node of [{type:"inlineMath",value:"k=1,\\ldots,r"},{type:"math",value:"\\begin{aligned}x_k=d_k,\\qquad k=1,\\ldots,r\\end{aligned}"}]){
    const report={};renderingMath(node,report);assert.equal(report.indexRangeGrouped,undefined);
  }
});

test("a parenthesized index stays together beside a matrix",()=>{
 const source={type:"math",value:"\\alpha_j=\\begin{pmatrix}a_{1j}\\\\a_{2j}\\end{pmatrix}\\in F^s\\quad(j=1,\\ldots,n),\\qquad\\beta"},copy=structuredClone(source),report={};
 const r=renderingMath(source,report);assert.deepEqual(source,copy);
 assert.ok(r.data.hChildren[0].children[0].value.includes("\\allowbreak\\quad{(j=1,\\ldots,n)}"));
 assert.equal(report.parenthesizedIndexGrouped,1);
});
