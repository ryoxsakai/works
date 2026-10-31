import {guardStatements,commitRecords,prepareRecordWrite,readCommittedRecord,prepareAttributionResolution} from './lesson-attribution.js';
const fail=()=>Object.assign(new Error('転記履歴・記録版の照合が必要です。再送を停止しました'),{status:409,code:'CALENDAR_MIGRATION_JOURNAL_CONFLICT'});
export function calendarLessonJournal(env){
 if(env.CALENDAR_LESSON_MIGRATION_JOURNAL!=='true')throw Object.assign(new Error('転記は未有効です。バックアップ・共有確認・追加テーブルの準備が必要です'),{status:503,code:'CALENDAR_MIGRATION_NOT_ACTIVE'});
 const assertGeneration=(snapshot)=>{const id=crypto.randomUUID();return [env.DB.prepare(`INSERT INTO lesson_record_guard(id,ok) VALUES (?,
   CASE WHEN (SELECT COUNT(*) FROM lesson_record_archive WHERE event_id=?)=? THEN 1 ELSE 0 END)`).bind(id,snapshot.ref.id,snapshot.binding.generation),env.DB.prepare('DELETE FROM lesson_record_guard WHERE id=?').bind(id)];};
 return {
  async reserve(snapshot){
   const id=crypto.randomUUID();
   await commitRecords(env,[...guardStatements(env,snapshot.ref.id,snapshot.revision),...assertGeneration(snapshot),
    env.DB.prepare(`INSERT INTO calendar_lesson_migration(id,event_id,calendar_id,record_revision,record_generation,snapshot_json,status) VALUES(?,?,?,?,?,?,'reserved')`)
    .bind(id,snapshot.ref.id,snapshot.ref.calendar_id,snapshot.revision,snapshot.binding.generation,JSON.stringify(snapshot))]);
   return {id};
  },
  async read(id){const row=await env.DB.prepare('SELECT * FROM calendar_lesson_migration WHERE id=?').bind(id).first();if(!row)return null;return {id:row.id,status:row.status,...JSON.parse(row.snapshot_json)};},
  async finalizeRecord(id,proof,patch){
   const operation=await this.read(id);if(!operation||!['dispatching','unknown'].includes(operation.status)||proof.description!==operation.after_description||!proof.etag)throw fail();
   const prepared=operation.decision?await prepareAttributionResolution(env,operation.ref,operation.revision,operation.decision,id):await prepareRecordWrite(env,operation.ref,patch,operation.revision,{calendarOperationId:id});
   if(prepared.generation!==(operation.after_generation??operation.binding.generation))throw fail();
   const guardId=crypto.randomUUID();
   await commitRecords(env,[env.DB.prepare(`INSERT INTO lesson_record_guard(id,ok) VALUES (?,CASE WHEN (SELECT status FROM calendar_lesson_migration WHERE id=?)=? THEN 1 ELSE 0 END)`).bind(guardId,id,operation.status),...prepared.statements,
    env.DB.prepare(`UPDATE calendar_lesson_migration SET status='verified',verification_json=?,updated_at=datetime('now') WHERE id=?`).bind(JSON.stringify(proof),id),env.DB.prepare('DELETE FROM lesson_record_guard WHERE id=?').bind(guardId)]);
   return readCommittedRecord(env,operation.ref,prepared);
  },
  async mark(id,status,proof){
   const row=await env.DB.prepare('SELECT * FROM calendar_lesson_migration WHERE id=?').bind(id).first();if(!row)throw fail();
   const snapshot=JSON.parse(row.snapshot_json);
   const allowed={dispatching:['reserved'],unknown:['dispatching','unknown'],precondition_failed:['dispatching'],verified:['dispatching','unknown']}[status];
   if(!allowed?.includes(row.status))throw fail();
   if(status==='verified'&&(!proof?.etag||proof.description!==snapshot.after_description))throw fail();
   const guardId=crypto.randomUUID();
   const statements=[env.DB.prepare(`INSERT INTO lesson_record_guard(id,ok) VALUES (?,CASE WHEN (SELECT status FROM calendar_lesson_migration WHERE id=?)=? THEN 1 ELSE 0 END)`).bind(guardId,id,row.status)];
   if(status==='verified')statements.push(...guardStatements(env,snapshot.ref.id,snapshot.revision,id),...assertGeneration(snapshot));
   statements.push(env.DB.prepare(`UPDATE calendar_lesson_migration SET status=?,verification_json=?,updated_at=datetime('now') WHERE id=?`).bind(status,proof?JSON.stringify(proof):null,id),env.DB.prepare('DELETE FROM lesson_record_guard WHERE id=?').bind(guardId));
   await commitRecords(env,statements);
  },
 };
}
