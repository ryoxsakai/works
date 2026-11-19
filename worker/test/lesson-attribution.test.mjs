import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {rawRecord,currentRecord,recordWriteStatements,commitRecords,resolveAttribution,ensureAttribution} from '../src/lesson-attribution.js';
const ref={id:'recurring_20261027',calendar_id:'class-a',title:'旧生徒サンプル'};
async function setup(t,legacy=false){
  const mf=new Miniflare({modules:true,script:"export default {fetch(){return new Response('ok')}}",compatibilityDate:'2026-08-01',d1Databases:{DB:'attribution'}});
  t.after(()=>mf.dispose());const env={DB:await mf.getD1Database('DB')};
  await env.DB.prepare('CREATE TABLE curriculum_entries(calendar_event_id TEXT PRIMARY KEY, completed INTEGER DEFAULT 0,lesson_plan TEXT,confirmation_test TEXT,homework TEXT,lesson_memo TEXT,updated_at TEXT)').run();
  if(legacy){await env.DB.prepare("INSERT INTO curriculum_entries VALUES (?,1,'旧予定','テスト','宿題','メモ','old')").bind(ref.id).run();await ensureAttribution(env);await env.DB.prepare("INSERT INTO lesson_record_hold(event_id,calendar_id,reason)VALUES(?,?,'known_title_change')").bind(ref.id,ref.calendar_id).run();}
  return env;
}
const save=async(env,target,patch,revision)=>commitRecords(env,await recordWriteStatements(env,target,patch,revision));
test('known already-changed legacy content is held, explicitly inherited and archived without inferred owner',async t=>{
  const env=await setup(t,true);const old=await rawRecord(env,ref.id);
  assert.equal(currentRecord(old,ref).attribution_status,'known_change');
  assert.equal(currentRecord(old,ref).lesson_plan,null);
  await assert.rejects(save(env,ref,{homework:'wrong'},0),e=>e.code==='LESSON_ATTRIBUTION_REQUIRED');
  const resolved=await resolveAttribution(env,ref,0,'inherit');
  assert.equal(resolved.lesson_plan,'旧予定');assert.equal(resolved.completed,1);
  const archive=await env.DB.prepare('SELECT * FROM lesson_record_archive').first();
  assert.equal(archive.title,null);assert.equal(JSON.parse(archive.snapshot_json).homework,'宿題');
  assert.equal((await rawRecord(env,ref.id)).record_title,'旧生徒サンプル');
});
test('replacement archives all fields, starts blank, does not revive old content on a later rename or reload',async t=>{
  const env=await setup(t);await save(env,ref,{lesson_plan:'旧予定',homework:'旧宿題',completed:true},0);
  const changed={...ref,title:'新生徒サンプル'};let old=await rawRecord(env,ref.id);
  assert.equal(currentRecord(old,changed).attribution_status,'title_changed');
  assert.equal(currentRecord(old,changed).completed,0);
  await resolveAttribution(env,changed,old.record_revision,'separate');
  let current=await rawRecord(env,ref.id);assert.equal(current.lesson_plan,null);assert.equal(current.completed,0);
  await save(env,changed,{lesson_plan:'新予定'},current.record_revision);
  current=await rawRecord(env,ref.id);assert.equal(currentRecord(current,changed).lesson_plan,'新予定');
  assert.equal(currentRecord(current,ref).lesson_plan,null);
  const archive=await env.DB.prepare('SELECT * FROM lesson_record_archive').first();assert.equal(archive.title,'旧生徒サンプル');
  assert.equal(JSON.parse(archive.snapshot_json).lesson_plan,'旧予定');
  await assert.rejects(resolveAttribution(env,changed,old.record_revision,'separate'),e=>e.code==='LESSON_RECORD_CONFLICT');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM lesson_record_archive').first()).n,1);
});
test('time moves and cosmetic normalization retain attribution, duplicate names never copy records or series',async t=>{
  const env=await setup(t);await save(env,ref,{lesson_plan:'keep'},0);const row=await rawRecord(env,ref.id);
  assert.equal(currentRecord(row,{...ref,title:'  旧生徒サンプル　',start:'new time'}).lesson_plan,'keep');
  assert.equal(currentRecord(row,{...ref,calendar_id:'class-b'}).lesson_plan,null);
  const sibling={...ref,id:'recurring_20261103'};
  assert.equal(currentRecord(row,sibling).lesson_plan,null);
  assert.equal(currentRecord(await rawRecord(env,sibling.id),sibling).attribution_status,'new');
  await save(env,sibling,{homework:'independent'},0);
  assert.equal((await rawRecord(env,ref.id)).homework,null);
  assert.equal(currentRecord(await rawRecord(env,sibling.id),sibling).lesson_plan,null);
});
test('racing edits and confirmation cannot overwrite or archive a stale snapshot, transactions roll back',async t=>{
  const env=await setup(t);await save(env,ref,{lesson_plan:'base'},0);
  const before=await rawRecord(env,ref.id);
  const pending=await recordWriteStatements(env,ref,{homework:'stale'},before.record_revision);
  await save(env,ref,{lesson_memo:'winner'},before.record_revision);
  await assert.rejects(commitRecords(env,pending),e=>e.code==='LESSON_RECORD_CONFLICT');
  await assert.rejects(resolveAttribution(env,{...ref,title:'other'},before.record_revision,'separate'),e=>e.code==='LESSON_RECORD_CONFLICT');
  const current=await rawRecord(env,ref.id);assert.equal(current.homework,null);assert.equal(current.lesson_memo,'winner');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM lesson_record_archive').first()).n,0);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM lesson_record_guard').first()).n,0);
});
test('older raw writers increment revision and invalidate pending saves; schema initialization is additive',async t=>{
  const env=await setup(t,true);await ensureAttribution(env);await ensureAttribution(env);
  assert.equal((await rawRecord(env,ref.id)).record_title,null);
  await resolveAttribution(env,ref,0,'inherit');const row=await rawRecord(env,ref.id);
  const pending=await recordWriteStatements(env,ref,{homework:'stale'},row.record_revision);
  await env.DB.prepare('UPDATE curriculum_entries SET lesson_memo=? WHERE calendar_event_id=?').bind('external',ref.id).run();
  await assert.rejects(commitRecords(env,pending),e=>e.code==='LESSON_RECORD_CONFLICT');
  assert.equal((await rawRecord(env,ref.id)).lesson_memo,'external');
});

test('migration is identical to runtime and never backfills a legacy name',async t=>{
  const env=await setup(t,true);
  const {readFile}=await import('node:fs/promises');
  const {attributionSchema}=await import('../src/lesson-attribution.js');
  const sql=await readFile(new URL('../migrations/lesson-record-attribution.sql',import.meta.url),'utf8');
  const statements=sql.split('-- statement').slice(1).map(item=>item.trim().replace(/;$/,''));
  assert.deepEqual(statements,attributionSchema);
  await env.DB.batch(statements.map(item=>env.DB.prepare(item)));
  assert.equal((await rawRecord(env,ref.id)).record_title,null);
  assert.equal((await rawRecord(env,ref.id)).lesson_plan,'旧予定');
});

test('empty legacy placeholders stay usable without guessing attribution; completion alone remains meaningful and unverified',async t=>{
  const env=await setup(t);
  await env.DB.prepare("INSERT INTO curriculum_entries VALUES (?,0,NULL,'','  ',NULL,'old')").bind(ref.id).run();
  const empty=await rawRecord(env,ref.id);
  assert.equal(currentRecord(empty,ref).attribution_status,'new');
  assert.equal(empty.record_title,null);
  await save(env,ref,{lesson_plan:'explicitly new'},0);
  const saved=await rawRecord(env,ref.id);assert.equal(saved.record_title,ref.title);assert.equal(saved.lesson_plan,'explicitly new');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM lesson_record_archive').first()).n,0);
  const completedRef={...ref,id:'completion-only'};
  await env.DB.prepare('INSERT INTO curriculum_entries(calendar_event_id,completed)VALUES(?,1)').bind(completedRef.id).run();
  assert.equal(currentRecord(await rawRecord(env,completedRef.id),completedRef).attribution_status,'legacy_unverified');
});

test('an empty known identity can be rebound without blocking but its previous attribution is archived',async t=>{
  const env=await setup(t);await save(env,ref,{lesson_plan:''},0);
  const old=await rawRecord(env,ref.id);const changed={...ref,title:'other'};
  assert.equal(currentRecord(old,changed).attribution_status,'new');
  const {prepareRecordWrite,readCommittedRecord}=await import('../src/lesson-attribution.js');
  const prepared=await prepareRecordWrite(env,changed,{homework:'new work'},old.record_revision);
  await commitRecords(env,prepared.statements);
  assert.equal((await readCommittedRecord(env,changed,prepared)).homework,'new work');
  const archive=await env.DB.prepare('SELECT * FROM lesson_record_archive').first();assert.equal(archive.title,ref.title);assert.equal(archive.decision,'empty_rebind');
});
