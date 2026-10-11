/* Browser behavior regression for reader-controlled diagrams; no model calls. */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { build } from "./visualbook.mjs";

const root = path.resolve(import.meta.dirname, "..");
const out = path.resolve(
  process.argv[2] ?? path.join(root, "work/harness-v3/controls-" + Date.now()),
);
if (fs.existsSync(out)) throw Error("Output exists");
fs.mkdirSync(out, { recursive: true });
const blocks = Array.from({ length: 6 }, (_, i) => ({
  id: `control-${i}`,
  raw: "交互控制样本",
  type: "paragraph",
  sha256: "maintenance-fixture",
  math: { expected: 0 },
  html: `<p>${"这段文字只用于制造真实的阅读距离，不是教材内容。".repeat(4)}</p>`,
}));
const figures = [0, 1].map((i) => ({
  id: `manual-${i}`,
  title: "读者控制样本 " + i,
  presentation: "exploration",
  afterAnchor: `control-${i * 2}`,
  endAnchor: `control-${i * 2 + 1}`,
  height: 260,
  durationMs: 1000,
  checkpoints: [0, 0.2, 0.7, 1],
  stages: ["起点", "中间", "终点"],
  params: [
    { key: "scale", label: "倍数", min: 1, max: 3, step: 0.1, value: 1 },
  ],
  code: "function draw({board,progress,params}){board.line('track',30,130,board.width-30,130,VisualBook.palette.faint);board.circle('point',30+(board.width-60)*progress,130,9);board.text('value',(progress*params.scale).toFixed(2),board.width/2,75,{anchor:'middle',size:20});return {value:progress*params.scale};}",
}));
const file = path.join(out, "controls.html");
fs.writeFileSync(
  file,
  build(
    {
      title: "手动交互控制",
      sourceUrl: "https://github.com/siddhartha-yz/visualbook-harness",
      sourceSha256: "maintenance-fixture",
      blocks,
    },
    { figures },
  ),
);
const { chromium } = await import(
  pathToFileURL(
    path.join(
      root,
      "work/visualbook/runtime/node_modules/playwright-core/index.mjs",
    ),
  )
);
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH ?? chromium.executablePath(),
});
const checks = {};
try {
  const page = await browser.newPage({
    viewport: { width: 1100, height: 1500 },
  });
  await page.goto(pathToFileURL(file).href);
  await page.waitForFunction(() => VisualBookRuntime.instances.length === 2);
  const first = page.locator("#figure-manual-0");
  const snapshot = () =>
    page.evaluate(() => {
      const i = VisualBookRuntime.instances[0];
      return {
        progress: i.progress,
        playing: i.playing,
        value: i.facts.value,
        x: +i.svg.querySelector('[data-viz-key="point"]').getAttribute("cx"),
      };
    });
  await first.scrollIntoViewIfNeeded();
  const initial = await snapshot();
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(220);
  assert.deepEqual(await snapshot(), initial);
  checks.scrollDoesNotAdvance = true;
  assert.equal(
    await first.evaluate((el) => getComputedStyle(el).position),
    "static",
  );
  assert.equal(
    await page.getByRole("button", { name: "跟随阅读", exact: true }).count(),
    0,
  );
  checks.noStickyOrReadingFollowButton = true;
  await first.scrollIntoViewIfNeeded();
  const range = first.locator(".vh-progress");
  await range.focus();
  await page.keyboard.press("ArrowRight");
  const keyboard = await snapshot();
  assert.ok(keyboard.progress > 0 && keyboard.x > initial.x);
  checks.keyboardMovesActualGeometry = true;
  const box = await range.boundingBox();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, {
    steps: 10,
  });
  await page.mouse.up();
  const dragged = await snapshot();
  assert.ok(dragged.progress > 0.5 && dragged.progress < 0.7);
  assert.ok(dragged.x > keyboard.x);
  checks.dragMovesActualGeometry = true;
  await first.locator(".vh-next").click();
  assert.equal((await snapshot()).progress, 0.7);
  await first.locator(".vh-prev").click();
  assert.equal((await snapshot()).progress, 0.2);
  checks.singleStepUsesDeclaredCheckpoints = true;
  await first.locator('[data-param="scale"]').focus();
  await page.keyboard.press("ArrowRight");
  assert.ok((await snapshot()).value > 0.2);
  await first.locator(".vh-reset").click();
  assert.deepEqual(await snapshot(), initial);
  checks.resetRestoresParametersAndProgress = true;
  await page.screenshot({
    path: path.join(out, "manual-initial.png"),
    fullPage: false,
  });
  await first.locator(".vh-play").click();
  await page.waitForFunction(
    () => VisualBookRuntime.instances[0].progress > 0.12,
  );
  assert.ok((await snapshot()).x > initial.x);
  await first.locator(".vh-play").click();
  const paused = await snapshot();
  await page.waitForTimeout(160);
  assert.deepEqual(await snapshot(), paused);
  checks.explicitPlayAndPause = true;
  await first.locator(".vh-play").click();
  await page.waitForFunction(
    () => VisualBookRuntime.instances[0].progress > 0.3,
  );
  await page.mouse.wheel(0, 100);
  await page.waitForFunction(() => !VisualBookRuntime.instances[0].playing);
  const afterScroll = await snapshot();
  await page.waitForTimeout(160);
  assert.deepEqual(await snapshot(), afterScroll);
  checks.scrollPausesPlayback = true;
  await first.scrollIntoViewIfNeeded();
  await first.locator(".vh-play").click();
  await page.evaluate(() => VisualBookRuntime.instances[1].play());
  assert.equal((await snapshot()).playing, false);
  checks.onlyOneActivePlayback = true;
  await page.evaluate(() => {
    VisualBookRuntime.pauseAll();
    const i = VisualBookRuntime.instances[0];
    i.setProgress(0.9);
    i.play();
  });
  await page.waitForFunction(
    () =>
      VisualBookRuntime.instances[0].progress === 1 &&
      !VisualBookRuntime.instances[0].playing,
  );
  await page.waitForTimeout(100);
  assert.equal((await snapshot()).progress, 1);
  checks.playStopsAtEnd = true;
  await page.screenshot({
    path: path.join(out, "manual-end.png"),
    fullPage: false,
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(() => document.querySelector(".vh-play").disabled);
  await first.locator(".vh-reset").click();
  await first.locator(".vh-next").click();
  assert.equal((await snapshot()).progress, 0.2);
  assert.equal(
    await page.evaluate(() => VisualBookRuntime.instances[0].play()),
    false,
  );
  checks.reducedMotionKeepsManualControls = true;
} finally {
  await browser.close();
}
fs.writeFileSync(
  path.join(out, "checks.json"),
  JSON.stringify(
    {
      checks,
      modelCalls: 0,
      scope:
        "Actual browser interaction, not artistic or educational acceptance",
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify({ out, checks, modelCalls: 0 }));
