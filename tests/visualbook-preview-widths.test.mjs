import test from 'node:test';
import assert from 'node:assert/strict';
import {auditWidths} from '../tools/audit_visualbook_parameters.mjs';
import {preview} from '../tools/visualbook.mjs';

test('preview evidence keeps unique explicit widths and includes the medium default', () => {
  assert.deepEqual(auditWidths(), [1280,375,600,1920]);
  const input=[310,600]; const output=auditWidths(input); input[0]=400;
  assert.deepEqual(output,[310,600]);
  for(const widths of [[],[310,310],[239],[2561],[375.5],[250,300,400,500,600,700,800]])
    assert.throws(()=>auditWidths(widths),/unique integer/);
});
test('unknown preview options fail before a render attempt or source access', async () => {
  await assert.rejects(preview('nonexistent-source','nonexistent-output',{widths:[310],unknown:true}),/only accept/);
  await assert.rejects(preview('nonexistent-source','nonexistent-output',{widths:[310,310]}),/unique integer/);
});
