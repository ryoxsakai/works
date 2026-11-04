import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, readFile, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, extname, join, posix, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isExcluded, knownSensitiveMarker, stagePages} from '../stage-pages.mjs';

const sourceRoot=resolve(fileURLToPath(new URL('../../',import.meta.url)));
const exists=path=>stat(path).then(()=>true,()=>false);
const refs=(path,text)=>{
  const suffix=extname(path),patterns=[];
  if(suffix==='.html')patterns.push(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi);
  if(suffix==='.css')patterns.push(/url\(\s*["']?([^"')]+)["']?\s*\)/gi,/@import\s+["']([^"']+)["']/gi);
  if(suffix==='.js'||suffix==='.mjs')patterns.push(/\b(?:from\s*|import\s*(?:\(\s*)?)["']([^"']+)["']/g,/\bnew\s+URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url/g);
  return patterns.flatMap(pattern=>[...text.matchAll(pattern)].map(match=>match[1]));
};
const local=(origin,ref)=>{
  if(!ref||ref.startsWith('//')||/^[a-z][a-z0-9+.-]*:/i.test(ref)||ref.startsWith('#')||ref.includes('${')||ref.includes('{{'))return null;
  const clean=ref.split(/[?#]/,1)[0];if(!clean)return null;
  if((origin.endsWith('.js')||origin.endsWith('.mjs'))&&!clean.startsWith('.')&&!clean.startsWith('/'))return null;
  let decoded;try{decoded=decodeURIComponent(clean);}catch{return null;}
  const path=posix.normalize(decoded.startsWith('/')?decoded.slice(1):posix.join(posix.dirname(origin),decoded));
  return path==='..'||path.startsWith('../')?null:path;
};

test('all previously present static browser references remain available in the staged site',async()=>{
  const parent=await mkdtemp(join(tmpdir(),'works-pages-assets-')),out=join(parent,'stage'),forbidden=await knownSensitiveMarker(sourceRoot);
  await stagePages({sourceRoot,outputPath:out,forbidden});
  const paths=execFileSync('git',['ls-files','-z'],{cwd:sourceRoot,encoding:'utf8'}).split('\0').filter(Boolean);
  const web=paths.filter(path=>!isExcluded(path)&&/\.(?:html|css|js|mjs)$/.test(path)&&! /^(?:scripts|worker|docs)\//.test(path));
  let checked=0,missing=0;
  for(const path of web){const text=await readFile(join(sourceRoot,path),'utf8');for(const value of refs(path,text)){const target=local(path,value);if(!target)continue;if(await exists(join(sourceRoot,target))){checked++;if(!await exists(join(out,target)))missing++;}}}
  assert.ok(checked>100,'expected to inspect a substantial set of local references');
  assert.equal(missing,0,'staged site is missing an existing referenced file');
  console.log(`Checked ${checked} existing static references.`);
});
