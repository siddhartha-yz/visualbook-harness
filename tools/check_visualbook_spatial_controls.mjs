/* Actual controls and linked spatial facts. Maintainer cases, zero model calls. */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { build, preview } from "./visualbook.mjs";
const root = path.resolve(import.meta.dirname, ".."),
  out = path.resolve(process.argv[2]);
if (fs.existsSync(out)) throw Error("Output exists");
fs.mkdirSync(out, { recursive: true });
const ids = [
  "receptive-field",
  "dilation-holes",
  "kernel-regression",
  "kernel-weight-composition",
  "gradient-vectors",
];
const source = {
  title: "空间关系实际交互",
  sourceSha256: "maintenance-control",
  blocks: ids.map((_, i) => ({
    id: "control-" + i,
    raw: "control",
    type: "paragraph",
    html: "<p>维护者控制，不是模型生成或审美认证。</p>",
    math: { expected: 0 },
    sha256: "maintenance-control",
  })),
};
const file = path.join(out, "book.html");
fs.writeFileSync(
  file,
  build(source, {
    figures: ids.slice(0, 4).map((id, i) => ({
      id,
      design: id,
      afterAnchor: "control-" + i,
    })),
  }),
);
const vectorFile = path.join(out, "vector.html");
fs.writeFileSync(
  vectorFile,
  build(source, {
    figures: [
      {
        id: "gradient-vectors",
        design: "gradient-vectors",
        afterAnchor: "control-4",
      },
    ],
  }),
);
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
  events = [],
  timings = [];
try {
  for (const width of [1280, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(pathToFileURL(file).href);
    await page.waitForFunction(() => document.fonts.status === "loaded");
    const facts = (id) =>
      page.evaluate(
        (id) => VisualBookRuntime.instances.find((i) => i.id === id).facts,
        id,
      );
    const rf = page.locator("#figure-receptive-field");
    await rf
      .getByRole("button", { name: "查看输出位置 0", exact: true })
      .click();
    assert.deepEqual((await facts("receptive-field")).inputIndices, [0, 1, 2]);
    await rf
      .getByRole("button", { name: "查看输出位置 3", exact: true })
      .press("Enter");
    assert.deepEqual((await facts("receptive-field")).inputIndices, [5, 6, 7]);
    events.push({
      width,
      event: "mouse and Enter choose real boundary supports",
    });
    const dil = page.locator("#figure-dilation-holes");
    await dil.locator(".vh-explore > summary").click();
    await dil
      .getByRole("button", { name: "查看输出位置 12", exact: true })
      .click();
    await dil
      .getByRole("combobox", { name: "卷积间隔", exact: true })
      .selectOption({ label: "隔两个" });
    const d = await facts("dilation-holes");
    assert.equal(d.selectionClamped, true);
    assert.equal(d.requestedIndex, 12);
    assert.equal(d.index, 8);
    assert.deepEqual(d.inputIndices, [8, 11, 14]);
    assert.equal(d.span, 7);
    events.push({
      width,
      event: "dilation keeps holes and explicitly clamps changed shape",
    });
    const kernel = page.locator("#figure-kernel-regression"),
      handle = kernel.getByRole("button", {
        name: "移动查询位置；方向键移动",
        exact: true,
      });
    await handle.press("ArrowRight");
    assert(
      Math.abs((await facts("kernel-regression")).queryScalar - 0.6) < 1e-12,
    );
    await handle.scrollIntoViewIfNeeded();
    const box = await handle.boundingBox();
    const before = await facts("kernel-regression");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2, {
      steps: 8,
    });
    await page.mouse.up();
    const after = await facts("kernel-regression");
    assert(after.queryScalar > before.queryScalar);
    assert(after.response !== before.response);
    assert(Math.abs(after.weights.reduce((a, b) => a + b, 0) - 1) < 1e-12);
    events.push({
      width,
      event:
        "pointer drag changes actual scalar query and convex weighted estimate",
    });
    const linked = page.locator("#figure-kernel-weight-composition");
    await linked
      .getByRole("button", { name: "移动查询位置；方向键移动", exact: true })
      .press("Shift+ArrowLeft");
    const composed = await facts("kernel-weight-composition");
    assert.deepEqual(composed["part-1"].values[0], composed.kernel.weights);
    events.push({
      width,
      event:
        "linked tensor reads the same component weights after keyboard movement",
    });
    const vectorPage = await browser.newPage({
      viewport: { width, height: 900 },
    });
    await vectorPage.goto(pathToFileURL(vectorFile).href);
    await vectorPage.waitForFunction(() => document.fonts.status === "loaded");
    const vectorFacts = () =>
      vectorPage.evaluate(
        () =>
          VisualBookRuntime.instances.find((i) => i.id === "gradient-vectors")
            .facts,
      );
    const vectors = vectorPage.locator("#figure-gradient-vectors");
    await vectorPage.evaluate(() =>
      VisualBookRuntime.instances
        .find((i) => i.id === "gradient-vectors")
        .setParam("lambda", 0),
    );
    assert.deepEqual((await vectorFacts()).sum, [-1, 2]);
    assert.equal(
      await vectors.locator('[data-viz-key="term-penalty-head"]').count(),
      0,
    );
    await vectorPage.evaluate(() =>
      VisualBookRuntime.instances
        .find((i) => i.id === "gradient-vectors")
        .setProgress(0),
    );
    assert.deepEqual((await vectorFacts()).currentEndpoint, [0, 0]);
    assert.equal(await vectors.locator('[data-viz-key="sum-head"]').count(), 0);
    events.push({
      width,
      event:
        "zero vectors remove old arrowheads and preserve exact zero resultant",
    });
    await vectorPage.close();
    const timing = await page.evaluate(() => {
      const i = VisualBookRuntime.instances.find(
          (i) => i.id === "kernel-regression",
        ),
        times = [];
      for (let j = 0; j < 20; j++) i.controls.setState("query", -2 + j * 0.2);
      for (let round = 0; round < 7; round++) {
        const start = performance.now();
        for (let j = 0; j < 100; j++)
          i.controls.setState("query", -3 + (6 * j) / 99);
        times.push((performance.now() - start) / 100);
      }
      times.sort((a, b) => a - b);
      return {
        millisecondsPerSynchronousRedraw: times,
        median: times[3],
        scope:
          "browser synchronous state update and SVG mutation; excludes paint, FPS, GPU and human UX",
      };
    });
    timings.push({ width, ...timing });
    assert.equal(errors.length, 0, errors.join("\n"));
    await linked.screenshot({ path: path.join(out, width + "-linked.png") });
    await page.close();
  }
} finally {
  await browser.close();
}
const vectorReport = await preview(
  vectorFile,
  path.join(out, "vector-preview"),
);
assert.equal(
  vectorReport.findings.length,
  0,
  JSON.stringify(vectorReport.findings),
);
const report = await preview(file, path.join(out, "preview"));
assert.equal(report.findings.length, 0, JSON.stringify(report.findings));
fs.writeFileSync(
  path.join(out, "control.json"),
  JSON.stringify(
    {
      passed: true,
      modelCalls: 0,
      events,
      timings,
      kind: "actual Chromium inputs and linked numerics; not model generation or aesthetic acceptance",
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify({ passed: true, events: events.length, timings }));
