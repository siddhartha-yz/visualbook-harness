/* Actual typed controls, linked cells and keyboard selection in Chromium. */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { build, preview, validatePlan } from "./visualbook.mjs";
const root = path.resolve(import.meta.dirname, ".."),
  out = path.resolve(
    process.argv[2] ?? "work/harness-v3/choices-" + Date.now(),
  );
if (fs.existsSync(out)) throw Error("Output exists");
fs.mkdirSync(out, { recursive: true });
const source = {
  title: "选择器与积木联动控制",
  sourceSha256: "maintenance-control",
  blocks: [
    {
      id: "choice-1",
      raw: "控制",
      type: "paragraph",
      html: "<p>维护者实际浏览器控制，不是模型生成。</p>",
      sha256: "maintenance-control",
      math: { expected: 0 },
    },
  ],
};
const figure = {
  id: "choice",
  title: "文字、布尔和数值选择都保持原本的类型",
  afterAnchor: "choice-1",
  height: 400,
  mobileHeight: 560,
  interaction: "parameters",
      presentation: "exploration",
  state: { cell: [0, 0] },
  params: [
    {
      key: "mode",
      label: "模式",
      kind: "select",
      value: "first",
      options: [
        { value: "first", label: "第一张量" },
        { value: "second", label: "第二张量" },
      ],
    },
    {
      key: "sign",
      label: "符号",
      kind: "select",
      value: true,
      options: [
        { value: true, label: "正" },
        { value: false, label: "负" },
      ],
    },
    {
      key: "scale",
      label: "缩放",
      kind: "select",
      value: 1,
      options: [
        { value: 1, label: "一倍" },
        { value: 2, label: "两倍" },
      ],
    },
  ],
  code: "function draw({board,params,state,controls}){const V=VisualBook;const values=(params.mode==='first'?[[1,2],[3,4]]:[[5,6],[7,8]]).map(r=>r.map(v=>v*params.scale*(params.sign?1:-1)));const boxes=board.layout(2,{kind:'columns',minColumnWidth:240,gap:20});let tensor;board.region('matrix',boxes[0],b=>{tensor=V.components.tensor(b,{values,selected:state.cell,stateKey:'cell'},{controls});});board.region('readout',boxes[1],b=>V.components.readout(b,{items:[{label:'当前格子',value:tensor.value,color:'orange'},{label:'当前行',value:tensor.row,color:'blue'}]}));return {params:{...params},value:tensor.value,shape:tensor.shape};}",
};
const plan = { figures: [figure] };
validatePlan(source, plan);
assert.throws(
  () =>
    validatePlan(source, {
      figures: [
        { ...figure, params: [{ ...figure.params[0], value: "missing" }] },
      ],
    }),
  /Select/,
);
const file = path.join(out, "choices.html");
fs.writeFileSync(file, build(source, plan));
const report = await preview(file, path.join(out, "preview"));
const { chromium } = await import(
  pathToFileURL(
    path.join(
      root,
      "work/visualbook/runtime/node_modules/playwright-core/index.mjs",
    ),
  )
);
const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH ?? chromium.executablePath(),
  }),
  facts = [];
try {
  for (const width of [1280, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    await page.goto(pathToFileURL(file).href);
    await page.getByLabel("模式", { exact: true }).selectOption("1");
    await page.getByLabel("符号", { exact: true }).selectOption("1");
    await page.getByLabel("缩放", { exact: true }).selectOption("1");
    let state = await page.evaluate(() => ({
      facts: VisualBookRuntime.instances[0].facts,
      state: VisualBookRuntime.instances[0].state,
    }));
    facts.push({ width, event: "typed-native-options", ...state });
    assert.deepEqual(state.facts.params, {
      mode: "second",
      sign: false,
      scale: 2,
    });
    assert.equal(state.facts.value, -10);
    const cell = page.locator('[data-viz-key="matrix/select-1-1"]');
    await cell.click();
    state = await page.evaluate(() => ({
      facts: VisualBookRuntime.instances[0].facts,
      state: VisualBookRuntime.instances[0].state,
    }));
    facts.push({ width, event: "cell-click", ...state });
    assert.equal(state.facts.value, -16);
    assert.deepEqual(state.state.cell, [1, 1]);
    await page.locator('[data-viz-key="matrix/select-0-1"]').press("Enter");
    state = await page.evaluate(() => ({
      facts: VisualBookRuntime.instances[0].facts,
      state: VisualBookRuntime.instances[0].state,
    }));
    facts.push({ width, event: "cell-keyboard", ...state });
    assert.equal(state.facts.value, -12);
    await page.getByRole("button", { name: /重置参数/ }).click();
    state = await page.evaluate(() => ({
      facts: VisualBookRuntime.instances[0].facts,
      state: VisualBookRuntime.instances[0].state,
    }));
    facts.push({ width, event: "reset", ...state });
    assert.equal(state.facts.value, 1);
    assert.deepEqual(state.facts.params, {
      mode: "first",
      sign: true,
      scale: 1,
    });
    assert.equal(
      await page.getByLabel("模式", { exact: true }).inputValue(),
      "0",
    );
    await page
      .locator("#figure-choice")
      .screenshot({ path: path.join(out, width + "-verified.png") });
    await page.close();
  }
} finally {
  await browser.close();
  fs.writeFileSync(
    path.join(out, "interaction.json"),
    JSON.stringify(
      {
        kind: "maintenance-authored actual browser controls, not model generation",
        modelCalls: 0,
        facts,
        findings: report.findings,
      },
      null,
      2,
    ),
  );
}
assert.equal(report.findings.length, 0);
console.log(
  JSON.stringify({
    passed: true,
    viewports: 2,
    events: facts.length,
    modelCalls: 0,
  }),
);
