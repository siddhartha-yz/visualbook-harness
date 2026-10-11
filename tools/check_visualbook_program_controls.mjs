/* Actual reader controls and linked program state. Maintainer samples, zero models. */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { build, preview } from "./visualbook.mjs";
const root = path.resolve(import.meta.dirname, ".."),
  out = path.resolve(process.argv[2]);
if (fs.existsSync(out)) throw Error("Output exists");
fs.mkdirSync(out, { recursive: true });
const designs = JSON.parse(
  fs.readFileSync(path.join(root, "packages/visualbook/catalog.json")),
).designs;
const ids = ["memory-alias", "array-strides"];
const source = {
  title: "编程读者交互控制",
  sourceSha256: "maintenance-control",
  blocks: ids.map((id, i) => ({
    id: "program-" + i,
    raw: "控制",
    type: "paragraph",
    html: "<p>维护者实际交互控制，不是模型生成。</p>",
    sha256: "maintenance-control",
    math: { expected: 0 },
  })),
};
const file = path.join(out, "book.html");
fs.writeFileSync(
  file,
  build(source, {
    figures: ids.map((id, i) => ({
      ...designs.find((d) => d.id === id),
      afterAnchor: "program-" + i,
      scopeEnd: "program-" + i,
    })),
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
  events = [];
try {
  for (const width of [1280, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(pathToFileURL(file).href);
    await page.waitForFunction(() => document.fonts.status === "loaded");
    const memory = page.locator("#figure-memory-alias");
    const facts = () =>
      page.evaluate(
        () =>
          VisualBookRuntime.instances.find((i) => i.id === "memory-alias")
            .facts,
      );
    assert.equal((await facts()).snapshot.objects.buf[1], 9);
    await memory.locator(".vh-explore > summary").click();
    await memory
      .getByRole("button", { name: "已执行语句：上一步", exact: true })
      .click();
    assert.equal((await facts()).step, 3);
    assert.equal((await facts()).snapshot.objects.buf[1], 2);
    events.push({ width, event: "previous step shows pre-write snapshot" });
    await memory
      .getByRole("slider", { name: "已执行语句", exact: true })
      .press("Home");
    assert.equal((await facts()).step, 0);
    assert.equal(
      await memory
        .getByRole("button", { name: "已执行语句：上一步", exact: true })
        .isDisabled(),
      true,
    );
    await memory
      .getByRole("button", { name: "已执行语句：下一步", exact: true })
      .click();
    assert.equal((await facts()).step, 1);
    events.push({ width, event: "integer boundary and next-step button" });
    const rejection = await page.evaluate(() => {
      try {
        VisualBookRuntime.instances
          .find((i) => i.id === "memory-alias")
          .setParam("step", 0.5);
        return false;
      } catch {
        return true;
      }
    });
    assert(rejection);
    await memory
      .getByRole("button", { name: "重置参数", exact: false })
      .click();
    assert.equal((await facts()).step, 4);
    const references = await page.evaluate(() =>
      [...document.querySelectorAll("#figure-memory-alias path")].map((p) =>
        p.getTotalLength(),
      ),
    );
    assert.equal(references.length, 3);
    assert(references.every((n) => n > 10));
    events.push({
      width,
      event: "reset restores identity links and copied value",
    });
    const array = page.locator("#figure-array-strides");
    assert.equal(await array.locator("svg").getAttribute("role"), "group");
    await array
      .getByRole("button", { name: "选择索引 2, 1", exact: true })
      .click();
    assert.equal(
      await page.evaluate(
        () =>
          VisualBookRuntime.instances.find((i) => i.id === "array-strides")
            .facts.selectedAddress,
      ),
      5,
    );
    await array
      .getByRole("button", { name: "选择索引 0, 0", exact: true })
      .press("Enter");
    assert.equal(
      await page.evaluate(
        () =>
          VisualBookRuntime.instances.find((i) => i.id === "array-strides")
            .facts.selectedAddress,
      ),
      0,
    );
    events.push({
      width,
      event: "pointer and keyboard select actual logical address",
    });
    const screenshot = path.join(out, width + "-program-state.png");
    await array.screenshot({ path: screenshot });
    await page.close();
  }
} finally {
  await browser.close();
}
const report = await preview(file, path.join(out, "preview"));
assert.equal(report.findings.length, 0, JSON.stringify(report.findings));
fs.writeFileSync(
  path.join(out, "control.json"),
  JSON.stringify(
    {
      kind: "actual Chromium controls and linked state; not model generation or artistic acceptance",
      modelCalls: 0,
      passed: true,
      events,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    passed: true,
    events: events.length,
    viewports: 2,
    modelCalls: 0,
  }),
);
