/* Inspect assembled offline readers, rather than only author candidates. No model. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { sourceMathLeaks } from "./visualbook_inspection.mjs";
import { captureReaderPng } from "./visualbook_capture.mjs";
const [directory, output, engine = "chromium"] = process.argv.slice(2);
if (!directory || !output || !["chromium", "firefox"].includes(engine))
  throw Error("Use book-directory, fresh evidence-directory and optional chromium/firefox");
const root = path.resolve(import.meta.dirname, ".."), book = path.resolve(directory), out = path.resolve(output);
if (fs.existsSync(out)) throw Error("Retain old evidence; use fresh output");
fs.mkdirSync(out, { recursive: true });
const sha = b => crypto.createHash("sha256").update(b).digest("hex");
const report = { status: "running", modelCalls: 0, engine, cases: [], findings: [], captureFailures: [],
  scope: "Actual final offline chapters: identity, three widths, scripts on/off, source formulas/images, native chapter navigation. No mathematical truth, artistic acceptance or learner study is inferred." };
const save = () => fs.writeFileSync(out + "/report.json", JSON.stringify(report, null, 2) + "\n");
async function bounded(promise, ms, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(label + " timed out")), ms); })]); }
  finally { clearTimeout(timer); }
}
save(); let browser;
try {
  const bytes = fs.readFileSync(book + "/build-record.json"), record = JSON.parse(bytes);
  report.buildRecordSha256 = sha(bytes);
  if (!record.records?.length || record.records.length > 32 ||
      new Set(record.records.map(r => r.id)).size !== record.records.length)
    throw Error("Expected 1..32 unique assembled chapters");
  if (sha(fs.readFileSync(book + "/index.html")) !== record.indexSha256) throw Error("Index changed");
  const runtime = await import(pathToFileURL(root + "/work/visualbook/runtime/node_modules/playwright-core/index.mjs"));
  const browserType = runtime[engine];
  browser = await browserType.launch({ headless: true,
    executablePath: engine === "chromium" ? process.env.CHROMIUM_PATH ?? browserType.executablePath() : browserType.executablePath() });
  report.browserVersion = browser.version();
  for (let index = 0; index < record.records.length; index++) {
    const chapter = record.records[index];
    if (!/^[a-z][a-z0-9-]*$/.test(chapter.id) || chapter.file !== chapter.id + ".html")
      throw Error("Invalid chapter path");
    const file = book + "/" + chapter.file, sourceBytes = fs.readFileSync(book + "/sources/" + chapter.id + "/source.json"),
      source = JSON.parse(sourceBytes);
    if (sha(fs.readFileSync(file)) !== chapter.finalHtmlSha256 || sha(sourceBytes) !== chapter.sourceJsonSha256)
      throw Error("Assembled chapter or source changed: " + chapter.id);
    const expectedMath = source.blocks.reduce((n, b) => n + b.math.expected, 0);
    for (const width of [375, 1280, 1920]) for (const javaScriptEnabled of [true, false]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, javaScriptEnabled }), remote = [];
      const c = { chapter: chapter.id, htmlSha256: chapter.finalHtmlSha256, width, javaScriptEnabled, findings: [] };
      report.activeCase = { chapter: chapter.id, width, javaScriptEnabled, stage: "navigation" }; save();
      page.on("request", r => { if (/^https?:/.test(r.url())) remote.push(r.url()); });
      try {
        await page.goto(pathToFileURL(file).href, { timeout: 30000 });
        report.activeCase.stage = "fonts"; save();
        await page.waitForFunction(() => document.fonts.status === "loaded", {}, { timeout: 20000, polling: 100 });
        report.activeCase.stage = "images"; save();
        const images = page.locator(".source-block img, .vh-static img");
        await images.evaluateAll(ns => ns.forEach(n => n.loading = "eager"));
        await page.waitForFunction(() => [...document.querySelectorAll(".source-block img, .vh-static img")].every(n => n.complete && n.naturalWidth > 0), {}, { timeout: 20000, polling: 100 });
        if (javaScriptEnabled) {
          await bounded(images.evaluateAll(async ns => { for (const n of ns) await n.decode(); }), 20000, "Native image decode");
          c.imageDecodeMethod = "native Image.decode with host deadline";
        } else {
          // Firefox disables page Promise continuations. Inspect the actual raster output instead.
          c.imagePngs = [];
          for (let i = 0; i < await images.count(); i++) {
            const png = out + `/${chapter.id}-${width}-noscript-image-${i}.png`;
            await images.nth(i).screenshot({ path: png }); c.imagePngs.push(png);
          }
          c.imageDecodeMethod = "actual rendered image PNG plus complete/naturalWidth; no disabled-page Promise";
        }
        report.activeCase.stage = "source facts"; save();
        c.facts = await page.evaluate(({ blocks, expectedMath, figureCount, sourceSha }) => {
          const imageFacts = [];
          for (const img of document.querySelectorAll(".source-block img, .vh-static img")) {
            imageFacts.push({ decoded: img.complete && img.naturalWidth > 0, alt: img.alt });
          }
          return { pageWidth: document.documentElement.scrollWidth, h1: document.querySelectorAll("h1").length,
            sourceIdentity: document.body.dataset.sourceSha === sourceSha,
            blockIdentity: blocks.every(b => document.getElementById(b.id)?.dataset.sourceSha256 === b.sha256),
            blockCount: document.querySelectorAll(".source-block").length, expectedBlocks: blocks.length,
            mathCount: document.querySelectorAll(".source-block .katex").length, expectedMath,
            mathErrors: document.querySelectorAll(".source-block .katex-error").length,
            imageFacts, staticImages: document.querySelectorAll(".vh-static img").length,
            runtimeFigures: globalThis.VisualBookRuntime?.instances?.length ?? null, figureCount };
        }, { blocks: source.blocks, expectedMath, figureCount: chapter.figures, sourceSha: chapter.sourceSha256 });
        c.rawMath = await page.evaluate(sourceMathLeaks); c.externalRequests = remote.length;
        const f = c.facts;
        if (f.pageWidth > width + 2) c.findings.push("page-overflow");
        if (f.h1 !== 1 || !f.sourceIdentity || !f.blockIdentity || f.blockCount !== f.expectedBlocks) c.findings.push("source-identity");
        if (f.mathCount !== expectedMath || f.mathErrors || c.rawMath.length) c.findings.push("source-math-render");
        if (f.imageFacts.some(i => !i.decoded || !i.alt)) c.findings.push("image-decoding-or-alt");
        if (javaScriptEnabled ? f.runtimeFigures !== chapter.figures : f.staticImages !== chapter.figures) c.findings.push("figure-coverage");
        if (remote.length) c.findings.push("external-request");
        if (javaScriptEnabled && [375, 1920].includes(width)) {
          const first = page.locator(".vh-figure").first();
          if (await first.count()) await first.scrollIntoViewIfNeeded();
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          await captureReaderPng(page, { path: out + `/${chapter.id}-${width}-reading.png` }, report.captureFailures);
        }
        if (chapter.navigation) {
          const next = record.records[index + 1];
          if (await page.locator(".vh-book-links [rel=prev]").count() !== Number(index > 0) ||
              await page.locator(".vh-book-links [rel=next]").count() !== Number(Boolean(next))) c.findings.push("chapter-links");
          await page.locator(".vh-book-continue a").click();
          c.nativeNavigation = page.url().endsWith(next ? "/" + next.file : "/index.html");
          if (!c.nativeNavigation) c.findings.push("native-navigation");
        }
      } catch (error) { c.findings.push("reader-error"); c.error = String(error); }
      finally { await page.close(); report.cases.push(c); report.findings.push(...c.findings.map(kind => ({ chapter: chapter.id, width, javaScriptEnabled, kind }))); save(); }
    }
  }
  report.status = "completed";
  delete report.activeCase;
} catch (error) { report.status = "failed"; report.error = String(error); report.findings.push({ kind: "collection-error" }); }
finally { if (browser) await browser.close(); save(); }
console.log(JSON.stringify({ status: report.status, cases: report.cases.length, findings: report.findings.length, modelCalls: 0 }));
if (report.status !== "completed" || report.findings.length) process.exitCode = 1;
