import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {keyInput,acceptsInput,keyLabel} from '../src/controls.ts';
import {runtimeCommand} from '../src/runtime.ts';
import {generate,example,MISSIONS,VOCAB,stepWait,DEFAULT_TUNING} from '../src/model.ts';

test('route keys map to relative forward/turn/stop; Space/Enter mean next, not observation',()=>{
  assert.equal(keyInput('ArrowUp'),'forward');assert.equal(keyInput('ArrowLeft'),'left');assert.equal(keyInput('ArrowRight'),'right');
  assert.equal(keyInput('ArrowDown'),'stop');assert.equal(keyInput('Escape'),'stop');
  assert.equal(keyInput(' '),'next');assert.equal(keyInput('Enter'),'next');assert.equal(keyInput('y'),null);
  assert.equal(acceptsInput('left','forward'),false);assert.equal(acceptsInput('forward','forward'),true);
  assert.equal(acceptsInput('next','deliver'),true);assert.equal(acceptsInput('next',undefined),false);
  assert.match(keyLabel('park'),/Space/);
});
test('all runtime arm, route and light-test packets fit 19 ASCII bytes without manual fragmentation',()=>{
  for(const mission of MISSIONS){const a=generate(example(mission),mission);
    for(const op of ['a','s','t'] as const)for(let i=0;i<24;i++){
      const text=runtimeCommand(a.tag,op,'a1b2c3',i);assert.equal(Buffer.byteLength(text,'utf8'),19);assert.match(text,/^p2[a-f0-9]{8}[ast][a-f0-9]{8}$/);
    }
  }
  assert.throws(()=>runtimeCommand('abc','s','a1b2c3',1));assert.throws(()=>runtimeCommand('01234567','s','abcdef',256));
  assert.throws(()=>runtimeCommand('01234567','s','broken',1));
});
test('production compact messages execute the actual generated callback with firmware wrapper and a 20-byte transport cap',()=>{
  for(const m of MISSIONS){const a=generate(example(m),m);
    const actions=a.program.steps.map((_,i)=>runtimeCommand(a.tag,'s','abcdef',i));
    const harness=`import sys,types,json\nevents=[]\nt=types.ModuleType('time');t.sleep_ms=lambda ms:events.append(['wait',ms]);sys.modules['time']=t\nns={}\nfor n in ${JSON.stringify(Object.values(VOCAB))}:ns[n]=(lambda name:lambda *args:events.append([name,*args]))(n)\nexec(${JSON.stringify(a.source+'\n  return 0\n')},ns)\nf=ns['MQTT']\ndef write(text):\n assert len(text.encode())<=20\n f(text,3.7)\nwrite('${runtimeCommand(a.tag,'t','111111',3)}')\nassert sum(x==['light_turnon'] for x in events)==2\nassert not any('move' in x[0] for x in events),events\nevents.clear()\nwrite('${runtimeCommand(a.tag,'a','abcdef')}')\nassert not any(x[0].startswith('moveup') for x in events)\nfor command in ${JSON.stringify(actions)}:\n events.clear()\n write(command)\n assert events[-2:]==[['stopmove_left',0],['stopmove_right',0]],events\n events.clear()\n write(command)\n assert not events,'replay should not execute'\nwrite('stop')\nevents.clear()\nwrite('${actions[0]}')\nassert not events\nprint('generated runtime exercised')\n`;
    const result=spawnSync('python3',['-c',harness],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  }
});
test('truncated, malformed, old-protocol and wrong-tag messages cause no motor movement',()=>{
  const a=generate(example(MISSIONS[0]),MISSIONS[0]);const good=runtimeCommand(a.tag,'s','abcdef');
  const bad=[good.slice(0,12),good+'x','p2deadbeefsaabbcc00','pp:'+a.tag+':step:abcdef:0','p2'+a.tag.slice(0,8)+'szzzxxx00',runtimeCommand(a.tag,'s','abcdef',255)];
  const harness=`import sys,types\nevents=[]\nt=types.ModuleType('time');t.sleep_ms=lambda ms:None;sys.modules['time']=t\nns={}\nfor n in ${JSON.stringify(Object.values(VOCAB))}:ns[n]=(lambda name:lambda *args:events.append(name))(n)\nexec(${JSON.stringify(a.source)},ns)\nf=ns['MQTT']\nf('${runtimeCommand(a.tag,'a','abcdef')}',3)\nevents.clear()\nfor msg in ${JSON.stringify(bad)}: f(msg,3)\nassert not events,events\n`;
  const r=spawnSync('python3',['-c',harness],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
});
test('duplicate arm cannot rewind an active route and repeat a physical step',()=>{
  const a=generate(example(MISSIONS[0]),MISSIONS[0]);
  const harness=`import sys,types\nevents=[]\nt=types.ModuleType('time');t.sleep_ms=lambda ms:None;sys.modules['time']=t\nns={}\nfor n in ${JSON.stringify(Object.values(VOCAB))}:ns[n]=(lambda name:lambda *args:events.append(name))(n)\nexec(${JSON.stringify(a.source)},ns)\nf=ns['MQTT']\nf('${runtimeCommand(a.tag,'a','123abc')}',3)\nf('${runtimeCommand(a.tag,'s','123abc',0)}',3)\nevents.clear()\nf('${runtimeCommand(a.tag,'a','123abc')}',3)\nf('${runtimeCommand(a.tag,'s','123abc',0)}',3)\nassert not events,events\n`;
  const r=spawnSync('python3',['-c',harness],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
});
