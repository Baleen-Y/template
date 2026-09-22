import test from 'node:test';
import assert from 'node:assert/strict';
import {check,example,STAGES,clone} from '../../../flappy-ble/assets/model.js';
import {explainDifference} from '../../../flappy-ble/assets/lesson-feedback.js';
test('missing handlers give a concrete add-message instruction',()=>{
  const raw=example(STAGES[0]);delete raw.blocks.blocks[0].inputs.BODY.block.next;
  const line=check(raw,STAGES[0]).lines.find(l=>!l.ok);assert.ok(line.text.includes('named "stop"'));
});
test('wrong action values identify expected and actual device action',()=>{
  const raw=example(STAGES[0]);raw.blocks.blocks[0].inputs.BODY.block.inputs.DO.block.fields.STATE='OFF';
  const line=check(raw,STAGES[0]).lines.find(l=>!l.ok);assert.match(line.text,/expected light on; found light off/);
});
test('nested repeat mismatch reports its precise action path without weakening the checker',()=>{
  const raw=example(STAGES[1]);raw.blocks.blocks[0].inputs.BODY.block.next.block.inputs.DO.block.inputs.DO.block.next.block.fields.MS=200;
  const result=check(raw,STAGES[1]);assert.equal(result.ok,false);
  assert.match(result.lines.find(l=>!l.ok).text,/inside repeat.*expected wait 100 ms; found wait 200 ms/);
});
test('new checklist diagnostics do not change normalized lesson/upload identity',()=>{
  for(const s of STAGES){const raw=example(s);assert.equal(check(raw,s).ok,true);const moved=clone(raw);moved.blocks.blocks[0].x=900;assert.equal(check(raw,s).key,check(moved,s).key);}
  assert.equal(explainDifference([{kind:'light',state:'ON'}],[]),'action 1: add light on.');
});
