import { cp, readFile, writeFile, rm, mkdir, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { auditRelease, mimeFor } from './release-policy.ts';
const root = resolve('../..'), release = join(root, 'flappy-ble');
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const version: string = pkg.version;
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error('Invalid release version');
const model = await readFile('src/model.ts', 'utf8');
if (!/^export const VERSION = '[^']+';/m.test(model)) throw new Error('Missing version declaration');
await writeFile('src/model.ts', model.replace(/^export const VERSION = '[^']+';/m, `export const VERSION = '${version}';`));
const manifest = JSON.parse(await readFile('static/module.json', 'utf8')); manifest.version = version;
await writeFile('static/module.json', JSON.stringify(manifest) + '\n');
const html = await readFile('static/index.html', 'utf8');
await writeFile('static/index.html', html.replace(/(<span id="version" class="version">)v[\d.]+(<\/span>)/, `$1v${version}$2`));
const compile = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], {stdio:'inherit'});
if (compile.status !== 0) throw new Error('Strict TypeScript build failed');
await mkdir(join(release, 'assets'), {recursive:true});
for (const name of ['index.html','module.json','README.md','THIRD_PARTY_NOTICES.md']) await cp(join('static',name),join(release,name));
await cp('static/style.css',join(release,'assets/style.css'));
await cp('static/crowbot-adapter.json',join(release,'assets/crowbot-adapter.json'));
for (const name of ['device-blocks.js','crowbot-adapter.js','custom-blocks.js']) await rm(join(release,'assets',name),{force:true});
const gitBlob = (bytes: Buffer): string => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const corePath = join(release,'assets/vendor/blockly_compressed.js');
let core = await readFile(corePath);
const originalHash = '6b95d5457eb4ebc4dd8adb090c1de0c6709dc16f';
if (gitBlob(core) === '1871230d477c5d8acde0e6b1077a1a445f82c365') {
  // Reverse ONLY the verified 4.0.1 patch, then require exact upstream byte identity.
  let text = core.toString('utf8').replace(/^\/\/ Flappy BLE 4\.0\.1 modification:[^\n]*\n/, '');
  text = text.replace(/cursor: grab;\\n  cursor: grab;/g, 'cursor: url("<<<PATH>>>/handopen.cur"), auto;\\n  cursor: grab;')
    .replace(/cursor: grabbing;\\n  cursor: grabbing;/g, 'cursor: url("<<<PATH>>>/handclosed.cur"), auto;\\n  cursor: grabbing;')
    .replace(/cursor: no-drop;/g, 'cursor: url("<<<PATH>>>/handdelete.cur"), auto;');
  core = Buffer.from(text, 'utf8');
}
if (gitBlob(core) !== originalHash) throw new Error('Bundled core does not match official Blockly 8.0.0; no unverified patch was accepted');
await writeFile(corePath, core);
const blocklyPackage = JSON.parse(await readFile('node_modules/blockly/package.json','utf8'));
if (blocklyPackage.version !== '8.0.0') throw new Error('Unexpected Blockly media version');
// Preserve the entire pinned upstream runtime media tree. Uncommon formats are data, not a reason to delete.
const media = join(release,'assets/vendor/media');
await rm(media,{recursive:true,force:true});
await cp('node_modules/blockly/media',media,{recursive:true, dereference:false});
const inventory: {path:string; bytes:number; sha256:string; mime:string}[] = [];
async function inventoryDirectory(relative: string): Promise<void> {
  for (const entry of await readdir(join(release,relative),{withFileTypes:true})) {
    const path = relative+'/'+entry.name;
    if (entry.isSymbolicLink()) throw new Error('Unexpected symlink in upstream media');
    if (entry.isDirectory()) await inventoryDirectory(path);
    else if (entry.isFile()) { const bytes = await readFile(join(release,path)); inventory.push({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),mime:mimeFor(path)}); }
    else throw new Error('Unsupported media filesystem entry');
  }
}
await inventoryDirectory('assets/vendor/media');
await writeFile(join(release,'assets/resource-inventory.json'),JSON.stringify({schema:1,version,files:inventory.sort((a,b)=>a.path.localeCompare(b.path))},null,2)+'\n');
const license = await readFile(join(release,'LICENSE.blockly.txt'));
if (gitBlob(license) !== 'd645695673349e3947e8e5ae42332d0ac3164cd7') throw new Error('Pinned Blockly license missing or changed');
const report = await auditRelease(release);
await mkdir('test-results',{recursive:true});
await writeFile('test-results/package-policy.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({build:`Flappy BLE ${version}`, ...report}));
