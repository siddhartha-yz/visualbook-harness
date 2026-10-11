/* Presentation policy, separate from the diagram's numerical mechanism. */
(function (global) {
  function readingSpec(figure) {
    const placement = figure.placement ?? "body";
    const presentation = figure.presentation ?? "reading";
    const marginSide = figure.marginSide ?? "right";
    if (!["body", "wide", "margin"].includes(placement))
      throw Error("Placement must be body, wide or margin");
    if (!["reading", "exploration"].includes(presentation))
      throw Error("Presentation must be reading or exploration");
    if (placement === "margin" && presentation === "exploration")
      throw Error("Margin figures need a quiet reading presentation");
    if (!["left", "right"].includes(marginSide) || (figure.marginSide !== undefined && placement !== "margin"))
      throw Error("A margin side requires margin placement and left/right");
    return { placement, presentation, marginSide };
  }
  const api = { readingSpec };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.VisualBookReading = api;
})(typeof window !== "undefined" ? window : globalThis);
