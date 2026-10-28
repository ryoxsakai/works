import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createProductionContext,safeShellRoute} from '../production/context.mjs';
function authFixture(){let calls=0,logout=0;return {watchAuth({onSignedIn}){calls++;onSignedIn({email:'fixture@example.test'});},getSessionToken:()=> 'fixture-token',async signOutUser(){logout++;},get calls(){return calls;},get logouts(){return logout;}};}
const row={id:'fixture-1',name:'Synthetic project',status:'問題作成中',deadline:'2026-11-01',memo:'fixture',remaining_days:4,progress:99,last_source_email_subject:'not part of UI'};
test('production uses existing auth once and only authenticated no-store GET, without sample fields',async()=>{
 const auth=authFixture(),requests=[];const context=createProductionContext(auth,{storage:null,fetcher:async(url,options)=>{requests.push({url,options});return Response.json([row]);}});
 const [a,b]=await Promise.all([context.session.init(),context.session.init()]);assert.equal(a,b);assert.equal(auth.calls,1);
 const data=await context.list();assert.equal(requests[0].url,'/api/ss-projects');assert.equal(requests[0].options.method,'GET');assert.equal(requests[0].options.cache,'no-store');assert.equal(requests[0].options.headers.Authorization,'Bearer fixture-token');assert.ok(!('progress' in data[0]));assert.ok(!('last_source_email_subject' in data[0]));
});
test('401 and 403 invalidate and prevent subsequent reads; no hidden retries',async()=>{
 for(const status of [401,403]){let expired=0,reads=0;const context=createProductionContext(authFixture(),{storage:null,onExpired:()=>expired++,fetcher:async()=>{reads++;return new Response('',{status});}});await assert.rejects(context.list(),error=>error.status===status);assert.equal(context.active,false);await assert.rejects(context.list(),error=>error.status===401);assert.equal(expired,1);assert.equal(reads,1);}
});
test('409/429/5xx remain visible read failures, never data rewrites or automatic replays',async()=>{
 for(const status of [409,429,503]){let reads=0;const context=createProductionContext(authFixture(),{storage:null,fetcher:async()=>{reads++;return new Response('',{status});}});await assert.rejects(context.list(),error=>error.status===status);assert.equal(reads,1);assert.equal(context.active,true);}
});
test('logout and session changes fence delayed responses including JSON decoding',async()=>{
 let release;const wait=new Promise(resolve=>release=resolve);const auth=authFixture();const context=createProductionContext(auth,{storage:null,onLogout:()=>{},fetcher:async()=>({ok:true,json:async()=>{await wait;return [row];}})});
 const read=context.list();await new Promise(resolve=>setTimeout(resolve,0));await context.logout();release();await assert.rejects(read,{name:'AbortError'});assert.equal(auth.logouts,1);assert.equal(context.active,false);
});
test('sort preferences preserve existing SS key and reject corrupt values',()=>{
 const entries=new Map([['works_ss_sort','{"key":"remaining","direction":"desc"}']]);const storage={getItem:key=>entries.get(key),setItem:(key,value)=>entries.set(key,value)};
 const context=createProductionContext(authFixture(),{storage});assert.deepEqual(context.readSort(),{key:'remaining',direction:'desc'});context.saveSort({key:'name',direction:'asc'});assert.deepEqual(context.readSort(),{key:'name',direction:'asc'});entries.set('works_ss_sort','broken');assert.deepEqual(context.readSort(),{key:'deadline',direction:'asc'});
});
test('app login keeps registered tutor callback and permits only the exact app destination',async()=>{
 const source=await readFile(new URL('../../tutor/app.js',import.meta.url),'utf8');const regex=new Function('return '+source.match(/const SAFE_DESTINATION_RE = ([^;]+);/)[1])();
 assert.ok(regex.test('/app/'));for(const value of ['/app/evil','//evil.test/','/app/?next=https://evil.test','/app/#x'])assert.ok(!regex.test(value));
 for(const value of ['https://evil.test','//evil.test','/ss/a/<img>/','/ss/id/?token=secret'])assert.equal(safeShellRoute(value),'/home/');assert.equal(safeShellRoute('/ss/fixture-1/'),'/ss/fixture-1/');
 const entry=await readFile(new URL('../production/main.mjs',import.meta.url),'utf8');assert.ok(entry.includes("auth.signIn('/tutor/')"));assert.ok(!entry.includes("signIn('/app/')"));
});
test('committed production entry points at a built bundle without seeded sample records',async()=>{
 const html=await readFile(new URL('../../app/index.html',import.meta.url),'utf8');
 const script=html.match(/src="\/app\/(assets\/[^\"]+\.js)"/)[1];
 const bundle=await readFile(new URL('../../app/'+script,import.meta.url),'utf8');
 for(const value of ['synthetic-session','ss-101','英語・読解問題の作成'])assert.ok(!bundle.includes(value));
 assert.ok(html.includes('/shared/theme-init.js?v=1'));assert.ok(!html.includes('サンプルデータのみ'));
});
