import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {build, resolvePlan, validatePlan} from '../../../tools/visualbook.mjs';
import {importMarkdown} from '../import.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const dependencies = root + '/work/visualbook/runtime/node_modules';
const load = name => import(pathToFileURL(dependencies + '/' + name + '/index.js'));
const [{unified}, {default: remarkParse}, {default: remarkMath}, {parse, serialize}] =
  await Promise.all([load('unified'), load('remark-parse'), load('remark-math'),
    import(pathToFileURL(dependencies + '/parse5/dist/index.js'))]);
const parser = unified().use(remarkParse).use(remarkMath);
export const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
function walk(node, fn) { fn(node); for (const child of node.children ?? node.childNodes ?? []) walk(child, fn); }
export function formulas(markdown) {
  const result = [];
  walk(parser.parse(markdown), node => { if (['math', 'inlineMath'].includes(node.type)) result.push(node.value.trim()); });
  return result;
}
export function htmlFormulas(html) {
  const document = parse(html), result = [];
  const text = node => node.nodeName === '#text' ? node.value : (node.childNodes ?? []).map(text).join('');
  walk(document, node => {
    if (node.tagName !== 'main') return;
    walk(node, child => {
      if (child.tagName === 'span' && child.attrs?.some(a => a.name === 'class' && a.value.split(' ').includes('math'))) {
        const value = text(child).trim();
        if (!/^\\[([]/.test(value) || !/\\[)\]]$/.test(value)) throw Error('Unexpected native math delimiters');
        result.push(value.slice(2, -2).trim());
      }
    });
  });
  return result;
}
/* Pandoc removes Markdown line indentation in math. Admit that one layout
   change only outside protected text arguments; retain literal differences.
   Macro/catcode definitions have whitespace-dependent semantics: refuse them. */
export function mathIndentation(value) {
  if (/\\(?:verb|def|gdef|edef|newcommand|renewcommand|providecommand|catcode|csname|colorbox|fcolorbox)\b/.test(value)) return value;
  const protectedGroups = [false];
  let result = '', textArgument = false;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === '\\') {
      const command = value.slice(i + 1).match(/^[A-Za-z]+/);
      if (command) {
        result += '\\' + command[0]; i += command[0].length;
        textArgument = command[0].startsWith('text') || ['mbox', 'hbox', 'operatorname'].includes(command[0]);
      } else { result += char + (value[++i] ?? ''); textArgument = false; }
    } else if (char === '{') {
      protectedGroups.push(protectedGroups.at(-1) || textArgument); textArgument = false; result += char;
    } else if (char === '}') {
      if (protectedGroups.length > 1) protectedGroups.pop(); textArgument = false; result += char;
    } else if (char === '\n' && !protectedGroups.at(-1)) {
      result += char;
      while (/[ \t]/.test(value[i + 1] ?? '') && i + 1 < value.length) i++;
    } else {
      result += char;
      if (!/[ \t\n*]/.test(char)) textArgument = false;
    }
  }
  return result;
}
export function compareFormulas(expected, actual) {
  const differences = [], indentationChanges = [];
  for (let index = 0; index < Math.max(expected.length, actual.length); index++) {
    if (expected[index] === actual[index]) continue;
    const change = {index, expected: expected[index], actual: actual[index]};
    if (typeof expected[index] === 'string' && typeof actual[index] === 'string' &&
        mathIndentation(expected[index]) === mathIndentation(actual[index])) indentationChanges.push(change);
    else differences.push(change);
  }
  return {accepted: !differences.length, exactOrderedTex: !differences.length && !indentationChanges.length,
    indentationChanges, differences};
}
export function insertAtAnchors(raw, source, entries) {
  const lines = [...raw.matchAll(/^/gm)].map(match => match.index);
  const grouped = new Map();
  for (const entry of entries) {
    const block = source.blocks.find(block => block.id === entry.anchor);
    if (!block || !Number.isInteger(block.line)) throw Error('Unknown original anchor: ' + entry.anchor);
    const start = lines[block.line - 1];
    if (raw.slice(start, start + block.raw.length) !== block.raw || sha(block.raw) !== block.sha256)
      throw Error('Original anchor text/position changed: ' + entry.anchor);
    const offset = start + block.raw.length;
    grouped.set(offset, (grouped.get(offset) ?? '') + entry.markdown);
  }
  let expanded = raw;
  for (const [offset, markdown] of [...grouped].sort((a, b) => b[0] - a[0]))
    expanded = expanded.slice(0, offset) + markdown + expanded.slice(offset);
  let recovered = expanded;
  let added = 0;
  for (const [offset, markdown] of [...grouped].sort((a, b) => a[0] - b[0])) {
    const position = offset + added;
    if (expanded.slice(position, position + markdown.length) !== markdown) throw Error('Insertion position drift');
    added += markdown.length;
  }
  // Removing insertions in reverse offset order recovers original bytes.
  for (const [offset, markdown] of [...grouped].sort((a, b) => b[0] - a[0])) {
    const before = [...grouped].filter(([other]) => other < offset).reduce((sum, [, value]) => sum + value.length, 0);
    recovered = recovered.slice(0, offset + before) + recovered.slice(offset + before + markdown.length);
  }
  if (recovered !== raw) throw Error('Original Markdown changed during assembly');
  return expanded;
}
function asset(out, bytes, extension) {
  const name = 'visualbook-' + sha(bytes).slice(0, 20) + extension;
  const target = out + '/assets/' + name;
  if (fs.existsSync(target) && sha(fs.readFileSync(target)) !== sha(bytes)) throw Error('Asset hash collision');
  fs.writeFileSync(target, bytes);
  return name;
}
function widget(out, source, figure, widgetId) {
  const block = source.blocks.find(block => block.id === figure.afterAnchor);
  // The complete plan is validated before this isolated rendering. Scope end is
  // narrowed only in the empty-text widget, never in the parent source/plan.
  const single = {...figure, endAnchor: figure.afterAnchor};
  const small = {...source, blocks: [{...block, html: '', math: {expected: 0, rendered: 0}}]};
  const document = parse(build(small, {figures: [single], annotations: []}));
  function trim(node) {
    if (!node.childNodes) return;
    node.childNodes = node.childNodes.filter(child => child.tagName !== 'header' && !child.attrs?.some(a =>
      a.name === 'class' && a.value.split(' ').some(c => ['vh-opening', 'source-block'].includes(c))));
    node.childNodes.forEach(trim);
  }
  trim(document);
  const styles = [], scripts = [];
  walk(document, node => { if (node.tagName === 'style') styles.push(node); if (node.tagName === 'script') scripts.push(node); });
  if (styles.length !== 1 || scripts.length !== 1) throw Error('Shared build output changed; adapt widget extraction explicitly');
  const style = styles[0].childNodes.map(node => node.value ?? '').join('');
  const script = scripts[0].childNodes.map(node => node.value ?? '').join('');
  const marker = `VisualBookRuntime.mount(document.getElementById('figure-${figure.id}')`;
  const offset = script.indexOf(marker);
  if (offset < 0 || script.indexOf(marker, offset + 1) >= 0) throw Error('Ambiguous figure startup');
  const css = asset(out, style, '.css'), js = asset(out, script.slice(0, offset), '.js');
  let html = serialize(document).replace('<style>' + style + '</style>', `<link rel="stylesheet" href="../assets/${css}">`);
  html = html.replace('<script>' + script + '</script>', `<script src="../assets/${js}"></script><script>${script.slice(offset)}</script>`);
  // Externalize our generated output assets, leaving upstream code unchanged.
  html = html.replace("script-src 'unsafe-inline'", "script-src 'self' 'unsafe-inline'")
    .replace("style-src 'unsafe-inline'", "style-src 'self' 'unsafe-inline'");
  const extra = `<style>body{background:transparent;margin:0}main{display:block!important;max-width:none!important;margin:0!important;padding:0!important}.vh-figure{margin:0!important;padding:12px 8px!important}.vh-anchor-row{display:block!important}</style><script>
  const reportHeight=()=>parent.postMessage({type:'visualbook-widget-size',id:${JSON.stringify(widgetId)},height:Math.ceil(document.body.scrollHeight)},location.origin);
  new ResizeObserver(reportHeight).observe(document.body);addEventListener('load',reportHeight);
  addEventListener('message',e=>{if(e.source===parent&&e.origin===location.origin&&e.data?.type==='visualbook-reader-pause')VisualBookRuntime.pauseAll()});
  </script>`;
  html = html.replace('</body>', extra + '</body>');
  if (html.includes('<style>' + style) || html.includes('<script>' + script)) throw Error('Asset extraction failed');
  fs.writeFileSync(out + '/widgets/' + widgetId + '.html', html);
  return {id: widgetId, figure: figure.id, sha256: sha(html), css, js,
    sourceAnchor: figure.afterAnchor, placement: figure.placement ?? 'body', interaction: figure.interaction ?? 'timeline'};
}
export function prepareQuarto(manifestFile, output, {mathjax, draft = false} = {}) {
  const base = path.dirname(path.resolve(manifestFile)), manifest = read(manifestFile), out = path.resolve(output);
  if (fs.existsSync(out)) throw Error('Use a fresh Quarto project directory; revisions must not overwrite prior results');
  if (!Array.isArray(manifest.chapters) || !manifest.chapters.length || manifest.chapters.length > 32) throw Error('Use 1..32 chapters');
  const ids = manifest.chapters.map(c => c.id);
  if (new Set(ids).size !== ids.length || ids.some(id => !/^[a-z][a-z0-9-]*$/.test(id))) throw Error('Invalid/duplicate chapter id');
  const groups = manifest.groups ?? [{title: '正文', chapters: ids}];
  const covered = groups.flatMap(group => group.chapters);
  if (JSON.stringify(covered) !== JSON.stringify(ids)) throw Error('Groups must cover every chapter once in original order');
  const resolve = file => path.resolve(base, file);
  const inputs = manifest.chapters.map(chapter => {
    const sourceFile = resolve(chapter.source), planFile = resolve(chapter.plan);
    const source = sourceFile.endsWith('.json') ? read(sourceFile) : importMarkdown(sourceFile, {id: chapter.id, sourceName: chapter.sourceName, sourceUrl: chapter.sourceUrl});
    if (!source.source || path.extname(source.source).toLowerCase() !== '.md') throw Error('This adapter requires original standard Markdown; other source adapters need an explicit migration');
    const raw = fs.readFileSync(source.source, 'utf8'), plan = read(planFile);
    if (sha(raw) !== source.sourceSha256) throw Error('Original Markdown identity changed: ' + chapter.id);
    validatePlan(source, plan);
    walk(parser.parse(raw), node => { if (['image', 'imageReference', 'html', 'yaml'].includes(node.type)) throw Error('Local images/raw HTML/front matter need an explicit asset adapter: ' + chapter.id); });
    const sourceFileSha256 = sha(fs.readFileSync(sourceFile)), planFileSha256 = sha(fs.readFileSync(planFile));
    let review = null;
    if (chapter.review) {
      review = read(resolve(chapter.review));
      if (review.readyForReader !== true || review.sourceFileSha256 !== sourceFileSha256 || review.planFileSha256 !== planFileSha256 || !Array.isArray(review.blockingIssues) || review.blockingIssues.length)
        throw Error('Missing/stale/blocked reader acceptance: ' + chapter.id);
    } else if (!draft) throw Error('Final export requires explicit source/plan-bound reader review: ' + chapter.id);
    return {chapter, sourceFile, planFile, source, raw, plan, review, sourceFileSha256, planFileSha256};
  });
  if (!mathjax || !fs.existsSync(path.resolve(mathjax, 'tex-svg-full.js'))) throw Error('Supply a pinned local full SVG MathJax distribution');
  fs.mkdirSync(out, {recursive: true}); fs.mkdirSync(out + '/assets'); fs.mkdirSync(out + '/widgets'); fs.mkdirSync(out + '/downloads');
  const record = {status: 'prepared', draft, modelCalls: 0, manifestSha256: sha(fs.readFileSync(manifestFile)),
    scope: 'Source-preserving Quarto assembly of supplied plans; explicit review identities, not automatic mathematical/artistic truth or model-generation success.', chapters: []};
  const fence = String.fromCharCode(96).repeat(3);
  for (const input of inputs) {
    const {chapter, source, raw, plan} = input, resolved = resolvePlan(plan), entries = [], widgets = [];
    for (const figure of resolved.figures) {
      const id = chapter.id + '-' + figure.id;
      widgets.push(widget(out, source, figure, id));
      const column = figure.placement === 'wide' ? 'column-page' : figure.placement === 'margin' ? 'column-margin' : 'column-body';
      const height = Math.max(figure.height ?? 320, figure.mobileHeight ?? 320) + 160;
      const html = `<div class="visualbook-embed ${column}"><iframe class="visualbook-widget" id="${id}" title="${escape(figure.title)}" src="widgets/${id}.html" style="height:${height}px" loading="lazy"></iframe><a class="visualbook-open" href="widgets/${id}.html" target="_blank" rel="noopener">单独打开图解 ↗</a></div>`;
      entries.push({anchor: figure.afterAnchor, markdown: `\n\n${fence}{=html}\n${html}\n${fence}\n\n`});
    }
    for (const note of plan.annotations ?? []) {
      const title = {condition: '适用条件', clarification: '补充说明', correction: '勘误'}[note.kind];
      const text = note.text.replace(/[\\`*_{}\[\]<>#$]/g, '\\$&');
      entries.push({anchor: note.afterAnchor, markdown: `\n\n::: {.callout-note}\n## ${title}\n${text}\n${note.formula ? '\n$$\n' + note.formula + '\n$$\n' : ''}:::\n\n`});
    }
    const expanded = insertAtAnchors(raw, source, entries);
    fs.writeFileSync(out + '/' + chapter.id + '.qmd', expanded);
    fs.writeFileSync(out + '/downloads/' + chapter.id + '.md', raw);
    record.chapters.push({id: chapter.id, title: source.title, sourceFile: input.sourceFile, planFile: input.planFile,
      sourceFileSha256: input.sourceFileSha256, planFileSha256: input.planFileSha256,
      originalMarkdownSha256: sha(raw), expandedSha256: sha(expanded), originalTextPreserved: true,
      sourceFormulas: formulas(raw), expectedFormulas: formulas(expanded), widgets, review: chapter.review ?? null});
  }
  fs.cpSync(path.resolve(mathjax), out + '/assets/mathjax', {recursive: true});
  fs.mkdirSync(out + '/licenses');
  const licenses = [['MathJax', path.resolve(mathjax, '../LICENSE')],
    ['D3', dependencies + '/d3/LICENSE'], ['KaTeX', dependencies + '/katex/LICENSE'],
    ['Dagre', dependencies + '/@dagrejs/dagre/LICENSE'], ['Graphlib', dependencies + '/@dagrejs/graphlib/LICENSE']];
  for (const [name, file] of licenses) fs.copyFileSync(file, out + '/licenses/' + name + '.txt');
  fs.copyFileSync(import.meta.dirname + '/reader.css', out + '/reader.css');
  fs.copyFileSync(import.meta.dirname + '/reader.js', out + '/reader.js');
  fs.writeFileSync(out + '/reader-include.html', '<script src="reader.js"></script>\n');
  const description = manifest.description ?? '根据视频课程整理的可视化教材。';
  const cover = `${description}\n\n${draft ? '**图解补齐中的检查稿，尚未整书验收。**\n\n' : ''}正文保留完整论证；图解在对应段落后，可直接阅读，有需要时再播放或探索。\n\n[下载整本 Markdown 教材](downloads/textbook.md)\n\n`;
  fs.writeFileSync(out + '/index.qmd', cover + groups.map(group => `## ${group.title}\n\n${group.chapters.map(id => `- [${record.chapters.find(c => c.id === id).title}](${id}.qmd)`).join('\n')}\n`).join('\n'));
  fs.writeFileSync(out + '/downloads/textbook.md', manifest.chapters.map(chapter => inputs.find(input => input.chapter.id === chapter.id).raw).join('\n\n---\n\n'));
  const config = {project: {type: 'book', resources: ['widgets/**', 'assets/**', 'downloads/**', 'licenses/**', 'reader.js']},
    book: {title: manifest.title, search: true, chapters: ['index.qmd', ...groups.map(group => ({part: group.title, chapters: group.chapters.map(id => id + '.qmd')}))]},
    lang: 'zh', format: {html: {theme: 'cosmo', css: 'reader.css', 'number-sections': false, toc: true,
      'html-math-method': {method: 'mathjax', url: 'assets/mathjax/tex-svg-full.js'}, 'include-after-body': 'reader-include.html'}}, execute: {enabled: false}};
  fs.writeFileSync(out + '/_quarto.yml', JSON.stringify(config, null, 2) + '\n');
  record.mathjaxBundleSha256 = sha(fs.readFileSync(out + '/assets/mathjax/tex-svg-full.js'));
  fs.writeFileSync(out + '/assembly-record.json', JSON.stringify(record, null, 2) + '\n');
  return record;
}
