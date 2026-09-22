import { cp, readFile, writeFile, rm, mkdir, readdir } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { auditRelease } from './release-policy.ts';
const root = resolve('../..'), release = join(root, 'flappy-ble');
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const version: string = pkg.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version');
// package.json is the version source. Stamp tracked sources BEFORE strict compilation.
const modelPath = 'src/model.ts';
const model = await readFile(modelPath, 'utf8');
if (!/^export const VERSION = '[^']+';/m.test(model)) throw new Error('Version declaration missing');
await writeFile(modelPath, model.replace(/^export const VERSION = '[^']+';/m, `export const VERSION = '${version}';`));
const manifest = JSON.parse(await readFile('static/module.json', 'utf8'));
manifest.version = version;
await writeFile('static/module.json', JSON.stringify(manifest) + '\n');
const html = await readFile('static/index.html', 'utf8');
await writeFile('static/index.html', html.replace(/(<span id="version" class="version">)v[\d.]+(<\/span>)/, `$1v${version}$2`));
let readme = (await readFile('static/README.md', 'utf8')).replace(/^(# Flappy BLE — Three-stage Quest )\d+\.\d+\.\d+/m, `$1${version}`);
if (!readme.includes('## 4.0.1 import packaging fix')) readme += '\n\n## 4.0.1 import packaging fix\n\nThe previous ZIP included Blockly legacy Windows cursor assets (.cur), which the iCreator importer rejected. The build now cleans the media directory and copies only PNG/SVG images. Unused audio and GIF files are omitted because the editor has sounds disabled. Eight legacy cursor URL declarations in the pinned Blockly 8.0.0 bundle are replaced with native grab/grabbing/no-drop cursors; original license notices are retained.\n\nA release-path policy and negative regression tests reject unsupported files, duplicates and symlinks before ZIP delivery. This is a conservative module-owned packaging check, not the unavailable official host validator. The curriculum, stage drafts, progress keys, upload/readback and priority STOP behavior are unchanged.\n';
await writeFile('static/README.md', readme);
await writeFile('static/THIRD_PARTY_NOTICES.md', '# Third-party notices\n\nBlockly core 8.0.0 is distributed under Apache-2.0 (Google LLC and Blockly contributors). Flappy BLE 4.0.1 modifies only eight legacy cursor CSS declarations in the pinned core, replacing .cur URL assets with native grab/grabbing/no-drop cursors. The patched file carries a modification notice; original copyright notices are retained. PNG/SVG UI media are copied from the pinned blockly@8.0.0 development package. See LICENSE.blockly.txt. No CDN is loaded at runtime.\n\nPlaywright and TypeScript are development-only dependencies, not runtime requirements.\n');
const compile = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], {stdio:'inherit'});
if (compile.status !== 0) throw new Error('Strict TypeScript build failed');
await mkdir(join(release, 'assets'), {recursive:true});
for (const name of ['index.html','module.json','README.md','THIRD_PARTY_NOTICES.md']) await cp(join('static',name),join(release,name));
await cp('static/style.css',join(release,'assets/style.css'));
await cp('static/crowbot-adapter.json',join(release,'assets/crowbot-adapter.json'));
for (const name of ['device-blocks.js','crowbot-adapter.js','custom-blocks.js']) await rm(join(release,'assets',name),{force:true});
const gitBlob = (bytes: Buffer): string => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const corePath = join(release, 'assets/vendor/blockly_compressed.js');
const core = await readFile(corePath);
const originalHash = '6b95d5457eb4ebc4dd8adb090c1de0c6709dc16f';
const patchedHash = '1871230d477c5d8acde0e6b1077a1a445f82c365';
if (gitBlob(core) === originalHash) {
  let replacements = 0;
  const cursors: Record<string,string> = {handopen:'grab',handclosed:'grabbing',handdelete:'no-drop'};
  const text = core.toString('utf8').replace(/cursor: url\("<<<PATH>>>\/(handopen|handclosed|handdelete)\.cur"\), auto;/g,
    (_match, name: string) => { replacements++; return `cursor: ${cursors[name]};`; });
  const header = '// Flappy BLE 4.0.1 modification: legacy .cur URL cursors replaced with native CSS grab/grabbing/no-drop. Upstream Blockly 8.0.0; original license notices retained.\n';
  const patched = Buffer.from(header + text, 'utf8');
  if (replacements !== 8 || gitBlob(patched) !== patchedHash) throw new Error('Unexpected Blockly cursor patch');
  await writeFile(corePath, patched);
} else if (gitBlob(core) !== patchedHash) throw new Error('Unexpected vendored Blockly core');
// Never copy the full upstream media directory: .cur is rejected by the host importer.
const media = join(release,'assets/vendor/media');
await rm(media,{recursive:true,force:true});
await mkdir(media,{recursive:true});
for (const item of await readdir('node_modules/blockly/media',{withFileTypes:true})) {
  if (item.isFile() && ['.png','.svg'].includes(extname(item.name))) await cp(join('node_modules/blockly/media',item.name),join(media,item.name));
}
let license: Buffer | null = null;
for (const path of [join(release,'LICENSE.blockly.txt'),'node_modules/blockly/LICENSE','node_modules/blockly/LICENSE.txt','node_modules/blockly/LICENSE.md']) {
  try { const candidate = await readFile(path); if (gitBlob(candidate) === 'd645695673349e3947e8e5ae42332d0ac3164cd7') {license=candidate;break;} } catch {}
}
if (!license) {
  const response = await fetch('https://raw.githubusercontent.com/RaspberryPiFoundation/blockly/8.0.0/LICENSE');
  if (!response.ok) throw new Error('Could not retrieve pinned Blockly license');
  license = Buffer.from(await response.arrayBuffer());
  if (gitBlob(license) !== 'd645695673349e3947e8e5ae42332d0ac3164cd7') throw new Error('Unexpected upstream license');
}
await writeFile(join(release,'LICENSE.blockly.txt'),license);
const report = await auditRelease(release);
await mkdir('test-results',{recursive:true});
await writeFile('test-results/package-policy.json', JSON.stringify(report,null,2));
console.log(JSON.stringify({build:`Flappy BLE ${version}`, ...report}));
