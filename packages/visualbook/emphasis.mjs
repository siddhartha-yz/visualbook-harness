/* Render-only normalization of emphasis adjacent to CJK text and inline math/code. */
export function normalizeEmphasis(raw) {
  const adjust = (s) =>
    s
      // CommonMark's punctuation flank rule leaves CJK-adjacent strong spans
      // such as **词（说明）**机制 literal. Adapt only paired, single-line spans.
      // Code and escaped delimiters remain data; source bytes stay unchanged.
      .replace(/(?<![\\*])\*\*([^\s*\\](?:[^*\n]*?[^\s*\\])?)\*\*(?!\*)/gu, (span, content, at, text) => {
        const before = text[at - 1] ?? "", after = text[at + span.length] ?? "";
        const left = /[\p{L}\p{N}]/u.test(before) && /\p{P}/u.test(content[0]);
        const right = /[\p{L}\p{N}]/u.test(after) && /\p{P}/u.test(content.at(-1));
        return (left ? " " : "") + span + (right ? " " : "");
      })
      .replace(/([^\s\p{P}])\*\*(?=\$|`)/gu, "$1 **")
      .replace(/(?<=\$)\*\*(?=[\p{L}\p{N}])/gu, "** ");
  let result = "",
    cursor = 0;
  const pattern = /(`+)([\s\S]*?)\1/g;
  let match;
  while ((match = pattern.exec(raw))) {
    const prefix = adjust(raw.slice(cursor, match.index)).replace(
      /([^\s\p{P}])\*\*$/gu,
      "$1 **",
    );
    result += prefix + match[0];
    cursor = match.index + match[0].length;
  }
  result += adjust(raw.slice(cursor));
  // A bold opener immediately before a code span lives in the preceding text.
  return result;
}
