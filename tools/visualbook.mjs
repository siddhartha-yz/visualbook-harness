#!/usr/bin/env node
import fs from "node:fs";
import {
  sourceContext,
  validateAnnotations,
} from "../packages/visualbook/anchors.mjs";
import path from "node:path";
import crypto from "node:crypto";
import { operations as calculations } from "./visualbook_math.mjs";
import { pathToFileURL } from "node:url";
import { auditParameters } from "./audit_visualbook_parameters.mjs";
import { auditInteractions } from "./audit_visualbook_interactions.mjs";
import { invalidGeometry, sourceMathLeaks } from "./visualbook_inspection.mjs";
import reading from "../packages/visualbook/reading.cjs";
import presetTools from "../packages/visualbook/presets.cjs";
const root = path.resolve(import.meta.dirname, "..");
const runtime = path.join(root, "work/visualbook/runtime/node_modules");
const lib = path.join(root, "packages/visualbook");
const { default: katex } = await import(
  pathToFileURL(path.join(runtime, "katex/dist/katex.mjs"))
);
const esc = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const json = (filename) => JSON.parse(fs.readFileSync(filename, "utf8"));
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
export function resolvePlan(plan) {
  if (!Array.isArray(plan?.figures) || plan.figures.length > 4)
    throw Error("Expected zero to four figures");
  const catalogBytes = fs.readFileSync(path.join(lib, "catalog.json"));
  const designs = JSON.parse(catalogBytes).designs;
  return {
    ...structuredClone(plan),
    figures: plan.figures.map((figure) => {
      if (!figure.design) {
        if (figure.overrides !== undefined)
          throw Error("Overrides require a named design");
        return structuredClone(figure);
      }
      const design = designs.find((d) => d.id === figure.design);
      if (!design) throw Error("Unknown named design " + figure.design);
      if (figure.code !== undefined || figure.scene !== undefined)
        throw Error("Choose design, scene or code once");
      const keys = [
        "title",
        "height",
        "mobileHeight",
        "stages",
        "params",
        "state",
        "interaction",
        "placement",
        "marginSide",
        "presentation",
        "presets",
        "initialProgress",
        "durationMs",
        "checkpoints",
        "scene",
        "code",
      ];
      const base = Object.fromEntries(
        keys
          .filter((key) => Object.hasOwn(design, key))
          .map((key) => [key, structuredClone(design[key])]),
      );
      const overrides = figure.overrides ?? [];
      if (!Array.isArray(overrides) || overrides.length > 32)
        throw Error("At most 32 explicit design replacements");
      for (const patch of overrides) {
        if (
          !patch ||
          Object.keys(patch).some((key) => !["path", "value"].includes(key)) ||
          !Object.hasOwn(patch, "value") ||
          typeof patch.path !== "string" ||
          patch.path.length > 240 ||
          !/^\/(scene|params|state)(\/|$)/.test(patch.path) ||
          /~(?![01])/.test(patch.path)
        )
          throw Error(
            "Use an existing scene/params/state JSON pointer and value",
          );
        const parts = patch.path
          .slice(1)
          .split("/")
          .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
        if (
          parts.some((part) =>
            ["__proto__", "prototype", "constructor"].includes(part),
          )
        )
          throw Error("Unsafe design path");
        let parent = base;
        for (const part of parts.slice(0, -1)) {
          if (
            !parent ||
            typeof parent !== "object" ||
            !Object.hasOwn(parent, part)
          )
            throw Error("Design path does not exist: " + patch.path);
          parent = parent[part];
        }
        const last = parts.at(-1);
        if (
          !parent ||
          typeof parent !== "object" ||
          !Object.hasOwn(parent, last)
        )
          throw Error("Design path does not exist: " + patch.path);
        parent[last] = structuredClone(patch.value);
      }
      const { design: ignored, overrides: replaced, ...fields } = figure;
      return {
        ...base,
        summary: design.limits,
        ...structuredClone(fields),
        designRef: {
          id: design.id,
          catalogSha256: hash(catalogBytes),
          overrides: structuredClone(overrides),
        },
      };
    }),
  };
}
export function validateScene(scene, figure = {}) {
  const registry = new Map(
    json(path.join(lib, "components.json")).components.map((c) => [c.id, c]),
  );
  const seen = new Set(),
    results = new Map(),
    params = new Set((figure.params ?? []).map((p) => p.key));
  let count = 0;
  function bindings(value) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(bindings);
      return;
    }
    if (Object.hasOwn(value, "$param") && !params.has(value.$param))
      throw Error("Unknown scene parameter " + value.$param);
    if (
      Object.hasOwn(value, "$state") &&
      !Object.hasOwn(figure.state ?? {}, value.$state) &&
      !Object.hasOwn(value, "fallback")
    )
      throw Error(
        "Scene state needs an initial value or fallback: " + value.$state,
      );
    if (Object.hasOwn(value, "$result")) {
      const [id, key] = String(value.$result).split(".");
      if (!results.has(id))
        throw Error("Scene result must come from an earlier component: " + id);
      if (!results.get(id).includes(key))
        throw Error("Unknown component output: " + value.$result);
    }
    Object.values(value).forEach(bindings);
  }
  function visit(node, depth = 0) {
    if (
      !node ||
      typeof node !== "object" ||
      Array.isArray(node) ||
      ++count > 64 ||
      depth > 8
    )
      throw Error("Scene needs objects, at most 64 nodes and depth 8");
    if (node.id !== undefined) {
      if (!/^[a-z][a-z0-9-]*$/.test(node.id) || seen.has(node.id))
        throw Error("Unique valid scene ids required");
      seen.add(node.id);
    }
    if (node.type === "compose") {
      if (
        Object.keys(node).some(
          (k) => !["id", "type", "calculations", "visual"].includes(k),
        ) ||
        !Array.isArray(node.calculations) ||
        node.calculations.length > 16 ||
        !node.visual
      )
        throw Error("Compose needs bounded calculations and a visual tree");
      for (const calculation of node.calculations) {
        if (
          ++count > 64 ||
          !calculation ||
          !/^[a-z][a-z0-9-]*$/.test(calculation.id) ||
          seen.has(calculation.id) ||
          Object.keys(calculation).some(
            (k) => !["id", "operation", "inputs"].includes(k),
          )
        )
          throw Error("Unique valid calculation id and fields required");
        seen.add(calculation.id);
        const spec = calculations[calculation.operation],
          inputs = calculation.inputs;
        if (!spec) throw Error("Unknown calculation " + calculation.operation);
        if (
          !inputs ||
          typeof inputs !== "object" ||
          Array.isArray(inputs) ||
          Object.keys(inputs).some((k) => !spec.keys.includes(k)) ||
          spec.required.some((k) => !Object.hasOwn(inputs, k))
        )
          throw Error(
            "Calculation inputs: " +
              spec.keys.join(", ") +
              "; required: " +
              spec.required.join(", "),
          );
        bindings(inputs);
        results.set(calculation.id, spec.outputs);
      }
      visit(node.visual, depth + 1);
      return;
    }
    const layout = ["columns", "stack", "grid", "overlay"].includes(node.type),
      allowed = layout
        ? ["id", "type", "children", "layout"]
        : ["id", "type", "props"];
    if (Object.keys(node).some((k) => !allowed.includes(k)))
      throw Error("Unknown scene node field; allowed: " + allowed.join(", "));
    if (layout) {
      if (
        !Array.isArray(node.children) ||
        !node.children.length ||
        node.children.length > 16
      )
        throw Error("Scene layout needs 1..16 children");
      if (
        Object.keys(node.layout ?? {}).some(
          (k) =>
            ![
              "weights",
              "gap",
              "padding",
              "minColumnWidth",
              "columns",
            ].includes(k),
        )
      )
        throw Error("Unknown layout option");
      node.children.forEach((child) => visit(child, depth + 1));
      return;
    }
    const spec = registry.get(node.type);
    if (!spec) throw Error("Unknown scene component " + node.type);
    const props = node.props ?? {};
    if (!props || typeof props !== "object" || Array.isArray(props))
      throw Error("Component props must be an object");
    if (Object.keys(props).some((k) => !Object.hasOwn(spec.props, k)))
      throw Error(
        "Unknown " +
          node.type +
          " input; allowed: " +
          Object.keys(spec.props).join(", "),
      );
    if (spec.required.some((k) => !Object.hasOwn(props, k)))
      throw Error(node.type + " needs " + spec.required.join(", "));
    bindings(props);
    if (node.id) results.set(node.id, spec.outputs);
  }
  visit(scene);
  return { nodes: count };
}
function katexCss() {
  return fs
    .readFileSync(path.join(runtime, "katex/dist/katex.min.css"), "utf8")
    .replace(/url\(([^)]+)\)/g, (whole, name) => {
      const file = path.join(runtime, "katex/dist", name);
      return fs.existsSync(file)
        ? `url(data:font/${name.endsWith("woff2") ? "woff2" : "woff"};base64,${fs.readFileSync(file).toString("base64")})`
        : whole;
    });
}
export function validatePlan(book, plan) {
  plan = resolvePlan(plan);
  if (!Array.isArray(plan.figures) || plan.figures.length > 4)
    throw Error("Expected zero to four figures");
  validateAnnotations(book, plan.annotations);
  const ids = new Set(),
    scopes = [];
  for (const f of plan.figures) {
    reading.readingSpec(f);
    if (
      typeof f.id !== "string" ||
      !/^[a-z][a-z0-9-]*$/.test(f.id) ||
      ids.has(f.id)
    )
      throw Error("Bad/duplicate figure id");
    ids.add(f.id);
    if (typeof f.title !== "string" || !f.title.trim() || f.title.length > 80)
      throw Error("Figure needs a short title " + f.id);
    if (
      f.summary !== undefined &&
      (typeof f.summary !== "string" || f.summary.length > 180)
    )
      throw Error("Figure summary must be at most 180 characters " + f.id);
    if (
      f.stages !== undefined &&
      (!Array.isArray(f.stages) ||
        !f.stages.length ||
        f.stages.length > 8 ||
        f.stages.some((s) => typeof s !== "string" || s.length > 32))
    )
      throw Error("Use 1..8 short stage labels " + f.id);
    if (
      f.params !== undefined &&
      (!Array.isArray(f.params) ||
        f.params.length > 8 ||
        new Set(f.params.map((p) => p.key)).size !== f.params.length)
    )
      throw Error("Use at most 8 uniquely named parameter controls " + f.id);
    const interaction = f.interaction ?? "timeline";
    presetTools.validatePresets(f);
    if (!["timeline", "parameters", "static"].includes(interaction))
      throw Error("Bad interaction mode " + f.id);
    if (
      interaction === "static" &&
      (f.params?.length || Object.keys(f.state ?? {}).length)
    )
      throw Error(
        "Static figures cannot declare interactive state or controls " + f.id,
      );
    if (
      interaction === "parameters" &&
      !f.params?.length &&
      !Object.keys(f.state ?? {}).length
    )
      throw Error(
        "Parameter exploration needs controls or shared state " + f.id,
      );
    if (
      f.initialProgress !== undefined &&
      (!Number.isFinite(f.initialProgress) ||
        f.initialProgress < 0 ||
        f.initialProgress > 1)
    )
      throw Error("Bad initial progress " + f.id);
    if (
      f.durationMs !== undefined &&
      (!Number.isFinite(f.durationMs) ||
        f.durationMs < 1000 ||
        f.durationMs > 60000)
    )
      throw Error("Bad playback duration " + f.id);
    if (f.checkpoints !== undefined) {
      if (!Array.isArray(f.checkpoints))
        throw Error("Checkpoints must be an array " + f.id);
      const points = f.checkpoints.map((c) =>
        typeof c === "number" ? c : c.progress,
      );
      if (
        points.length < 2 ||
        points[0] !== 0 ||
        points.at(-1) !== 1 ||
        points.some(
          (p, i) =>
            !Number.isFinite(p) || p < 0 || p > 1 || (i && p <= points[i - 1]),
        )
      )
        throw Error("Bad checkpoints " + f.id);
    }
    const start = book.blocks.findIndex((b) => b.id === f.afterAnchor),
      end = book.blocks.findIndex(
        (b) => b.id === (f.endAnchor ?? f.afterAnchor),
      );
    if (start < 0 || end < start || end - start > 8)
      throw Error("Invalid/too long scope " + f.id);
    const context = sourceContext(book, f.afterAnchor);
    if (!context.safeToInsertAfter)
      throw Error(
        "Keep source introduction with its continuation; place figure after " +
          context.recommendedAnchor,
      );
    if (f.sourceDiagramAnchor !== undefined) {
      const original = book.blocks[start];
      if (f.sourceDiagramAnchor !== f.afterAnchor || original.type !== "code" ||
          !/```(?:text|plaintext|ascii)?\s*\n/.test(original.raw) ||
          !/[+┌┐└┘][─\-]{3,}|[│|].*[│|]/.test(original.raw))
        throw Error("Only the adjacent original text/ASCII diagram can be collapsed " + f.id);
    }
    if (
      f.scene !== undefined &&
      (!f.scene || typeof f.scene !== "object" || Array.isArray(f.scene))
    )
      throw Error("Scene must be an object " + f.id);
    if (f.scene !== undefined && f.code !== undefined)
      throw Error("Use scene or code, not both " + f.id);
    if (f.scene) validateScene(f.scene, f);
    if (
      f.scene === undefined &&
      (typeof f.code !== "string" ||
        !/^\s*function\s+draw\s*\(/.test(f.code) ||
        /<\/script/i.test(f.code))
    )
      throw Error("Expected function draw(input) " + f.id);
    if (
      !Number.isInteger(f.height ?? 320) ||
      !Number.isInteger(f.mobileHeight ?? f.height ?? 320) ||
      (f.height ?? 320) < 180 ||
      (f.height ?? 320) > 480 ||
      (f.mobileHeight ?? f.height ?? 320) < 180 ||
      (f.mobileHeight ?? f.height ?? 320) > 560
    )
      throw Error(
        "Figure height must be integer 180..480, mobile 180..560: " + f.id,
      );
    for (const c of f.params ?? []) {
      if (
        typeof c.key !== "string" ||
        !/^[a-z][a-zA-Z0-9]*$/.test(c.key) ||
        typeof c.label !== "string" ||
        !c.label.trim() ||
        c.label.length > 40 ||
        !["range", "select", "stepper"].includes(c.kind ?? "range")
      )
        throw Error("Bad control " + c.key);
      if (c.kind === "select") {
        if (
          !Array.isArray(c.options) ||
          c.options.length < 2 ||
          c.options.length > 8 ||
          c.options.some(
            (o) =>
              !o ||
              typeof o.label !== "string" ||
              !o.label.trim() ||
              o.label.length > 32 ||
              !["string", "number", "boolean"].includes(typeof o.value) ||
              (typeof o.value === "number" && !Number.isFinite(o.value)) ||
              (typeof o.value === "string" && o.value.length > 80),
          ) ||
          new Set(c.options.map((o) => JSON.stringify(o.value))).size !==
            c.options.length ||
          !c.options.some((o) => o.value === c.value)
        )
          throw Error(
            "Select needs 2..8 unique scalar options and a matching value " +
              c.key,
          );
      } else if (
        ![c.min, c.max, c.step, c.value].every(Number.isFinite) ||
        c.min >= c.max ||
        c.step <= 0 ||
        c.value < c.min ||
        c.value > c.max
      )
        throw Error("Bad range " + c.key);
      if (
        c.kind === "stepper" &&
        (![c.min, c.max, c.value].every(Number.isSafeInteger) || c.step !== 1)
      )
        throw Error("Stepper needs integer bounds/value and step=1 " + c.key);
    }
    if (scopes.some((s) => start <= s.end && end >= s.start))
      throw Error("Overlapping scopes");
    scopes.push({ start, end, f });
  }
  return scopes;
}
export function build(book, plan, { direct = false } = {}) {
  if (direct && plan.figures.some((f) => f.design))
    throw Error("Direct arm does not use named designs");
  plan = resolvePlan(plan);
  if (direct && plan.figures.some((f) => f.scene))
    throw Error("Direct arm does not use scene components");
  const sourceName =
    book.sourceName ?? (book.sourceCommit ? "D2L" : "输入教材");
  const first = book.blocks[0],
    hasCover = first?.type === "heading" && (first.depth ?? 1) === 1;
  const collapsedDiagrams = new Set(plan.figures.map((f) => f.sourceDiagramAnchor).filter(Boolean));
  const block = (b) =>
    `<div class="source-block" id="${b.id}" data-source-sha256="${b.sha256}" data-math-expected="${b.math?.expected ?? 0}">${collapsedDiagrams.has(b.id) ? `<details class="vh-original-diagram"><summary>原文文本示意</summary>${b.html}</details>` : b.html}</div>`;
  const cover = hasCover ? block(first) : `<h1>${esc(book.title)}</h1>`;
  const scopes = validatePlan(book, plan),
    mathExpected = book.blocks.reduce((s, b) => s + (b.math?.expected ?? 0), 0);
  const parameter = (c) =>
    c.kind === "select"
      ? `<label>${esc(c.label)}<select data-param="${c.key}" aria-label="${esc(c.label)}">${c.options.map((o, i) => `<option value="${i}"${o.value === c.value ? " selected" : ""}>${esc(o.label)}</option>`).join("")}</select></label>`
      : `<div class="vh-param-row${c.kind === "stepper" ? " vh-stepper" : ""}"><label>${esc(c.label)}<input type="range" data-param="${c.key}" min="${c.min}" max="${c.max}" step="${c.step}" value="${c.value}" aria-label="${esc(c.label)}"><output>${c.value}</output></label>${c.kind === "stepper" ? `<button type="button" data-param-step="${c.key}" data-direction="-1" aria-label="${esc(c.label)}：上一步">←</button><button type="button" data-param-step="${c.key}" data-direction="1" aria-label="${esc(c.label)}：下一步">→</button>` : ""}</div>`;
  const renderFigure = (f) => {
    const { placement, presentation } = reading.readingSpec(f);
    const mode = f.interaction ?? "timeline";
    const play = `<button type="button" class="vh-play" aria-label="${esc(f.title)}：播放演示" aria-pressed="false">看一遍</button>`;
    const progress = `<div class="vh-bar"><input class="vh-progress" type="range" min="0" max="1" step="0.001" value="${f.initialProgress ?? 0}" aria-label="${esc(f.title)}：连续演示进度"><span class="vh-status"></span></div>`;
    const transport = `<div class="vh-transport"><button type="button" class="vh-prev" aria-label="${esc(f.title)}：上一步">←</button>${presentation === "exploration" ? play : ""}<button type="button" class="vh-next" aria-label="${esc(f.title)}：下一步">→</button><button type="button" class="vh-reset" aria-label="${esc(f.title)}：重置进度与参数">重置</button></div>`;
    let controls = mode === "timeline" ? `<div class="vh-toolbar">${progress}${transport}</div>` : mode === "parameters" ? `<div class="vh-toolbar vh-toolbar-parameters"><button type="button" class="vh-reset" aria-label="${esc(f.title)}：重置参数">重置</button></div>` : "";
    if (mode !== "static") controls += `<div class="vh-params">${(f.params ?? []).map(parameter).join("")}</div>`;
    if (presentation === "reading" && mode !== "static")
      controls = `<div class="vh-reading-actions">${mode === "timeline" ? play : ""}<details class="vh-explore"><summary>${mode === "timeline" ? "逐步查看 / 自己试" : "自己试一下"}</summary><div class="vh-explore-content">${controls}</div></details></div>`;
    if (f.presets?.length)
      controls = `<div class="vh-cases" role="group" aria-label="${esc(f.title)}：典型情况">${f.presets.map(p => `<button type="button" data-preset="${p.id}" aria-pressed="false">${esc(p.label)}</button>`).join("")}</div>` + controls;
    return `<figure class="vh-figure" id="figure-${f.id}" data-viz-id="${f.id}" data-interaction="${mode}" data-placement="${placement}" data-presentation="${presentation}" aria-describedby="caption-${f.id}"><h3>${esc(f.title)}</h3><div class="vh-canvas"><svg role="img" aria-label="${esc(f.summary ?? f.title)}"><title>${esc(f.title)}</title></svg></div>${controls}<figcaption id="caption-${f.id}" class="vh-caption">${esc(f.summary ?? "")}</figcaption></figure>`;
  };
  const annotations = validateAnnotations(book, plan.annotations);
  const noteHtml = (note) =>
    `<aside class="vh-annotation" id="${esc(note.id)}" data-kind="${esc(note.kind)}" data-placement="${note.placement ?? "body"}" data-math-expected="${note.formula ? 1 : 0}"><p><span>${{ condition: "适用条件", clarification: "补充说明", correction: "勘误" }[note.kind]}</span>${esc(note.text)}</p>${note.formula ? katex.renderToString(note.formula, { displayMode: true, throwOnError: true, trust: false, strict: "ignore" }) : ""}</aside>`;
  let body = "";
  for (let i = 0; i < book.blocks.length; i++) {
    const b = book.blocks[i],
      scope = scopes.find((s) => s.start === i);
    if (scope) body += '<section class="vh-scope">';
    const notes = annotations.filter((n) => n.afterAnchor === b.id);
    const marginFigure = scope && reading.readingSpec(scope.f).placement === "margin";
    const marginal = marginFigure || notes.some((n) => n.placement === "margin");
    if (marginal) body += '<div class="vh-anchor-row"><div class="vh-anchor-text">';
    if (!(i === 0 && hasCover)) body += block(b);
    for (const note of notes.filter((n) => n.placement !== "margin")) body += noteHtml(note);
    if (marginal) {
      body += "</div>";
      for (const side of ["left", "right"]) {
        const sideNotes = notes.filter(n => n.placement === "margin" && (n.marginSide ?? "right") === side);
        const sideFigure = marginFigure && reading.readingSpec(scope.f).marginSide === side;
        if (!sideNotes.length && !sideFigure) continue;
        body += `<div class="vh-margin-content" data-side="${side}">`;
        for (const note of sideNotes) body += noteHtml(note);
        if (sideFigure) body += renderFigure(scope.f);
        body += "</div>";
      }
      body += "</div>";
    }
    if (scope && !marginFigure) body += renderFigure(scope.f);
    if (scopes.some((s) => s.end === i)) body += "</section>";
  }
  const library = direct
    ? ""
    : fs.readFileSync(path.join(runtime, "d3/dist/d3.min.js"), "utf8") +
      "\n" +
      fs.readFileSync(
        path.join(runtime, "@dagrejs/dagre/dist/dagre.min.js.LEGAL.txt"),
        "utf8",
      ) +
      "\n" +
      fs.readFileSync(
        path.join(runtime, "@dagrejs/dagre/dist/dagre.min.js"),
        "utf8",
      ) +
      "\n" +
      json(path.join(lib, "bundle.json"))
        .modules.map((name) => {
          if (!/^[a-zA-Z0-9.\-]+\.c?js$/.test(name))
            throw Error("Invalid module in bundled manifest");
          return fs.readFileSync(path.join(lib, name), "utf8");
        })
        .join("\n");
  const startup = plan.figures
    .map(
      (f) =>
        `VisualBookRuntime.mount(document.getElementById('figure-${f.id}'),${JSON.stringify({ ...f, code: undefined, scene: undefined }).replaceAll("<", "\\u003c")},(${f.scene ? "function draw(input){return VisualBook.renderScene(input.board," + JSON.stringify(f.scene).replaceAll("<", "\\u003c") + ",input);}" : f.code}),${!direct});`,
    )
    .join("\n");
  const headings = book.blocks.filter((b) => b.type === "heading" && b.depth > 1 && b.depth <= 4);
  const toc = headings.length >= 3 ? `<nav class="vh-toc" aria-label="本章目录"><details><summary>本章</summary><ol>${headings.map((b) => `<li data-depth="${b.depth}"><a href="#${b.id}">${esc(b.raw.replace(/^#+\s*/, ""))}</a></li>`).join("")}</ol></details></nav>` : "";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'"><title>${esc(book.title)}</title><style>${fs.readFileSync(path.join(lib, "theme.css"), "utf8")}\n${katexCss()}</style></head><body data-source-name="${esc(sourceName)}" data-math-expected="${mathExpected}" data-source-sha="${book.sourceSha256}"><header><a href="index.html">VisualBook</a>${book.sourceUrl ? `<a href="${esc(book.sourceUrl)}">原版教材 ↗</a>` : ""}</header><main><div class="vh-opening">${toc}<div class="vh-cover"><div class="eyebrow">读 · 看 · 有需要再试</div>${cover}<p class="source-note">正文来自 ${esc(sourceName)}。先读图；需要时可以看一遍演示，或展开探索。</p></div></div>${body}</main><script>${library}\n${fs.readFileSync(path.join(lib, "runtime.js"), "utf8")}\n${startup}</script></body></html>`;
}
export async function preview(file, out) {
  if (fs.existsSync(out))
    throw Error("Preview directory exists; use a new directory");
  fs.mkdirSync(out, { recursive: true });
  const report = {
    file: path.resolve(file),
    sha256: hash(fs.readFileSync(file)),
    viewports: [],
    findings: [],
    screenshots: [],
    status: "running",
  };
  let browser,
    activePage,
    pose = {};
  const saveReport = () =>
    fs.writeFileSync(
      path.join(out, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  // An attempted render consumes a preview even if Chromium or a draw call fails.
  fs.writeFileSync(
    path.join(out, "attempt.json"),
    JSON.stringify(
      {
        file: report.file,
        sha256: report.sha256,
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
  );
  try {
    const { chromium } = await import(
      pathToFileURL(path.join(runtime, "playwright-core/index.mjs"))
    );
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_PATH ?? chromium.executablePath(),
    });
    for (const width of [1280, 375, 1920]) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        deviceScaleFactor: 1,
      });
      activePage = page;
      pose = { width };
      const errors = [];
      const consoleErrors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      page.on("console", (m) => {
        if (m.type() === "error") consoleErrors.push(m.text().slice(0, 1000));
      });
      page.on("request", (r) => {
        if (/^https?:/.test(r.url()))
          report.findings.push({ kind: "external-request", url: r.url() });
      });
      await page.addInitScript(() => (window.__VH_SNAPSHOT = true));
      await page.addInitScript({
        content: "window.__VH_INVALID_GEOMETRY=" + invalidGeometry.toString(),
      });
      await page.goto(pathToFileURL(path.resolve(file)).href);
      await page.waitForFunction(() => document.fonts.status === "loaded");
      // Full-page captures do not scroll lazy original images into view. Load
      // them explicitly in the preview DOM before any model-facing screenshot.
      // This does not rewrite the candidate HTML or its source identity.
      const sourceImages = await page.evaluate(async () => {
        const records = [];
        for (const img of document.querySelectorAll(".source-block img")) {
          const initialLoading = img.loading;
          img.loading = "eager";
          let decoded = true;
          try {
            await img.decode();
          } catch {
            decoded = false;
          }
          records.push({
            anchor: img.closest(".source-block")?.id,
            alt: img.alt,
            initialLoading,
            decoded: decoded && img.naturalWidth > 0,
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight,
          });
        }
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
        return records;
      });
      if (sourceImages.some((img) => !img.decoded))
        report.findings.push({
          width,
          kind: "source-image-decode",
          images: sourceImages.filter((img) => !img.decoded),
        });
      const math = await page.evaluate(() => ({
        expected: +document.body.dataset.mathExpected,
        rendered: document.querySelectorAll(".source-block .katex").length,
        annotationExpected: [
          ...document.querySelectorAll(".vh-annotation"),
        ].reduce((s, n) => s + Number(n.dataset.mathExpected), 0),
        annotationRendered: document.querySelectorAll(".vh-annotation .katex")
          .length,
        errors: document.querySelectorAll(".katex-error").length,
        raw: [...document.querySelectorAll(".source-block")]
          .filter((b) =>
            /\\(?:frac|sum|mathbf|alpha|mathbb)\b/.test(
              [...b.childNodes]
                .filter((n) => n.nodeType === 3)
                .map((n) => n.textContent)
                .join(""),
            ),
          )
          .map((b) => b.id),
        overflow: document.documentElement.scrollWidth > innerWidth + 2,
      }));
      math.raw = await page.evaluate(sourceMathLeaks);
      if (
        math.expected !== math.rendered ||
        math.annotationExpected !== math.annotationRendered ||
        math.errors ||
        math.raw.length
      )
        report.findings.push({ width, kind: "formula-render", ...math });
      if (math.overflow) report.findings.push({ width, kind: "page-overflow" });
      if (errors.length)
        report.findings.push({ width, kind: "javascript", errors });
      const instances = await page.evaluate(
        () => window.VisualBookRuntime?.instances.map((i) => i.id) ?? [],
      );
      const readingLayout = await page.evaluate(() => {
        const rect = (n) => { const r = n.getBoundingClientRect(); return { x:r.x, y:r.y + scrollY, width:r.width, height:r.height }; };
        const notes = [...document.querySelectorAll('.vh-anchor-row')].flatMap((row) => {
          const text = row.querySelector('.vh-anchor-text');
          return [...row.querySelectorAll('.vh-margin-content')].map(margin => ({ text:rect(text), margin:rect(margin), side:margin.dataset.side, row:rect(row) }));
        });
        return { sourceWidths:[...document.querySelectorAll('.source-block')].map((n) => rect(n).width), notes };
      });
      if (readingLayout.sourceWidths.some((w) => w > 744) || readingLayout.notes.some(({text,margin}) =>
        text.x < margin.x + margin.width - 2 && text.x + text.width > margin.x + 2 &&
        text.y < margin.y + margin.height - 2 && text.y + text.height > margin.y + 2))
        report.findings.push({width,kind:"reading-layout",...readingLayout});
      const shapes = [];
      for (const id of instances) {
        const interaction = await page.evaluate(
          (id) =>
            VisualBookRuntime.instances.find((i) => i.id === id).interaction,
          id,
        );
        const interactiveTargets = await page.evaluate(
          (id) =>
            VisualBookRuntime.instances
              .find((i) => i.id === id)
              .svg.querySelectorAll('[tabindex="0"]').length,
          id,
        );
        const initialProgress = await page.evaluate(
          (id) =>
            VisualBookRuntime.instances.find((i) => i.id === id).figure
              .initialProgress ?? 0,
          id,
        );
        await page.locator("#figure-" + id).scrollIntoViewIfNeeded();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const readingFile = path.join(out, `${width}-${id}-reading.png`);
        await page.locator("#figure-" + id).screenshot({ path: readingFile });
        report.screenshots.push(path.resolve(readingFile));
        const readingState = await page.locator("#figure-" + id).evaluate((n) => ({
          placement:n.dataset.placement, presentation:n.dataset.presentation,
          canvasWidth:n.querySelector('.vh-canvas').clientWidth,
          visibleControls:[...n.querySelectorAll('button,input,select')].filter((e) => e.checkVisibility()).length,
          explorationOpen:n.querySelector('.vh-explore')?.open ?? null,
        }));
        if (width === 1920 || id === instances[0]) {
          const contextFile = path.join(out, `${width}-${id}-reading-context.png`);
          await page.locator("#figure-" + id).evaluate((n) => scrollTo(0, Math.max(0, n.getBoundingClientRect().top + scrollY - 240)));
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          await page.screenshot({path:contextFile});
          report.screenshots.push(path.resolve(contextFile));
        }
        // Explore separately: initial reading screenshots above retain the default UI.
        await page.locator("#figure-" + id + " .vh-explore").evaluateAll((nodes) => nodes.forEach((n) => n.open = true));
        const frames = [];
        for (const progress of [
          ...new Set([0, 0.25, 0.26, 0.5, 1, initialProgress]),
        ].sort((a, b) => a - b)) {
          pose = { width, id, progress };
          await page.evaluate(
            ({ id, progress }) => {
              const i = VisualBookRuntime.instances.find((i) => i.id === id);
              i.setProgress(progress, true);
            },
            { id, progress },
          );
          await page.locator("#figure-" + id).scrollIntoViewIfNeeded();
          // Scrolling pauses playback; setting the deterministic pose does not start it.
          await page.evaluate(
            ({ id, progress }) =>
              VisualBookRuntime.instances
                .find((i) => i.id === id)
                .setProgress(progress, true),
            { id, progress },
          );
          const state = await page.evaluate((id) => {
            const i = VisualBookRuntime.instances.find((i) => i.id === id),
              svg = i.svg,
              box = svg.viewBox.baseVal;
            const visible = (n) => {
              let opacity = 1;
              for (
                let p = n;
                p && p !== svg.parentElement;
                p = p.parentElement
              ) {
                const s = getComputedStyle(p);
                if (s.display === "none" || s.visibility === "hidden")
                  return false;
                opacity *= Number(s.opacity || 1);
              }
              return opacity > 0.015;
            };
            const text = [...svg.querySelectorAll("text")]
              .filter(visible)
              .map((n) => {
                const b = n.getBBox(),
                  matrix = svg
                    .getScreenCTM()
                    .inverse()
                    .multiply(n.getScreenCTM()),
                  points = [
                    [b.x, b.y],
                    [b.x + b.width, b.y],
                    [b.x, b.y + b.height],
                    [b.x + b.width, b.y + b.height],
                  ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(matrix)),
                  xs = points.map((p) => p.x),
                  ys = points.map((p) => p.y);
                return {
                  text: n.textContent,
                  x: Math.min(...xs),
                  y: Math.min(...ys),
                  w: Math.max(...xs) - Math.min(...xs),
                  h: Math.max(...ys) - Math.min(...ys),
                  size: parseFloat(getComputedStyle(n).fontSize),
                };
              });
            const overlaps = [];
            for (let a = 0; a < text.length; a++)
              for (let b = a + 1; b < text.length; b++) {
                const x = text[a],
                  y = text[b];
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
              progress: i.progress,
              facts: i.facts,
              error: i.error ?? null,
              svg: new XMLSerializer().serializeToString(svg),
              outside: text.filter(
                (t) =>
                  t.x < -2 ||
                  t.y < -2 ||
                  t.x + t.w > box.width + 2 ||
                  t.y + t.h > box.height + 2,
              ),
              tiny: text.filter((t) => t.size < 12),
              overlaps,
              invalidGeometry: window.__VH_INVALID_GEOMETRY(svg),
            };
          }, id);
          if (
            state.error ||
            state.outside.length ||
            state.tiny.length ||
            state.overlaps.length ||
            state.invalidGeometry.length
          )
            report.findings.push({
              width,
              id,
              progress,
              kind: "figure-layout",
              error: state.error,
              outside: state.outside,
              tiny: state.tiny,
              overlaps: state.overlaps,
              invalidGeometry: state.invalidGeometry,
            });
          frames.push({ ...state, svgHash: hash(state.svg), svg: undefined });
          if (progress === initialProgress) {
            const dir = path.join(out, "static");
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, `${width}-${id}.svg`), state.svg);
          }
          if (progress === 0.5 && id === instances[0]) {
            await page
              .locator("#figure-" + id)
              .evaluate((n) =>
                window.scrollTo(
                  0,
                  Math.max(
                    0,
                    n.getBoundingClientRect().top + window.scrollY - 150,
                  ),
                ),
              );
            const contextFile = path.join(out, `${width}-${id}-context.png`);
            await page.screenshot({ path: contextFile });
            report.screenshots.push(path.resolve(contextFile));
          }
          if ([0, 0.5, 1].includes(progress)) {
            const filename = path.join(out, `${width}-${id}-${progress}.png`);
            await page.locator("#figure-" + id).screenshot({ path: filename });
            report.screenshots.push(path.resolve(filename));
          }
        }
        if (
          interaction === "timeline" &&
          frames.find((f) => f.progress === 0.25).svgHash ===
            frames.find((f) => f.progress === 0.26).svgHash
        )
          report.findings.push({
            width,
            id,
            kind: "no-fractional-change",
            note: "0.25 and 0.26 produced identical SVG; review whether this is intentional",
          });
        shapes.push({
          id,
          interaction,
          initialProgress,
          readingState,
          declaredParameterControls: await page.locator("#figure-" + id + " [data-param]").count(),
          interactiveTargets,
          frames,
        });
      }
      const filename = path.join(out, `${width}-page.png`);
      await page.screenshot({ path: filename, fullPage: true });
      report.screenshots.push(path.resolve(filename));
      report.viewports.push({ width, math, sourceImages, readingLayout, shapes });
      if (consoleErrors.length)
        report.findings.push({
          width,
          kind: "browser-console-error",
          errors: [...new Set(consoleErrors)],
        });
      if (
        errors.length &&
        !report.findings.some(
          (f) => f.kind === "javascript" && f.width === width,
        )
      )
        report.findings.push({ width, kind: "javascript", errors });
      await page.close();
      activePage = null;
    }
  } catch (error) {
    report.status = "failed";
    report.findings.push({
      ...pose,
      kind: "render-runtime-error",
      error: String(error),
    });
    if (activePage && !activePage.isClosed()) {
      try {
        const filename = path.join(out, "failed-render.png");
        await activePage.screenshot({ path: filename });
        report.screenshots.push(path.resolve(filename));
      } catch (captureError) {
        report.findings.push({
          kind: "failure-screenshot-error",
          error: String(captureError),
        });
      }
    }
  } finally {
    if (browser)
      await browser.close().catch((error) =>
        report.findings.push({
          kind: "browser-close-error",
          error: String(error),
        }),
      );
    saveReport();
  }
  if (report.status === "failed") return report;
  let parameters;
  try {
    parameters = await auditParameters(file, path.join(out, "parameters"));
  } catch (error) {
    report.status = "failed";
    report.findings.push({
      kind: "parameter-audit-runtime-error",
      error: String(error),
    });
    saveReport();
    return report;
  }
  report.parameterAudit = {
    cases: parameters.cases.length,
    scope: parameters.scope,
  };
  report.findings.push(
    ...parameters.findings.map((f) => ({
      ...f,
      problem: f.kind ?? "layout",
      kind: "parameter-boundary",
    })),
  );
  for (const viewport of report.viewports)
    for (const shape of viewport.shapes)
      if (
        shape.interaction === "parameters" &&
        !shape.interactiveTargets &&
        !shape.declaredParameterControls
      )
        report.findings.push({
          kind: "no-interaction",
          width: viewport.width,
          id: shape.id,
          note: "Parameter exploration has no rendered handles or parameter controls",
        });
  if (report.findings.length) {
    report.interactionAudit = {
      status: "skipped",
      reason: "Resolve existing render/parameter findings first",
    };
  } else {
    const directory = path.join(out, "interactions");
    const interaction = await auditInteractions(file, directory);
    report.interactionAudit = {
      status: interaction.status,
      cases: interaction.cases.length,
      coverage: interaction.coverage,
      scope: interaction.scope,
    };
    report.findings.push(
      ...interaction.findings.map((f) => ({
        ...f,
        problem: f.kind,
        kind: "interaction-control",
      })),
    );
    for (const name of fs.readdirSync(directory))
      if (/^failure-.*\.png$/.test(name))
        report.screenshots.push(path.resolve(directory, name));
    if (interaction.status !== "completed") {
      report.status = "failed";
      saveReport();
      return report;
    }
  }
  report.status = "completed";
  saveReport();
  return report;
}
export function staticExport(file, previewDir, out) {
  const report = json(path.join(previewDir, "report.json"));
  if (report.sha256 !== hash(fs.readFileSync(file)))
    throw Error("Preview is stale; render this HTML before export");
  if (report.findings.length)
    throw Error("Known render findings stop static export");
  let html = fs.readFileSync(file, "utf8");
  for (const shape of report.viewports[0].shapes) {
    const picture = [1280, 375]
      .map((w) =>
        fs.readFileSync(
          path.join(previewDir, "static", `${w}-${shape.id}.svg`),
        ),
      )
      .map((bytes) => {
        // Earlier snapshots used HTML serialization without an SVG namespace.
        let svg = bytes.toString("utf8");
        if (!/<svg\b[^>]*\bxmlns=/.test(svg))
          svg = svg.replace(
            /<svg\b/,
            '<svg xmlns="http://www.w3.org/2000/svg"',
          );
        return (
          "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64")
        );
      });
    const fallback = `<div class="vh-static"><picture><source media="(max-width:600px)" srcset="${picture[1]}"><img src="${picture[0]}" alt="图解初始状态：${esc(shape.id)}"></picture></div>`;
    const marker = new RegExp(
      `(<figure\\b[^>]*\\bid="figure-${shape.id}"[^>]*>)`,
    );
    if (!marker.test(html))
      throw Error("Static fallback figure is missing: " + shape.id);
    html = html.replace(marker, (_, opening) => opening + fallback);
  }
  html = html
    .replace('<html lang="zh-CN">', '<html lang="zh-CN" class="no-js">')
    .replace(
      "</head>",
      '<style>.no-js .vh-static{display:block}.no-js .vh-canvas,.no-js .vh-toolbar,.no-js .vh-bar,.no-js .vh-params,.no-js .vh-reading-actions,.no-js .vh-cases{display:none}</style><script>document.documentElement.classList.remove("no-js")</script></head>',
    );
  fs.writeFileSync(out, html);
  const licenses = [
    ["D3-LICENSE.txt", path.join(runtime, "d3/LICENSE")],
    ["KaTeX-LICENSE.txt", path.join(runtime, "katex/LICENSE")],
    ["Dagre-LICENSE.txt", path.join(runtime, "@dagrejs/dagre/LICENSE")],
    ["Graphlib-LICENSE.txt", path.join(runtime, "@dagrejs/graphlib/LICENSE")],
    [
      "D2L-LICENSE.txt",
      path.join(root, "work/visualbook/upstreams/d2l-zh/LICENSE"),
    ],
  ];
  for (const [name, src] of licenses)
    if (
      name !== "D2L-LICENSE.txt" ||
      html.includes('data-source-name="D2L"') ||
      /href="https:\/\/zh\.d2l\.ai\//.test(html)
    )
      fs.copyFileSync(src, path.join(path.dirname(out), name));
  return {
    file: path.resolve(out),
    sha256: hash(html),
    previewSha256: report.sha256,
  };
}
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "catalog") {
    console.log(fs.readFileSync(path.join(lib, "API.md"), "utf8"));
    return;
  }
  if (command === "resolve-plan") {
    if (fs.existsSync(args[1])) throw Error("Expanded plan output exists");
    fs.writeFileSync(
      args[1],
      JSON.stringify(resolvePlan(json(args[0])), null, 2) + "\n",
    );
    console.log(
      JSON.stringify({
        file: path.resolve(args[1]),
        kind: "deterministic named-design expansion; no model or render",
      }),
    );
    return;
  }
  if (command === "gallery") {
    const blocks = [
      "共享坐标让向量的角度和长度可以直接比较。",
      "横向倍率改变向量的横坐标，纵坐标保持不变。",
      "同一个对象沿处理链路逐步向前。",
      "窄屏竖向排布，信息的顺序保持相同。",
    ].map((raw, i) => ({
      id: `gallery-${String(i + 1).padStart(3, "0")}`,
      raw,
      type: "paragraph",
      sha256: hash(raw),
      math: { expected: 0 },
      html: `<p>${raw}</p>`,
    }));
    const source = {
      title: "可复用设计与连续交互",
      sourceUrl: "https://github.com/siddhartha-yz/visualbook-harness",
      sourceSha256: hash(JSON.stringify(blocks)),
      blocks,
    };
    fs.mkdirSync(path.dirname(path.resolve(args[0])), { recursive: true });
    fs.writeFileSync(
      args[0],
      build(source, json(path.join(lib, "gallery.json"))),
    );
    console.log(args[0]);
    return;
  }
  if (command === "import") {
    process.env.VISUALBOOK_SAMPLING = path.resolve(args[0]);
    process.env.VISUALBOOK_OUTPUT = path.resolve(args[1]);
    const { prepare } = await import("../experiments/visualbook/prepare.mjs");
    console.log(
      JSON.stringify(
        prepare().map((b) => ({
          id: b.id,
          blocks: b.blocks.length,
          math: b.adaptation.mathRendered,
        })),
      ),
    );
    return;
  }
  if (command === "build") {
    const [source, plan, out] = args;
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    const resolved = resolvePlan(json(plan));
    const html = build(json(source), json(plan), {
      direct: args.includes("--direct"),
    });
    fs.writeFileSync(out, html);
    const outputName = path.parse(out).name;
    const resolvedFile = path.join(
      path.dirname(path.resolve(out)),
      outputName === "book"
        ? "resolved-plan.json"
        : outputName + ".resolved-plan.json",
    );
    fs.writeFileSync(resolvedFile, JSON.stringify(resolved, null, 2) + "\n");
    console.log(
      JSON.stringify({
        html: path.resolve(out),
        sha256: hash(html),
        figures: json(plan).figures.length,
        resolvedPlan: resolvedFile,
        resolvedPlanSha256: hash(fs.readFileSync(resolvedFile)),
        namedDesigns: json(plan)
          .figures.filter((f) => f.design)
          .map((f) => f.design),
      }),
    );
    return;
  }
  if (command === "preview") {
    const report = await preview(args[0], args[1]);
    console.log(
      JSON.stringify({
        status: report.status,
        candidateSha256: report.sha256,
        report: path.resolve(args[1], "report.json"),
        findings: report.findings,
        screenshots: report.screenshots,
      }),
    );
    return;
  }
  if (command === "export") {
    console.log(JSON.stringify(staticExport(args[0], args[1], args[2])));
    return;
  }
  throw Error(
    "Use: catalog | import sampling.json out-dir | build source.json plan.json book.html [--direct] | preview book.html new-evidence-dir",
  );
}
if (process.argv[1] === import.meta.filename)
  main().catch((e) => {
    console.error(e.stack);
    process.exitCode = 1;
  });
