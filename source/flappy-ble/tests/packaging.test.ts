import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { validateNames, auditRelease } from '../release-policy.ts';
const entry = ['flappy-ble/module.json','flappy-ble/index.html'];
test('rejects the exact .cur path reported by the real importer', () => {
  for (const n of ['handclosed.cur','handopen.cur','handdelete.cur']) assert.throws(() => validateNames([...entry,'flappy-ble/assets/vendor/media/'+n]), /Unsupported release asset/);
});
test('rejects duplicate paths including case-insensitive collisions', () => {
  assert.throws(() => validateNames([...entry,entry[0]]), /Duplicate/);
  assert.throws(() => validateNames([...entry,'flappy-ble/assets/A.png','flappy-ble/assets/a.png']), /Duplicate/);
});
test('rejects nested wrapper, traversal and backslash paths', () => {
  for (const n of ['parent/flappy-ble/index.html','flappy-ble/../index.html','flappy-ble/assets\\evil.js']) assert.throws(() => validateNames([...entry,n]), /Unsafe/);
});
test('built release contains only conservative supported asset paths', async () => {
  const report = await auditRelease(resolve('../../flappy-ble'));
  assert.ok(report.files > 10);
  assert.ok(report.names.every(n => !/\.(cur|wav|mp3|ogg|gif)$/i.test(n)));
  assert.ok(report.names.includes('flappy-ble/assets/vendor/media/sprites.svg'));
});
test('patched vendor uses native cursors without changing its license notice', async () => {
  const text = await readFile('../../flappy-ble/assets/vendor/blockly_compressed.js','utf8');
  assert.ok(text.includes('Flappy BLE 4.0.1 modification'));
  assert.ok(text.includes('cursor: grab;'));
  assert.ok(text.includes('cursor: grabbing;'));
  assert.ok(text.includes('cursor: no-drop;'));
  assert.ok(!/hand(?:open|closed|delete)\.cur/.test(text));
});
