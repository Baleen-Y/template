import {readFile,writeFile,readdir,lstat,mkdir} from 'node:fs/promises';import {resolve,join,relative} from 'node:path';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
const root=resolve('../../crowbot-parcel-pals'),results=resolve('test-results');
const browser=JSON.parse(await readFile(join(results,'browser.json'),'utf8'));
const tap=await readFile(join(results,'core.tap'),'utf8');const pass=Number(tap.match(/# pass (\d+)/)?.[1]);if(!pass||!/# fail 0\b/.test(tap)||browser.errors.length||browser.external.length||browser.failed.length)throw new Error('Tests did not all pass.');
const verification=`# Verification — Crowbot Parcel Pals 1.0.0\n\nSource commit: ${process.env.SOURCE_COMMIT??'local working source'}\n\nStrict TypeScript 5.8.3 build; ${pass} production-code unit/protocol tests passed.\n\nBrowser: ${browser.browser}\n${browser.mode}\n\n${browser.checks.map((x:string)=>'- '+x).join('\n')}\n\nThe Python callback was syntax/execution-tested in CPython with inert stub motor/light functions, including stop cleanup and stale/duplicate/out-of-order message guards. This is not physical MicroPython execution.\n\nThe screen shows a plan and user-observed confirmations, not location telemetry. Motion durations, turning accuracy and real floor routes require adult calibration and physical validation. No automatic arrival or physical success is claimed.\n\nActual iCreator App/Web import, official target-host module-kit validator, host Blob URL rewriting, physical Crowbot and its installed firmware: NOT TESTED. No host repository or physical device was available. Resource tests are a local nested-path HTTP harness.\n`;
await writeFile(join(root,'VERIFICATION.md'),verification);
const files:string[]=[],seen=new Set<string>();let bytes=0;
async function walk(dir:string){for(const name of await readdir(dir)){const p=join(dir,name),s=await lstat(p),r=relative(root,p).replaceAll('\\','/');if(s.isSymbolicLink())throw new Error('Symlink: '+r);if(name==='node_modules'||name==='.git'||name.startsWith('.env'))throw new Error('Forbidden build/secret path');if(s.isDirectory()){await walk(p);continue;}const key=r.toLowerCase();if(seen.has(key))throw new Error('Duplicate path');seen.add(key);if(!s.isFile()||s.size>16*1024*1024)throw new Error('Invalid resource');files.push(r);bytes+=s.size;}}
await walk(root);if(bytes>64*1024*1024||files.length>1024)throw new Error('Package too large');
for(const ext of ['.ttf','.otf','.woff','.woff2'])if(files.some(f=>f.endsWith(ext)))throw new Error('Do not distribute environment font files');
const manifest=JSON.parse(await readFile(join(root,'module.json'),'utf8'));if(manifest.id!=='crowbot-parcel-pals'||manifest.version!=='1.0.0')throw new Error('Wrong manifest');
await mkdir('../../downloads',{recursive:true});
execFileSync('python3',['-c',`import pathlib,zipfile,stat
root=pathlib.Path('../../crowbot-parcel-pals')
zip_path=pathlib.Path('../../downloads/crowbot-parcel-pals-1.0.0.zip')
with zipfile.ZipFile(zip_path,'w',zipfile.ZIP_DEFLATED) as z:
 for p in sorted(root.rglob('*')):
  if p.is_file(): z.write(p,'crowbot-parcel-pals/'+p.relative_to(root).as_posix())
with zipfile.ZipFile(zip_path) as z:
 names=z.namelist()
 assert len(names)==len({n.casefold() for n in names})
 assert 'crowbot-parcel-pals/module.json' in names and 'crowbot-parcel-pals/index.html' in names
 for n in names:
  assert n.startswith('crowbot-parcel-pals/') and not any(p in ('','..','.') for p in n.split('/'))
  assert '\\\\' not in n and ':' not in n
 assert z.testzip() is None
print('Archive paths and CRC verified: '+str(zip_path))
`],{stdio:'inherit'});
const zip=await readFile('../../downloads/crowbot-parcel-pals-1.0.0.zip');await writeFile(join(results,'archive.json'),JSON.stringify({files,uncompressedBytes:bytes,zipBytes:zip.length,sha256:createHash('sha256').update(zip).digest('hex')},null,2));
console.log(JSON.stringify({files:files.length,bytes,zipBytes:zip.length,tests:pass}));
