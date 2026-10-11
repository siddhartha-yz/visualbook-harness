/* One bounded recovery for Chromium's transient compositor capture error. */
export async function captureReaderPng(page, options, failures) {
  try { return await page.screenshot(options); }
  catch (error) {
    if (!String(error).includes("Page.captureScreenshot): Unable to capture screenshot")) throw error;
    failures.push({ path: options.path, error: String(error), attempt: 1,
      action: "One foreground/compositor-settle recovery; original failure retained. No layout/content rewrite." });
    await page.bringToFront();
    await page.waitForTimeout(250);
    return await page.screenshot(options); // A second failure remains fatal.
  }
}
