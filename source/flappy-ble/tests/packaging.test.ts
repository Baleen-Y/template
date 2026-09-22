import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve,join } from 'node:path';
import { readFile,readdir,mkdtemp,cp,symlink,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { validateNames,inspectNames,auditRelease,mimeFor } from '../release-policy.ts';
const entry=['flappy-ble/module.json','flappy-ble/index.html'];
test('2026-09-22 policy accepts .cur, audio, video, fonts and arbitrary data extensions',()=>{
  for(const n of ['handclosed.cur','handopen.cur','handdelete.cur','click.ogg','sound.wav','film.mp4','text.woff2','CUSTOM','custom.data'])validateNames([...entry,'flappy-ble/assets/'+n]);
  assert.equal(mimeFor('handopen.cur'),'image/x-icon');assert.equal(mimeFor('click.ogg'),'audio/ogg');
  assert.equal(mimeFor('CUSTOM'),'application/octet-stream');assert.equal(mimeFor('custom.data'),'application/octet-stream');
});
test('unique flat and wrapped roots accepted; ambiguous roots and unrelated files rejected',()=>{
  assert.equal(inspectNames(['module.json','index.html','assets/a.cur']).root,'');
  assert.equal(inspectNames(entry.map(n=>'parent/'+n)).root,'parent/flappy-ble/');
  assert.throws(()=>validateNames([...entry,'second/module.json','second/index.html']),/one module root/);
  assert.throws(()=>validateNames([...entry,'unrelated.txt']),/outside module root/);
});
test('case-insensitive duplicates and file-directory collisions remain rejected',()=>{
  assert.throws(()=>validateNames([...entry,entry[0]]),/Duplicate/);
  assert.throws(()=>validateNames([...entry,'flappy-ble/A.cur','flappy-ble/a.cur']),/Duplicate/);
  assert.throws(()=>validateNames([...entry,'flappy-ble/assets','flappy-ble/assets/cursor.cur']),/collision/);
});
test('unsafe paths, reserved filenames, secret files and development folders remain rejected',()=>{
  for(const n of ['../index.html','assets\\evil.js','C:/evil','/absolute','CON.cur','trailing.','node_modules/a.js','.git/config','.env','.env.local'])assert.throws(()=>validateNames([...entry,'flappy-ble/'+n]),/Unsafe|Forbidden/);
});
test('known system metadata is ignored and listed, rather than copied as runtime assets',()=>{
  const r=inspectNames([...entry,'.DS_Store','__MACOSX/._test','flappy-ble/Thumbs.db','flappy-ble/desktop.ini','flappy-ble/assets/._sprites.png']);
  assert.equal(r.kept.length,2);assert.equal(r.ignored.length,5);
});
test('built release restores every upstream media file with byte identity, including all three cursors',async()=>{
  const report=await auditRelease(resolve('../../flappy-ble'));
  const files=await readdir('node_modules/blockly/media');
  for(const name of files){
    const relative='flappy-ble/assets/vendor/media/'+name;assert.ok(report.names.includes(relative),relative);
    assert.deepEqual(await readFile('../../'+relative),await readFile('node_modules/blockly/media/'+name));
  }
  assert.ok(files.includes('handclosed.cur'));assert.ok(files.includes('click.ogg'));
});
test('restored Blockly core is byte-identical to pinned upstream, not the native-only patch',async()=>{
  const bytes=await readFile('../../flappy-ble/assets/vendor/blockly_compressed.js');
  const sha=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  assert.equal(sha,'6b95d5457eb4ebc4dd8adb090c1de0c6709dc16f');
  assert.equal(bytes.toString().includes('Flappy BLE 4.0.1 modification'),false);
  assert.equal((bytes.toString().match(/hand(?:open|closed|delete)\.cur/g)??[]).length,8);
});
test('resource inventory has correct sizes and hashes for all runtime media',async()=>{
  const inventory=JSON.parse(await readFile('../../flappy-ble/assets/resource-inventory.json','utf8'));
  assert.equal(inventory.schema,1);
  for(const item of inventory.files){const bytes=await readFile('../../flappy-ble/'+item.path);assert.equal(item.bytes,bytes.length);assert.equal(item.sha256,createHash('sha256').update(bytes).digest('hex'));}
  assert.equal(inventory.files.length,(await readdir('node_modules/blockly/media')).length);
});
test('static cursor references use CSS-relative paths and native fallback keywords',async()=>{
  const css=await readFile('../../flappy-ble/assets/style.css','utf8');
  for(const [file,keyword]of[['handopen','grab'],['handclosed','grabbing'],['handdelete','no-drop']])assert.ok(css.includes(`url("./vendor/media/${file}.cur"), ${keyword}`));
});
test('release filesystem audit rejects symlinks',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'flappy-audit-'));
  try{await cp('../../flappy-ble/module.json',join(temp,'module.json'));await cp('../../flappy-ble/index.html',join(temp,'index.html'));await symlink('index.html',join(temp,'alias'));await assert.rejects(auditRelease(temp),/Symlink/);}
  finally{await rm(temp,{recursive:true,force:true});}
});
