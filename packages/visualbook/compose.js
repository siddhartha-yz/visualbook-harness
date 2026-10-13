/* Local coordinates, shared inputs and responsive composition. No framework dependency. */
(function (global) {
  const V = global.VisualBook,
    B = V.Board,
    P = V.palette;
  const number = (v, name) => {
    if (!Number.isFinite(v)) throw Error(name + " must be finite");
    return v;
  };
  const point = (v) => {
    if (!Array.isArray(v) || v.length !== 2 || !v.every(Number.isFinite))
      throw Error("Finite 2D point required");
    return v;
  };
  function layout(
    width,
    height,
    count,
    {
      kind = "columns",
      gap = 24,
      padding = 0,
      weights = null,
      minColumnWidth = 260,
      columns = 2,
    } = {},
  ) {
    if (!Number.isInteger(count) || count < 1 || count > 16)
      throw Error("Layout needs 1..16 children");
    [width, height, gap, padding, minColumnWidth].forEach((v) =>
      number(v, "Layout size"),
    );
    if (width <= 0 || height <= 0 || gap < 0 || padding < 0)
      throw Error("Invalid layout dimensions");
    const w = width - 2 * padding,
      h = height - 2 * padding;
    if (w <= 0 || h <= 0) throw Error("Padding leaves no drawing area");
    if (kind === "overlay")
      return Array.from({ length: count }, () => ({
        x: padding,
        y: padding,
        width: w,
        height: h,
      }));
    const ws = weights ?? Array(count).fill(1);
    if (!Array.isArray(ws) || ws.length !== count || ws.some(v => !Number.isFinite(v) || v <= 0))
      throw Error("Positive layout weights required");
    const total = ws.reduce((a,b) => a+b,0);
    if (kind === "columns" && (w - gap * (count - 1)) * Math.min(...ws) / total < minColumnWidth)
      kind = "stack";
    if (kind === "grid") {
      const cols = Math.max(
          1,
          Math.min(
            count,
            Math.floor((w + gap) / (minColumnWidth + gap)),
            columns,
          ),
        ),
        rows = Math.ceil(count / cols);
      const cellW = (w - gap * (cols - 1)) / cols,
        cellH = (h - gap * (rows - 1)) / rows;
      if (cellH <= 0) throw Error("Grid has no vertical space");
      return Array.from({ length: count }, (_, i) => ({
        x: padding + (i % cols) * (cellW + gap),
        y: padding + Math.floor(i / cols) * (cellH + gap),
        width: cellW,
        height: cellH,
      }));
    }
    if (!["columns", "stack"].includes(kind))
      throw Error("Unknown layout " + kind);
    const space = (kind === "columns" ? w : h) - gap * (count - 1);
    if (space <= 0) throw Error("Layout has no space between children");
    let cursor = padding;
    return ws.map((weight) => {
      const size = (space * weight) / total,
        box =
          kind === "columns"
            ? { x: cursor, y: padding, width: size, height: h }
            : { x: padding, y: cursor, width: w, height: size };
      cursor += size + gap;
      return box;
    });
  }
  B.prototype.layout = function (count, options = {}) {
    return layout(this.width, this.height, count, options);
  };
  B.prototype.handle = function (
    id,
    frame,
    value,
    {
      color = P.orange,
      label = null,
      ariaLabel = null,
      axis = "both",
      step = 0.1,
      bounds = null,
      onChange,
      constrain = null,
    } = {},
  ) {
    point(value);
    if (typeof onChange !== "function") throw Error("Handle needs onChange");
    if (
      !["both", "x", "y"].includes(axis) ||
      !Number.isFinite(step) ||
      step <= 0
    )
      throw Error("Invalid handle movement");
    const limits = bounds ?? { x: frame.x.domain(), y: frame.y.domain() };
    for (const dimension of ["x", "y"])
      if (
        !Array.isArray(limits[dimension]) ||
        limits[dimension].length !== 2 ||
        !limits[dimension].every(Number.isFinite) ||
        limits[dimension][0] > limits[dimension][1]
      )
        throw Error("Invalid handle bounds");
    const x = frame.x(value[0]),
      y = frame.y(value[1]);
    this.circle(id + "-halo", x, y, 11, P.paper);
    this.mark(id + "-ring", "circle", {
      cx: x,
      cy: y,
      r: 8,
      fill: color,
      stroke: P.paper,
      "stroke-width": 2,
    });
    const node = this.mark(id + "-handle", "circle", {
      cx: x,
      cy: y,
      r: 20,
      fill: "transparent",
      tabindex: 0,
      role: "button",
      "aria-label": (ariaLabel ?? label ?? "可拖动点") + "；方向键移动",
      "aria-valuetext": value.map((v) => v.toFixed(2)).join(", "),
      class: "vh-handle",
      style: "touch-action:none;cursor:grab",
    });
    node._vhHandle = {
      frame,
      value: [...value],
      limits,
      axis,
      step,
      onChange,
      constrain,
      board: this,
    };
    if (!node._vhBound) {
      node._vhBound = true;
      const move = (candidate) => {
        const s = node._vhHandle;
        if (s.axis === "x") candidate[1] = s.value[1];
        if (s.axis === "y") candidate[0] = s.value[0];
        if (s.constrain) candidate = point(s.constrain(candidate));
        candidate = [
          V.clamp(candidate[0], ...s.limits.x),
          V.clamp(candidate[1], ...s.limits.y),
        ];
        s.onChange(candidate);
      };
      node.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        node._vhPointer = event.pointerId;
        node.setPointerCapture(event.pointerId);
        node._vhHandle.board.controls?.pause();
      });
      node.addEventListener("pointermove", (event) => {
        if (node._vhPointer !== event.pointerId) return;
        const s = node._vhHandle,
          local = new DOMPoint(event.clientX, event.clientY).matrixTransform(
            s.board.svg.getScreenCTM().inverse(),
          );
        move([s.frame.x.invert(local.x), s.frame.y.invert(local.y)]);
      });
      const release = () => {
        node._vhPointer = null;
      };
      node.addEventListener("pointerup", release);
      node.addEventListener("pointercancel", release);
      node.addEventListener("lostpointercapture", release);
      node.addEventListener("keydown", (event) => {
        const s = node._vhHandle,
          deltas = {
            ArrowLeft: [-1, 0],
            ArrowRight: [1, 0],
            ArrowUp: [0, 1],
            ArrowDown: [0, -1],
          };
        if (!deltas[event.key]) return;
        event.preventDefault();
        event.stopPropagation();
        const amount = s.step * (event.shiftKey ? 10 : 1),
          d = deltas[event.key];
        move([s.value[0] + d[0] * amount, s.value[1] + d[1] * amount]);
      });
    }
    if (label)
      this.label(id + "-label", label, x + 13, y - 13, {
        color,
        maxWidth: 100,
        size: 14,
      });
    return node;
  };
  B.prototype.selectable = function (
    node,
    { label, selected = false, onSelect } = {},
  ) {
    if (typeof onSelect !== "function")
      throw Error("Selection callback required");
    node.setAttribute("tabindex", "0");
    node.setAttribute("role", "button");
    node.setAttribute("aria-label", label ?? "选择");
    node.setAttribute("aria-pressed", String(selected));
    node.classList.add("vh-selectable");
    node._vhSelect = onSelect;
    if (!node._vhSelectBound) {
      node._vhSelectBound = true;
      node.addEventListener("click", () => node._vhSelect());
      node.addEventListener("keydown", (e) => {
        if (["Enter", " "].includes(e.key)) {
          e.preventDefault();
          node._vhSelect();
        }
      });
    }
    return node;
  };
  function resolve(value, context, depth = 0) {
    if (depth > 16) throw Error("Binding nesting too deep");
    if (Array.isArray(value))
      return value.map((v) => resolve(v, context, depth + 1));
    if (value && typeof value === "object") {
      if ("$param" in value) {
        if (!(value.$param in context.params))
          throw Error("Unknown parameter " + value.$param);
        return context.params[value.$param];
      }
      if ("$state" in value)
        return (
          context.state[value.$state] ??
          resolve(value.fallback, context, depth + 1)
        );
      if ("$result" in value) {
        const parts = String(value.$result).split(".");
        let found = context.results;
        for (const key of parts) {
          if (
            found === null ||
            found === undefined ||
            !Object.hasOwn(found, key)
          )
            throw Error(
              "Result is unavailable; place its component first: " +
                value.$result,
            );
          found = found[key];
        }
        return found;
      }
      if ("$progress" in value) {
        const range = value.$progress;
        return range === true
          ? context.progress
          : V.mix(
              number(range[0], "Progress start"),
              number(range[1], "Progress end"),
              context.progress,
            );
      }
      if ("$lerp" in value) {
        const [a, b] = resolve(value.$lerp, context, depth + 1);
        const blend = (x, y) =>
          Array.isArray(x)
            ? x.map((v, i) => blend(v, y[i]))
            : V.mix(
                number(x, "Lerp start"),
                number(y, "Lerp end"),
                context.progress,
              );
        return blend(a, b);
      }
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [
          k,
          resolve(v, context, depth + 1),
        ]),
      );
    }
    return value;
  }
  V.components = {};
  function renderScene(board, scene, context) {
    let count = 0;
    const current = { ...context, results: {} };
    const visit = (b, node, depth) => {
      if (++count > 64 || depth > 8)
        throw Error("Scene is too complex; split the idea");
      if (!node || typeof node !== "object" || typeof node.type !== "string")
        throw Error("Scene node needs a type");
      if (node.id !== undefined && !/^[a-z][a-z0-9-]*$/.test(node.id))
        throw Error("Scene ids use lowercase letters, digits and hyphens");
      if (node.type === "compose") {
        if (
          !Array.isArray(node.calculations) ||
          node.calculations.length > 16 ||
          !node.visual
        )
          throw Error(
            "Compose needs up to 16 bounded calculations and a visual tree",
          );
        for (const calculation of node.calculations) {
          if (
            ++count > 64 ||
            !/^[a-z][a-z0-9-]*$/.test(calculation.id) ||
            Object.hasOwn(current.results, calculation.id)
          )
            throw Error(
              "Unique calculation id required within scene size limit",
            );
          const inputs = resolve(calculation.inputs, current);
          const result = global.VisualBookCalculations.compute(calculation.operation, inputs, {id:calculation.id}).result;
          current.results[calculation.id] = result;
        }
        return visit(b, node.visual, depth + 1);
      }
      if (["columns", "stack", "grid", "overlay"].includes(node.type)) {
        if (!Array.isArray(node.children) || !node.children.length)
          throw Error("Layout needs children");
        const ids = node.children.map((n, i) => n.id ?? "part-" + i);
        if (new Set(ids).size !== ids.length)
          throw Error("Duplicate sibling ids");
        const boxes = b.layout(node.children.length, {
          kind: node.type,
          ...node.layout,
        });
        return Object.fromEntries(
          node.children.map((child, i) => [
            ids[i],
            b.region(ids[i], boxes[i], (local) =>
              visit(local, child, depth + 1),
            ),
          ]),
        );
      }
      const component = V.components[node.type];
      if (!component) throw Error("Unknown component " + node.type);
      const facts = component(b, resolve(node.props ?? {}, current), current);
      if (node.id) {
        if (Object.hasOwn(current.results, node.id))
          throw Error("Duplicate component result id " + node.id);
        current.results[node.id] = facts;
      }
      return facts;
    };
    return visit(board, scene, 0);
  }
  V.layout = layout;
  // Width needed to keep declared structured columns horizontal. Runtime uses
  // the compact height when a narrow weighted child forces stacking.
  V.sceneMinimumWidth = function minimum(node) {
    if (!node || typeof node !== 'object') return 0;
    if (node.type === 'compose') return minimum(node.visual);
    const children = node.children ?? [];
    if (!children.length) return 0;
    const {gap=24,padding=0,minColumnWidth=260,weights=null,columns=2}=node.layout ?? {};
    if (node.type === 'columns') {
      const ws=weights ?? children.map(()=>1), total=ws.reduce((a,b)=>a+b,0);
      return 2*padding+gap*(children.length-1)+Math.max(...children.map((child,i)=>Math.max(minColumnWidth,minimum(child))*total/ws[i]));
    }
    if (node.type === 'grid') {
      const n=Math.min(columns,children.length);
      return 2*padding+gap*(n-1)+n*Math.max(minColumnWidth,...children.map(minimum));
    }
    return 2*padding+Math.max(...children.map(minimum));
  };
  V.resolveBindings = resolve;
  V.renderScene = renderScene;
})(window);
