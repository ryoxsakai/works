import {lessonEventRef,sameLessonEvent,isScheduledLesson} from '../../shared/lesson-plan.js';
import {calendarRecordValues,parseCalendarRecord,parsePlainCalendarRecord} from '../../shared/calendar-lesson-record.mjs';
import {lessonTitleKey} from '../../shared/lesson-attribution.js';

export const ownerHistoryActive=env=>env.LESSON_HISTORY_MODE==='active';
export const ownerHistoryFrozen=env=>['reconcile','active'].includes(env.LESSON_HISTORY_MODE);
export const ownerHistoryAvailable=env=>['prepare','reconcile','active'].includes(env.LESSON_HISTORY_MODE);
const fields=['lesson_plan','confirmation_test','homework','lesson_memo'];
const fail=(message,status=409,code='LESSON_HISTORY_CONFLICT')=>Object.assign(new Error(message),{status,code});
const encode=value=>JSON.stringify(value);
const eventIdentity=event=>({created:event?.created||null,iCalUID:event?.iCalUID||null,recurringEventId:event?.recurringEventId||null,originalStartTime:event?.originalStartTime?.dateTime||event?.originalStartTime?.date||null});
export async function historyDigest(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(encode(value))))].map(n=>n.toString(16).padStart(2,'0')).join('');}
function text(value,label,max=200){if(typeof value!=='string'||!value.trim()||value.length>max)throw fail(label+'が不正です',400);return value.trim();}
function patchValues(body){
 const patch={};for(const key of fields)if(body[key]!==undefined){if(typeof body[key]!=='string'||body[key].length>20000)throw fail('授業内容が不正です',400);patch[key]=body[key];}
 if(body.completed!==undefined){if(![true,false,0,1].includes(body.completed))throw fail('完了状態が不正です',400);patch.completed=body.completed?1:0;}
 return patch;
}
const first=(env,sql,...args)=>env.DB.prepare(sql).bind(...args).first();
const rows=async(env,sql,...args)=>(await env.DB.prepare(sql).bind(...args).all()).results;
const statement=(env,sql,...args)=>env.DB.prepare(sql).bind(...args);
async function readHistoryInput(request){
 const reader=request.body?.getReader();if(!reader)throw fail('JSON入力が必要です',400);const chunks=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1024*1024){await reader.cancel();throw fail('入力が大きすぎます',413);}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 let value;try{value=JSON.parse(new TextDecoder().decode(bytes));}catch{throw fail('JSON入力が不正です',400);}if(!value||typeof value!=='object'||Array.isArray(value))throw fail('JSONオブジェクトが必要です',400);return value;
}
function guard(env,sql,args=[]){return statement(env,`INSERT INTO lesson_history_guard(id,ok) VALUES (?,CASE WHEN (${sql}) THEN 1 ELSE 0 END)`,crypto.randomUUID(),...args);}
async function policy(env,active=false){
 if(!ownerHistoryAvailable(env))throw fail('新しい授業履歴はまだ準備されていません',503);
 const p=await first(env,'SELECT * FROM lesson_history_policy WHERE id=1');
 if(!p?.exclusions_reviewed||active&&!p.cutover_ready)throw fail('除外予定と移行検証の確認が必要です',503);
}
async function notExcluded(env,target){if(await first(env,'SELECT reason FROM lesson_history_exclusions WHERE calendar_id=? AND event_id=?',target.calendar_id,target.id))throw fail('この予定は移行・編集の対象外です');}
export async function liveHistoryTarget(env,target,deps){
 if(!target?.calendar_id||!target?.id)throw fail('予定を指定してください',400);
 const settings=await deps.settings();if(!settings.selected_calendars?.includes(target.calendar_id))throw fail('選択されていないカレンダーです',403);
 const token=(await deps.token()).access_token,event=await deps.event(token,target.calendar_id,target.id);
 if(!event||!isScheduledLesson(lessonEventRef(event,target.calendar_id),settings.excluded_titles||[])||event.recurrence)throw fail('個別の授業予定を指定してください');
 const ref=lessonEventRef(event,target.calendar_id);if(target.etag&&!sameLessonEvent(ref,target))throw fail('予定名・日時・説明が変更されました。再取得してください');
 await notExcluded(env,ref);return {event,ref};
}
async function transaction(env,body,action,build){
 text(body.request_id,'操作ID',100);const digest=await historyDigest({action,body});
 const existing=await first(env,'SELECT * FROM lesson_history_requests WHERE id=?',body.request_id);
 if(existing){if(existing.digest!==digest)throw fail('操作IDが別の内容で使われています');return JSON.parse(existing.response_json);}
 const {before,after,statements}=await build();
 const response={...after,operation_id:body.request_id};
 try{await env.DB.batch([...statements,
  statement(env,'INSERT INTO lesson_history_audit VALUES (?,?,?,?,?)',body.request_id,action,encode(before),encode(after),new Date().toISOString()),
  statement(env,'INSERT INTO lesson_history_requests VALUES (?,?,?)',body.request_id,digest,encode(response)),
  env.DB.prepare('DELETE FROM lesson_history_guard')]);
 }catch(error){
  const committed=await first(env,'SELECT * FROM lesson_history_requests WHERE id=?',body.request_id);
  if(committed?.digest===digest)return JSON.parse(committed.response_json);
  throw fail('同時更新または保存結果の再確認が必要です。操作IDを保持して読み直してください',409,'LESSON_HISTORY_RELOAD');
 }
 return response;
}
export async function listLessonOwners(env){await policy(env);return (await rows(env,`SELECT o.*,COUNT(r.id) AS record_count FROM lesson_owners o LEFT JOIN lesson_history_records r ON r.owner_id=o.id GROUP BY o.id`)).sort((a,b)=>a.name.localeCompare(b.name,'ja',{numeric:true})||a.id.localeCompare(b.id));}
export async function listOwnerRecords(env,ownerId){
 await policy(env);if(!await first(env,'SELECT id FROM lesson_owners WHERE id=?',ownerId))throw fail('生徒・クラスがありません',404);
 return rows(env,`SELECT r.*,l.calendar_id,l.event_id,l.target_json,l.revision AS link_revision FROM lesson_history_records r LEFT JOIN lesson_event_links l ON l.record_id=r.id WHERE r.owner_id=? ORDER BY r.lesson_date,r.id`,ownerId);
}
export async function createLessonOwner(env,body){await policy(env);const name=text(body.name,'名前');if(!['student','class'].includes(body.kind))throw fail('生徒またはクラスを指定してください',400);
 return transaction(env,body,'create_owner',async()=>{const owner={id:crypto.randomUUID(),kind:body.kind,name,revision:1,created_at:new Date().toISOString()};return {before:null,after:{owner},statements:[statement(env,'INSERT INTO lesson_owners VALUES (?,?,?,?,?)',owner.id,owner.kind,name,1,owner.created_at),statement(env,'INSERT INTO lesson_owner_aliases VALUES (?,?)',owner.id,name)]};});
}
export async function renameLessonOwner(env,ownerId,body){await policy(env);const name=text(body.name,'名前');return transaction(env,body,'rename_owner',async()=>{
 const owner=await first(env,'SELECT * FROM lesson_owners WHERE id=?',ownerId);if(!owner||owner.revision!==body.revision)throw fail('名前が変更されています');
 const after={...owner,name,revision:owner.revision+1};return {before:{owner},after:{owner:after},statements:[guard(env,'EXISTS(SELECT 1 FROM lesson_owners WHERE id=? AND revision=?)',[ownerId,body.revision]),statement(env,'UPDATE lesson_owners SET name=?,revision=revision+1 WHERE id=?',name,ownerId),statement(env,'INSERT OR IGNORE INTO lesson_owner_aliases VALUES (?,?)',ownerId,name)]};});}
function newRecord(ownerId,body,source={}){
 const date=text(body.lesson_date,'授業日時',80);if(!Number.isFinite(Date.parse(date)))throw fail('授業日時が不正です',400);
 const now=new Date().toISOString();return {id:crypto.randomUUID(),owner_id:ownerId,lesson_date:new Date(date).toISOString(),title_snapshot:String(body.title_snapshot||''),...calendarRecordValues({}),completed:0,...patchValues(body),revision:1,source_json:encode(source),created_at:now,updated_at:now};
}
// Explicit columns keep schema evolution and insertion order independent.
function recordInsert(env,r){return statement(env,`INSERT INTO lesson_history_records(id,owner_id,lesson_date,title_snapshot,lesson_plan,confirmation_test,homework,lesson_memo,completed,revision,source_json,created_at,updated_at) VALUES (${Array(13).fill('?').join(',')})`,r.id,r.owner_id,r.lesson_date,r.title_snapshot,...fields.map(k=>r[k]),r.completed,r.revision,r.source_json,r.created_at,r.updated_at);}
async function ownerGuard(env,body){const owner=await first(env,'SELECT * FROM lesson_owners WHERE id=?',body.owner_id);if(!owner||owner.revision!==body.owner_revision)throw fail('選択した生徒・クラスを再確認してください');return owner;}
export async function createOwnerRecord(env,body){await policy(env);return transaction(env,body,'create_record',async()=>{
 const owner=await ownerGuard(env,body),record=newRecord(owner.id,body,{manual:true});return {before:null,after:{record},statements:[guard(env,'EXISTS(SELECT 1 FROM lesson_owners WHERE id=? AND revision=?)',[owner.id,owner.revision]),recordInsert(env,record)]};});}
export async function editOwnerRecord(env,recordId,body){await policy(env,ownerHistoryActive(env));return transaction(env,body,'edit_record',async()=>{
 const record=await first(env,'SELECT * FROM lesson_history_records WHERE id=?',recordId);if(!record||record.revision!==body.revision)throw fail('授業記録が更新されています');
 const patch=patchValues(body);if(!Object.keys(patch).length)throw fail('変更内容がありません',400);
 const after={...record,...patch,revision:record.revision+1,updated_at:new Date().toISOString()};
 const guards=[guard(env,'EXISTS(SELECT 1 FROM lesson_history_records WHERE id=? AND revision=?)',[recordId,body.revision])];
 if(body.expected_link)guards.push(guard(env,'EXISTS(SELECT 1 FROM lesson_event_links WHERE calendar_id=? AND event_id=? AND record_id=? AND revision=?)',[body.expected_link.calendar_id,body.expected_link.event_id,recordId,body.expected_link.revision]));
 return {before:{record},after:{record:after},statements:[...guards,statement(env,`UPDATE lesson_history_records SET ${Object.keys(patch).map(k=>k+'=?').join(',')},revision=revision+1,updated_at=? WHERE id=?`,...Object.values(patch),after.updated_at,recordId)]};});}
export async function readEventOwnerRecord(env,target,event){
 await policy(env,true);
 const observation={calendar_event_id:target.id,record_storage:'d1_owner',record_read_target:target};
 if(await first(env,'SELECT reason FROM lesson_history_exclusions WHERE calendar_id=? AND event_id=?',target.calendar_id,target.id)||event&&!isScheduledLesson(lessonEventRef(event,target.calendar_id)))return {...observation,attribution_status:'excluded',record_exists:false,record_revision:0,...calendarRecordValues({})};
 const link=await first(env,'SELECT * FROM lesson_event_links WHERE calendar_id=? AND event_id=?',target.calendar_id,target.id);
 if(!link?.record_id)return {...observation,record_exists:false,record_revision:0,attribution_status:'owner_unassigned',attribution_notice:'生徒・クラスの紐づけが必要です',...calendarRecordValues({})};
 const record=await first(env,'SELECT * FROM lesson_history_records WHERE id=?',link.record_id),old=JSON.parse(link.target_json);
 const changed=lessonTitleKey(old.title)!==lessonTitleKey(target.title);
 const recreated=event&&encode(eventIdentity(event))!==link.event_identity_json;
 return {...observation,record_exists:true,record_revision:record.revision,record_id:record.id,owner_id:record.owner_id,record_calendar_id:target.calendar_id,record_title:old.title,attribution_status:recreated?'event_recreated':changed?'title_changed':'confirmed',...(changed||recreated?{...calendarRecordValues({}),attribution_notice:'予定名または予定の生成情報が変わりました。同じ生徒か、別の生徒かを確認してください'}:{...calendarRecordValues(record),completed:record.completed}),link_revision:link.revision};
}
export async function writeEventOwnerRecord(env,body,deps){
 await policy(env,true);const {ref,event}=await liveHistoryTarget(env,body.target,deps),shown=await readEventOwnerRecord(env,ref,event);
 if(shown.attribution_status!=='confirmed')throw fail('生徒・クラスの紐づけを確認してください');
 if(body.record_revision!==shown.record_revision||body.expectedLessonPlan!==undefined&&shown.lesson_plan!==body.expectedLessonPlan)throw fail('授業内容が更新されています');
 const saved=await editOwnerRecord(env,shown.record_id,{...body.patch,revision:body.record_revision,request_id:body.request_id||crypto.randomUUID(),expected_link:{calendar_id:ref.calendar_id,event_id:ref.id,revision:shown.link_revision}});
 return {...shown,...calendarRecordValues(saved.record),completed:saved.record.completed,record_revision:saved.record.revision,target:ref,operation_id:saved.operation_id};
}
export async function changeLessonBinding(env,body,deps){await policy(env);return transaction(env,body,'change_binding',async()=>{
 let ref,event;
 if(body.decision==='detach'){
  ref=body.target;const settings=await deps.settings();if(!settings.selected_calendars?.includes(ref?.calendar_id))throw fail('カレンダーを確認してください',403);await notExcluded(env,ref);
 }else ({ref,event}=await liveHistoryTarget(env,body.target,deps));
 const link=await first(env,'SELECT * FROM lesson_event_links WHERE calendar_id=? AND event_id=?',ref.calendar_id,ref.id);
 if((link?.revision||0)!==body.link_revision)throw fail('予定の紐づけが変更されています');
 const conditions=[guard(env,'COALESCE((SELECT revision FROM lesson_event_links WHERE calendar_id=? AND event_id=?),0)=?',[ref.calendar_id,ref.id,body.link_revision])];
 let record=link?.record_id?await first(env,'SELECT * FROM lesson_history_records WHERE id=?',link.record_id):null,newRecordValue=null;
 if(body.decision==='same_owner'){
  if(!record||record.id!==body.record_id||record.owner_id!==body.owner_id)throw fail('同じ生徒・クラスの記録を確認してください');
 }else if(body.decision==='different_owner'||body.decision==='new'){
  const owner=await ownerGuard(env,body);if(body.decision==='different_owner'&&(!record||owner.id===record.owner_id))throw fail('別の生徒・クラスを選択してください');
  if(body.decision==='new'&&link?.record_id)throw fail('既存の紐づけを確認してください');
  if(body.decision==='new'&&await first(env,'SELECT calendar_event_id FROM curriculum_entries WHERE calendar_event_id=?',ref.id))throw fail('旧記録があります。移行プレビューと所属確認から取り込んでください');
  record=newRecord(owner.id,{lesson_date:ref.start,title_snapshot:ref.title},{binding_decision:body.decision});newRecordValue=record;
  conditions.push(guard(env,'EXISTS(SELECT 1 FROM lesson_owners WHERE id=? AND revision=?)',[owner.id,owner.revision]));
 }else if(body.decision==='attach'){
  record=await first(env,'SELECT * FROM lesson_history_records WHERE id=?',body.record_id);
  if(!record||record.owner_id!==body.owner_id||record.revision!==body.record_revision||link?.record_id)throw fail('保存済み記録と新しい予定を再確認してください');
  conditions.push(guard(env,'EXISTS(SELECT 1 FROM lesson_history_records WHERE id=? AND revision=?)',[record.id,record.revision]));
 }else if(body.decision==='detach'){if(!link?.record_id)throw fail('紐づけ済みの予定ではありません');record=null;}else throw fail('紐づけ方法が不正です',400);
 if(newRecordValue)conditions.push(recordInsert(env,newRecordValue));
 const identity=event?encode(eventIdentity(event)):link?.event_identity_json||'{}';
 const after={link:{calendar_id:ref.calendar_id,event_id:ref.id,record_id:record?.id||null,revision:(link?.revision||0)+1,target_json:encode(ref),event_identity_json:identity},record};
 conditions.push(statement(env,`INSERT INTO lesson_event_links VALUES (?,?,?,?,?,?) ON CONFLICT(calendar_id,event_id) DO UPDATE SET record_id=excluded.record_id,revision=excluded.revision,target_json=excluded.target_json,event_identity_json=excluded.event_identity_json`,ref.calendar_id,ref.id,record?.id||null,after.link.revision,encode(ref),identity));
 return {before:{link},after,statements:conditions};});}

// A preview is an exact, expiring comparison, never an attribution inference.
export async function previewOwnerImport(env,target,deps){
 await policy(env);const {event,ref}=await liveHistoryTarget(env,target,deps);
 const source=await first(env,'SELECT * FROM curriculum_entries WHERE calendar_event_id=?',ref.id);
 const identity=await first(env,'SELECT * FROM lesson_record_identity WHERE event_id=?',ref.id);
 if(identity?.calendar_id&&identity.calendar_id!==ref.calendar_id)throw fail('旧記録と異なるカレンダーです。所属確認を個別に行ってください');
 if(source&&!identity?.calendar_id){const settings=await deps.settings(),token=(await deps.token()).access_token;for(const calendar of settings.selected_calendars||[])if(calendar!==ref.calendar_id&&await deps.event(token,calendar,ref.id))throw fail('予定IDだけの旧記録を複数カレンダーへ確定できません');}
 const hold=await first(env,'SELECT * FROM lesson_record_hold WHERE event_id=? AND resolved_at IS NULL',ref.id);
 const operation=await first(env,"SELECT * FROM calendar_lesson_migration WHERE event_id=? AND calendar_id=? AND status IN ('reserved','dispatching','unknown','verified') ORDER BY CASE WHEN status='verified' THEN 1 ELSE 0 END,rowid DESC LIMIT 1",ref.id,ref.calendar_id);
 if(hold||operation&&operation.status!=='verified')throw fail('保留中の記録です。先に操作履歴を確認してください');
 let values=calendarRecordValues(source),origin='legacy_d1',layout=null;
 if(operation){
  const snapshot=JSON.parse(operation.snapshot_json),binding={...snapshot.binding,title:lessonTitleKey(snapshot.ref.title),generation:snapshot.after_generation??snapshot.binding.generation};
  if(binding.calendar_id!==ref.calendar_id||binding.event_id!==ref.id||binding.title!==lessonTitleKey(ref.title))throw fail('カレンダー記録の帰属確認が必要です');
  layout=parseCalendarRecord(event.description||'')||parsePlainCalendarRecord(event.description||'',binding,{prefix:snapshot.managed_prefix||'',suffix:snapshot.managed_suffix||'',allowPrefixEdit:true});
  if(!layout||encode(layout.binding)!==encode(binding))throw fail('カレンダーの最新4項目を安全に読めません');
  values=layout.values;origin='calendar_latest';
 }
 else if(parseCalendarRecord(event.description||'')||/(?:^|\n)\s*(?:授業予定|確認テスト|宿題|授業メモ)[:：]/.test(event.description||''))throw fail('管理履歴のないカレンダー記述があります。最新内容の個別照合が必要です');
 const imported=await first(env,'SELECT r.* FROM lesson_history_imports i JOIN lesson_history_records r ON r.id=i.record_id WHERE i.calendar_id=? AND i.event_id=?',ref.calendar_id,ref.id);
 const importedLink=imported?await first(env,'SELECT * FROM lesson_event_links WHERE calendar_id=? AND event_id=?',ref.calendar_id,ref.id):null;
 if(imported&&importedLink?.record_id!==imported.id)throw fail('取り込み後に予定の紐づけが変わっています。自動再取り込みを停止しました');
 const preview={target:ref,event_identity:eventIdentity(event),values,completed:source?.completed?1:0,origin,source,identity,operation_id:operation?.id||null,description:event.description||'',owner_confirmation_required:true,imported_record:imported,imported_link_revision:importedLink?.revision||0};
 return {...preview,fingerprint:await historyDigest(preview),captured_at:new Date().toISOString()};
}
export async function importOwnerRecord(env,body,deps){
 await policy(env);if(env.LESSON_HISTORY_MODE!=='reconcile')throw fail('授業内容の通常編集を停止した照合モードでのみ移行できます');
 const p=await first(env,'SELECT evidence_json FROM lesson_history_policy WHERE id=1');let backup;try{backup=JSON.parse(p.evidence_json).backup;}catch{}
 const backupAge=Date.now()-Date.parse(backup?.captured_at);
 if(!backup?.restored||!/^[a-f0-9]{64}$/.test(backup?.sha256||'')||!Number.isFinite(backupAge)||backupAge<0||backupAge>86400000)throw fail('24時間以内のバックアップと復元検証の証拠が必要です');
 return transaction(env,body,'import_record',async()=>{
  const owner=await ownerGuard(env,body),fresh=await previewOwnerImport(env,body.preview?.target,deps);
  const age=Date.now()-Date.parse(body.preview?.captured_at);
  if(fresh.fingerprint!==body.preview?.fingerprint||!Number.isFinite(age)||age< -60000||age>900000||!body.confirm_owner)throw fail('最新プレビューと生徒・クラスの確認が必要です');
  const sourceGuards=[guard(env,"NOT EXISTS(SELECT 1 FROM calendar_lesson_migration WHERE event_id=? AND status IN ('reserved','dispatching','unknown'))",[fresh.target.id]),guard(env,'COALESCE((SELECT revision FROM lesson_record_identity WHERE event_id=?),0)=?',[fresh.target.id,fresh.identity?.revision||0])];
  if(fresh.source)for(const key of ['completed',...fields,'updated_at'])sourceGuards.push(guard(env,`(SELECT ${key} FROM curriculum_entries WHERE calendar_event_id=?) IS ?`,[fresh.target.id,fresh.source[key]??null]));
  if(fresh.imported_record){
   const record=fresh.imported_record,previous=JSON.parse(record.source_json);
   if(!body.refresh||record.owner_id!==owner.id||record.revision!==body.record_revision||encode(calendarRecordValues(record))!==encode(previous.values)||record.completed!==previous.completed)throw fail('取り込み済みのD1記録が編集されています。自動で上書きせず個別照合してください');
   const after={...record,...fresh.values,completed:fresh.completed,revision:record.revision+1,source_json:encode({...fresh,imported_record:null}),updated_at:new Date().toISOString()};
   return {before:{record,preview:fresh},after:{record:after},statements:[...sourceGuards,guard(env,'EXISTS(SELECT 1 FROM lesson_history_records WHERE id=? AND revision=?)',[record.id,record.revision]),guard(env,'EXISTS(SELECT 1 FROM lesson_event_links WHERE calendar_id=? AND event_id=? AND record_id=? AND revision=?)',[fresh.target.calendar_id,fresh.target.id,record.id,fresh.imported_link_revision]),guard(env,'EXISTS(SELECT 1 FROM lesson_owners WHERE id=? AND revision=?)',[owner.id,owner.revision]),statement(env,`UPDATE lesson_history_records SET lesson_plan=?,confirmation_test=?,homework=?,lesson_memo=?,completed=?,revision=revision+1,source_json=?,updated_at=? WHERE id=?`,...fields.map(k=>after[k]),after.completed,after.source_json,after.updated_at,record.id),statement(env,'UPDATE lesson_history_imports SET fingerprint=?,source_json=? WHERE calendar_id=? AND event_id=?',fresh.fingerprint,encode(fresh),fresh.target.calendar_id,fresh.target.id)]};
  }
  const record=newRecord(owner.id,{lesson_date:fresh.target.start,title_snapshot:fresh.target.title,...fresh.values,completed:fresh.completed},fresh);
  const guards=[...sourceGuards,guard(env,'NOT EXISTS(SELECT 1 FROM lesson_event_links WHERE calendar_id=? AND event_id=?)',[fresh.target.calendar_id,fresh.target.id]),guard(env,'EXISTS(SELECT 1 FROM lesson_owners WHERE id=? AND revision=?)',[owner.id,owner.revision])];
  guards.push(recordInsert(env,record),statement(env,'INSERT INTO lesson_event_links VALUES (?,?,?,?,?,?)',fresh.target.calendar_id,fresh.target.id,record.id,1,encode(fresh.target),encode(fresh.event_identity)),statement(env,'INSERT INTO lesson_history_imports VALUES (?,?,?,?,?)',fresh.target.calendar_id,fresh.target.id,record.id,fresh.fingerprint,encode(fresh)));
  return {before:fresh,after:{record},statements:guards};
 });
}
export async function handleOwnerHistory(env,request,url,deps){
 const path=url.pathname.replace('/api/lesson-history',''),method=request.method;
 const input=()=>readHistoryInput(request);
 if(path==='/status'&&method==='GET')return {mode:env.LESSON_HISTORY_MODE||'off'};
 await policy(env,ownerHistoryActive(env));
 if(path==='/owners'&&method==='GET')return listLessonOwners(env);
 if(path==='/owners'&&method==='POST')return createLessonOwner(env,await input());
 const owner=path.match(/^\/owners\/([^/]+)$/);
 if(owner&&method==='PUT')return renameLessonOwner(env,owner[1],await input());
 if(path==='/records'&&method==='GET')return listOwnerRecords(env,url.searchParams.get('owner_id'));
 if(path==='/records'&&method==='POST')return createOwnerRecord(env,await input());
 const record=path.match(/^\/records\/([^/]+)$/);
 if(record&&method==='PUT')return editOwnerRecord(env,record[1],await input());
 if(path==='/audit'&&method==='GET')return rows(env,'SELECT * FROM lesson_history_audit WHERE id=?',url.searchParams.get('operation_id'));
 if(path==='/legacy'&&method==='GET')return rows(env,`SELECT c.calendar_event_id,i.calendar_id,i.title,i.revision,h.reason AS hold_reason FROM curriculum_entries c LEFT JOIN lesson_record_identity i ON i.event_id=c.calendar_event_id LEFT JOIN lesson_record_hold h ON h.event_id=c.calendar_event_id AND h.resolved_at IS NULL ORDER BY c.calendar_event_id`);
 if(path==='/locate'&&method==='POST'){
  const body=await input(),id=text(body.event_id,'予定ID',1024),settings=await deps.settings(),calendars=[...new Set(settings.selected_calendars||[])];if(calendars.length>20)throw fail('カレンダーを個別に指定してください');
  const token=(await deps.token()).access_token,found=[];for(const calendar of calendars){const event=await deps.event(token,calendar,id);if(event&&event.status!=='cancelled')found.push(lessonEventRef(event,calendar));}return found;
 }
 if(path==='/target'&&method==='POST'){const {ref}=await liveHistoryTarget(env,(await input()).target,deps);return {target:ref,link:await first(env,'SELECT * FROM lesson_event_links WHERE calendar_id=? AND event_id=?',ref.calendar_id,ref.id)};}
 if(path==='/binding'&&method==='POST')return changeLessonBinding(env,await input(),deps);
 if(path==='/import/preview'&&method==='POST')return previewOwnerImport(env,(await input()).target,deps);
 if(path==='/import'&&method==='POST')return importOwnerRecord(env,await input(),deps);
 throw fail('not found',404);
}
