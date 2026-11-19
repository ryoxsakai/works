import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {lstat, mkdir, readFile, writeFile, chmod, realpath} from 'node:fs/promises';
import {basename, dirname, isAbsolute, relative, resolve, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sensitiveFixture = 'tutor/test/student-selector.test.mjs';
const safeFixtureDigest = '71957b13cac043b49ca996b657aa5cea1d0a5ada118a63a1efbe3088bfb3b6e4';
const excludedDirs = new Set(['.git', '.github', 'node_modules', 'test', 'tests', '__tests__', 'fixtures', '__fixtures__', 'test-artifacts']);
const stop = () => { throw new Error('Pages staging safety check failed.'); };
export function isExcluded(path) {
  return path.split('/').some(part => excludedDirs.has(part.toLowerCase())) || /\.(?:test|spec)\./i.test(path);
}

// The existing fixture is not rewritten or copied. Derive a private in-memory
// guard and fail closed if its structure changes; never print the guard.
export async function knownSensitiveMarker(sourceRoot) {
  const source = await readFile(resolve(sourceRoot, sensitiveFixture), 'utf8');
  const start = source.indexOf("test('designated group courses include both intermediate-course spellings");
  const end = source.indexOf('\n});', start);
  if (start < 0 || end < 0) stop();
  const events = [...source.slice(start, end).matchAll(/\bevent\('([^']+)'/g)];
  const selected = events[4]?.[1];
  if (!selected || !/^高[12１２]/.test(selected) || [...selected].length !== 4 || source.split(selected).length !== 3) stop();
  const redacted = source.replaceAll(selected, '高2合成生徒');
  if (createHash('sha256').update(redacted).digest('hex') !== safeFixtureDigest) stop();
  return [...selected].slice(2).join('');
}

function indexEntries(sourceRoot) {
  let output;
  try {
    // A changed tracked file could otherwise differ from the reviewed index.
    execFileSync('git', ['diff', '--quiet', '--'], {cwd:sourceRoot,stdio:'ignore'});
    output=execFileSync('git', ['ls-files','--stage','-z'], {cwd:sourceRoot,encoding:'utf8',stdio:['ignore','pipe','ignore']});
  } catch { stop(); }
  return output.split('\0').filter(Boolean).map(entry=>{
    const match=/^(\d{6}) [0-9a-f]+ (\d)\t(.+)$/.exec(entry);
    if(!match || match[2]!=='0')stop();
    return {mode:match[1],path:match[3]};
  });
}

export async function stagePages({sourceRoot, outputPath, forbidden}) {
  const source=await realpath(resolve(sourceRoot)),requested=resolve(outputPath),output=resolve(await realpath(dirname(requested)),basename(requested)),inside=relative(source,output);
  if (!forbidden || !inside || (!inside.startsWith('..'+sep) && inside!=='..') || isAbsolute(inside)) stop();
  const normalized=forbidden.normalize('NFKC'),files=[];
  for(const entry of indexEntries(source)) {
    const parts=entry.path.split('/');
    if(parts.some(part=>!part || part==='.' || part==='..') || isAbsolute(entry.path))stop();
    if(isExcluded(entry.path))continue;
    if(!['100644','100755'].includes(entry.mode) || entry.path.normalize('NFKC').includes(normalized))stop();
    let parent=source;
    for(const part of parts.slice(0,-1)){parent=resolve(parent,part);if(!(await lstat(parent)).isDirectory())stop();}
    const full=resolve(source,entry.path),stat=await lstat(full);
    if(!stat.isFile() || stat.isSymbolicLink())stop();
    const bytes=await readFile(full);
    if(bytes.toString('utf8').normalize('NFKC').includes(normalized))stop();
    files.push({path:entry.path,mode:entry.mode,bytes});
  }
  if(!files.some(file=>file.path==='index.html') || !files.some(file=>file.path==='.nojekyll') || !files.some(file=>file.path==='CNAME'))stop();
  // No output directory is created until the complete preflight has passed.
  await mkdir(output);
  for(const file of files){const path=resolve(output,file.path);await mkdir(dirname(path),{recursive:true});await writeFile(path,file.bytes,{flag:'wx'});await chmod(path,file.mode==='100755'?0o755:0o644);}
  return {files:files.length};
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try {
    if(process.argv.length!==3)stop();
    const forbidden=await knownSensitiveMarker(root),result=await stagePages({sourceRoot:root,outputPath:process.argv[2],forbidden});
    console.log(`Pages staging passed (${result.files} files).`);
  } catch { console.error('Pages staging stopped by safety check.'); process.exitCode=1; }
}
