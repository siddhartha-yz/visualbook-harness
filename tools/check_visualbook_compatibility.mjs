/* Real alternate-engine checks of the same frozen HTML. No model or forced repaint. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { invalidGeometry } from "./visualbook_inspection.mjs";
import { auditInteractions } from "./audit_visualbook_interactions.mjs";
const [catalogDir, bookDir, outDir, engine = "firefox"] = process.argv.slice(2);
if (
  !catalogDir ||
  !bookDir ||
  !outDir ||
  !["chromium", "firefox", "webkit"].includes(engine)
)
  throw Error("Usage: catalog-directory book-directory fresh-output [engine]");
const root = path.resolve(import.meta.dirname, ".."),
  out = path.resolve(outDir),
  sha = (v) => crypto.createHash("sha256").update(v).digest("hex");
if (fs.existsSync(out)) throw Error("Output exists");
fs.mkdirSync(out, { recursive: true });
const browsers = await import(
    pathToFileURL(
      path.join(
        root,
        "work/visualbook/runtime/node_modules/playwright-core/index.mjs",
      ),
    )
  ),
  type = browsers[engine];
const report = {
  status: "running",
  engine,
  scope:
    "Alternate browser: twenty-seven frozen maintainer designs at two widths/four poses, registered input actions, live playback/wheel pause, five reviewed model chapters from multiple stages with scripts disabled and images decoded. No exhaustive browser/device or art guarantee.",
  modelCalls: 0,
  cases: [],
  offline: [],
  live: [],
  findings: [],
};
const save = () =>
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
save();
let browser;
const near = (a, b, location = "facts") => {
  if (typeof b === "number") {
    if (
      typeof a !== "number" ||
      !Number.isFinite(a) ||
      Math.abs(a - b) > 1e-9 * Math.max(1, Math.abs(b))
    )
      throw Error(location + " numeric mismatch");
  } else if (Array.isArray(b)) {
    assert(Array.isArray(a) && a.length === b.length);
    b.forEach((v, i) => near(a[i], v, location + "." + i));
  } else if (b && typeof b === "object") {
    assert(a && typeof a === "object");
    for (const k of Object.keys(b)) near(a[k], b[k], location + "." + k);
  } else assert.deepEqual(a, b);
};
try {
  browser = await type.launch({
    headless: true,
    executablePath:
      process.env[engine.toUpperCase() + "_PATH"] ?? type.executablePath(),
  });
  report.browserVersion = browser.version();
  const ids = [
    "matrix-product",
    "reshape",
    "optimizer",
    "projection",
    "autograd",
    "bayes-area",
    "matrix-selection",
    "attention-compose",
    "normalization-running",
    "memory-alias",
    "receptive-field",
    "kernel-weight-composition",
    "gradient-vectors",
    "quadratic-contours",
    "normalization-points",
    "paired-points",
    "transpose-grid",
    "neural-response",
    "sigmoid-response",
    "sampled-field",
    "polynomial-fit",
    "optimizer-landscape",
    "adam-bias",
    "softmax-competition",
    "softmax-gradient-step",
    "head-reindex",
    "sparse-gradient-memory",
  ];
  for (const id of ids) {
    const file = path.resolve(catalogDir, "sources", id, "book.html"),
      baseline = JSON.parse(
        fs.readFileSync(
          path.resolve(catalogDir, "evidence", id, "report.json"),
        ),
      );
    assert.equal(baseline.sha256, sha(fs.readFileSync(file)));
    for (const width of [1280, 375]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } }),
        errors = [],
        external = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      page.on("request", (r) => {
        if (/^https?:/.test(r.url())) external.push(r.url());
      });
      await page.addInitScript(() => (window.__VH_SNAPSHOT = true));
      await page.addInitScript({
        content: "window.__VH_INVALID_GEOMETRY=" + invalidGeometry.toString(),
      });
      await page.goto(pathToFileURL(file).href);
      await page.waitForFunction(() => document.fonts.status === "loaded");
      const poses = [
        ...new Set(
          baseline.viewports
            .find((v) => v.width === width)
            .shapes[0].frames.map((f) => f.progress),
        ),
      ].filter((p) => [0, 0.25, 0.5, 1].includes(p));
      for (const progress of poses) {
        const actual = await page.evaluate((p) => {
          const i = VisualBookRuntime.instances[0];
          i.setProgress(p, true);
          return {
            facts: i.facts,
            error: i.error ?? null,
            invalid: window.__VH_INVALID_GEOMETRY(i.svg),
          };
        }, progress);
        const expected = baseline.viewports
          .find((v) => v.width === width)
          .shapes[0].frames.find((f) => f.progress === progress).facts;
        near(actual.facts, expected);
        assert(!actual.error);
        assert.deepEqual(actual.invalid, []);
        assert.deepEqual(errors, []);
        assert.deepEqual(external, []);
        report.cases.push({
          id,
          width,
          progress,
          matchingChromiumFacts: true,
          invalidGeometry: 0,
        });
      }
      const parameters = JSON.parse(
        fs.readFileSync(
          path.resolve(catalogDir, "evidence", id, "parameters/report.json"),
        ),
      );
      for (const probe of parameters.cases.filter((c) => c.width === width)) {
        const actual = await page.evaluate(({ params, progress }) => {
          const i = VisualBookRuntime.instances[0];
          for (const [key, value] of Object.entries(params))
            i.setParam(key, value);
          i.setProgress(progress, true);
          return {
            facts: i.facts,
            error: i.error ?? null,
            invalid: window.__VH_INVALID_GEOMETRY(i.svg),
          };
        }, probe);
        near(actual.facts, probe.facts);
        assert(!actual.error);
        assert.deepEqual(actual.invalid, []);
        assert.deepEqual(errors, []);
        assert.deepEqual(external, []);
        report.cases.push({
          id,
          width,
          progress: probe.progress,
          control: probe.control,
          matchingChromiumFacts: true,
          invalidGeometry: 0,
        });
      }
      if (
        width === 375 &&
        [
          "autograd",
          "kernel-weight-composition",
          "quadratic-contours",
          "normalization-points",
          "paired-points",
          "transpose-grid",
          "neural-response",
          "sigmoid-response",
          "sampled-field",
          "polynomial-fit",
        ].includes(id)
      )
        await page
          .locator("#figure-" + id)
          .screenshot({ path: path.join(out, engine + "-" + id + "-375.png") });
      await page.close();
      save();
    }
    const interaction = await auditInteractions(
      file,
      path.join(out, "interaction-" + id),
      { engine },
    );
    assert.equal(interaction.status, "completed");
    report.findings.push(
      ...interaction.findings.map((f) => ({ ...f, design: id })),
    );
    save();
  }
  // Exercise actual requestAnimationFrame progression and real wheel input, not virtual time.
  for (const width of [1280, 375]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto(
      pathToFileURL(
        path.resolve(catalogDir, "sources/matrix-product/book.html"),
      ).href,
    );
    await page.waitForFunction(() => document.fonts.status === "loaded");
    const figure = page.locator("#figure-matrix-product");
    await figure.scrollIntoViewIfNeeded();
    await figure.locator(".vh-explore").evaluateAll(ns=>ns.forEach(n=>n.open=true));
    await figure.locator(".vh-play").click();
    await page.waitForFunction(
      () => VisualBookRuntime.instances[0].progress > 0.03,
    );
    const before = await page.evaluate(
      () => VisualBookRuntime.instances[0].progress,
    );
    await page.mouse.wheel(0, 60);
    await page.waitForFunction(
      () =>
        document.querySelector(".vh-play").getAttribute("aria-pressed") ===
        "false",
    );
    const paused = await page.evaluate(() => ({
      p: VisualBookRuntime.instances[0].progress,
      pressed: document.querySelector(".vh-play").getAttribute("aria-pressed"),
    }));
    assert.equal(paused.pressed, "false");
    await page.waitForTimeout(300);
    assert.equal(
      await page.evaluate(() => VisualBookRuntime.instances[0].progress),
      paused.p,
    );
    await figure.locator(".vh-reset").click();
    await figure.locator(".vh-explore").evaluateAll(ns=>ns.forEach(n=>n.open=true));
    await figure.locator(".vh-play").click();
    await page.waitForFunction(
      () => VisualBookRuntime.instances[0].progress === 1,
      {},
      { timeout: 12000 },
    );
    assert.equal(
      await figure.locator(".vh-play").getAttribute("aria-pressed"),
      "false",
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForFunction(
      () =>
        matchMedia("(prefers-reduced-motion: reduce)").matches &&
        document.querySelector(".vh-play").disabled,
      {},
      { timeout: 1500 },
    );
    assert.equal(await figure.locator(".vh-play").isDisabled(), true);
    await figure.locator(".vh-reset").click();
    await figure.locator(".vh-next").click();
    report.live.push({
      width,
      liveFramesAdvanced: true,
      wheelPaused: true,
      completedOnce: true,
      reducedMotionPlayDisabled: true,
      beforeWheel: before,
    });
    await page.close();
    save();
  }
  const book = JSON.parse(
    fs.readFileSync(path.resolve(bookDir, "build-record.json")),
  );
  for (const chapter of book.records)
    for (const width of [1280, 375]) {
      const context = await browser.newContext({
          javaScriptEnabled: false,
          viewport: { width, height: 900 },
        }),
        page = await context.newPage(),
        external = [];
      page.on("request", (r) => {
        if (/^https?:/.test(r.url())) external.push(r.url());
      });
      await page.goto(pathToFileURL(path.resolve(bookDir, chapter.file)).href);
      await page.locator("body").waitFor();
      const data = await page.evaluate(() => ({
        math: document.querySelectorAll(".katex").length,
        sourceMath: document.querySelectorAll(".source-block .katex").length,
        annotationMath: document.querySelectorAll(".vh-annotation .katex")
          .length,
        expectedAnnotationMath: [
          ...document.querySelectorAll(".vh-annotation"),
        ].reduce((s, n) => s + Number(n.dataset.mathExpected), 0),
        errors: document.querySelectorAll(".katex-error,code.language-math")
          .length,
        images: [...document.images].map((i) => ({
          loaded: i.complete && i.naturalWidth > 0,
          alt: i.alt,
        })),
        fallback: document.querySelectorAll(".vh-static").length,
      }));
      // Lazy images must actually enter the viewport before judging their decoding.
      for (const image of await page.locator("img").all())
        await image.scrollIntoViewIfNeeded();
      await page.waitForLoadState("networkidle");
      const imageStates = await page
        .locator("img")
        .evaluateAll((images) =>
          images.map((i) => i.complete && i.naturalWidth > 0),
        );
      assert.equal(data.errors, 0);
      assert(imageStates.every(Boolean));
      assert.deepEqual(external, []);
      const originalSource = JSON.parse(
        fs.readFileSync(
          path.resolve(bookDir, "sources", chapter.id, "source.json"),
        ),
      );
      assert.equal(
        data.sourceMath,
        originalSource.blocks.reduce((n, b) => n + (b.math?.expected ?? 0), 0),
      );
      assert.equal(data.annotationMath, data.expectedAnnotationMath);
      assert(data.fallback === chapter.figures);
      report.offline.push({
        id: chapter.id,
        width,
        ...data,
        decodedImages: imageStates.length,
        allDecoded: true,
        noExternalRequests: true,
      });
      await context.close();
      save();
    }
  report.status = "completed";
} catch (error) {
  report.status = "failed";
  report.findings.push({
    kind: "compatibility-check-error",
    error: String(error),
  });
  throw error;
} finally {
  save();
  if (browser) await browser.close();
}
console.log(
  JSON.stringify({
    engine,
    cases: report.cases.length,
    offline: report.offline.length,
    live: report.live.length,
    findings: report.findings.length,
  }),
);
if (report.findings.length) process.exitCode = 1;
