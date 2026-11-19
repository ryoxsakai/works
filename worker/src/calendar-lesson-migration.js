import {lessonDate,lessonTitleKey,attributedLessonRecord,lessonRecordHasContent} from '../../shared/lesson-attribution.js';
import {lessonEventRef,isScheduledLesson,sameLessonEvent} from '../../shared/lesson-plan.js';
import {CALENDAR_RECORD_FROM,calendarRecordValues,parseCalendarRecord,parsePlainCalendarRecord,plainCalendarRecordLayout,sameCalendarRecordBinding} from '../../shared/calendar-lesson-record.mjs';

const problem=(code,message,status=409)=>Object.assign(new Error(message),{status,code});
const block=(reason)=>({status:'held',reason});
const equalValues=(a,b)=>JSON.stringify(calendarRecordValues(a))===JSON.stringify(calendarRecordValues(b));
export const calendarWriteRejected=error=>[400,401,403,404,410,412,422,429].includes(error?.status);
export function recordBinding(row,ref){return {calendar_id:ref.calendar_id,event_id:ref.id,title:lessonTitleKey(ref.title),generation:row.record_generation};}

// ACL input must come from a trusted, complete server-side lookup. It is never
// accepted as an assertion from a browser mutation body or stored layout data.
export function calendarRecordPrivacy(event,privacy,ownerEmail){
 // Explicit owner attestation is a separate evidence type, not fabricated ACL.
 // It is provisioned privately by the release operator for exact calendar IDs.
 if(typeof ownerEmail==='string'&&ownerEmail&&privacy?.basis==='owner_attested'&&privacy.approved===true&&privacy.calendar_id===event.calendar_id&&privacy.accessRole==='owner'&&privacy.ownerEmail?.toLowerCase()===ownerEmail.toLowerCase()){
  if(event.attendeesOmitted||event.attendees?.some(a=>!a.self))return block('event_guests');
  if(event.locked||event.privateCopy||event.organizer?.self!==true)return block('event_not_owned');
  return {status:'safe',basis:'owner_attested'};
 }
 if(!ownerEmail||privacy?.complete!==true||privacy.calendar_id!==event.calendar_id||!Array.isArray(privacy.rules))return block('sharing_unverified');
 if(privacy.accessRole!=='owner')return block('not_calendar_owner');
 if(event.attendeesOmitted||event.attendees?.some(a=>!a.self))return block('event_guests');
 if(event.locked||event.privateCopy||event.organizer?.self!==true)return block('event_not_owned');
 const owner=ownerEmail.toLowerCase();
 if(privacy.rules.some(rule=>rule.role!=='none'&&rule.role!=='freeBusyReader'&&!(rule.scope?.type==='user'&&String(rule.scope.value).toLowerCase()===owner)))return block('shared_calendar_details');
 if(!privacy.rules.some(rule=>rule.role==='owner'&&rule.scope?.type==='user'&&String(rule.scope.value).toLowerCase()===owner))return block('owner_rule_missing');
 return {status:'safe'};
}

// Pure dry-run planner: does not initialize attribution, write DB or contact
// Calendar. Unknown legacy ownership is preserved, never silently verified.
export function planCalendarRecordMigration({row,event,privacy,ownerEmail,collision=false,excluded=[],replaceExistingDescription=false}){
 if(!event)return block('event_missing');
 const ref=lessonEventRef(event,event.calendar_id),date=lessonDate(ref);
 if(!date)return block('invalid_event_date');
 if(date<CALENDAR_RECORD_FROM)return {status:'historical',reason:'before_cutoff'};
 if(collision)return block('event_id_collision');
 if(!isScheduledLesson(ref,excluded)||event.recurrence||event.id===event.recurringEventId)return block('not_individual_lesson');
 if(!event.etag)return block('etag_missing');
 if(!Object.values(calendarRecordValues(row)).some(value=>value.trim()))return {status:'empty',reason:'no_text_to_export'};
 const attributed=attributedLessonRecord(row,ref);
 // Export is a new disclosure boundary. An unverified baseline is not ownership.
 if(attributed.attribution_status!=='confirmed')return block('attribution_'+attributed.attribution_status);
 if(!Number.isSafeInteger(row.record_revision)||!Number.isSafeInteger(row.record_generation))return block('record_version_missing');
 const privacyResult=calendarRecordPrivacy(event,privacy,ownerEmail);if(privacyResult.status!=='safe')return privacyResult;
 const binding=recordBinding(row,ref),description=event.description||'';
 try{
  const parsed=parseCalendarRecord(description)||(row.record_calendar_managed?parsePlainCalendarRecord(description,binding,{prefix:row.record_calendar_prefix||'',suffix:row.record_calendar_suffix||'',allowPrefixEdit:true}):null);
  if(replaceExistingDescription){
   if(parsed)return block('managed_description_requires_editor');
   if(!description.trim())return block('replacement_description_is_empty');
   return {status:'ready',mode:'replace_unmanaged_description',ref,binding,record_revision:row.record_revision,before_description:description,...plainCalendarRecordLayout('',row,binding),values:calendarRecordValues(row)};
  }
  if(parsed&&!sameCalendarRecordBinding(binding,parsed.binding))return block('managed_binding_conflict');
  if(parsed&&!equalValues(parsed.values,row))return block('calendar_db_content_conflict');
  if(parsed)return {status:'already_present',ref,binding,record_revision:row.record_revision,description};
  if(!lessonRecordHasContent(row)||!Object.values(calendarRecordValues(row)).some(value=>value.trim()))return {status:'empty',reason:'no_text_to_export'};
  return {status:'ready',ref,binding,record_revision:row.record_revision,before_description:description,...plainCalendarRecordLayout(description,row,binding),values:calendarRecordValues(row)};
 }catch(error){return block(error.code||'description_conflict');}
}

// Formatting-only migration of an already verified individual record. Calendar
// values are authoritative; D1 lesson text and revision are never rewritten.
export function planCalendarRecordTagRemoval({row,event,privacy,ownerEmail,excluded=[]}){
 if(!event)return block('event_missing');
 const ref=lessonEventRef(event,event.calendar_id),date=lessonDate(ref);
 if(!date||date<CALENDAR_RECORD_FROM)return {status:'historical',reason:'before_cutoff'};
 if(!isScheduledLesson(ref,excluded)||event.recurrence||event.id===event.recurringEventId)return block('not_individual_lesson');
 if(!event.etag)return block('etag_missing');
 if(!row.record_calendar_managed||row.record_pending_operation||attributedLessonRecord(row,ref).attribution_status!=='confirmed')return block('verified_storage_required');
 const safety=calendarRecordPrivacy(event,privacy,ownerEmail);if(safety.status!=='safe')return safety;
 const binding=recordBinding(row,ref),description=event.description||'';
 try{
  const parsed=parseCalendarRecord(description)||parsePlainCalendarRecord(description,binding,{prefix:row.record_calendar_prefix||'',suffix:row.record_calendar_suffix||'',allowPrefixEdit:true});
  if(!parsed||!sameCalendarRecordBinding(parsed.binding,binding))return block('managed_binding_conflict');
  const layout=plainCalendarRecordLayout(description,parsed.values,binding,{parsed});
  if(layout.after_description===description)return {status:'already_present',ref,binding,record_revision:row.record_revision,description};
  return {status:'ready',mode:'remove_management_tags',ref,binding,record_revision:row.record_revision,before_description:description,...layout,values:parsed.values};
 }catch(error){return block(error.code||'description_conflict');}
}

// This is an explicit UI-only initialization plan, NOT a side effect of a GET,
// schedule notification or migration scan. Nonempty descriptions are never reset.
export function planCalendarTemplateInitialization({row,event,privacy,ownerEmail,collision=false,excluded=[]}){
 if(!event)return block('event_missing');
 const ref=lessonEventRef(event,event.calendar_id),date=lessonDate(ref);
 if(!date||date<CALENDAR_RECORD_FROM)return {status:'historical',reason:'before_cutoff'};
 if(collision)return block('event_id_collision');
 if(!isScheduledLesson(ref,excluded)||event.recurrence||event.id===event.recurringEventId)return block('not_individual_lesson');
 if(!event.etag)return block('etag_missing');
 if(typeof event.description==='string'&&event.description.trim())return {status:'not_empty',reason:'existing_description_preserved'};
 if(event.description!=null&&typeof event.description!=='string')return block('invalid_description');
 const attributed=attributedLessonRecord(row,ref);
 if(!['new','confirmed'].includes(attributed.attribution_status))return block('attribution_'+attributed.attribution_status);
 if(Object.values(calendarRecordValues(row)).some(value=>value.trim()))return block('db_content_requires_migration');
 if(!Number.isSafeInteger(row.record_revision)||!Number.isSafeInteger(row.record_generation))return block('record_version_missing');
 const safety=calendarRecordPrivacy(event,privacy,ownerEmail);if(safety.status!=='safe')return safety;
 const binding=recordBinding(row,ref),values=calendarRecordValues({}),description=event.description||'';
 return {status:'ready',mode:'initialize_template',ref,binding,record_revision:row.record_revision,before_description:description,...plainCalendarRecordLayout(description,values,binding),values};
}

// The journal adapter must durably and atomically reserve expected record
// revision+generation before dispatch and block other writers until reconciled.
// There is deliberately no automatic PATCH retry or timeout-based unlock.
export async function applyCalendarRecordMigration(plan,{read,privacy,ownerEmail,reserve,mark,patch,readRecord}){
 if(plan?.status!=='ready')throw problem('MIGRATION_NOT_READY','転記可能なdry run対象ではありません');
 const before=await read(plan.ref.calendar_id,plan.ref.id);
 if(!before||!sameLessonEvent(lessonEventRef(before,plan.ref.calendar_id),plan.ref)||String(before.description||'')!==plan.before_description)throw problem('MIGRATION_SNAPSHOT_CHANGED','予定がdry run後に変更されました');
 const row=await readRecord(plan.ref.id);
 const planner=plan.mode==='initialize_template'?planCalendarTemplateInitialization:plan.mode==='remove_management_tags'?planCalendarRecordTagRemoval:planCalendarRecordMigration;
 const checked=planner({row,event:{...before,calendar_id:plan.ref.calendar_id},privacy:await privacy(plan.ref.calendar_id),ownerEmail,replaceExistingDescription:plan.mode==='replace_unmanaged_description'});
 if(checked.status!=='ready'||checked.record_revision!==plan.record_revision||checked.after_description!==plan.after_description||checked.format!==plan.format||checked.managed_prefix!==plan.managed_prefix||checked.managed_suffix!==plan.managed_suffix)throw problem('MIGRATION_PREFLIGHT_CHANGED','転記前の対応・共有範囲・記録が変更されました');
 const operation=await reserve({ref:plan.ref,binding:plan.binding,revision:plan.record_revision,before:structuredClone(before),after_description:plan.after_description,format:plan.format,managed_prefix:plan.managed_prefix,managed_suffix:plan.managed_suffix,...(plan.mode?{mode:plan.mode}:{})});
 if(!operation?.id)throw problem('MIGRATION_JOURNAL_REQUIRED','復元可能な転記履歴の予約が必要です');
 await mark(operation.id,'dispatching');
 try{
  await patch(plan.ref.calendar_id,plan.ref.id,{description:plan.after_description},{ifMatch:plan.ref.etag,sendUpdates:'none'});
 }catch(error){
  const rejected=calendarWriteRejected(error);
  await mark(operation.id,rejected?'precondition_failed':'unknown');
  throw problem(error.status===412?'CALENDAR_ETAG_CONFLICT':rejected?'CALENDAR_WRITE_REJECTED':'CALENDAR_WRITE_UNKNOWN',rejected?`カレンダーが保存を拒否しました (${error.status})。転記は適用されていません`:'転記結果が不明です。同じ要求を再送せず再取得して照合してください',rejected?error.status:503);
 }
 const fresh=await read(plan.ref.calendar_id,plan.ref.id).catch(()=>null);
 const unchanged=a=>{const ref=lessonEventRef(a,plan.ref.calendar_id);return sameLessonEvent({...ref,etag:plan.ref.etag},plan.ref);};
 if(!fresh||!unchanged(fresh)||fresh.description!==plan.after_description){await mark(operation.id,'unknown');throw problem('CALENDAR_WRITE_UNKNOWN','保存応答後の再取得を確認できません。再送を停止しました');}
 // The adapter finalizes only after independently checking the reserved DB
 // version. It retains the original snapshot and never deletes source content.
 await mark(operation.id,'verified',{etag:fresh.etag,description:fresh.description});
 return {status:'verified',operation_id:operation.id,target:lessonEventRef(fresh,plan.ref.calendar_id)};
}

export async function reconcileCalendarRecordMigration(operation,{read,mark}){
 if(!['dispatching','unknown'].includes(operation.status))throw problem('MIGRATION_RECONCILE_STATE','照合対象ではありません');
 const fresh=await read(operation.ref.calendar_id,operation.ref.id);
 if(!fresh)throw problem('MIGRATION_EVENT_MISSING','予定を再取得できません');
 const ref=lessonEventRef(fresh,operation.ref.calendar_id);
 if(!sameLessonEvent({...ref,etag:operation.ref.etag},operation.ref))return block('identity_changed_during_dispatch');
 if(fresh.description===operation.after_description){await mark(operation.id,'verified',{etag:fresh.etag,description:fresh.description});return {status:'verified'};}
 // Seeing the old snapshot does NOT prove an in-flight timed-out request ended.
 // No automatic release or retry even if current ETag still equals the old one.
 return block(fresh.description===(operation.before.description||'')?'outcome_still_unknown':'calendar_changed_after_dispatch');
}
