/* Real source-image capture and before-author reader gate controls; no model. */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { importMarkdown } from "../packages/visualbook/import.mjs";
import { build, preview } from "./visualbook.mjs";
import { spawnSync } from "node:child_process";
const root = path.resolve(import.meta.dirname, ".."),
  out = path.resolve(process.argv[2]);
if (fs.existsSync(out)) throw Error("Fresh output required");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(
  out + "/axis.svg",
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><path d="M20 100L220 20" stroke="#263b43" stroke-width="8"/></svg>',
);
fs.writeFileSync(
  out + "/chapter.md",
  "# 懒加载原图控制\n\n" +
    Array.from(
      { length: 45 },
      (_, i) => `第${i}段，用于把真实原图放在初始视口之外。\n\n`,
    ).join("") +
    "![原图](axis.svg)\n\n$\\mathbf{x}\\in\\mathbb R^2$\n",
);
const source = importMarkdown(out + "/chapter.md", { id: "capture" });
fs.writeFileSync(out + "/source.json", JSON.stringify(source, null, 2));
fs.writeFileSync(out + "/book.html", build(source, { figures: [] }));
const hash = (p) =>
    crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"),
  before = hash(out + "/book.html");
const { chromium } = await import(
  pathToFileURL(
    root + "/work/visualbook/runtime/node_modules/playwright-core/index.mjs",
  )
);
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH ?? chromium.executablePath(),
});
let initial, expectedBox;
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  await page.goto(pathToFileURL(out + "/book.html").href);
  await page.evaluate(() => document.fonts.ready);
  initial = await page.locator(".source-block img").evaluate((n) => ({
    complete: n.complete,
    naturalWidth: n.naturalWidth,
    top: n.getBoundingClientRect().top,
    left: n.getBoundingClientRect().left,
    width: n.getBoundingClientRect().width,
    height: n.getBoundingClientRect().height,
    loading: n.loading,
  }));
  assert(initial.top > 900 && initial.naturalWidth === 0);
  expectedBox = await page.locator(".source-block img").evaluate(async (n) => {
    n.loading = "eager";
    await n.decode();
    const r = n.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
  await page.close();
} finally {
  await browser.close();
}
const report = await preview(out + "/book.html", out + "/preview");
assert.equal(report.findings.length, 0);
for (const v of report.viewports) {
  assert.equal(v.sourceImages.length, 1);
  assert.equal(v.sourceImages[0].decoded, true);
  assert.equal(v.sourceImages[0].initialLoading, "lazy");
  assert.equal(v.sourceImages[0].naturalWidth, 240);
}
assert.equal(hash(out + "/book.html"), before);
// Decode the actual model-facing full-page PNG, not only the DOM image state.
const raster = spawnSync(
  "ffmpeg",
  [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    out + "/preview/1280-page.png",
    "-vf",
    `crop=${Math.floor(expectedBox.width)}:${Math.floor(expectedBox.height)}:${Math.floor(expectedBox.left)}:${Math.floor(expectedBox.top)}`,
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "pipe:1",
  ],
  { timeout: 30000, maxBuffer: 1024 * 1024 },
);
assert.equal(raster.status, 0, String(raster.stderr));
let darkPixels = 0;
for (let i = 0; i < raster.stdout.length; i += 3)
  if (Math.min(...raster.stdout.subarray(i, i + 3)) < 100) darkPixels++;
assert(
  darkPixels > 500,
  "The actual full-page PNG must contain the original dark axis, not lazy-loading whitespace",
);
const manifest = out + "/manifest.json";
fs.writeFileSync(
  manifest,
  JSON.stringify({
    chapters: [{ id: "capture", source: out + "/source.json" }],
  }),
);
let run = spawnSync(
  "node",
  [
    root + "/tools/check_visualbook_source.mjs",
    manifest,
    out + "/preflight-good",
  ],
  { cwd: root, encoding: "utf8", timeout: 90000 },
);
assert.equal(run.status, 0, run.stderr);
const good = JSON.parse(fs.readFileSync(out + "/preflight-good/report.json"));
assert.equal(good.records[0].cases.length, 2);
// Last chapter may have valid imported math but an unreadably wide source block.
const bad = structuredClone(source);
bad.id = "bad";
bad.blocks[0].html = '<p style="width:1600px">固定错误宽度</p>';
fs.writeFileSync(out + "/bad.source.json", JSON.stringify(bad));
const multi = out + "/multi.json";
fs.writeFileSync(
  multi,
  JSON.stringify({
    chapters: [
      { id: "capture", source: out + "/source.json" },
      { id: "bad", source: out + "/bad.source.json" },
    ],
  }),
);
run = spawnSync(
  "python3",
  [
    root + "/tools/run_visualbook.py",
    multi,
    out + "/runner-bad",
    "--max-chapters",
    "2",
  ],
  { cwd: root, encoding: "utf8", timeout: 90000 },
);
assert.notEqual(run.status, 0);
assert.match(run.stderr, /Source reader preflight failed before model calls/);
assert(!fs.existsSync(out + "/runner-bad/sessions"));
const failed = JSON.parse(
  fs.readFileSync(out + "/runner-bad/reader-preflight/attempt-001/report.json"),
);
assert(
  failed.findings.some((f) => f.id === "bad" && f.kind === "page-overflow"),
);
// A decodable source file is required; failing original images stop previews.
const missing = structuredClone(source);
const img = missing.blocks.find((b) => b.html.includes("<img"));
img.html = img.html.replace(/src="[^"]+"/, 'src="data:image/png;base64,AA=="');
fs.writeFileSync(out + "/bad-image.html", build(missing, { figures: [] }));
const imageReport = await preview(
  out + "/bad-image.html",
  out + "/bad-image-preview",
);
assert(imageReport.findings.some((f) => f.kind === "source-image-decode"));
// TeX nested inside a paragraph used to escape the direct-child text check.
// Explicit code samples remain literal, so fixing the leak check must not reject code.
const leak = structuredClone(source);
leak.blocks[0].html = '<p>Broken formula: \\frac{1}{2} + \\alpha</p>';
fs.writeFileSync(out + "/math-leak.html", build(leak, { figures: [] }));
const leakReport = await preview(out + "/math-leak.html", out + "/math-leak-preview");
assert(leakReport.findings.some(f => f.kind === "source-math-leak"));
const literal = structuredClone(source);
literal.blocks[0].html = '<p>Literal syntax: <code>\\frac{1}{2} + \\alpha</code></p>';
fs.writeFileSync(out + "/literal-code.html", build(literal, { figures: [] }));
const literalReport = await preview(out + "/literal-code.html", out + "/literal-code-preview");
assert.deepEqual(literalReport.findings, []);
fs.writeFileSync(
  out + "/control.json",
  JSON.stringify(
    {
      passed: true,
      modelCalls: 0,
      initial,
      expectedBox,
      htmlUnchanged: true,
      actualFullPageImageDarkPixels: darkPixels,
      capturedImages: report.viewports.map((v) => ({
        width: v.width,
        images: v.sourceImages,
      })),
      preflightPositiveCases: 2,
      badLastChapterStoppedBeforeSession: true,
      brokenImageRejected: true,
      nestedParagraphMathLeakRejected: true,
      literalCodePreserved: true,
      scope:
        "Offscreen lazy original image loading before full-page capture, actual image decode, two source widths, valid-formula bad final chapter blocked before any author. Not image semantics, all lazy-image/browser behaviours or art quality.",
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify({ passed: true, modelCalls: 0 }));
