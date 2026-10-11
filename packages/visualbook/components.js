/* Domain building blocks. Inputs drive actual calculations; drawings share local coordinates. */
(function (global) {
  const V = global.VisualBook,
    B = V.Board,
    P = V.palette;
  const finite = (v, name = "Value") => {
    if (!Number.isFinite(v)) throw Error(name + " must be finite");
    return v;
  };
  const vector = (v) => {
    if (!Array.isArray(v) || v.length !== 2 || !v.every(Number.isFinite))
      throw Error("Finite 2D vector required");
    return v;
  };
  const fmt = (v) => V.formatNumber(v);
  const color = (name, fallback = P.blue) => P[name] ?? name ?? fallback;
  function frame(
    board,
    id,
    {
      xDomain = [-3, 3],
      yDomain = [-3, 3],
      equalUnits = false,
      title = null,
      grid = true,
      footerHeight = 0,
      headerHeight = 0,
    } = {},
  ) {
    if (board.width < 160 || board.height < 160)
      throw Error("Plot region must be at least 160×160");
    if (
      !Number.isFinite(footerHeight) ||
      footerHeight < 0 ||
      footerHeight > 80 ||
      board.height - footerHeight < 160
    )
      throw Error("Plot footer must reserve 0..80px and leave 160px of height");
    if (
      !Number.isFinite(headerHeight) ||
      headerHeight < 0 ||
      headerHeight > 96 ||
      board.height - footerHeight - headerHeight < 160
    )
      throw Error(
        "Plot header must reserve 0..96px and leave 160px drawing height",
      );
    if (title)
      board.label(id + "-title", title, 16, 20, {
        maxWidth: board.width - 32,
        size: 14,
        avoid: false,
      });
    const f = board.axes(id, {
      xDomain,
      yDomain,
      equalUnits,
      grid,
      xLabel: "",
      yLabel: "",
      box: [
        42,
        (title ? 40 : 25) + headerHeight,
        board.width - 18,
        board.height - 36 - footerHeight,
      ],
    });
    f.clip = board.clip(id, f);
    if (xDomain[0] <= 0 && xDomain[1] >= 0)
      board.line(
        id + "-zero-y",
        f.x(0),
        f.top,
        f.x(0),
        f.bottom,
        P.muted,
        1,
        0.45,
      );
    if (yDomain[0] <= 0 && yDomain[1] >= 0)
      board.line(
        id + "-zero-x",
        f.left,
        f.y(0),
        f.right,
        f.y(0),
        P.muted,
        1,
        0.45,
      );
    return f;
  }
  function projection(vectorValue, onto) {
    vector(vectorValue);
    vector(onto);
    const denominator = V.dot(onto, onto);
    if (denominator < 1e-12) throw Error("Projection axis must be nonzero");
    const coefficient = V.dot(vectorValue, onto) / denominator,
      projected = onto.map((v) => v * coefficient),
      residual = vectorValue.map((v, i) => v - projected[i]);
    return {
      vector: [...vectorValue],
      onto: [...onto],
      coefficient,
      projection: projected,
      residual,
      dot: V.dot(vectorValue, onto),
      orthogonality: V.dot(residual, onto),
    };
  }
  function drawProjection(
    board,
    {
      vector: value = [2, 1],
      onto = [1, 0],
      progress = 1,
      stateKey = null,
      title = "投影",
      xDomain = [-3, 3],
      yDomain = [-3, 3],
      draggable = false,
    } = {},
    context = {},
  ) {
    const facts = projection(value, onto),
      f = frame(board, "axes", { title, xDomain, yDomain, equalUnits: true }),
      p = V.clamp(progress, 0, 1),
      q = facts.projection.map((v) => v * p);
    const length = Math.hypot(...onto),
      unit = onto.map((v) => v / length),
      extent = Math.max(...xDomain.map(Math.abs), ...yDomain.map(Math.abs));
    board.curve(
      "axis-line",
      f,
      [unit.map((v) => -extent * v), unit.map((v) => extent * v)],
      { color: P.faint, width: 2 },
    );
    board.vector("vector", f, [0, 0], value, {
      color: P.blue,
      label: draggable ? null : "v",
    });
    board.vector("projected", f, [0, 0], q, {
      color: P.orange,
      label: p === 1 ? "投影" : "展开中",
    });
    board.mark("residual", "path", {
      d: `M${f.x(q[0])},${f.y(q[1])}L${f.x(value[0])},${f.y(value[1])}`,
      fill: "none",
      stroke: P.muted,
      "stroke-width": 1.6,
      "stroke-dasharray": "4 5",
    });
    if (draggable) {
      if (!stateKey) throw Error("Draggable projection needs stateKey");
      board.handle("vector", f, value, {
        color: P.blue,
        label: "v",
        onChange: (point) => context.controls.setState(stateKey, point),
      });
    }
    return { ...facts, visibleProjection: q, constructionProgress: p };
  }
  function drawTransform(
    board,
    {
      matrix = [
        [1, 0.5],
        [0, 1],
      ],
      progress = 1,
      vector: value = [1, 1],
      xDomain = [-3, 3],
      yDomain = [-3, 3],
      title = "线性变换",
      gridExtent = 2,
    } = {},
  ) {
    if (
      !Array.isArray(matrix) ||
      matrix.length !== 2 ||
      matrix.some(
        (r) => !Array.isArray(r) || r.length !== 2 || !r.every(Number.isFinite),
      )
    )
      throw Error("Transform needs a finite 2×2 matrix");
    vector(value);
    finite(gridExtent);
    if (gridExtent < 1 || gridExtent > 6 || !Number.isInteger(gridExtent))
      throw Error("Grid extent must be integer 1..6");
    const p = V.clamp(progress, 0, 1),
      current = matrix.map((r, i) =>
        r.map((v, j) => V.mix(i === j ? 1 : 0, v, p)),
      ),
      apply = (v) => current.map((row) => V.dot(row, v)),
      f = frame(board, "axes", {
        title,
        xDomain,
        yDomain,
        equalUnits: true,
        grid: false,
      });
    for (let k = -gridExtent; k <= gridExtent; k++) {
      board.curve(
        "horizontal-" + k,
        f,
        [apply([-gridExtent, k]), apply([gridExtent, k])],
        { color: k === 0 ? P.muted : P.faint, width: k === 0 ? 1.5 : 1 },
      );
      board.curve(
        "vertical-" + k,
        f,
        [apply([k, -gridExtent]), apply([k, gridExtent])],
        { color: k === 0 ? P.muted : P.faint, width: k === 0 ? 1.5 : 1 },
      );
    }
    board.curve(
      "unit-square",
      f,
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ].map(apply),
      { color: P.blue, width: 2, opacity: 0.75 },
    );
    board.vector("basis-x", f, [0, 0], apply([1, 0]), {
      color: P.orange,
      label: "e₁",
    });
    board.vector("basis-y", f, [0, 0], apply([0, 1]), {
      color: P.green,
      label: "e₂",
    });
    board.vector("value", f, [0, 0], apply(value), {
      color: P.blue,
      label: "Av",
    });
    return {
      matrix,
      currentMatrix: current,
      vector: value,
      transformed: apply(value),
      target: matrix.map((row) => V.dot(row, value)),
      determinant:
        current[0][0] * current[1][1] - current[0][1] * current[1][0],
      convention:
        "Interpolation I→A is a visual construction, not a matrix exponential",
    };
  }
  function drawPlot(
    board,
    {
      xDomain = [-3, 3],
      yDomain = [-3, 3],
      title = null,
      equalUnits = false,
      layers = [],
      xLabel = "",
      yLabel = "",
    } = {},
    context = {},
  ) {
    for (const label of [xLabel, yLabel])
      if (typeof label !== "string" || label.length > 32 || V.measure(label, 13) > board.width - 60)
        throw Error("Plot axis labels must be short strings that fit the actual region");
    const f = frame(board, "axes", { title, xDomain, yDomain, equalUnits,
      headerHeight: yLabel ? 20 : 0, footerHeight: xLabel ? 22 : 0 }),
      facts = { xDomain, yDomain, xLabel, yLabel, layers: [] };
    if (xLabel) board.text("x-label", xLabel, f.right, board.height - 7, { size:13, anchor:"end", color:P.muted });
    if (yLabel) board.text("y-label", yLabel, f.left, f.top - 12, { size:13, color:P.muted });
    if (!Array.isArray(layers) || layers.length > 16)
      throw Error("Plot needs at most 16 layers");
    const ids = layers.map((l, i) => l.id ?? "layer-" + i);
    if (new Set(ids).size !== ids.length)
      throw Error("Duplicate plot layer ids");
    layers.forEach((layer, i) => {
      const id = ids[i],
        c = color(layer.color);
      if (layer.type === "curve") {
        if (!Array.isArray(layer.points) || layer.points.length > 1000)
          throw Error("Curve needs at most 1000 points");
        layer.points.forEach(vector);
        board.curve(id, f, layer.points, {
          color: c,
          width: layer.width ?? 2.5,
          opacity: layer.opacity ?? 1,
        });
        facts.layers.push({ id, type: layer.type, points: layer.points });
      } else if (layer.type === "vector") {
        const from = layer.from ?? [0, 0];
        vector(from);
        vector(layer.to);
        board.vector(id, f, from, layer.to, { color: c, label: layer.label });
        facts.layers.push({ id, type: layer.type, from, to: layer.to });
      } else if (layer.type === "points") {
        if (!Array.isArray(layer.points) || layer.points.length > 200)
          throw Error("Scatter needs at most 200 points");
        layer.points.forEach((p, j) => {
          vector(p);
          board.circle(
            id + "-" + j,
            f.x(p[0]),
            f.y(p[1]),
            layer.radius ?? 4,
            c,
            { "clip-path": f.clip },
          );
        });
        facts.layers.push({ id, type: layer.type, points: layer.points });
      } else if (layer.type === "area") {
        if (!Array.isArray(layer.points) || layer.points.length > 1000)
          throw Error("Area needs at most 1000 points");
        layer.points.forEach(vector);
        const area = board.path(
          id,
          layer.points.map(([x, y]) => [f.x(x), f.y(y)]),
          { color: c, closed: true, width: 0, opacity: layer.opacity ?? 0.15 },
        );
        area.setAttribute("clip-path", f.clip);
        facts.layers.push({ id, type: layer.type, points: layer.points });
      } else if (layer.type === "handle") {
        vector(layer.point);
        if (!layer.stateKey) throw Error("Handle layer needs stateKey");
        board.handle(id, f, layer.point, {
          color: c,
          label: layer.label,
          axis: layer.axis ?? "both",
          step: layer.step ?? 0.1,
          onChange: (p) => context.controls.setState(layer.stateKey, p),
        });
        facts.layers.push({ id, type: layer.type, point: layer.point });
      } else throw Error("Unknown plot layer " + layer.type);
    });
    return facts;
  }
  function readout(board, { items = [], title = null } = {}) {
    if (!Array.isArray(items) || items.length > 8)
      throw Error("Readout supports at most 8 short values");
    const h = (board.height - 16) / (items.length + (title ? 1 : 0) || 1);
    if (h < 50)
      throw Error("Readout needs 16px padding plus at least 50px per value");
    if (title) board.text("title", title, 20, 30, { size: 14, color: P.muted });
    const width = board.width - 40;
    items.forEach((item, i) => {
      if (typeof item.label !== "string" || item.label.length > 80)
        throw Error("Readout needs a short label");
      const scalar = (v) =>
        v === null ||
        ["string", "boolean"].includes(typeof v) ||
        (typeof v === "number" && Number.isFinite(v));
      if (
        !(Array.isArray(item.value)
          ? item.value.every(scalar)
          : scalar(item.value))
      )
        throw Error(
          "Readout expects a scalar or 1D array; choose an explicit result field",
        );
      const y = (i + (title ? 1 : 0)) * h + 14;
      if (item.nullText !== undefined && (typeof item.nullText !== "string" || item.nullText.length > 32))
        throw Error("Readout nullText must be a short string");
      const value = Array.isArray(item.value)
        ? item.value.map((v) => (typeof v === "number" ? fmt(v) : v)).join(", ")
        : typeof item.value === "number"
          ? fmt(item.value)
          : item.value === null
            ? item.nullText ?? "未定义"
            : typeof item.value === "boolean"
              ? item.value
                ? "是"
                : "否"
              : item.value;
      board.text("label-" + i, item.label ?? "", 20, y, {
        size: 13,
        color: P.muted,
      });
      board.label("value-" + i, value, 20, y + 29, {
        size: 22,
        color: color(item.color, P.ink),
        maxWidth: width,
        avoid: false,
      });
    });
    return { items };
  }
  B.prototype.projection = function (id, options = {}, context = {}) {
    return this.region(
      id,
      { x: 0, y: 0, width: this.width, height: this.height },
      (b) =>
        drawProjection(b, options, { controls: this.controls, ...context }),
    );
  };
  B.prototype.transformGrid = function (id, options = {}) {
    return this.region(
      id,
      { x: 0, y: 0, width: this.width, height: this.height },
      (b) => drawTransform(b, options),
    );
  };
  V.project = projection;
  V.plotFrame = frame;
  Object.assign(V.components, {
    projection: drawProjection,
    "linear-transform": drawTransform,
    plot: drawPlot,
    readout,
  });
})(window);
