import { attributedLessonRecord, lessonRecordHasContent, lessonTitleKey, lessonDate, LESSON_BASELINE_DATE } from '../../shared/lesson-attribution.js';
export { lessonTitleKey as titleKey } from '../../shared/lesson-attribution.js';
// The event ID identifies a slot, never a student. Unknown legacy ownership stays unknown.
const fields = ['lesson_plan', 'confirmation_test', 'homework', 'lesson_memo'];
const fail = (message, code = 'LESSON_ATTRIBUTION_REQUIRED') => Object.assign(new Error(message), {status:409, code});
export const attributionSchema = [
  `CREATE TABLE IF NOT EXISTS lesson_record_identity (
    event_id TEXT PRIMARY KEY, calendar_id TEXT, title TEXT, revision INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS lesson_record_archive (
    id TEXT PRIMARY KEY, event_id TEXT NOT NULL, calendar_id TEXT, title TEXT,
    decision TEXT NOT NULL, snapshot_json TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS lesson_record_guard (
    id TEXT PRIMARY KEY, ok INTEGER CHECK(ok = 1) NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS lesson_record_archive_event ON lesson_record_archive(event_id,created_at)`,
  `CREATE TABLE IF NOT EXISTS lesson_record_baseline (
    event_id TEXT PRIMARY KEY, calendar_id TEXT NOT NULL, title TEXT NOT NULL,
    event_start TEXT, event_etag TEXT, effective_date TEXT NOT NULL, observed_at TEXT DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS lesson_record_legacy_source (
    event_id TEXT PRIMARY KEY, snapshot_json TEXT NOT NULL, captured_at TEXT DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS lesson_record_hold (
    event_id TEXT PRIMARY KEY, calendar_id TEXT NOT NULL, reason TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')), resolved_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS lesson_record_policy (
    id INTEGER PRIMARY KEY CHECK(id=1), effective_date TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
    required_hold_count INTEGER NOT NULL DEFAULT 1 CHECK(required_hold_count>=1))`,
  ...['INSERT','UPDATE','DELETE'].map(operation => `CREATE TRIGGER IF NOT EXISTS lesson_record_revision_${operation.toLowerCase()}
    AFTER ${operation} ON curriculum_entries BEGIN
    INSERT INTO lesson_record_identity(event_id, revision) VALUES (${operation === 'DELETE' ? 'OLD' : 'NEW'}.calendar_event_id, 1)
    ON CONFLICT(event_id) DO UPDATE SET revision = revision + 1; END`),
];
const schemaReady = new WeakMap();
export async function ensureAttribution(env) {
  if (!schemaReady.has(env.DB)) {
    schemaReady.set(env.DB, env.DB.batch(attributionSchema.map(sql => env.DB.prepare(sql)))
      .catch(error => { schemaReady.delete(env.DB); throw error; }));
  }
  return schemaReady.get(env.DB);
}
const recordColumns = `key.event_id AS calendar_event_id,e.completed,e.lesson_plan,e.confirmation_test,e.homework,e.lesson_memo,e.updated_at,
  CASE WHEN e.calendar_event_id IS NULL THEN 0 ELSE 1 END AS record_exists,
  i.calendar_id AS record_calendar_id,i.title AS record_title,COALESCE(i.revision,0) AS record_revision,
  (SELECT COUNT(*) FROM lesson_record_archive WHERE event_id=key.event_id) AS record_generation,
  b.calendar_id AS record_observed_calendar_id,b.title AS record_observed_title,b.observed_at AS record_observed_at,
  CASE WHEN h.event_id IS NOT NULL AND h.resolved_at IS NULL THEN 1 ELSE 0 END AS record_hold_active,
  CASE WHEN source.event_id IS NOT NULL THEN 1 ELSE 0 END AS record_source_exists,
  COALESCE(p.effective_date,'${LESSON_BASELINE_DATE}') AS record_effective_date,
  CASE WHEN p.enabled=1 AND (SELECT COUNT(*) FROM lesson_record_hold)>=p.required_hold_count THEN 1 ELSE 0 END AS record_policy_enabled`;
const recordJoins = `LEFT JOIN curriculum_entries e ON e.calendar_event_id=key.event_id
  LEFT JOIN lesson_record_identity i ON i.event_id=key.event_id
  LEFT JOIN lesson_record_baseline b ON b.event_id=key.event_id
  LEFT JOIN lesson_record_hold h ON h.event_id=key.event_id
  LEFT JOIN lesson_record_legacy_source source ON source.event_id=key.event_id
  LEFT JOIN lesson_record_policy p ON p.id=1`;
export async function rawRecord(env,eventId) {
  await ensureAttribution(env);
  return env.DB.prepare(`SELECT ${recordColumns} FROM (SELECT ? AS event_id) key ${recordJoins}`).bind(eventId).first();
}
export const currentRecord = attributedLessonRecord;
export function requireCurrent(row, ref) {
  const current = currentRecord(row, ref);
  if (!['new','confirmed','legacy_unverified','legacy_historical'].includes(current.attribution_status)) throw fail('予定名と授業記録の対応を授業記録画面で確認してください');
  return current;
}
export async function allRecords(env) {
  await ensureAttribution(env);
  const {results}=await env.DB.prepare(`SELECT ${recordColumns} FROM (
    SELECT calendar_event_id AS event_id FROM curriculum_entries UNION SELECT event_id FROM lesson_record_identity UNION SELECT event_id FROM lesson_record_hold
  ) key ${recordJoins}`).all();
  return results;
}
// Call only with an authoritative, selected, collision-checked Calendar event.
export async function observeRecord(env,ref,{attempts=2}={}) {
  for(let attempt=0;attempt<attempts;attempt++) {
    const row=await rawRecord(env,ref.id);
    if(!row.record_policy_enabled || row.record_hold_active || row.record_title!=null || row.record_observed_title!=null
      || !row.record_exists || !lessonRecordHasContent(row) || !lessonDate(ref) || lessonDate(ref)<row.record_effective_date) return row;
    try {
      await commitRecords(env,[...guardStatements(env,ref.id,row.record_revision),
        env.DB.prepare('INSERT OR IGNORE INTO lesson_record_legacy_source(event_id,snapshot_json)VALUES(?,?)').bind(ref.id,JSON.stringify(row)),
        env.DB.prepare(`INSERT INTO lesson_record_baseline(event_id,calendar_id,title,event_start,event_etag,effective_date)
          VALUES(?,?,?,?,?,?)`).bind(ref.id,ref.calendar_id,ref.title,ref.start || null,ref.etag || null,row.record_effective_date),
        env.DB.prepare(`INSERT INTO lesson_record_identity(event_id,revision)VALUES(?,1)
          ON CONFLICT(event_id) DO UPDATE SET revision=revision+1`).bind(ref.id),
      ]);
      return rawRecord(env,ref.id);
    } catch(error) { if(error.code!=='LESSON_RECORD_CONFLICT' || attempt===attempts-1) throw error; }
  }
}
export function guardStatements(env, eventId, revision, calendarOperationId = '') {
  if (!Number.isSafeInteger(revision) || revision < 0) throw fail('再読み込みしてから保存してください','LESSON_RECORD_CONFLICT');
  const id=crypto.randomUUID();
  // Disabled until the additive journal has been backed up and provisioned.
  // Once enabled, all existing guarded writes/attribution changes honor a pending
  // Calendar dispatch. A timeout never silently releases this cross-store lock.
  const calendarGuard=env.CALENDAR_LESSON_MIGRATION_JOURNAL==='true'
    ? ` AND NOT EXISTS(SELECT 1 FROM calendar_lesson_migration WHERE event_id=? AND id<>? AND status IN ('reserved','dispatching','unknown'))` : '';
  const args=[id,eventId,revision,...(calendarGuard?[eventId,calendarOperationId]:[])];
  return [env.DB.prepare(`INSERT INTO lesson_record_guard(id,ok) VALUES (?,
    CASE WHEN COALESCE((SELECT revision FROM lesson_record_identity WHERE event_id = ?),0) = ?${calendarGuard} THEN 1 ELSE 0 END)`)
    .bind(...args), env.DB.prepare('DELETE FROM lesson_record_guard WHERE id = ?').bind(id)];
}
export async function prepareRecordWrite(env, ref, patch, expectedRevision) {
  const row = await rawRecord(env,ref.id);
  requireCurrent(row,ref);
  if (expectedRevision !== undefined && expectedRevision !== row.record_revision) throw fail('別の画面で記録が変更されました。入力を残して再読み込みしてください','LESSON_RECORD_CONFLICT');
  const after={...row,...patch};
  const legacy = lessonRecordHasContent(row) && row.record_title == null;
  if (legacy && currentRecord(row,ref).attribution_status==='legacy_unverified' && row.record_observed_title==null) {
    throw fail('比較用の予定名を観測してから保存してください。初期設定と開始日を確認してください','LESSON_BASELINE_REQUIRED');
  }
  const source = legacy && !row.record_source_exists ? [env.DB.prepare('INSERT OR IGNORE INTO lesson_record_legacy_source(event_id,snapshot_json)VALUES(?,?)').bind(ref.id,JSON.stringify(row))] : [];
  const emptyRebind = !lessonRecordHasContent(row) && row.record_title != null
    && (row.record_calendar_id !== ref.calendar_id || lessonTitleKey(row.record_title) !== lessonTitleKey(ref.title));
  const archive = emptyRebind ? [env.DB.prepare(`INSERT INTO lesson_record_archive(id,event_id,calendar_id,title,decision,snapshot_json) VALUES (?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(),ref.id,row.record_calendar_id,row.record_title,'empty_rebind',JSON.stringify(row))] : [];
  return {record_calendar_id:legacy?row.record_calendar_id:ref.calendar_id,record_title:legacy?null:ref.title,revision:row.record_revision+1,generation:row.record_generation+(emptyRebind?1:0),statements:[
    ...guardStatements(env,ref.id,row.record_revision), ...archive, ...source,
    env.DB.prepare(`INSERT INTO lesson_record_identity(event_id,calendar_id,title,revision) VALUES (?,?,?,0)
      ON CONFLICT(event_id) DO UPDATE SET calendar_id=excluded.calendar_id,title=excluded.title`)
      .bind(ref.id,legacy?row.record_calendar_id:ref.calendar_id,legacy?null:ref.title),
    env.DB.prepare(`INSERT INTO curriculum_entries(calendar_event_id,completed,lesson_plan,confirmation_test,homework,lesson_memo,updated_at)
      VALUES (?,?,?,?,?,?,datetime('now')) ON CONFLICT(calendar_event_id) DO UPDATE SET completed=excluded.completed,
      lesson_plan=excluded.lesson_plan,confirmation_test=excluded.confirmation_test,homework=excluded.homework,
      lesson_memo=excluded.lesson_memo,updated_at=excluded.updated_at`)
      .bind(ref.id,after.completed?1:0,...fields.map(field=>after[field]||null))]};
}
export async function recordWriteStatements(...args) {
  return (await prepareRecordWrite(...args)).statements;
}
// Read responses must belong to the transaction just committed, even across same-title replacements.
export async function readCommittedRecord(env, ref, expected) {
  const row = await rawRecord(env,ref.id);
  if (row.record_revision !== expected.revision || row.record_generation !== expected.generation) {
    throw Object.assign(fail('保存は完了しましたが、その後に記録が変更されました。入力を残して停止しました。履歴と現在の記録を再確認してください','LESSON_RECORD_CHANGED_AFTER_SAVE'),{committed:true});
  }
  return currentRecord(row,ref);
}
export async function commitRecords(env, statements) {
  try { return await env.DB.batch(statements); }
  catch(error) {
    if (/CHECK constraint failed/.test(error.message)) throw fail('別の画面で記録が変更されました。入力を残して再読み込みしてください','LESSON_RECORD_CONFLICT');
    throw error;
  }
}
export async function resolveAttribution(env, ref, revision, decision) {
  if (!['inherit','separate'].includes(decision)) throw Object.assign(new Error('確認方法を選択してください'),{status:400});
  const row=await rawRecord(env,ref.id);
  if (!row.record_exists && !row.record_hold_active) throw fail('確認対象の旧記録がありません');
  if (row.record_revision !== revision) throw fail('記録が変更されました。再読み込みしてください','LESSON_RECORD_CONFLICT');
  const statements=[...guardStatements(env,ref.id,revision),
    env.DB.prepare(`INSERT INTO lesson_record_archive(id,event_id,calendar_id,title,decision,snapshot_json) VALUES (?,?,?,?,?,?)`)
      .bind(crypto.randomUUID(),ref.id,row.record_calendar_id,row.record_title,decision,JSON.stringify(row))];
  if(decision==='separate') statements.push(env.DB.prepare(`UPDATE curriculum_entries SET completed=0,
    lesson_plan=NULL,confirmation_test=NULL,homework=NULL,lesson_memo=NULL,updated_at=datetime('now') WHERE calendar_event_id=?`).bind(ref.id));
  statements.push(env.DB.prepare(`INSERT INTO lesson_record_identity(event_id,calendar_id,title,revision) VALUES (?,?,?,1)
    ON CONFLICT(event_id) DO UPDATE SET calendar_id=excluded.calendar_id,title=excluded.title,revision=revision+1`)
    .bind(ref.id,ref.calendar_id,ref.title));
  statements.push(env.DB.prepare("UPDATE lesson_record_hold SET resolved_at=datetime('now') WHERE event_id=? AND resolved_at IS NULL").bind(ref.id));
  await commitRecords(env,statements);
  return readCommittedRecord(env,ref,{revision:revision+(decision==='separate' && row.record_exists?2:1),generation:row.record_generation+1});
}
