import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const available = fs.existsSync(
  new URL(
    "../work/visualbook/runtime/node_modules/unified/index.js",
    import.meta.url,
  ),
);
test(
  "ordinary Markdown keeps code, standalone formulas and local figures",
  {
    skip: available
      ? false
      : "visualbook dependencies are checked in the dedicated CI job",
  },
  async () => {
    const { importMarkdown } = await import(
      "../packages/visualbook/import.mjs"
    );
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vh-import-"));
    try {
      fs.writeFileSync(
        path.join(dir, "figure.svg"),
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle cx="5" cy="5" r="3"/></svg>',
      );
      const markdown =
        "# 形状\n\n元素顺序 $x_1$ 保持不变。\n\n$$\\mathbf{y}=A\\mathbf{x}$$\n\n```python\nx.reshape(2, 3)\n```\n\n![局部图](figure.svg)\n";
      fs.writeFileSync(path.join(dir, "book.md"), markdown);
      const book = importMarkdown(path.join(dir, "book.md"), { id: "tensor" });
      assert.equal(book.adaptation.mathExpected, 2);
      assert.equal(book.adaptation.mathRendered, 2);
      assert.equal(book.adaptation.images, 1);
      assert.match(
        book.blocks.find((b) => b.type === "code").html,
        /x.reshape/,
      );
      assert.match(
        book.blocks.find((b) => b.type === "math" || b.raw.startsWith("$$"))
          .html,
        /katex/,
      );
      assert.match(book.blocks.at(-1).html, /data:image\/svg\+xml/);
      fs.writeFileSync(
        path.join(dir, "remote.md"),
        "![x](https://example.com/x.png)",
      );
      assert.throws(
        () => importMarkdown(path.join(dir, "remote.md")),
        /Remote images/,
      );
      fs.writeFileSync(path.join(dir, "raw.md"), "<script>bad()</script>");
      assert.throws(() => importMarkdown(path.join(dir, "raw.md")), /Raw HTML/);
      fs.writeFileSync(
        path.join(dir, "invalid.md"),
        "$\\notARealFormulaCommand$",
      );
      assert.throws(
        () => importMarkdown(path.join(dir, "invalid.md")),
        /Formula coverage failed/,
      );
      fs.writeFileSync(path.join(dir, "references.md"), "# Reference context\n\n![本地图][figure]\n\n[原书][book]\n\n[figure]: figure.svg\n[book]: https://example.org/book\n");
      const referenced = importMarkdown(path.join(dir, "references.md"));
      assert.equal(referenced.adaptation.images, 1);
      assert.match(referenced.blocks[1].html, /data:image\/svg\+xml/);
      assert.match(referenced.blocks[2].html, /href="https:\/\/example.org\/book"/);
      assert.equal(referenced.blocks.filter(b => b.type === "definition").length, 2);
      fs.writeFileSync(path.join(dir, "footnotes.md"), "A note[^a].\n\n[^a]: source content\n");
      assert.throws(() => importMarkdown(path.join(dir, "footnotes.md")), /Footnotes require/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
