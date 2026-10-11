/* Exercise registered on-diagram controls using actual browser input. No models. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { invalidGeometry } from "./visualbook_inspection.mjs";
const root = path.resolve(import.meta.dirname, ".."),
  sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
export async function auditInteractions(
  file,
  out,
  { engine = "chromium" } = {},
) {
  if (!["chromium", "firefox", "webkit"].includes(engine))
    throw Error("Unsupported browser engine");
  if (fs.existsSync(out))
    throw Error("Interaction evidence exists; choose fresh directory");
  fs.mkdirSync(out, { recursive: true });
  const report = {
    file: path.resolve(file),
    engine,
    sha256: sha(fs.readFileSync(file)),
    status: "running",
    cases: [],
    coverage: [],
    findings: [],
    modelCalls: 0,
    scope:
      "Up to sixteen registered controls per figure: .vh-handle keyboard/pointer and .vh-selectable mouse/Enter, at two widths and first available default/0/0.5/1 pose. Not exhaustive states, custom controls, physical touch devices or artistic review.",
  };
  const save = () =>
    fs.writeFileSync(
      path.join(out, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  save();
  let browser;
  try {
    const browsers = await import(
      pathToFileURL(
        path.join(
          root,
          "work/visualbook/runtime/node_modules/playwright-core/index.mjs",
        ),
      )
    );
    const type = browsers[engine];
    browser = await type.launch({
      headless: true,
      executablePath:
        process.env[engine.toUpperCase() + "_PATH"] ?? type.executablePath(),
    });
    report.browserVersion = browser.version();
    for (const width of [1280, 375]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } }),
        consoleErrors = [];
      page.on("pageerror", (error) => consoleErrors.push(String(error)));
      await page.addInitScript(() => (window.__VH_SNAPSHOT = true));
      await page.addInitScript({
        content: "window.__VH_INVALID_GEOMETRY=" + invalidGeometry.toString(),
      });
      await page.goto(pathToFileURL(path.resolve(file)).href);
      await page.waitForFunction(() => document.fonts.status === "loaded");
      const figures = await page.evaluate(() =>
        VisualBookRuntime.instances.map((i) => ({
          id: i.id,
          initial: i.figure.initialProgress ?? 0,
          mode: i.figure.interaction ?? "timeline",
        })),
      );
      const snapshot = (id) =>
        page.evaluate((id) => {
          const i = VisualBookRuntime.instances.find((i) => i.id === id),
            svg = i.svg;
          const visible = (n) => {
            for (let p = n; p && p !== svg.parentElement; p = p.parentElement) {
              const s = getComputedStyle(p);
              if (
                s.display === "none" ||
                s.visibility === "hidden" ||
                +s.opacity === 0
              )
                return false;
            }
            return true;
          };
          const attributes = new Set([
            "d",
            "points",
            "transform",
            "x",
            "y",
            "x1",
            "x2",
            "y1",
            "y2",
            "cx",
            "cy",
            "r",
            "rx",
            "ry",
            "width",
            "height",
            "viewBox",
          ]);
          const marks = [
            ...svg.querySelectorAll(
              "path,circle,rect,line,text,polygon,polyline,g",
            ),
          ]
            .filter((n) => !n.closest("defs,clipPath") && visible(n))
            .map((n) => ({
              tag: n.tagName,
              text: n.tagName === "text" ? n.textContent : "",
              attributes: Object.fromEntries(
                [...n.attributes]
                  .filter((a) => attributes.has(a.name))
                  .map((a) => [a.name, a.value]),
              ),
              paint: [
                getComputedStyle(n).fill,
                getComputedStyle(n).stroke,
                getComputedStyle(n).opacity,
              ],
            }));
          return {
            geometry: JSON.stringify(marks),
            facts: i.facts,
            calculations: i.calculations ?? [],
            calculationTraceVersion: i.calculationTraceVersion ?? 0,
            error: i.error ?? null,
            invalidGeometry: window.__VH_INVALID_GEOMETRY(svg),
          };
        }, id);
      for (const figure of figures) {
        // Static figures intentionally have no reset toolbar or live inputs.
        if (figure.mode === "static") {
          const count = await page
            .locator(
              "#figure-" +
                figure.id +
                " svg .vh-handle,#figure-" +
                figure.id +
                " svg .vh-selectable",
            )
            .count();
          report.coverage.push({
            width,
            id: figure.id,
            mode: "static",
            registered: count,
            sampled: 0,
            limit: 16,
          });
          if (count)
            report.findings.push({
              width,
              id: figure.id,
              kind: "static-has-live-controls",
              count,
            });
          continue;
        }
        const scope = page.locator("#figure-" + figure.id),
          tested = new Set(),
          registered = new Set();
        const disclosure = scope.locator(".vh-explore > summary");
        if (await disclosure.count()) await disclosure.click();
        for (const progress of [...new Set([figure.initial, 0, 0.5, 1])]) {
          await scope.locator(".vh-reset").click();
          await page.evaluate(
            ({ id, progress }) =>
              VisualBookRuntime.instances
                .find((i) => i.id === id)
                .setProgress(progress, true),
            { id: figure.id, progress },
          );
          const controls = await scope
            .locator("svg .vh-handle,svg .vh-selectable")
            .evaluateAll((nodes) =>
              nodes
                .filter((n) => {
                  for (
                    let p = n;
                    p && p.tagName !== "svg";
                    p = p.parentElement
                  ) {
                    const s = getComputedStyle(p);
                    if (
                      s.display === "none" ||
                      s.visibility === "hidden" ||
                      +s.opacity === 0
                    )
                      return false;
                  }
                  return true;
                })
                .map((n) => ({
                  key: n.getAttribute("data-viz-key"),
                  label: n.getAttribute("aria-label"),
                  kind: n.classList.contains("vh-handle")
                    ? "handle"
                    : "selection",
                })),
            );
          controls.forEach((c) => {
            if (c.key) registered.add(c.key);
          });
          const sampled =
            controls.length <= 16
              ? controls
              : Array.from(
                  { length: 16 },
                  (_, i) =>
                    controls[Math.round((i * (controls.length - 1)) / 15)],
                );
          for (const control of sampled) {
            if (!control.key || tested.has(control.key) || tested.size >= 16)
              continue;
            tested.add(control.key);
            const selector =
                "svg [data-viz-key=" + JSON.stringify(control.key) + "]",
              node = scope.locator(selector);
            for (const input of control.kind === "handle"
              ? ["keyboard", "pointer"]
              : ["Enter", "mouse"]) {
              await scope.locator(".vh-reset").click();
              await page.evaluate(
                ({ id, progress }) =>
                  VisualBookRuntime.instances
                    .find((i) => i.id === id)
                    .setProgress(progress, true),
                { id: figure.id, progress },
              );
              if ((await node.count()) !== 1) continue;
              await node.focus();
              if (["pointer", "mouse"].includes(input)) await node.hover();
              const baseline = await snapshot(figure.id);
              await page.evaluate(
                ({ id, progress }) =>
                  VisualBookRuntime.instances
                    .find((i) => i.id === id)
                    .setProgress(progress, true),
                { id: figure.id, progress },
              );
              const replay = await snapshot(figure.id),
                initialSelected =
                  control.kind === "selection" &&
                  (await node.getAttribute("aria-pressed")) === "true";
              let after = replay,
                error = null,
                skip = initialSelected;
              if (!skip)
                try {
                  if (control.kind === "handle" && input === "keyboard") {
                    for (const key of [
                      "ArrowRight",
                      "ArrowLeft",
                      "ArrowUp",
                      "ArrowDown",
                    ]) {
                      await node.press(key);
                      after = await snapshot(figure.id);
                      if (after.geometry !== replay.geometry || after.error)
                        break;
                    }
                  } else if (control.kind === "handle") {
                    await node.scrollIntoViewIfNeeded();
                    for (const direction of ["x", "-x", "y", "-y"]) {
                      const box = await node.boundingBox(),
                        svgBox = await scope.locator("svg").boundingBox();
                      if (!box || !svgBox)
                        throw Error("Handle has no visible browser box");
                      const x = box.x + box.width / 2,
                        y = box.y + box.height / 2,
                        dx = direction.includes("x")
                          ? (direction.startsWith("-") ? -1 : 1) *
                            (x < svgBox.x + svgBox.width / 2 ? 28 : -28)
                          : 0,
                        dy = direction.includes("y")
                          ? (direction.startsWith("-") ? -1 : 1) *
                            (y < svgBox.y + svgBox.height / 2 ? 28 : -28)
                          : 0;
                      await page.mouse.move(x, y);
                      await page.mouse.down();
                      try {
                        await page.mouse.move(x + dx, y + dy, { steps: 6 });
                      } finally {
                        await page.mouse.up();
                      }
                      after = await snapshot(figure.id);
                      if (after.geometry !== replay.geometry || after.error)
                        break;
                    }
                  } else {
                    if (input === "Enter") await node.press("Enter");
                    else await node.click();
                    after = await snapshot(figure.id);
                  }
                } catch (e) {
                  error = String(e);
                }
              const record = {
                width,
                id: figure.id,
                progress,
                key: control.key,
                label: control.label,
                kind: control.kind,
                input,
                skippedAlreadySelected: skip,
                beforeGeometrySha256: sha(replay.geometry),
                afterGeometrySha256: sha(after.geometry),
                beforeFacts: replay.facts,
                afterFacts: after.facts,
                beforeCalculations: replay.calculations,
                afterCalculations: after.calculations,
                calculationTraceVersion: after.calculationTraceVersion,
                error: error ?? after.error,
                invalidGeometry: after.invalidGeometry,
                repeatable: baseline.geometry === replay.geometry,
                changed: replay.geometry !== after.geometry,
              };
              report.cases.push(record);
              if (
                record.error ||
                record.invalidGeometry.length ||
                !record.repeatable ||
                (!skip && !record.changed)
              ) {
                const finding = {
                  width,
                  id: figure.id,
                  progress,
                  key: control.key,
                  input,
                  kind: record.error
                    ? "interaction-error"
                    : record.invalidGeometry.length
                      ? "interaction-invalid-geometry"
                      : !record.repeatable
                        ? "interaction-nonrepeatable"
                        : "interaction-no-visible-effect",
                  error: record.error,
                };
                report.findings.push(finding);
                await scope.screenshot({
                  path: path.join(
                    out,
                    "failure-" + report.cases.length + ".png",
                  ),
                });
              }
              save();
            }
          }
        }
        report.coverage.push({
          width,
          id: figure.id,
          registered: registered.size,
          sampled: tested.size,
          limit: 16,
        });
      }
      if (consoleErrors.length)
        report.findings.push({
          width,
          kind: "interaction-console-error",
          errors: consoleErrors,
        });
      await page.close();
    }
    report.status = "completed";
  } catch (error) {
    report.status = "failed";
    report.findings.push({
      kind: "interaction-audit-error",
      error: String(error),
    });
  } finally {
    await browser?.close();
    save();
  }
  return report;
}
if (import.meta.filename === process.argv[1]) {
  const r = await auditInteractions(
    path.resolve(process.argv[2]),
    path.resolve(process.argv[3]),
  );
  console.log(
    JSON.stringify({
      status: r.status,
      cases: r.cases.length,
      findings: r.findings,
      modelCalls: 0,
    }),
  );
  if (r.status !== "completed" || r.findings.length) process.exitCode = 1;
}
