import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
const root=resolve('../../flappy-ble');
await mkdir('test-results',{recursive:true});
const server=createServer(async(req,res)=>{
  const name=(req.url??'/').split('?')[0];
  const path=resolve(root,'.'+(name==='/'?'/index.html':decodeURIComponent(name)));
  if(!path.startsWith(root+'/')) {res.writeHead(403).end();return;}
  try {const b=await readFile(path);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'})[extname(path)]??'application/octet-stream');res.end(b);}
  catch {res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const port=server.address().port,url=`http://127.0.0.1:${port}/`;
const browser=await chromium.launch({headless:true});
const checks=[];
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
async function copy(page){await page.locator('#help').evaluate(el=>el.open=true);await page.click('#copyExample');await page.click('#confirmYes');await page.waitForFunction(()=>document.querySelectorAll('#checklist .pending').length===0);}
async function upload(page){await page.click('#upload');await page.waitForFunction(()=>document.querySelector('#uploadNotice')?.classList.contains('success'));}
const errors=[],external=[];
const page=await browser.newPage({viewport:{width:1580,height:1080}});
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{if(!r.url().startsWith(url)&&!r.url().startsWith('data:'))external.push(r.url());});
try {
  await mock(page);await page.goto(url);await ready(page);
  assert.equal(await page.locator('#start').isDisabled(),true);
  assert.equal(await page.locator('[data-stage="2"]').isDisabled(),true);
  assert.equal(await page.locator('#copyExample').isVisible(),false);
  checks.push('new course: blank student workspace, read-only example, hidden rescue copy, locked stages');
  await page.screenshot({path:'test-results/stage-1-blank.png',fullPage:true});
  await page.evaluate(()=>window.__mock.cancelChooser=true);await page.click('#connect');await page.waitForFunction(()=>!document.querySelector('#connect').disabled);
  await page.click('#connect');await page.waitForFunction(()=>document.querySelector('#connection').textContent.includes('Connected'));
  checks.push('canceled Bluetooth chooser remains retryable');
  await copy(page);assert.equal(await page.locator('#start').isDisabled(),true);checks.push('example copy still requires upload; in-page confirmation works');
  await upload(page);assert.equal(await page.locator('#start').isEnabled(),true);
  const call=await page.evaluate(()=>window.__mock.uploads.at(-1));assert.equal(call.artifact.workspacePolicy,'replace');assert.ok(call.artifact.source.includes('def MQTT(mqtt_msg, voltage):'));
  checks.push('real Blockly snapshot is paired with generated Python in production SDK upload path');
  await page.evaluate(()=>{const w=window.Blockly.Workspace.getAll().find(w=>w.getInjectionDiv&&!w.isFlyout&&!w.options.readOnly);w.getAllBlocks(false).find(b=>b.type==='flappy_light').setFieldValue('OFF','STATE');});
  await page.waitForFunction(()=>document.querySelector('#start').disabled);checks.push('semantic block edits invalidate upload authorization');
  await copy(page);await upload(page);
  await page.click('#read');await page.waitForSelector('#readResult:not(.hidden)');await page.click('#replaceRead');await page.click('#confirmYes');
  await page.waitForFunction(()=>document.querySelector('#codeLabel').textContent.includes('recovered'));
  assert.equal(await page.locator('#start').isDisabled(),true);checks.push('notification readback restores editable Blockly, never treats cached data as device data, re-upload required');
  await upload(page);
  // Test autopilot supplies only flap inputs; it never changes score, goal or win state.
  await page.evaluate(async()=>{
    const {Simulation}=await import('/assets/game.js');const update=Simulation.prototype.update;
    Simulation.prototype.update=function(dt){const target=this.pipes.find(p=>p.x+90>175)?.center??245;if(this.running&&this.y>target+20&&this.velocity>0)this.up();return update.call(this,dt);};
  });
  for(let id=1;id<=3;id++){
    if(id>1){await page.click('#nextStage');await page.waitForFunction(id=>document.querySelector('#title').textContent.startsWith(id+'.'),id);assert.equal(await page.locator('#start').isDisabled(),true);await copy(page);await upload(page);}
    if(id===3)await page.check('#safety');
    await page.screenshot({path:`test-results/stage-${id}-ready.png`,fullPage:true});
    await page.click('#start');
    await page.waitForFunction(()=>/Stage cleared|Course complete/.test(document.querySelector('#resultTitle').textContent),null,{timeout:45000});
    checks.push(`stage ${id}: real game reaches target, priority STOP sent, completion unlocks next lesson`);
  }
  const sends=await page.evaluate(()=>window.__mock.sends.map(x=>x.text));
  assert.equal(sends.includes('left')||sends.includes('right'),false);assert.equal(sends.at(-1),'stop');checks.push('no per-tap BLE commands and no ordinary event after terminal STOP');
  const stored=await page.evaluate(()=>window.__mock.stored);assert.deepEqual(stored['course.v4.progress'].cleared,[true,true,true]);
  const reopened=await browser.newPage({viewport:{width:1280,height:900}});await mock(reopened,stored);await reopened.goto(url);await ready(reopened);
  assert.equal(await reopened.locator('#start').isDisabled(),true);assert.ok((await reopened.locator('#courseSummary').textContent()).includes('complete'));checks.push('reopen preserves course drafts/progress but never trusts an old upload receipt');
  await reopened.close();
  await page.setViewportSize({width:700,height:1000});await page.screenshot({path:'test-results/mobile.png',fullPage:true});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false);checks.push('700px responsive layout has no page-width overflow');
  await page.evaluate(()=>window.__mock.foreignUpload());assert.equal(await page.locator('#start').isDisabled(),true);checks.push('other module upload invalidates the current stage receipt');
  await page.evaluate(()=>{window.__mock.change({activity:null});window.__mock.hide(false);});
  const before=await page.evaluate(()=>window.__mock.sends.length);await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>window.__mock.sends.length),before);checks.push('hidden module initiates no BLE sends');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);checks.push('zero uncaught browser errors and zero external runtime network requests');
  const noSDK=await browser.newPage();await noSDK.goto(url);await noSDK.waitForFunction(()=>document.querySelector('#sdkWarning').textContent.includes('Open this module in iCreator'));assert.equal(await noSDK.locator('#start').isDisabled(),true);await noSDK.close();checks.push('missing-SDK state explains how to open module and disables hardware play');
  const report={browser:browser.version(),mode:'headless Chromium; real Blockly 8; mocked iCreator SDK; no real hardware/host/GPU certification',checks,passed:true};
  await writeFile('test-results/browser.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} catch(e) {
  await page.screenshot({path:'test-results/failure.png',fullPage:true}).catch(()=>{});
  await writeFile('test-results/failure.txt',String(e)+'\n'+JSON.stringify({errors,external,checks})+'\n'+await page.locator('body').innerText());throw e;
} finally {await browser.close();server.close();}
