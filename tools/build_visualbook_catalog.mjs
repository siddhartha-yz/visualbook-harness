import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { build, preview, staticExport } from "./visualbook.mjs";
const root = path.resolve(import.meta.dirname, "..");
const esc = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
function catalogIndex(records) {
  const categories = ["全部", "数学", "机器学习", "深度学习", "编程"];
  const cards = records
    .map(
      (r) =>
        `<article class="design" data-search="${esc([r.title, r.topic, r.keywords ?? ""].join(" ").toLowerCase())}" data-topic="${esc(r.topic)}"><a href="${r.findings.length ? "#" : esc(r.id + ".html")}"${r.findings.length ? ' aria-disabled="true"' : ""}><div class="thumb">${r.findings.length ? "<span>此次构建未通过</span>" : `<img loading="lazy" src="evidence/${r.id}/static/1280-${r.id}.svg" alt="${esc(r.title)}的初始画面">`}</div><p class="topic">${esc(r.topic)}</p><h2>${esc(r.title)}</h2></a><p class="limits">${esc(r.limits)}</p><details><summary>查看拼接方式</summary><pre>${esc(JSON.stringify({ interaction: r.interaction ?? "timeline", params: r.params, state: r.state, scene: r.scene, ...(r.code ? { code: r.code } : {}) }, null, 2))}</pre><a href="sources/${r.id}/plan.json">完整计划</a> · <a href="evidence/${r.id}/report.json">渲染记录</a></details></article>`,
    )
    .join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'"><title>VisualBook · 设计积木</title><style>:root{--paper:#faf9f5;--ink:#263b43;--muted:#606f76;--line:#dce5e6;--blue:#337a98;--orange:#a8502f}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.7 system-ui,'Noto Sans CJK SC',sans-serif}main{max-width:1220px;margin:auto;padding:56px 36px 90px}a{color:var(--blue);text-underline-offset:4px}.eyebrow,.topic{font-size:12px;color:var(--orange);letter-spacing:.06em}h1{font-size:clamp(32px,5vw,50px);line-height:1.22;font-weight:600;letter-spacing:-.03em;margin:12px 0 24px}.intro{max-width:670px;color:var(--muted);margin:0 0 32px}.filters{display:flex;gap:8px;align-items:center;flex-wrap:wrap;border-block:1px solid var(--line);padding:20px 0;margin-bottom:34px}.filters button{background:transparent;border:1px solid transparent;color:var(--muted);padding:8px 12px;border-radius:5px;cursor:pointer;font:14px system-ui}.filters button[aria-pressed=true]{border-color:var(--line);color:var(--ink);background:#efeee8}.filters input{margin-left:auto;min-width:220px;background:transparent;color:var(--ink);border:0;border-bottom:1px solid var(--line);padding:10px 4px;font:14px system-ui}button:focus-visible,a:focus-visible,input:focus-visible,summary:focus-visible{outline:2px solid var(--orange);outline-offset:4px}.count{font-size:13px;color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:38px 30px}.design[hidden]{display:none}.design>a{text-decoration:none;color:inherit;display:block}.thumb{height:190px;display:flex;align-items:center;justify-content:center;border-bottom:1px solid var(--line);margin-bottom:20px}.thumb img{width:100%;height:100%;object-fit:contain}.topic{margin:0 0 8px;color:var(--muted)}h2{font-size:19px;line-height:1.5;font-weight:550;margin:0 0 10px}.design>a:hover h2{color:var(--blue)}.limits{font-size:13px;color:var(--muted);margin:0 0 14px}.design details{font-size:13px}summary{cursor:pointer;color:var(--blue)}pre{font:12px/1.65 ui-monospace,monospace;white-space:pre;overflow:auto;background:#efeee8;padding:14px;border-radius:3px;max-height:320px}footer{border-top:1px solid var(--line);font-size:13px;color:var(--muted);margin-top:56px;padding-top:20px}@media(max-width:600px){main{padding:32px 20px 60px}.filters input{width:100%;margin:8px 0 0}.grid{grid-template-columns:1fr;gap:30px}.thumb{height:210px}}</style></head><body><main><div class="eyebrow">VISUALBOOK · 设计积木</div><h1>选一种关系，<br>把它接进教材。</h1><p class="intro">图形、计算、交互分开复用。同一份输入可以连接多个画面；读者自己拖动、逐步查看或主动播放。</p><div class="filters" role="group" aria-label="筛选设计">${categories.map((c, i) => `<button type="button" aria-pressed="${i === 0}" data-category="${c}">${c}</button>`).join("")}<input type="search" aria-label="搜索设计" placeholder="试试：梯度、索引、概率…"></div><p class="count" aria-live="polite">${records.length} 种设计</p><section class="grid" aria-label="可复用设计">${cards}</section><footer>这些是维护者编写的可执行示例。渲染检查覆盖有限的尺寸、进度和参数；挑设计时仍需确认它是否准确解释当前概念。</footer></main><script>(()=>{let category='全部';const input=document.querySelector('input'),buttons=[...document.querySelectorAll('[data-category]')],cards=[...document.querySelectorAll('.design')];const filter=()=>{const query=input.value.trim().toLowerCase();let count=0;for(const card of cards){card.hidden=!(card.dataset.search.includes(query)&&(category==='全部'||card.dataset.topic.includes(category)));if(!card.hidden)count++;}document.querySelector('.count').textContent=count+' / '+cards.length+' 种设计';};input.addEventListener('input',filter);for(const button of buttons)button.addEventListener('click',()=>{category=button.dataset.category;buttons.forEach(b=>b.setAttribute('aria-pressed',String(b===button)));filter();});})();</script></body></html>`;
}
export async function buildCatalog(out, { ids = null } = {}) {
  const catalog = JSON.parse(
      fs.readFileSync(path.join(root, "packages/visualbook/catalog.json")),
    ),
    designs = ids
      ? catalog.designs.filter((d) => ids.includes(d.id))
      : catalog.designs;
  if (
    ids &&
    (new Set(ids).size !== ids.length ||
      ids.some((id) => !catalog.designs.some((d) => d.id === id)))
  )
    throw Error("Unknown or duplicate design selection");
  if (fs.existsSync(out))
    throw Error("Catalog evidence exists; use a fresh directory");
  fs.mkdirSync(out, { recursive: true });
  const records = [];
  for (const design of designs) {
    // Catalogue search metadata is not part of the figure's executable inputs.
    const {topic,limits,keywords,...figure} = design;
    const blocks = [
      {
        id: "design-001",
        raw: design.limits,
        type: "paragraph",
        sha256: "maintenance-control",
        html: `<p>${esc(design.limits)}</p>`,
        math: { expected: 0 },
      },
    ];
    const source = {
        title: design.title,
        sourceName: "维护者编写的共享设计示例",
        sourceUrl: "https://github.com/siddhartha-yz/visualbook-harness",
        sourceSha256: "maintenance-control",
        blocks,
      },
      plan = {
        figures: [
          {
            ...figure,
            afterAnchor: "design-001",
            summary: design.summary ?? design.limits,
          },
        ],
      },
      file = path.join(out, design.id + ".html"),
      sourceDirectory = path.join(out, "sources", design.id),
      rawFile = path.join(sourceDirectory, "book.html"),
      evidence = path.join(out, "evidence", design.id);
    fs.mkdirSync(sourceDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(sourceDirectory, "source.json"),
      JSON.stringify(source, null, 2) + "\n",
    );
    fs.writeFileSync(
      path.join(sourceDirectory, "plan.json"),
      JSON.stringify(plan, null, 2) + "\n",
    );
    try {
      const html = build(source, plan);
      fs.writeFileSync(rawFile, html);
      const report = await preview(rawFile, evidence);
      const exported = !report.findings.length
        ? staticExport(rawFile, evidence, file)
        : null;
      records.push({
        ...design,
        file,
        rawFile,
        sourceDirectory,
        evidence,
        findings: report.findings,
        rawSha256: sha(html),
        exported,
      });
    } catch (error) {
      records.push({
        ...design,
        file,
        rawFile,
        sourceDirectory,
        evidence,
        findings: [{ kind: "catalog-build-error", error: String(error) }],
        exported: null,
      });
    }
    fs.writeFileSync(
      path.join(out, "catalog-record.json"),
      JSON.stringify(
        {
          kind: "maintenance-authored reusable designs, not generated books",
          modelCalls: 0,
          records,
        },
        null,
        2,
      ) + "\n",
    );
  }
  fs.writeFileSync(
    path.join(out, "catalog-record.json"),
    JSON.stringify(
      {
        kind: "maintenance-authored reusable designs, not generated books",
        modelCalls: 0,
        records,
      },
      null,
      2,
    ) + "\n",
  );
  fs.writeFileSync(path.join(out, "index.html"), catalogIndex(records));
  return records;
}
if (process.argv[1] === import.meta.filename) {
  const records = await buildCatalog(path.resolve(process.argv[2]), {
    ids: process.argv.length > 3 ? process.argv.slice(3) : null,
  });
  console.log(
    JSON.stringify(
      records.map((r) => ({ id: r.id, findings: r.findings.length })),
    ),
  );
  if (records.some((r) => r.findings.length)) process.exitCode = 1;
}
