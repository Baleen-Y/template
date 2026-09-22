import {readFile,writeFile,cp,mkdir,readdir,stat,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
const release=resolve('../../crowbot-parcel-pals');await mkdir(join(release,'assets'),{recursive:true});
// Locally bundled Blockly and all its media are retained from the same verified v5 upstream version.
execFileSync(process.execPath,['node_modules/typescript/bin/tsc','-p','tsconfig.json'],{stdio:'inherit'});
for(const f of ['index.html','module.json','README.md','THIRD_PARTY_NOTICES.md','crowbot-adapter.json'])await cp(join('static',f),join(release,f==='crowbot-adapter.json'?'assets/'+f:f));
await cp('static/style.css',join(release,'assets/style.css'));
let files=0,bytes=0;async function walk(dir:string){for(const f of await readdir(dir)){const p=join(dir,f),s=await stat(p);if(s.isDirectory())await walk(p);else{files++;bytes+=s.size;if(s.size>16*1024*1024)throw new Error('Oversized resource');}}}await walk(release);if(files>1024||bytes>64*1024*1024)throw new Error('Oversized release');console.log(JSON.stringify({module:'crowbot-parcel-pals',version:'1.2.0',files,bytes}));
