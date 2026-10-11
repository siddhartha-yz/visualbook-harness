/* Rasterize the actual serialized draw result without live SVG compositor history. */
export async function rasterSvg(page, svg, dimensions, filename) {
  const { width, height, background } = dimensions;
  if (![width, height].every(v => Number.isFinite(v) && v > 0 && v <= 4096))
    throw Error("SVG raster dimensions must be finite and bounded");
  await page.setViewportSize({ width: Math.ceil(width), height: Math.ceil(height) });
  await page.setContent('<!doctype html><html><body style="margin:0"><img alt="Actual serialized figure"></body></html>');
  await page.locator("img").evaluate((img, { source, width, height, background }) => {
    Object.assign(document.body.style, { backgroundColor: background });
    Object.assign(img.style, { display: "block", width: width + "px", height: height + "px" });
    img.src = source;
  }, { source: "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64"), width, height, background });
  let timer;
  try {
    await Promise.race([page.locator("img").evaluate(img => img.decode()),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error("SVG image decode timed out")), 10000); })]);
  } finally { clearTimeout(timer); }
  return await page.locator("img").screenshot({ path: filename, animations: "disabled" });
}
