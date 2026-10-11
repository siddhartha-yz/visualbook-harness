import fs from "node:fs";
import path from "node:path";
import { importMarkdown } from "../packages/visualbook/import.mjs";
import { partitionSource } from "../packages/visualbook/partition.mjs";
const [input, output, optionsJSON = "{}"] = process.argv.slice(2);
if (!input || !output || fs.existsSync(output)) throw Error("Input Markdown and fresh output directory required");
const work = path.resolve(import.meta.dirname, "../work"), relative = path.relative(work, path.resolve(output));
if (relative.startsWith("..") || path.isAbsolute(relative)) throw Error("Partitioned original textbooks must stay in ignored work/");
const options = JSON.parse(optionsJSON), source = importMarkdown(input, options);
const split = partitionSource(source, options);
fs.mkdirSync(output, { recursive: true });
const manifest = { title: source.title, description: "按原书标题划分，保留所有原文块。", chapters: [] };
for (const chapter of split.chapters) {
  const name = chapter.id + ".source.json";
  fs.writeFileSync(path.join(output, name), JSON.stringify(chapter, null, 2) + "\n");
  manifest.chapters.push({ id: chapter.id, source: name });
}
fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
fs.writeFileSync(path.join(output, "coverage.json"), JSON.stringify(split.coverage, null, 2) + "\n");
console.log(JSON.stringify(split.coverage));
