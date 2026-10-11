/* Two-column weighted flows. No general graph layout or inferred routing. */
(function (global) {
  const V = global.VisualBook, P = V.palette;
  function ribbonFlow(board, { matrix, sources, targets, colors = ["blue", "orange", "green", "violet", "muted", "ink"] } = {}) {
    if (!Array.isArray(matrix) || !matrix.length || matrix.length > 6 || !Array.isArray(matrix[0]) || !matrix[0].length || matrix[0].length > 6 ||
        matrix.some(r => !Array.isArray(r) || r.length !== matrix[0].length || r.some(v => !Number.isFinite(v) || v < 0)))
      throw Error("Flow matrix must be finite nonnegative 1..6 by 1..6");
    const n = matrix.length, m = matrix[0].length;
    if (!Array.isArray(sources) || !Array.isArray(targets) || sources.length !== n || targets.length !== m ||
        [...sources, ...targets].some(s => typeof s !== "string" || !s.trim() || s.length > 12) ||
        !Array.isArray(colors) || colors.length < m || colors.slice(0, m).some(c => !Object.hasOwn(P, c)))
      throw Error("Provide one short source/target name and known color per target");
    const rowTotals = matrix.map(r => r.reduce((a, b) => a + b, 0)), colTotals = Array.from({ length: m }, (_, j) => matrix.reduce((s, r) => s + r[j], 0)), total = rowTotals.reduce((a, b) => a + b, 0);
    if (!Number.isFinite(total) || total <= 0 || matrix.flat().filter(v => v > 0).length > 18)
      throw Error("Flow needs positive finite total and at most 18 nonzero ribbons");
    const leftLabel = Math.max(...sources.map(s => V.measure(s, 13))) + 14;
    const rightLabel = Math.max(...targets.map(s => V.measure(s, 13))) + 14;
    const x0 = leftLabel + 12, x1 = board.width - rightLabel - 12, top = 18, bottom = board.height - 32, gap = 14, pad = 10;
    const scale = Math.min((bottom - top - gap * (n - 1) - 2 * pad * n) / total,
      (bottom - top - gap * (m - 1) - 2 * pad * m) / total);
    if (x1 - x0 < 100 || !Number.isFinite(scale) || scale <= 0)
      throw Error("Flow needs more space or fewer/smaller labels");
    if (matrix.flat().some(v => v > 0 && v * scale < .5))
      throw Error("Flow contains subpixel positive ribbons; use a table/bar comparison or a less dense example");
    function positions(totals) {
      const used = total * scale + 2 * pad * totals.length + gap * (totals.length - 1);
      let y = top + (bottom - top - used) / 2;
      return totals.map(value => { const p = { y, height: value * scale + 2 * pad, next: y + pad }; y += p.height + gap; return p; });
    }
    const a = positions(rowTotals), b = positions(colTotals), edgeFacts = [];
    // Fixed source/target order keeps graph identity and comparisons stable.
    matrix.forEach((row, i) => row.forEach((value, j) => {
      if (!value) return;
      const y0 = a[i].next, y1 = b[j].next, thickness = value * scale, c0 = x0 + (x1 - x0) * .45, c1 = x1 - (x1 - x0) * .45;
      const d = `M${x0},${y0}C${c0},${y0} ${c1},${y1} ${x1},${y1}L${x1},${y1 + thickness}C${c1},${y1 + thickness} ${c0},${y0 + thickness} ${x0},${y0 + thickness}Z`;
      board.svgPath("flow-" + i + "-" + j, d, { fill: P[colors[j]], opacity: .22, color: "none", width: 0 });
      a[i].next += thickness; b[j].next += thickness;
      edgeFacts.push({ source: i, target: j, value, thickness });
    }));
    a.forEach((p, i) => { board.rect("source-" + i, x0 - 5, p.y, 5, p.height, P.muted); board.text("source-label-" + i, sources[i], x0 - 12, p.y + p.height / 2 + 4, { size: 13, anchor: "end", halo: false }); });
    b.forEach((p, i) => { board.rect("target-" + i, x1, p.y, 5, p.height, P[colors[i]]); board.text("target-label-" + i, targets[i], x1 + 12, p.y + p.height / 2 + 4, { size: 13, halo: false }); });
    board.text("scale", "粗细 ∝ 数量", 12, board.height - 9, { size: 12, color: P.muted, halo: false });
    return { matrix, sources, targets, rowTotals, colTotals, total, scale, edges: edgeFacts,
      convention: "All ribbon thicknesses use one numeric scale; node bars include padding and do not encode pure totals. Two supplied columns only; crossings do not imply dependencies or physical network paths." };
  }
  function groupMap(board,{sources,targets,assignment,sourceTitle="输入",targetTitle="共享对象",highlight=null}={}){
    if(!Array.isArray(sources)||!Array.isArray(targets)||!sources.length||sources.length>8||!targets.length||targets.length>8||
      [...sources,...targets].some(s=>typeof s!=="string"||!s.trim()||s.length>8)||
      !Array.isArray(assignment)||assignment.length!==sources.length||assignment.some(j=>!Number.isInteger(j)||j<0||j>=targets.length)||
      highlight!==null&&(!Number.isInteger(highlight)||highlight<0||highlight>=targets.length)||
      [sourceTitle,targetTitle].some(s=>typeof s!=="string"||s.length>32))throw Error("Group map needs 1..8 short source/target identities and one valid target index per source");
    if(board.height<160||board.width<250)throw Error("Group map needs 250×160 space");
    const margin=14,span=board.width-2*margin,top=40,bottom=board.height-68,h=30;
    function row(labels,y,prefix){const step=span/labels.length,w=Math.min(72,step-4);
      if(labels.some(s=>V.measure(s,12)>w-4))throw Error("Group labels need more width; use short identities or fewer nodes");
      return labels.map((label,i)=>{const x=margin+(i+.5)*step;return{x,y,w,label,i,prefix};});}
    const a=row(sources,top,"source"),b=row(targets,bottom,"target"),counts=targets.map((_,j)=>assignment.filter(x=>x===j).length);
    const bend=Math.min(36,(bottom-top-h)/2);
    assignment.forEach((j,i)=>{const active=highlight===null||highlight===j;board.svgPath("group-link-"+i,`M${a[i].x},${top+h}C${a[i].x},${top+h+bend} ${b[j].x},${bottom-bend} ${b[j].x},${bottom}`,{color:active?P.blue:P.faint,width:active?2:1,opacity:active ? .6 : .4});});
    for(const node of [...a,...b]){
      const active=highlight===null||(node.prefix==="source"?assignment[node.i]===highlight:node.i===highlight),color=node.prefix==="source"?P.blue:P.orange;
      board.rect(node.prefix+"-card-"+node.i,node.x-node.w/2,node.y,node.w,h,P.paper,{rx:4,stroke:active?color:P.faint,"stroke-width":1.3});
      board.text(node.prefix+"-label-"+node.i,node.label,node.x,node.y+20,{size:12,anchor:"middle",color:active?P.ink:P.muted,halo:false});
    }
    board.text("source-title",sourceTitle,12,20,{size:13,color:P.muted,halo:false});
    board.text("target-title",targetTitle,12,board.height-16,{size:13,color:P.muted,halo:false});
    return{sources,targets,assignment,counts,highlight,convention:"Explicit many-to-one identities; links indicate association, not attention weights, projection matrices, physical traffic or measured speed. Source order stays fixed."};
  }
  function headSharing(board,{queryHeads=8,kvHeads=4,title=""}={}){
    if(!Number.isInteger(queryHeads)||queryHeads<1||queryHeads>8||typeof title!=="string"||title.length>32)throw Error("Head sharing visual supports 1..8 Query heads and a short title");
    const budget=global.VisualBookCalculations.compute("cache-footprint",{queryHeads,kvHeads,layers:1,batch:1,tokens:1,headDim:1,bytesPerElement:1}).result;
    const assignment=Array.from({length:queryHeads},(_,i)=>Math.floor(i/budget.queryHeadsPerKV));
    const result=groupMap(board,{sources:assignment.map((_,i)=>"Q"+i),targets:Array.from({length:kvHeads},(_,i)=>"KV"+i),assignment,
      sourceTitle:title||queryHeads+" 个 Query 头",targetTitle:kvHeads+" 对 K/V · 每对供 "+budget.queryHeadsPerKV+" 个 Q 引用"});
    return{...result,queryHeads,kvHeads,queryHeadsPerKV:budget.queryHeadsPerKV,cacheRatio:kvHeads/queryHeads,
      convention:"Contiguous equal Query-head groups, one K and one V per group. References show shared KV identity, not learned parameters, attention scores, uptraining or accuracy/speed guarantees."};
  }
  Object.assign(V.components, { "ribbon-flow": ribbonFlow, "group-map":groupMap, "head-sharing":headSharing });
})(window);
