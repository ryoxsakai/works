import { execFileSync } from 'node:child_process';
import { lstat, mkdir, readFile, writeFile, rm, rename, mkdtemp, realpath } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { knownSensitiveMarker, isExcluded } from './stage-pages.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serviceRoots = new Set('admission app dashboard kdp material material-print memo shared ss todo tutor wiki workflow'.split(' '));
const rootFiles = new Set(['index.html','home.js','home.css','home-refined.css','home-v2.css','logo.png']);
const extensions = /\.(?:html|m?js|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|txt|webmanifest)$/i;
const marker = '<meta name="works-entry-auth" content="cookie">';

export function isWorksEntryAsset(path) {
  const parts = path.split('/');
  if (parts.some(part => !part || part.startsWith('.')) || isExcluded(path)) return false;
  if (parts.length === 1) return rootFiles.has(path);
  return serviceRoots.has(parts[0]) && extensions.test(path);
}

export async function stageWorksEntry(sourceRoot, output) {
  sourceRoot = await realpath(sourceRoot);
  const parent = await realpath(dirname(output));
  // Only the one declared staging destination may ever be replaced.
  if (resolve(output) !== resolve(sourceRoot, 'worker/web-assets') || parent !== resolve(sourceRoot, 'worker')) throw Error('Invalid Works asset output');
  execFileSync('git', ['diff', '--quiet', '--'], { cwd:sourceRoot, stdio:'ignore' });
  const guard = (await knownSensitiveMarker(sourceRoot)).normalize('NFKC');
  const files = execFileSync('git',['ls-files','--stage','-z'],{ cwd:sourceRoot,encoding:'utf8' }).split('\0').filter(Boolean);
  const stage = await mkdtemp(resolve(parent, '.entry-stage-'));
  try {
    for (const row of files) {
      const entry = /^(100644|100755) [a-f0-9]+ 0\t(.+)$/.exec(row);
      if (!entry || !isWorksEntryAsset(entry[2])) continue;
      const path = entry[2], src = resolve(sourceRoot, path), dst = resolve(stage, path);
      if (relative(sourceRoot, await realpath(src)) !== path || !(await lstat(src)).isFile()) throw Error('Non-regular Works asset');
      let data = await readFile(src);
      let str = data.toString('utf8'); // Used for the existing repository privacy guard.
      if (path.normalize('NFKC').includes(guard) || str.normalize('NFKC').includes(guard)) throw Error('Private data safeguard stopped the Works build');
      if (path.endsWith('.html')) {
        const head = /<head(?:\s[^>]*)?>/i;
        const start = head.test(str) ? head : /<html(?:\s[^>]*)?>/i; // One legacy document has an implicit head.
        if (!start.test(str)) throw Error('Missing document start: ' + path);
        str = str.replace(start, tag => tag + '\n' + marker);
        str = str.replace(/((?:src|data-service-app)=['"])(\/?[\w./-]+\.m?js)(?:\?[^'"]*)?(['"])/g, '$1$2?works-entry=1$3');
        data = Buffer.from(str);
      } else if (/\.m?js$/.test(path) && !path.includes('/vendor/')) {
        data = Buffer.from(str.replace(/(\bauth\.js)\?v=[\w-]+/g, '$1?works-entry=1'));
      }
      await mkdir(dirname(dst), {recursive:true});
      await writeFile(dst,data,{flag:'wx'});
    }
    for (const critical of ['shared/auth.js','tutor/index.html','todo/index.html','app/index.html','shared/logo.png']) await lstat(resolve(stage, critical));
    const prior = await lstat(output).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (prior && (!prior.isDirectory() || prior.isSymbolicLink())) throw Error('Unexpected Works asset output');
    if (prior) await rm(output, {recursive:true});
    await rename(stage,output);
  } finally { await rm(stage,{recursive:true,force:true}); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await stageWorksEntry(root,resolve(root,'worker/web-assets'));
  console.log('Staged private Works UI assets.');
}
