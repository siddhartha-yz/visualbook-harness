/* Actual duplicate-value selection: preserve data and intended item identity. */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { build, preview } from 'file:///home/yang-zhi/%E6%96%87%E6%A1%A3/ChatGPT/concept2motion/tools/visualbook.mjs';
import { firefox } from 'file:///home/yang-zhi/%E6%96%87%E6%A1%A3/ChatGPT/concept2motion/work/visualbook/runtime/node_modules/playwright-core/index.mjs';
async function launchBrowser() { return firefox.launch({headless:true}); }
const out = path.resolve(process.argv[2]);
if (fs.existsSync(out)) throw Error("Fresh output required");
fs.mkdirSync(out, { recursive: true });
const source = {
  title: "相等值仍保留项目身份",
  sourceSha256: "maintenance-control",
  blocks: [
    {
      id: "source-001",
      type: "paragraph",
      raw: "同一批项目，一行变换成相等值。",
      html: "<p>同一批项目，一行变换成相等值。</p>",
      math: { expected: 0 },
    },
  ],
};
fs.writeFileSync(
  path.join(out, "source.json"),
  JSON.stringify(source, null, 2),
);
const records = [],
  browser = await launchBrowser();
try {
  for (const n of [1, 3, 4]) {
    const rows = [
      { label: "输入", values: Array.from({ length: n }, (_, i) => i) },
      { label: "相等值", values: Array(n).fill(0) },
    ];
    const plan = {
      figures: [
        {
          id: "points",
          afterAnchor: "source-001",
          title: "相等数值仍可逐项选择",
          height: 300,
          mobileHeight: 300,
          interaction: "parameters",
          state: { item: 0 },
          scene: {
            type: "aligned-points",
            props: {
              rows,
              domain: [-1, 4],
              statistics: false,
              stateKey: "item",
              selected: { $state: "item" },
            },
          },
        },
      ],
    };
    const file = path.join(out, "points-" + n + ".html");
    fs.writeFileSync(
      path.join(out, "plan-" + n + ".json"),
      JSON.stringify(plan, null, 2),
    );
    fs.writeFileSync(file, build(source, plan));
    const report = await preview(file, path.join(out, "preview-" + n));
    assert.equal(report.findings.length, 0, JSON.stringify(report.findings));
    for (const width of [375, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      try {
        await page.goto(pathToFileURL(file).href);
        await page.locator("#figure-points .vh-reset").waitFor();
        for (let i = 0; i < n; i++)
          for (const action of ["mouse", "Enter"]) {
            await page.locator("#figure-points .vh-reset").click();
            const button = page.locator(
              '#figure-points [data-viz-key="hit-1-' + i + '"]',
            );
            if (action === "mouse") await button.click();
            else await button.press("Enter");
            assert.equal(await button.getAttribute("aria-pressed"), "true");
            const selected = await page
              .locator('#figure-points .vh-selectable[aria-pressed="true"]')
              .evaluateAll((nodes) =>
                nodes.map((node) => node.getAttribute("data-viz-key")),
              );
            assert.deepEqual(selected.sort(), ["hit-0-" + i, "hit-1-" + i]);
            records.push({
              n,
              width,
              i,
              action,
              selected,
              changesSelection: i !== 0,
            });
          }
      } finally {
        await page.close();
      }
    }
  }
} finally {
  await browser.close();
}
fs.writeFileSync(
  path.join(out, "control.json"),
  JSON.stringify(
    {
      passed: true,
      browserVersion: browser.version(),
      modelCalls: 0,
      scope:
        "Actual Firefox software pointer/Enter selection in one/three/four-item rows at375/1280; separate preview reports remain Chromium; intended aria-pressed identity across both rows, separate render checks. No physical touch/user/art guarantee; dense near-coincident groups remain a readability limit.",
      records,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({ passed: true, actions: records.length, modelCalls: 0 }),
);
