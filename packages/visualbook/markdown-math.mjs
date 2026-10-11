/* Insert fence newlines for rendering only, with exact source-offset mapping. */
export function prepareMathMarkdown(raw) {
  const insertions = new Map();
  const lines = [...raw.matchAll(/[^\n]*(?:\n|$)/g)].filter((m) => m[0]);
  let codeFence = null, open = null, adapted = 0, quotedLinesJoined = 0;
  for (const match of lines) {
    const line = match[0], offset = match.index;
    const code = /^ {0,3}(?:> ?)*(`{3,}|~{3,})/.exec(line);
    if (code && open === null) {
      if (!codeFence) codeFence = code[1];
      else if (code[1][0] === codeFence[0] && code[1].length >= codeFence.length) codeFence = null;
      continue;
    }
    if (codeFence) continue;
    if (open === null) {
      const start = /^ {0,3}(?:> ?)*\$\$/.exec(line);
      if (!start) continue;
      const local = line.indexOf("$$");
      // Inside a quote/list, a one-line display can be parsed as inline math in
      // the surrounding paragraph. Preserve the container and give it real fences.
      const close = line.indexOf("$$", local + 2);
      if (close !== -1) {
        const prefix = line.slice(0, local);
        if (prefix && !line.slice(close + 2).trim()) {
          insertions.set(offset + local + 2, "\n" + prefix);
          insertions.set(offset + close, "\n" + prefix);
          adapted++;
        }
        continue;
      }
      open = { offset: offset + local, prefix: line.slice(0, local) };
      if (line.slice(local + 2).trim()) insertions.set(open.offset + 2, "\n" + open.prefix);
    } else {
      if (open.prefix.includes(">") && !/^ {0,3}>/.test(line)) {
        insertions.set(offset, open.prefix); quotedLinesJoined++;
      }
      const end = /\$\$\s*$/.exec(line);
      if (!end) continue;
      const closePrefix = open.prefix.includes(">") ? open.prefix : /^ */.exec(line)[0];
      const content = line.replace(/^ {0,3}(?:> ?)*/, "").slice(0, line.replace(/^ {0,3}(?:> ?)*/, "").lastIndexOf("$$"));
      if (content.trim()) insertions.set(offset + end.index, "\n" + closePrefix);
      if (insertions.has(open.offset + 2) || insertions.has(offset + end.index)) adapted++;
      open = null;
    }
  }
  if (open !== null) throw Error("Unclosed display math at source offset " + open.offset);
  let text = "";
  const offsets = [];
  for (let i = 0; i < raw.length; i++) {
    if (insertions.has(i)) {
      const extra = insertions.get(i); text += extra;
      for (let j=0;j<extra.length;j++) offsets.push(i);
    }
    text += raw[i]; offsets.push(i);
  }
  offsets.push(raw.length);
  return { text, sourceOffset: (offset) => offsets[offset], adapted, quotedLinesJoined };
}
