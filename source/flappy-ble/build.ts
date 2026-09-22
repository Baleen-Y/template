import { cp, readFile, writeFile, rm, mkdir, readdir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const root = resolve('../..'), release = join(root, 'flappy-ble');
await mkdir(join(release, 'assets'), {recursive:true});
for (const name of ['index.html','module.json','README.md','THIRD_PARTY_NOTICES.md']) await cp(join('static',name),join(release,name));
await cp('static/style.css',join(release,'assets/style.css'));
await cp('static/crowbot-adapter.json',join(release,'assets/crowbot-adapter.json'));
// These obsolete scripts are no longer referenced. Keep the already-vendored Blockly core unchanged.
for (const name of ['device-blocks.js','crowbot-adapter.js','custom-blocks.js']) await rm(join(release,'assets',name),{force:true});
if (process.env.CI) {
  // Verify the exact pinned core from the repository, never a network runtime dependency.
  const {createHash}=await import('node:crypto');
  const core=await readFile(join(release,'assets/vendor/blockly_compressed.js'));
  const blob=createHash('sha1').update(`blob ${core.length}\0`).update(core).digest('hex');
  if(blob!=='6b95d5457eb4ebc4dd8adb090c1de0c6709dc16f') throw new Error('Unexpected vendored Blockly core');
}
try { await cp('node_modules/blockly/LICENSE',join(release,'LICENSE.blockly.txt')); await cp('node_modules/blockly/media',join(release,'assets/vendor/media'),{recursive:true}); }
catch(e) { if(process.env.CI) throw e; }
let count=0,total=0;
async function walk(dir){ for(const name of await readdir(dir)){const path=join(dir,name),info=await stat(path); if(info.isDirectory()) await walk(path); else {count++;total+=info.size; if(info.size>16*1024*1024) throw new Error('Oversized resource');}} }
await walk(release);
if(count>1024 || total>64*1024*1024) throw new Error('Module exceeds packaging limits');
console.log(JSON.stringify({build:'Flappy BLE 4.0.0',files:count,bytes:total}));
