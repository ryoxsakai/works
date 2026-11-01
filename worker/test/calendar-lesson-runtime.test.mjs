import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {Miniflare} from 'miniflare';
import {ensureAttribution,rawRecord} from '../src/lesson-attribution.js';
import {replaceCalendarRecord,parseCalendarRecord,parsePlainCalendarRecord} from '../../shared/calendar-lesson-record.mjs';
import {calendarLessonJournal} from '../src/calendar-lesson-journal.js';
import {lessonEventRef} from '../../shared/lesson-plan.js';
import {recordBinding} from '../src/calendar-lesson-migration.js';
import {createLessonOwner,changeLessonBinding,listOwnerRecords,editOwnerRecord} from '../src/lesson-owner-history.js';
const parseVisible=description=>parseCalendarRecord(description)||parsePlainCalendarRecord(description,{calendar_id:'synthetic-calendar',event_id:'b',title:'合成生徒',generation:0});
const origin='https://works.example.test',owner='owner@example.invalid';
test('D1 record list holds an old observed A row after another tab rebinds the same event to B',async t=>{
 const {DB,events,call}=await setup(t,{historyMode:'active'}),env={DB,LESSON_HISTORY_MODE:'active'},deps={settings:async()=>({selected_calendars:['synthetic-calendar']}),token:async()=>({access_token:'synthetic'}),event:async(token,cal,id)=>events.find(e=>e.id===id)};
 events[0].summary='A';const old=lessonEventRef(events[0],'synthetic-calendar');
 const a=(await createLessonOwner(env,{request_id:crypto.randomUUID(),name:'A',kind:'student'})).owner,b=(await createLessonOwner(env,{request_id:crypto.randomUUID(),name:'B',kind:'student'})).owner;
 await changeLessonBinding(env,{request_id:crypto.randomUUID(),target:old,link_revision:0,decision:'new',owner_id:a.id,owner_revision:1},deps);
 events[0].summary='B';events[0].etag='renamed-b';const current=lessonEventRef(events[0],'synthetic-calendar');const rebound=await changeLessonBinding(env,{request_id:crypto.randomUUID(),target:current,link_revision:1,decision:'different_owner',owner_id:b.id,owner_revision:1},deps);
 await editOwnerRecord(env,rebound.record.id,{request_id:crypto.randomUUID(),revision:1,lesson_plan:'B private plan'});
 const stale=await (await call('/api/lesson-records',{targets:[old]})).json();assert.equal(stale[0].attribution_status,'target_unavailable');assert.ok(!stale[0].lesson_plan);assert.ok(!stale[0].owner_id);
 const fresh=await (await call('/api/lesson-records',{targets:[current]})).json();assert.equal(fresh[0].lesson_plan,'B private plan');
});
test('actual Worker D1 owner mode: legacy UI and MCP read D1, edits never PATCH Calendar; old attribution/template/undo writers are blocked',async t=>{
 const {DB,events,control,call,put,bindings}=await setup(t,{historyMode:'active'}),env={DB,LESSON_HISTORY_MODE:'active'};
 const person=(await createLessonOwner(env,{request_id:crypto.randomUUID(),name:'固定IDの生徒',kind:'student'})).owner;
 const deps={settings:async()=>({selected_calendars:['synthetic-calendar']}),token:async()=>({access_token:'synthetic'}),event:async(token,cal,id)=>events.find(e=>e.id===id)};
 await changeLessonBinding(env,{request_id:crypto.randomUUID(),target:lessonEventRef(events[0],'synthetic-calendar'),link_revision:0,decision:'new',owner_id:person.id,owner_revision:1},deps);
 const current=await (await call('/api/lesson-plan?calendar_id=synthetic-calendar&event_id=a')).json();assert.equal(current.record_storage,'d1_owner');
 const saved=await put('/api/lesson-plan',{target:current.target,record_revision:current.record_revision,expected_lesson_plan:'',lesson_plan:'D1に保存'});assert.equal(saved.status,200,await saved.clone().text());
 assert.equal((await listOwnerRecords(env,person.id))[0].lesson_plan,'D1に保存');assert.equal(control.patches.length,0);assert.equal(events[0].description,undefined);
 const bearer=await token(bindings.SESSION_SECRET,{aud:'works-mcp',scope:'schedule:read'});
 const mcp=await (await call('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_schedule',arguments:{date:'2026-10-31'}}},{Authorization:'Bearer '+bearer,'Content-Type':'application/json'})).json();assert.ok(mcp.result?.structuredContent,JSON.stringify(mcp));assert.equal(mcp.result.structuredContent.events.find(e=>e.id==='a').lesson_plan,'D1に保存');
 assert.equal((await call('/api/next-lesson-plan/initialize',{target:current.target})).status,409);
 assert.equal((await put('/api/lesson-record',{target:current.target})).status,409);
 assert.equal((await call('/api/calendar-lesson-migration/apply',{})).status,409);
 const denied=await call('/api/lesson-history/owners',{request_id:crypto.randomUUID(),name:'blocked',kind:'student'});assert.equal(denied.status,403);
 const allowed=await call('/api/lesson-history/owners',{request_id:crypto.randomUUID(),name:'集団授業',kind:'class'},{Authorization:'Bearer '+await token(bindings.SESSION_SECRET),'Content-Type':'application/json',Origin:origin});assert.equal(allowed.status,200,await allowed.clone().text());assert.equal(control.patches.length,0);
});
async function token(secret,claims={}){const payload=Buffer.from(JSON.stringify({email:owner,exp:Date.now()+86400000,...claims})).toString('base64url');const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return payload+'.'+Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(payload))).toString('base64url');}
async function setup(t,{backup=false,historyMode}={}){
 const event=(id,hour,date='2026-10-31')=>({id,summary:'合成生徒',organizer:{self:true},etag:'"'+id+'-1"',start:{dateTime:`${date}T${hour}:00:00+09:00`},end:{dateTime:`${date}T${hour+1}:00:00+09:00`}});
 const events=[event('a',10),event('b',11),event('c',10,'2026-11-07')],control={patches:[],reads:[],lost:false,deny:false};
 const bindings={SESSION_SECRET:'synthetic-secret',ALLOWED_EMAIL:owner,ALLOWED_ORIGIN:origin,GOOGLE_CLIENT_ID:'synthetic',GOOGLE_CLIENT_SECRET:'synthetic',WORKS_API_KEY:'synthetic-key',CALENDAR_LESSON_RECORDS:'true',CALENDAR_LESSON_MIGRATION_JOURNAL:'true',CALENDAR_LESSON_ATTESTED_CALENDARS:'["synthetic-calendar"]'};
 if(historyMode)bindings.LESSON_HISTORY_MODE=historyMode;
 if(backup){bindings.CALENDAR_LESSON_BACKUP_SHA256='f'.repeat(64);bindings.CALENDAR_LESSON_BACKUP_CAPTURED_AT=new Date().toISOString();}
 const mf=new Miniflare({modules:true,modulesRoot:new URL('../../',import.meta.url).pathname,modulesRules:[{type:'ESModule',include:['**/*.js','**/*.mjs']}],scriptPath:new URL('../src/index.js',import.meta.url).pathname,compatibilityDate:'2026-08-01',d1Databases:{DB:'calendar-runtime'},bindings,outboundService:async request=>{
  const url=new URL(request.url);control.reads.push(url.pathname);
  if(url.origin==='https://oauth2.googleapis.com')return Response.json({access_token:'synthetic',expires_in:3600});
  assert.equal(url.origin,'https://www.googleapis.com');
  if(url.pathname.includes('/calendarList/'))return Response.json({accessRole:'owner'});
  if(url.pathname.includes('/acl'))throw Error('no new ACL grant allowed');
  if(url.pathname.endsWith('/events'))return Response.json({items:events.filter(e=>Date.parse(e.end.dateTime)>Date.parse(url.searchParams.get('timeMin'))&&Date.parse(e.start.dateTime)<Date.parse(url.searchParams.get('timeMax')))});
  const ev=events.find(e=>e.id===decodeURIComponent(url.pathname.split('/').at(-1)));if(!ev)return new Response('',{status:404});
  if(request.method==='PATCH'){
   if(control.deny)return new Response('',{status:403});
   if(request.headers.get('If-Match')!==ev.etag)return new Response('',{status:412});
   const body=await request.json();assert.deepEqual(Object.keys(body),['description']);assert.equal(url.searchParams.get('sendUpdates'),'none');
   control.patches.push({id:ev.id,body});ev.description=body.description;ev.etag='"'+ev.id+'-'+(control.patches.length+1)+'"';
   if(control.lost)throw Error('response lost after commit');
  }
  return Response.json(ev);
 }});t.after(()=>mf.dispose());const DB=await mf.getD1Database('DB');
 await DB.batch([DB.prepare('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)'),DB.prepare("INSERT INTO settings VALUES('selected_calendars','[\"synthetic-calendar\"]')"),DB.prepare('CREATE TABLE google_auth(id INTEGER PRIMARY KEY,refresh_token TEXT,updated_at TEXT)'),DB.prepare("INSERT INTO google_auth VALUES(1,'synthetic','now')"),DB.prepare('CREATE TABLE curriculum_entries(calendar_event_id TEXT PRIMARY KEY,completed INTEGER DEFAULT 0,lesson_plan TEXT,confirmation_test TEXT,homework TEXT,lesson_memo TEXT,updated_at TEXT)')]);
 await ensureAttribution({DB});const sql=await readFile(new URL('../calendar-lesson-migration.sql',import.meta.url),'utf8');await DB.batch(sql.replace(/^--.*$/gm,'').split(';').filter(s=>s.trim()).map(s=>DB.prepare(s)));
 if(historyMode){const historySql=await readFile(new URL('../migrations/lesson-owner-history.sql',import.meta.url),'utf8');await DB.batch(historySql.replace(/^--.*$/gm,'').split(';').filter(s=>s.trim()).map(s=>DB.prepare(s)));await DB.prepare("INSERT INTO lesson_history_policy VALUES(1,1,1,'synthetic')").run();}
 await DB.prepare("INSERT INTO curriculum_entries VALUES('b',0,'DB original','original test','original homework','original memo','now')").run();
 await DB.prepare("UPDATE lesson_record_identity SET calendar_id='synthetic-calendar',title='合成生徒' WHERE event_id='b'").run();const row=await rawRecord({DB},'b');
 events[1].description=replaceCalendarRecord('既存の案内',{...row,lesson_plan:'Calendar native value'},{calendar_id:'synthetic-calendar',event_id:'b',title:'合成生徒',generation:0});
 const headers={Authorization:'Bearer '+await token(bindings.SESSION_SECRET),'Content-Type':'application/json'};
 const call=(path,body,customHeaders=headers)=>mf.dispatchFetch(origin+path,{headers:customHeaders,...(body?{method:'POST',body:JSON.stringify(body)}:{})});
 const put=(path,body)=>mf.dispatchFetch(origin+path,{headers,method:'PUT',body:JSON.stringify(body)});
 return {DB,events,control,call,put,bindings};
}
test('actual Worker: current/next/MCP read Calendar without initialization, repeated saves and snapshots preserve original values',async t=>{
 const {DB,events,control,call,put,bindings}=await setup(t);
 const read=async id=>(await (await call('/api/lesson-plan?calendar_id=synthetic-calendar&event_id='+id)).json());
 let current=await read('b');assert.equal(current.lesson_plan,'Calendar native value');assert.equal(control.patches.length,0);
 const schedule=await (await call('/api/schedule?date=2026-10-31',null,{'X-API-Key':'synthetic-key'})).json();
 assert.equal(schedule.events.find(e=>e.id==='b').lesson_plan,'Calendar native value');assert.equal(control.patches.length,0);
 const next=await (await call('/api/next-lesson-plan?calendar_id=synthetic-calendar&event_id=b')).json();assert.equal(next.target.id,'c');assert.equal(next.template_initialization_available,true);assert.equal(control.patches.length,0);
 const init=await call('/api/next-lesson-plan/initialize',{source:next.source,target:next.target});assert.equal(init.status,200,JSON.stringify(await init.clone().json()));assert.equal(parseVisible(events[2].description).values.lesson_plan,'');assert.equal(events[2].description,'授業予定：\n確認テスト：\n宿題：\n授業メモ：');
 const again=await (await call('/api/next-lesson-plan?calendar_id=synthetic-calendar&event_id=b')).json();assert.equal(again.template_initialization_available,false);assert.equal(control.patches.length,1);
 const emptySchedule=await (await call('/api/schedule?date=2026-11-07',null,{'X-API-Key':'synthetic-key'})).json();assert.equal(emptySchedule.events.find(e=>e.id==='c').lesson_plan,null);assert.equal(emptySchedule.events.find(e=>e.id==='c').homework,null);assert.equal(control.patches.length,1);
 for(const value of ['保存1\n二行目','保存2']){
  const saved=await put('/api/lesson-plan',{target:current.target,record_revision:current.record_revision,expected_lesson_plan:current.lesson_plan,lesson_plan:value});assert.equal(saved.status,200,JSON.stringify(await saved.clone().json()));
  const response=await saved.json();assert.equal(response.lesson_plan,value);assert.notEqual(response.target.etag,current.target.etag);current={...response};
 }
 assert.equal(parseVisible(events[1].description).values.homework,'original homework');
 assert.equal((await rawRecord({DB},'b')).lesson_plan,'保存2');
 const snapshots=(await DB.prepare("SELECT snapshot_json FROM calendar_lesson_migration WHERE event_id='b' ORDER BY rowid").all()).results;
 assert.equal(JSON.parse(snapshots[0].snapshot_json).record_before.lesson_plan,'DB original');
 const stale=await put('/api/lesson-plan',{target:{...current.target,etag:'"stale"'},record_revision:current.record_revision,expected_lesson_plan:'保存2',lesson_plan:'no'});assert.equal(stale.status,409);assert.equal(control.patches.length,3);
 const bearer=await token(bindings.SESSION_SECRET,{aud:'works-mcp',scope:'schedule:read'});
 const mcp=await call('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_schedule',arguments:{date:'2026-10-31'}}},{Authorization:'Bearer '+bearer,'Content-Type':'application/json'});const result=await mcp.json();assert.equal(result.result.structuredContent.events.find(e=>e.id==='b').lesson_plan,'保存2');assert.equal(control.patches.length,3);
});
test('actual Worker unknown dispatch keeps source snapshot and blocks another write without replay',async t=>{
 const {DB,control,call,put}=await setup(t);const current=await (await call('/api/lesson-plan?calendar_id=synthetic-calendar&event_id=b')).json();control.lost=true;
 const body={target:current.target,record_revision:current.record_revision,expected_lesson_plan:current.lesson_plan,lesson_plan:'committed but response lost'};
 assert.equal((await put('/api/lesson-plan',body)).status,503);assert.equal(control.patches.length,1);
 assert.equal((await DB.prepare("SELECT status FROM calendar_lesson_migration WHERE event_id='b'").first()).status,'unknown');
 assert.equal((await rawRecord({DB},'b')).lesson_plan,'DB original');
 const hidden=await (await call('/api/lesson-plan?calendar_id=synthetic-calendar&event_id=b')).json();assert.equal(hidden.attribution_status,'target_unavailable');assert.equal(hidden.lesson_plan,'');
 assert.equal((await put('/api/lesson-plan',body)).status,409);assert.equal(control.patches.length,1);
});
test('actual Worker explicit separation archives old content and rebinds only the individual Calendar region',async t=>{
 const {DB,events,control,call,put}=await setup(t);events[1].summary='別の合成生徒';events[1].etag='"renamed"';
 const held=await (await call('/api/lesson-plan?calendar_id=synthetic-calendar&event_id=b')).json();assert.equal(held.attribution_status,'title_changed');assert.equal(held.lesson_plan,'');
 const response=await put('/api/lesson-record',{target:held.target,record_revision:held.record_revision,decision:'separate'});assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
 const fresh=await (await call('/api/lesson-plan?calendar_id=synthetic-calendar&event_id=b')).json();assert.equal(fresh.lesson_plan,'');assert.equal(fresh.attribution_status,'new');
 assert.equal((await rawRecord({DB},'b')).record_title,'別の合成生徒');assert.equal((await rawRecord({DB},'b')).record_generation,1);assert.equal(events[1].description.includes('<!--'),false);
 const archive=await DB.prepare("SELECT snapshot_json FROM lesson_record_archive WHERE event_id='b'").first();assert.equal(JSON.parse(archive.snapshot_json).lesson_plan,'DB original');
 const backup=await DB.prepare("SELECT snapshot_json FROM calendar_lesson_migration WHERE event_id='b'").first();assert.equal(parseCalendarRecord(JSON.parse(backup.snapshot_json).before.description).values.lesson_plan,'Calendar native value');assert.equal(control.patches.length,1);
});
test('actual Worker explicit reconciliation finalizes a lost response without sending another PATCH',async t=>{
 const {DB,control,call,put}=await setup(t);const current=await (await call('/api/lesson-plan?calendar_id=synthetic-calendar&event_id=b')).json();control.lost=true;
 await put('/api/lesson-plan',{target:current.target,record_revision:current.record_revision,expected_lesson_plan:current.lesson_plan,lesson_plan:'照合対象'});
 const response=await call('/api/calendar-lesson-record/reconcile',{target:current.target});assert.equal(response.status,200,JSON.stringify(await response.clone().json()));assert.equal((await response.json()).reconciled,true);assert.equal(control.patches.length,1);
 assert.equal((await rawRecord({DB},'b')).lesson_plan,'照合対象');assert.equal((await DB.prepare("SELECT status FROM calendar_lesson_migration WHERE event_id='b'").first()).status,'verified');
});
test('unverified legacy records keep existing DB edits without exporting or auto-confirming ownership',async t=>{
 const {DB,events,control,call,put}=await setup(t);delete events[1].description;
 await DB.prepare("UPDATE lesson_record_identity SET title=NULL WHERE event_id='b'").run();
 await DB.prepare("INSERT INTO lesson_record_baseline(event_id,calendar_id,title,effective_date) VALUES('b','synthetic-calendar','合成生徒','2026-10-27')").run();
 const current=await (await call('/api/lesson-plan?calendar_id=synthetic-calendar&event_id=b')).json();assert.equal(current.attribution_status,'legacy_unverified');
 const response=await put('/api/lesson-plan',{target:current.target,record_revision:current.record_revision,expected_lesson_plan:current.lesson_plan,lesson_plan:'DBに保持'});assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
 assert.equal((await response.json()).record_storage,'db_pending_migration');assert.equal(control.patches.length,0);assert.equal((await rawRecord({DB},'b')).record_title,null);
});
test('protected migration preview is read-only; backup-gated instance apply is verified/idempotent and retains raw D1',async t=>{
 const {DB,events,control,call}=await setup(t,{backup:true});events[1].description='既存の案内';
 const listing=await (await call('/api/calendar-lesson-migration/records')).json();assert.deepEqual(listing.items,[{calendar_event_id:'b'}]);
 const preview=await (await call('/api/calendar-lesson-migration/preview',{event_id:'b'})).json();assert.equal(preview.plan.status,'ready');assert.equal(preview.privacy.basis,'owner_attested');assert.equal(preview.privacy.rules,undefined);assert.equal(control.patches.length,0);
 const bad=await call('/api/calendar-lesson-migration/apply',{plan:{...preview.plan,after_description:'overwrite'}});assert.equal(bad.status,409);assert.equal(control.patches.length,0);
 const applied=await call('/api/calendar-lesson-migration/apply',{plan:preview.plan});assert.equal(applied.status,200,JSON.stringify(await applied.clone().json()));assert.equal((await applied.json()).status,'verified');assert.equal(control.patches.length,1);
 assert.equal((await rawRecord({DB},'b')).lesson_plan,'DB original');assert.ok(events[1].description.startsWith('既存の案内\n'));assert.equal(parseVisible(events[1].description).values.lesson_plan,'DB original');
 const repeated=await call('/api/calendar-lesson-migration/apply',{plan:preview.plan});assert.equal(repeated.status,200,JSON.stringify(await repeated.clone().json()));assert.equal(control.patches.length,1);
});
test('no verified-backup configuration means zero migration PATCH calls',async t=>{
 const {events,control,call}=await setup(t);events[1].description='既存の案内';const preview=await (await call('/api/calendar-lesson-migration/preview',{event_id:'b'})).json();assert.equal(preview.plan.status,'ready');const response=await call('/api/calendar-lesson-migration/apply',{plan:preview.plan});assert.equal(response.status,503);assert.equal(control.patches.length,0);
});
test('time moves retain an already managed source, while untouched pre-cutoff records remain DB-only',async t=>{
 const {events,control,call,put}=await setup(t);events[1].start.dateTime='2026-10-19T11:00:00+09:00';events[1].end.dateTime='2026-10-19T12:00:00+09:00';events[1].etag='"moved"';
 const read=async id=>(await (await call('/api/lesson-plan?calendar_id=synthetic-calendar&event_id='+id)).json());
 let current=await read('b');assert.equal(current.lesson_plan,'Calendar native value');
 let response=await put('/api/lesson-plan',{target:current.target,record_revision:current.record_revision,expected_lesson_plan:current.lesson_plan,lesson_plan:'移動後も同じ記録'});assert.equal(response.status,200,JSON.stringify(await response.clone().json()));assert.equal(control.patches.length,1);
 events[0].start.dateTime='2026-10-18T10:00:00+09:00';events[0].end.dateTime='2026-10-18T11:00:00+09:00';events[0].etag='"historical"';current=await read('a');
 response=await put('/api/lesson-plan',{target:current.target,record_revision:current.record_revision,expected_lesson_plan:current.lesson_plan,lesson_plan:'従来のDB保存'});assert.equal(response.status,200,JSON.stringify(await response.clone().json()));assert.equal(control.patches.length,1);assert.equal(events[0].description,undefined);assert.equal((await read('a')).lesson_plan,'従来のDB保存');
});
test('clearing a migrated Calendar description never resurrects the old DB shadow or hidden fields',async t=>{
 const {events,call,put}=await setup(t);const read=async()=>(await (await call('/api/lesson-plan?calendar_id=synthetic-calendar&event_id=b')).json());
 let current=await read();await put('/api/lesson-plan',{target:current.target,record_revision:current.record_revision,expected_lesson_plan:current.lesson_plan,lesson_plan:'保存前の予定'});
 events[1].description='';events[1].etag='"user-cleared"';current=await read();assert.equal(current.lesson_plan,'');assert.equal(current.record_storage,'calendar_missing_fields');
 const response=await put('/api/lesson-plan',{target:current.target,record_revision:current.record_revision,expected_lesson_plan:'',lesson_plan:'消去後の予定'});assert.equal(response.status,200,JSON.stringify(await response.clone().json()));const values=parseVisible(events[1].description).values;assert.equal(values.lesson_plan,'消去後の予定');assert.equal(values.homework,'');assert.equal(values.confirmation_test,'');assert.equal(values.lesson_memo,'');
});
test('native Calendar four-line HTML survives comment removal, preserves outside text, and can explicitly separate a renamed student',async t=>{
 const {events,call,put}=await setup(t);const read=async()=>(await (await call('/api/lesson-plan?calendar_id=synthetic-calendar&event_id=b')).json());
 let current=await read();await put('/api/lesson-plan',{target:current.target,record_revision:current.record_revision,expected_lesson_plan:current.lesson_plan,lesson_plan:'managed'});
 events[1].description='<div>元の案内</div><div>授業予定：Calendarで直接変更</div><div>二行目</div><div>確認テスト：</div><div>宿題：native homework</div><div>授業メモ：</div>';events[1].etag='"native"';
 current=await read();assert.equal(current.lesson_plan,'Calendarで直接変更\n二行目');
 let response=await put('/api/lesson-plan',{target:current.target,record_revision:current.record_revision,expected_lesson_plan:current.lesson_plan,lesson_plan:'Worksへ往復'});assert.equal(response.status,200,JSON.stringify(await response.clone().json()));assert.ok(events[1].description.startsWith('<div>元の案内</div>'));assert.equal(parseVisible(events[1].description).values.homework,'native homework');
 // A subsequent native edit may remove comments again before a title replacement.
 events[1].description='授業予定：旧生徒の内容\n確認テスト：\n宿題：\n授業メモ：';events[1].summary='別生徒';events[1].etag='"renamed-native"';
 current=await read();assert.equal(current.lesson_plan,'');assert.equal(current.attribution_status,'title_changed');
 const review=await (await call('/api/lesson-record?calendar_id=synthetic-calendar&event_id=b')).json();assert.equal(review.previous_record.lesson_plan,'旧生徒の内容');assert.equal(review.record.lesson_plan,null);assert.equal(review.original_db_record.lesson_plan,'Worksへ往復');
 response=await put('/api/lesson-record',{target:current.target,record_revision:current.record_revision,decision:'separate'});assert.equal(response.status,200,JSON.stringify(await response.clone().json()));assert.equal(parseVisible(events[1].description).values.lesson_plan,'');
});
test('empty Calendar with existing next-lesson DB text stays readable and never advertises automatic initialization',async t=>{
 const {DB,events,control,call}=await setup(t);delete events[1].description;
 const read=async()=>(await (await call('/api/next-lesson-plan?calendar_id=synthetic-calendar&event_id=a')).json());
 let next=await read();assert.equal(next.target.id,'b');assert.equal(next.lesson_plan,'DB original');assert.equal(next.template_initialization_available,false);
 await DB.prepare("UPDATE lesson_record_identity SET title=NULL WHERE event_id='b'").run();
 next=await read();assert.equal(next.lesson_plan,'DB original');assert.equal(next.template_initialization_available,false);assert.equal(control.patches.length,0);
});
test('moved managed record with native comments removed blocks D1-only MCP update and undo',async t=>{
 const {DB,events,control,call,put,bindings}=await setup(t);
 events[1].start.dateTime='2026-10-19T11:00:00+09:00';events[1].end.dateTime='2026-10-19T12:00:00+09:00';events[1].etag='"moved"';
 let current=await (await call('/api/lesson-plan?calendar_id=synthetic-calendar&event_id=b')).json();
 const saved=await put('/api/lesson-plan',{target:current.target,record_revision:current.record_revision,expected_lesson_plan:current.lesson_plan,lesson_plan:'managed'});assert.equal(saved.status,200);
 events[1].description='授業予定：native\n確認テスト：\n宿題：\n授業メモ：';events[1].etag='"native"';
 const bearer=await token(bindings.SESSION_SECRET,{aud:'works-mcp',scope:'schedule:read'});
 const mcp=async(name,args)=>(await (await call('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}},{Authorization:'Bearer '+bearer,'Content-Type':'application/json'})).json());
 const update=await mcp('update_schedule',{calendar_id:'synthetic-calendar',event_id:'b',homework:'must not save'});assert.equal(update.result.isError,true);assert.ok(update.result.content[0].text.includes('D1だけ'));
 await DB.prepare("INSERT INTO mcp_schedule_changes(id,event_id,action,changed_fields,before_json,after_json) VALUES('synthetic-undo','b','update','[]','{}','{}')").run();
 const undo=await mcp('undo_schedule_update',{change_id:'synthetic-undo'});assert.equal(undo.result.isError,true);assert.ok(undo.result.content[0].text.includes('転記履歴'));assert.equal((await rawRecord({DB},'b')).homework,'original homework');assert.equal(control.patches.length,1);
});
for(const kind of ['legacy_unverified','legacy_historical','title_changed'])test('explicit owner inherit archives '+kind+' without modifying source or memo, then permits guarded instance migration',async t=>{
 const {DB,events,control,call,put}=await setup(t,{backup:true});delete events[1].description;
 await DB.prepare("UPDATE lesson_record_identity SET title=NULL WHERE event_id='b'").run();
 if(kind==='legacy_historical'){events[1].start.dateTime='2026-10-20T11:00:00+09:00';events[1].end.dateTime='2026-10-20T12:00:00+09:00';}
 if(kind==='title_changed'){await DB.prepare("INSERT INTO lesson_record_baseline(event_id,calendar_id,title,effective_date)VALUES('b','synthetic-calendar','Old student','2026-10-27')").run();}
 await DB.prepare('CREATE TABLE IF NOT EXISTS student_prefs(name TEXT PRIMARY KEY,memo TEXT)').run();await DB.prepare("INSERT INTO student_prefs(name,memo) VALUES('Synthetic','Private memo stays')").run();
 const source=await DB.prepare("SELECT * FROM curriculum_entries WHERE calendar_event_id='b'").first();
 const review=await (await call('/api/lesson-record?calendar_id=synthetic-calendar&event_id=b')).json();assert.equal(review.record.attribution_status,kind);
 const response=await put('/api/lesson-record',{target:review.target,record_revision:review.original_db_record.record_revision,decision:'inherit'});assert.equal(response.status,200,JSON.stringify(await response.clone().json()));assert.equal((await response.json()).attribution_status,'confirmed');
 assert.deepEqual(await DB.prepare("SELECT * FROM curriculum_entries WHERE calendar_event_id='b'").first(),source);assert.equal(await DB.prepare("SELECT memo FROM student_prefs WHERE name='Synthetic'").first('memo'),'Private memo stays');assert.equal(control.patches.length,0);
 const archives=(await DB.prepare("SELECT decision,snapshot_json FROM lesson_record_archive WHERE event_id='b'").all()).results;assert.equal(archives.length,1);assert.equal(archives[0].decision,'inherit');assert.equal(JSON.parse(archives[0].snapshot_json).lesson_plan,source.lesson_plan);
 const preview=await (await call('/api/calendar-lesson-migration/preview',{event_id:'b'})).json();assert.equal(preview.plan.status,'ready');assert.equal(preview.plan.binding.generation,1);
 const applied=await call('/api/calendar-lesson-migration/apply',{plan:preview.plan});assert.equal(applied.status,200,JSON.stringify(await applied.clone().json()));assert.equal(control.patches.length,1);assert.equal(control.patches[0].id,'b');assert.deepEqual(await DB.prepare("SELECT * FROM curriculum_entries WHERE calendar_event_id='b'").first(),source);
});
test('owner inherit rejects a changed ETag without creating attribution archive or modifying source',async t=>{
 const {DB,events,call,put,control}=await setup(t);delete events[1].description;await DB.prepare("UPDATE lesson_record_identity SET title=NULL WHERE event_id='b'").run();const review=await (await call('/api/lesson-record?calendar_id=synthetic-calendar&event_id=b')).json();events[1].etag='"changed-after-review"';
 const response=await put('/api/lesson-record',{target:review.target,record_revision:review.original_db_record.record_revision,decision:'inherit'});assert.equal(response.status,409);assert.equal((await rawRecord({DB},'b')).record_title,null);assert.equal(await DB.prepare("SELECT COUNT(*) AS n FROM lesson_record_archive WHERE event_id='b'").first('n'),0);assert.equal(control.patches.length,0);
});

test('individual replacement requires exact preimage, archives it, keeps original source and prevents managed replay',async t=>{
 const {DB,events,control,call,put}=await setup(t,{backup:true});events[1].description='Original unmanaged note';await DB.prepare("UPDATE lesson_record_identity SET title=NULL WHERE event_id='b'").run();
 const source=await DB.prepare("SELECT * FROM curriculum_entries WHERE calendar_event_id='b'").first();const review=await (await call('/api/lesson-record?calendar_id=synthetic-calendar&event_id=b')).json();
 const inherited=await put('/api/lesson-record',{target:review.target,record_revision:review.original_db_record.record_revision,decision:'inherit',unmanaged_only:true});assert.equal(inherited.status,200,await inherited.clone().text());assert.equal(control.patches.length,0);
 const preview=async expected_description=>call('/api/calendar-lesson-migration/preview',{event_id:'b',replace_unmanaged_description:true,expected_description});assert.equal((await preview('wrong')).status,409);
 const ordinary=await (await call('/api/calendar-lesson-migration/preview',{event_id:'b'})).json();assert.ok(ordinary.plan.after_description.startsWith(events[1].description));
 const response=await preview(events[1].description);assert.equal(response.status,200,await response.clone().text());const {plan}=await response.json();assert.equal(plan.mode,'replace_unmanaged_description');assert.equal(parseVisible(plan.after_description).start,0);
 events[1].etag='"changed"';assert.equal((await call('/api/calendar-lesson-migration/apply',{plan})).status,409);assert.equal(control.patches.length,0);events[1].etag=plan.ref.etag;
 const result=await call('/api/calendar-lesson-migration/apply',{plan});assert.equal(result.status,200,await result.clone().text());assert.equal(control.patches.length,1);assert.deepEqual(await DB.prepare("SELECT * FROM curriculum_entries WHERE calendar_event_id='b'").first(),source);
 const snapshot=JSON.parse(await DB.prepare("SELECT snapshot_json FROM calendar_lesson_migration WHERE event_id='b'").first('snapshot_json'));assert.equal(snapshot.before.description,'Original unmanaged note');assert.equal(snapshot.mode,'replace_unmanaged_description');assert.equal((await preview(events[1].description)).status,409);
 const managed=await (await call('/api/lesson-record?calendar_id=synthetic-calendar&event_id=b')).json();assert.equal((await put('/api/lesson-record',{target:managed.target,record_revision:managed.original_db_record.record_revision,decision:'inherit',unmanaged_only:true})).status,409);assert.equal(control.patches.length,1);
});
test('replacement refuses missing backup and concurrent text before dispatch',async t=>{
 const {events,control,call}=await setup(t);events[1].description='Unmanaged';const {plan}=await (await call('/api/calendar-lesson-migration/preview',{event_id:'b',replace_unmanaged_description:true,expected_description:'Unmanaged'})).json();assert.equal(plan.status,'ready');assert.equal((await call('/api/calendar-lesson-migration/apply',{plan})).status,503);assert.equal(control.patches.length,0);events[1].description='Changed';assert.equal((await call('/api/calendar-lesson-migration/apply',{plan})).status,409);assert.equal(control.patches.length,0);
});

async function legacyStorage(fixture){
 const {DB,events,bindings}=fixture,row=await rawRecord({DB},'b'),ref=lessonEventRef(events[1],'synthetic-calendar'),journal=calendarLessonJournal({DB,...bindings});
 const op=await journal.reserve({ref,binding:recordBinding(row,ref),revision:row.record_revision,before:{...events[1],description:''},after_description:events[1].description,record_before:row});await journal.mark(op.id,'dispatching');await journal.mark(op.id,'verified',{etag:events[1].etag,description:events[1].description});return op.id;
}
test('tag-only conversion preserves live Calendar values, outside notes, D1 originals and provenance, future saves stay plain',async t=>{
 const f=await setup(t,{backup:true}),{DB,events,control,call,put}=f;
 events[1].description+='\n<i>Outside suffix</i>';await legacyStorage(f);const source=await DB.prepare("SELECT * FROM curriculum_entries WHERE calendar_event_id='b'").first();
 const response=await call('/api/calendar-lesson-migration/preview',{event_id:'b',remove_management_tags:true});assert.equal(response.status,200,await response.clone().text());const {plan}=await response.json();assert.equal(plan.mode,'remove_management_tags');assert.equal(plan.values.lesson_plan,'Calendar native value');assert.equal(plan.after_description,'既存の案内\n授業予定：Calendar native value\n確認テスト：original test\n宿題：original homework\n授業メモ：original memo\n<i>Outside suffix</i>');assert.equal(control.patches.length,0);
 const applied=await call('/api/calendar-lesson-migration/apply',{plan});assert.equal(applied.status,200,await applied.clone().text());const result=await applied.json();assert.ok(result.operation_id);assert.equal(control.patches.length,1);assert.equal(events[1].description.includes('<!--'),false);assert.deepEqual(await DB.prepare("SELECT * FROM curriculum_entries WHERE calendar_event_id='b'").first(),source);
 const archived=JSON.parse(await DB.prepare('SELECT snapshot_json FROM calendar_lesson_migration WHERE id=?').bind(result.operation_id).first('snapshot_json'));assert.ok(archived.before.description.includes('<!--binding:'));assert.equal(archived.format,'plain_v2');assert.equal(archived.managed_suffix,'\n<i>Outside suffix</i>');assert.equal(archived.binding.generation,0);
 const current=await (await call('/api/lesson-plan?calendar_id=synthetic-calendar&event_id=b')).json();assert.equal(current.lesson_plan,'Calendar native value');
 const schedule=await (await call('/api/schedule?date=2026-10-31',null,{'X-API-Key':'synthetic-key'})).json();assert.equal(schedule.events.find(x=>x.id==='b').lesson_plan,'Calendar native value');
 const bearer=await token(f.bindings.SESSION_SECRET,{aud:'works-mcp',scope:'schedule:read'});const mcp=await (await call('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_schedule',arguments:{date:'2026-10-31'}}},{Authorization:'Bearer '+bearer,'Content-Type':'application/json'})).json();assert.equal(mcp.result.structuredContent.events.find(x=>x.id==='b').lesson_plan,'Calendar native value');
 const again=await call('/api/calendar-lesson-migration/apply',{plan});assert.equal(again.status,200);assert.equal(control.patches.length,1);
 const saved=await put('/api/lesson-plan',{target:current.target,record_revision:current.record_revision,expected_lesson_plan:current.lesson_plan,lesson_plan:'Next native text'});assert.equal(saved.status,200,await saved.clone().text());assert.equal(events[1].description.includes('<!--'),false);assert.ok(events[1].description.startsWith('既存の案内\n'));assert.ok(events[1].description.endsWith('\n<i>Outside suffix</i>'));assert.equal((await (await call('/api/lesson-plan?calendar_id=synthetic-calendar&event_id=b')).json()).lesson_plan,'Next native text');
});
test('tag removal refuses unverified ownership, stale instance without dispatch',async t=>{
 const f=await setup(t,{backup:true}),{events,call,control}=f;
 let response=await call('/api/calendar-lesson-migration/preview',{event_id:'b',remove_management_tags:true});assert.equal((await response.json()).plan.reason,'verified_storage_required');await legacyStorage(f);
 const {plan}=await (await call('/api/calendar-lesson-migration/preview',{event_id:'b',remove_management_tags:true})).json();events[1].etag='"concurrent"';response=await call('/api/calendar-lesson-migration/apply',{plan});assert.equal(response.status,409);assert.equal(control.patches.length,0);
});
test('tag conversion lost response stays locked and reconciles without another Calendar write',async t=>{
 const f=await setup(t,{backup:true}),{DB,control,call,events}=f;await legacyStorage(f);const source=await DB.prepare("SELECT * FROM curriculum_entries WHERE calendar_event_id='b'").first();const {plan}=await (await call('/api/calendar-lesson-migration/preview',{event_id:'b',remove_management_tags:true})).json();control.lost=true;assert.equal((await call('/api/calendar-lesson-migration/apply',{plan})).status,503);assert.equal(control.patches.length,1);assert.equal(events[1].description.includes('<!--'),false);
 assert.equal((await call('/api/calendar-lesson-migration/apply',{plan})).status,409);assert.equal(control.patches.length,1);control.lost=false;const reconciled=await call('/api/calendar-lesson-record/reconcile',{target:{calendar_id:'synthetic-calendar',id:'b'}});assert.equal(reconciled.status,200,await reconciled.clone().text());assert.equal(control.patches.length,1);assert.deepEqual(await DB.prepare("SELECT * FROM curriculum_entries WHERE calendar_event_id='b'").first(),source);
});

test('heading-like continuation lines survive actual save, verified D1 parsing, MCP read and another edit',async t=>{
 const {DB,events,call,put,bindings}=await setup(t);const value='first\n宿題: p.10\n 宿題：p.11\r\n\t確認テスト: continuation\n\u3000授業予定：continuation\n\\ 宿題: literal slash';
 let current=await (await call('/api/lesson-plan?calendar_id=synthetic-calendar&event_id=b')).json();
 for(const lesson_plan of [value,value+'\nnext edit']){
  const saved=await put('/api/lesson-plan',{target:current.target,record_revision:current.record_revision,expected_lesson_plan:current.lesson_plan,lesson_plan});assert.equal(saved.status,200,await saved.clone().text());
  current=await (await call('/api/lesson-plan?calendar_id=synthetic-calendar&event_id=b')).json();assert.equal(current.lesson_plan,lesson_plan);assert.equal(current.attribution_status,'confirmed');assert.equal(current.record_target_unavailable,undefined);assert.equal(events[1].description.includes('<!--'),false);
 }
 const bearer=await token(bindings.SESSION_SECRET,{aud:'works-mcp',scope:'schedule:read'});const mcp=await (await call('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_schedule',arguments:{date:'2026-10-31'}}},{Authorization:'Bearer '+bearer,'Content-Type':'application/json'})).json();assert.equal(mcp.result.structuredContent.events.find(e=>e.id==='b').lesson_plan,current.lesson_plan);assert.equal(await DB.prepare("SELECT COUNT(*) AS n FROM calendar_lesson_migration WHERE event_id='b' AND status='verified'").first('n'),2);
});

test('reconcile snapshot route is browser-session GET only, exports raw without lesson or Calendar mutations; old writers remain frozen',async t=>{
 const {DB,events,control,call,put,bindings}=await setup(t,{historyMode:'reconcile'});
 Object.assign(events[1],{status:'confirmed',created:'2026-01-01T00:00:00Z',updated:'2026-01-01T00:00:00Z',iCalUID:'synthetic'});
 const before=await DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
 const snapshot=async()=>{const result={};for(const {name} of before.results)result[name]=(await DB.prepare('SELECT * FROM "'+name+'"').all()).results;return result;};const initial=await snapshot();
 const response=await call('/api/lesson-history/snapshot/event?calendar_id=synthetic-calendar&event_id=b');assert.equal(response.status,200,await response.clone().text());const backup=await response.json();assert.equal(backup.raw_event.etag,events[1].etag);assert.equal(backup.raw_event.description,events[1].description);assert.match(response.headers.get('Cache-Control'),/no-store/);assert.deepEqual(await snapshot(),initial);assert.equal(control.patches.length,0);
 assert.equal((await call('/api/lesson-history/snapshot/event?calendar_id=foreign&event_id=b')).status,403);
 assert.equal((await call('/api/lesson-history/snapshot/event?calendar_id=synthetic-calendar&event_id=b',{})).status,405);
 assert.equal((await call('/api/lesson-history/snapshot/event?calendar_id=synthetic-calendar&event_id=b',null,{})).status,401);
 const scoped=await token(bindings.SESSION_SECRET,{aud:'works-mcp',scope:'schedule:read'});assert.equal((await call('/api/lesson-history/snapshot/event?calendar_id=synthetic-calendar&event_id=b',null,{Authorization:'Bearer '+scoped})).status,401);
 assert.equal((await call('/api/next-lesson-plan/initialize',{target:{calendar_id:'synthetic-calendar',id:'b'}})).status,409);assert.equal((await call('/api/calendar-lesson-migration/preview',{event_id:'b'})).status,409);assert.equal((await put('/api/lesson-record',{})).status,409);assert.equal(control.patches.length,0);assert.deepEqual(await snapshot(),initial);
});

test('active next API exposes an unassigned candidate without leaking old content or mutating any D1 table/Calendar',async t=>{
 const {DB,events,control,call}=await setup(t,{historyMode:'active'}),env={DB,LESSON_HISTORY_MODE:'active'},deps={settings:async()=>({selected_calendars:['synthetic-calendar']}),token:async()=>({access_token:'synthetic'}),event:async(token,cal,id)=>events.find(e=>e.id===id)};
 const person=(await createLessonOwner(env,{request_id:crypto.randomUUID(),name:'合成固定ID',kind:'student'})).owner;await changeLessonBinding(env,{request_id:crypto.randomUUID(),target:lessonEventRef(events[0],'synthetic-calendar'),link_revision:0,decision:'new',owner_id:person.id,owner_revision:1},deps);
 const names=(await DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()).results.map(r=>r.name);const snapshot=async()=>{const rows={};for(const name of names)rows[name]=(await DB.prepare('SELECT * FROM "'+name+'"').all()).results;return rows;};const before=await snapshot();
 const response=await call('/api/next-lesson-plan?calendar_id=synthetic-calendar&event_id=a');assert.equal(response.status,200,await response.clone().text());const result=await response.json();assert.equal(result.target.id,'b');assert.equal(result.owner_confirmation_required,true);assert.equal(result.lesson_plan,'');assert.equal(result.homework,undefined);assert.equal(result.owner_id,null);assert.equal(result.source_owner_id,person.id);assert.deepEqual(await snapshot(),before);assert.equal(control.patches.length,0);
});

test('active unbound plan PUT persists an unattributed draft only, never legacy/owner/Calendar content',async t=>{
 const {DB,events,control,call,put}=await setup(t,{historyMode:'active'}),old=await DB.prepare('SELECT * FROM curriculum_entries').all();const response=await call('/api/lesson-plan?calendar_id=synthetic-calendar&event_id=b');assert.equal(response.status,200);const read=await response.json();assert.equal(read.pending_allowed,true);assert.equal(read.lesson_plan,'');const body={target:read.target,pending_context:read.pending_context,record_revision:0,expected_lesson_plan:'',lesson_plan:'unassigned draft\nnext line',request_id:crypto.randomUUID()};const saved=await put('/api/lesson-plan',body);assert.equal(saved.status,200,await saved.clone().text());assert.equal((await saved.json()).operation_id,body.request_id);assert.equal((await DB.prepare('SELECT lesson_plan FROM lesson_pending_plans').first()).lesson_plan,body.lesson_plan);assert.equal((await DB.prepare('SELECT count(*) n FROM lesson_owners').first()).n,0);assert.equal((await DB.prepare('SELECT count(*) n FROM lesson_history_records').first()).n,0);assert.equal((await DB.prepare('SELECT count(*) n FROM lesson_event_links').first()).n,0);assert.deepEqual(await DB.prepare('SELECT * FROM curriculum_entries').all(),old);assert.equal(control.patches.length,0);assert.equal((await call('/api/lesson-plan',body,{})).status,401);
});
