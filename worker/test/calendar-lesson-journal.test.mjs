import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {ensureAttribution,rawRecord,prepareRecordWrite,commitRecords,resolveAttribution} from '../src/lesson-attribution.js';
import {calendarLessonJournal} from '../src/calendar-lesson-journal.js';
async function setup(t){
 const mf=new Miniflare({modules:true,script:"export default {fetch(){return new Response('ok')}}",compatibilityDate:'2026-08-01',d1Databases:{DB:'calendar-journal'}});t.after(()=>mf.dispose());
 const DB=await mf.getD1Database('DB'),env={DB,CALENDAR_LESSON_MIGRATION_JOURNAL:'true'};
 await DB.prepare('CREATE TABLE curriculum_entries(calendar_event_id TEXT PRIMARY KEY,completed INTEGER,lesson_plan TEXT,confirmation_test TEXT,homework TEXT,lesson_memo TEXT,updated_at TEXT)').run();
 await ensureAttribution(env);const sql=await readFile(new URL('../calendar-lesson-migration.sql',import.meta.url),'utf8');await DB.batch(sql.replace(/^--.*$/gm,'').split(';').filter(s=>s.trim()).map(s=>DB.prepare(s)));
 await DB.prepare("INSERT INTO curriculum_entries VALUES ('instance',0,'保持する原記録',NULL,NULL,NULL,'old')").run();
 await DB.prepare("UPDATE lesson_record_identity SET calendar_id='calendar',title='合成名' WHERE event_id='instance'").run();
 const row=await rawRecord(env,'instance'),ref={id:'instance',calendar_id:'calendar',title:'合成名',etag:'"one"'},snapshot={ref,revision:row.record_revision,binding:{calendar_id:'calendar',event_id:'instance',title:'合成名',generation:row.record_generation},before:{description:'元の説明'},after_description:'転記後'};
 return {env,DB,row,ref,snapshot,journal:calendarLessonJournal(env)};
}
test('disabled feature does not touch a missing journal table',()=>assert.throws(()=>calendarLessonJournal({DB:{prepare(){throw Error('must not touch')}}}),e=>e.status===503));
test('durable reservation is exclusive; pending dispatch blocks ordinary writes and attribution decisions',async t=>{
 const {env,DB,ref,snapshot,journal}=await setup(t),op=await journal.reserve(snapshot);
 assert.equal((await journal.read(op.id)).status,'reserved');
 await assert.rejects(journal.reserve(snapshot));
 await assert.rejects(commitRecords(env,(await prepareRecordWrite(env,ref,{lesson_plan:'race'},snapshot.revision)).statements));
 await assert.rejects(resolveAttribution(env,ref,snapshot.revision,'separate'));
 await journal.mark(op.id,'dispatching');await journal.mark(op.id,'unknown');
 assert.equal((await journal.read(op.id)).status,'unknown');
 await assert.rejects(journal.mark(op.id,'verified',{etag:'"two"',description:'wrong'}));
 assert.equal((await DB.prepare("SELECT lesson_plan FROM curriculum_entries WHERE calendar_event_id='instance'").first()).lesson_plan,'保持する原記録');
 await journal.mark(op.id,'verified',{etag:'"two"',description:'転記後'});
 assert.equal((await journal.read(op.id)).status,'verified');
 await commitRecords(env,(await prepareRecordWrite(env,ref,{lesson_plan:'通常編集'},snapshot.revision)).statements);
 assert.equal((await rawRecord(env,'instance')).lesson_plan,'通常編集');
 const persisted=await DB.prepare('SELECT snapshot_json FROM calendar_lesson_migration WHERE id=?').bind(op.id).first();assert.equal(JSON.parse(persisted.snapshot_json).before.description,'元の説明');
});
test('412 releases a definitively unapplied reservation but unknown never auto unlocks',async t=>{
 const {env,ref,snapshot,journal}=await setup(t),op=await journal.reserve(snapshot);await journal.mark(op.id,'dispatching');await journal.mark(op.id,'precondition_failed');
 await commitRecords(env,(await prepareRecordWrite(env,ref,{homework:'変更'},snapshot.revision)).statements);
 assert.equal((await journal.read(op.id)).status,'precondition_failed');
 await assert.rejects(journal.mark(op.id,'verified',{etag:'"two"',description:'転記後'}));
});
test('stale record revision or generation cannot reserve or finalize a Calendar snapshot',async t=>{
 const {env,DB,ref,snapshot,journal}=await setup(t);
 await assert.rejects(journal.reserve({...snapshot,revision:snapshot.revision+1}));
 await assert.rejects(journal.reserve({...snapshot,binding:{...snapshot.binding,generation:1}}));
 const op=await journal.reserve(snapshot);await journal.mark(op.id,'dispatching');
 // A legacy direct SQL writer is detectable even if it cannot honor the lock.
 await DB.prepare("UPDATE curriculum_entries SET lesson_plan='old client' WHERE calendar_event_id='instance'").run();
 await assert.rejects(journal.mark(op.id,'verified',{etag:'"two"',description:'転記後'}));
 assert.equal((await journal.read(op.id)).status,'dispatching');
 assert.equal((await rawRecord(env,ref.id)).lesson_plan,'old client');
});
