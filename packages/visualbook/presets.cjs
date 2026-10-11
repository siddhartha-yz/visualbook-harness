(function (global) {
  function validatePresets(figure) {
    const presets = figure.presets ?? [];
    if (!Array.isArray(presets) || presets.length > 6)
      throw Error("Use at most six named parameter cases");
    const specs = new Map((figure.params ?? []).map(p => [p.key, p])), ids = new Set();
    for (const preset of presets) {
      if (!preset || Object.keys(preset).some(k => !["id", "label", "params", "progress"].includes(k)) ||
          !/^[a-z][a-z0-9-]*$/.test(preset.id ?? "") || ids.has(preset.id) ||
          typeof preset.label !== "string" || !preset.label.trim() || preset.label.length > 24 ||
          !preset.params || typeof preset.params !== "object" || Array.isArray(preset.params) ||
          !Object.keys(preset.params).length)
        throw Error("A parameter case needs a unique id, short label and explicit parameter values");
      ids.add(preset.id);
      if ((figure.interaction ?? "timeline") === "static") throw Error("Static figures cannot have parameter cases");
      for (const [key, value] of Object.entries(preset.params)) {
        const spec = specs.get(key);
        if (!spec || (spec.kind === "select" ? !spec.options?.some(o => o.value === value) :
            !Number.isFinite(value) || value < spec.min || value > spec.max ||
            (spec.kind === "stepper" && !Number.isSafeInteger(value))))
          throw Error("Parameter case has an unknown or out-of-range value: " + key);
      }
      if (preset.progress !== undefined && ((figure.interaction ?? "timeline") !== "timeline" ||
          !Number.isFinite(preset.progress) || preset.progress < 0 || preset.progress > 1))
        throw Error("Case progress requires a timeline and a finite value in 0..1");
    }
    return presets;
  }
  const api = { validatePresets };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.VisualBookPresets = api;
})(typeof window !== "undefined" ? window : globalThis);
