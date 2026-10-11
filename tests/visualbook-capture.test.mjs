import assert from "node:assert/strict";
import { captureReaderPng } from "../tools/visualbook_capture.mjs";
const transient = new Error("Protocol error (Page.captureScreenshot): Unable to capture screenshot");
let calls = 0; const failures = [];
const page = { screenshot: async () => { if (++calls === 1) throw transient; return Buffer.from("png"); },
  bringToFront: async () => {}, waitForTimeout: async () => {} };
assert.deepEqual(await captureReaderPng(page, { path: "own.png" }, failures), Buffer.from("png"));
assert.equal(calls, 2); assert.equal(failures.length, 1); assert.match(failures[0].error, /Unable to capture/);
calls = 0; page.screenshot = async () => { calls++; throw transient; };
await assert.rejects(captureReaderPng(page, { path: "own.png" }, []), /Unable to capture/); assert.equal(calls, 2);
calls = 0; page.screenshot = async () => { calls++; throw Error("Source image could not decode"); };
await assert.rejects(captureReaderPng(page, { path: "own.png" }, []), /could not decode/); assert.equal(calls, 1);
