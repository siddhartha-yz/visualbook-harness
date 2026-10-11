import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { normalizeEmphasis } from "../packages/visualbook/emphasis.mjs";
import { importMarkdown } from "../packages/visualbook/import.mjs";

test("paired CJK strong punctuation renders without changing literal code or escaped delimiters", () => {
  assert.equal(normalizeEmphasis("一层**预分词（Chunking）**机制"), "一层**预分词（Chunking）** 机制");
  assert.equal(normalizeEmphasis("使用**（局部）词**表示"), "使用 **（局部）词**表示");
  assert.equal(normalizeEmphasis("`**词（例）**机制`"), "`**词（例）**机制`");
  assert.equal(normalizeEmphasis(String.raw`\**词（例）**机制`), String.raw`\**词（例）**机制`);
  assert.equal(normalizeEmphasis("**不完整\n段落**机制"), "**不完整\n段落**机制");
});
test("CJK punctuation adaptation preserves raw anchors, hashes, formulas and code", () => {
  const raw = "# 原文\n\n一层**预分词（Chunking）**机制与 **$x$**。\n\n```text\n**词（例）**机制\n```\n";
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vh-emphasis-"));
  try {
    const file = path.join(directory, "input.md"); fs.writeFileSync(file, raw);
    const book = importMarkdown(file);
    assert.equal(book.sourceSha256, crypto.createHash("sha256").update(raw).digest("hex"));
    assert.equal(book.blocks[1].raw, "一层**预分词（Chunking）**机制与 **$x$**。");
    assert.equal(book.blocks[1].line, 3);
    assert.match(book.blocks[1].html, /<strong>预分词（Chunking）<\/strong>/);
    assert.equal(book.adaptation.mathExpected, 1);
    assert.equal(book.adaptation.mathRendered, 1);
    assert.match(book.blocks[2].html, /\*\*词（例）\*\*机制/);
  } finally { fs.rmSync(directory, { recursive: true }); }
});
