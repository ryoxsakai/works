import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {ensureAttribution,rawRecord,observeRecord,currentRecord,prepareRecordWrite,commitRecords,readCommittedRecord,resolveAttribution} from '../src/lesson-attribution.js';
import {activationSql} from '../scripts/prepare-lesson-attribution-config.mjs';
const target={id:'instance-today',calendar_id:'class-a',title:'Synthetic Student',start:'2026-10-27T03:50:00Z',etag:'original'};
async function setup(t){
 const mf=new Miniflare({modules:true,script:"export default {fetch(){return new Response('ok')}}",compatibilityDate:'2026-08-01',d1Databases:{DB:'baseline'}});
 t.after(()=>mf.dispose());const env={DB:await mf.getD1Database('DB')};
 await env.DB.prepare('CREATE TABLE curriculum_entries(calendar_event_id TEXT PRIMARY KEY,completed INTEGER DEFAULT 0,lesson_plan TEXT,confirmation_test TEXT,homework TEXT,lesson_memo TEXT,updated_at TEXT)').run();
 await env.DB.prepare("INSERT INTO curriculum_entries VALUES (?,1,'original plan','original test','original homework','original memo','legacy time')").bind(target.id).run();
 await ensureAttribution(env);
 const sql=activationSql({effective_date:'2026-10-27',holds:[{event_id:'known-changed-instance',calendar_id:'class-a',reason:'known_title_change'}]});
 await env.DB.batch(sql.split('\n').filter(line=>line.trim()&&!line.startsWith('--')).map(line=>env.DB.prepare(line)));
 return env;
}
test('baseline observes a title without assigning ownership or changing any legacy fields',async t=>{
 const env=await setup(t);const before=await env.DB.prepare('SELECT * FROM curriculum_entries').first();
 const row=await observeRecord(env,target);const current=currentRecord(row,target);
 assert.equal(current.attribution_status,'legacy_unverified');assert.match(current.attribution_notice,/所属未確認/);
 assert.equal(current.lesson_plan,'original plan');assert.equal(current.completed,1);assert.equal(row.record_title,null);
 assert.equal(row.record_observed_title,target.title);assert.ok(row.record_observed_at);assert.equal(row.record_revision,1);
 assert.deepEqual(await env.DB.prepare('SELECT * FROM curriculum_entries').first(),before);
 const source=await env.DB.prepare('SELECT * FROM lesson_record_legacy_source').first();assert.equal(JSON.parse(source.snapshot_json).lesson_plan,'original plan');assert.equal(JSON.parse(source.snapshot_json).record_title,null);
 assert.equal((await observeRecord(env,target)).record_revision,1);
 // Editing one field must not confirm all inherited fields, and must retain the immutable source.
 const prepared=await prepareRecordWrite(env,target,{homework:'edited homework'},row.record_revision);await commitRecords(env,prepared.statements);
 const edited=await readCommittedRecord(env,target,prepared);assert.equal(edited.attribution_status,'legacy_unverified');assert.equal(edited.record_title,null);
 assert.equal((await env.DB.prepare('SELECT snapshot_json FROM lesson_record_legacy_source').first()).snapshot_json,source.snapshot_json);
});
test('effective date uses JST midnight; earlier history remains available without a baseline',async t=>{
 const env=await setup(t);
 const historical={...target,start:'2026-10-26T14:59:59Z'};
 const old=await observeRecord(env,historical);assert.equal(old.record_observed_title,null);
 assert.equal(currentRecord(old,historical).attribution_status,'legacy_historical');assert.equal(currentRecord(old,historical).lesson_plan,'original plan');
 const today={...target,start:'2026-10-26T15:00:00Z'};
 const observed=await observeRecord(env,today);assert.equal(observed.record_observed_title,target.title);
 assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM lesson_record_baseline').first()).n,1);
});
test('future meaningful changes block content; cosmetic/time moves retain comparison; separate/inherit preserve source',async t=>{
 const env=await setup(t);const observed=await observeRecord(env,target);
 assert.equal(currentRecord(observed,{...target,title:'  Synthetic　Student ',start:'2026-11-01T00:00:00Z'}).lesson_plan,'original plan');
 const changed={...target,title:'Different Synthetic Student'};
 assert.equal(currentRecord(observed,changed).attribution_status,'title_changed');assert.equal(currentRecord(observed,changed).lesson_plan,null);
 await assert.rejects(prepareRecordWrite(env,changed,{lesson_plan:'must not write'},observed.record_revision),e=>e.code==='LESSON_ATTRIBUTION_REQUIRED');
 const separated=await resolveAttribution(env,changed,observed.record_revision,'separate');assert.equal(separated.lesson_plan,null);assert.equal(separated.record_title,changed.title);
 const archive=await env.DB.prepare('SELECT * FROM lesson_record_archive').first();assert.equal(JSON.parse(archive.snapshot_json).lesson_plan,'original plan');assert.equal(archive.title,null);
 assert.equal((await env.DB.prepare('SELECT snapshot_json FROM lesson_record_legacy_source').first()).snapshot_json.includes('original plan'),true);
});
test('known already-renamed instances are excluded before any observation; resolving preserves unknown original attribution',async t=>{
 const env=await setup(t);const held={...target,id:'known-changed-instance'};
 await env.DB.prepare("INSERT INTO curriculum_entries(calendar_event_id,lesson_plan)VALUES(?,'old other content')").bind(held.id).run();
 const row=await observeRecord(env,held);assert.equal(row.record_observed_title,null);
 assert.equal(currentRecord(row,held).attribution_status,'known_change');assert.equal(currentRecord(row,held).lesson_plan,null);
 const resolved=await resolveAttribution(env,held,row.record_revision,'separate');assert.equal(resolved.record_title,held.title);assert.equal(resolved.record_hold_active,0);
 const archived=await env.DB.prepare('SELECT * FROM lesson_record_archive WHERE event_id=?').bind(held.id).first();assert.equal(archived.title,null);assert.equal(JSON.parse(archived.snapshot_json).lesson_plan,'old other content');
 // Resolving a hold must not disable observations for other lessons.
 assert.equal((await observeRecord(env,target)).record_observed_title,target.title);
});
test('empty records are not baselined or archived as inherited work; missing deployment holds cannot enable observations',async t=>{
 const env=await setup(t);
 await env.DB.prepare('UPDATE curriculum_entries SET completed=0,lesson_plan=NULL,confirmation_test=NULL,homework=NULL,lesson_memo=NULL').run();
 assert.equal(currentRecord(await observeRecord(env,target),target).attribution_status,'new');
 assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM lesson_record_baseline').first()).n,0);
 await env.DB.prepare("UPDATE curriculum_entries SET lesson_plan='source'").run();
 await env.DB.prepare('UPDATE lesson_record_policy SET required_hold_count=2').run();
 const row=await observeRecord(env,target);assert.equal(row.record_policy_enabled,0);assert.equal(row.record_observed_title,null);assert.equal(currentRecord(row,target).lesson_plan,'source');
});
test('private config is repeatable, does not reset user resolutions, and refuses an empty known-change list',async t=>{
 const env=await setup(t);assert.throws(()=>activationSql({effective_date:'2026-10-27',holds:[]}));
 await env.DB.prepare("UPDATE lesson_record_hold SET resolved_at='resolved'").run();
 const sql=activationSql({effective_date:'2026-10-27',holds:[{event_id:'known-changed-instance',calendar_id:'class-a',reason:'known_title_change'}]});
 await env.DB.batch(sql.split('\n').filter(line=>line.trim()&&!line.startsWith('--')).map(line=>env.DB.prepare(line)));
 assert.equal((await env.DB.prepare('SELECT resolved_at FROM lesson_record_hold').first()).resolved_at,'resolved');
 assert.equal((await rawRecord(env,target.id)).record_title,null);
});

test('held empty instances require an explicit choice; ordinary empty instances remain usable',async t=>{
 const env=await setup(t);const held={...target,id:'known-changed-instance'};
 const row=await rawRecord(env,held.id);assert.equal(row.record_exists,0);assert.equal(currentRecord(row,held).attribution_status,'known_change');
 await assert.rejects(prepareRecordWrite(env,held,{lesson_plan:'cannot bypass hold'},row.record_revision),e=>e.code==='LESSON_ATTRIBUTION_REQUIRED');
 const resolved=await resolveAttribution(env,held,row.record_revision,'separate');assert.equal(resolved.record_hold_active,0);
 const next=await prepareRecordWrite(env,held,{lesson_plan:'explicit new plan'},resolved.record_revision);await commitRecords(env,next.statements);
 assert.equal((await readCommittedRecord(env,held,next)).lesson_plan,'explicit new plan');
});
test('incompatible activation fails closed without changing existing baseline policy or resolved holds',async t=>{
 const env=await setup(t);const sql=activationSql({effective_date:'2026-10-28',holds:[{event_id:'known-changed-instance',calendar_id:'class-a',reason:'known_title_change'}]});
 await env.DB.batch(sql.split('\n').filter(line=>line&&!line.startsWith('--')).map(line=>env.DB.prepare(line)));
 const policy=await env.DB.prepare('SELECT * FROM lesson_record_policy').first();assert.equal(policy.enabled,0);assert.equal(policy.effective_date,'2026-10-27');
 assert.equal((await observeRecord(env,target)).record_observed_title,null);
});
test('a historical edit preserves its original source and stays unverified without creating a future baseline',async t=>{
 const env=await setup(t);const historical={...target,start:'2026-10-26T12:00:00+09:00'};
 const before=await rawRecord(env,target.id);const write=await prepareRecordWrite(env,historical,{homework:'historical correction'},before.record_revision);
 await commitRecords(env,write.statements);const saved=await readCommittedRecord(env,historical,write);
 assert.equal(saved.attribution_status,'legacy_historical');assert.equal(saved.record_title,null);assert.equal(saved.record_observed_title,null);
 const source=await env.DB.prepare('SELECT snapshot_json FROM lesson_record_legacy_source').first();assert.equal(JSON.parse(source.snapshot_json).homework,'original homework');
});
