import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { readMemo, writeMemo, validateMemo, handleMemo } from '../src/memo.js';
const memo = { id:'one',title:'引用「メモ」',category:'仕事',bodies:['first','second'],notes:['https://example.test','補足'],tags:["quote'"],createdAt:'2026-10-13',updatedAt:'2026-10-13' };
test('memo migration is isolated and revision protects multiple writers', async ctx => {
  const mf = new Miniflare({modules:true,script:"export default { fetch() { return new Response('ok') } }",compatibilityDate:'2026-08-01',d1Databases:{DB:'memo-test'}});
  ctx.after(()=>mf.dispose()); const DB=await mf.getD1Database('DB');
  await DB.exec('CREATE TABLE todo_state (data TEXT); INSERT INTO todo_state VALUES (\'unchanged\'); CREATE TABLE wiki_sentinel (data TEXT);');
  const sql=await readFile(new URL('../memo-migrations/0001-memo.sql',import.meta.url),'utf8');
  for (let i=0;i<2;i++) await DB.prepare(sql).run();
  const env={DB}; const initial=await readMemo(env); assert.equal(initial.revision,0);
  const saved=await writeMemo(env,{...initial,memos:[memo]}); assert.equal(saved.revision,1);
  assert.deepEqual((await readMemo(env)).memos,[memo]);
  await assert.rejects(writeMemo(env,{...initial,memos:[]}),{status:409});
  await writeMemo(env,{...saved,memos:[{...memo,bodies:['second','first']}]});
  await assert.rejects(writeMemo(env,saved),{status:409});
  assert.equal((await DB.prepare('SELECT data FROM todo_state').first()).data,'unchanged');
  assert.equal((await handleMemo(new Request('https://test/api/memo'),env,{})).headers.get('Cache-Control'),'no-store');
});
test('memo rejects malformed and duplicate entries and oversized bodies',()=>{
  const valid={memos:[memo],categories:['仕事'],revision:0}; validateMemo(valid);
  for(const bad of [{...valid,revision:-1},{...valid,memos:[memo,memo]},{...valid,categories:['仕事','仕事']},{...valid,memos:[{...memo,bodies:'wrong'}]},{...valid,memos:[{...memo,title:''}]},{...valid,memos:[{...memo,bodies:['x'.repeat(100001)]}]}]) assert.throws(()=>validateMemo(bad),{status:400});
});
test('memo API requires a browser session and cannot accept MCP credentials', async ctx=>{
 const {default:worker}=await import('../src/index.js'); const {createHmac}=await import('node:crypto');
 const mf=new Miniflare({modules:true,script:"export default {fetch(){return new Response('ok')}}",compatibilityDate:'2026-08-01',d1Databases:{DB:'memo-api'}});
 ctx.after(()=>mf.dispose());const env={DB:await mf.getD1Database('DB'),SESSION_SECRET:'synthetic',ALLOWED_EMAIL:'qa@example.test',ALLOWED_ORIGIN:'https://qa.test'};
 await env.DB.prepare(await readFile(new URL('../memo-migrations/0001-memo.sql',import.meta.url),'utf8')).run();
 const token=extra=>{const body=Buffer.from(JSON.stringify({email:env.ALLOWED_EMAIL,exp:Date.now()+3600000,...extra})).toString('base64url');return body+'.'+createHmac('sha256',env.SESSION_SECRET).update(body).digest('base64url');};
 const request=(method='GET',extra={},body)=>new Request('https://qa.test/api/memo',{method,headers:{Origin:env.ALLOWED_ORIGIN,Authorization:'Bearer '+token(extra),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 assert.equal((await worker.fetch(new Request('https://qa.test/api/memo'),env)).status,401);
 assert.equal((await worker.fetch(request('GET',{scope:'schedule:read',aud:'https://qa.test/mcp'}),env)).status,401);
 const initial=await (await worker.fetch(request(),env)).json(); assert.equal(initial.revision,0);
 const response=await worker.fetch(request('PUT',{}, {...initial,memos:[memo],categories:['仕事']}),env); assert.equal(response.status,200);
 assert.equal((await (await worker.fetch(request(),env)).json()).memos[0].title,memo.title);
 assert.equal((await worker.fetch(request('PUT',{},initial),env)).status,409);
});
