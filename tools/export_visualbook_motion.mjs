/* Deterministic local figure export. No screen recording or model calls. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { invalidGeometry } from "./visualbook_inspection.mjs";
import { workspaceRoot } from "./visualbook_workspace.mjs";

const root = path.resolve(import.meta.dirname, "..");
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const json = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const write = (file, value) =>
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");

export async function exportMotion(file, previewDirectory, out, config) {
  file = path.resolve(file);
  out = path.resolve(out);
  const work = fs.realpathSync(path.join(workspaceRoot(root), "work"));
  const parent = fs.realpathSync(path.dirname(out));
  if (parent !== work && !parent.startsWith(work + path.sep))
    throw Error("Keep motion frames and intermediates inside ignored work/");
  if (fs.existsSync(out))
    throw Error("Motion output exists; use a fresh directory");
  const allowed = new Set([
    "id",
    "width",
    "fps",
    "duration",
    "formats",
    "params",
    "sweep",
    "from",
    "to",
  ]);
  if (Object.keys(config).some((key) => !allowed.has(key)))
    throw Error("Unknown motion option");
  const {
    id,
    width = 1280,
    fps = 20,
    duration = 6,
    formats = ["mp4"],
    params = {},
    sweep = null,
    from = 0,
    to = 1,
  } = config;
  if (!/^[a-z][a-z0-9-]{0,79}$/.test(id ?? ""))
    throw Error("Figure id required");
  if (![375, 1280].includes(width))
    throw Error("Use a checked width: 375 or 1280");
  // These rates have exact centisecond GIF delays, as well as exact MP4 times.
  if (
    ![5, 10, 20, 25].includes(fps) ||
    !Number.isInteger(duration) ||
    duration < 1 ||
    duration > 20 ||
    fps * duration > 300
  )
    throw Error(
      "Use fps 5/10/20/25, integer duration 1..20 s, at most 300 frames",
    );
  if (
    !Array.isArray(formats) ||
    !formats.length ||
    new Set(formats).size !== formats.length ||
    formats.some((f) => !["gif", "mp4"].includes(f))
  )
    throw Error("Formats must be gif and/or mp4, without duplicates");
  if (![from, to].every((v) => Number.isFinite(v) && v >= 0 && v <= 1))
    throw Error("Progress endpoints must be 0..1");
  if (!params || typeof params !== "object" || Array.isArray(params))
    throw Error("Parameter object required");
  if (
    sweep &&
    (Object.keys(sweep).some((key) => !["key", "from", "to"].includes(key)) ||
      !/^[a-z][a-zA-Z0-9]*$/.test(sweep.key ?? "") ||
      ![sweep.from, sweep.to].every(Number.isFinite))
  )
    throw Error("Sweep requires a numeric key/from/to");
  const inputHash = hash(fs.readFileSync(file));
  const preview = json(path.join(previewDirectory, "report.json"));
  if (preview.sha256 !== inputHash)
    throw Error("Motion export needs a preview of this exact HTML");
  if (preview.status !== "completed" || preview.findings.length)
    throw Error("Unfinished or failing preview stops motion export");
  if (
    !preview.viewports.some(
      (v) => v.width === width && v.shapes.some((s) => s.id === id),
    )
  )
    throw Error("Figure/width has not been previewed");
  fs.mkdirSync(out);
  fs.mkdirSync(path.join(out, "frames"));
  const report = {
    kind: "deterministic Chromium figure frames and actual FFmpeg encode/decode; no model generation or artistic acceptance",
    status: "running",
    modelCalls: 0,
    inputHtml: file,
    inputSha256: inputHash,
    previewSha256: hash(
      fs.readFileSync(path.join(previewDirectory, "report.json")),
    ),
    config: { id, width, fps, duration, formats, params, sweep, from, to },
    startedAt: new Date().toISOString(),
    frameCount: fps * duration,
    frames: [],
    replays: [],
    outputs: [],
    findings: [],
  };
  const save = () => write(path.join(out, "report.json"), report);
  save();
  let browser, activePage;
  const start = performance.now();
  const run = (label, args) => {
    const at = performance.now();
    const result = spawnSync(process.env.FFMPEG_PATH ?? "ffmpeg", args, {
      encoding: "utf8",
      timeout: 120000,
      maxBuffer: 8 * 1024 * 1024,
    });
    fs.writeFileSync(
      path.join(out, label + ".log"),
      (result.stdout ?? "") +
        (result.stderr ?? "") +
        (result.error ? String(result.error) : ""),
    );
    report.commands ??= [];
    report.commands.push({
      label,
      args,
      status: result.status,
      wallMs: performance.now() - at,
    });
    save();
    if (result.error || result.status !== 0)
      throw Error("FFmpeg " + label + " failed; retained log");
    return (result.stdout ?? "") + (result.stderr ?? "");
  };
  try {
    report.ffmpeg = run("ffmpeg-version", ["-version"]).split("\n")[0];
    const { chromium } = await import(
      pathToFileURL(
        path.join(
          root,
          "work/visualbook/runtime/node_modules/playwright-core/index.mjs",
        ),
      )
    );
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_PATH ?? chromium.executablePath(),
    });
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      deviceScaleFactor: 1,
    });
    activePage = page;
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("request", (request) => {
      if (/^https?:/.test(request.url()))
        errors.push("External request: " + request.url());
    });
    await page.addInitScript(() => {
      window.__VH_SNAPSHOT = true;
    });
    await page.addInitScript({
      content: "window.__VH_INVALID_GEOMETRY=" + invalidGeometry.toString(),
    });
    await page.goto(pathToFileURL(file).href);
    await page.waitForFunction(() => document.fonts.status === "loaded");
    const spec = await page.evaluate((id) => {
      const instance = VisualBookRuntime.instances.find((i) => i.id === id);
      if (!instance) throw Error("No such figure");
      VisualBookRuntime.pauseAll();
      return {
        interaction: instance.interaction,
        params: instance.figure.params ?? [],
      };
    }, id);
    if (spec.interaction !== "timeline" && !sweep)
      throw Error(
        "Parameter/static figures require an explicit numeric parameter sweep",
      );
    const sweepSpec = sweep && spec.params.find((p) => p.key === sweep.key);
    if (
      sweep &&
      (!sweepSpec ||
        sweepSpec.kind === "select" ||
        sweep.from < sweepSpec.min ||
        sweep.from > sweepSpec.max ||
        sweep.to < sweepSpec.min ||
        sweep.to > sweepSpec.max ||
        (sweepSpec.kind === "stepper" &&
          ![sweep.from, sweep.to].every(Number.isSafeInteger)))
    )
      throw Error(
        "Sweep endpoints must match the figure's numeric parameter bounds/type",
      );
    const svg = page.locator("#figure-" + id + " svg");
    await svg.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    const pose = async (index, filename) => {
      const t = index / (report.frameCount - 1);
      let sweepValue = sweep ? sweep.from + (sweep.to - sweep.from) * t : null;
      if (sweepSpec?.kind === "stepper") sweepValue = Math.round(sweepValue);
      const state = await page.evaluate(
        ({ id, params, progress, sweep, sweepValue }) => {
          const instance = VisualBookRuntime.instances.find((i) => i.id === id);
          instance.reset();
          for (const [key, value] of Object.entries(params))
            instance.setParam(key, value);
          if (sweep) instance.setParam(sweep.key, sweepValue);
          instance.setProgress(progress);
          if (instance.error) throw Error(instance.error);
          return {
            progress: instance.progress,
            params: { ...instance.params },
            facts: instance.facts,
            svg: new XMLSerializer().serializeToString(instance.svg),
            geometry: window.__VH_INVALID_GEOMETRY(instance.svg),
          };
        },
        { id, params, progress: from + (to - from) * t, sweep, sweepValue },
      );
      if (state.geometry.length || errors.length) {
        report.findings.push({
          index,
          geometry: state.geometry,
          errors: [...errors],
        });
        throw Error("Frame geometry or browser error at " + index);
      }
      // Flush Chromium's SVG/compositor paint. Progress stays fixed; this is
      // not the time source of the animation. The first capture otherwise can
      // contain an old marker position despite correct serialized SVG.
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      await svg.screenshot({ path: filename, animations: "disabled" });
      fs.writeFileSync(filename.replace(/\.png$/, ".svg"), state.svg);
      return {
        index,
        time: index / fps,
        progress: state.progress,
        params: state.params,
        facts: state.facts,
        svgSha256: hash(state.svg),
        pngSha256: hash(fs.readFileSync(filename)),
      };
    };
    // Prime SVG resources/layout before measuring capture cost. Keep these
    // pictures too, rather than silently discarding initial paint evidence.
    report.warmup = [
      await pose(report.frameCount - 1, path.join(out, "warmup-end.png")),
      await pose(0, path.join(out, "warmup-start.png")),
    ];
    const captureAt = performance.now();
    for (let index = 0; index < report.frameCount; index++) {
      const frame = await pose(
        index,
        path.join(out, "frames", String(index).padStart(5, "0") + ".png"),
      );
      report.frames.push(frame);
      if (index % 20 === 0) save();
    }
    report.captureMs = performance.now() - captureAt;
    report.uniqueSvgFrames = new Set(
      report.frames.map((frame) => frame.svgSha256),
    ).size;
    report.uniquePngFrames = new Set(
      report.frames.map((frame) => frame.pngSha256),
    ).size;
    if (report.uniqueSvgFrames < 2 || report.uniquePngFrames < 2)
      throw Error(
        "All frames are identical; export would imply motion that does not exist",
      );
    for (const index of [
      0,
      Math.floor(report.frameCount / 2),
      report.frameCount - 1,
    ]) {
      const replay = await pose(
        index,
        path.join(out, "replay-" + index + ".png"),
      );
      const original = report.frames[index];
      const matches =
        replay.svgSha256 === original.svgSha256 &&
        replay.pngSha256 === original.pngSha256;
      report.replays.push({ ...replay, matches });
      if (!matches)
        throw Error(
          "Replayed pose differs; inspect browser paint, hidden state or wall clock at " +
            index,
        );
    }
    await browser.close();
    browser = null;
    const pattern = path.join(out, "frames", "%05d.png");
    for (const format of formats) {
      const output = path.join(out, id + "." + format);
      const encodeAt = performance.now();
      const common = [
        "-hide_banner",
        "-nostdin",
        "-framerate",
        String(fps),
        "-start_number",
        "0",
        "-i",
        pattern,
      ];
      if (format === "gif")
        run("encode-gif", [
          ...common,
          "-filter_complex",
          "[0:v]split[a][b];[a]palettegen=reserve_transparent=0:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a",
          "-loop",
          "-1",
          "-final_delay",
          String(100 / fps),
          output,
        ]);
      else
        run("encode-mp4", [
          ...common,
          "-vf",
          "pad=ceil(iw/2)*2:ceil(ih/2)*2",
          "-c:v",
          "libx264",
          "-crf",
          "18",
          "-pix_fmt",
          "yuv420p",
          "-movflags",
          "+faststart",
          output,
        ]);
      const encodeMs = performance.now() - encodeAt;
      const decodeAt = performance.now();
      const decoded = run("decode-" + format, [
        "-hide_banner",
        "-nostdin",
        ...(format === "gif" ? ["-ignore_loop", "1"] : []),
        "-i",
        output,
        "-vf",
        "showinfo",
        "-fps_mode",
        "passthrough",
        "-f",
        "null",
        "-",
      ]);
      const count = [
        ...decoded.matchAll(/\[Parsed_showinfo[^\n]*\bn:\s*(\d+)\s+pts:/g),
      ].length;
      const durationMatch = decoded.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
      const decodedDuration =
        durationMatch &&
        Number(durationMatch[1]) * 3600 +
          Number(durationMatch[2]) * 60 +
          Number(durationMatch[3]);
      if (
        count !== report.frameCount ||
        decodedDuration === null ||
        Math.abs(decodedDuration - duration) > 0.011
      )
        throw Error(
          "Encoded frame count/duration mismatch: " +
            JSON.stringify({ count, decodedDuration }),
        );
      const sampleDir = path.join(out, "decoded-" + format);
      fs.mkdirSync(sampleDir);
      run("samples-" + format, [
        "-hide_banner",
        "-nostdin",
        ...(format === "gif" ? ["-ignore_loop", "1"] : []),
        "-i",
        output,
        "-vf",
        `select=eq(n\\,0)+eq(n\\,${Math.floor(report.frameCount / 2)})+eq(n\\,${report.frameCount - 1})`,
        "-fps_mode",
        "passthrough",
        path.join(sampleDir, "sample-%02d.png"),
      ]);
      const bytes = fs.readFileSync(output);
      const loopExtension =
        format === "gif" && bytes.includes(Buffer.from("NETSCAPE2.0"));
      if (loopExtension)
        throw Error("GIF unexpectedly includes a repeating loop extension");
      report.outputs.push({
        format,
        file: output,
        sha256: hash(bytes),
        bytes: bytes.length,
        encodeMs,
        decodeMs: performance.now() - decodeAt,
        decodedFrameCount: count,
        decodedDuration,
        repeat: false,
        sampledFrames: fs.readdirSync(sampleDir).map((name) => ({
          file: path.join(sampleDir, name),
          sha256: hash(fs.readFileSync(path.join(sampleDir, name))),
        })),
      });
      save();
    }
    report.status = "completed";
  } catch (error) {
    report.status = "failed";
    report.findings.push({ kind: "motion-export-error", error: String(error) });
    if (activePage && !activePage.isClosed()) {
      try {
        await activePage.screenshot({
          path: path.join(out, "failed-render.png"),
          fullPage: true,
        });
      } catch {}
    }
  } finally {
    if (browser) await browser.close();
    report.wallMs = performance.now() - start;
    report.finishedAt = new Date().toISOString();
    save();
  }
  return report;
}

if (process.argv[1] === import.meta.filename) {
  const [file, previewDirectory, out, configFile] = process.argv.slice(2);
  if (!configFile)
    throw Error(
      "Usage: node tools/export_visualbook_motion.mjs book.html preview fresh-work-output motion.json",
    );
  const report = await exportMotion(
    file,
    previewDirectory,
    out,
    json(configFile),
  );
  console.log(
    JSON.stringify({
      status: report.status,
      frames: report.frames.length,
      wallMs: report.wallMs,
      outputs: report.outputs,
      findings: report.findings,
    }),
  );
  if (report.status !== "completed") process.exitCode = 1;
}
