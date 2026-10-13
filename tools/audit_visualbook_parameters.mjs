// Real control-boundary audit, no model calls and no self-assigned quality score.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { invalidGeometry } from "./visualbook_inspection.mjs";
const root = path.resolve(import.meta.dirname, ".."),
  hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
export function auditWidths(widths = [1280, 375, 600, 1920]) {
  if (!Array.isArray(widths) || !widths.length || widths.length > 6 ||
      new Set(widths).size !== widths.length || widths.some(w => !Number.isInteger(w) || w < 240 || w > 2560))
    throw Error('Use 1..6 unique integer viewport widths from 240 to 2560');
  return [...widths];
}
export async function auditParameters(file, out, {widths} = {}) {
  widths = auditWidths(widths);
  if (fs.existsSync(out))
    throw Error("Parameter evidence exists; choose a fresh directory");
  fs.mkdirSync(out, { recursive: true });
  const { chromium } = await import(
      pathToFileURL(
        path.join(
          root,
          "work/visualbook/runtime/node_modules/playwright-core/index.mjs",
        ),
      )
    ),
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_PATH ?? chromium.executablePath(),
    });
  const report = {
    file: path.resolve(file),
    sha256: hash(fs.readFileSync(file)),
    cases: [],
    findings: [],
    modelCalls: 0,
    declaredViewports: widths,
    scope:
      "Parameter extremes and all declared cases at declaredViewports, with progress 0.5/1 or explicit case progress. Not exhaustive combinations or artistic review.",
  };
  try {
    for (const width of widths) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.addInitScript(() => (window.__VH_SNAPSHOT = true));
      await page.addInitScript({
        content: "window.__VH_INVALID_GEOMETRY=" + invalidGeometry.toString(),
      });
      await page.goto(pathToFileURL(path.resolve(file)).href);
      await page.waitForFunction(() => document.fonts.status === "loaded");
      const figures = await page.evaluate(() =>
        VisualBookRuntime.instances.map((i) => ({
          id: i.id,
          params: i.figure.params ?? [],
          presets: i.figure.presets ?? [],
        })),
      );
      for (const figure of figures) {
        const cases = [
          {
            name: "default",
            values: Object.fromEntries(
              figure.params.map((p) => [p.key, p.value]),
            ),
          },
        ];
        const endpoints = (p) =>
          p.kind === "select"
            ? [p.options[0].value, p.options.at(-1).value]
            : [p.min, p.max];
        for (const param of figure.params)
          for (const [name, value] of param.kind === "select"
            ? param.options.map((o, i) => [
                i === 0
                  ? "min"
                  : i === param.options.length - 1
                    ? "max"
                    : "option-" + i,
                o.value,
              ])
            : [
                ["min", param.min],
                ["max", param.max],
              ])
            cases.push({
              name: param.key + "-" + name,
              values: { ...cases[0].values, [param.key]: value },
            });
        if (figure.params.length > 1) {
          cases.push({
            name: "all-min",
            values: Object.fromEntries(
              figure.params.map((p) => [p.key, endpoints(p)[0]]),
            ),
          });
          cases.push({
            name: "all-max",
            values: Object.fromEntries(
              figure.params.map((p) => [p.key, endpoints(p)[1]]),
            ),
          });
        }
        for (const preset of figure.presets)
          cases.push({ name: "case-" + preset.id, values: { ...cases[0].values, ...preset.params }, progress: preset.progress });
        for (const c of cases)
          for (const progress of c.progress === undefined ? [0.5, 1] : [c.progress]) {
            const state = await page.evaluate(
              ({ id, values, progress }) => {
                const i = VisualBookRuntime.instances.find((i) => i.id === id);
                let error = null;
                try {
                  i.setParams(values, progress);
                } catch (e) {
                  error = String(e);
                }
                const svg = i.svg,
                  box = svg.viewBox.baseVal;
                const visible = (n) => {
                  let alpha = 1;
                  for (
                    let p = n;
                    p && p !== svg.parentElement;
                    p = p.parentElement
                  ) {
                    const s = getComputedStyle(p);
                    if (s.display === "none" || s.visibility === "hidden")
                      return false;
                    alpha *= Number(s.opacity || 1);
                  }
                  return alpha > 0.015;
                };
                const bounds = (n) => {
                  const b = n.getBBox(),
                    m = svg.getScreenCTM().inverse().multiply(n.getScreenCTM()),
                    points = [
                      [b.x, b.y],
                      [b.x + b.width, b.y],
                      [b.x, b.y + b.height],
                      [b.x + b.width, b.y + b.height],
                    ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(m)),
                    xs = points.map((p) => p.x),
                    ys = points.map((p) => p.y);
                  return {
                    x: Math.min(...xs),
                    y: Math.min(...ys),
                    w: Math.max(...xs) - Math.min(...xs),
                    h: Math.max(...ys) - Math.min(...ys),
                  };
                };
                const clipped = (n) => {
                  let b = bounds(n);
                  for (
                    let p = n;
                    p && p !== svg.parentElement;
                    p = p.parentElement
                  ) {
                    const clip =
                      p.getAttribute("clip-path") ??
                      getComputedStyle(p).clipPath;
                    const ident = clip?.match(/#([^\)\"']+)/)?.[1];
                    if (!ident) continue;
                    const shape = svg.querySelector(
                      '[id=\"' + ident + '\"] rect',
                    );
                    if (!shape) continue;
                    const r = bounds(shape),
                      x = Math.max(b.x, r.x),
                      y = Math.max(b.y, r.y);
                    b = {
                      x,
                      y,
                      w: Math.max(0, Math.min(b.x + b.w, r.x + r.w) - x),
                      h: Math.max(0, Math.min(b.y + b.h, r.y + r.h) - y),
                    };
                  }
                  return b;
                };
                const nodes = [
                    ...svg.querySelectorAll("text,circle,path,line,rect"),
                  ]
                    .filter((n) => !n.closest("defs") && visible(n))
                    .map((n) => ({
                      tag: n.tagName,
                      text: n.textContent,
                      key: n.dataset.vizKey,
                      ...clipped(n),
                      size: parseFloat(getComputedStyle(n).fontSize),
                    })),
                  texts = nodes.filter((n) => n.tag === "text"),
                  overlaps = [];
                for (let a = 0; a < texts.length; a++)
                  for (let b = a + 1; b < texts.length; b++) {
                    const x = texts[a],
                      y = texts[b];
                    if (
                      x.w &&
                      y.w &&
                      x.x < y.x + y.w - 2 &&
                      x.x + x.w > y.x + 2 &&
                      x.y < y.y + y.h - 2 &&
                      x.y + x.h > y.y + 2
                    )
                      overlaps.push([x.text, y.text]);
                  }
                return {
                  error: error ?? i.error ?? null,
                  facts: i.facts,
                  calculations: i.calculations ?? [],
                  calculationTraceVersion: i.calculationTraceVersion ?? 0,
                  svg: svg.outerHTML,
                  outside: nodes.filter(
                    (n) =>
                      n.x < -3 ||
                      n.y < -3 ||
                      n.x + n.w > box.width + 3 ||
                      n.y + n.h > box.height + 3,
                  ),
                  tiny: texts.filter((n) => n.size < 12),
                  overlaps,
                  invalidGeometry: window.__VH_INVALID_GEOMETRY(svg),
                };
              },
              { id: figure.id, values: c.values, progress },
            );
            const record = {
              width,
              id: figure.id,
              control: c.name,
              params: c.values,
              progress,
              ...state,
              svgHash: hash(state.svg),
              svg: undefined,
            };
            report.cases.push(record);
            if (
              state.error ||
              state.outside.length ||
              state.tiny.length ||
              state.overlaps.length ||
              state.invalidGeometry.length
            ) {
              report.findings.push({ ...record, facts: undefined });
              await page.locator("#figure-" + figure.id).screenshot({
                path: path.join(
                  out,
                  `${width}-${figure.id}-${c.name}-${progress}.png`,
                ),
              });
            }
          }
        for (const param of figure.params) {
          const samples = report.cases.filter(
            (c) => c.width === width && c.id === figure.id,
          );
          let unchanged = [0.5, 1].every((progress) => {
            const low = samples.find(
              (c) =>
                c.control === param.key + "-min" && c.progress === progress,
            );
            const high = samples.find(
              (c) =>
                c.control === param.key + "-max" && c.progress === progress,
            );
            return (
              low &&
              high &&
              !low.error &&
              !high.error &&
              low.svgHash === high.svgHash
            );
          });
          // A periodic parameter can have equal endpoints. A forward input can
          // affect early poses while its final gradient is constant. Probe the
          // middle and early poses before calling the control inert.
          if (unchanged) {
            const values =
              param.kind === "select"
                ? param.options.map((o) => o.value)
                : [
                    param.min,
                    Math.min(
                      param.max,
                      param.min +
                        Math.round((param.max - param.min) / (2 * param.step)) *
                          param.step,
                    ),
                    param.max,
                  ];
            for (const progress of [0, 0.25, 0.5, 1]) {
              const hashes = [];
              for (const value of values) {
                const probe = await page.evaluate(
                  ({ id, key, value, defaults, progress }) => {
                    const instance = VisualBookRuntime.instances.find(
                      (i) => i.id === id,
                    );
                    try {
                      instance.reset();
                      for (const [k, v] of Object.entries(defaults))
                        instance.setParam(k, v);
                      instance.setParam(key, value);
                      instance.setProgress(progress);
                      return {
                        svg: instance.svg.outerHTML,
                        error: instance.error,
                      };
                    } catch (error) {
                      return { error: String(error) };
                    }
                  },
                  {
                    id: figure.id,
                    key: param.key,
                    value,
                    defaults: cases[0].values,
                    progress,
                  },
                );
                hashes.push(
                  probe.error ? "error:" + probe.error : hash(probe.svg),
                );
                if (probe.error)
                  report.findings.push({
                    width,
                    id: figure.id,
                    control: param.key,
                    value,
                    progress,
                    kind: "parameter-runtime-error",
                    error: probe.error,
                    probe: "adaptive early/middle pose",
                  });
              }
              if (
                new Set(hashes).size > 1 ||
                hashes.some((h) => h.startsWith("error:"))
              ) {
                unchanged = false;
                break;
              }
            }
          }
          if (unchanged)
            report.findings.push({
              width,
              id: figure.id,
              control: param.key,
              kind: "parameter-no-visual-effect",
              note: "Endpoint, middle/options and early/final pose probes produce identical SVG; this is a bounded check",
            });
        }
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  return report;
}
if (process.argv[1] === import.meta.filename) {
  const report = await auditParameters(process.argv[2], process.argv[3]);
  console.log(
    JSON.stringify({
      cases: report.cases.length,
      findings: report.findings.length,
      scope: report.scope,
    }),
  );
}
