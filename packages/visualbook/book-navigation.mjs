/* Optional, deterministic navigation around already-reviewed chapter content. */
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const css=`.vh-book-header{flex-wrap:wrap}.vh-book-links{display:flex;flex-wrap:wrap;align-items:center;gap:8px 18px;margin-left:auto;font-size:13px}.vh-book-links span{color:var(--muted)}.vh-book-continue{max-width:720px;margin:15px auto 64px;padding:20px 0;border-top:1px solid #dce5e6;display:flex;gap:16px;align-items:baseline}.vh-book-continue span{color:var(--muted);font-size:13px;white-space:nowrap}@media(max-width:780px){.vh-book-links{flex-basis:100%;margin:4px 0 0}.vh-book-continue{margin:15px 12px 40px}}`;
export function bookNavigation(html, chapters, index) {
  if(!Array.isArray(chapters)||!chapters.length||!Number.isInteger(index)||index<0||index>=chapters.length||
    chapters.some(c=>!/^[a-z][a-z0-9-]*$/.test(c.id)||typeof c.title!=='string'))throw Error('Invalid chapter navigation');
  if((html.match(/<header>/g)??[]).length!==1||(html.match(/<\/main>/g)??[]).length!==1||(html.match(/<\/head>/g)??[]).length!==1)throw Error('Expected one generated header, head and main');
  const previous=chapters[index-1],next=chapters[index+1];
  const links=`<nav class="vh-book-links" aria-label="章节导航">${previous?`<a href="${previous.id}.html" rel="prev">← 上一章</a>`:''}<span>第 ${index+1} / ${chapters.length} 章</span>${next?`<a href="${next.id}.html" rel="next">下一章 →</a>`:''}</nav>`;
  const footer=`<nav class="vh-book-continue" aria-label="继续阅读">${next?`<span>接着读</span><a href="${next.id}.html" rel="next">${esc(next.title)} →</a>`:`<a href="index.html">返回目录 ↑</a>`}</nav>`;
  return html.replace('</head>',`<style data-book-navigation>${css}</style></head>`).replace(/<header>([\s\S]*?)<\/header>/,(_,body)=>`<header class="vh-book-header">${body}${links}</header>`).replace('</main>','</main>'+footer);
}
