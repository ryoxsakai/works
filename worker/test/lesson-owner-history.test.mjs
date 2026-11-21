import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {ensureAttribution} from '../src/lesson-attribution.js';
import {lessonEventRef} from '../../shared/lesson-plan.js';
import {createLessonOwner,renameLessonOwner,createOwnerRecord,editOwnerRecord,listLessonOwners,listOwnerRecords,changeLessonBinding,readEventOwnerRecord,previewOwnerImport,importOwnerRecord,writeEventOwnerRecord,writePendingLessonPlan,confirmNextLessonBinding,carryNextPlan} from '../src/lesson-owner-history.js';
import {readNextLessonPlan,writeLessonPlan} from '../src/lesson-plan.js';
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
test('same-name next cards retain their independent bound owners; unbound additions stay blank',async t=>{
 const {env,events,deps,owner,makeOwner,ref}=await setup(t);const other=await makeOwner('甲');await bind(env,owner,ref(),deps);await bind(env,other,ref(1),deps);await bind(env,owner,ref(2),deps);env.LESSON_HISTORY_MODE='active';
 const result=await readNextLessonPlan(env,'a',events[0].id,deps);assert.equal(result.target.id,events[1].id);assert.equal(result.owner_id,other.id);assert.equal(result.source_owner_id,owner.id);
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
test('preview handles a blank unbound event without creating records or suppressing calendar text',async t=>{
 const {env,events,deps,ref}=await setup(t);
 const preview=await previewOwnerImport(env,ref(),deps);
 assert.equal(preview.source,null);assert.equal(preview.values.lesson_plan,'');assert.equal(preview.owner_confirmation_required,true);
 assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM lesson_history_records').first()).n,0);
 events[0].description='授業予定：要確認';
 await assert.rejects(previewOwnerImport(env,ref(),deps),/個別照合/);
});
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
test('same-name owner mismatch is reported before renamed/recreated same-owner targets',async t=>{
 const {env,events,deps,owner,makeOwner,ref}=await setup(t),other=await makeOwner('甲');await bind(env,owner,ref(),deps);await bind(env,other,ref(1),deps);await bind(env,owner,ref(2),deps);env.LESSON_HISTORY_MODE='active';
 let result=await readNextLessonPlan(env,'a',events[0].id,deps);assert.equal(result.target.id,events[1].id);assert.equal(result.owner_id,other.id);assert.equal(result.owner_confirmation_required,undefined);assert.equal(result.lesson_plan,'');events[1].status='cancelled';events[2].summary='新しい名前';result=await readNextLessonPlan(env,'a',events[0].id,deps);assert.equal(result.target.id,events[2].id);assert.equal(result.owner_confirmation_required,true);assert.equal(result.lesson_plan,'');
 events[2].summary='乙';events[2].created='2026-11-02T00:00:00Z';result=await readNextLessonPlan(env,'a',events[0].id,deps);assert.equal(result.attribution_status,'event_recreated');assert.equal(result.owner_confirmation_required,true);
});
test('unassigned sources do not scan a year; bound sources batch bindings and avoid unrelated per-event D1 reads',async t=>{
 const {env,events,deps,owner,ref}=await setup(t);let lists=0;const original=deps.events;deps.events=async(...args)=>{lists++;return original(...args);};env.LESSON_HISTORY_MODE='active';assert.equal((await readNextLessonPlan(env,'a',events[0].id,deps)).reason,'owner_unassigned');assert.equal(lists,0);
 await bind(env,owner,ref(),deps);for(let i=0;i<400;i++)events.push({...events[1],id:'unrelated-'+i,summary:'different '+i});const real=env.DB;let reads=0;env.DB={prepare(sql){if(/^SELECT/.test(sql))reads++;return real.prepare(sql);}};const result=await readNextLessonPlan(env,'a',events[0].id,deps);assert.equal(result.reason,'owner_confirmation_required');assert.ok(reads<12,'bounded D1 reads, not 400 per-event lookups: '+reads);
});

test('explicitly excluded bound and unbound occurrences are skipped before earliest/tied next candidate selection',async t=>{
 const {env,events,deps,owner,ref}=await setup(t);await bind(env,owner,ref(),deps);await bind(env,owner,ref(2),deps);env.LESSON_HISTORY_MODE='active';
 await env.DB.prepare("INSERT INTO lesson_history_exclusions VALUES('a',?,'excluded')").bind(events[1].id).run();let result=await readNextLessonPlan(env,'a',events[0].id,deps);assert.equal(result.target.id,events[2].id);assert.equal(result.owner_confirmation_required,undefined);
 events.push({...events[2],id:'excluded-tie'});await env.DB.prepare("INSERT INTO lesson_history_exclusions VALUES('a','excluded-tie','excluded')").run();result=await readNextLessonPlan(env,'a',events[0].id,deps);assert.equal(result.target.id,events[2].id);assert.notEqual(result.reason,'ambiguous');
 await env.DB.prepare("INSERT INTO lesson_history_exclusions VALUES('a',?,'excluded')").bind(events[2].id).run();result=await readNextLessonPlan(env,'a',events[0].id,deps);assert.equal(result.target,null);assert.equal(result.reason,'none');
});


test('ToDo mentions use individual IDs, retain renamed students and reject class links', async t => {
 const {env,owner,makeOwner} = await setup(t);
 const other = await makeOwner(owner.name), group = await makeOwner(owner.name,'class');
 await renameLessonOwner(env,owner.id,{revision:owner.revision,name:'改名後',request_id:request()});
 const {studentLinkDirectory} = await import('../src/lesson-owner-history.js');
 const {validateNewStudentLinks} = await import('../src/todo-planner.js');
 const rows = await studentLinkDirectory(env);
 assert.deepEqual(new Set(rows.map(s=>s.id)),new Set([owner.id,other.id]));
 assert.ok(rows.find(s=>s.id===owner.id).aliases.includes(owner.name));
 const task = id => ({id:'task',plan:{students:[{id,name:'同姓'}]}});
 await validateNewStudentLinks(env.DB,[task(owner.id)],[]);
 await assert.rejects(validateNewStudentLinks(env.DB,[task(group.id)],[]),/生徒/);
});

async function nextBindingFixture(t,{future=false,past=false}={}){
 const f=await setup(t),{env,events,deps,owner,ref}=f;
 for(const event of events)Object.assign(event,{created:'2026-01-01T05:00:00Z',iCalUID:event.id+'-uid'});
 if(future||past)events.forEach((event,i)=>{const date=new Date(Date.now()+(past?i-5:i+1)*86400000).toISOString().slice(0,10);
  event.start.dateTime=date+'T10:00:00+09:00';event.end.dateTime=date+'T11:00:00+09:00';
 });
 events[1].summary='○';const former=ref(1);
 const record=(await bind(env,owner,ref(),deps)).record;
 await editOwnerRecord(env,record.id,{request_id:request(),revision:1,lesson_plan:'前の授業の予定',lesson_memo:'引き継がないメモ'});
 env.LESSON_HISTORY_MODE='active';
 const find=(cal='a',id=events[0].id)=>readNextLessonPlan(env,cal,id,deps);
 assert.equal((await find()).target,null,'a vacant circle is not a lesson');
 Object.assign(events[1],{summary:'甲',etag:'after-name-change'});
 const pending=async plan=>{
  const candidate=await find();
  return writePendingLessonPlan(env,{target:candidate.target,pending_context:candidate.pending_context,record_revision:candidate.record_revision,expected_lesson_plan:candidate.lesson_plan,lesson_plan:plan,request_id:request()},deps);
 };
 const body=candidate=>({source:candidate.source,target:candidate.target,fingerprint:candidate.next_binding.fingerprint,confirm:true,request_id:request()});
 const confirm=payload=>confirmNextLessonBinding(env,payload,deps,find);
 return {...f,former,record,find,pending,body,confirm};
}
test('explicit same-owner shortcut binds a renamed vacancy and adopts only the current saved draft',async t=>{
 const {env,events,owner,former,record,find,pending,body,confirm}=await nextBindingFixture(t);
 const draft=await pending('合成の次回予定\nそのまま残す  ');
 const savedDraft=(await env.DB.prepare('SELECT * FROM lesson_pending_plans').first());
 let candidate=await find();
 assert.equal(candidate.target.id,former.id);assert.notEqual(candidate.target.etag,former.etag);
 assert.equal(candidate.attribution_status,'owner_unassigned');assert.equal(candidate.owner_id,null);
 assert.deepEqual(candidate.next_binding,{owner_id:owner.id,owner_name:owner.name,owner_kind:'student',fingerprint:candidate.next_binding.fingerprint,has_draft:true});
 assert.equal((await listOwnerRecords(env,owner.id)).length,1,'GET does not bind');
 const payload=body(candidate);
 await assert.rejects(confirm({...payload,confirm:false}),e=>e.status===400);
 const result=await confirm(payload);
 assert.equal(result.record.owner_id,owner.id);assert.equal(result.record.lesson_plan,draft.lesson_plan);
 assert.equal(result.record.lesson_memo,'');assert.notEqual(result.record.id,record.id);
 assert.deepEqual(await confirm(payload),result,'operation retry is idempotent');
 const all=await listOwnerRecords(env,owner.id);
 assert.deepEqual(all.map(r=>r.event_id),[events[0].id,events[1].id]);
 assert.equal(all[0].lesson_plan,'前の授業の予定');assert.equal(all[0].lesson_memo,'引き継がないメモ');
 assert.deepEqual(await env.DB.prepare('SELECT * FROM lesson_pending_plans').first(),savedDraft,'original draft retained byte for byte');
 candidate=await find();assert.equal(candidate.owner_id,owner.id);assert.equal(candidate.lesson_plan,draft.lesson_plan);assert.equal(candidate.next_binding,undefined);
});
test('next shortcut rejects stale draft revision atomically, including a competing update just before the write batch',async t=>{
 const {env,find,pending,body,confirm}=await nextBindingFixture(t);
 await pending('first');const old=body(await find());await pending('another tab edited');
 await assert.rejects(confirm(old),e=>e.status===409);
 const next=body(await find()),db=env.DB;
 env.DB={prepare:sql=>db.prepare(sql),async batch(items){
  await db.prepare("UPDATE lesson_pending_plans SET lesson_plan='winner', revision=revision+1").run();
  return db.batch(items);
 }};
 await assert.rejects(confirm(next),e=>e.code==='LESSON_HISTORY_RELOAD');
 env.DB=db;
 assert.equal((await db.prepare('SELECT count(*) AS n FROM lesson_event_links').first()).n,1);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM lesson_history_records').first()).n,1);
 assert.deepEqual(await db.prepare('SELECT lesson_plan,revision FROM lesson_pending_plans').first(),{lesson_plan:'winner',revision:3});
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM lesson_history_audit WHERE action=?').bind('confirm_next_binding').first()).n,0);
});
test('shortcut remains unavailable for ambiguity, different fixed owners, exclusions, old contexts, legacy or unstable slot identities',async t=>{
 const {env,events,deps,owner,makeOwner,ref,find,pending,body,confirm}=await nextBindingFixture(t),db=env.DB;
 const old=body(await find());
 const competitor=await makeOwner('甲','class');
 assert.equal((await find()).next_binding,undefined,'case of identical student/class cannot be guessed');
 await assert.rejects(confirm(old),e=>e.status===409);
 await db.prepare('DELETE FROM lesson_owner_aliases WHERE owner_id=?').bind(competitor.id).run();await db.prepare('DELETE FROM lesson_owners WHERE id=?').bind(competitor.id).run();
 events.push({...events[1],id:'tie',iCalUID:'tie-uid'});
 assert.equal((await find()).reason,'ambiguous');await assert.rejects(confirm(old),e=>e.status===409);events.pop();
 await db.prepare("INSERT INTO lesson_history_exclusions VALUES('a',?,'explicit exclusion')").bind(events[1].id).run();
 assert.equal((await find()).target,null);await assert.rejects(confirm(old),e=>e.status===409);
 await db.prepare('DELETE FROM lesson_history_exclusions').run();
 await db.prepare("INSERT INTO curriculum_entries VALUES(?,0,'legacy','','','','old')").bind(events[1].id).run();
 assert.equal((await find()).next_binding,undefined);await assert.rejects(confirm(old),e=>e.status===409);
 await db.prepare('DELETE FROM curriculum_entries').run();
 events[1].description='授業予定：元の情報';assert.equal((await find()).next_binding,undefined);delete events[1].description;
 const originalIdentity=events[1].iCalUID;delete events[1].iCalUID;
 assert.equal((await find()).next_binding,undefined);events[1].iCalUID=originalIdentity;
 await pending('元の版の下書き'); const beforeMove=body(await find());
 events[1].etag='moved';events[1].iCalUID='new-event-generation';events[1].start.dateTime='2026-11-02T12:00:00+09:00';events[1].end.dateTime='2026-11-02T13:00:00+09:00';
 assert.equal((await find()).next_binding,undefined,'older context from a different generation remains manual');
 await assert.rejects(confirm(beforeMove),e=>e.status===409);
 const different=await makeOwner('別の生徒'); const other=await bind(env,different,ref(1),deps);
 assert.equal((await find()).next_binding,undefined);assert.equal((await find()).owner_id,other.record.owner_id);
 assert.equal((await listOwnerRecords(env,owner.id)).length,1);
});
test('stale list identity is not enough: direct Google re-read guards the next slot',async t=>{
 const {env,events,deps,find,pending,body,confirm}=await nextBindingFixture(t);
 await pending('keep exact draft');
 const payload=body(await find()),stored=(await env.DB.prepare('SELECT * FROM lesson_pending_plans').first());
 const direct=deps.event;deps.event=(token,cal,id)=>id===events[1].id?{...events[1],iCalUID:'other-generation'}:direct(token,cal,id);
 await assert.rejects(confirm(payload),e=>e.status===409);
 assert.deepEqual(await env.DB.prepare('SELECT * FROM lesson_pending_plans').first(),stored);
 assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM lesson_event_links').first()).n,1);
});

const automaticPayload=offer=>({source:offer.source,target:offer.target,fingerprint:offer.next_binding.fingerprint,
 confirm:true,automatic:true,request_id:'auto-next-'+offer.next_binding.fingerprint});
test('automatic binding follows an earlier renamed slot, never moving the prior next event plan',async t=>{
 const {env,events,deps,owner,ref,find,pending,confirm}=await nextBindingFixture(t,{future:true});
 events[1].summary='○';events[2].summary='甲';
 const previous=(await bind(env,owner,ref(2),deps)).record;
 await editOwnerRecord(env,previous.id,{request_id:request(),revision:1,lesson_plan:'後日の確定済み予定'});
 assert.equal((await find()).target.id,events[2].id);
 events[1].summary='甲';events[1].etag='new-earlier-slot';
 let current=await find();
 assert.equal(current.target.id,events[1].id);
 assert.equal(current.next_binding.automatic,true,'safe empty occurrence may link');
 const text='この予定に保存した下書き';
 await pending(text);
 current=await find();
 assert.equal(current.next_binding.automatic,true);
 assert.equal((await listOwnerRecords(env,owner.id)).length,2,'GET stays pure');
 const payload=automaticPayload(current),result=await confirm(payload);
 assert.equal(result.record.lesson_plan,text);assert.equal((await find()).target.id,events[1].id);
 assert.equal((await listOwnerRecords(env,owner.id)).find(r=>r.id===previous.id).lesson_plan,'後日の確定済み予定');
 assert.deepEqual(await confirm(payload),result,'retry is idempotent and does not target the later appointment');
});
test('unique pending draft follows the same immutable Calendar event across time/ETag changes',async t=>{
 const {env,events,find,pending,confirm}=await nextBindingFixture(t,{future:true});
 await pending('既存の下書き\n保持');const original=await find(),old=automaticPayload(original);
 events[1].etag='time-change';events[1].start.dateTime=events[1].start.dateTime.replace('T10:00','T13:00');events[1].end.dateTime=events[1].end.dateTime.replace('T11:00','T14:00');
 const moved=await find();assert.equal(moved.target.id,original.target.id);
 assert.equal(moved.next_binding.automatic,true);assert.equal(moved.next_binding.moved_draft,'既存の下書き\n保持');
 assert.equal(moved.lesson_plan,'','do not seed stale draft as editable current context');
 await assert.rejects(confirm(old),e=>e.status===409);
 const result=await confirm(automaticPayload(moved));
 assert.equal(result.record.lesson_plan,'既存の下書き\n保持');assert.equal(result.target.start,moved.target.start);
 assert.equal((await env.DB.prepare('SELECT count(*) n FROM lesson_pending_plans').first()).n,1);
});
test('a saved current blank remains authoritative during automatic association',async t=>{
 const {events,find,pending,confirm}=await nextBindingFixture(t,{future:true});
 await pending('古い記述');events[1].etag='second-version';
 await pending('');const current=await find();
 assert.equal(current.next_binding.has_draft,true);assert.equal(current.next_binding.moved_draft,undefined);assert.equal(current.next_binding.automatic,true);
 const result=await confirm(automaticPayload(current));assert.equal(result.record.lesson_plan,'');
 assert.equal(JSON.parse(result.record.source_json).lesson_plan_touched,true);
});
test('multiple older contexts are never chosen automatically',async t=>{
 const {events,find,pending}=await nextBindingFixture(t,{future:true});
 await pending('古い記述');events[1].etag='second-version';
 await pending('別の記述');events[1].etag='third-version';
 assert.equal((await find()).next_binding,undefined,'multiple old drafts require manual selection');
});
test('the automatic endpoint refuses past starts even when a valid saved draft exists',async t=>{
 const {find,pending,confirm}=await nextBindingFixture(t,{past:true});
 await pending('歴史的な下書き');const shown=await find();
 assert.equal(shown.next_binding.has_draft,true);assert.equal(shown.next_binding.automatic,undefined);
 await assert.rejects(confirm(automaticPayload(shown)),e=>e.status===409);
});
test('auto-created empty link never cascades to another blank, but permits its own verified nonempty target draft',async t=>{
 const {env,events,deps,owner,find,confirm,ref}=await nextBindingFixture(t,{future:true});
 events[2].summary='甲';
 const first=await confirm(automaticPayload(await find()));
 assert.equal(first.record.lesson_plan,'');assert.equal(JSON.parse(first.record.source_json).automatic_empty,true);
 const fromNew=()=>find('a',events[1].id),next=await fromNew();assert.equal(next.target.id,events[2].id);
 assert.equal(next.next_binding.automatic,undefined);
 await assert.rejects(confirm(automaticPayload(next)),e=>e.status===409);
 await writePendingLessonPlan(env,{target:ref(2),pending_context:next.pending_context,record_revision:0,expected_lesson_plan:'',lesson_plan:'次の枠の入力',request_id:request()},deps);
 const withDraft=await fromNew();assert.equal(withDraft.next_binding.automatic,true);
 const owned=await confirm(automaticPayload(withDraft));assert.equal(owned.record.lesson_plan,'次の枠の入力');assert.equal(owned.record.owner_id,owner.id);
});

const carryPayload=offer=>({source:offer.source,target:offer.target,from:offer.next_plan_carry.from,fingerprint:offer.next_plan_carry.fingerprint,
 confirm:true,request_id:'auto-carry-'+offer.next_plan_carry.fingerprint});
const saveFromNext=(env,deps,offer,plan)=>writeLessonPlan(env,{source:offer.source,target:offer.target,
 expected_source_owner_id:offer.source_owner_id,expected_owner_id:offer.owner_id,pending_context:offer.pending_context,
 record_revision:offer.record_revision,expected_lesson_plan:offer.lesson_plan,lesson_plan:plan,request_id:request()},deps);
async function carryFixture(t,{direct=false,retainedDraft=false}={}){
 const f=await nextBindingFixture(t,{future:true}),{env,events,deps,owner,ref,find,confirm}=f;
 events[1].summary='○';events[2].summary='甲';
 const later=(await bind(env,owner,ref(2),deps)).record;
 await editOwnerRecord(env,later.id,{request_id:request(),revision:1,homework:'旧枠の宿題を残す',lesson_memo:'旧枠の独立メモ'});
 const old=await find(),plan='元のカードの次回欄で入力\n原文  ';
 const saved=await writeLessonPlan(env,{...(direct?{}:{source:old.source,expected_source_owner_id:owner.id}),target:old.target,
  expected_owner_id:owner.id,record_revision:old.record_revision,expected_lesson_plan:'',lesson_plan:plan,request_id:request()},deps);
 Object.assign(events[1],{summary:'甲',etag:'earlier-inserted-slot'});
 if(retainedDraft)await f.pending('ここに直接保存された未処理の下書き');
 const earlier=(retainedDraft?await bind(env,owner,ref(1),deps):await confirm(automaticPayload(await find()))).record;
 const carry=payload=>carryNextPlan(env,payload,deps,find);
 return {...f,later,earlier,carry,saved,plan};
}
test('the confirmed source next-editor provenance follows to an earlier newly bound blank without altering other fields',async t=>{
 const {env,events,owner,find,later,earlier,carry,plan}=await carryFixture(t);
 const savedLater=(await listOwnerRecords(env,owner.id)).find(r=>r.id===later.id);
 assert.equal(JSON.parse(savedLater.source_json).next_plan_intent.source_id,events[0].id);
 assert.equal(savedLater.lesson_plan,plan);
 const preimage=(await env.DB.prepare('SELECT * FROM lesson_history_records ORDER BY id').all()).results;
 const shown=await find();assert.equal(shown.target.id,events[1].id);assert.equal(shown.lesson_plan,'');assert.equal(shown.next_plan_carry.from.id,events[2].id);
 assert.deepEqual((await env.DB.prepare('SELECT * FROM lesson_history_records ORDER BY id').all()).results,preimage,'offer is read only');
 const payload=carryPayload(shown),result=await carry(payload);
 assert.equal(result.record.id,earlier.id);assert.equal(result.record.lesson_plan,plan);assert.equal(result.previous.lesson_plan,'');
 assert.equal(result.previous.homework,'旧枠の宿題を残す');assert.equal(result.previous.lesson_memo,'旧枠の独立メモ');
 assert.deepEqual(await carry(payload),result);
 const recorded=await find();assert.equal(recorded.lesson_plan,plan);assert.equal(recorded.next_plan_carry,undefined);
 const original=await env.DB.prepare("SELECT before_json FROM lesson_history_audit WHERE action='carry_next_plan'").first();
 assert.equal(JSON.parse(original.before_json).from.lesson_plan,plan,'audit preserves the original plan');
 assert.equal((await env.DB.prepare('SELECT count(*) n FROM lesson_event_links').first()).n,3);
});
test('directly authored later plan, touched blank, and completed source/target remain untouched',async t=>{
 const direct=await carryFixture(t,{direct:true});assert.equal((await direct.find()).next_plan_carry,undefined);
 assert.equal((await listOwnerRecords(direct.env,direct.owner.id)).find(r=>r.id===direct.later.id).lesson_plan,direct.plan);
 const {env,owner,find,later,earlier,carry}=await carryFixture(t);
 const payload=carryPayload(await find());
 for(const [record,revision]of [[later,3],[earlier,1]]){
  await env.DB.prepare('UPDATE lesson_history_records SET completed=1 WHERE id=?').bind(record.id).run();
  assert.equal((await find()).next_plan_carry,undefined);await assert.rejects(carry(payload),e=>e.status===409);
  await env.DB.prepare('UPDATE lesson_history_records SET completed=0 WHERE id=?').bind(record.id).run();
 }
 await editOwnerRecord(env,earlier.id,{request_id:request(),revision:1,lesson_plan:''});
 assert.equal((await find()).next_plan_carry,undefined,'current explicit blank never resurrects an earlier assignment');
 await assert.rejects(carry(payload),e=>e.status===409);assert.equal((await listOwnerRecords(env,owner.id)).find(r=>r.id===earlier.id).lesson_plan,'');
});
test('a next-editor append cannot make directly written, legacy unmarked, or explicitly cleared owned text movable',async t=>{
 const {env,events,deps,owner,find,later,plan}=await carryFixture(t,{direct:true});
 const readLater=async()=> (await listOwnerRecords(env,owner.id)).find(r=>r.id===later.id);
 events[1].summary='○';
 const directAppend=plan+'\n次回欄から追記';
 await saveFromNext(env,deps,await find(),directAppend);
 let stored=await readLater();assert.equal(stored.lesson_plan,directAppend);assert.equal(JSON.parse(stored.source_json).next_plan_intent,undefined);
 // A historical record with content but no new metadata is equally unproven.
 const legacyMeta={binding_decision:'new'};
 await env.DB.prepare('UPDATE lesson_history_records SET source_json=? WHERE id=?').bind(JSON.stringify(legacyMeta),later.id).run();
 await saveFromNext(env,deps,await find(),'旧記録の全体を編集しても起源不明');
 stored=await readLater();assert.equal(JSON.parse(stored.source_json).next_plan_intent,undefined);
 await editOwnerRecord(env,later.id,{request_id:request(),revision:stored.revision,lesson_plan:''});
 await saveFromNext(env,deps,await find(),'明示的に空欄にした欄への再入力');
 stored=await readLater();assert.equal(JSON.parse(stored.source_json).next_plan_intent,undefined);
 events[1].summary='甲';assert.equal((await find()).next_plan_carry,undefined);
 assert.equal(stored.lesson_plan,'明示的に空欄にした欄への再入力');
});
test('the exact same source intent survives rescheduling and later edits; a recreated source with the same ID cannot re-mark',async t=>{
 const {env,events,deps,owner,find,ref,record,later,plan}=await carryFixture(t);
 const readLater=async()=> (await listOwnerRecords(env,owner.id)).find(r=>r.id===later.id);
 const originalIntent=JSON.parse((await readLater()).source_json).next_plan_intent;
 events[1].summary='○';events[0].etag='moved-same-source';events[2].etag='moved-same-target';
 events[2].start.dateTime=events[2].start.dateTime.replace('T10:00','T13:00');events[2].end.dateTime=events[2].end.dateTime.replace('T11:00','T14:00');
 await saveFromNext(env,deps,await find(),plan+'\n同じ元の授業から続けて入力');
 assert.deepEqual(JSON.parse((await readLater()).source_json).next_plan_intent,originalIntent);
 events[1].summary='甲';assert.ok((await find()).next_plan_carry);
 events[1].summary='○';Object.assign(events[0],{etag:'recreated-source',iCalUID:'new-source-identity'});
 await changeLessonBinding(env,{request_id:request(),target:ref(),link_revision:1,decision:'same_owner',record_id:record.id,owner_id:owner.id},deps);
 await saveFromNext(env,deps,await find(),'同じ予定IDでも生成元の異なるフォームから編集');
 assert.equal(JSON.parse((await readLater()).source_json).next_plan_intent,undefined);
 events[1].summary='甲';assert.equal((await find()).next_plan_carry,undefined);
});
test('first entry in a known untouched legacy linked blank can earn provenance',async t=>{
 const {env,events,deps,owner,find,ref}=await nextBindingFixture(t,{future:true});
 events[1].summary='○';events[2].summary='甲';
 const later=(await bind(env,owner,ref(2),deps)).record;
 await env.DB.prepare('UPDATE lesson_history_records SET source_json=? WHERE id=?').bind(JSON.stringify({binding_decision:'new'}),later.id).run();
 await saveFromNext(env,deps,await find(),'旧方式で紐づけた未入力欄への初回入力');
 const stored=(await listOwnerRecords(env,owner.id)).find(r=>r.id===later.id);
 assert.equal(JSON.parse(stored.source_json).next_plan_intent.target_id,events[2].id);
});
test('a retained draft prevents carry even when a manually linked destination is blank',async t=>{
 const {env,owner,find,later,earlier,plan}=await carryFixture(t,{retainedDraft:true});
 const next=await find();assert.equal(next.lesson_plan,'');assert.equal(next.next_plan_carry,undefined);
 const records=await listOwnerRecords(env,owner.id);
 assert.equal(records.find(r=>r.id===earlier.id).lesson_plan,'');
 assert.equal(records.find(r=>r.id===later.id).lesson_plan,plan);
 assert.equal((await env.DB.prepare('SELECT lesson_plan FROM lesson_pending_plans').first()).lesson_plan,'ここに直接保存された未処理の下書き');
});
test('changed source date, a later direct edit, and a concurrent destination write block the carry atomically',async t=>{
 const {env,events,owner,find,later,earlier,carry,plan}=await carryFixture(t);
 const payload=carryPayload(await find()),sourceTime=events[0].end.dateTime;
 events[0].end.dateTime=events[1].end.dateTime;assert.equal((await find()).target.id,events[2].id);
 await assert.rejects(carry(payload),e=>e.status===409);events[0].end.dateTime=sourceTime;
 const db=env.DB,sourceMeta=(await db.prepare('SELECT source_json FROM lesson_history_records WHERE id=?').bind(later.id).first()).source_json;
 env.DB={prepare:sql=>db.prepare(sql),async batch(statements){
  await db.prepare("UPDATE lesson_history_records SET lesson_plan='新しい予定',revision=revision+1 WHERE id=?").bind(earlier.id).run();
  return db.batch(statements);
 }};
 await assert.rejects(carry(payload),e=>e.code==='LESSON_HISTORY_RELOAD');env.DB=db;
 const records=await listOwnerRecords(env,owner.id);
 assert.equal(records.find(r=>r.id===later.id).lesson_plan,plan);assert.equal(records.find(r=>r.id===later.id).source_json,sourceMeta);
 assert.equal(records.find(r=>r.id===earlier.id).lesson_plan,'新しい予定');
 await db.prepare('UPDATE lesson_history_records SET lesson_plan=?,revision=1 WHERE id=?').bind('',earlier.id).run();
 await editOwnerRecord(env,later.id,{request_id:request(),revision:3,lesson_plan:plan,lesson_memo:'直接編集へ改めた'});
 assert.equal((await find()).next_plan_carry,undefined,'even same text changed from a later direct form is not moved');
});
test('next-editor provenance survives a precise pending-draft promotion but is not invented for old drafts',async t=>{
 const {env,events,deps,owner,find,confirm}=await nextBindingFixture(t,{future:true});
 events[1].summary='○';events[2].summary='甲';
 const first=await saveFromNext(env,deps,await find(),'次回欄で保存した下書き');
 const plan='次回欄で保存した下書き\n同じ元の授業から追記';
 const continued=await saveFromNext(env,deps,await find(),plan);
 assert.deepEqual(continued.next_plan_intent,first.next_plan_intent);
 const promoted=await confirm(automaticPayload(await find()));
 assert.equal(JSON.parse(promoted.record.source_json).next_plan_intent.source_id,events[0].id);
 Object.assign(events[1],{summary:'甲',etag:'earlier-after-promotion'});
 await confirm(automaticPayload(await find()));
 const next=await find();assert.equal(next.next_plan_carry.from.id,events[2].id);
 const moved=await carryNextPlan(env,carryPayload(next),deps,find);
 assert.equal(moved.record.lesson_plan,plan);
 assert.equal((await env.DB.prepare('SELECT lesson_plan FROM lesson_pending_plans').first()).lesson_plan,plan);
});
test('a next-editor append cannot re-mark a direct or unknown pending draft, even across a new ETag',async t=>{
 const {env,events,deps,find,pending,confirm}=await nextBindingFixture(t,{future:true});
 events[1].summary='○';events[2].summary='甲';
 await pending('直接作った保留中の下書き');
 const sameContext=await saveFromNext(env,deps,await find(),'直接作った保留中の下書き\n次回欄から追記');
 assert.equal(sameContext.next_plan_intent,undefined);
 events[2].etag='new-context';
 const newContext=await find();assert.equal(newContext.lesson_plan,'');assert.equal(newContext.next_binding.moved_draft,sameContext.lesson_plan);
 const replaced=await saveFromNext(env,deps,newContext,sameContext.lesson_plan+'\n新しい版で追記');
 assert.equal(replaced.next_plan_intent,undefined);
 const promoted=await confirm(automaticPayload(await find()));
 assert.equal(JSON.parse(promoted.record.source_json).next_plan_intent,undefined);
 assert.equal(promoted.record.lesson_plan,replaced.lesson_plan);
 assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM lesson_pending_plans').first()).n,2);
 Object.assign(events[1],{summary:'甲',etag:'inserted-after-promotion'});
 await confirm(automaticPayload(await find()));
 assert.equal((await find()).next_plan_carry,undefined);
});
