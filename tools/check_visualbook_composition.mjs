/* A stateful composition reused across region sizes, pointer and keyboard inputs. */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { build, preview } from "./visualbook.mjs";
const root = path.resolve(import.meta.dirname, ".."),
  out = path.resolve(
    process.argv[2] ??
      path.join(root, "work/harness-v3/composition-" + Date.now()),
  );
if (fs.existsSync(out)) throw Error("Output exists");
fs.mkdirSync(out, { recursive: true });
const binding = { $state: "v", fallback: [1.5, 1] };
const scene = {
  type: "columns",
  layout: { gap: 18, minColumnWidth: 230, weights: [2, 1] },
  children: [
    {
      id: "geometry",
      type: "projection",
      props: {
        vector: binding,
        onto: [1, 0],
        progress: { $progress: true },
        draggable: true,
        stateKey: "v",
        title: "把向量投到水平轴",
      },
    },
    {
      id: "numbers",
      type: "readout",
      props: {
        items: [
          { label: "当前向量 v", value: binding, color: "blue" },
          {
            label: "投影",
            value: { $result: "geometry.projection" },
            color: "orange",
          },
          { label: "垂直分量", value: { $result: "geometry.residual" } },
        ],
      },
    },
  ],
};
const source = {
  title: "同一个向量，两种表示",
  sourceName: "维护者组合控制",
  sourceSha256: "maintenance-fixture",
  blocks: [
    {
      id: "compose-1",
      raw: "维护者组合控制",
      type: "paragraph",
      sha256: "maintenance-fixture",
      math: { expected: 0 },
      html: "<p>拖动蓝色向量的端点，右边的读数会一起变化。这个页面用来检验组合工具，不是模型生成的教材。</p>",
    },
  ],
};
const plan = {
  figures: [
    {
      id: "linked",
      title: "图和数值共享同一个输入",
      afterAnchor: "compose-1",
      height: 360,
      mobileHeight: 560,
      state: { v: [1.5, 1] },
      interaction: "parameters",
      presentation: "exploration",
      initialProgress: 1,
      scene,
      params: [],
    },
  ],
};
const file = path.join(out, "composition.html");
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
});
const result = {};
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 1000 },
  });
  await page.goto(pathToFileURL(file).href);
  const handle = page.locator('[data-viz-key="geometry/vector-handle"]');
  await handle.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowUp");
  const keyboard = await page.evaluate(() => {
    const i = VisualBookRuntime.instances[0];
    return {
      state: i.state,
      facts: i.facts,
      text: i.svg.querySelector('[data-viz-key="numbers/value-0-0"]')
        .textContent,
    };
  });
  assert.ok(
    Math.abs(keyboard.state.v[0] - 1.6) < 1e-9 &&
      Math.abs(keyboard.state.v[1] - 1.1) < 1e-9,
  );
  assert.deepEqual(keyboard.facts.geometry.projection, [
    keyboard.state.v[0],
    0,
  ]);
  assert.deepEqual(
    keyboard.facts.numbers.items[1].value,
    keyboard.facts.geometry.projection,
  );
  assert.equal(keyboard.facts.geometry.orthogonality, 0);
  assert.equal(keyboard.text, "1.6, 1.1");
  result.keyboardUpdatesBothViews = true;
  const old = await handle.elementHandle();
  const bounds = await handle.boundingBox();
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width / 2 - 50,
    bounds.y + bounds.height / 2 + 30,
    { steps: 8 },
  );
  await page.mouse.up();
  const dragged = await page.evaluate(() => {
    const i = VisualBookRuntime.instances[0];
    return { v: i.state.v, facts: i.facts };
  });
  assert.ok(
    dragged.v[0] < keyboard.state.v[0] && dragged.v[1] < keyboard.state.v[1],
  );
  assert.deepEqual(dragged.facts.numbers.items[0].value, dragged.v);
  result.pointerUpdatesBothViews = true;
  await page.setViewportSize({ width: 375, height: 1000 });
  await page.waitForFunction(
    () => VisualBookRuntime.instances[0].context.width < 400,
  );
  const resized = await page.evaluate(() => {
    const i = VisualBookRuntime.instances[0];
    const g = i.svg.querySelector('[data-viz-region="numbers"]');
    return {
      v: i.state.v,
      transform: g.getAttribute("transform"),
      error: i.error,
    };
  });
  assert.deepEqual(resized.v, dragged.v);
  assert.equal(resized.error, null);
  assert.ok(!resized.transform.includes("translate(0 0)"));
  assert.equal(
    await old.evaluate(
      (n) =>
        n === document.querySelector('[data-viz-key="geometry/vector-handle"]'),
    ),
    true,
  );
  result.resizePreservesInputAndHandleIdentity = true;
  await handle.focus();
  await page.keyboard.press("ArrowRight");
  const mobile = await page.evaluate(
    () => VisualBookRuntime.instances[0].state.v,
  );
  assert.ok(Math.abs(mobile[0] - dragged.v[0] - 0.1) < 1e-9);
  result.keyboardWorksAfterResponsiveReflow = true;
  await page.locator(".vh-reset").click();
  assert.deepEqual(
    await page.evaluate(() => VisualBookRuntime.instances[0].state.v),
    [1.5, 1],
  );
  result.resetRestoresSharedState = true;
  assert.equal(await page.locator(".vh-progress,.vh-play").count(), 0);
  assert.equal(await page.evaluate(() => VisualBookRuntime.instances[0].play()), false);
  result.parameterExplorationHasNoFakeTimeline = true;
  await page.screenshot({
    path: path.join(out, "mobile-linked.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.screenshot({
    path: path.join(out, "desktop-linked.png"),
    fullPage: true,
  });
  result.invalid = await page.evaluate(() =>
    [
      () => VisualBook.project([1, 2], [0, 0]),
      () => VisualBook.layout(300, 200, 2, { weights: [1, -1] }),
      () =>
        VisualBook.resolveBindings(
          { $result: "missing.value" },
          { results: {} },
        ),
    ].map((run) => {
      try {
        run();
        return false;
      } catch {
        return true;
      }
    }),
  );
  assert.ok(result.invalid.every(Boolean));
} finally {
  await browser.close();
}
fs.writeFileSync(
  path.join(out, "checks.json"),
  JSON.stringify(
    {
      result,
      findings: report.findings,
      modelCalls: 0,
      scope:
        "Maintainer composition and actual pointer/keyboard controls; not a generated book",
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify({ out, result, findings: report.findings }));
if (report.findings.length) process.exitCode = 1;
