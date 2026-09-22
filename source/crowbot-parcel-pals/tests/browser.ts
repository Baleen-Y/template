import {chromium} from 'playwright';
import {createServer} from 'node:http';import {readFile,mkdir,writeFile} from 'node:fs/promises';import {resolve,sep,extname} from 'node:path';import assert from 'node:assert/strict';
const root=resolve('../../crowbot-parcel-pals'),prefix='/projects/test/modules/crowbot-parcel-pals/';await mkdir('test-results',{recursive:true});
const mime=(p:string)=>({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.gif':'image/gif','.cur':'image/x-icon','.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg'}[extname(p)]??'application/octet-stream');
const server=createServer(async(req,res)=>{try{const name=decodeURIComponent((req.url??'').split('?')[0]);if(name==='/favicon.ico'){res.writeHead(204).end();return;}if(!name.startsWith(prefix)){res.writeHead(404).end();return;}const p=resolve(root,name.slice(prefix.length)||'index.html');if(!p.startsWith(root+sep)){res.writeHead(403).end();return;}res.writeHead(200,{'Content-Type':mime(p)}).end(await readFile(p));}catch{res.writeHead(404).end();}});
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${(server.address() as any).port}${prefix}`;const assetBase=url;
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_BIN?{executablePath:process.env.CHROMIUM_BIN}:{}),args:['--no-sandbox']});
const checks:string[]=[],errors:string[]=[],external:string[]=[],failed:string[]=[];
async function seed(page:any,stored:any={}){
 await page.addInitScript(({stored}:any)=>{
   const clone=(v:any)=>JSON.parse(JSON.stringify(v));let target={deviceId:'mock-bolt',connectionId:'mock-link-1',name:'Protocol mock — not real hardware',profileId:'integem-crowbot-mqtt-v1'};
   let state:any={projectSessionId:'p',revision:1,status:'disconnected',currentDevice:null,activity:null};const watches:any[]=[],readers:any[]=[],vis:any[]=[],close:any[]=[];
   const context={apiVersion:'1.1.0',platform:'web',project:{sessionId:'p'},module:{id:'crowbot-parcel-pals',instanceId:'module-1'},grantedPermissions:['storage','device.read','device.connect','device.send','device.upload'],capabilities:{device:{available:true}}};
   const f:any={stored:clone(stored),uploads:[],sends:[],deviceWorkspace:null,cancelChooser:false,failSend:false,failStorage:false,confirmation:'device-confirmed',sequence:0,
     change(update:any){state={...state,...update,revision:state.revision+1};watches.forEach(fn=>fn(clone(state)));},hide(v:boolean){vis.forEach(fn=>fn(v));},foreign(){this.change({activity:{kind:'upload',owner:{type:'module',id:'another-module'}}});}};
   (window as any).__mock=f;window.confirm=()=>{throw new Error('Native confirm is not allowed in this test.');};
   (window as any).icreator={ready:async()=>clone(context),storage:{get:async(k:string)=>clone(f.stored[k]??null),set:async(k:string,v:any)=>{if(f.failStorage)throw new Error('Storage refused');f.stored[k]=clone(v);}},
     lifecycle:{onVisibilityChange:(fn:any)=>{vis.push(fn);return()=>{};},onDispose:(fn:any)=>{close.push(fn);return()=>{};}},
     device:{getState:async()=>clone(state),watchState:async(fn:any)=>{watches.push(fn);fn(clone(state));return()=>watches.splice(watches.indexOf(fn),1);},onData:async(fn:any)=>{readers.push(fn);return()=>readers.splice(readers.indexOf(fn),1);},
       connect:async()=>{if(f.cancelChooser){f.cancelChooser=false;throw new Error('USER_CANCELED');}f.change({currentDevice:target,status:'connected'});return clone(state);},disconnect:async()=>{f.change({currentDevice:null,status:'disconnected'});},
       send:async(req:any)=>{
         if(f.failSend)throw new Error('BUSY: mock failed write');if(!state.currentDevice||req.connectionId!==state.currentDevice.connectionId)throw new Error('STALE_CONNECTION');if(state.activity)throw new Error('BUSY');
         f.sends.push(clone(req));f.change({activity:{kind:'send',owner:{type:'module',id:'crowbot-parcel-pals'}}});
         if(req.text==='get_device_block_xml'){const bytes=new TextEncoder().encode(JSON.stringify(f.deviceWorkspace));for(let i=0;i<bytes.length;i+=3)readers.forEach(fn=>fn({...target,projectSessionId:'p',sequence:++f.sequence,timestamp:Date.now(),text:'',data:Array.from(bytes.slice(i,i+3))}));}
         await new Promise(r=>setTimeout(r,25));f.change({activity:null});
       },
       upload:async(req:any)=>{f.uploads.push(clone(req));f.deviceWorkspace=clone(req.artifact.workspace);f.change({activity:{kind:'upload',owner:{type:'module',id:'crowbot-parcel-pals'}}});return{jobId:'j'+f.uploads.length};},watchUpload:async(_job:string,fn:any)=>{fn({phase:'sending',progress:.5});return()=>{};},
       waitForUpload:async()=>{await new Promise(r=>setTimeout(r,90));f.change({activity:null});return {confirmation:f.confirmation};},cancelUpload:async()=>{f.change({currentDevice:null,activity:null});}}
   };
 },{stored});
}
const page=await browser.newPage({viewport:{width:1440,height:950}});
page.on('pageerror',(e:any)=>errors.push(e.message));page.on('request',(r:any)=>{if(!r.url().startsWith(assetBase)&&!r.url().startsWith('data:')&&!r.url().endsWith('/favicon.ico'))external.push(r.url());});page.on('response',(r:any)=>{if(r.status()>=400)failed.push(r.status()+' '+r.url());});
const shot=async(name:string)=>page.screenshot({path:'test-results/'+name+'.png',fullPage:true});
const waitScreen=async(n:string)=>page.waitForFunction((x:string)=>document.body.dataset.screen===x,n);
const student=()=>{};
async function buildMission(id:number){if(id===1)await page.click('#begin');else await page.click('#nextMission');await waitScreen('brief');await page.click('#build');await waitScreen('build');await page.waitForSelector('#student .blocklyDraggable');}
async function copy(){await page.locator('#help').evaluate((e:any)=>e.open=true);await page.click('#copyExample');await page.waitForSelector('#modal:not(.hidden)');await page.click('#modalYes');await page.waitForFunction(()=>!document.querySelector<HTMLButtonElement>('#toSetup')!.disabled);}
async function upload(){await page.click('#upload');await page.waitForFunction(()=>document.querySelector('#uploadNotice')!.textContent!.includes('upload acknowledged'));}
try{
 await seed(page);await page.goto(url);await page.waitForFunction(()=>!document.querySelector<HTMLButtonElement>('#begin')!.disabled);
 assert.equal(await page.locator('#homeScreen').isVisible(),true);assert.equal(await page.locator('#student').isVisible(),false);assert.equal(await page.locator('#tools').isVisible(),false);assert.equal(await page.locator('.missionCard').nth(1).isDisabled(),true);await shot('parcel-home');
 checks.push('quiet child-facing mission map; separate learning, launch and full-window real-floor delivery');
 await buildMission(1);assert.equal(await page.evaluate(()=> (window as any).__mock.sends.length),0);assert.equal(await page.locator('#toSetup').isDisabled(),true);await shot('parcel-build-blank');
 // Drag the solid title, not the empty statement socket, and verify real workspace coordinates.
 const drag=await page.evaluate(()=>{const B=(window as any).Blockly,w=B.Workspace.getAll().find((w:any)=>w.getInjectionDiv&&!w.isFlyout&&!w.options.readOnly),b=w.getTopBlocks(false)[0],r=b.getSvgRoot().querySelector('text').getBoundingClientRect(),p=b.getRelativeToSurfaceXY();return{x:r.x+12,y:r.y+8,before:p.x};});
 await page.mouse.move(drag.x,drag.y);await page.mouse.down();await page.mouse.move(drag.x+38,drag.y+27,{steps:12});await page.mouse.up();
 const moved=await page.evaluate(()=>{const B=(window as any).Blockly,w=B.Workspace.getAll().find((w:any)=>w.getInjectionDiv&&!w.isFlyout&&!w.options.readOnly);return w.getTopBlocks(false)[0].getRelativeToSurfaceXY().x;});assert.ok(Math.abs(moved-drag.before)>2);
 const resources=await page.evaluate(async()=>{const names=['handclosed.cur','handopen.cur','handdelete.cur','1x1.gif','click.mp3'];for(const n of names){const r=await fetch('./assets/vendor/media/'+n);if(!r.ok||(await r.arrayBuffer()).byteLength===0)return false;}return true;});assert.equal(resources,true);
 checks.push('actual student-block dragging and locally loaded .cur/GIF/audio resources at a nested module root');
 // Add a genuine orphan block: the rescue control must still work from a broken student draft.
 await page.evaluate(()=>{const B=(window as any).Blockly,w=B.Workspace.getAll().find((w:any)=>w.getInjectionDiv&&!w.isFlyout&&!w.options.readOnly);const b=w.newBlock('parcel_left');b.initSvg();b.render();b.moveBy(220,140);});await page.click('#check');assert.match(await page.locator('#feedback').innerText(),/ONE/);await copy();await shot('parcel-build-ready');
 checks.push('real Blockly blank draft, read-only example, invalid orphan feedback and backed-up rescue copy');
 await page.click('#toSetup');await waitScreen('setup');assert.equal(await page.locator('#start').isDisabled(),true);
 await page.evaluate(()=> (window as any).__mock.cancelChooser=true);await page.click('#connect');await page.waitForFunction(()=>!document.querySelector<HTMLButtonElement>('#connect')!.disabled);await page.click('#connect');await page.waitForFunction(()=>document.querySelector('#connection')!.classList.contains('connected'));await upload();assert.equal(await page.locator('#start').isDisabled(),true);
 checks.push('canceled chooser remains retryable; no moving action on connect/upload; supervision and floor-reset gates');
 const captured=await page.evaluate(()=>(window as any).__mock.uploads.at(-1));assert.equal(captured.artifact.workspacePolicy,'replace');assert.match(captured.artifact.source,/def MQTT/);assert.match(captured.artifact.workspace.blocks.blocks[0].data,/forwardMs/);
 await page.check('#floorReady');await page.locator('#tuningPanel').evaluate((e:any)=>e.open=true);await page.fill('#forwardMs','440');await page.click('#applyTuning');assert.equal(await page.locator('#testForward').isDisabled(),true);assert.equal(await page.locator('#start').isDisabled(),true);await upload();await page.click('#testForward');await page.waitForFunction(()=>document.querySelector('#testStatus')!.textContent!.includes('Test command sent'));assert.ok((await page.evaluate(()=>(window as any).__mock.sends.at(-1).text)).includes(':test:0:'));
 checks.push('wheel timing is serialized in the actual snapshot, changes generated Python, and requires re-upload; bounded explicit calibration test');
 await page.locator('#tuningPanel').evaluate((e:any)=>e.open=false);await page.check('#startReady');assert.equal(await page.locator('#start').isEnabled(),true);await shot('parcel-launch');
 // True production notification readback, not local saved workspace loading.
 await page.click('#toolsOpen');await page.click('#read');await page.waitForSelector('#readResult:not(.hidden)');await page.click('#replaceRead');await page.click('#modalYes');await waitScreen('build');assert.match(await page.locator('#codeLabel').textContent(),/recovered/);await page.click('#toSetup');await upload();await page.check('#startReady');
 checks.push('actual SDK upload/readback/edit/re-upload paths with fragmented mock notifications; no device-source claim');
 for(let mission=1;mission<=3;mission++){
   if(mission>1){await buildMission(mission);await copy();await page.click('#toSetup');await upload();await page.check('#floorReady');await page.check('#startReady');}
   await page.click('#start');await waitScreen('play');await page.waitForFunction(()=>!document.querySelector<HTMLButtonElement>('#drive')!.disabled);
   const bounds=await page.locator('#playScreen').boundingBox();assert.ok(bounds.width>=1439&&bounds.height>=949);assert.equal(await page.locator('#student').isVisible(),false);
   const cellSizes=await page.locator('#playBoard .tile').evaluateAll((nodes:any[])=>nodes.map(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})));assert.ok(cellSizes.every((s:any)=>Math.abs(s.width-s.height)<3),'Floor map uses equal square cells');
   if(mission===1){await page.evaluate(()=>{document.querySelector<HTMLElement>('#playScreen')!.requestFullscreen=()=>Promise.reject(new Error('Denied'));});await page.click('#fullscreen');await shot('parcel-delivery');}
   const steps=await page.evaluate(async()=>{const m=await import('./assets/model.js');return m.parse((window as any).__mock.deviceWorkspace).steps.length;});
   for(let step=0;step<steps;step++){
     const before=await page.evaluate(()=>(window as any).__mock.sends.length);await page.click('#drive');await page.waitForSelector('#observe:not(.hidden)');
     assert.equal(await page.evaluate(()=>(window as any).__mock.sends.length),before+1);assert.equal(await page.locator('#drive').isVisible(),false);
     const conf=await page.locator('#stepStrip .done').count();assert.equal(conf,step);await page.waitForTimeout(120);assert.equal(await page.locator('#stepStrip .done').count(),step);
     if(mission===2&&step===3)await shot('parcel-turn-observation');
     await page.click('#confirmStep');if(step+1<steps)await page.waitForFunction(()=>!document.querySelector<HTMLButtonElement>('#drive')!.disabled);
   }
   await waitScreen('result');assert.equal(await page.evaluate(()=>(window as any).__mock.sends.at(-1).text),'stop');assert.equal(await page.evaluate((i:number)=>(window as any).__mock.stored['parcel.v1.progress'].cleared[i],mission-1),true);
   checks.push(`mission ${mission}: complete uploaded route, one physical step per click, no progress until user observation, parking and delivery unlock`);
 }
 await shot('parcel-result');const persisted=await page.evaluate(()=>(window as any).__mock.stored);assert.deepEqual(persisted['parcel.v1.progress'].cleared,[true,true,true]);assert.ok(persisted['parcel.v1.stage.1'].blocks.blocks[0].data.includes('440'));
 // Reopen: no stale upload authorization. Mobile workshop uses tabs.
 const mobile=await browser.newPage({viewport:{width:700,height:940}});await seed(mobile,persisted);await mobile.goto(url);await mobile.waitForFunction(()=>!document.querySelector<HTMLButtonElement>('#begin')!.disabled);await mobile.click('#begin');await mobile.click('#build');await mobile.waitForSelector('#student .blocklyDraggable');await mobile.screenshot({path:'test-results/parcel-mobile.png',fullPage:true});assert.equal(await mobile.locator('#sample').isVisible(),false);await mobile.click('#tabExample');assert.equal(await mobile.locator('#sample').isVisible(),true);assert.equal(await mobile.locator('#student').isVisible(),false);assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await mobile.click('#tabStudent');await mobile.click('#toSetup');await mobile.click('#connect');await mobile.check('#floorReady');await mobile.check('#startReady');assert.equal(await mobile.locator('#start').isDisabled(),true);await mobile.close();
 checks.push('reopening preserves drafts/timing/progress but not live upload authorization; 700px learning tabs and no horizontal overflow');
 // Revisit valid route and stop while a step is in its observation cooldown.
 await page.click('#resultHome');await page.locator('.missionCard').first().click();await page.click('#build');await page.waitForSelector('#student .blocklyDraggable');await page.click('#toSetup');await upload();await page.check('#floorReady');await page.check('#startReady');await page.click('#start');await page.waitForFunction(()=>!document.querySelector<HTMLButtonElement>('#drive')!.disabled);await page.click('#drive');await page.click('#emergencyStop');await page.waitForFunction(()=>(window as any).__mock.sends.at(-1).text==='stop');await page.waitForTimeout(1200);assert.equal(await page.locator('#observe').isVisible(),false);assert.equal(await page.locator('#drive').isDisabled(),true);assert.equal(await page.evaluate(()=>(window as any).__mock.sends.at(-1).text),'stop');
 checks.push('mid-step STOP ends the run, cancels pending observation, and never queues an extra move');
 await page.click('#exitPlay');await waitScreen('setup');await upload();await page.check('#startReady');await page.click('#start');await page.waitForFunction(()=>!document.querySelector<HTMLButtonElement>('#drive')!.disabled);const count=await page.evaluate(()=>(window as any).__mock.sends.length);await page.evaluate(()=>(window as any).__mock.hide(false));await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>(window as any).__mock.sends.length),count);await page.evaluate(()=>(window as any).__mock.hide(true));assert.equal(await page.locator('#drive').isDisabled(),true);
 checks.push('hidden module sends nothing, invalidates the run/receipt and requires renewed attention');
 const noSdk=await browser.newPage();await noSdk.goto(url);await noSdk.waitForFunction(()=>!document.querySelector<HTMLButtonElement>('#begin')!.disabled);assert.match(await noSdk.locator('#sdkWarning').innerText(),/Open this module in iCreator/);await noSdk.close();
 checks.push('missing SDK is clearly labeled; release never fabricates a device or position telemetry');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(failed,[]);checks.push('zero uncaught browser errors, missing local resources or external runtime requests');
 await writeFile('test-results/browser.json',JSON.stringify({browser:browser.version(),mode:'headless Chromium; real Blockly and production ES modules; mocked iCreator SDK; no physical device, real host or Blob URL certification',checks,errors,external,failed},null,2));
 console.log(JSON.stringify({passed:checks.length,browser:browser.version()}));
}catch(e){await shot('failure');await writeFile('test-results/browser-failure.json',JSON.stringify({error:String(e),errors,external,failed},null,2));throw e;}finally{await browser.close();server.close();}
