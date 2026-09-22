import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { CruiseRun } from '../../../crowbot-parcel-pals/assets/cruise.js';
import { CommandGate, DeliveryRun } from '../../../crowbot-parcel-pals/assets/session.js';
import { example, generate, MISSIONS } from '../../../crowbot-parcel-pals/assets/model.js';
import { runtimeCommand } from '../../../crowbot-parcel-pals/assets/runtime.js';
const sleep = (ms:number) => new Promise(r=>setTimeout(r,ms));
async function until(fn:()=>boolean):Promise<void>{const start=Date.now();while(!fn()){if(Date.now()-start>2000)throw new Error('Timed out');await sleep(2);}}
const artifact=()=>generate(example(MISSIONS[1]),MISSIONS[1]);
const indices=(sent:string[])=>sent.filter(s=>s!=='stop'&&s[10]==='s').map(s=>parseInt(s.slice(-2),16));

for(const mission of MISSIONS.slice(1))test(`cruise ${mission.id} requires no per-step clicks and never auto-confirms physical delivery`,async()=>{
  const a=generate(example(mission),mission),sent:string[]=[];const gate=new CommandGate(async t=>{sent.push(t);},()=>true,0);
  const r=new CruiseRun(a,gate,()=>{},()=>true,()=>1);
  assert.equal(sent.length,0);await r.begin('123abc');await until(()=>r.phase==='review');
  assert.deepEqual(indices(sent),a.program.steps.map((_,i)=>i));assert.equal(sent.at(-1),'stop');
  assert.equal(r.cursor,a.program.steps.length);assert.equal(r.confirmed,0);
  await assert.rejects(r.begin('456def'));r.confirm();assert.equal(r.phase,'done');assert.equal(r.confirmed,a.program.steps.length);
});
test('first lesson guided path still stops for each actual observation',async()=>{
  const a=generate(example(MISSIONS[0]),MISSIONS[0]),sent:string[]=[];
  const r=new DeliveryRun(a,new CommandGate(async t=>{sent.push(t);},()=>true,0),()=>{},()=>true,()=>1);
  await r.begin('112233');await sleep(20);assert.equal(sent.length,1);assert.equal(r.phase,'ready');
  await r.step();assert.equal(r.phase,'observe');await sleep(20);assert.equal(sent.length,2);assert.equal(r.confirmed,0);
  r.confirm();assert.equal(r.confirmed,1);assert.equal(r.phase,'ready');r.cancel();
});
test('pause during accepted pulse waits, stops and resumes at next unsent index without replay',async()=>{
  const a=artifact(),sent:string[]=[];const gate=new CommandGate(async t=>{sent.push(t);},()=>true,0);
  const r=new CruiseRun(a,gate,()=>{},()=>true,()=>35);
  await r.begin('111111');await until(()=>indices(sent).length===1);await r.pause();assert.equal(r.phase,'paused');
  assert.equal(r.cursor,1);assert.equal(sent.at(-1),'stop');const n=sent.length;await sleep(50);assert.equal(sent.length,n);
  await r.resume('222222');await until(()=>r.phase==='review');
  assert.deepEqual(indices(sent),a.program.steps.map((_,i)=>i));
  const arms=sent.filter(s=>s[10]==='a');assert.equal(arms[1],runtimeCommand(a.tag,'a','222222',1));
  assert.equal(r.confirmed,0);
});
test('pause cancels a selected command still waiting for rate slot; resume does not skip it',async()=>{
  const a=artifact(),sent:string[]=[];const gate=new CommandGate(async t=>{sent.push(t);},()=>true,30);
  const r=new CruiseRun(a,gate,()=>{},()=>true,()=>1);
  await r.begin('111111');await r.pause();assert.equal(r.phase,'paused');assert.deepEqual(indices(sent),[]);assert.equal(r.cursor,0);
  await r.resume('222222');await until(()=>r.phase==='review');assert.deepEqual(indices(sent),a.program.steps.map((_,i)=>i));
});
test('STOP mid-cruise cancels all future motion and terminal review',async()=>{
  const a=artifact(),sent:string[]=[];const r=new CruiseRun(a,new CommandGate(async t=>{sent.push(t);},()=>true,0),()=>{},()=>true,()=>50);
  await r.begin('123456');await until(()=>indices(sent).length===1);await r.stop();const n=sent.length;await sleep(100);
  assert.equal(sent.length,n);assert.equal(sent.at(-1),'stop');assert.equal(r.phase,'aborted');assert.equal(r.confirmed,0);
  await r.resume('abcdef');assert.equal(sent.length,n);assert.throws(()=>r.confirm());
});
test('40 pause/resume taps cannot duplicate indices or form a route queue',async()=>{
  const a=artifact(),sent:string[]=[];const r=new CruiseRun(a,new CommandGate(async t=>{sent.push(t);},()=>true,0),()=>{},()=>true,()=>5);
  await r.begin('111111');await Promise.all(Array.from({length:40},()=>r.pause()));assert.equal(r.phase,'paused');
  await Promise.all(Array.from({length:40},()=>r.resume('222222')));await until(()=>r.phase==='review');
  assert.deepEqual(indices(sent),a.program.steps.map((_,i)=>i));
});
test('failed ordinary write aborts cruise without retry or pretending it completed',async()=>{
  const a=artifact(),sent:string[]=[];const r=new CruiseRun(a,new CommandGate(async t=>{sent.push(t);if(t[10]==='s')throw new Error('BUSY from another operation');},()=>true,0),()=>{},()=>true,()=>1);
  await r.begin('123456');await until(()=>r.phase==='aborted');const n=sent.length;await sleep(40);assert.equal(sent.length,n);
  assert.match(r.error,/BUSY/);assert.equal(r.cursor,0);assert.equal(r.confirmed,0);assert.throws(()=>r.confirm());
});
test('failed final STOP blocks review and completion, never silently retries',async()=>{
  const a=artifact(),sent:string[]=[];const r=new CruiseRun(a,new CommandGate(async t=>{sent.push(t);if(t==='stop')throw new Error('STOP failed');},()=>true,0),()=>{},()=>true,()=>1);
  await r.begin('123456');await until(()=>r.phase==='aborted');await sleep(40);
  assert.equal(sent.filter(t=>t==='stop').length,1);assert.equal(r.confirmed,0);assert.equal(r.stopWritten,false);assert.throws(()=>r.confirm());
});
test('hidden/disposed sessions cancel pacing and cannot resume or confirm',async()=>{
  let active=true;const a=artifact(),sent:string[]=[];const r=new CruiseRun(a,new CommandGate(async t=>{sent.push(t);},()=>active,0),()=>{},()=>active,()=>50);
  await r.begin('123456');await until(()=>indices(sent).length===1);active=false;r.cancel();const n=sent.length;await sleep(100);
  assert.equal(sent.length,n);assert.equal(r.confirmed,0);assert.throws(()=>r.confirm());
  await r.resume('abcdef');assert.equal(sent.length,n);
});
test('pause write failure never enables resume and does not repeat an accepted step',async()=>{
  const a=artifact(),sent:string[]=[];const r=new CruiseRun(a,new CommandGate(async t=>{sent.push(t);if(t==='stop')throw new Error('pause STOP rejected');},()=>true,0),()=>{},()=>true,()=>25);
  await r.begin('123456');await until(()=>indices(sent).length===1);await r.pause();assert.equal(r.phase,'aborted');
  const n=sent.length;await r.resume('abcdef');await sleep(50);assert.equal(sent.length,n);assert.equal(r.confirmed,0);
});
test('generated callback accepts explicit resume offset and rejects repeat, stale and out-of-range steps',()=>{
  const a=artifact();
  const py=`import json\ncalls=[]\nclass Clock:\n  def sleep_ms(self, ms): pass\nns={'__builtins__':__builtins__}\nfor name in ['moveup_left','moveup_right','movedown_left','movedown_right','stopmove_left','stopmove_right','light_turnon','light_turnoff']:\n  ns[name]=(lambda key:lambda *args:calls.append([key,list(args)]))(name)\nexec(${JSON.stringify(a.source)},ns)\nns['time']=Clock()\nf=ns['MQTT']\nf(${JSON.stringify(runtimeCommand(a.tag,'a','111111'))},0)\nf(${JSON.stringify(runtimeCommand(a.tag,'s','111111',0))},0)\nf('stop',0)\nf(${JSON.stringify(runtimeCommand(a.tag,'a','222222',1))},0)\nf(${JSON.stringify(runtimeCommand(a.tag,'s','222222',1))},0)\nbefore=len(calls)\nf(${JSON.stringify(runtimeCommand(a.tag,'s','222222',1))},0)\nf(${JSON.stringify(runtimeCommand(a.tag,'s','111111',2))},0)\nf(${JSON.stringify(runtimeCommand(a.tag,'a','333333',255))},0)\nassert len(calls)==before\nassert ns['_pp_next']==2\nassert sum(x[0]=='moveup_left' for x in calls)==2\nprint('resume-offset-ok')\n`;
  assert.match(execFileSync('python3',['-c',py],{encoding:'utf8'}),/resume-offset-ok/);
});
