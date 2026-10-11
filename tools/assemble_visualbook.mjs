// Assemble already-generated chapters. No model call, no authored-source rewrite.
import fs from "node:fs";
import crypto from "node:crypto";
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
import path from "node:path";
import { build, preview, staticExport } from "./visualbook.mjs";
import { bookNavigation } from "../packages/visualbook/book-navigation.mjs";
const esc = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const [manifestFile, outDir] = process.argv.slice(2);
if (!manifestFile || !outDir)
  throw Error(
    "Use: node tools/assemble_visualbook.mjs manifest.json output-directory",
  );
const manifest = JSON.parse(fs.readFileSync(manifestFile)),
  out = path.resolve(outDir),
  records = [];
if (!Array.isArray(manifest.chapters)) throw Error("Missing chapters");
if (manifest.navigation !== undefined && typeof manifest.navigation !== "boolean") throw Error("navigation must be boolean");
const chapterTitles = manifest.chapters.map(c => ({ id:c.id, title:JSON.parse(fs.readFileSync(c.source)).title }));
if (
  !manifest.chapters.length ||
  manifest.chapters.length > 32 ||
  new Set(manifest.chapters.map((c) => c.id)).size !== manifest.chapters.length
)
  throw Error("Use 1..32 uniquely named chapters");
if (fs.existsSync(out))
  throw Error("Assembly output exists; retain it and use a fresh directory");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(
  path.join(out, "assembly-attempt.json"),
  JSON.stringify(
    {
      status: "started",
      manifestSha256: sha(fs.readFileSync(manifestFile)),
      modelCalls: 0,
    },
    null,
    2,
  ) + "\n",
);
let activeChapter;
try {
  for (const c of manifest.chapters) {
    activeChapter = c.id;
    if (!/^[a-z][a-z0-9-]*$/.test(c.id)) throw Error("Invalid chapter id");
    const source = JSON.parse(fs.readFileSync(c.source)),
      plan = JSON.parse(fs.readFileSync(c.plan)),
      file = path.join(out, c.id + ".html"),
      inputs = path.join(out, "sources", c.id),
      rawFile = path.join(inputs, "book.html");
    fs.mkdirSync(inputs, { recursive: true });
    fs.copyFileSync(c.source, path.join(inputs, "source.json"));
    fs.copyFileSync(c.plan, path.join(inputs, "plan.json"));
    const previewDir = path.join(out, "evidence", c.id);
    let report,
      reuse = false;
    if (c.html || c.preview || c.review) {
      if (!c.html || !c.preview || !c.review)
        throw Error(
          "Candidate reuse requires HTML, preview and review together",
        );
      const html = fs.readFileSync(c.html),
        review = JSON.parse(fs.readFileSync(c.review));
      report = JSON.parse(fs.readFileSync(path.join(c.preview, "report.json")));
      if (
        report.sha256 !== sha(html) ||
        report.status !== "completed" ||
        !review.ready_for_export ||
        review.issues?.length ||
        review.html_sha256 !== sha(html) ||
        review.plan_sha256 !== sha(fs.readFileSync(c.plan))
      )
        throw Error(
          "Reviewed candidate identity or issue gate failed for " + c.id,
        );
      if (!html.toString().includes(`data-source-sha="${source.sourceSha256}"`))
        throw Error("Candidate source identity differs for " + c.id);
      fs.writeFileSync(rawFile, html);
      fs.copyFileSync(c.review, path.join(inputs, "review.json"));
      fs.cpSync(c.preview, previewDir, { recursive: true, dereference: true });
      reuse = true;
    } else {
      fs.writeFileSync(
        rawFile,
        build(source, plan, { direct: c.arm === "direct" }),
      );
      report = await preview(rawFile, previewDir);
    }
    if (report.findings.length) {
      fs.writeFileSync(
        path.join(out, "build-failure.json"),
        JSON.stringify({ id: c.id, findings: report.findings }, null, 2),
      );
      throw Error(
        "Assembly found unresolved render issues in " +
          c.id +
          "; diagnostics retained",
      );
    }
    const exported = staticExport(rawFile, previewDir, file);
    if(manifest.navigation) {
      fs.writeFileSync(file,bookNavigation(fs.readFileSync(file,'utf8'),chapterTitles,records.length));
      exported.preNavigationSha256=exported.sha256;
      exported.sha256=sha(fs.readFileSync(file));
    }
    records.push({
      id: c.id,
      title: source.title,
      file: c.id + ".html",
      figures: plan.figures.length,
      sourceSha256: source.sourceSha256,
      arm: c.arm,
      finalHtmlSha256: sha(fs.readFileSync(file)),
      sourceJsonSha256: sha(fs.readFileSync(c.source)),
      planSha256: sha(fs.readFileSync(c.plan)),
      rawHtmlSha256: sha(fs.readFileSync(rawFile)),
      previewReportSha256: sha(
        fs.readFileSync(path.join(previewDir, "report.json")),
      ),
      reusedReviewedCandidate: reuse,
      navigation: manifest.navigation ? "Original header links preserved; deterministic previous/next links outside main. Reviewed source/figures unchanged; final export needs separate reader check." : false,
      rawFile: path.relative(out, rawFile),
      exported,
      renderFindings: report.findings,
      preview: previewDir,
    });
    fs.writeFileSync(
      path.join(out, "assembly-progress.json"),
      JSON.stringify({ records, modelCalls: 0 }, null, 2) + "\n",
    );
  }
} catch (error) {
  fs.writeFileSync(
    path.join(out, "assembly-failure.json"),
    JSON.stringify(
      { id: activeChapter, error: String(error), records, modelCalls: 0 },
      null,
      2,
    ) + "\n",
  );
  throw error;
}
const css = fs.readFileSync(
  new URL("../packages/visualbook/theme.css", import.meta.url),
  "utf8",
);
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(manifest.title ?? "VisualBook")}</title><style>${css}</style><body><main class="library"><div class="eyebrow">VISUALBOOK</div><h1>${esc(manifest.title ?? "读懂变化")}</h1><p>${esc(manifest.description ?? "保留完整教材，边读边看关系怎样变化。")}</p>${records.map((c) => `<article class="book-link"><h2><a href="${c.file}">${esc(c.title)}</a></h2>${manifest.labels?.[c.id] ? `<p>${esc(manifest.labels[c.id])}</p>` : ""}</article>`).join("")}<p class="source-note">原文来源与许可证随章节保留。图中参数用于解释，读者可以自行控制变化。</p></main></body></html>`;
fs.writeFileSync(path.join(out, "index.html"), html);
fs.writeFileSync(
  path.join(out, "build-record.json"),
  JSON.stringify(
    {
      records,
      modelCalls: 0,
      indexSha256: sha(Buffer.from(html)),
      quality:
        "rendered chapters; artistic acceptance requires separate review",
    },
    null,
    2,
  ) + "\n",
);
fs.writeFileSync(
  path.join(out, "assembly-attempt.json"),
  JSON.stringify(
    {
      status: "completed",
      manifestSha256: sha(fs.readFileSync(manifestFile)),
      indexSha256: sha(Buffer.from(html)),
      modelCalls: 0,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    index: path.join(out, "index.html"),
    chapters: records.length,
    findings: records.reduce((n, c) => n + c.renderFindings.length, 0),
    modelCalls: 0,
  }),
);
