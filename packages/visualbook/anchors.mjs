/* High-confidence source adjacency checks; original blocks remain immutable. */
export function sourceContext(book, anchor) {
  const blocks = book?.blocks;
  if (!Array.isArray(blocks)) throw Error("Source blocks required");
  const index = blocks.findIndex((b) => b.id === anchor);
  if (index < 0) throw Error("Unknown source anchor " + anchor);
  const block = blocks[index],
    next = blocks[index + 1],
    display = (b) => b && (b.type === "math" || /^\s*\$\$/.test(b.raw ?? ""));
  const continuation =
    block.type === "paragraph" &&
    /[:：]\s*$/.test(block.raw ?? "") &&
    next &&
    (display(next) || ["code", "list", "table"].includes(next.type));
  return {
    anchor,
    index,
    block: { id: block.id, type: block.type, raw: block.raw },
    previous: blocks[index - 1]
      ? {
          id: blocks[index - 1].id,
          type: blocks[index - 1].type,
          raw: blocks[index - 1].raw,
        }
      : null,
    next: next ? { id: next.id, type: next.type, raw: next.raw } : null,
    safeToInsertAfter: !continuation,
    reason: continuation
      ? "The paragraph introduces the immediately following formula, code, list or table. Preserve this pair."
      : null,
    recommendedAnchor: continuation ? next.id : anchor,
    scope:
      "Syntactic adjacency only; does not certify pedagogy, relevance or all good placements.",
  };
}
export function validateAnnotations(book, annotations = []) {
  if (!Array.isArray(annotations) || annotations.length > 12)
    throw Error("At most twelve source annotations per chapter");
  const seen = new Set(book.blocks.map((b) => b.id));
  for (const note of annotations) {
    if (
      !note ||
      Object.keys(note).some(
        (k) => !["id", "afterAnchor", "kind", "text", "formula", "placement", "marginSide"].includes(k),
      ) ||
      typeof note.id !== "string" ||
      !/^note-[a-z][a-z0-9-]*$/.test(note.id) ||
      seen.has(note.id)
    )
      throw Error("Unique valid note id and known annotation fields required");
    seen.add(note.id);
    if (note.placement !== undefined && !["body", "margin"].includes(note.placement))
      throw Error("Annotation placement must be body or margin");
    if (note.marginSide !== undefined && (note.placement !== "margin" || !["left", "right"].includes(note.marginSide)))
      throw Error("Annotation margin side requires margin placement and left/right");
    if (!["condition", "clarification", "correction"].includes(note.kind))
      throw Error("Annotation kind is condition, clarification or correction");
    if (
      typeof note.text !== "string" ||
      !note.text.trim() ||
      note.text.length > 360
    )
      throw Error("Use concise plain text for a source annotation");
    if (
      note.formula !== undefined &&
      (typeof note.formula !== "string" ||
        !note.formula.trim() ||
        note.formula.length > 500)
    )
      throw Error("Annotation formula must be short TeX");
    const context = sourceContext(book, note.afterAnchor);
    if (!context.safeToInsertAfter)
      throw Error(
        "Keep source introduction with its continuation; place annotation after " +
          context.recommendedAnchor,
      );
  }
  return annotations;
}

if (process.argv[1] === import.meta.filename) {
  const { default: fs } = await import("node:fs");
  const book = JSON.parse(fs.readFileSync(process.argv[2]));
  const anchors = JSON.parse(process.argv[3]);
  console.log(
    JSON.stringify(
      anchors.map((anchor) => {
        const result = sourceContext(book, anchor);
        for (const key of ["block", "previous", "next"])
          if (result[key])
            result[key] = {
              ...result[key],
              raw: result[key].raw.slice(0, 800),
              truncated: result[key].raw.length > 800,
            };
        return result;
      }),
    ),
  );
}
