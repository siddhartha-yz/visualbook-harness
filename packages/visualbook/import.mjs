// General Markdown adapter. D2L/Sphinx keeps its separately pinned adapter.
import fs from "node:fs";
import { normalizeEmphasis } from "./emphasis.mjs";
import { prepareMathMarkdown } from "./markdown-math.mjs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { renderingMath, countMath, inspectMath } from "./math.mjs";
const root = path.resolve(import.meta.dirname, "../.."),
  dependencies = path.join(root, "work/visualbook/runtime/node_modules");
const get = (name) =>
  import(pathToFileURL(path.join(dependencies, name, "index.js")));
const [
  { unified },
  { default: parse },
  { default: gfm },
  { default: math },
  { toHast },
  { toHtml },
  { default: katex },
  { VFile },
] = await Promise.all([
  get("unified"),
  get("remark-parse"),
  get("remark-gfm"),
  get("remark-math"),
  get("mdast-util-to-hast"),
  get("hast-util-to-html"),
  get("rehype-katex"),
  get("vfile"),
]);
const parser = unified().use(parse).use(gfm).use(math),
  sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
function walk(node, callback) {
  callback(node);
  for (const child of node.children ?? []) walk(child, callback);
}
export function importMarkdown(
  file,
  {
    id = "chapter",
    sourceUrl = "",
    sourceName = "输入教材",
    license = null,
  } = {},
) {
  if (!/^[a-z][a-z0-9-]*$/.test(id)) throw Error("Invalid chapter id");
  const sourcePath = fs.realpathSync(file),
    base = path.dirname(sourcePath),
    raw = fs.readFileSync(sourcePath, "utf8"),
    prepared = prepareMathMarkdown(raw),
    tree = parser.parse(prepared.text),
    adaptation = { images: 0, mathExpected: 0, mathRendered: 0,
      displayFenceAdapted: prepared.adapted, quotedMathLinesJoined: prepared.quotedLinesJoined };
  walk(tree, (node) => {
    if (!node.position) return;
    for (const edge of ["start", "end"]) {
      const offset = prepared.sourceOffset(node.position[edge].offset);
      node.position[edge] = { offset, line: raw.slice(0, offset).split("\n").length,
        column: offset - raw.lastIndexOf("\n", offset - 1) };
    }
  });
  walk(tree, (node) => {
    if (node.type === "html")
      throw Error(
        "Raw HTML is unsupported in the Markdown adapter; keep a source-specific adapter instead of silently dropping it",
      );
    if (["footnoteDefinition", "footnoteReference"].includes(node.type))
      throw Error("Footnotes require a source-specific adapter; generic import refuses to drop or duplicate their content");
  });
  const definitions = tree.children.filter(n => n.type === "definition");
  const blocks = tree.children.map((node, i) => {
    const text = raw.slice(
      node.position.start.offset,
      node.position.end.offset,
    );
    let render = node;
    if (
      node.type === "paragraph" &&
      node.children.length === 1 &&
      node.children[0].type === "inlineMath" &&
      text.trim().startsWith("$$") &&
      text.trim().endsWith("$$")
    )
      render = {
        type: "math",
        value: node.children[0].value,
        position: node.position,
      };
    if (["paragraph", "heading"].includes(node.type)) {
      const normalized = normalizeEmphasis(text);
      if (normalized !== text) {
        render = parser.parse(normalized).children[0];
        adaptation.emphasisAdapted = (adaptation.emphasisAdapted ?? 0) + 1;
      }
    }
    render = renderingMath(render, adaptation);
    const hast = toHast(
      { type: "root", children: [render, ...definitions.filter(n => n !== node)] },
      { allowDangerousHtml: false },
    );
    const diagnostics = new VFile();
    unified()
      .use(katex, { trust: false, strict: "ignore" })
      .runSync(hast, diagnostics);
    if (diagnostics.messages.length)
      throw Error(
        "Formula coverage failed: " +
          diagnostics.messages
            .map((m) => m.cause?.message ?? m.reason)
            .join("; "),
      );
    const coverage = inspectMath(hast, countMath(render));
    adaptation.mathExpected += coverage.expected;
    adaptation.mathRendered += coverage.rendered;
    walk(hast, (n) => {
      if (n.tagName === "a" && /^javascript:/i.test(n.properties.href ?? ""))
        throw Error("Unsupported script link");
      if (n.tagName !== "img") return;
      const name = n.properties.src;
      if (/^data:image\//.test(name)) return;
      if (/^[a-z]+:/i.test(name) || name.startsWith("//"))
        throw Error(
          "Remote images must be supplied as local assets; import never downloads implicitly",
        );
      const target = fs.realpathSync(
          path.resolve(base, decodeURIComponent(name)),
        ),
        relative = path.relative(base, target);
      if (relative.startsWith("..") || path.isAbsolute(relative))
        throw Error("Image escapes source directory");
      const ext = path.extname(target).toLowerCase().slice(1),
        types = {
          svg: "svg+xml",
          png: "png",
          jpg: "jpeg",
          jpeg: "jpeg",
          gif: "gif",
          webp: "webp",
        };
      if (!types[ext]) throw Error("Unsupported local image type");
      const bytes = fs.readFileSync(target);
      if (bytes.length > 20 * 1024 * 1024) throw Error("Image exceeds 20MB");
      n.properties.src = `data:image/${types[ext]};base64,${bytes.toString("base64")}`;
      n.properties.loading = "lazy";
      adaptation.images++;
    });
    return {
      id: `${id}-${String(i + 1).padStart(3, "0")}`,
      sha256: sha(text),
      type: node.type,
      depth: node.depth ?? null,
      line: node.position.start.line,
      raw: text,
      math: coverage,
      html: toHtml(hast),
    };
  });
  return {
    id,
    title:
      blocks.find((b) => b.type === "heading")?.raw.replace(/^#+\s*/, "") ?? id,
    sourceName,
    source: sourcePath,
    sourceUrl,
    sourceSha256: sha(raw),
    adaptedSha256: sha(raw),
    license,
    adaptation,
    blocks,
  };
}
if (process.argv[1] === import.meta.filename) {
  const [file, out, options = "{}"] = process.argv.slice(2);
  if (!file || !out)
    throw Error(
      "Use: node packages/visualbook/import.mjs input.md source.json [options-json]",
    );
  const book = importMarkdown(file, JSON.parse(options));
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(book, null, 2) + "\n");
  console.log(
    JSON.stringify({
      source: out,
      blocks: book.blocks.length,
      math: book.adaptation.mathRendered,
    }),
  );
}
