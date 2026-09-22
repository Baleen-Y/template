import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { resolve,sep } from 'node:path';
import assert from 'node:assert/strict';
import { mimeFor } from '../release-policy.ts';
const root=resolve('../../flappy-ble'), prefix='/sandbox/project/modules/flappy-ble/';
const server=createServer(async(req,res)=>{
  try{
    const path=decodeURIComponent(new URL(req.url??'/','http://localhost').pathname);
    if(path==='/favicon.ico'){res.writeHead(204).end();return;}
    if(!path.startsWith(prefix)){res.writeHead(403).end();return;}
    const local=path.slice(prefix.length)||'index.html';
    // Test-only fixtures, never shipped as application privileges.
    if(['assets/unknown.testdata','assets/EXTENSIONLESS'].includes(local)){res.writeHead(200,{'Content-Type':mimeFor(local)}).end(Buffer.from([0,19,255,42]));return;}
    const file=resolve(root,local);
    if(!file.startsWith(root+sep)){res.writeHead(403).end();return;}
    res.writeHead(200,{'Content-Type':mimeFor(file)}).end(await readFile(file));
  }catch{res.writeHead(404).end();}
});
await new Promise<void>(ok=>server.listen(0,'127.0.0.1',ok));
const address=server.address();if(!address||typeof address==='string')throw new Error('Server failed');
const origin=`http://127.0.0.1:${address.port}`,url=origin+prefix;
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors:string[]=[],failed:string[]=[],requests:string[]=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
page.on('response',r=>{if(r.status()>=400)failed.push(r.status()+' '+r.url());});
page.on('requestfailed',r=>failed.push(r.url()));
try{
  await page.goto(url,{waitUntil:'networkidle'});
  const block=page.locator('#student .blocklyDraggable').first();await block.waitFor();await block.hover();
  const normal=await block.evaluate(el=>getComputedStyle(el).cursor);
  assert.ok(normal.includes('handopen.cur'));assert.match(normal,/grab/);
  const box=await block.boundingBox();if(!box)throw new Error('Block not visible');
  await page.mouse.move(box.x+35,box.y+18);await page.mouse.down();await page.mouse.move(box.x+100,box.y+80,{steps:12});await page.mouse.up();
  const css=await page.evaluate(()=>{
    const dynamic=document.querySelector('#blockly-common-style')?.textContent??'';
    const probe=document.createElement('div');probe.className='blocklyDragging blocklyDraggingDelete';document.body.append(probe);
    const deletion=getComputedStyle(probe).cursor;probe.remove();
    return{dynamic,deletion,base:document.baseURI};
  });
  assert.ok(css.dynamic.includes('assets/vendor/media/handdelete.cur'));
  assert.ok(css.deletion.includes('handdelete.cur'));assert.match(css.deletion,/no-drop/);
  const cursorUrls=[...css.dynamic.matchAll(/url\(["']?([^"')]*\.cur)["']?\)/g)].map(m=>new URL(m[1],css.base).href);
  assert.ok(cursorUrls.length>=3);assert.ok(cursorUrls.every(v=>v.startsWith(url+'assets/vendor/media/')));
  await page.locator('.statusPanel details').evaluate(el=>(el as HTMLDetailsElement).open=true);
  await page.click('#checkResources');await page.waitForFunction(()=>document.querySelector('#resourceStatus')?.textContent?.includes('bundled media files passed'));
  assert.ok((await page.locator('#resourceStatus').innerText()).includes('SHA-256'));
  for(const name of ['handclosed.cur','handopen.cur','handdelete.cur','click.ogg','click.mp3','click.wav','1x1.gif'])assert.ok(requests.includes(url+'assets/vendor/media/'+name),name);
  const data=await page.evaluate(async()=>{
    const results=[];
    for(const path of ['./assets/unknown.testdata','./assets/EXTENSIONLESS']){
      const r=await fetch(path);results.push({type:r.headers.get('content-type'),bytes:Array.from(new Uint8Array(await r.arrayBuffer()))});
    }
    return results;
  });
  assert.deepEqual(data,[{type:'application/octet-stream',bytes:[0,19,255,42]},{type:'application/octet-stream',bytes:[0,19,255,42]}]);
  // Test custom cursor image decoding, not only existence of a URL.
  const image=await page.evaluate(async()=>{const img=new Image();img.src='./assets/vendor/media/handdelete.cur';await img.decode();return {width:img.naturalWidth,height:img.naturalHeight};});
  assert.ok(image.width>0&&image.height>0);
  await page.click('#fitStudent');
  assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
  assert.ok(requests.every(v=>v.startsWith(origin)));
  await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/resources-402.png',fullPage:true});
  await writeFile('test-results/import-media.json',JSON.stringify({browser:browser.version(),checks:[
    'complete Blockly media loads at a nested module root, including all three .cur and audio/GIF data',
    'exact upstream Blockly renders and drags; custom cursors retain native fallbacks',
    'static CSS and dynamic Blockly CSS resolve to the module-owned media directory',
    'Chromium decodes the custom .cur image, not just its URL',
    'resource diagnostics verifies every bundled media file by length and SHA-256',
    'unknown-extension and extensionless fixture data can be fetched as application/octet-stream',
    'student Fit control works; zero failed local resource requests, uncaught errors or external requests'
  ],mode:'headless Chromium with a contract-derived nested-path HTTP harness; not actual iCreator import or Blob URL mapping'},null,2));
}catch(e){await page.screenshot({path:'test-results/resource-failure.png',fullPage:true}).catch(()=>{});await writeFile('test-results/resource-failure.txt',String(e)+'\n'+JSON.stringify({errors,failed,requests}));throw e;}
finally{await browser.close();await new Promise<void>(ok=>server.close(()=>ok()));}
