import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {sha, insertAtAnchors, compareFormulas, prepareQuarto} from '../packages/visualbook/quarto/export.mjs';

test('duplicate paragraphs insert at their original line, not the first matching text', () => {
  const raw = '# Test\n\nSame.\n\nSame.\n';
  const source = {blocks: [{id: 'a', line: 3, raw: 'Same.', sha256: sha('Same.')},
    {id: 'b', line: 5, raw: 'Same.', sha256: sha('Same.')} ]};
  assert.equal(insertAtAnchors(raw, source, [{anchor: 'b', markdown: '\nFIGURE\n'}]),
    '# Test\n\nSame.\n\nSame.\nFIGURE\n\n');
  assert.equal(insertAtAnchors(raw, source, [{anchor: 'a', markdown: 'A'}, {anchor: 'b', markdown: 'B'}, {anchor: 'a', markdown: 'C'}]),
    '# Test\n\nSame.AC\n\nSame.B\n');
  assert.throws(() => insertAtAnchors(raw.replace('Same.', 'Wrong'), source, [{anchor: 'a', markdown: 'FIGURE'}]), /changed/);
});
test('final assembly rejects absent, stale and blocked reviews before writing output', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quarto-review-'));
  try {
    const source = '# Small chapter\n\nA formula $x=1$.\n';
    const plan = '{"figures":[]}';
    fs.writeFileSync(dir + '/source.md', source); fs.writeFileSync(dir + '/plan.json', plan);
    const manifest = {title: 'Test', chapters: [{id: 'small', source: 'source.md', plan: 'plan.json'}]};
    const writeManifest = () => fs.writeFileSync(dir + '/manifest.json', JSON.stringify(manifest));
    writeManifest();
    const run = () => prepareQuarto(dir + '/manifest.json', dir + '/out');
    assert.throws(run, /requires explicit/); assert.equal(fs.existsSync(dir + '/out'), false);
    manifest.chapters[0].review = 'review.json'; writeManifest();
    const review = {readyForReader: true, sourceFileSha256: sha(source), planFileSha256: sha(plan), blockingIssues: []};
    for (const patch of [{sourceFileSha256: sha('wrong')}, {planFileSha256: sha('wrong')}, {blockingIssues: ['unreadable']}, {blockingIssues: null}]) {
      fs.writeFileSync(dir + '/review.json', JSON.stringify({...review, ...patch}));
      assert.throws(run, /stale\/blocked/); assert.equal(fs.existsSync(dir + '/out'), false);
    }
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});
test('native math admits layout indentation while retaining changed symbols and text', () => {
  const actual = '\\|v\\|=\\sqrt{\\langle v,v\\rangle},\\qquad\nd(u,v)=\\|u-v\\|.';
  const result = compareFormulas([actual.replace('\nd', '\n d')], [actual]);
  assert.equal(result.accepted, true); assert.equal(result.exactOrderedTex, false);
  assert.equal(result.indentationChanges.length, 1);
  assert.equal(compareFormulas(['x=1'], ['x=2']).accepted, false);
  assert.equal(compareFormulas(['\\text{a\n b}'], ['\\text{a\nb}']).accepted, false);
  assert.equal(compareFormulas(['\\newcommand{\\f}{a\n b}'], ['\\newcommand{\\f}{a\nb}']).accepted, false);
  assert.equal(compareFormulas(['x'], ['x', 'y']).accepted, false);
});
