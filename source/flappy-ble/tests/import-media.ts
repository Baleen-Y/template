import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve('../../flappy-ble');
const server = createServer(async (req,res) => {
  try {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    if (path === '/favicon.ico') {res.writeHead(204).end();return;}
    const file = resolve(root,'.'+(path === '/' ? '/index.html' : path));
    if (!file.startsWith(root+sep) || !['.html','.js','.css','.svg','.png','.json','.md','.txt'].includes(extname(file))) {res.writeHead(403).end();return;}
    const types:Record<string,string> = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
    const data = await readFile(file);res.writeHead(200,{'Content-Type':types[extname(file)] ?? 'text/plain'}).end(data);
  } catch {res.writeHead(404).end();}
});
await new Promise<void>(ok => server.listen(0,'127.0.0.1',ok));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Test server failed');
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1440,height:1000}});
const errors:string[] = [], failed:string[] = [], requests:string[] = [];
page.on('pageerror', e => errors.push(e.message));
page.on('request', r => requests.push(r.url()));
page.on('response', r => {if (r.status() >= 400) failed.push(r.status()+' '+r.url());});
page.on('requestfailed', r => failed.push(r.url()));
try {
  await page.goto(`http://127.0.0.1:${address.port}/`,{waitUntil:'networkidle'});
  const block = page.locator('#student .blocklyDraggable').first();
  await block.waitFor(); await block.hover();
  const normal = await block.evaluate(el => getComputedStyle(el).cursor);
  assert.match(normal,/grab/);
  const box = await block.boundingBox(); if (!box) throw new Error('Student block not visible');
  await page.mouse.move(box.x+35,box.y+18); await page.mouse.down();
  await page.mouse.move(box.x+100,box.y+80,{steps:12}); await page.mouse.up();
  // Force each special CSS state as a regression test for previously URL-only delete cursors.
  const css = await page.evaluate(() => {
    const normal = document.querySelector('#blockly-common-style')?.textContent ?? '';
    const probe = document.createElement('div'); probe.className='blocklyDragging blocklyDraggingDelete'; document.body.append(probe);
    const deletion = getComputedStyle(probe).cursor; probe.remove();
    return {normal,deletion};
  });
  assert.ok(!css.normal.includes('.cur')); assert.equal(css.deletion,'no-drop');
  await page.waitForTimeout(200);
  assert.deepEqual(errors,[]); assert.deepEqual(failed,[]);
  assert.ok(requests.every(url => url.startsWith(`http://127.0.0.1:${address.port}/`)));
  assert.ok(requests.every(url => !/\.(cur|wav|ogg|mp3)(?:$|\?)/i.test(url)));
  await mkdir('test-results',{recursive:true});
  await page.screenshot({path:'test-results/import-safe-editor.png',fullPage:true});
  await writeFile('test-results/import-media.json',JSON.stringify({browser:browser.version(),checks:['actual Blockly renders and drags with PNG/SVG-only media','native grab and delete cursors','no .cur requests or injected cursor URLs','zero failed asset requests and uncaught browser errors'],mode:'headless Chromium resource-restricted HTTP test; not the actual iCreator importer'},null,2));
} finally {await browser.close(); await new Promise<void>(ok => server.close(() => ok()));}
