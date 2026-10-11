/* Two-column weighted flows. No general graph layout or inferred routing. */
(function (global) {
  const V = global.VisualBook, P = V.palette;
  function ribbonFlow(board, { matrix, sources, targets, colors = ["blue", "orange", "green", "violet", "muted", "ink"] } = {}) {
    if (!Array.isArray(matrix) || !matrix.length || matrix.length > 6 || !Array.isArray(matrix[0]) || !matrix[0].length || matrix[0].length > 6 ||
        matrix.some(r => !Array.isArray(r) || r.length !== matrix[0].length || r.some(v => !Number.isFinite(v) || v < 0)))
      throw Error("Flow matrix must be finite nonnegative 1..6 by 1..6");
    const n = matrix.length, m = matrix[0].length;
    if (!Array.isArray(sources) || !Array.isArray(targets) || sources.length !== n || targets.length !== m ||
        [...sources, ...targets].some(s => typeof s !== "string" || !s.trim() || s.length > 12) ||
        !Array.isArray(colors) || colors.length < m || colors.slice(0, m).some(c => !Object.hasOwn(P, c)))
      throw Error("Provide one short source/target name and known color per target");
    const rowTotals = matrix.map(r => r.reduce((a, b) => a + b, 0)), colTotals = Array.from({ length: m }, (_, j) => matrix.reduce((s, r) => s + r[j], 0)), total = rowTotals.reduce((a, b) => a + b, 0);
    if (!Number.isFinite(total) || total <= 0 || matrix.flat().filter(v => v > 0).length > 18)
      throw Error("Flow needs positive finite total and at most 18 nonzero ribbons");
    const leftLabel = Math.max(...sources.map(s => V.measure(s, 13))) + 14;
    const rightLabel = Math.max(...targets.map(s => V.measure(s, 13))) + 14;
    const x0 = leftLabel + 12, x1 = board.width - rightLabel - 12, top = 18, bottom = board.height - 32, gap = 14, pad = 10;
    const scale = Math.min((bottom - top - gap * (n - 1) - 2 * pad * n) / total,
      (bottom - top - gap * (m - 1) - 2 * pad * m) / total);
    if (x1 - x0 < 100 || !Number.isFinite(scale) || scale <= 0)
      throw Error("Flow needs more space or fewer/smaller labels");
    if (matrix.flat().some(v => v > 0 && v * scale < .5))
      throw Error("Flow contains subpixel positive ribbons; use a table/bar comparison or a less dense example");
    function positions(totals) {
      const used = total * scale + 2 * pad * totals.length + gap * (totals.length - 1);
      let y = top + (bottom - top - used) / 2;
      return totals.map(value => { const p = { y, height: value * scale + 2 * pad, next: y + pad }; y += p.height + gap; return p; });
    }
    const a = positions(rowTotals), b = positions(colTotals), edgeFacts = [];
    // Fixed source/target order keeps graph identity and comparisons stable.
    matrix.forEach((row, i) => row.forEach((value, j) => {
      if (!value) return;
      const y0 = a[i].next, y1 = b[j].next, thickness = value * scale, c0 = x0 + (x1 - x0) * .45, c1 = x1 - (x1 - x0) * .45;
      const d = `M${x0},${y0}C${c0},${y0} ${c1},${y1} ${x1},${y1}L${x1},${y1 + thickness}C${c1},${y1 + thickness} ${c0},${y0 + thickness} ${x0},${y0 + thickness}Z`;
      board.svgPath("flow-" + i + "-" + j, d, { fill: P[colors[j]], opacity: .22, color: "none", width: 0 });
      a[i].next += thickness; b[j].next += thickness;
      edgeFacts.push({ source: i, target: j, value, thickness });
    }));
    a.forEach((p, i) => { board.rect("source-" + i, x0 - 5, p.y, 5, p.height, P.muted); board.text("source-label-" + i, sources[i], x0 - 12, p.y + p.height / 2 + 4, { size: 13, anchor: "end", halo: false }); });
    b.forEach((p, i) => { board.rect("target-" + i, x1, p.y, 5, p.height, P[colors[i]]); board.text("target-label-" + i, targets[i], x1 + 12, p.y + p.height / 2 + 4, { size: 13, halo: false }); });
    board.text("scale", "粗细 ∝ 数量", 12, board.height - 9, { size: 12, color: P.muted, halo: false });
    return { matrix, sources, targets, rowTotals, colTotals, total, scale, edges: edgeFacts,
      convention: "All ribbon thicknesses use one numeric scale; node bars include padding and do not encode pure totals. Two supplied columns only; crossings do not imply dependencies or physical network paths." };
  }
  Object.assign(V.components, { "ribbon-flow": ribbonFlow });
})(window);
