/* Recompile an unchanged Markdown candidate with updated shared tools. No author. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { importMarkdown } from "../packages/visualbook/import.mjs";
import { build, preview } from "./visualbook.mjs";
import { workspaceRoot } from "./visualbook_workspace.mjs";

const [sourceFile, planFile, output] = process.argv.slice(2);
const root = path.resolve(import.meta.dirname, ".."), out = path.resolve(output ?? ".");
const sha = value => crypto.createHash("sha256").update(value).digest("hex");
if (!sourceFile || !planFile || !output || fs.existsSync(out))
  throw Error("Use source JSON, unchanged plan and a fresh ignored work/ output");
const owner = workspaceRoot(root);
const work = fs.realpathSync(owner + "/work"), parent = fs.realpathSync(path.dirname(out));
if (!out.startsWith(owner + "/work/") || parent !== work && !parent.startsWith(work + path.sep))
  throw Error("Rebuild output must stay in ignored work/");
fs.mkdirSync(out);
const record = { status: "started", modelCalls: 0,
  scope: "Shared-tool reimport/recompile of an unchanged source and supplied plan. Plan identity is checked against the supplied file, not its authorship. Does not change the original author result, resolve semantic issues automatically or certify art/teaching quality." };
const save = () => fs.writeFileSync(out + "/rebuild-record.json", JSON.stringify(record, null, 2) + "\n");
save();
try {
  record.sourceJsonSha256 = sha(fs.readFileSync(sourceFile));
  record.planSha256 = sha(fs.readFileSync(planFile));
  const original = JSON.parse(fs.readFileSync(sourceFile)), plan = JSON.parse(fs.readFileSync(planFile));
  if (!original.source || path.extname(original.source).toLowerCase() !== ".md")
    throw Error("Only generic Markdown sources with the original local file can be reimported");
  const imported = importMarkdown(original.source, { id: original.id, sourceName: original.sourceName,
    sourceUrl: original.sourceUrl, license: original.license });
  if (original.sourceSha256 !== imported.sourceSha256) throw Error("Original Markdown content changed");
  const identity = book => book.blocks.map(b => [b.id, b.type, b.depth, b.line, b.raw, b.sha256, b.math.expected]);
  if (JSON.stringify(identity(original)) !== JSON.stringify(identity(imported)))
    throw Error("Original block coverage, positions or formula identity changed; use a fresh full import instead");
  const assets = book => book.blocks.flatMap(b => [...b.html.matchAll(/\bsrc="(data:image\/[^\"]+)"/g)].map(m => sha(m[1])));
  if (JSON.stringify(assets(original)) !== JSON.stringify(assets(imported)))
    throw Error("Local image content changed");
  fs.writeFileSync(out + "/source.json", JSON.stringify(imported, null, 2) + "\n");
  fs.copyFileSync(planFile, out + "/book.json");
  const html = build(imported, plan);
  fs.writeFileSync(out + "/book.html", html);
  const report = await preview(out + "/book.html", out + "/preview");
  Object.assign(record, { status: report.findings.length ? "render-failed" : "awaiting-review",
    sourceSha256: imported.sourceSha256, originalBlocksPreserved: true, originalAssetsPreserved: true,
    inputPlanUnchanged: sha(fs.readFileSync(out + "/book.json")) === record.planSha256,
    htmlSha256: sha(html), adaptation: imported.adaptation, renderFindings: report.findings,
    toolHashes: Object.fromEntries(["packages/visualbook/import.mjs", "packages/visualbook/emphasis.mjs",
      "packages/visualbook/markdown-math.mjs", "tools/visualbook.mjs"].map(n => [n, sha(fs.readFileSync(root + "/" + n))])) });
  if (report.findings.length) process.exitCode = 1;
} catch (error) {
  record.status = "failed"; record.error = String(error); process.exitCode = 1;
} finally { save(); }
console.log(JSON.stringify({ output: out, status: record.status, modelCalls: 0 }));
