/* Actual formula reading checks: preserve math, scroll locally, keep offline width. */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { importMarkdown } from "../packages/visualbook/import.mjs";
import { build, preview, staticExport } from "./visualbook.mjs";
const root = path.resolve(import.meta.dirname, ".."),
  out = path.resolve(process.argv[2]);
if (fs.existsSync(out)) throw Error("Fresh output required");
fs.mkdirSync(out, { recursive: true });
const md =
  "# 长公式阅读控制\n\n短公式$x$放在正文里。\n\n依次考虑$\\{\\text{婴儿},\\text{儿童},\\text{青少年},\\text{青年人},\\text{中年人},\\text{老年人}\\}$的不同取值，公式之后仍有正文。\n\n$$\\hat{\\mathbf y}=\\operatorname{softmax}(\\mathbf o)\\quad \\text{其中}\\quad \\hat y_j=\\frac{\\exp(o_j)}{\\sum_k\\exp(o_k)}$$\n\n$$a+b+c+d+e+f+g+h+i+j+k+l+m+n+o+p+q+r+s=t$$\n\n$$\\begin{pmatrix}" + Array(14).fill("1000").join("&") + "\\end{pmatrix}$$\n";
fs.writeFileSync(out + "/chapter.md", md);
const source = importMarkdown(out + "/chapter.md", { id: "math-reader" });
fs.writeFileSync(out + "/source.json", JSON.stringify(source, null, 2));
const original = JSON.stringify(source);
fs.writeFileSync(out + "/book.html", build(source, { figures: [] }));
const r = await preview(out + "/book.html", out + "/preview");
assert.equal(r.findings.length, 0);
staticExport(out + "/book.html", out + "/preview", out + "/offline.html");
const { chromium } = await import(
  pathToFileURL(
    root + "/work/visualbook/runtime/node_modules/playwright-core/index.mjs",
  )
);
const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH ?? chromium.executablePath(),
  }),
  cases = [];
try {
  for (const width of [375, 1280])
    for (const javaScriptEnabled of [true, false]) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        javaScriptEnabled,
      });
      await page.goto(pathToFileURL(out + "/offline.html").href);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(40);
      const result = await page.evaluate(() => ({
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
        math: document.querySelectorAll(".source-block .katex").length,
        errors: document.querySelectorAll(".katex-error").length,
        shortFocusable: [...document.querySelectorAll(".source-block .katex")]
          .filter((n) => n.querySelector("annotation")?.textContent === "x")
          .some((n) => n.hasAttribute("tabindex")),
        wrapped: [...document.querySelectorAll(".source-block .katex")].filter(n =>
          n.querySelector("annotation")?.textContent.startsWith("a+b+c+d")).map(n => ({
            client:n.clientWidth,scroll:n.scrollWidth,
            tops:[...n.querySelectorAll(".katex-html>.katex-base,.katex-html>.base")].map(b=>b.getBoundingClientRect().top),
            tex:n.querySelector("annotation").textContent,
          })),
        regions: [...document.querySelectorAll(".vh-math-scroll")].map((n) => ({
          role: n.getAttribute("role"),
          tab: n.tabIndex,
          client: n.clientWidth,
          scroll: n.scrollWidth,
        })),
      }));
      assert(result.scroll <= width + 2);
      assert.equal(result.math, 5);
      assert.equal(result.errors, 0);
      assert.equal(result.shortFocusable, false);
      assert.equal(result.wrapped[0].tex,"a+b+c+d+e+f+g+h+i+j+k+l+m+n+o+p+q+r+s=t");
      if(width===375){assert.ok(result.wrapped[0].scroll<=result.wrapped[0].client+2);assert.ok(Math.max(...result.wrapped[0].tops)-Math.min(...result.wrapped[0].tops)>15);}
      if (width === 375 && javaScriptEnabled) {
        assert.equal(result.regions.length, 2);
        assert(
          result.regions.every(
            (r) => r.role === "region" && r.tab === 0 && r.scroll > r.client,
          ),
        );
        const node = page.locator(".vh-math-scroll").first();
        await node.focus();
        await page.keyboard.press("ArrowRight");
        await page.waitForTimeout(220);
        result.keyboardScroll = await node.evaluate((n) => n.scrollLeft);
        assert(result.keyboardScroll > 0);
        await page.keyboard.press("ArrowLeft");
        await page.waitForTimeout(220);
        result.returnedScroll = await node.evaluate((n) => n.scrollLeft);
        assert(result.returnedScroll < result.keyboardScroll);
        await page.screenshot({ path: out + "/375-reader.png" });
      }
      cases.push({ ...result, javaScriptEnabled });
      await page.close();
    }
} finally {
  await browser.close();
}
assert.equal(JSON.stringify(source), original);
fs.writeFileSync(
  out + "/control.json",
  JSON.stringify(
    {
      passed: true,
      modelCalls: 0,
      cases,
      sourceUnchanged: true,
      scope:
        "Actual relation wrapping without TeX edits, indivisible formula keyboard scrolling, coverage, two widths and script-disabled offline output. Not mathematical truth, all browsers or all source syntax.",
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({ passed: true, cases: cases.length, modelCalls: 0 }),
);
