/* Tiny deterministic routing examples; scores are supplied, never trained. */
(function (global) {
  function topKRoute({ scores, k = 1, temperature = 1, normalization = "selected" } = {}) {
    if (!Array.isArray(scores) || !scores.length || scores.length > 8 || !Array.isArray(scores[0]) ||
        scores[0].length < 2 || scores[0].length > 8 || scores.some(r => !Array.isArray(r) || r.length !== scores[0].length || !r.every(Number.isFinite)))
      throw Error("Router scores must be a finite 1..8 by 2..8 matrix");
    const experts = scores[0].length;
    if (!Number.isInteger(k) || k < 1 || k > experts || !Number.isFinite(temperature) || temperature <= 0 || !["selected","full"].includes(normalization))
      throw Error("Router needs integer k within expert count and positive temperature");
    const selected = [], weights = [], probability = [];
    for (const row of scores) {
      const order = row.map((_, i) => i).sort((a, b) => row[b] - row[a] || a - b), chosen = order.slice(0, k);
      const max = row[order[0]], shifted = row.map(s => (s - max) / temperature);
      if (!shifted.every(Number.isFinite)) throw Error("Router score scale overflow");
      const exp = shifted.map(Math.exp), sum = exp.reduce((a, b) => a + b, 0), selectedSum = chosen.reduce((a, i) => a + exp[i], 0);
      selected.push(chosen); probability.push(exp.map(x => x / sum));
      weights.push(exp.map((x, i) => chosen.includes(i) ? x / (normalization==="selected"?selectedSum:sum) : 0));
    }
    const counts = Array.from({ length: experts }, (_, i) => selected.filter(row => row.includes(i)).length);
    const weightedLoads = Array.from({ length: experts }, (_, i) => weights.reduce((sum, row) => sum + row[i], 0));
    return { scores: scores.map(r => [...r]), k, temperature, normalization, experts, tokens: scores.length, selected, probability, weights, counts, weightedLoads,
      weightSums:weights.map(row=>row.reduce((a,b)=>a+b,0)),
      assignments: counts.reduce((a, b) => a + b, 0),
      convention: "Stable lower-index tie break. Full softmax probabilities; "+(normalization==="selected"?"selected top-k weights renormalized to one per token.":"selected weights retain full-softmax probabilities without renormalization; retained mass can be below one.")+" Supplied scores only: not trained gates, capacity limits, dropped tokens, auxiliary loss or measured speed. Choose the convention explicitly for the architecture being explained." };
  }
  const api = { topKRoute };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.VisualBookRouting = api;
})(typeof window !== "undefined" ? window : globalThis);
