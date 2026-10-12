// Preserve source/anchor hashes; repair only the tree used for HTML rendering.
import {bareSpacingCommands} from './notation.mjs';
export function renderingMath(node, report = {}) {
  const copy = structuredClone(node);
  if (
    copy.type === "paragraph" &&
    copy.children?.length === 1 &&
    copy.children[0].type === "inlineMath" &&
    copy.position
  ) {
    // The caller marks standalone $$ paragraphs; ordinary inline math stays inline.
    if (copy.displayMath) {
      copy.type = "math";
      copy.value = copy.children[0].value;
      delete copy.children;
      report.oneLineDisplayMath = (report.oneLineDisplayMath ?? 0) + 1;
    }
  }
  function visit(n) {
    if (n.type === "math" || n.type === "inlineMath") {
      let value = n.value;
      const notation = bareSpacingCommands(value);
      if(notation.length) throw Error(`Possible missing TeX backslash at math line ${n.position?.start?.line??'?'}: ${notation.map(x=>x.command).join(', ')}. Review source explicitly; no automatic formula rewrite.`);
      if (
        n.type === "math" &&
        value.includes("\\\\") &&
        !value.includes("\\begin{")
      ) {
        value = "\\begin{aligned}\n" + value + "\n\\end{aligned}";
        report.multilineMathWrapped = (report.multilineMathWrapped ?? 0) + 1;
      }
      // A trailing index range is one reading unit. KaTeX otherwise allows a
      // mobile line break after its '='. Braces group only this narrow display
      // pattern in the rendering tree; raw source and anchor hashes stay intact.
      if (n.type === "math" && !value.includes("\\begin{")) {
        const range = /(\\(?:qquad|quad)\s+)([a-zA-Z](?:_\{[a-zA-Z0-9]+\}|_[a-zA-Z0-9])?\s*=\s*\d+\s*,\s*\\(?:ldots|dots|cdots)\s*,\s*[a-zA-Z](?:_\{[a-zA-Z0-9]+\}|_[a-zA-Z0-9])?\s*,?)\s*$/;
        if (range.test(value)) {
          value = value.replace(range, (_, spacing, condition) => "\\allowbreak" + spacing + "{" + condition + "}");
          report.indexRangeGrouped = (report.indexRangeGrouped ?? 0) + 1;
        }
      }
      // mdast-util-to-hast uses data.hChildren, not value, for math nodes.
      // Construct both together, including nodes created by display adaptation.
      const code = {
        type: "element",
        tagName: "code",
        properties: {
          className: [
            "language-math",
            n.type === "math" ? "math-display" : "math-inline",
          ],
        },
        children: [{ type: "text", value }],
      };
      n.data =
        n.type === "math"
          ? { hName: "pre", hChildren: [code] }
          : {
              hName: "code",
              hProperties: code.properties,
              hChildren: code.children,
            };
    }
    for (const c of n.children ?? []) visit(c);
  }
  visit(copy);
  return copy;
}
export function countMath(node) {
  return (
    (["math", "inlineMath"].includes(node.type) ? 1 : 0) +
    (node.children ?? []).reduce((n, c) => n + countMath(c), 0)
  );
}
export function inspectMath(hast, expected) {
  let rendered = 0,
    errors = 0,
    pending = 0;
  function visit(n) {
    const classes = n.properties?.className ?? [];
    if (classes.includes("katex")) rendered++;
    if (classes.includes("katex-error")) errors++;
    if (classes.includes("language-math")) pending++;
    for (const c of n.children ?? []) visit(c);
  }
  visit(hast);
  if (errors || pending || rendered !== expected)
    throw Error(
      `Formula coverage failed: expected=${expected}, rendered=${rendered}, errors=${errors}, pending=${pending}`,
    );
  return { expected, rendered, errors, pending };
}
