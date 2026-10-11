/* Shared positions and scales for text partitions and categorical comparisons. */
(function (global) {
  const V = global.VisualBook, P = V.palette;
  const short = (s, n, name) => {
    if (typeof s !== "string" || !s.trim() || s.length > n)
      throw Error(name + " must be a short nonempty string");
    return s;
  };
  const color = (name = "blue") => {
    if (!Object.hasOwn(P, name)) throw Error("Use a known palette color");
    return P[name];
  };
  function sequenceStrips(board, { atoms, weights, rows, barriers = [], positionUnit = "位置" } = {}) {
    if (!Array.isArray(atoms) || !atoms.length || atoms.length > 16)
      throw Error("Sequence needs 1..16 explicit atoms");
    atoms.forEach(s => short(s, 12, "Atom"));
    weights ??= atoms.map(() => 1);
    if (!Array.isArray(weights) || weights.length !== atoms.length ||
        !weights.every(x => Number.isInteger(x) && x >= 1 && x <= 64))
      throw Error("Provide one positive integer position width per atom, at most 64");
    if (!Array.isArray(rows) || !rows.length || rows.length > 4)
      throw Error("Sequence needs 1..4 explicitly supplied partition rows");
    short(positionUnit, 12, "Position unit");
    if (!Array.isArray(barriers) || new Set(barriers).size !== barriers.length ||
        !barriers.every(x => Number.isInteger(x) && x > 0 && x < atoms.length))
      throw Error("Barriers must be distinct internal atom boundaries");
    const offsets = [0]; weights.forEach(w => offsets.push(offsets.at(-1) + w));
    const total = offsets.at(-1), labelWidth = Math.max(
      Math.max(...rows.map(r => V.measure(short(r.label, 16, "Row label"), 13))) + 14,
      V.measure(positionUnit, 12) + 16);
    const left = 12 + labelWidth, right = board.width - 16, width = right - left;
    if (width < 120 || board.height < rows.length * 62 + 50)
      throw Error("Allocate more space for aligned sequence rows");
    const x = i => left + width * offsets[i] / total;
    const checked = rows.map((row, r) => {
      if (!Array.isArray(row.groups) || !row.groups.length || row.groups.length > atoms.length)
        throw Error("A row must contain a complete partition");
      let next = 0;
      const groups = row.groups.map((g, i) => {
        if (!Number.isInteger(g.start) || !Number.isInteger(g.end) || g.start !== next || g.end <= g.start || g.end > atoms.length)
          throw Error("Partitions must cover each atom once in its original order");
        next = g.end;
        if (barriers.some(b => g.start < b && b < g.end))
          throw Error("A group cannot cross a declared partition barrier");
        const label = short(g.label ?? atoms.slice(g.start, g.end).join(""), 32, "Group label"), fill = color(g.color ?? "faint"), w = x(g.end) - x(g.start) - 4;
        if (w < 20 || V.measure(label, 14) > w - 10)
          throw Error("Sequence label does not fit; use fewer atoms, shorter labels or more space");
        return { ...g, label, fill, width: w, id: r + "-" + i, position: [offsets[g.start], offsets[g.end]] };
      });
      if (next !== atoms.length) throw Error("Partition omits trailing atoms");
      return { label: row.label, groups };
    });
    board.text("unit", positionUnit, 12, 18, { size: 12, color: P.muted, halo: false });
    let previousTickRight = -Infinity;
    for (let i = 0; i <= atoms.length; i++) {
      board.line("guide-" + i, x(i), 25, x(i), board.height - 12, P.faint, 1);
      const half = V.measure(String(offsets[i]), 12) / 2;
      const finalHalf = V.measure(String(total), 12) / 2;
      if (i === 0 || i === atoms.length || (x(i) - half > previousTickRight + 8 && x(i) + half < right - finalHalf - 8)) {
        board.text("position-" + i, String(offsets[i]), x(i), 18, { size: 12, anchor: "middle", color: P.muted, halo: false });
        previousTickRight = x(i) + half;
      }
    }
    const step = (board.height - 42) / rows.length;
    checked.forEach((row, r) => {
      const y = 38 + r * step;
      board.text("row-" + r, row.label, 12, y + 26, { size: 13, halo: false });
      row.groups.forEach(g => {
        board.rect("group-" + g.id, x(g.start) + 2, y, g.width, 40, g.fill, { opacity: g.color && g.color !== "faint" ? .16 : .6 });
        board.text("label-" + g.id, g.label, (x(g.start) + x(g.end)) / 2, y + 26, { size: 14, anchor: "middle", halo: false });
      });
    });
    barriers.forEach((i, j) => board.line("barrier-" + j, x(i), 25, x(i), board.height - 12, P.orange, 2));
    return { atoms, weights, offsets, total, barriers, rows: checked.map(r => ({ label: r.label, groups: r.groups.map(({ fill, width, id, ...g }) => g) })),
      convention: "Explicit supplied partitions on shared logical positions; widths are supplied units, not inferred UTF-8 bytes. No tokenizer training or merge execution." };
  }
  function categoryBars(board, { items, domain, unit = "", progress = 1 } = {}) {
    if (!Array.isArray(items) || !items.length || items.length > 8 ||
        items.some(i => !Number.isFinite(i.value))) throw Error("Bars need 1..8 finite values");
    items.forEach(i => short(i.label, 24, "Bar label"));
    if (typeof unit !== "string" || unit.length > 12) throw Error("Use a short shared unit");
    if (!Array.isArray(domain) || domain.length !== 2 || !domain.every(Number.isFinite) ||
        domain[0] > 0 || domain[1] < 0 || domain[0] >= domain[1] || !Number.isFinite(domain[1] - domain[0]) ||
        items.some(i => i.value < domain[0] || i.value > domain[1]))
      throw Error("Explicit finite scale must include zero and every value; no silent clipping");
    if (!Number.isFinite(progress) || progress < 0 || progress > 1) throw Error("Construction progress must be 0..1");
    const labelWidth = Math.max(...items.map(i => V.measure(i.label, 13))) + 16;
    const labels = items.map(i => V.formatNumber(i.value) + (unit ? " " + unit : ""));
    const numberWidth = Math.max(...labels.map(s => V.measure(s, 13))) + 18;
    const left = 12 + labelWidth, right = board.width - numberWidth - 12;
    const rowHeight = (board.height - 42) / items.length;
    if (right - left < 80 || rowHeight < 35) throw Error("Allocate more bar space or shorten labels");
    const x = value => left + (right - left) * (value - domain[0]) / (domain[1] - domain[0]), zero = x(0);
    board.line("zero", zero, 12, zero, board.height - 32, P.muted, 1);
    items.forEach((item, i) => {
      const y = 12 + i * rowHeight, end = x(item.value * progress);
      board.text("name-" + i, item.label, 12, y + rowHeight / 2 + 5, { size: 13, halo: false });
      board.line("track-" + i, left, y + rowHeight / 2, right, y + rowHeight / 2, P.faint, 1);
      board.rect("bar-" + i, Math.min(zero, end), y + rowHeight / 2 - 6, Math.abs(end - zero), 12, color(item.color));
      board.text("value-" + i, labels[i], board.width - 12, y + rowHeight / 2 + 5, { size: 13, anchor: "end", halo: false });
    });
    [domain[0], 0, domain[1]].filter((v, i, a) => a.indexOf(v) === i).forEach((v, i) =>
      board.text("tick-" + i, V.formatNumber(v), x(v), board.height - 8, { size: 12, anchor: v === domain[0] ? "start" : v === domain[1] ? "end" : "middle", color: P.muted, halo: false }));
    return { items, domain, unit, visibleValues: items.map(i => i.value * progress), constructionProgress: progress,
      convention: "One explicit shared scale including zero. Animation interpolates displayed lengths, not measurements or training." };
  }
  Object.assign(V.components, { "sequence-strips": sequenceStrips, "category-bars": categoryBars });
})(window);
