import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolvePlan, build } from "../tools/visualbook.mjs";
const { validatePresets } = createRequire(import.meta.url)("../packages/visualbook/presets.cjs");
const figure = { interaction: "parameters", params: [
  { key: "n", kind: "stepper", min: 1, max: 8, value: 2, step: 1 },
  { key: "mode", kind: "select", value: "a", options: [{ value: "a" }, { value: "b" }] },
], presets: [{ id: "larger", label: "更大输入", params: { n: 8, mode: "b" } }] };
test("named cases validate explicit scalar inputs and reject ambiguous or impossible cases", () => {
  assert.equal(validatePresets(figure).length, 1);
  for (const patch of [ { params: { n: 9 } }, { params: { n: 1.5 } }, { params: { mode: "c" } }, { params: { missing: 1 } }, { params: {} }, { progress: .5 }, { id: "Bad ID" }, { label: "" } ])
    assert.throws(() => validatePresets({ ...figure, presets: [{ ...figure.presets[0], ...patch }] }));
  assert.throws(() => validatePresets({ ...figure, presets: [...figure.presets, ...figure.presets] }));
  assert.throws(() => validatePresets({ ...figure, interaction: "static" }));
  assert.equal(validatePresets({ ...figure, interaction: "timeline", presets: [{ ...figure.presets[0], progress: 1 }] }).length, 1);
});
test("named designs retain their reading layout and cases while allowing explicit placement changes", () => {
  const input = { figures: [{ id: "communication", design: "collective-semantics", afterAnchor: "one" }] };
  const resolved = resolvePlan(input).figures[0];
  assert.equal(resolved.placement, "wide");
  assert.deepEqual(resolved.presets.map(p => p.id), ["sum", "shard", "copy", "exchange"]);
  assert.equal(resolvePlan({ figures: [{ ...input.figures[0], placement: "body" }] }).figures[0].placement, "body");
  const source = { title: "Control", sourceSha256: "control", blocks: [{ id: "one", type: "paragraph", raw: "Control", html: "<p>Control</p>", sha256: "control", math: { expected: 0 } }] };
  const html = build(source, input);
  assert.match(html, /data-placement="wide"/);
  assert.match(html, /data-preset="sum"/);
});
