import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { STAGES, blank, example, check, generate, clone, readProgress, unlocked, VOCAB } from '../../../flappy-ble/assets/model.js';
import { ReadSession, EventPump, Link, connectionKey } from '../../../flappy-ble/assets/device.js';
import { Simulation } from '../../../flappy-ble/assets/game.js';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const ctx = { apiVersion:'1.1.0', platform:'web', project:{sessionId:'p1'}, module:{id:'flappy-ble',instanceId:'m1'}, capabilities:{device:{available:true}}, grantedPermissions:['storage','device.read','device.connect','device.send','device.upload'] };
const device = {deviceId:'d1',connectionId:'c1',name:'Protocol mock',profileId:'integem-crowbot-mqtt-v1'};
function state() { return {projectSessionId:'p1',revision:1,status:'connected',currentDevice:clone(device),activity:null}; }
function event(data, sequence=1) { return {deviceId:'d1',connectionId:'c1',projectSessionId:'p1',sequence,timestamp:0,text:'',data:Array.from(data)}; }
function eachBlock(raw, visit) {
  const walk = b => { if(!b)return;visit(b);Object.values(b.inputs??{}).forEach(v=>walk(v.block));walk(b.next?.block); };
  raw.blocks.blocks.forEach(walk);
}
test('three increasing game difficulties; all examples pass and blank drafts fail', () => {
  assert.deepEqual(STAGES.map(s=>s.goal),[3,5,7]);
  assert.ok(STAGES[0].gap>STAGES[1].gap && STAGES[1].gap>STAGES[2].gap);
  assert.ok(STAGES[0].speed<STAGES[1].speed && STAGES[1].speed<STAGES[2].speed);
  for(const stage of STAGES){assert.equal(check(example(stage),stage).ok,true);assert.equal(check(blank(),stage).ok,false);}
});
test('position/id changes do not invalidate; wrong values, nested structure and wrong end actions do',()=>{
  const raw=example(STAGES[1]), key=check(raw,STAGES[1]).key;
  eachBlock(raw,b=>{b.id='position-only-'+Math.random();b.x=300;b.y=900;});
  assert.equal(check(raw,STAGES[1]).key,key);
  eachBlock(raw,b=>{if(b.type==='flappy_device_repeat') b.fields.COUNT=3;});
  assert.equal(check(raw,STAGES[1]).ok,false);
  const bad=example(STAGES[0]);bad.blocks.blocks[0].inputs.BODY.block.next.block.inputs.DO.block= {type:'flappy_light',fields:{STATE:'ON'}};
  assert.equal(check(bad,STAGES[0]).ok,false);
});
test('unsupported/disabled/orphan blocks are rejected without altering raw input',()=>{
  for(const type of ['unknown_teacher_block','flappy_repeat','flappy_set_gravity']) {
    const raw=example(STAGES[0]);raw.blocks.blocks.push({type});const before=JSON.stringify(raw);
    assert.equal(check(raw,STAGES[0]).ok,false);assert.equal(JSON.stringify(raw),before);
  }
  const raw=example(STAGES[0]);raw.blocks.blocks[0].disabled=true;assert.throws(()=>generate(raw),/disabled/);
});
test('same handler sets may be reordered, but actions may not',()=>{
  const raw=example(STAGES[0]);const a=raw.blocks.blocks[0].inputs.BODY.block,b=a.next.block;delete a.next;b.next={block:a};raw.blocks.blocks[0].inputs.BODY.block=b;
  assert.equal(check(raw,STAGES[0]).ok,true);
});
test('actual generated Python parses, executes inert stub functions, and permits replacement vocabulary',()=>{
  for(const stage of STAGES){
    const source=generate(example(stage));
    assert.ok(source.includes('def MQTT(mqtt_msg, voltage):'));
    const verification = `import ast,sys,types\ns=sys.stdin.read()\nast.parse(s)\ntime=types.ModuleType('time');time.sleep_ms=lambda n:None;sys.modules['time']=time\nns={name:lambda *a:None for name in ${JSON.stringify(Object.values(VOCAB))}}\nexec(s,ns)\nfor m in ['start','pipe','milestone','stop']:\n ns['MQTT'](m,4.1)\n`;
    const p=spawnSync('python3',['-c',verification],{input:source,encoding:'utf8'});
    assert.equal(p.status,0,p.stderr);
  }
  const changed=generate(example(STAGES[0]),{...VOCAB,ON:'classroom_signal'});
  assert.ok(changed.includes('classroom_signal()'));assert.ok(!changed.includes('light_turnon()'));
});
test('literal /n in generated device strings is rejected rather than altered',()=>{
  const raw=example(STAGES[0]);raw.blocks.blocks[0].inputs.BODY.block.fields.MESSAGE='bad/nmessage';
  assert.throws(()=>generate(raw),/represented safely/);
});
test('bounded readback handles every UTF-8 byte boundary and wrong sessions',async()=>{
  const raw=example(STAGES[0]);raw.blocks.blocks[0].inputs.BODY.block.fields.MESSAGE='你好🌟';
  const json=JSON.stringify(raw),r=new ReadSession('k',device,'p1');
  r.feed({...event([65]),projectSessionId:'other'});
  r.feed({...event([65]),connectionId:'other'});
  let seq=1;for(const b of new TextEncoder().encode(json))r.feed(event([b],seq++));
  const got=await r.promise;assert.equal(got.raw,json);assert.deepEqual(got.workspace,raw);
});
test('readback rejects unrelated JSON, invalid UTF-8, mixed traffic and mismatched brackets',async()=>{
  for(const data of [new TextEncoder().encode('{}'),new TextEncoder().encode('telemetry'+JSON.stringify(example(STAGES[0]))),new TextEncoder().encode(JSON.stringify(example(STAGES[0]))+'upload:ok'),[0xff],new TextEncoder().encode('{"blocks":]}')]){
    const r=new ReadSession('k',device,'p1');r.feed(event(data));await assert.rejects(r.promise);
  }
});
test('first-byte, idle, absolute and byte-limit failures settle visibly',async()=>{
  const first=new ReadSession('k',device,'p1',{first:10,idle:100,total:100,max:1024});await assert.rejects(first.promise,/first-byte/);
  const idle=new ReadSession('k',device,'p1',{first:100,idle:10,total:100,max:1024});idle.feed(event([123]));await assert.rejects(idle.promise,/idle/);
  const total=new ReadSession('k',device,'p1',{first:100,idle:100,total:10,max:1024});total.feed(event([123]));await assert.rejects(total.promise,/total/);
  const bytes=new ReadSession('k',device,'p1',{first:100,idle:100,total:100,max:2});bytes.feed(event([123,32,32]));await assert.rejects(bytes.promise,/256/);
});
test('STOP discards a 1000-event burst behind an in-flight write',async()=>{
  const writes=[];let release;
  const p=new EventPump(async text=>{writes.push(text);if(text==='pipe')await new Promise(r=>release=r);},e=>{throw e;},0);
  assert.equal(await p.begin(),true);p.event('pipe');await wait(0);
  for(let i=0;i<1000;i++)p.event(i%2?'pipe':'milestone');
  const stop=p.stop();p.event('milestone');assert.ok(release);release();assert.equal(await stop,true);
  assert.deepEqual(writes,['start','pipe','stop']);assert.equal(p.busy,false);
});
test('STOP cancels an ordinary event already selected but waiting for rate limit',async()=>{
  const writes=[];const p=new EventPump(async t=>{writes.push(t);},()=>{},20);
  await p.begin();p.event('pipe');await wait(1);const stop=p.stop();await stop;
  assert.deepEqual(writes,['start','stop']);
});
test('failed STOP is not retried; only a fresh explicit retry starts another send',async()=>{
  let n=0;const p=new EventPump(async()=>{n++;throw new Error('BUSY');},()=>{},0);
  assert.equal(await p.stop(),false);await wait(10);assert.equal(n,1);
  assert.equal(await p.retryStop(),false);assert.equal(n,2);
});
function mockSDK(){
  let current=state(),watcher=()=>{},listener=()=>{},stored=null;
  const uploads=[],sends=[];
  const sdk={
    storage:{get:async()=>null,set:async()=>{}},
    device:{
      getState:async()=>clone(current),watchState:async fn=>{watcher=fn;fn(clone(current));return()=>{};},onData:async fn=>{listener=fn;return()=>{};},
      send:async req=>{sends.push(clone(req));if(req.text==='get_device_block_xml'){
        const bytes=new TextEncoder().encode(JSON.stringify(stored));let sequence=1;
        for(let i=0;i<bytes.length;i+=3)listener(event(bytes.slice(i,i+3),sequence++));
      }},
      upload:async req=>{uploads.push(clone(req));stored=clone(req.artifact.workspace);return{jobId:'job1'};},
      watchUpload:async(job,fn)=>{fn({phase:'sending',progress:.5});return()=>{};},waitForUpload:async()=>({confirmation:'device-confirmed'})
    }
  };
  return{sdk,uploads,sends,setState:s=>{current=s;watcher(clone(s));}};
}
test('real Link/generator payload loop: edit → upload snapshot → fragmented SDK notifications → edit → re-upload',async()=>{
  const m=mockSDK(),link=new Link(m.sdk,ctx,()=>{},()=>{},()=>{});await link.init();
  const raw=example(STAGES[2]);eachBlock(raw,b=>{if(b.type==='flappy_drive_pulse')b.fields.SPEED=36;});
  const source=generate(raw),key=connectionKey(state());
  const uploadPromise=link.upload(raw,source,key,()=>{});
  eachBlock(raw,b=>{if(b.type==='flappy_drive_pulse')b.fields.SPEED=99;});
  assert.equal(await uploadPromise,'device-confirmed');
  assert.ok(m.uploads[0].artifact.source.includes('moveup_left(36)'));
  assert.equal(generate(m.uploads[0].artifact.workspace),m.uploads[0].artifact.source);
  assert.equal(m.uploads[0].artifact.workspacePolicy,'replace');
  const recovered=await link.read();
  eachBlock(recovered.workspace,b=>{if(b.type==='flappy_drive_pulse')b.fields.SPEED=42;});
  await link.upload(recovered.workspace,generate(recovered.workspace),key,()=>{});
  assert.ok(m.uploads[1].artifact.source.includes('moveup_left(42)'));
  assert.equal(m.sends[0].text,'get_device_block_xml');link.dispose();
});
test('Link prevents BUSY, stale, hidden and project-changed writes',async()=>{
  const m=mockSDK(),link=new Link(m.sdk,ctx,()=>{},()=>{},()=>{});await link.init();
  await assert.rejects(link.send('start','wrong'),/STALE/);
  m.setState({...state(),activity:{kind:'send',owner:{type:'host',id:'host'}}});await assert.rejects(link.send('start',connectionKey(state())),/BUSY/);
  link.setVisible(false);await assert.rejects(link.send('stop',connectionKey(state())),/hidden/);
  link.setVisible(true);m.setState({...state(),projectSessionId:'other'});await assert.rejects(link.send('start',connectionKey(state())),/PROJECT/);link.dispose();
});
test('sequential progress cannot skip a locked lesson',()=>{
  const p=readProgress({schema:1,selected:3,cleared:[false,true,true],assisted:[],best:[]});
  assert.equal(p.selected,1);assert.deepEqual(p.cleared,[false,false,false]);assert.equal(unlocked(p),1);
  assert.throws(()=>readProgress({schema:8}),/schema/);
});
for(const stage of STAGES)test(`production simulation can clear stage ${stage.id} with input only`,()=>{
  let result=null;
  const sim=new Simulation(()=>{},win=>result=win,()=>0.5);sim.start(stage);
  for(let n=0;n<20000 && sim.running;n++){
    const target=sim.pipes.find(p=>p.x+90>175)?.center??245;
    if(sim.y>target+20 && sim.velocity>0)sim.up();
    sim.update(1/120);
  }
  assert.equal(result,true);assert.equal(sim.score,stage.goal);
});
test('the last heart ends the round exactly once, before async storage work',()=>{
  let count=0;const sim=new Simulation(()=>{},win=>{assert.equal(win,false);count++;});sim.start(STAGES[0]);
  for(let n=0;n<1600;n++)sim.update(1/120);assert.equal(count,1);assert.equal(sim.running,false);
});


test('light-only lessons never start OR stop any wheel',()=>{
 for(const stage of STAGES.slice(0,2)){
  const code=generate(example(stage)); assert.ok(!/moveup_|movedown_|stopmove_/.test(code));
  assert.deepEqual(stage.handlers.find(h=>h.message==='stop').actions,[{kind:'light',state:'OFF'}]);
 }
});
test('rescue roll has real starts and paired stops in a device-side finally block',()=>{
 const code=generate(example(STAGES[2]));
 assert.match(code,/try:\n/);assert.match(code,/finally:\n/);assert.match(code,/moveup_left\(35\)/);assert.match(code,/stopmove_left\(0\)/);
 const py=`import sys,types
code=sys.stdin.read()
t=types.ModuleType('time');t.sleep_ms=lambda n:None;sys.modules['time']=t
calls=[]
def left(n):calls.append('left started')
def right(n):raise RuntimeError('test motor error')
ns={'light_turnon':lambda:None,'light_turnoff':lambda:None,'light_random':lambda:None,'moveup_left':left,'moveup_right':right,'stopmove_left':lambda n:calls.append('left stopped'),'stopmove_right':lambda n:calls.append('right stopped')}
exec(code,ns)
try:ns['MQTT']('milestone',4)
except RuntimeError:pass
assert calls==['left started','left stopped','right stopped'],calls
`;
 const p=spawnSync('python3',['-c',py],{input:code,encoding:'utf8'});assert.equal(p.status,0,p.stderr);
});
test('pulse limits reject unsafe lesson inputs rather than silently clamping',()=>{
 for(const [field,value] of [['MS',9000],['SPEED',100],['DIR','UNKNOWN']]){
  const raw=example(STAGES[2]);eachBlock(raw,b=>{if(b.type==='flappy_drive_pulse')b.fields[field]=value;});assert.throws(()=>generate(raw));
 }
});
test('first bump costs one heart, not the entire flight; shield prevents rapid extra damage',()=>{
 let ended=0,hits=0;const sim=new Simulation(()=>{},()=>ended++,()=>.5,()=>hits++);sim.start(STAGES[0]);sim.y=495;sim.update(.01);
 assert.equal(sim.lives,2);assert.equal(sim.running,true);assert.equal(ended,0);assert.equal(hits,1);sim.y=495;sim.update(.01);assert.equal(sim.lives,2);
});
test('collectibles and streaks are earned by the simulated bird, not device packets',()=>{
 const sim=new Simulation(()=>{},()=>{},()=>.5);sim.start(STAGES[0]);sim.pipes=[{x:sim.x-35,center:sim.y,counted:false}];sim.update(.001);
 assert.equal(sim.stars,1);assert.equal(sim.combo,1);sim.update(.001);assert.equal(sim.stars,1);
});
test('portrait and wide viewports use the same simulation without changing scoring to fake a win',()=>{
 for(const width of [250,400,1200]){
  let result=null;const sim=new Simulation(()=>{},w=>result=w,()=>.5);sim.width=width;sim.start(STAGES[1]);
  for(let i=0;i<15000&&sim.running;i++){const target=sim.pipes.find(p=>p.x+90>sim.x)?.center??245;if(sim.y>target+18&&sim.velocity>0)sim.up();sim.update(1/120);}
  assert.equal(result,true);assert.equal(sim.score,STAGES[1].goal);
 }
});
test('changing lesson vocabulary affects final Python but not host transport contract',()=>{
 const raw=example(STAGES[2]),code=generate(raw,{...VOCAB,LEFT_FORWARD:'teacher_left_roll'});
 assert.ok(code.includes('teacher_left_roll(35)'));assert.ok(!code.includes('moveup_left(35)'));assert.ok(code.includes('def MQTT(mqtt_msg, voltage):'));
});
