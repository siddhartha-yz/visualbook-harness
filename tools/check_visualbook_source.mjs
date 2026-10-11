/* Render every source chapter before author quota is used. No generated figures. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { build } from "./visualbook.mjs";
import { sourceMathLeaks } from "./visualbook_inspection.mjs";
const [manifestFile, output] = process.argv.slice(2);
const root = path.resolve(import.meta.dirname, ".."),
  out = path.resolve(output);
if (!manifestFile || !output || fs.existsSync(out))
  throw Error("Prepared manifest and fresh output required");
fs.mkdirSync(out, { recursive: true });
const manifest = JSON.parse(fs.readFileSync(manifestFile));
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const report = {
  status: "running",
  modelCalls: 0,
  scope:
    "Source-only real browser preflight: 375/1280 CSS layout, complete formula coverage and local image decoding with scripts disabled. No generated diagram or art/teaching assessment.",
  manifestSha256: sha(fs.readFileSync(manifestFile)),
  records: [],
  findings: [],
};
const save = () =>
  fs.writeFileSync(
    out + "/report.json",
    JSON.stringify(report, null, 2) + "\n",
  );
save();
let browser;
try {
  const { chromium } = await import(
    pathToFileURL(
      root + "/work/visualbook/runtime/node_modules/playwright-core/index.mjs",
    )
  );
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH ?? chromium.executablePath(),
  });
  report.browserVersion = browser.version();
  for (const chapter of manifest.chapters) {
    const sourceFile = path.resolve(
        path.dirname(path.resolve(manifestFile)),
        chapter.source,
      ),
      bytes = fs.readFileSync(sourceFile),
      source = JSON.parse(bytes);
    if (source.id !== chapter.id || !/^[a-z][a-z0-9-]*$/.test(chapter.id))
      throw Error("Prepared source identity mismatch");
    const directory = out + "/" + chapter.id;
    fs.mkdirSync(directory);
    const html = build(source, { figures: [] });
    fs.writeFileSync(directory + "/book.html", html);
    const expected = source.blocks.reduce(
      (n, b) => n + (b.math?.expected ?? 0),
      0,
    );
    const record = {
      id: chapter.id,
      sourceJsonSha256: sha(bytes),
      htmlSha256: sha(html),
      expectedFormulas: expected,
      cases: [],
    };
    report.records.push(record);
    save();
    for (const width of [375, 1280]) {
      const page = await browser.newPage({
          viewport: { width, height: 900 },
          javaScriptEnabled: false,
        }),
        requests = [];
      page.on("request", (r) => {
        if (/^https?:/.test(r.url())) requests.push(r.url());
      });
      try {
        await page.goto(pathToFileURL(directory + "/book.html").href, {
          timeout: 30000,
        });
        await page.evaluate(() => document.fonts.ready);
        const facts = await page.evaluate(async () => {
          const images = [];
          for (const img of document.querySelectorAll(".source-block img")) {
            img.loading = "eager";
            let decoded = true;
            try {
              await img.decode();
            } catch {
              decoded = false;
            }
            images.push({
              decoded: decoded && img.naturalWidth > 0,
              alt: img.alt,
            });
          }
          return {
            width: innerWidth,
            pageWidth: document.documentElement.scrollWidth,
            renderedFormulas: document.querySelectorAll(".source-block .katex")
              .length,
            formulaErrors: document.querySelectorAll(
              ".source-block .katex-error",
            ).length,
            images,
            localOverflow: [...document.querySelectorAll(".source-block")]
              .filter((n) => n.scrollWidth > n.clientWidth + 2)
              .map((n) => n.id),
          };
        });
        facts.rawMath = await page.evaluate(sourceMathLeaks);
        const findings = [
          ...(facts.pageWidth > width + 2 ? ["page-overflow"] : []),
          ...(facts.renderedFormulas !== expected || facts.formulaErrors
            ? ["formula-coverage"]
            : []),
          ...(facts.rawMath.length ? ["unrendered-math-text"] : []),
          ...(facts.images.some((i) => !i.decoded) ? ["image-decode"] : []),
          ...(requests.length ? ["external-request"] : []),
        ];
        record.cases.push({ ...facts, javaScriptEnabled: false, findings });
        report.findings.push(
          ...findings.map((kind) => ({ id: chapter.id, width, kind })),
        );
      } catch (e) {
        record.cases.push({ width, error: String(e) });
        report.findings.push({
          id: chapter.id,
          width,
          kind: "browser-preflight-error",
          error: String(e),
        });
      } finally {
        await page.close();
        save();
      }
    }
  }
  report.status = "completed";
} catch (e) {
  report.status = "failed";
  report.findings.push({ kind: "source-preflight-error", error: String(e) });
} finally {
  if (browser) await browser.close();
  save();
}
console.log(
  JSON.stringify({
    status: report.status,
    chapters: report.records.length,
    cases: report.records.reduce((n, r) => n + r.cases.length, 0),
    findings: report.findings.length,
    modelCalls: 0,
  }),
);
process.exitCode =
  report.status !== "completed" || report.findings.length ? 2 : 0;
