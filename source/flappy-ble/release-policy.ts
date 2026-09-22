import { readdir, lstat, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
// Conservative policy for THIS release; not a claim to implement the host importer.
export const EXTENSIONS = new Set(['.html','.css','.js','.json','.md','.txt','.png','.svg']);
export function validateNames(names: string[], id = 'flappy-ble'): void {
  const seen = new Set<string>();
  for (const name of names) {
    const parts = name.split('/');
    if (parts[0] !== id || parts.length < 2 || !/^[a-zA-Z0-9._/-]+$/.test(name) || parts.some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw new Error('Unsafe release path: ' + name);
    const key = name.normalize('NFC').toLowerCase();
    if (seen.has(key)) throw new Error('Duplicate release path: ' + name);
    seen.add(key);
    if (!EXTENSIONS.has(extname(name).toLowerCase())) throw new Error('Unsupported release asset: ' + name);
  }
  if (!seen.has(id+'/module.json') || !seen.has(id+'/index.html')) throw new Error('Missing release entry files');
}
export async function auditRelease(directory: string): Promise<{files:number; bytes:number; names:string[]; policy:string}> {
  const manifest = JSON.parse(await readFile(join(directory,'module.json'),'utf8'));
  if (manifest.id !== 'flappy-ble' || manifest.entry !== 'index.html') throw new Error('Unexpected module entry');
  const names: string[] = []; let bytes = 0;
  async function walk(relative: string): Promise<void> {
    for (const name of await readdir(join(directory,relative))) {
      const rel = relative ? relative+'/'+name : name;
      const info = await lstat(join(directory,rel));
      if (info.isSymbolicLink()) throw new Error('Symlink is not allowed: ' + rel);
      if (info.isDirectory()) await walk(rel);
      else if (info.isFile()) {
        if (info.size > 16*1024*1024) throw new Error('Oversized resource: ' + rel);
        names.push(manifest.id+'/'+rel); bytes += info.size;
      } else throw new Error('Unsupported filesystem entry: ' + rel);
    }
  }
  await walk(''); validateNames(names,manifest.id);
  if (names.length > 1024 || bytes > 64*1024*1024) throw new Error('Release is too large');
  const core = await readFile(join(directory,'assets/vendor/blockly_compressed.js'),'utf8');
  if (/hand(?:open|closed|delete)\.cur/.test(core)) throw new Error('Legacy cursor reference remains in runtime');
  if (!(await readFile(join(directory,'assets/main.js'),'utf8')).includes('sounds: false')) throw new Error('Audio assets are omitted: sounds must stay disabled');
  return {files:names.length, bytes, names:names.sort(), policy:'Module-owned conservative asset/path check; actual host import untested'};
}
