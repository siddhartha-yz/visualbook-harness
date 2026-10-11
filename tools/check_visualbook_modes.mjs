/* Positive static/parameter controls and intentionally inert negative controls. */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { build, preview, validatePlan } from "./visualbook.mjs";
const out = path.resolve(
  process.argv[2] ?? "work/harness-v3/modes-" + Date.now(),
);
if (fs.existsSync(out)) throw Error("Output exists");
fs.mkdirSync(out, { recursive: true });
const source = {
  title: "交互模式控制",
  sourceSha256: "maintenance-fixture",
  blocks: Array.from({ length: 4 }, (_, i) => ({
    id: "mode-" + i,
    type: "paragraph",
    raw: "控制",
    html: "<p>维护者的正负控制，不是生成教材。</p>",
    sha256: "maintenance-fixture",
    math: { expected: 0 },
  })),
};
const fixed =
    "function draw({board}){board.circle('point',140,100,12,VisualBook.palette.blue);return {};}",
  moving =
    "function draw({board,params}){board.circle('point',140+params.x*20,100,12,VisualBook.palette.blue);return {x:params.x};}";
const param = { key: "x", label: "位置", min: -2, max: 2, step: 0.1, value: 0 };
const plan = {
  figures: [
    {
      id: "fixed",
      title: "静态关系",
      afterAnchor: "mode-0",
      interaction: "static",
      height: 200,
      code: fixed,
    },
    {
      id: "explore",
      title: "有效参数",
      afterAnchor: "mode-1",
      interaction: "parameters",
      params: [param],
      height: 200,
      code: moving,
    },
    {
      id: "inert-timeline",
      title: "应被拒绝的假进度",
      afterAnchor: "mode-2",
      height: 200,
      code: fixed,
    },
    {
      id: "inert-param",
      title: "应被拒绝的无效参数",
      afterAnchor: "mode-3",
      interaction: "parameters",
      params: [param],
      height: 200,
      code: fixed,
    },
  ],
};
assert.throws(
  () =>
    validatePlan(source, {
      figures: [{ ...plan.figures[0], params: [param] }],
    }),
  /Static/,
);
assert.throws(
  () => validatePlan(source, { figures: [{ ...plan.figures[1], params: [] }] }),
  /needs controls/,
);
const file = path.join(out, "controls.html");
fs.writeFileSync(file, build(source, plan));
const report = await preview(file, path.join(out, "preview"));
assert.equal(
  report.findings.filter((f) => f.id === "fixed" || f.id === "explore").length,
  0,
);
assert.equal(
  report.findings.filter(
    (f) => f.id === "inert-timeline" && f.kind === "no-fractional-change",
  ).length,
  report.viewports.length,
);
assert.equal(report.findings.filter((f) => f.id === "inert-param").length, report.viewports.length);
fs.writeFileSync(
  path.join(out, "checks.json"),
  JSON.stringify(
    {
      positive: ["fixed", "explore"],
      expectedFailures: report.findings,
      modelCalls: 0,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    out,
    positivePassed: 2,
    expectedFailures: report.findings.length,
  }),
);
