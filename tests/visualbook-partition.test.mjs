import test from "node:test";
import assert from "node:assert/strict";
import { partitionSource } from "../packages/visualbook/partition.mjs";
const blocks = [
  { id: "book-001", type: "heading", depth: 1, raw: "# Book" },
  { id: "book-002", type: "paragraph", raw: "Preface", math: { expected: 1 } },
  { id: "book-003", type: "heading", depth: 2, raw: "## First" },
  { id: "book-004", type: "heading", depth: 3, raw: "### Subsection" },
  { id: "book-005", type: "code", raw: "## Not a heading" },
  { id: "book-006", type: "paragraph", raw: "![image](local.svg)", html: "<p><img src='data:image/svg+xml;base64,...'></p>" },
  { id: "book-007", type: "heading", depth: 2, raw: "## Second" },
  { id: "book-008", type: "paragraph", raw: "Last", math: { expected: 2 } },
].map((b, i) => ({ html: "<p>content</p>", sha256: "hash-" + i, line: i * 3 + 1, ...b }));
const source = { id: "book", title: "Book", sourceSha256: "parent-hash", adaptation: { mathExpected: 3, mathRendered: 3, images: 1 }, blocks };
test("H2 partitions preserve preface, last paragraph, images, formulas and all original anchors exactly once", () => {
  const result = partitionSource(source);
  assert.equal(result.chapters.length, 2);
  assert.equal(result.chapters[0].title, "First");
  assert.deepEqual(result.chapters.flatMap(c => c.blocks), blocks);
  assert.deepEqual(result.chapters.map(c => c.partition.blockRange), [[0, 6], [6, 8]]);
  assert.deepEqual(result.chapters.map(c => c.adaptation.images), [1, 0]);
  assert.equal(result.coverage.formulas, 3);
  assert.equal(result.coverage.sourceSha256, "parent-hash");
  assert.equal(source.id, "book");
});
test("H3 boundaries are structural and oversized chapter counts fail before returning partial output", () => {
  const result = partitionSource(source, { level: 3 });
  assert.equal(result.chapters.length, 3);
  assert.deepEqual(result.chapters.flatMap(c => c.blocks), blocks);
  assert.throws(() => partitionSource(source, { level: 3, maxChapters: 2 }), /above explicit limit/);
  assert.throws(() => partitionSource(source, { level: 1 }));
  assert.throws(() => partitionSource({ ...source, blocks: [...blocks, blocks[0]] }), /coverage mismatch/);
});
