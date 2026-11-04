import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, readFile, writeFile, symlink, lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isExcluded, knownSensitiveMarker, stagePages} from '../stage-pages.mjs';

const sourceRoot=resolve(fileURLToPath(new URL('../../',import.meta.url)));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=(root,...args)=>execFileSync('git',args,{cwd:root,stdio:'ignore'});
async function syntheticRepo() {
  const root=await mkdtemp(join(tmpdir(),'pages-policy-fixture-'));git(root,'init','--quiet');
  await mkdir(join(root,'app'),{recursive:true});await mkdir(join(root,'tutor','test'),{recursive:true});
  for(const [path,value] of [['index.html','<script src="/app/main.js"></script>'],['.nojekyll',''],['CNAME','example.test'],['app/main.js','export const synthetic = true;'],['tutor/test/private.test.mjs','PRIVATE_TEST_MARKER']])await writeFile(join(root,path),value);
  git(root,'add','.');return root;
}

test('excludes test and fixture paths without excluding ordinary site files',()=>{
  for(const path of ['test/a.js','tutor/test/a.js','worker/test/fixtures/a.js','app/__tests__/a.js','test-artifacts/x.png','x/a.test.mjs','x/a.spec.js','.github/workflows/a.yml'])assert.equal(isExcluded(path),true);
  for(const path of ['index.html','.nojekyll','CNAME','app/index.html','app/assets/app.js','tutor/app.js','shared/lesson-plan.js'])assert.equal(isExcluded(path),false);
});

test('staging preserves allowed files byte-for-byte and never copies tests',async()=>{
  const root=await syntheticRepo(),parent=await mkdtemp(join(tmpdir(),'pages-policy-output-')),out=join(parent,'stage');
  const result=await stagePages({sourceRoot:root,outputPath:out,forbidden:'PRIVATE_TEST_MARKER'});assert.equal(result.files,4);
  for(const path of ['index.html','.nojekyll','CNAME','app/main.js'])assert.deepEqual(await readFile(join(out,path)),await readFile(join(root,path)));
  await assert.rejects(lstat(join(out,'tutor','test')),{code:'ENOENT'});
  await assert.rejects(stagePages({sourceRoot:root,outputPath:out,forbidden:'PRIVATE_TEST_MARKER'}));
});

test('preflight refuses exposed content, links and unstaged changes before creating an output',async()=>{
  for(const scenario of ['content','normalized-content','path','symlink','dirty']) {
    const root=await syntheticRepo(),parent=await mkdtemp(join(tmpdir(),'pages-policy-reject-')),out=join(parent,'stage');
    if(scenario==='content'){await writeFile(join(root,'app/main.js'),'PRIVATE_TEST_MARKER');git(root,'add','app/main.js');}
    if(scenario==='normalized-content'){await writeFile(join(root,'app/main.js'),'ＰＲＩＶＡＴＥ＿ＴＥＳＴ＿ＭＡＲＫＥＲ');git(root,'add','app/main.js');}
    if(scenario==='path'){await writeFile(join(root,'app/PRIVATE_TEST_MARKER.js'),'');git(root,'add','app/PRIVATE_TEST_MARKER.js');}
    if(scenario==='symlink'){await symlink('main.js',join(root,'app','link.js'));git(root,'add','app/link.js');}
    if(scenario==='dirty')await writeFile(join(root,'index.html'),'unreviewed');
    await assert.rejects(stagePages({sourceRoot:root,outputPath:out,forbidden:'PRIVATE_TEST_MARKER'}));
    await assert.rejects(lstat(out),{code:'ENOENT'});
  }
});

test('actual tracked site stages without the known private marker and keeps all other tracked bytes',async()=>{
  const forbidden=await knownSensitiveMarker(sourceRoot),parent=await mkdtemp(join(tmpdir(),'works-pages-check-')),out=join(parent,'stage');
  const result=await stagePages({sourceRoot,outputPath:out,forbidden});
  const paths=execFileSync('git',['ls-files','-z'],{cwd:sourceRoot,encoding:'utf8'}).split('\0').filter(Boolean),included=paths.filter(path=>!isExcluded(path));
  assert.equal(result.files,included.length);
  for(const path of included){const bytes=await readFile(join(out,path));assert.equal(hash(bytes),hash(await readFile(join(sourceRoot,path))));assert.equal(bytes.toString('utf8').normalize('NFKC').includes(forbidden.normalize('NFKC')),false);}
  await assert.rejects(lstat(join(out,'tutor','test')),{code:'ENOENT'});
});
