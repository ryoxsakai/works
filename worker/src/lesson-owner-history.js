import {validCalendarDate,semesterForTarget,semesterCandidates} from '../../shared/lesson-semester.mjs';
import {applicableSeriesRule,seriesRules,seriesParent,parentIdentity,originalTime,validSeriesParent,resolveSeriesOwner} from './lesson-series.js';
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
// Pending plans are event-context drafts, never an inferred owner record.
async function pendingContext(target,event){return historyDigest({target,event_identity:eventIdentity(event)});}
export async function readPendingLessonPlan(env,target,event){
 if(!event)return {pending_allowed:false};
 const id=await pendingContext(target,event);let draft;
 try{draft=await first(env,'SELECT * FROM lesson_pending_plans WHERE id=?',id);}
 catch(error){if(!String(error.message).includes('no such table'))throw error;return {pending_allowed:true,pending_context:id,pending_storage_available:false,pending_exists:false,record_revision:0,lesson_plan:''};}
 return {pending_allowed:true,pending_context:id,pending_storage_available:true,pending_exists:!!draft,record_revision:draft?.revision||0,lesson_plan:draft?.lesson_plan||''};
}
export async function writePendingLessonPlan(env,body,deps){
 await policy(env,true);if(!ownerHistoryActive(env))throw fail('D1保存への切替後に下書きを保存してください');
 return transaction(env,body,'write_pending_plan',async()=>{
  const {ref,event}=await liveHistoryTarget(env,body.target,deps);
  const link=await first(env,'SELECT record_id FROM lesson_event_links WHERE calendar_id=? AND event_id=?',ref.calendar_id,ref.id);if(link?.record_id)throw fail('紐づけが変更されました。下書きを保持して保存先を確認してください');
  const current=await readPendingLessonPlan(env,ref,event);if(!current.pending_storage_available)throw fail('未紐づけ下書きの保存機能が未準備です。入力を保持してください',503);
  if(body.pending_context!==current.pending_context||body.record_revision!==current.record_revision||body.expected_lesson_plan!==current.lesson_plan)throw fail('予定または下書きが変更されました。入力を保持して再確認してください');
  if(typeof body.lesson_plan!=='string'||body.lesson_plan.length>5000)throw fail('授業予定が不正です',400);
  const now=new Date().toISOString(),old=await first(env,'SELECT * FROM lesson_pending_plans WHERE id=?',current.pending_context),draft={id:current.pending_context,calendar_id:ref.calendar_id,event_id:ref.id,target_json:encode(ref),event_identity_json:encode(eventIdentity(event)),lesson_plan:body.lesson_plan,revision:current.record_revision+1,created_at:old?.created_at||now,updated_at:now};
  const result={target:ref,lesson_plan:draft.lesson_plan,record_revision:draft.revision,record_storage:'d1_pending',attribution_status:'owner_unassigned',pending_context:draft.id,pending_allowed:true,pending_storage_available:true,pending_exists:true,pending_plan:draft};
  return {before:{pending_plan:old||null},after:result,statements:[guard(env,'NOT EXISTS(SELECT 1 FROM lesson_event_links WHERE calendar_id=? AND event_id=? AND record_id IS NOT NULL)',[ref.calendar_id,ref.id]),guard(env,'COALESCE((SELECT revision FROM lesson_pending_plans WHERE id=?),0)=?',[draft.id,current.record_revision]),statement(env,'INSERT INTO lesson_pending_plans VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET lesson_plan=excluded.lesson_plan,revision=excluded.revision,updated_at=excluded.updated_at',draft.id,draft.calendar_id,draft.event_id,draft.target_json,draft.event_identity_json,draft.lesson_plan,draft.revision,draft.created_at,draft.updated_at)]};
 });
}
export async function readEventOwnerRecord(env,target,event,deps){
 await policy(env,true);
 const observation={calendar_event_id:target.id,record_storage:'d1_owner',record_read_target:target};
 if(await first(env,'SELECT reason FROM lesson_history_exclusions WHERE calendar_id=? AND event_id=?',target.calendar_id,target.id)||event&&!isScheduledLesson(lessonEventRef(event,target.calendar_id)))return {...observation,attribution_status:'excluded',record_exists:false,record_revision:0,...calendarRecordValues({})};
 const link=await first(env,'SELECT * FROM lesson_event_links WHERE calendar_id=? AND event_id=?',target.calendar_id,target.id);
 if(!link){const series=await resolveSeriesOwner(env,target,event,deps);if(series)return {...observation,...calendarRecordValues({}),...series};}
 if(!link?.record_id)return {...observation,record_exists:false,record_revision:0,attribution_status:'owner_unassigned',attribution_notice:'生徒・クラスの紐づけが必要です',...calendarRecordValues({}),...await readPendingLessonPlan(env,target,event)};
 let record;try{record=await first(env,'SELECT r.*,EXISTS(SELECT 1 FROM lesson_owner_memos m WHERE m.owner_id=r.owner_id) AS fixed_memo FROM lesson_history_records r WHERE r.id=?',link.record_id);}catch(error){if(!String(error.message).includes('no such table'))throw error;record=await first(env,'SELECT * FROM lesson_history_records WHERE id=?',link.record_id);}const old=JSON.parse(link.target_json),source=JSON.parse(record.source_json||'{}');
 const changed=lessonTitleKey(old.title)!==lessonTitleKey(target.title);
 const recreated=event&&encode(eventIdentity(event))!==link.event_identity_json;
 return {...observation,record_exists:true,record_revision:record.revision,record_id:record.id,owner_id:record.owner_id,record_calendar_id:target.calendar_id,record_title:old.title,attribution_status:recreated?'event_recreated':changed?'title_changed':'confirmed',...(changed||recreated?{...calendarRecordValues({}),attribution_notice:'予定名または予定の生成情報が変わりました。同じ生徒か、別の生徒かを確認してください'}:{...calendarRecordValues(record),completed:record.completed}),link_revision:link.revision,...((record.fixed_memo||source.series_rule_id||['new','different_owner'].includes(source.binding_decision))?{owner_memo_storage:'owner_id'}:{})};
}
function currentSeriesGuard(env,shown,target){return guard(env,'EXISTS(SELECT 1 FROM lesson_series_owners WHERE id=? AND revision=?) AND NOT EXISTS(SELECT 1 FROM lesson_series_owners WHERE calendar_id=? AND series_id=? AND julianday(anchor_original)>julianday(?) AND julianday(anchor_original)<=julianday(?))',[shown.series_rule_id,shown.series_rule_revision,target.calendar_id,shown.series_id,shown.series_anchor_original,shown.series_original_time]);}
export async function writeEventOwnerRecord(env,body,deps){
 await policy(env,true);
 if(body.request_id){const old=await first(env,'SELECT q.*,a.action FROM lesson_history_requests q JOIN lesson_history_audit a ON a.id=q.id WHERE q.id=?',body.request_id);if(old?.action==='write_series_record'){if(old.digest!==await historyDigest({action:'write_series_record',body}))throw fail('操作IDの内容が一致しません');return JSON.parse(old.response_json);}}
 const {ref,event}=await liveHistoryTarget(env,body.target,deps),shown=await readEventOwnerRecord(env,ref,event,deps);
 if(shown.attribution_status!=='confirmed'||body.expected_owner_id&&body.expected_owner_id!==shown.owner_id)throw fail('生徒・クラスの紐づけを確認してください');
 if(body.record_revision!==shown.record_revision||body.expectedLessonPlan!==undefined&&shown.lesson_plan!==body.expectedLessonPlan)throw fail('授業内容が更新されています');
 if(shown.series_rule_id&&!shown.record_id)return transaction(env,{...body,request_id:body.request_id||crypto.randomUUID()},'write_series_record',async()=>{
  const fresh=await readEventOwnerRecord(env,ref,event,deps);if(fresh.series_rule_id!==shown.series_rule_id||fresh.owner_id!==shown.owner_id||fresh.record_id)throw fail('系列または紐づけが更新されました');
  const record=newRecord(shown.owner_id,{lesson_date:ref.start,title_snapshot:ref.title,...patchValues(body.patch||{})},{series_rule_id:shown.series_rule_id});
  return {before:{record:null},after:{...shown,...calendarRecordValues(record),completed:record.completed,record_id:record.id,record_exists:true,record_revision:1,link_revision:1,target:ref},statements:[
   currentSeriesGuard(env,shown,ref),guard(env,'EXISTS(SELECT 1 FROM lesson_owners WHERE id=? AND revision=?)',[shown.owner_id,shown.owner_revision]),guard(env,'NOT EXISTS(SELECT 1 FROM lesson_event_links WHERE calendar_id=? AND event_id=?)',[ref.calendar_id,ref.id]),guard(env,'NOT EXISTS(SELECT 1 FROM lesson_history_exclusions WHERE calendar_id=? AND event_id=?)',[ref.calendar_id,ref.id]),guard(env,'NOT EXISTS(SELECT 1 FROM curriculum_entries WHERE calendar_event_id=?)',[ref.id]),recordInsert(env,record),statement(env,'INSERT INTO lesson_event_links VALUES(?,?,?,?,?,?)',ref.calendar_id,ref.id,record.id,1,encode(ref),encode(eventIdentity(event)))]};
 });
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
 let values=calendarRecordValues(source || {}),origin='legacy_d1',layout=null;
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
export async function previewSeriesStart(env,body,deps){
 await policy(env,true);if(!ownerHistoryActive(env))throw fail('D1保存への切替後に開始してください');
 const {event,ref}=await liveHistoryTarget(env,body.target,deps);
 const proposed=body.new_owner;let owner;if(proposed){const name=text(proposed.name,'名前');if(!['student','class'].includes(proposed.kind))throw fail('生徒またはクラスを選択してください',400);owner={id:null,name,kind:proposed.kind,revision:0};}else owner=await ownerGuard(env,body);
 const original=originalTime(event);if(!event.recurringEventId||!Number.isFinite(Date.parse(original)))throw fail('単発予定です。次の回は個別に同じ生徒・クラスへ紐づけてください');
 const parent=await seriesParent(ref.calendar_id,event.recurringEventId,deps);if(!validSeriesParent(parent,event.recurringEventId)||event.iCalUID!==parent.iCalUID||lessonTitleKey(parent.summary)!==lessonTitleKey(ref.title))throw fail('親の繰返し予定と、この回の名前・生成情報を確認してください');
 const link=await first(env,'SELECT * FROM lesson_event_links WHERE calendar_id=? AND event_id=?',ref.calendar_id,ref.id);if(link)throw fail('この回には紐づけ・解除履歴があります。既存の帰属確認を先に行ってください');
 const rules=(await seriesRules(env,ref.calendar_id)).filter(r=>r.series_id===event.recurringEventId);
 if(rules.some(r=>Date.parse(r.anchor_original)>=Date.parse(original)))throw fail('同じ系列には、この日以降の開始設定があります。既存設定を確認してください');
 const links=await rows(env,'SELECT l.*,r.owner_id FROM lesson_event_links l LEFT JOIN lesson_history_records r ON r.id=l.record_id WHERE l.calendar_id=?',ref.calendar_id);
 const conflicting=links.filter(l=>{const identity=JSON.parse(l.event_identity_json);return identity.recurringEventId===event.recurringEventId&&l.record_id&&l.owner_id!==owner.id&&(!identity.originalStartTime||Date.parse(identity.originalStartTime)>=Date.parse(original));});
 if(conflicting.length)throw fail('この日以降に別の生徒・クラスの確定記録があります。開始範囲を個別に確認してください');
 const legacy=!!await first(env,'SELECT calendar_event_id FROM curriculum_entries WHERE calendar_event_id=?',ref.id);
 const preview={target:ref,owner_id:owner.id,owner_revision:owner.revision,new_owner:proposed?{name:owner.name,kind:owner.kind}:null,series_id:event.recurringEventId,anchor_original:new Date(original).toISOString(),parent_identity:parentIdentity(parent),expected_title:ref.title,rules_digest:await historyDigest(rules),rules_count:rules.length,legacy_at_anchor:legacy};
 return {...preview,fingerprint:await historyDigest(preview),captured_at:new Date().toISOString(),pending_plan:await readPendingLessonPlan(env,ref,event)};
}
export async function startLessonSeries(env,body,deps){
 await policy(env,true);return transaction(env,body,'start_series',async()=>{
  if(!body.confirm_new_history||!body.preview||Date.now()-Date.parse(body.preview.captured_at)>900000||!Number.isFinite(Date.parse(body.preview.captured_at)))throw fail('この授業以降の新しい履歴開始を確認してください');
  const fresh=await previewSeriesStart(env,{target:body.preview.target,owner_id:body.preview.owner_id,owner_revision:body.preview.owner_revision,new_owner:body.preview.new_owner},deps);if(fresh.fingerprint!==body.preview.fingerprint)throw fail('系列・所有者・開始予定が変更されました。比較を読み直してください');
  return buildSeriesStart(env,fresh,deps);
 });
}
async function buildSeriesStart(env,fresh,deps,sharedOwner=null,insertOwner=true){
  const createdOwner=sharedOwner|| (fresh.new_owner?{id:crypto.randomUUID(),name:fresh.new_owner.name,kind:fresh.new_owner.kind,revision:1,created_at:new Date().toISOString()}:null);
  const {ref,event}=await liveHistoryTarget(env,fresh.target,deps),rule={id:crypto.randomUUID(),calendar_id:ref.calendar_id,series_id:fresh.series_id,anchor_original:fresh.anchor_original,parent_identity_json:encode(fresh.parent_identity),expected_title:ref.title,owner_id:createdOwner?.id||fresh.owner_id,revision:1,created_at:new Date().toISOString()};
  const record=newRecord(rule.owner_id,{lesson_date:ref.start,title_snapshot:ref.title},{series_rule_id:rule.id,explicit_new_history:true});
  const conflictSQL="NOT EXISTS(SELECT 1 FROM lesson_event_links l JOIN lesson_history_records r ON r.id=l.record_id WHERE l.calendar_id=? AND json_extract(l.event_identity_json,'$.recurringEventId')=? AND r.owner_id<>? AND (json_extract(l.event_identity_json,'$.originalStartTime') IS NULL OR julianday(json_extract(l.event_identity_json,'$.originalStartTime'))>=julianday(?)))";
  return {before:{preview:fresh},after:{rule,record,owner:createdOwner,link:{calendar_id:ref.calendar_id,event_id:ref.id,record_id:record.id,revision:1}},statements:[guard(env,'NOT EXISTS(SELECT 1 FROM lesson_event_links WHERE calendar_id=? AND event_id=?)',[ref.calendar_id,ref.id]),guard(env,'NOT EXISTS(SELECT 1 FROM lesson_history_exclusions WHERE calendar_id=? AND event_id=?)',[ref.calendar_id,ref.id]),...(createdOwner&&insertOwner?[statement(env,'INSERT INTO lesson_owners VALUES(?,?,?,?,?)',createdOwner.id,createdOwner.kind,createdOwner.name,1,createdOwner.created_at),statement(env,'INSERT INTO lesson_owner_aliases VALUES(?,?)',createdOwner.id,createdOwner.name)]:[guard(env,'EXISTS(SELECT 1 FROM lesson_owners WHERE id=? AND revision=?)',[rule.owner_id,fresh.owner_revision])]),guard(env,'(SELECT COUNT(*) FROM lesson_series_owners WHERE calendar_id=? AND series_id=?)=?',[ref.calendar_id,rule.series_id,fresh.rules_count]),guard(env,conflictSQL,[ref.calendar_id,rule.series_id,rule.owner_id,rule.anchor_original]),statement(env,'INSERT INTO lesson_series_owners VALUES(?,?,?,?,?,?,?,?,?)',...Object.values(rule)),recordInsert(env,record),statement(env,'INSERT INTO lesson_event_links VALUES(?,?,?,?,?,?)',ref.calendar_id,ref.id,record.id,1,encode(ref),encode(eventIdentity(event)))]};
}
export async function previewSemesterStart(env,body,deps){
 await policy(env,true);if(!ownerHistoryActive(env))throw fail('D1保存への切替後に開始してください');
 const {ref}=await liveHistoryTarget(env,body.target,deps),settings=await deps.settings();
 const terms=await rows(env,'SELECT id,label AS name,start_date,end_date FROM terms');
 let term;try{term=semesterForTarget(terms,ref,body.term_id);}catch(e){throw fail(e.message);}
 if(!deps.events)throw fail('学期内の予定取得が利用できません',503);
 const token=(await deps.token()).access_token,next=new Date(term.end_date+'T00:00:00+09:00');next.setUTCDate(next.getUTCDate()+1);
 const events=await deps.events(token,ref.calendar_id,term.start_date+'T00:00:00+09:00',next.toISOString());
 if(!Array.isArray(events)||events.length>2500)throw fail('学期の予定を完全に確認できません');
 const links=await rows(env,'SELECT l.*,r.owner_id FROM lesson_event_links l LEFT JOIN lesson_history_records r ON r.id=l.record_id WHERE l.calendar_id=?',ref.calendar_id),legacy=await rows(env,'SELECT calendar_event_id FROM curriculum_entries'),excluded=await rows(env,'SELECT event_id FROM lesson_history_exclusions WHERE calendar_id=?',ref.calendar_id);
 const byId=new Map(links.map(l=>[l.event_id,l])),legacyIds=new Set(legacy.map(l=>l.calendar_event_id)),observations=[];
 const matching=events.filter(e=>lessonTitleKey(e.summary)===lessonTitleKey(ref.title));if(matching.length>40)throw fail('同名の予定が40件を超えます。開始範囲を個別に確認してください');
 for(const event of matching){const link=byId.get(event.id);let status='owner_unassigned',owner_id=null,record_id=null;
  if(link){const shown=await readEventOwnerRecord(env,lessonEventRef(event,ref.calendar_id),event,deps);status=shown.attribution_status;owner_id=shown.owner_id;record_id=shown.record_id;}
  else {const shown=await resolveSeriesOwner(env,lessonEventRef(event,ref.calendar_id),event,deps);if(shown){status=shown.attribution_status;owner_id=shown.owner_id;}}
  observations.push({event_id:event.id,link_exists:!!link,status,owner_id,record_id,legacy:legacyIds.has(event.id)});
 }
 let candidates;try{candidates=semesterCandidates({events,target:ref,term,excludedTitles:settings.excluded_titles||[],excludedIds:excluded.map(e=>e.event_id),observations,ownerId:body.owner_id||null});}catch(e){throw fail(e.message);}
 const starts=[],grouped=new Map();for(const item of candidates.items.filter(i=>!i.reason&&!i.existing_owner_id)){
  if(!item.series_id){item.reason='single_requires_confirmation';continue;}
  if(!Number.isFinite(Date.parse(item.original_time)))throw fail('繰返しの個別回を確認できません');
  const list=grouped.get(item.series_id)||[];list.push(item);grouped.set(item.series_id,list);
 }
 if(grouped.size>8)throw fail('同名の系列が多いため、系列ごとの確認が必要です');
 for(const items of grouped.values()){
  const first=[...items].sort((a,b)=>Date.parse(a.original_time)-Date.parse(b.original_time))[0];
  const {captured_at,...start}=await previewSeriesStart(env,{target:first.target,owner_id:body.owner_id,owner_revision:body.owner_revision,new_owner:body.new_owner},deps);if(items.some(item=>item.event_identity.iCalUID!==start.parent_identity.iCalUID||!item.event_identity.created||!validCalendarDate(String(item.original_time).slice(0,10))))throw fail('学期内の個別回と親の生成情報が一致しません');starts.push(start);
 }
 if(!starts.length)throw fail('新しく開始できる繰返し系列がありません。既存の所属と単発予定を個別に確認してください');
 // Recompute numbering after holding single events. No name-only single-event transfer.
 let ordinal=0;const count=candidates.items.filter(i=>!i.reason).length;for(const item of candidates.items){delete item.ordinal;delete item.total;if(!item.reason){item.ordinal=++ordinal;item.total=count;}}
 candidates.eligible_count=count;candidates.first_date=candidates.items.find(i=>!i.reason)?.target.start||null;candidates.selected_ordinal=candidates.items.find(i=>i.target.id===ref.id)?.ordinal||null;
 if(!candidates.selected_ordinal)throw fail('選択予定は個別確認が必要です');
 const result={target:ref,term,candidates,starts,owner_id:body.owner_id||null,owner_revision:body.owner_revision||0,new_owner:starts[0].new_owner};
 return {...result,fingerprint:await historyDigest(result),captured_at:new Date().toISOString()};
}
export async function startSemesterSeries(env,body,deps){
 await policy(env,true);return transaction(env,body,'start_semester_series',async()=>{
  const old=body.preview,age=Date.now()-Date.parse(old?.captured_at);if(!body.confirm_new_history||!Number.isFinite(age)||age< -60000||age>900000)throw fail('学期内の候補と開始先の確認が必要です');
  const fresh=await previewSemesterStart(env,{target:old.target,term_id:old.term.id,owner_id:old.owner_id,owner_revision:old.owner_revision,new_owner:old.new_owner},deps);
  if(fresh.fingerprint!==old.fingerprint)throw fail('学期・予定・所属が変更されました。一括確認を読み直してください');
  const createdOwner=fresh.new_owner?{id:crypto.randomUUID(),name:fresh.new_owner.name,kind:fresh.new_owner.kind,revision:1,created_at:new Date().toISOString()}:null,ownerId=createdOwner?.id||fresh.owner_id,statements=[],results=[];
  for(const item of fresh.candidates.items.filter(i=>!i.reason&&!i.existing_owner_id))statements.push(guard(env,'NOT EXISTS(SELECT 1 FROM lesson_event_links WHERE calendar_id=? AND event_id=?)',[item.target.calendar_id,item.target.id]));
  for(const [i,preview]of fresh.starts.entries()){
   const part=await buildSeriesStart(env,{...preview,owner_id:ownerId,owner_revision:createdOwner?1:preview.owner_revision},deps,createdOwner,i===0);statements.push(...part.statements);results.push(part.after);
  }
  statements.push(guard(env,'EXISTS(SELECT 1 FROM terms WHERE id=? AND start_date=? AND end_date=?)',[fresh.term.id,fresh.term.start_date,fresh.term.end_date]));
  for(const item of fresh.candidates.items.filter(i=>!i.reason&&!i.existing_owner_id))statements.push(guard(env,'NOT EXISTS(SELECT 1 FROM curriculum_entries WHERE calendar_event_id=?) AND NOT EXISTS(SELECT 1 FROM lesson_history_exclusions WHERE calendar_id=? AND event_id=?)',[item.target.id,item.target.calendar_id,item.target.id]));
  return {before:{preview:fresh},after:{owner_id:ownerId,term:fresh.term,candidates:fresh.candidates,series:results},statements};
 });
}
export async function readOwnerSemesterSchedule(env,ownerId,termId,deps){
 await policy(env,true);if(!ownerHistoryActive(env))throw fail('保存先の切替後に確認してください');
 const owner=await first(env,'SELECT * FROM lesson_owners WHERE id=?',ownerId),term=await first(env,'SELECT id,label AS name,start_date,end_date FROM terms WHERE id=?',termId);if(!owner||!term)throw fail('生徒・クラスと学期を選択してください',400);
 if(!validCalendarDate(term.start_date)||!validCalendarDate(term.end_date)||term.start_date>term.end_date)throw fail('学期の期間を確認してください');
 const settings=await deps.settings(),calendars=[...new Set(settings.selected_calendars||[])];if(calendars.length>20)throw fail('カレンダーが多いため個別確認が必要です');
 const next=new Date(term.end_date+'T00:00:00+09:00');next.setUTCDate(next.getUTCDate()+1);const token=(await deps.token()).access_token,items=[];
 for(const calendar of calendars){
  const rules=await seriesRules(env,calendar),links=await rows(env,'SELECT l.event_id,r.owner_id FROM lesson_event_links l LEFT JOIN lesson_history_records r ON r.id=l.record_id WHERE l.calendar_id=?',calendar),linked=new Map(links.map(l=>[l.event_id,l.owner_id]));
  if(!rules.some(r=>r.owner_id===ownerId)&&![...linked.values()].includes(ownerId))continue;
  const events=await deps.events(token,calendar,term.start_date+'T00:00:00+09:00',next.toISOString()),seen=new Set();if(!Array.isArray(events)||events.length>2500)throw fail('学期の予定を完全に確認できません');
  for(const event of events){
   if(seen.has(event.id))throw fail('学期内の予定が重複しています');seen.add(event.id);
   const ref=lessonEventRef(event,calendar);if(!isScheduledLesson(ref,settings.excluded_titles||[]))continue;if(!validCalendarDate(String(ref.start).slice(0,10))||!validCalendarDate(String(ref.end).slice(0,10)))throw fail('予定日時を確認できません');
   const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ref.start));if(day<term.start_date||day>term.end_date)continue;
   if(linked.has(event.id)?linked.get(event.id)!==ownerId:applicableSeriesRule(event,rules)?.owner_id!==ownerId)continue;
   const shown=await readEventOwnerRecord(env,ref,event,deps);if(shown.attribution_status!=='confirmed'||shown.owner_id!==ownerId)continue;
   items.push({target:ref,owner_id:ownerId,record_id:shown.record_id||null,record_revision:shown.record_revision,completed:!!shown.completed});if(items.length>100)throw fail('学期内の授業が100件を超えます。個別確認してください');
  }
 }
 items.sort((a,b)=>Date.parse(a.target.start)-Date.parse(b.target.start)||a.target.id.localeCompare(b.target.id));
 const grouped=new Map();for(const item of items){const list=grouped.get(item.target.calendar_id)||[];list.push(item);grouped.set(item.target.calendar_id,list);}for(const group of grouped.values())group.forEach((item,i)=>{item.ordinal=i+1;item.total=group.length;});
 return {owner_id:ownerId,owner_revision:owner.revision,term,items};
}
async function verifiedMemoOwner(env,ownerId,target,deps){
 const owner=await first(env,'SELECT * FROM lesson_owners WHERE id=?',ownerId);if(!owner)throw fail('生徒・クラスを確認してください',404);if(!target)return {ref:null,shown:null,owner};
 const {ref,event}=await liveHistoryTarget(env,target,deps),shown=await readEventOwnerRecord(env,ref,event,deps);if(shown.attribution_status!=='confirmed'||shown.owner_id!==ownerId)throw fail('共有メモの生徒・クラスが変更されています。入力を保持してください');return {ref,shown,owner};
}
export async function readOwnerMemo(env,ownerId,target,deps){
 await policy(env,true);const {ref,owner}=await verifiedMemoOwner(env,ownerId,target,deps),memo=await first(env,'SELECT * FROM lesson_owner_memos WHERE owner_id=?',ownerId);return {owner_id:ownerId,owner_revision:owner.revision,target:ref,memo:memo?.memo||'',revision:memo?.revision||0};
}
export async function writeOwnerMemo(env,body,deps){
 await policy(env,true);if(!ownerHistoryActive(env)||typeof body.memo!=='string'||body.memo.length>20000)throw fail('共有メモの保存条件を確認してください',400);
 return transaction(env,body,'write_owner_memo',async()=>{
  const {ref,shown,owner}=await verifiedMemoOwner(env,body.owner_id,body.target,deps),current=await first(env,'SELECT * FROM lesson_owner_memos WHERE owner_id=?',body.owner_id);
  if(body.owner_revision!==owner.revision)throw fail('生徒・クラスの表示名・版が変わりました。再確認してください');
  if((current?.revision||0)!==body.revision||(current?.memo||'')!==body.expected_memo)throw fail('別の画面で共有メモが更新されました。入力と最新内容を比較してください');
  const ownership=!shown?guard(env,'EXISTS(SELECT 1 FROM lesson_owners WHERE id=? AND revision=?)',[owner.id,owner.revision]):shown.record_id?guard(env,'EXISTS(SELECT 1 FROM lesson_event_links l JOIN lesson_history_records r ON r.id=l.record_id WHERE l.calendar_id=? AND l.event_id=? AND l.revision=? AND r.owner_id=?)',[ref.calendar_id,ref.id,shown.link_revision,body.owner_id]):guard(env,'EXISTS(SELECT 1 FROM lesson_series_owners WHERE id=? AND revision=? AND owner_id=?) AND NOT EXISTS(SELECT 1 FROM lesson_event_links WHERE calendar_id=? AND event_id=?)',[shown.series_rule_id,shown.series_rule_revision,body.owner_id,ref.calendar_id,ref.id]);
  const after={owner_id:body.owner_id,owner_revision:owner.revision,memo:body.memo,revision:(current?.revision||0)+1,target:ref};return {before:{memo:current||null},after,statements:[ownership,...(shown?.series_rule_id&&!shown.record_id?[currentSeriesGuard(env,shown,ref)]:[]),guard(env,'EXISTS(SELECT 1 FROM lesson_owners WHERE id=? AND revision=?)',[owner.id,owner.revision]),...(ref?[guard(env,'NOT EXISTS(SELECT 1 FROM lesson_history_exclusions WHERE calendar_id=? AND event_id=?)',[ref.calendar_id,ref.id])]:[]),guard(env,'COALESCE((SELECT revision FROM lesson_owner_memos WHERE owner_id=?),0)=?',[body.owner_id,body.revision]),statement(env,'INSERT INTO lesson_owner_memos VALUES(?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET memo=excluded.memo,revision=excluded.revision,updated_at=excluded.updated_at',body.owner_id,body.memo,after.revision,new Date().toISOString())]};
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
 if(path==='/pending-plans'&&method==='GET'){
  const settings=await deps.settings(),calendars=[...new Set(settings.selected_calendars||[])];if(!calendars.length)return [];
  const calendar=url.searchParams.get('calendar_id'),event=url.searchParams.get('event_id');if(calendar&&!calendars.includes(calendar))throw fail('カレンダーを確認してください',403);
  const selected=calendar?[calendar]:calendars;if(selected.length>20)throw fail('カレンダーを個別指定してください',400);
  const clauses=['calendar_id IN ('+selected.map(()=>'?').join(',')+')'],args=[...selected];if(event){clauses.push('event_id=?');args.push(event);}
  return rows(env,'SELECT * FROM lesson_pending_plans WHERE '+clauses.join(' AND ')+' ORDER BY updated_at DESC,id LIMIT 200',...args);
 }
 if(path==='/semester/schedules'&&method==='GET')return readOwnerSemesterSchedule(env,url.searchParams.get('owner_id'),url.searchParams.get('term_id'),deps);
 if(path==='/semester/preview'&&method==='POST')return previewSemesterStart(env,await input(),deps);
 if(path==='/semester/start'&&method==='POST')return startSemesterSeries(env,await input(),deps);
 if(path==='/series/preview'&&method==='POST')return previewSeriesStart(env,await input(),deps);
 if(path==='/series/start'&&method==='POST')return startLessonSeries(env,await input(),deps);
 if(path==='/owner-memo'&&method==='GET'){let target;try{target=JSON.parse(url.searchParams.get('target'));}catch{throw fail('予定を再確認してください',400);}return readOwnerMemo(env,url.searchParams.get('owner_id'),target,deps);}
 if(path==='/owner-memo'&&method==='PUT')return writeOwnerMemo(env,await input(),deps);
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

