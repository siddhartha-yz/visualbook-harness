/* Reader-controlled diagrams. Scrolling pauses motion; it never drives it. */
(function (global) {
  const instances = [];
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const toc = document.querySelector(".vh-toc details");
  if (toc && matchMedia("(min-width:1200px)").matches) toc.open = true;
  const clamp = (p) => {
    if (!Number.isFinite(p)) throw Error("Progress must be finite");
    return Math.max(0, Math.min(1, p));
  };
  function pauseAll() {
    for (const instance of instances) instance.pause();
  }
  addEventListener("scroll", pauseAll, { passive: true });
  addEventListener("wheel", pauseAll, { passive: true });
  addEventListener("touchmove", pauseAll, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pauseAll();
  });
  reduced.addEventListener("change", () => {
    pauseAll();
    for (const instance of instances) instance.refreshControls();
  });

  function mount(element, figure, draw, library = true) {
    const interaction = figure.interaction ?? "timeline";
    if (!["timeline", "parameters", "static"].includes(interaction))
      throw Error("Unknown interaction mode");
    const svg = element.querySelector("svg");
    const range = element.querySelector(".vh-progress");
    const status = element.querySelector(".vh-status");
    const playButton = element.querySelector(".vh-play");
    const previousButton = element.querySelector(".vh-prev");
    const nextButton = element.querySelector(".vh-next");
    const resetButton = element.querySelector(".vh-reset,.vh-resume");
    const parameterSpecs = Object.fromEntries(
      (figure.params ?? []).map((p) => [p.key, p]),
    );
    const params = Object.fromEntries(
      (figure.params ?? []).map((p) => [p.key, p.value]),
    );
    const initialState = structuredClone(figure.state ?? {});
    const state = structuredClone(initialState);
    const initialProgress = clamp(figure.initialProgress ?? 0);
    const count = Math.max(2, figure.stages?.length ?? 3);
    const checkpoints = figure.checkpoints?.length
      ? figure.checkpoints.map((c) => (typeof c === "number" ? c : c.progress))
      : Array.from({ length: count }, (_, i) => i / (count - 1));
    if (
      checkpoints.some(
        (p, i) =>
          !Number.isFinite(p) ||
          p < 0 ||
          p > 1 ||
          (i && p <= checkpoints[i - 1]),
      )
    )
      throw Error("Checkpoints must be ordered progress values");
    if (checkpoints[0] !== 0 || checkpoints.at(-1) !== 1)
      throw Error("Checkpoints must include 0 and 1");
    const duration = figure.durationMs ?? 8000;
    if (!Number.isFinite(duration) || duration < 1000 || duration > 60000)
      throw Error("Animation duration must be 1000..60000 ms");
    let progress = initialProgress;
    let playing = false;
    let raf = null;
    let started = 0;
    let startProgress = 0;
    const board = library ? new VisualBook.Board(svg) : null;
    const context = {
      svg,
      board,
      get width() {
        return element.querySelector(".vh-canvas").clientWidth;
      },
      height: figure.height ?? 320,
    };
    const controls = {
      setProgress,
      pause,
      setParam(key, value) {
        instance.setParam(key, value);
      },
      setState(key, value) {
        if (
          typeof key !== "string" ||
          !/^[a-z][a-zA-Z0-9]*$/.test(key) ||
          ["constructor", "prototype"].includes(key)
        )
          throw Error("State key required");
        pause();
        state[key] = structuredClone(value);
        paint(progress);
      },
      invalidate() {
        pause();
        paint(progress);
      },
    };
    if (board) board.controls = controls;
    function refreshControls() {
      if (playButton) {
        playButton.textContent = playing ? "暂停" : "看一遍";
        playButton.setAttribute("aria-pressed", String(playing));
        playButton.setAttribute(
          "aria-label",
          figure.title + (playing ? "：暂停演示" : "：播放演示"),
        );
        playButton.disabled = reduced.matches;
        playButton.title = reduced.matches
          ? "已开启减少动态效果，可以拖动或单步查看"
          : "主动播放一次；滚动页面会暂停";
      }
      if (previousButton) previousButton.disabled = progress <= 0;
      if (nextButton) nextButton.disabled = progress >= 1;
      for (const button of element.querySelectorAll("[data-param-step]")) {
        const key = button.dataset.paramStep,
          spec = parameterSpecs[key];
        button.disabled =
          Number(button.dataset.direction) < 0
            ? params[key] <= spec.min
            : params[key] >= spec.max;
      }
      for (const button of element.querySelectorAll("[data-preset]")) {
        const preset = figure.presets.find(p => p.id === button.dataset.preset);
        button.setAttribute("aria-pressed", String(Object.entries(preset.params).every(([k, v]) => params[k] === v) &&
          (preset.progress === undefined || Math.abs(progress - preset.progress) < 1e-8)));
      }
    }
    function formatParameter(value) {
      return global.VisualBook?.formatNumber ? global.VisualBook.formatNumber(value) : String(value);
    }
    function syncParameter(key) {
      const spec = parameterSpecs[key], input = element.querySelector(`[data-param="${key}"]`);
      if (!input) return;
      input.value = spec.kind === "select" ? spec.options.findIndex(o => o.value === params[key]) : params[key];
      if (input.nextElementSibling) input.nextElementSibling.value = formatParameter(params[key]);
    }
    function checkParameter(key, value) {
      const spec = Object.hasOwn(parameterSpecs, key) ? parameterSpecs[key] : null;
      if (!spec || (spec.kind === "select" ? !spec.options.some(o => o.value === value) :
          !Number.isFinite(value) || value < spec.min || value > spec.max) ||
          (spec.kind === "stepper" && !Number.isSafeInteger(value)))
        throw Error("Invalid parameter " + key);
    }
    function setParams(values, nextProgress = progress) {
      if (!values || typeof values !== "object" || Array.isArray(values)) throw Error("Explicit parameter values required");
      for (const [key, value] of Object.entries(values)) checkParameter(key, value);
      const next = clamp(nextProgress); // Validate everything before changing any input.
      pause();
      Object.assign(params, values);
      for (const key of Object.keys(values)) syncParameter(key);
      paint(interaction === "timeline" ? next : initialProgress);
    }
    function pause() {
      if (raf !== null) cancelAnimationFrame(raf);
      raf = null;
      playing = false;
      refreshControls();
    }
    const calculationCache = new Map();
    function paint(p) {
      progress = clamp(p);
      const width = Math.floor(context.width);
      if (width < 1) return;
      // Match the compact layouts used by the public diagram examples. A
      // 450px height switch clipped their stacked layouts at 450..599px.
      const height =
        width < 600 ? (figure.mobileHeight ?? context.height) : context.height;
      if (!board && svg.getAttribute("viewBox") !== `0 0 ${width} ${height}`)
        svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      if (svg.style.height !== height + "px") svg.style.height = height + "px";
      const calculationTrace = [];
      instance.calculations = calculationTrace;
      const calculationRuntime = global.VisualBookCalculations;
      instance.calculationTraceVersion = calculationRuntime ? 2 : 0;
      try {
        if (board) board.begin(width, height);
        const render = () => draw({
            ...context,
            width,
            height,
            progress,
            params,
            state,
            controls,
            board,
            calculationTrace,
          });
        // Plain SVG candidates deliberately omit the numerical library. Keep
        // them drawable, and report their calculations as unrecorded.
        instance.facts = (calculationRuntime
          ? calculationRuntime.withTrace(calculationTrace, render, {cache:calculationCache})
          : render()) ?? {};
        if (board) board.end();
        const role = svg.querySelector('[tabindex="0"]') ? "group" : "img";
        if (svg.getAttribute("role") !== role) svg.setAttribute("role", role);
        instance.error = null;
        delete element.dataset.failed;
      } catch (error) {
        instance.error = String(error);
        element.dataset.failed = "true";
        if (status) status.textContent = "图解暂不可用";
        pause();
        throw error;
      }
      instance.progress = progress;
      if (range) range.value = progress;
      if (status)
        status.textContent = figure.stages?.length
          ? figure.stages[
              Math.min(
                figure.stages.length - 1,
                Math.floor(progress * figure.stages.length),
              )
            ]
          : "演示 " + Math.round(progress * 100) + "%";
      refreshControls();
    }
    function setProgress(p) {
      pause();
      paint(interaction === "timeline" ? p : initialProgress);
    }
    function tick(now) {
      raf = null;
      if (!playing) return;
      try {
        paint(Math.min(1, startProgress + (now - started) / duration));
      } catch {
        return;
      }
      if (progress >= 1) pause();
      else raf = requestAnimationFrame(tick);
    }
    function play() {
      if (reduced.matches || interaction !== "timeline") return false;
      pauseAll();
      if (figure.presentation !== "exploration" || progress >= 1) paint(0);
      playing = true;
      startProgress = progress;
      started = performance.now();
      refreshControls();
      raf = requestAnimationFrame(tick);
      return true;
    }
    function step(direction) {
      const at =
        direction > 0
          ? (checkpoints.find((p) => p > progress + 1e-8) ?? 1)
          : (checkpoints.findLast((p) => p < progress - 1e-8) ?? 0);
      setProgress(at);
    }
    function reset() {
      pause();
      for (const key of Object.keys(state)) delete state[key];
      Object.assign(state, structuredClone(initialState));
      for (const [key, spec] of Object.entries(parameterSpecs)) {
        params[key] = spec.value;
        syncParameter(key);
      }
      paint(initialProgress);
    }
    const instance = {
      id: figure.id,
      figure,
      interaction,
      element,
      svg,
      params,
      state,
      controls,
      context,
      progress,
      facts: {},
      calculations: [],
      calculationTraceVersion: 2,
      error: null,
      setProgress,
      paint,
      play,
      pause,
      step,
      reset,
      refreshControls,
      get manual() {
        return !playing;
      },
      get playing() {
        return playing;
      },
      // Compatibility for callers of the old API; it resets, never follows scroll.
      resume: reset,
      setParams,
      setPreset(id) {
        const preset = (figure.presets ?? []).find(p => p.id === id);
        if (!preset) throw Error("Unknown parameter case");
        setParams(preset.params, preset.progress ?? progress);
      },
      setParam(key, value) {
        setParams({ [key]: value });
      },
    };
    range?.addEventListener("input", () => setProgress(+range.value));
    // Opening/closing exploration changes reading layout, never the diagram state.
    element.querySelector(".vh-explore")?.addEventListener("toggle", pause);
    for (const input of element.querySelectorAll("[data-param]")) {
      const spec = parameterSpecs[input.dataset.param];
      input.addEventListener("input", () =>
        instance.setParam(
          input.dataset.param,
          spec.kind === "select"
            ? spec.options[Number(input.value)].value
            : +input.value,
        ),
      );
    }
    for (const button of element.querySelectorAll("[data-param-step]"))
      button.addEventListener("click", () => {
        const key = button.dataset.paramStep,
          spec = parameterSpecs[key];
        instance.setParam(
          key,
          Math.max(
            spec.min,
            Math.min(spec.max, params[key] + Number(button.dataset.direction)),
          ),
        );
      });
    for (const button of element.querySelectorAll("[data-preset]"))
      button.addEventListener("click", () => instance.setPreset(button.dataset.preset));
    playButton?.addEventListener("click", () => (playing ? pause() : play()));
    previousButton?.addEventListener("click", () => step(-1));
    nextButton?.addEventListener("click", () => step(1));
    if (resetButton) {
      resetButton.textContent = "重置";
      resetButton.addEventListener("click", reset);
    }
    const resize = new ResizeObserver(() => {
      try {
        paint(progress);
      } catch {
        /* error is retained on the instance */
      }
    });
    resize.observe(element.querySelector(".vh-canvas"));
    const intersection = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting) pause();
    });
    intersection.observe(element);
    instances.push(instance);
    for (const key of Object.keys(parameterSpecs)) syncParameter(key);
    paint(initialProgress);
    return instance;
  }
  global.VisualBookRuntime = { mount, instances, pauseAll };
})(window);
