import { cp, readFile, writeFile, rm, mkdir, readdir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
const root = resolve('../..'), release = join(root, 'flappy-ble');
await mkdir(join(release, 'assets'), {recursive:true});
for (const name of ['index.html','module.json','README.md','THIRD_PARTY_NOTICES.md']) await cp(join('static',name),join(release,name));
await cp('static/style.css',join(release,'assets/style.css'));
await cp('static/crowbot-adapter.json',join(release,'assets/crowbot-adapter.json'));
for (const name of ['device-blocks.js','crowbot-adapter.js','custom-blocks.js']) await rm(join(release,'assets',name),{force:true});
const gitBlob = (bytes: Buffer): string => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
if (process.env.CI) {
  const core=await readFile(join(release,'assets/vendor/blockly_compressed.js'));
  if(gitBlob(core)!=='6b95d5457eb4ebc4dd8adb090c1de0c6709dc16f') throw new Error('Unexpected vendored Blockly core');
}
// Build-time only: npm 8.0.0 omits LICENSE. Verify the official tag's license before vendoring.
let license: Buffer | null = null;
for(const name of ['LICENSE','LICENSE.txt','LICENSE.md']) {
  try {license=await readFile(join('node_modules/blockly',name));break;} catch {}
}
if(!license){
  const response=await fetch('https://raw.githubusercontent.com/RaspberryPiFoundation/blockly/8.0.0/LICENSE');
  if(!response.ok) throw new Error('Could not retrieve the pinned Blockly license');
  license=Buffer.from(await response.arrayBuffer());
  if(gitBlob(license)!=='d645695673349e3947e8e5ae42332d0ac3164cd7') throw new Error('Unexpected upstream license contents');
}
await writeFile(join(release,'LICENSE.blockly.txt'),license);
await cp('node_modules/blockly/media',join(release,'assets/vendor/media'),{recursive:true});
let count=0,total=0;
async function walk(dir: string): Promise<void> {
  for(const name of await readdir(dir)){
    const path=join(dir,name),info=await stat(path);
    if(info.isDirectory()) await walk(path);
    else {count++;total+=info.size;if(info.size>16*1024*1024) throw new Error('Oversized resource');}
  }
}
await walk(release);
if(count>1024 || total>64*1024*1024) throw new Error('Module exceeds packaging limits');
console.log(JSON.stringify({build:'Flappy BLE 4.0.0',files:count,bytes:total}));
