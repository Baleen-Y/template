import {runtimeCommand} from '../src/runtime.ts';
import {test} from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {MISSIONS,example,blank,parse,evaluate,generate,clone,tuning,DEFAULT_TUNING,VOCAB,readProgress,freshProgress,tag} from '../../../crowbot-parcel-pals/assets/model.js';
import {CommandGate,DeliveryRun} from '../../../crowbot-parcel-pals/assets/session.js';
import {ReadSession,Link,connectionKey} from '../../../crowbot-parcel-pals/assets/device.js';
const tick=()=>new Promise(r=>setTimeout(r,1));
for(const m of MISSIONS)test('mission '+m.id+' sample solves the real route; empty route does not',()=>{assert.equal(evaluate(example(m),m).ok,true);assert.equal(evaluate(blank(),m).ok,false);const a=evaluate(example(m),m);assert.equal(a.trace.at(-1)?.delivered,m.houses.length);assert.equal(a.program.steps.at(-1)?.action,'park');});
test('route checker catches pond, border, wrong delivery and missing park',()=>{
 const m=MISSIONS[0];let s=example(m);s.blocks.blocks[0].inputs.DO.block.type='parcel_deliver';assert.match(evaluate(s,m).message,/reach Maple/);
 s=example(MISSIONS[1]);s.blocks.blocks[0].inputs.DO.block.type='parcel_right';assert.match(evaluate(s,MISSIONS[1]).message,/pond/);
 s=example(m);s.blocks.blocks[0].inputs.DO.block.next.block.next.block.next=undefined;assert.match(evaluate(s,m).message,/Park|park/);
});
test('each generated step is a bounded real physical action; snapshot timing round trips',()=>{
 const s=example(MISSIONS[2]);const t={...DEFAULT_TUNING,forwardMs:470};s.blocks.blocks[0].data=JSON.stringify(t);const a=generate(s,MISSIONS[2]);assert.equal(a.program.tuning.forwardMs,470);assert.match(a.source,/sleep_ms\(470\)/);assert.deepEqual(parse(a.snapshot).tuning,t);assert.match(a.source,/movedown_left/);assert.match(a.source,/stopmove_left/);assert.match(a.source,/finally:/);
});
test('unchanged geometry does not change identity; semantic and tuning changes do',()=>{
 const m=MISSIONS[0],s=example(m),a=generate(s,m);s.blocks.blocks[0].id='new';s.blocks.blocks[0].x=777;assert.equal(generate(s,m).key,a.key);
 s.blocks.blocks[0].data=JSON.stringify({...DEFAULT_TUNING,speed:31});assert.notEqual(generate(s,m).tag,a.tag);assert.equal(a.program.tuning.speed,30);
});
test('out of bounds settings, disabled unknown and orphan blocks fail visibly',()=>{
 for(const field of ['forwardMs','leftMs','rightMs'])assert.throws(()=>tuning({...DEFAULT_TUNING,[field]:1001}));assert.throws(()=>tuning({...DEFAULT_TUNING,speed:46}));assert.throws(()=>tuning({...DEFAULT_TUNING,forwardMs:NaN}));
 const s=example(MISSIONS[0]);s.blocks.blocks.push({type:'parcel_forward'});assert.throws(()=>parse(s),/ONE/);s.blocks.blocks.pop();s.blocks.blocks[0].inputs.DO.block.type='flappy_motor';assert.throws(()=>parse(s),/Unknown/);
});
test('lesson three really requires repeats, not just a matching flattened path',()=>{
 const s=example(MISSIONS[2]);const body=s.blocks.blocks[0].inputs.DO.block.inputs.DO.block;const tail=clone(body);let b=body;while(b.next)b=b.next.block;b.next={block:tail};let c=tail;while(c.next)c=c.next.block;c.next={block:{type:'parcel_park'}};s.blocks.blocks[0].inputs.DO.block=body;assert.match(evaluate(s,MISSIONS[2]).message,/repeat/);
});
test('Python executes changed vocabulary and guards wrong program/run/index/replays',()=>{
 const m=MISSIONS[2],a=generate(example(m),m,{...VOCAB,lf:'classroom_forward_left'});
 const harness=`import sys,types,json\nevents=[]\nt=types.ModuleType('time')\nt.sleep_ms=lambda ms:events.append(['wait',ms])\nsys.modules['time']=t\nns={}\nfor name in ${JSON.stringify([...Object.values(VOCAB),'classroom_forward_left'])}:\n ns[name]=(lambda n:lambda *args:events.append([n,*args]))(name)\nexec(${JSON.stringify(a.source+'\n  return 0\n')},ns)\nf=ns['MQTT']\nf('pp:wrong:step:abcdef12:0',3)\nassert not events\nf('${runtimeCommand(a.tag,'a','abcdef')}',3)\nevents.clear()\nf('${runtimeCommand(a.tag,'s','123456')}',3)\nassert not events\nf('${runtimeCommand(a.tag,'s','abcdef',1)}',3)\nassert not events\nf('${runtimeCommand(a.tag,'s','abcdef',0)}',3)\nassert ['classroom_forward_left',30] in events\nassert events[-2:]==[['stopmove_left',0],['stopmove_right',0]]\nevents.clear()\nf('${runtimeCommand(a.tag,'s','abcdef',0)}',3)\nassert not events\nf('stop',3)\nevents.clear()\nf('${runtimeCommand(a.tag,'s','abcdef',1)}',3)\nassert not events\nprint('guarded')\n`;
 const r=spawnSync('python3',['-c',harness],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/guarded/);
});
test('device cleanup still attempts right stop when left stop raises',()=>{
 const a=generate(example(MISSIONS[0]),MISSIONS[0]);const h=`import sys,types\nevents=[]\nt=types.ModuleType('time');t.sleep_ms=lambda ms:None;sys.modules['time']=t\nns={}\nfor n in ${JSON.stringify(Object.values(VOCAB))}:ns[n]=(lambda name:lambda *a:events.append(name))(n)\nexec(${JSON.stringify(a.source)},ns)\ndef bad(*a):raise RuntimeError('left failed')\nns['stopmove_left']=bad\ntry:ns['_pp_park']()\nexcept RuntimeError:pass\nassert events==['stopmove_right']\n`;
 const r=spawnSync('python3',['-c',h],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
});
test('40 rapid step clicks produce one command and no observation-based progress',async()=>{
 const sent:string[]=[],a=generate(example(MISSIONS[0]),MISSIONS[0]);const g=new CommandGate(async t=>{sent.push(t);await tick();},()=>true,0);const r=new DeliveryRun(a,g,()=>{},()=>true,()=>1);await r.begin('abcdef');
 const results=await Promise.allSettled(Array.from({length:40},()=>r.step()));assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(sent.length,2);assert.equal(r.confirmed,0);assert.equal(r.phase,'observe');r.confirm();assert.equal(r.confirmed,1);
});
test('delivery progress is earned only by explicit observations; no automatic next step',async()=>{
 const a=generate(example(MISSIONS[0]),MISSIONS[0]),sent:string[]=[];const r=new DeliveryRun(a,new CommandGate(async t=>{sent.push(t);},()=>true,0),()=>{},()=>true,()=>0);assert.throws(()=>r.confirm());await r.begin('abcdef');for(let i=0;i<a.program.steps.length;i++){await r.step();assert.equal(r.confirmed,i);assert.equal(sent.length,i+2);r.confirm();}assert.equal(r.phase,'done');
});
test('STOP invalidates a rate-waiting command; nothing ordinary follows it',async()=>{
 const sent:string[]=[],g=new CommandGate(async t=>{sent.push(t);},()=>true,40);await g.send('arm');const p=g.send('move');const stop=g.stop();await assert.rejects(p);await stop;assert.deepEqual(sent,['arm','stop']);
});
test('STOP follows only the accepted write, cannot be buried in input backlog',async()=>{
 const sent:string[]=[];let release:()=>void=()=>{};const g=new CommandGate(async t=>{sent.push(t);if(t==='move')await new Promise<void>(r=>release=r);},()=>true,0);const p=g.send('move');await tick();const stop=g.stop();await assert.rejects(g.send('another'));release();await p;assert.equal(await stop,true);assert.deepEqual(sent,['move','stop']);
});
test('failed stop is not automatically replayed',async()=>{let n=0;const g=new CommandGate(async()=>{n++;throw new Error('BUSY');},()=>true,0);await assert.rejects(g.stop());await tick();assert.equal(n,1);await assert.rejects(g.stop());assert.equal(n,2);});
test('hiding during step cooldown cancels without hidden sends or later observations',async()=>{
 let visible=true;const sent:string[]=[],a=generate(example(MISSIONS[0]),MISSIONS[0]);const r=new DeliveryRun(a,new CommandGate(async t=>{sent.push(t);},()=>visible,0),()=>{},()=>visible,()=>50);await r.begin('abcdef');const p=r.step();await tick();visible=false;r.cancel();await p;assert.equal(r.phase,'aborted');assert.throws(()=>r.confirm());assert.equal(sent.length,2);
});
test('readback streaming accepts split Unicode and rejects mixed telemetry',async()=>{
 const raw=JSON.stringify({...example(MISSIONS[0]),note:'🐰'}),bytes=new TextEncoder().encode(raw),r=new ReadSession('key',{deviceId:'d',connectionId:'c'},'p');for(let i=0;i<bytes.length;i++)r.feed({deviceId:'d',connectionId:'c',projectSessionId:'p',sequence:i,timestamp:0,text:'',data:[bytes[i]]});assert.equal((await r.promise).raw,raw);
 const bad=new ReadSession('key',{deviceId:'d',connectionId:'c'},'p');bad.feed({deviceId:'d',connectionId:'c',projectSessionId:'p',sequence:1,timestamp:0,text:'',data:[88]});await assert.rejects(bad.promise,/Unexpected/);
});
test('readback first-byte timeout reports failure',async()=>{const r=new ReadSession('k',{deviceId:'d',connectionId:'c'},'p',{first:5,idle:5,total:30,max:256});await assert.rejects(r.promise,/first-byte/);});
test('readback filters stale connections, sessions and sequences',async()=>{
 const r=new ReadSession('k',{deviceId:'d',connectionId:'c'},'p');r.feed({deviceId:'d',connectionId:'old',projectSessionId:'p',sequence:100,timestamp:0,text:'',data:[88]});r.feed({deviceId:'d',connectionId:'c',projectSessionId:'wrong',sequence:1,timestamp:0,text:'',data:[88]});const data=new TextEncoder().encode(JSON.stringify(blank()));r.feed({deviceId:'d',connectionId:'c',projectSessionId:'p',sequence:2,timestamp:0,text:'',data:Array.from(data)});assert.ok((await r.promise).workspace);
});
test('progress unlock order cannot skip a mission or reinterpret future data',()=>{assert.throws(()=>readProgress({schema:3}));const p=readProgress({schema:1,selected:3,cleared:[false,true,true]});assert.equal(p.selected,1);assert.deepEqual(p.cleared,[false,false,false]);});
test('real Link sends frozen workspace + source and supports notification readback',async()=>{
 const a=generate(example(MISSIONS[0]),MISSIONS[0]);let receiver:any;let captured:any;const state={projectSessionId:'p',revision:1,status:'connected',currentDevice:{deviceId:'d',connectionId:'c',name:'Crowbot',profileId:'integem-crowbot-mqtt-v1'},activity:null};
 const sdk:any={device:{watchState:async(fn:any)=>{fn(state);return()=>{};},onData:async(fn:any)=>{receiver=fn;return()=>{};},getState:async()=>state,upload:async(r:any)=>{captured=r;return{jobId:'j'};},watchUpload:async()=>()=>{},waitForUpload:async()=>({confirmation:'device-confirmed'}),send:async(r:any)=>{if(r.text==='get_device_block_xml'){const b=Array.from(new TextEncoder().encode(JSON.stringify(captured.artifact.workspace)));receiver({...state.currentDevice,projectSessionId:'p',sequence:1,timestamp:0,data:b,text:''});}}},storage:{},lifecycle:{}};
 const link=new Link(sdk,{project:{sessionId:'p'},module:{id:'crowbot-parcel-pals'}} as any,()=>{},()=>{},()=>{});await link.init();assert.equal(await link.upload(a.snapshot,a.source,connectionKey(state),()=>{}),'device-confirmed');a.snapshot.blocks.blocks[0].x=999;assert.notEqual(captured.artifact.workspace.blocks.blocks[0].x,999);assert.equal(captured.artifact.workspacePolicy,'replace');assert.deepEqual(parse((await link.read()).workspace).steps.map(s=>s.action),a.program.steps.map(s=>s.action));link.dispose();
});
