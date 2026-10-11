// Partition already-imported blocks, retaining original anchors, HTML and hashes.
import crypto from "node:crypto";
export function partitionSource(source, { level = 2, maxChapters = 32 } = {}) {
  if (![2, 3].includes(level) || !Number.isInteger(maxChapters) || maxChapters < 1 || maxChapters > 32)
    throw Error("Partition level must be 2/3 and chapter limit 1..32");
  if (!/^[a-z][a-z0-9-]*$/.test(source.id ?? "") || !Array.isArray(source.blocks) || !source.blocks.length)
    throw Error("Partition requires a nonempty imported source");
  const headings = source.blocks.flatMap((b, i) => b.type === "heading" && b.depth >= 2 && b.depth <= level ? [i] : []);
  // Front matter stays with the first section. No duplicate preface or discarded blocks.
  const cuts = [0, ...headings.slice(1), source.blocks.length];
  if (cuts.length - 1 > maxChapters)
    throw Error(`Source has ${cuts.length - 1} chapters, above explicit limit ${maxChapters}; select a smaller input or raise the limit before generation`);
  const chapters = cuts.slice(0, -1).map((start, i) => {
    const end = cuts[i + 1], blocks = source.blocks.slice(start, end);
    const heading = blocks.find(b => b.type === "heading" && b.depth >= 2 && b.depth <= level);
    const formulas = blocks.reduce((n, b) => n + (b.math?.expected ?? 0), 0);
    return { ...source, id: `${source.id}-s${String(i + 1).padStart(3, "0")}`,
      title: heading?.raw.replace(/^#+\s*/, "") ?? source.title,
      adaptation: { ...source.adaptation, mathExpected: formulas, mathRendered: formulas,
        images: blocks.reduce((n, b) => n + (b.html.match(/<img\b/g) ?? []).length, 0) },
      partition: { parentId: source.id, parentTitle: source.title, parentSourceSha256: source.sourceSha256,
        level, blockRange: [start, end], parentBlockCount: source.blocks.length,
        firstSourceLine: blocks[0].line, lastSourceLine: blocks.at(-1).line }, blocks };
  });
  const ids = chapters.flatMap(c => c.blocks.map(b => b.id));
  if (ids.length !== source.blocks.length || ids.some((id, i) => id !== source.blocks[i].id) || new Set(ids).size !== ids.length)
    throw Error("Partition coverage mismatch; every original block must appear exactly once in order");
  return { chapters, coverage: { blocks: ids.length, chapters: chapters.length, formulas: chapters.reduce((n, c) => n + c.adaptation.mathExpected, 0),
    orderedBlockSha256: crypto.createHash("sha256").update(JSON.stringify(source.blocks.map(b => [b.id, b.sha256]))).digest("hex"),
    sourceSha256: source.sourceSha256,
    scope: "Original imported blocks, including front matter, appear once in order. Prose, formulas, local image data and anchors are retained; no model generation or source correctness claim." } };
}
