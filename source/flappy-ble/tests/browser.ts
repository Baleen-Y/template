import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import assert from 'node:assert/strict';
import { mimeFor } from '../release-policy.ts';
const root=resolve('../../flappy-ble'); await mkdir('test-results',{recursive:true});
const server=createServer(async(req,res)=>{try{const name=decodeURIComponent((req.url??'/').split('?')[0]);if(name==='/favicon.ico'){res.writeHead(204).end();return;}const file=resolve(root,'.'+(name==='/'?'/index.html':name));if(!file.startsWith(root+sep)){res.writeHead(403).end();return;}res.writeHead(200,{'Content-Type':mimeFor(file)}).end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok)); const url=`http://127.0.0.1:${server.address().port}/`;
const browser=await chromium.launch({headless:true});const checks=[];const errors=[],external=[],failed=[];
async function mock(page,seed={}) {
  await page.addInitScript(({seed})=>{
    const clone=v=>JSON.parse(JSON.stringify(v));
    const target={deviceId:'mock-device',connectionId:'mock-c1',name:'Protocol mock — not hardware',profileId:'integem-crowbot-mqtt-v1'};
    const ctx={apiVersion:'1.1.0',platform:'web',project:{sessionId:'mock-project'},module:{id:'flappy-ble',instanceId:'mock-module'},grantedPermissions:['storage','device.read','device.connect','device.send','device.upload'],capabilities:{device:{available:true}}};
    let state={projectSessionId:'mock-project',revision:1,status:'disconnected',currentDevice:null,activity:null};
    const watches=[],data=[],visibility=[],dispose=[];
    const fixture={stored:clone(seed),uploads:[],sends:[],deviceWorkspace:null,confirmation:'device-confirmed',cancelChooser:false,blockedSend:false,seq:0,
      change(s){state={...state,...s,revision:state.revision+1};watches.forEach(f=>f(clone(state)));},
      hide(v){visibility.forEach(f=>f(v));},close(){dispose.forEach(f=>f());},foreignUpload(){this.change({activity:{kind:'upload',owner:{type:'module',id:'other'}}});}};
    window.__mock=fixture;
    window.confirm=()=>{throw new Error('Native confirm must never be called');};
    window.icreator={ready:async()=>clone(ctx),storage:{get:async k=>clone(fixture.stored[k]??null),set:async(k,v)=>{if(!ctx.grantedPermissions.includes('storage'))throw Error('PERMISSION_DENIED');fixture.stored[k]=clone(v);}},
      lifecycle:{onVisibilityChange:f=>{visibility.push(f);return()=>{};},onDispose:f=>{dispose.push(f);return()=>{};}},
      device:{getState:async()=>clone(state),watchState:async f=>{watches.push(f);f(clone(state));return()=>watches.splice(watches.indexOf(f),1);},onData:async f=>{data.push(f);return()=>data.splice(data.indexOf(f),1);},
        connect:async()=>{if(fixture.cancelChooser){fixture.cancelChooser=false;throw Error('USER_CANCELED: chooser canceled');}fixture.change({status:'connected',currentDevice:target});return clone(state);},
        disconnect:async()=>{fixture.change({status:'disconnected',currentDevice:null});},
        send:async req=>{
          if(fixture.blockedSend)throw Error('BUSY: mocked send failure');
          if(!state.currentDevice||req.connectionId!==state.currentDevice.connectionId)throw Error('STALE_CONNECTION');
          if(state.activity)throw Error('BUSY');
          fixture.sends.push(clone(req));
          if(req.text==='get_device_block_xml'){
            const bytes=new TextEncoder().encode(JSON.stringify(fixture.deviceWorkspace));
            for(let i=0;i<bytes.length;i+=7){const e={...target,projectSessionId:'mock-project',sequence:++fixture.seq,timestamp:Date.now(),text:'',data:Array.from(bytes.slice(i,i+7))};data.forEach(f=>f(e));}
          }
        },
        upload:async req=>{fixture.uploads.push(clone(req));fixture.deviceWorkspace=clone(req.artifact.workspace);fixture.change({activity:{kind:'upload',owner:{type:'module',id:'flappy-ble'}}});return {jobId:'job-'+fixture.uploads.length};},
        watchUpload:async(job,f)=>{f({phase:'sending',progress:.4});return()=>{};},
        waitForUpload:async()=>{await new Promise(r=>setTimeout(r,180));fixture.change({activity:null});return{confirmation:fixture.confirmation};},
        cancelUpload:async()=>{fixture.change({activity:null,currentDevice:null,status:'disconnected'});}
      }
    };
  },{seed});
}

async function ready(page){await page.waitForFunction(()=>document.querySelector('#status')?.textContent?.startsWith('Stage '));}
async function mission(page,id){await page.click(`[data-stage="${id}"]`);await page.waitForFunction(()=>document.body.dataset.screen==='brief');await page.click('#goBuild');await page.waitForFunction(()=>document.body.dataset.screen==='build');}
async function copy(page){await page.click('#hintButton');assert.equal(await page.locator('#copyExample').isVisible(),false);await page.click('#showRescue');await page.click('#copyExample');await page.click('#confirmYes');await page.waitForFunction(()=>document.querySelector('#goLaunch')&&!document.querySelector('#goLaunch').classList.contains('hidden'));}
async function upload(page){await page.click('#upload');await page.waitForFunction(()=>document.querySelector('#uploadNotice').classList.contains('success'));}
const page=await browser.newPage({viewport:{width:1440,height:900}});
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(url)&&!r.url().startsWith('data:'))external.push(r.url());});page.on('response',r=>{if(r.status()>=400)failed.push(r.status()+' '+r.url());});
try {
 await mock(page);await page.goto(url);await ready(page);
 assert.equal(await page.locator('#mapScreen').isVisible(),true);assert.equal(await page.locator('#student').isVisible(),false);assert.equal(await page.locator('#game').isVisible(),false);assert.equal(await page.locator('#teacherDrawer').isVisible(),false);
 assert.equal(await page.locator('[data-stage="2"]').isDisabled(),true);
 checks.push('quiet child-facing mission map, without editor/game/diagnostics crammed onto the welcome screen');
 await page.screenshot({path:'test-results/v5-map.png',fullPage:true});
 await mission(page,1);assert.equal(await page.locator('#game').isVisible(),false);assert.equal(await page.locator('#student').isVisible(),true);
 assert.equal(await page.evaluate(()=>window.__mock.sends.length),0);assert.equal(await page.locator('#goLaunch').isVisible(),false);
 checks.push('building is a separate full-size workspace with a read-only example, blank student program and no hardware action on load');
 await page.screenshot({path:'test-results/v5-build-blank.png',fullPage:true});
 await page.click('#check');assert.equal(await page.locator('#checkFeedback').isVisible(),true);assert.ok((await page.locator('#checklist').innerText()).includes('start'));
 await copy(page);await page.screenshot({path:'test-results/v5-build-ready.png',fullPage:true});await page.click('#goLaunch');assert.equal(await page.locator('#start').isDisabled(),true);
 await page.evaluate(()=>window.__mock.cancelChooser=true);await page.click('#connect');await page.waitForFunction(()=>!document.querySelector('#connect').disabled);await page.click('#connect');await page.waitForFunction(()=>document.querySelector('#connection').classList.contains('good'));
 await upload(page);assert.equal(await page.locator('#start').isEnabled(),true);
 const first=await page.evaluate(()=>window.__mock.uploads.at(-1));assert.equal(first.artifact.workspacePolicy,'replace');assert.ok(first.artifact.source.includes('def MQTT(mqtt_msg, voltage):'));assert.equal(/moveup_|movedown_|stopmove_/.test(first.artifact.source),false);
 checks.push('copy remains last-resort help with in-page confirmation; connection cancellation is retryable; physical upload is required; light lesson contains no motor starts or stops');
 await page.click('#testRobot');await page.waitForFunction(()=>document.querySelector('#testStatus').textContent.includes('Did you see'));assert.deepEqual(await page.evaluate(()=>window.__mock.sends.map(x=>x.text)),['start','stop']);
 checks.push('optional Try Bolt test uses the real SDK path only on an explicit click and finishes with STOP');
 await page.click('#launchBack');await page.evaluate(()=>{const w=window.Blockly.Workspace.getAll().find(w=>w.getInjectionDiv&&!w.isFlyout&&!w.options.readOnly);w.getAllBlocks(false).find(b=>b.type==='flappy_light').setFieldValue('OFF','STATE');});await page.waitForFunction(()=>document.querySelector('#start').disabled);assert.ok((await page.locator('#checklist').innerText()).includes('expected light on; found light off'));
 await copy(page);await page.click('#goLaunch');await upload(page);
 checks.push('real semantic Blockly edits invalidate upload authorization and show one actionable mismatch instead of a diagnostic wall');
 await page.click('#teacherOpen');await page.click('#read');await page.waitForSelector('#readResult:not(.hidden)');await page.click('#replaceRead');await page.click('#confirmYes');await page.waitForFunction(()=>document.body.dataset.screen==='build');assert.equal(await page.locator('#start').isDisabled(),true);
 assert.ok((await page.locator('#codeLabel').textContent()).includes('recovered'));await page.click('#goLaunch');await upload(page);
 checks.push('teacher tools retain live fragmented notification readback and editable replacement, with a new upload still required');
 await page.screenshot({path:'test-results/v5-launch.png',fullPage:true});
 // Input-only autopilot. Never changes score, geometry, collision, hearts or win state.
 await page.evaluate(async()=>{const {Simulation}=await import('/assets/game.js');const original=Simulation.prototype.update;Simulation.prototype.update=function(dt){window.__sim=this;const target=this.pipes.find(p=>p.x+90>this.x)?.center??245;if(this.running&&this.y>target+18&&this.velocity>0)this.up();return original.call(this,dt);};});
 for(let id=1;id<=3;id++){
   if(id>1){await page.click('#nextStage');await page.waitForFunction(()=>document.body.dataset.screen==='brief');await page.click('#goBuild');await copy(page);await page.click('#goLaunch');await upload(page);}
   if(id===3){assert.equal(await page.locator('#start').isDisabled(),true);await page.check('#safety');}
   await page.click('#start');await page.waitForFunction(()=>document.body.dataset.screen==='play');
   const box=await page.locator('#game').boundingBox();assert.ok(box.width>=1439&&box.height>=899);assert.equal(await page.locator('#boards').isVisible(),false);
   await page.waitForFunction(()=>!document.querySelector('#up').disabled);
   if(id===1){
     await page.evaluate(()=>document.querySelector('#playScreen').requestFullscreen=()=>Promise.reject(new Error('Mock host denies native fullscreen')));await page.click('#fullscreen');assert.equal(await page.locator('#playScreen').isVisible(),true);
     await page.click('#pause');await page.waitForSelector('#pausePanel:not(.hidden)');const time=await page.evaluate(()=>window.__sim.elapsed);await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>window.__sim.elapsed),time);assert.equal(await page.evaluate(()=>window.__mock.sends.at(-1).text),'stop');await page.click('#resume');await page.waitForFunction(()=>document.querySelector('#pausePanel').classList.contains('hidden')); 
     checks.push('flight fills the complete module viewport automatically; denied native fullscreen keeps full-window play; pause freezes physics and sends STOP before resume');
   }
   await page.waitForTimeout(2800);await page.screenshot({path:`test-results/v5-flight-${id}.png`,fullPage:true});
   await page.waitForFunction(()=>document.body.dataset.screen==='result'&&/Look what|every world/.test(document.querySelector('#resultTitle').textContent),null,{timeout:50000});
   assert.equal(await page.locator('#game').isVisible(),false);assert.equal(await page.evaluate(()=>window.__mock.sends.at(-1).text),'stop');
   checks.push(`mission ${id}: distinct theme, genuine input-only game completion, star rewards, terminal STOP, and next mission unlock`);
 }
 await page.screenshot({path:'test-results/v5-result.png',fullPage:true});
 const calls=await page.evaluate(()=>window.__mock.uploads);assert.ok(calls.at(-1).artifact.source.includes('try:'));assert.ok(calls.at(-1).artifact.source.includes('finally:'));assert.ok(calls.at(-1).artifact.source.includes('moveup_left(35)'));
 const sends=await page.evaluate(()=>window.__mock.sends.map(x=>x.text));assert.ok(!sends.includes('left')&&!sends.includes('right'));assert.ok(sends.includes('pipe')&&sends.includes('milestone'));
 const stored=await page.evaluate(()=>window.__mock.stored);assert.deepEqual(stored['course.v5.progress'].cleared,[true,true,true]);assert.ok(stored['course.v5.medals'].every(x=>x>=1));
 checks.push('robot interaction is low-frequency mission progress, not finger-press spam; moving lesson uses self-stopping pulses and paired final parking');
 const re=await browser.newPage({viewport:{width:700,height:950}});await mock(re,stored);await re.goto(url);await ready(re);assert.equal(await re.locator('#start').isDisabled(),true);assert.ok(await re.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await re.screenshot({path:'test-results/v5-mobile-map.png',fullPage:true});await mission(re,1);assert.equal(await re.locator('#sample').isVisible(),false);await re.click('#exampleTab');assert.equal(await re.locator('#student').isVisible(),false);await re.click('#yourTab');assert.equal(await re.locator('#student').isVisible(),true);assert.ok(await re.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await re.screenshot({path:'test-results/v5-mobile-build.png',fullPage:true});checks.push('small-screen learning uses example/editor tabs; no horizontal page overflow; reopening keeps drafts and progress but never trusts a stale upload receipt');
 await re.click('#goLaunch');await re.click('#connect');await upload(re);await re.evaluate(()=>window.__mock.foreignUpload());assert.equal(await re.locator('#start').isDisabled(),true);await re.evaluate(()=>window.__mock.change({activity:null}));await upload(re);
 const before=await re.evaluate(()=>window.__mock.sends.length);await re.click('#start');await re.waitForTimeout(150);await re.evaluate(()=>window.__mock.hide(false));await re.waitForTimeout(2200);assert.equal(await re.evaluate(()=>window.__mock.sends.length),before);await re.evaluate(()=>window.__mock.hide(true));assert.equal(await re.locator('#start').isDisabled(),true);
 checks.push('another module upload invalidates play permission; hiding during countdown cancels before any device command and requires attention on return');
 const oldProgress={schema:1,selected:2,cleared:[true,false,false],assisted:[true,false,false],best:[3,2,0]},oldDraft={original:'old v4 workspace kept intact'};
 const migration=await browser.newPage();await mock(migration,{'course.v4.progress':oldProgress,'course.v4.stage.1':oldDraft});await migration.goto(url);await ready(migration);assert.equal(await migration.locator('[data-stage="2"]').isEnabled(),true);assert.deepEqual(await migration.evaluate(()=>window.__mock.stored['course.v4.stage.1']),oldDraft);assert.deepEqual(await migration.evaluate(()=>window.__mock.stored['course.v4.progress']),oldProgress);
 checks.push('v4 unlocked progress migrates without changing old draft/progress keys; new lesson drafts are kept separately');
 const missing=await browser.newPage();await missing.goto(url);await ready(missing);assert.ok((await missing.locator('#sdkWarning').innerText()).includes('Open this module in iCreator'));assert.equal(await missing.locator('#start').isDisabled(),true);
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(failed,[]);
 checks.push('missing SDK stays honest; no browser-only hardware impersonation in release; no external requests, missing resources or uncaught browser errors');
 await writeFile('test-results/browser.json',JSON.stringify({passed:true,browser:browser.version(),mode:'headless Chromium; real bundled Blockly and production ES modules; mocked iCreator SDK; no physical device or real iCreator container certification',checks},null,2));
}catch(e){await page.screenshot({path:'test-results/v5-failure.png',fullPage:true}).catch(()=>{});await writeFile('test-results/browser-failure.txt',String(e)+'\n'+JSON.stringify({errors,external,failed}));throw e;}
finally{await browser.close();await new Promise(ok=>server.close(()=>ok()));}
