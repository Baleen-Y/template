import { readdir, lstat, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
/** Module-owned checks reflecting the supplied 2026-09-22 contract; NOT the official host validator. */
const MIME: Record<string,string> = {
  '.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json',
  '.md':'text/markdown','.txt':'text/plain','.png':'image/png','.svg':'image/svg+xml','.jpg':'image/jpeg','.jpeg':'image/jpeg',
  '.gif':'image/gif','.webp':'image/webp','.ico':'image/x-icon','.cur':'image/x-icon',
  '.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg','.mp4':'video/mp4','.webm':'video/webm',
  '.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.otf':'font/otf'
};
export const mimeFor = (path: string): string => MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
function isMetadata(parts: string[]): boolean {
  return parts.some(p => /^(?:\.DS_Store|Thumbs\.db|desktop\.ini|__MACOSX)$/i.test(p) || p.startsWith('._'));
}
export function inspectNames(names: string[], id = 'flappy-ble'): {root:string; kept:string[]; ignored:string[]; generic:string[]} {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id) || id.length > 64) throw new Error('Invalid module ID');
  const seen = new Set<string>(), kept: string[] = [], ignored: string[] = [];
  for (const name of names) {
    const parts = name.split('/');
    if (/[\\:\u0000-\u001f\u007f<>"|?*]/.test(name) || parts.some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw new Error('Unsafe release path: ' + name);
    if (parts.some(p => /^(?:node_modules|\.git)$/i.test(p) || /^\.env(?:\.|$)/i.test(p))) throw new Error('Forbidden build/secret path: ' + name);
    if (isMetadata(parts)) {ignored.push(name);continue;}
    const key = name.normalize('NFC').toLowerCase();
    if (seen.has(key)) throw new Error('Duplicate release path: ' + name);
    seen.add(key); kept.push(name);
  }
  // ZIP member lists contain files. Reject file/directory-prefix collisions too.
  for (const name of kept) { const parts=name.normalize('NFC').toLowerCase().split('/'); while(parts.length>1){parts.pop();if(seen.has(parts.join('/')))throw new Error('File/directory path collision: '+name);} }
  const roots = kept.filter(n => n === 'module.json' || n.endsWith('/module.json')).map(n => n.slice(0,-'module.json'.length)).filter(root => kept.includes(root+'index.html'));
  if (roots.length !== 1) throw new Error('Expected exactly one module root with module.json and index.html');
  const root = roots[0];
  if (kept.some(n => !n.startsWith(root))) throw new Error('File outside module root');
  return {root,kept,ignored,generic:kept.filter(n=>mimeFor(n)==='application/octet-stream')};
}
export function validateNames(names: string[], id = 'flappy-ble'): void { inspectNames(names,id); }
export async function auditRelease(directory: string): Promise<{files:number; bytes:number; names:string[]; ignored:string[]; generic:string[]; policy:string}> {
  const manifestBytes=await readFile(join(directory,'module.json'));
  if(manifestBytes.length>16*1024)throw new Error('Manifest exceeds 16 KiB');
  const manifest=JSON.parse(manifestBytes.toString('utf8'));
  if(manifest.id!=='flappy-ble'||manifest.entry!=='index.html')throw new Error('Unexpected module entry');
  const names:string[]=[];const sizes=new Map<string,number>();
  async function walk(relative:string):Promise<void>{
    for(const name of await readdir(join(directory,relative))){
      const rel=relative?relative+'/'+name:name,info=await lstat(join(directory,rel));
      if(info.isSymbolicLink())throw new Error('Symlink is not allowed: '+rel);
      if(info.isDirectory()){
        if(/^(?:node_modules|\.git)$/i.test(name)||/^\.env(?:\.|$)/i.test(name))throw new Error('Forbidden build/secret directory');
        if(isMetadata(rel.split('/')))continue;
        await walk(rel);
      } else if(info.isFile()){
        const path=manifest.id+'/'+rel;names.push(path);sizes.set(path,info.size);
        if(info.size>16*1024*1024||(rel==='index.html'&&info.size>10*1024*1024))throw new Error('Oversized resource: '+rel);
      }else throw new Error('Unsupported filesystem entry: '+rel);
    }
  }
  await walk('');const result=inspectNames(names,manifest.id);
  const bytes=result.kept.reduce((n,p)=>n+(sizes.get(p)??0),0);
  if(result.kept.length>1024||bytes>64*1024*1024)throw new Error('Release exceeds packaging limits');
  return {files:result.kept.length,bytes,names:result.kept.sort(),ignored:result.ignored,generic:result.generic,policy:'2026-09-22 contract-derived local checks; actual host import and official module-kit untested'};
}
