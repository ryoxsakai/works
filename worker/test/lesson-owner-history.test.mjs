import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {ensureAttribution} from '../src/lesson-attribution.js';
import {lessonEventRef} from '../../shared/lesson-plan.js';
import {createLessonOwner,renameLessonOwner,createOwnerRecord,editOwnerRecord,listLessonOwners,listOwnerRecords,changeLessonBinding,readEventOwnerRecord,previewOwnerImport,importOwnerRecord,writeEventOwnerRecord} from '../src/lesson-owner-history.js';
import {readNextLessonPlan} from '../src/lesson-plan.js';
import {plainCalendarRecordLayout} from '../../shared/calendar-lesson-record.mjs';
const request=()=>crypto.randomUUID();
async function setup(t){
 const mf=new Miniflare({modules:true,script:"export default {fetch(){return new Response('ok')}}",compatibilityDate:'2026-08-01',d1Databases:{DB:'owner-history'}});t.after(()=>mf.dispose());
 const env={DB:await mf.getD1Database('DB'),LESSON_HISTORY_MODE:'prepare'};
 await env.DB.prepare('CREATE TABLE curriculum_entries(calendar_event_id TEXT PRIMARY KEY,completed INTEGER,lesson_plan TEXT,confirmation_test TEXT,homework TEXT,lesson_memo TEXT,updated_at TEXT)').run();
 await ensureAttribution(env);
 for(const file of ['../calendar-lesson-migration.sql','../migrations/lesson-owner-history.sql']){const sql=await readFile(new URL(file,import.meta.url),'utf8');await env.DB.batch(sql.replace(/^--.*$/gm,'').split(';').filter(s=>s.trim()).map(s=>env.DB.prepare(s)));}
 await env.DB.prepare("INSERT INTO lesson_history_policy VALUES(1,1,1,?)").bind(JSON.stringify({backup:{sha256:'a'.repeat(64),captured_at:new Date().toISOString(),restored:true}})).run();
 const events=[1,2,3].map((n)=>({id:'event-'+n,summary:n===3?'乙':'甲',etag:'v1',start:{dateTime:`2026-11-0${n}T10:00:00+09:00`},end:{dateTime:`2026-11-0${n}T11:00:00+09:00`},description:'',status:'confirmed'}));
 const deps={settings:async()=>({selected_calendars:['a','b']}),token:async()=>({access_token:'synthetic'}),event:async(token,cal,id)=>cal==='a'?events.find(e=>e.id===id):null,events:async()=>events};
 const makeOwner=async(name='甲',kind='student')=>(await createLessonOwner(env,{request_id:request(),name,kind})).owner;
 const owner=await makeOwner();return {env,events,deps,owner,makeOwner,ref:(n=0,cal='a')=>lessonEventRef(events[n],cal)};
}
const bind=(env,owner,target,deps,extra={})=>changeLessonBinding(env,{request_id:request(),target,link_revision:0,decision:'new',owner_id:owner.id,owner_revision:owner.revision,...extra},deps);
test('fixed IDs survive owner rename and calendar deletion; history works without schedules and duplicate names stay separate',async t=>{
 const {env,owner,makeOwner}=await setup(t),other=await makeOwner('甲'),group=await makeOwner('A クラス','class');
 const saved=await createOwnerRecord(env,{request_id:request(),owner_id:owner.id,owner_revision:1,lesson_date:'2026-10-01',lesson_plan:'原文\n宿題: p.10\n'});
 await renameLessonOwner(env,owner.id,{request_id:request(),revision:1,name:'乙'});
 assert.equal((await listOwnerRecords(env,owner.id))[0].lesson_plan,'原文\n宿題: p.10\n');assert.equal((await listOwnerRecords(env,other.id)).length,0);
 assert.equal((await listLessonOwners(env)).find(o=>o.id===group.id).kind,'class');
 const ids=(await listLessonOwners(env)).map(o=>o.id);assert.equal(new Set(ids).size,3);assert.equal(saved.record.owner_id,owner.id);
});
test('schedule name swaps never transfer ownership; same owner confirmation and different owner replacement are explicit',async t=>{
 const {env,events,deps,owner,makeOwner,ref}=await setup(t),other=await makeOwner('乙');env.LESSON_HISTORY_MODE='active';
 const first=await bind(env,owner,ref(),deps),second=await bind(env,other,ref(1),deps);
 await editOwnerRecord(env,first.record.id,{request_id:request(),revision:1,lesson_plan:'甲の記録'});
 events[0].summary='乙';events[1].summary='甲';
 assert.equal((await readEventOwnerRecord(env,ref())).attribution_status,'title_changed');
 await assert.rejects(writeEventOwnerRecord(env,{target:ref(),patch:{lesson_plan:'誤変更'},record_revision:2},deps));
 await changeLessonBinding(env,{request_id:request(),target:ref(),link_revision:1,decision:'same_owner',record_id:first.record.id,owner_id:owner.id},deps);
 assert.equal((await readEventOwnerRecord(env,ref())).owner_id,owner.id);
 const replacement=await changeLessonBinding(env,{request_id:request(),target:ref(1),link_revision:1,decision:'different_owner',owner_id:owner.id,owner_revision:1},deps);
 assert.notEqual(replacement.record.id,second.record.id);assert.equal((await listOwnerRecords(env,other.id))[0].id,second.record.id);
 assert.equal((await listOwnerRecords(env,owner.id)).find(r=>r.id===first.record.id).lesson_plan,'甲の記録');
});
test('deleted or recreated schedules keep records and require explicit reattachment; cross-calendar duplicate IDs do not collide',async t=>{
 const {env,events,deps,owner,ref}=await setup(t);env.LESSON_HISTORY_MODE='active';const saved=await bind(env,owner,ref(),deps),old=ref();events.shift();
 await changeLessonBinding(env,{request_id:request(),target:old,link_revision:1,decision:'detach'},deps);
 assert.equal((await listOwnerRecords(env,owner.id)).length,1);assert.equal((await listOwnerRecords(env,owner.id))[0].event_id,null);
 const target=ref();await changeLessonBinding(env,{request_id:request(),target,link_revision:0,decision:'attach',record_id:saved.record.id,record_revision:1,owner_id:owner.id},deps);
 const secondDeps={...deps,event:async()=>events[0]};await bind(env,owner,ref(0,'b'),secondDeps);
 assert.equal((await listOwnerRecords(env,owner.id)).length,2);
});
test('CAS and request IDs prevent stale overwrites and duplicate record creation; same ID with different payload is rejected',async t=>{
 const {env,owner}=await setup(t),body={request_id:request(),owner_id:owner.id,owner_revision:1,lesson_date:'2026-11-01'};
 const first=await createOwnerRecord(env,body);assert.deepEqual(await createOwnerRecord(env,body),first);
 await assert.rejects(createOwnerRecord(env,{...body,lesson_plan:'different'}));
 const winner=await editOwnerRecord(env,first.record.id,{request_id:request(),revision:1,homework:'winner'});
 await assert.rejects(editOwnerRecord(env,first.record.id,{request_id:request(),revision:1,homework:'stale'}));
 assert.equal((await listOwnerRecords(env,owner.id))[0].homework,'winner');assert.equal(winner.record.revision,2);
 assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM lesson_history_guard').first()).n,0);
});
test('next lesson uses explicitly bound owner ID, not swapped or duplicate title; unbound additions stay blank',async t=>{
 const {env,events,deps,owner,makeOwner,ref}=await setup(t);const other=await makeOwner('甲');await bind(env,owner,ref(),deps);await bind(env,other,ref(1),deps);await bind(env,owner,ref(2),deps);env.LESSON_HISTORY_MODE='active';
 const result=await readNextLessonPlan(env,'a',events[0].id,deps);assert.equal(result.target.id,events[2].id);assert.equal(result.owner_id,owner.id);
 events.push({...events[2],id:'unbound',summary:'甲'});assert.equal((await readEventOwnerRecord(env,lessonEventRef(events[3],'a'))).attribution_status,'owner_unassigned');
});
async function migratedFixture(t){
 const setupValue=await setup(t),{env,events,ref}=setupValue;
 env.LESSON_HISTORY_MODE='reconcile';
 await env.DB.prepare("INSERT INTO curriculum_entries VALUES('event-1',0,'旧DB','旧テスト','','','old')").run();
 await env.DB.prepare("UPDATE lesson_record_identity SET calendar_id='a',title='甲' WHERE event_id='event-1'").run();
 const binding={calendar_id:'a',event_id:'event-1',title:'甲',generation:0},layout=plainCalendarRecordLayout('',{lesson_plan:'カレンダーの最新編集\n',confirmation_test:'',homework:' p.10 ',lesson_memo:''},binding);
 events[0].description=layout.after_description;
 const snapshot={binding,ref:ref(),after_generation:0,...layout};
 const sql="INSERT INTO calendar_lesson_migration(id,event_id,calendar_id,record_revision,record_generation,status,snapshot_json,created_at,updated_at) VALUES('old','event-1','a',1,0,'verified',?,'old','old')";
 await env.DB.prepare(sql).bind(JSON.stringify(snapshot)).run();return setupValue;
}
test('import takes latest Calendar values, preserves exact blanks/newlines and original DB, requires explicit owner confirmation',async t=>{
 const {env,events,deps,owner,ref}=await migratedFixture(t);const before=(await env.DB.prepare('SELECT * FROM curriculum_entries').all()).results;
 const preview=await previewOwnerImport(env,ref(),deps);assert.equal(preview.origin,'calendar_latest');assert.equal(preview.values.lesson_plan,'カレンダーの最新編集\n');
 const body={request_id:request(),owner_id:owner.id,owner_revision:1,preview,confirm_owner:true};
 await assert.rejects(importOwnerRecord(env,{...body,confirm_owner:false},deps));
 const result=await importOwnerRecord(env,body,deps);assert.equal(result.record.homework,' p.10 ');assert.deepEqual((await env.DB.prepare('SELECT * FROM curriculum_entries').all()).results,before);
 assert.equal(events[0].description,preview.description);assert.deepEqual(await importOwnerRecord(env,body,deps),result);
});
test('changed Calendar ETag/content or DB revision rejects import without partial history, and excluded targets cannot bind or import',async t=>{
 const {env,events,deps,owner,ref}=await migratedFixture(t),preview=await previewOwnerImport(env,ref(),deps);events[0].etag='v2';
 await assert.rejects(importOwnerRecord(env,{request_id:request(),owner_id:owner.id,owner_revision:1,preview,confirm_owner:true},deps));assert.equal((await listOwnerRecords(env,owner.id)).length,0);
 await env.DB.prepare("INSERT INTO lesson_history_exclusions VALUES('a','event-1','未定空欄維持')").run();await assert.rejects(previewOwnerImport(env,ref(),deps));await assert.rejects(bind(env,owner,ref(),deps));
});
test('new mode fails closed until reviewed exclusions and cutover evidence exist',async t=>{
 const {env,owner,ref}=await setup(t);await env.DB.prepare('UPDATE lesson_history_policy SET cutover_ready=0').run();env.LESSON_HISTORY_MODE='active';await assert.rejects(readEventOwnerRecord(env,ref()),e=>e.status===503);
 env.LESSON_HISTORY_MODE='off';await assert.rejects(listOwnerRecords(env,owner.id),e=>e.status===503);
});
test('reusing the same event ID and title with a new creation identity does not inherit the former owner record',async t=>{
 const {env,owner,events,deps,ref}=await setup(t);events[0].created='2026-01-01T00:00:00Z';await bind(env,owner,ref(),deps);env.LESSON_HISTORY_MODE='active';
 events[0].created='2026-11-01T00:00:00Z';events[0].etag='recreated';
 const changed=await readEventOwnerRecord(env,ref(),events[0]);assert.equal(changed.attribution_status,'event_recreated');assert.equal(changed.lesson_plan,'');
 await assert.rejects(writeEventOwnerRecord(env,{target:ref(),patch:{homework:'wrong'},record_revision:1},deps));assert.equal((await listOwnerRecords(env,owner.id)).length,1);
});
test('parallel duplicate requests commit one record, and competing revisions commit one winner',async t=>{
 const {env,owner}=await setup(t),body={request_id:request(),owner_id:owner.id,owner_revision:1,lesson_date:'2026-11-01'};
 const [a,b]=await Promise.all([createOwnerRecord(env,body),createOwnerRecord(env,body)]);assert.equal(a.record.id,b.record.id);assert.equal((await listOwnerRecords(env,owner.id)).length,1);
 const results=await Promise.allSettled(['one','two'].map(homework=>editOwnerRecord(env,a.record.id,{request_id:request(),revision:1,homework})));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await listOwnerRecords(env,owner.id))[0].revision,2);
});
test('reconciliation refresh adopts later Calendar edits only while imported D1 values and ownership remain untouched',async t=>{
 const {env,events,deps,owner,ref}=await migratedFixture(t);
 let preview=await previewOwnerImport(env,ref(),deps),saved=await importOwnerRecord(env,{request_id:request(),owner_id:owner.id,owner_revision:1,confirm_owner:true,preview},deps);
 const binding={calendar_id:'a',event_id:'event-1',title:'甲',generation:0};events[0].description=plainCalendarRecordLayout('',{...preview.values,homework:'後からCalendarで編集'},binding).after_description;events[0].etag='v2';
 preview=await previewOwnerImport(env,ref(),deps);saved=await importOwnerRecord(env,{request_id:request(),owner_id:owner.id,owner_revision:1,confirm_owner:true,preview,refresh:true,record_revision:saved.record.revision},deps);
 assert.equal(saved.record.homework,'後からCalendarで編集');assert.equal(saved.record.revision,2);
 await editOwnerRecord(env,saved.record.id,{request_id:request(),revision:2,lesson_memo:'D1で個別編集'});preview=await previewOwnerImport(env,ref(),deps);
 await assert.rejects(importOwnerRecord(env,{request_id:request(),owner_id:owner.id,owner_revision:1,confirm_owner:true,preview,refresh:true,record_revision:3},deps));assert.equal((await listOwnerRecords(env,owner.id))[0].lesson_memo,'D1で個別編集');
});
test('imports require the editing freeze and fresh restore evidence, never a simple feature flag flip',async t=>{
 const {env,deps,owner,ref}=await migratedFixture(t),preview=await previewOwnerImport(env,ref(),deps),body={request_id:request(),owner_id:owner.id,owner_revision:1,confirm_owner:true,preview};
 env.LESSON_HISTORY_MODE='prepare';await assert.rejects(importOwnerRecord(env,body,deps));env.LESSON_HISTORY_MODE='reconcile';await env.DB.prepare("UPDATE lesson_history_policy SET evidence_json='{}'").run();await assert.rejects(importOwnerRecord(env,body,deps));assert.equal((await listOwnerRecords(env,owner.id)).length,0);
});

test('next unassigned occurrence is a visible confirmation candidate, never a name-based owner/record transfer',async t=>{
 const {env,events,deps,owner,ref}=await setup(t);await bind(env,owner,ref(),deps);env.LESSON_HISTORY_MODE='active';events[1].description='other unverified content';const before=(await env.DB.prepare('SELECT * FROM lesson_history_records').all()).results;
 const next=await readNextLessonPlan(env,'a',events[0].id,deps);assert.equal(next.target.id,events[1].id);assert.equal(next.reason,'owner_confirmation_required');assert.equal(next.owner_confirmation_required,true);assert.equal(next.owner_id,null);assert.equal(next.source_owner_id,owner.id);assert.equal(next.lesson_plan,'');assert.equal(next.homework,undefined);assert.equal(next.template_initialization_available,false);assert.deepEqual((await env.DB.prepare('SELECT * FROM lesson_history_records').all()).results,before);assert.equal((await env.DB.prepare('SELECT count(*) n FROM lesson_event_links').first()).n,1);
 events[1].status='cancelled';events[2].summary=events[0].summary;assert.equal((await readNextLessonPlan(env,'a',events[0].id,deps)).target.id,events[2].id);
});
test('earlier unassigned candidate is not hidden behind a later confirmed lesson; ties are ambiguous',async t=>{
 const {env,events,deps,owner,ref}=await setup(t);await bind(env,owner,ref(),deps);await bind(env,owner,ref(2),deps);env.LESSON_HISTORY_MODE='active';assert.equal((await readNextLessonPlan(env,'a',events[0].id,deps)).target.id,events[1].id);
 events.push({...events[1],id:'duplicate-unassigned'});const result=await readNextLessonPlan(env,'a',events[0].id,deps);assert.equal(result.reason,'ambiguous');assert.equal(result.target,null);assert.equal(result.lesson_plan,'');
});
test('owner mismatch is skipped, renamed/recreated same-owner target requires confirmation without private values',async t=>{
 const {env,events,deps,owner,makeOwner,ref}=await setup(t),other=await makeOwner('甲');await bind(env,owner,ref(),deps);await bind(env,other,ref(1),deps);await bind(env,owner,ref(2),deps);env.LESSON_HISTORY_MODE='active';
 events[2].summary='新しい名前';let result=await readNextLessonPlan(env,'a',events[0].id,deps);assert.equal(result.target.id,events[2].id);assert.equal(result.owner_confirmation_required,true);assert.equal(result.lesson_plan,'');
 events[2].summary='乙';events[2].created='2026-11-02T00:00:00Z';result=await readNextLessonPlan(env,'a',events[0].id,deps);assert.equal(result.attribution_status,'event_recreated');assert.equal(result.owner_confirmation_required,true);
});
test('unassigned sources do not scan a year; bound sources batch bindings and avoid unrelated per-event D1 reads',async t=>{
 const {env,events,deps,owner,ref}=await setup(t);let lists=0;const original=deps.events;deps.events=async(...args)=>{lists++;return original(...args);};env.LESSON_HISTORY_MODE='active';assert.equal((await readNextLessonPlan(env,'a',events[0].id,deps)).reason,'owner_unassigned');assert.equal(lists,0);
 await bind(env,owner,ref(),deps);for(let i=0;i<400;i++)events.push({...events[1],id:'unrelated-'+i,summary:'different '+i});const real=env.DB;let reads=0;env.DB={prepare(sql){if(/^SELECT/.test(sql))reads++;return real.prepare(sql);}};const result=await readNextLessonPlan(env,'a',events[0].id,deps);assert.equal(result.reason,'owner_confirmation_required');assert.ok(reads<12,'bounded D1 reads, not 400 per-event lookups: '+reads);
});
