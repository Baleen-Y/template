import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { auditRelease, validateNames } from './release-policy.ts';
const root=resolve('../..'),release=join(root,'flappy-ble');
const manifest=JSON.parse(await readFile(join(release,'module.json'),'utf8'));
const version=manifest.version;
const course=JSON.parse(await readFile('test-results/browser.json','utf8'));
const media=JSON.parse(await readFile('test-results/import-media.json','utf8'));
const tests=await readFile('test-results/core.tap','utf8');
if(!course.passed||!/^# fail 0$/m.test(tests))throw new Error('Cannot publish without successful course and unit tests');
const number=tests.match(/^# pass (\d+)$/m)?.[1]??'unknown';
const text=`# Verification — Flappy BLE ${version}\n\nSource commit: ${process.env.SOURCE_COMMIT??'local development (not a host test)'}\n\nStrict TypeScript 5.8.3 build; ${number} production-code unit/protocol/resource checks passed.\n\nBrowser: ${course.browser}\n\n${course.mode}\n\n${course.checks.concat(media.checks).map((x:string)=>'- '+x).join('\n')}\n\nResource-test scope: ${media.mode}.\n\nPackaging uses the supplied 2026-09-22 contract's resource policy and keeps the canonical flappy-ble/ ZIP root. Unknown extensions are retained as data; filesystem/path/secret/duplicate/size protections remain.\n\nActual iCreator desktop/web import, the target host shared module-kit validator, host-owned Blob URL remapping, and physical BLE hardware: NOT TESTED. The target host repository/validator was not available. This package requires the installed host resource-import update, not merely a changed prompt.\n`;
await writeFile(join(release,'VERIFICATION.md'),text);
const report=await auditRelease(release);validateNames(report.names);
await mkdir(join(root,'downloads'),{recursive:true});
const archive=join(root,'downloads',`flappy-ble-${version}.zip`);
const packed=spawnSync('python3',['-c',`import json,sys,pathlib,zipfile,stat
root=pathlib.Path(sys.argv[1]);out=sys.argv[2];names=json.loads(sys.stdin.read())
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
 for n in names:
  p=root/n
  if p.is_symlink():raise RuntimeError('symlink')
  z.write(p,n)
with zipfile.ZipFile(out) as z:
 assert z.namelist()==names
 assert len(names)==len(set(n.casefold() for n in names))
 assert z.testzip() is None
 assert all(not stat.S_ISLNK(i.external_attr>>16) for i in z.infolist())
print(out)
`,root,archive],{input:JSON.stringify(report.names),encoding:'utf8'});
if(packed.status!==0)throw new Error(packed.stderr);
await writeFile('test-results/archive.json',JSON.stringify({file:archive.split('/').slice(-2).join('/'),...report},null,2));
console.log(packed.stdout);
