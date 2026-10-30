import {parseCalendarRecord,replaceCalendarRecord,calendarRecordValues,CALENDAR_RECORD_FROM,CALENDAR_RECORD_START,CALENDAR_RECORD_END} from '../../shared/calendar-lesson-record.mjs';
import {lessonDate,lessonRecordNeedsReview,lessonTitleKey} from '../../shared/lesson-attribution.js';
import {lessonEventRef,sameLessonEvent,isScheduledLesson} from '../../shared/lesson-plan.js';
import {rawRecord,requireCurrent,prepareRecordWrite,commitRecords,readCommittedRecord} from './lesson-attribution.js';
import {recordBinding,calendarRecordPrivacy} from './calendar-lesson-migration.js';
import {calendarLessonJournal} from './calendar-lesson-journal.js';
import {calendarLessonGoogle} from './calendar-lesson-google.js';
const fail=(message,code='CALENDAR_RECORD_CONFLICT',status=409)=>Object.assign(new Error(message),{code,status});
export const calendarRecordsEnabled=env=>env.CALENDAR_LESSON_RECORDS==='true';
export function calendarRecordEligible(env,event){return calendarRecordsEnabled(env)&&(lessonDate(lessonEventRef(event))>=CALENDAR_RECORD_FROM||[CALENDAR_RECORD_START,CALENDAR_RECORD_END].some(marker=>String(event.description||'').includes(marker)));}
export function calendarStorageState(row,ref,operation){
 if(!operation)return row;
 if(operation.status!=='verified')return {...row,record_pending_operation:true,record_target_unavailable:true,attribution_status:'target_unavailable',...calendarRecordValues({})};
 try{const snapshot=JSON.parse(operation.snapshot_json),binding={...snapshot.binding,title:lessonTitleKey(snapshot.ref.title),generation:snapshot.after_generation??snapshot.binding.generation};
  return JSON.stringify(binding)===JSON.stringify(recordBinding(row,ref))?{...row,record_calendar_managed:true}:row;
 }catch{return {...row,record_target_unavailable:true,attribution_status:'target_unavailable',...calendarRecordValues({})};}
}
export async function loadCalendarStorageState(env,row,ref){
 if(!calendarRecordsEnabled(env))return row;
 if(env.CALENDAR_LESSON_MIGRATION_JOURNAL!=='true')throw fail('カレンダー記録の保護設定を確認してください','CALENDAR_MIGRATION_NOT_ACTIVE',503);
 const operation=await env.DB.prepare("SELECT status,snapshot_json FROM calendar_lesson_migration WHERE event_id=? AND calendar_id=? AND status IN ('reserved','dispatching','unknown','verified') ORDER BY CASE WHEN status='verified' THEN 1 ELSE 0 END,rowid DESC LIMIT 1").bind(ref.id,ref.calendar_id).first();
 return calendarStorageState(row,ref,operation);
}
export function overlayCalendarLessonRecord(env,row,event){
 if(!calendarRecordEligible(env,event)&&!row.record_calendar_managed)return row;
 if(lessonRecordNeedsReview(row))return row;
 try{
  const parsed=parseCalendarRecord(event.description||'');
  if(!parsed)return row.record_calendar_managed?{...row,...calendarRecordValues({}),record_storage:'calendar_missing_fields'}:{...row,record_storage:'db_pending_migration'};
  const ref=lessonEventRef(event),binding=recordBinding(row,ref);
  if(JSON.stringify(parsed.binding)!==JSON.stringify(binding))throw fail('カレンダー説明欄の授業対応が変更されています');
  return {...row,...parsed.values,record_storage:'calendar',calendar_target:ref};
 }catch{
  return {...row,...calendarRecordValues({}),record_target_unavailable:true,attribution_status:'target_unavailable',attribution_notice:'カレンダー説明欄の対応確認が必要です',record_storage:'calendar_conflict'};
 }
}
export async function writeCalendarLessonRecord(env,{target,patch,recordRevision,expectedLessonPlan,initializeOnly=false,decision},deps){
 if(env.CALENDAR_LESSON_MIGRATION_JOURNAL!=='true')throw fail('カレンダー保存の準備が完了していません','CALENDAR_MIGRATION_NOT_ACTIVE',503);
 const settings=await deps.settings();if(!settings.selected_calendars?.includes(target.calendar_id))throw fail('選択されていないカレンダーです','CALENDAR_NOT_SELECTED',403);
 let attested=[];try{attested=JSON.parse(env.CALENDAR_LESSON_ATTESTED_CALENDARS||'[]');}catch{}
 if(!Array.isArray(attested)||attested.some(id=>typeof id!=='string'))throw fail('共有確認設定が不正です');
 const token=(await deps.token()).access_token,google=deps.calendar||calendarLessonGoogle({accessToken:token,ownerEmail:env.ALLOWED_EMAIL,attestedCalendars:attested}),journal=calendarLessonJournal(env);
 const event=await google.read(target.calendar_id,target.id);if(!event)throw fail('授業が削除されています');event.calendar_id=target.calendar_id;
 const ref=lessonEventRef(event);
 let useCalendar=calendarRecordEligible(env,event);
 if(!sameLessonEvent(ref,target)||useCalendar&&(!isScheduledLesson(ref,settings.excluded_titles||[])||event.recurrence))throw fail('授業日時・予定名が変更されています');
 // Preserve the existing event-ID collision boundary across every selected calendar.
 for(const id of [...new Set(settings.selected_calendars)].filter(id=>id!==target.calendar_id))if(await google.read(id,target.id))throw fail('同じ予定IDが複数のカレンダーにあります');
 const row=await rawRecord(env,target.id);
 if(decision&&!['inherit','separate'].includes(decision))throw fail('確認方法が不正です');
 const current=await loadCalendarStorageState(env,decision?row:requireCurrent(row,ref),ref);useCalendar=useCalendar||!!current.record_calendar_managed;
 if(row.record_revision!==recordRevision)throw fail('授業記録の版が変更されています');
 const shown=overlayCalendarLessonRecord(env,current,event);if(!decision&&lessonRecordNeedsReview(shown))throw fail('説明欄の授業対応を確認してください');
 if(expectedLessonPlan!==undefined&&(shown.lesson_plan||'')!==expectedLessonPlan)throw fail('授業予定が別の画面で変更されています');
 if(!useCalendar){
  if(initializeOnly)return {...shown,target:ref,initialized:false};
  const prepared=await prepareRecordWrite(env,ref,patch,row.record_revision);await commitRecords(env,prepared.statements);return {...await readCommittedRecord(env,ref,prepared),target:ref};
 }
 const parsed=parseCalendarRecord(event.description||'');
 if(!decision&&!initializeOnly&&!parsed&&!['new','confirmed'].includes(current.attribution_status)){
  // Unverified legacy content is held from NEW Calendar disclosure, not from
  // its existing guarded DB workflow. Never silently mark it verified/export it.
  const prepared=await prepareRecordWrite(env,ref,patch,row.record_revision);await commitRecords(env,prepared.statements);
  return {...await readCommittedRecord(env,ref,prepared),target:ref,record_storage:'db_pending_migration'};
 }
 if(initializeOnly){
  if((event.description||'').trim())return {...shown,target:ref,initialized:false};
  if(!current.record_calendar_managed&&Object.values(calendarRecordValues(row)).some(value=>value.trim()))throw fail('旧記録の転記が必要です');
 }
 const safety=calendarRecordPrivacy(event,await google.privacy(target.calendar_id),env.ALLOWED_EMAIL);if(safety.status!=='safe')throw fail('共有範囲を確認できないため保存を保留しました: '+safety.reason,'CALENDAR_PRIVACY_REQUIRED',403);
 if(decision){const oldBinding={...recordBinding(row,ref),calendar_id:row.record_calendar_id||row.record_observed_calendar_id,title:lessonTitleKey(row.record_title||row.record_observed_title)};if(!parsed||JSON.stringify(parsed.binding)!==JSON.stringify(oldBinding))throw fail('旧説明欄の所属を確認できません');}
 const values={...calendarRecordValues(decision?(decision==='inherit'?parsed.values:{}):shown),...Object.fromEntries(Object.keys(calendarRecordValues({})).filter(key=>patch[key]!==undefined).map(key=>[key,patch[key]??'']))};
 const recordAfter={...values,...(patch.completed===undefined?{}:{completed:patch.completed})};
 const prepared=decision?{generation:row.record_generation+1}:await prepareRecordWrite(env,ref,recordAfter,row.record_revision);
 const after=replaceCalendarRecord(event.description||'',values,{...recordBinding(row,ref),generation:prepared.generation},{explicitRebind:!!decision});
 const op=await journal.reserve({ref,binding:recordBinding(row,ref),after_generation:prepared.generation,decision,revision:row.record_revision,before:event,record_before:row,after_description:after,record_after:recordAfter});
 // Re-read the event AND privacy after the durable reservation, immediately
 // before dispatch. Never rely on a stale dry-run assertion supplied by a client.
 const latest=await google.read(ref.calendar_id,ref.id),privacy=await google.privacy(ref.calendar_id);
 if(!latest||!sameLessonEvent(lessonEventRef(latest,ref.calendar_id),ref)||calendarRecordPrivacy({...latest,calendar_id:ref.calendar_id},privacy,env.ALLOWED_EMAIL).status!=='safe'){
  // No dispatch happened. Mark a distinct definitive failure via the journal's
  // dispatch fence; no timeout-based release is used.
  await journal.mark(op.id,'dispatching');await journal.mark(op.id,'precondition_failed');throw fail('保存直前に予定または共有範囲が変更されました');
 }
 await journal.mark(op.id,'dispatching');
 try{await google.patch(ref.calendar_id,ref.id,{description:after},{ifMatch:ref.etag,sendUpdates:'none'});}
 catch(error){await journal.mark(op.id,error.status===412?'precondition_failed':'unknown');throw fail(error.status===412?'予定が変更されました':'保存結果が不明です。再送せず照合してください',error.status===412?'CALENDAR_ETAG_CONFLICT':'CALENDAR_WRITE_UNKNOWN',error.status===412?409:503);}
 const fresh=await google.read(ref.calendar_id,ref.id).catch(()=>null);
 if(!fresh||fresh.description!==after||!sameLessonEvent({...lessonEventRef(fresh,ref.calendar_id),etag:ref.etag},ref)){
  await journal.mark(op.id,'unknown');throw fail('保存後の照合が必要です。入力を保持してください','CALENDAR_WRITE_UNKNOWN',503);
 }
 const result=await journal.finalizeRecord(op.id,{etag:fresh.etag,description:fresh.description},{...values,...(patch.completed===undefined?{}:{completed:patch.completed})});
 return {...result,...values,target:lessonEventRef(fresh,ref.calendar_id),record_storage:'calendar',initialized:initializeOnly};
}

export async function reconcileCalendarLessonRecord(env,target,deps){
 const settings=await deps.settings();if(!settings.selected_calendars?.includes(target?.calendar_id))throw fail('選択中の授業を指定してください');
 const journal=calendarLessonJournal(env),row=await env.DB.prepare("SELECT id FROM calendar_lesson_migration WHERE event_id=? AND calendar_id=? AND status IN ('reserved','dispatching','unknown') LIMIT 1").bind(target.id,target.calendar_id).first();
 if(!row)return {reconciled:false};
 const operation=await journal.read(row.id);if(operation.status==='reserved')throw fail('処理中の可能性があります。再送せず時間をおいて確認してください');
 const google=deps.calendar||calendarLessonGoogle({accessToken:(await deps.token()).access_token});
 const event=await google.read(target.calendar_id,target.id);
 if(!event||!event.etag||event.description!==operation.after_description||!sameLessonEvent({...lessonEventRef(event,target.calendar_id),etag:operation.ref.etag},operation.ref))throw fail('保存結果をまだ確定できません。自動再送は行いません','CALENDAR_WRITE_UNKNOWN',503);
 const proof={etag:event.etag,description:event.description};
 const record=operation.record_after?await journal.finalizeRecord(operation.id,proof,operation.record_after):await journal.mark(operation.id,'verified',proof);
 return {...record,reconciled:true,target:lessonEventRef(event,target.calendar_id)};
}
