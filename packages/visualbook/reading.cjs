/* Presentation policy, separate from the diagram's numerical mechanism. */
(function (global) {
  function readingSpec(figure) {
    const placement = figure.placement ?? "body";
    const presentation = figure.presentation ?? "reading";
    const marginSide = figure.marginSide ?? "auto";
    if (!["body", "wide", "margin"].includes(placement))
      throw Error("Placement must be body, wide or margin");
    if (!["reading", "exploration"].includes(presentation))
      throw Error("Presentation must be reading or exploration");
    if (placement === "margin" && presentation === "exploration")
      throw Error("Margin figures need a quiet reading presentation");
    if (figure.marginSide !== undefined && (!["left", "right"].includes(marginSide) || placement !== "margin"))
      throw Error("A margin side requires margin placement and left/right");
    return { placement, presentation, marginSide };
  }
  function assignMarginSides(entries) {
    const result = new Map(), ordered = [...entries].sort((a,b)=>a.anchorIndex-b.anchorIndex);
    let next = "right";
    for(let start=0;start<ordered.length;) {
      let end=start+1;while(end<ordered.length&&ordered[end].anchorIndex===ordered[start].anchorIndex)end++;
      const group=ordered.slice(start,end),counts={left:0,right:0};
      for(const {item}of group)if(item.marginSide){result.set(item,item.marginSide);counts[item.marginSide]++;}
      for(const {item}of group)if(!item.marginSide){
        const side=counts.left===counts.right?next:counts.left<counts.right?"left":"right";
        result.set(item,side);counts[side]++;next=side==="right"?"left":"right";
      }
      start=end;
    }
    return result;
  }
  const api = { readingSpec, assignMarginSides };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.VisualBookReading = api;
})(typeof window !== "undefined" ? window : globalThis);
