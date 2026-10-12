#!/usr/bin/env node
/* Standard Markdown + source-bound diagram plans -> a local Quarto book.
   Original author outputs remain untouched; final export requires explicit
   reader review identities. These are engineering gates, not teaching scores. */
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {prepareQuarto, htmlFormulas, compareFormulas, sha} from '../packages/visualbook/quarto/export.mjs';

const argv = process.argv.slice(2), options = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (['--draft', '--prepare-only'].includes(argv[i])) options[argv[i].slice(2)] = true;
  else if (['--quarto', '--mathjax'].includes(argv[i])) options[argv[i].slice(2)] = argv[++i];
  else if (argv[i].startsWith('--')) throw Error('Unknown option: ' + argv[i]);
  else positional.push(argv[i]);
}
const [manifest, output] = positional;
if (!manifest || !output || !options.mathjax || (!options['prepare-only'] && !options.quarto))
  throw Error('Use manifest output --mathjax pinned-es5-directory --quarto pinned-binary [--draft] [--prepare-only]');
const root = path.resolve(import.meta.dirname, '..'), out = path.resolve(output);
if (!out.startsWith(root + '/work/')) throw Error('Raw source projects and render diagnostics must stay in ignored work/');
const record = prepareQuarto(manifest, out, {mathjax: options.mathjax, draft: !!options.draft});
if (options['prepare-only']) {
  console.log(JSON.stringify({output: out, status: record.status, chapters: record.chapters.length, modelCalls: 0}));
} else {
  const binary = path.resolve(options.quarto);
  fs.copyFileSync(path.resolve(binary, '../../share/COPYRIGHT'), out + '/licenses/Quarto-COPYRIGHT.txt');
  const version = spawnSync(binary, ['--version'], {encoding: 'utf8'});
  if (version.status !== 0) throw Error('Pinned Quarto binary did not report its version');
  const started = Date.now();
  const result = spawnSync(binary, ['render', out], {cwd: root, encoding: 'utf8', timeout: 600000,
    maxBuffer: 16 * 1024 * 1024,
    env: {...process.env, XDG_CACHE_HOME: out + '/render-cache', DENO_DIR: out + '/render-deno'}});
  fs.writeFileSync(out + '/render.stdout', result.stdout ?? '');
  fs.writeFileSync(out + '/render.stderr', result.stderr ?? '');
  const rendering = {exitCode: result.status, signal: result.signal, error: result.error ? String(result.error) : null,
    wallSeconds: (Date.now() - started) / 1000, version: version.stdout.trim(), binarySha256: sha(fs.readFileSync(binary)),
    modelCalls: 0, scope: 'Actual Quarto render exit and source/TeX/asset checks, not browser appearance or mathematical/artistic certification.'};
  fs.writeFileSync(out + '/render-result.json', JSON.stringify(rendering, null, 2) + '\n');
  if (result.status !== 0 || result.error || result.signal) throw Error('Quarto process failed or has uncertain execution; retain project and render-result.json');
  const checks = [];
  for (const chapter of record.chapters) {
    const file = out + '/_book/' + chapter.id + '.html';
    const html = fs.readFileSync(file, 'utf8'), actual = htmlFormulas(html);
    checks.push({id: chapter.id, expected: chapter.expectedFormulas.length, actual: actual.length,
      sourceFormulas: chapter.sourceFormulas.length, ...compareFormulas(chapter.expectedFormulas, actual)});
  }
  // Pandoc's optional ES6 polyfill is the only intentionally removed tag.
  // Reject additional remote executable resources rather than quietly fetching.
  const adaptations = [], remoteExecutableAssets = [];
  for (const file of fs.readdirSync(out + '/_book').filter(name => name.endsWith('.html'))) {
    const target = out + '/_book/' + file, original = fs.readFileSync(target, 'utf8');
    let removed = 0;
    let html = original.replace(/<script src="https:\/\/cdnjs\.cloudflare\.com\/polyfill\/v3\/polyfill\.min\.js\?features=es6"><\/script>/g,
      () => { removed++; return ''; });
    const policy = "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'self'";
    if (!html.includes('<head>') || /http-equiv="Content-Security-Policy"/i.test(html)) throw Error('Unexpected native reader head/CSP');
    html = html.replace('<head>', '<head>\n<meta http-equiv="Content-Security-Policy" content="' + policy + '">');
    const remote = [...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="((?:https?:)?\/\/[^\"]+)"/g)].map(match => match[1]);
    remoteExecutableAssets.push(...remote.map(url => ({file, url})));
    if (removed) fs.writeFileSync(target, html);
    adaptations.push({file, optionalPolyfillTagsRemoved: removed, localResourcePolicy: policy, beforeSha256: sha(original), afterSha256: sha(html)});
  }
  const verdict = {status: checks.every(c => c.accepted) && !remoteExecutableAssets.length ? 'awaiting-browser-review' : 'failed',
    chapters: checks, adaptations, remoteExecutableAssets, modelCalls: 0,
    limits: 'Exact original Markdown recovery and ordered native TeX checked; referenced local resources only, not a network-isolated browser check. Appearance, mathematics and chart meaning require their own review.'};
  fs.writeFileSync(out + '/reader-build-check.json', JSON.stringify(verdict, null, 2) + '\n');
  if (verdict.status === 'failed') throw Error('Native formula identity or local executable resource checks failed');
  console.log(JSON.stringify({output: out + '/_book', status: verdict.status, chapters: checks.length,
    formulas: checks.reduce((sum, c) => sum + c.actual, 0), widgets: record.chapters.reduce((sum, c) => sum + c.widgets.length, 0),
    renderSeconds: rendering.wallSeconds, modelCalls: 0}));
}
