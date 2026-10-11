/* Compact numeric matrices for side-by-side stages; no smaller-than-12px text. */
(function (global) {
  const V = global.VisualBook, P = V.palette;
  function matrixTable(board, { data, rowLabels, columnLabels, rowColors, columnColors, title = "" } = {}) {
    if (!Array.isArray(data) || !data.length || data.length > 8 || !Array.isArray(data[0]) || !data[0].length || data[0].length > 8 ||
        data.some(row => !Array.isArray(row) || row.length !== data[0].length || !row.every(Number.isFinite)))
      throw Error("Table needs a finite 1..8 by 1..8 matrix");
    const n = data.length, m = data[0].length;
    rowLabels ??= Array.from({ length: n }, (_, i) => "r" + i);
    columnLabels ??= Array.from({ length: m }, (_, i) => "c" + i);
    if (!Array.isArray(rowLabels) || rowLabels.length !== n || !Array.isArray(columnLabels) || columnLabels.length !== m ||
        [...rowLabels, ...columnLabels].some(s => typeof s !== "string" || !s.trim() || s.length > 16) ||
        typeof title !== "string" || title.length > 24)
      throw Error("Use one short label per row/column and a short optional table title");
    if (rowColors && columnColors) throw Error("Choose row or column color provenance once");
    const colors = rowColors ?? columnColors;
    if (colors && (!Array.isArray(colors) || colors.length !== (rowColors ? n : m) || colors.some(c => !Object.hasOwn(P, c))))
      throw Error("Use one known palette color per colored row/column");
    const left = 12 + Math.max(...rowLabels.map(s => V.measure(s, 12))) + 12, right = board.width - 12,
      top = title ? 46 : 27, bottom = board.height - 12, cw = (right - left) / m, rh = (bottom - top) / n;
    if (cw < 28 || rh < 24 || columnLabels.some(s => V.measure(s, 12) > cw - 8) || (title && V.measure(title, 13) > board.width - 24))
      throw Error("Compact table labels/cells need more space; keep text at least 12px");
    if (title) board.text("title", title, 12, 17, { size: 13, halo: false });
    columnLabels.forEach((label, j) => board.text("column-" + j, label, left + (j + .5) * cw, top - 9, { size: 12, anchor: "middle", color: columnColors ? P[columnColors[j]] : P.muted, halo: false }));
    data.forEach((row, i) => {
      board.text("row-" + i, rowLabels[i], left - 12, top + (i + .5) * rh + 4, { size: 12, anchor: "end", color: rowColors ? P[rowColors[i]] : P.muted, halo: false });
      row.forEach((value, j) => {
        const fill = colors ? P[colors[rowColors ? i : j]] : P.faint;
        board.rect("cell-" + i + "-" + j, left + j * cw + 1, top + i * rh + 1, cw - 2, rh - 2, fill, { opacity: colors ? .12 : .6, rx: 2 });
        const label = V.fitNumber(value, { maxWidth: cw - 10, size: 14 });
        board.text("value-" + i + "-" + j, label.text, left + (j + .5) * cw, top + (i + .5) * rh + label.size * .35, { size: label.size, anchor: "middle", halo: false });
      });
    });
    return { data, shape: [n, m], rowLabels, columnLabels, rowColors: rowColors ?? null, columnColors: columnColors ?? null,
      convention: "Explicit numeric values and row/column identities. Optional colors mark supplied provenance, not magnitudes; no tensor storage, execution or network inference." };
  }
  Object.assign(V.components, { "matrix-table": matrixTable });
})(window);
