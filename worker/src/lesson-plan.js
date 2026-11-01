import { rawRecord, currentRecord, requireCurrent, prepareRecordWrite, commitRecords, readCommittedRecord, observeRecord } from './lesson-attribution.js';
import { NEXT_LESSON_DAYS, lessonEventRef, sameLessonEvent, findNextLesson, isScheduledLesson } from "../../shared/lesson-plan.js";
import {calendarRecordEligible,overlayCalendarLessonRecord,writeCalendarLessonRecord,calendarRecordsEnabled,loadCalendarStorageState} from './calendar-lesson-records.js';
import {lessonTitleKey} from '../../shared/lesson-attribution.js';
import {calendarRecordValues} from '../../shared/calendar-lesson-record.mjs';
import {ownerHistoryActive,readEventOwnerRecord,writeEventOwnerRecord,writePendingLessonPlan} from './lesson-owner-history.js';

// A stale write may refer to a different ownership generation, even with an identical title.
// Conflict responses identify the fresh target but never return another generation's plan.
const failure = (status, message, code, current) => Object.assign(new Error(message), {
  status, code, current: current ? {...current,lesson_plan:"",record_requires_reload:true} : undefined,
});
function identifiers(calendarId, eventId) {
  if (typeof calendarId !== "string" || !calendarId || calendarId.length > 2048
    || typeof eventId !== "string" || !eventId || eventId.length > 1024) {
    throw failure(400, "calendar_id と event_id が必要です");
  }
}
async function lookup(deps, calendarId, eventId) {
  identifiers(calendarId, eventId);
  const settings = await deps.settings();
  if (!settings.selected_calendars?.includes(calendarId)) throw failure(403, "選択されていないカレンダーです");
  const token = (await deps.token()).access_token;
  const event = await deps.event(token, calendarId, eventId);
  if (!event || event.status === "cancelled") throw failure(409, "予定が削除・キャンセルされています", "LESSON_TARGET_CHANGED");
  return { settings, token, event, ref: lessonEventRef(event, calendarId) };
}
async function uniqueRecordId(deps, context, ref) {
  // Legacy curriculum entries use event ID alone. Refuse a known cross-calendar collision.
  const others = [...new Set(context.settings.selected_calendars)].filter((id) => id !== ref.calendar_id);
  const copies = await Promise.all(others.map((id) => deps.event(context.token, id, ref.id)));
  if (copies.some((event) => event && event.status !== "cancelled")) {
    throw failure(409, "複数カレンダーに同じ予定IDがあります。安全に連動できません", "LESSON_ID_COLLISION");
  }
}
async function planRecord(env, ref, event) {
  if(ownerHistoryActive(env))return readEventOwnerRecord(env,ref,event);
  const row=await loadCalendarStorageState(env,currentRecord(await observeRecord(env,ref),ref),ref);
  return event?overlayCalendarLessonRecord(env,row,{...event,calendar_id:ref.calendar_id}):row;
}
export async function readLessonPlan(env, calendarId, eventId, deps) {
  const context = await lookup(deps, calendarId, eventId);
  if(!ownerHistoryActive(env))await uniqueRecordId(deps, context, context.ref);
  const record = await planRecord(env, context.ref,context.event);
  return { target: context.ref, lesson_plan: record.lesson_plan || "", attribution_status: record.attribution_status, attribution_notice:record.attribution_notice || null, record_revision: record.record_revision,record_pending_operation:record.record_pending_operation,record_storage:record.pending_allowed?'d1_pending':record.record_storage,pending_context:record.pending_context,pending_allowed:record.pending_allowed,pending_storage_available:record.pending_storage_available };
}
export async function readNextLessonPlan(env, calendarId, eventId, deps) {
  const context = await lookup(deps, calendarId, eventId);
  const source = context.ref;
  const validTime = Number.isFinite(Date.parse(source.end));
  const searchEnd = validTime ? new Date(Date.parse(source.end) + NEXT_LESSON_DAYS * 86400000).toISOString() : null;
  // Do not turn an all-day/administrative/cancelled slot into a lesson series.
  const eligibility = findNextLesson(source, [], context.settings.excluded_titles || []);
  if (eligibility.reason === "ineligible") return { source, ...eligibility, search_end: searchEnd, lesson_plan: "" };
  if(ownerHistoryActive(env)){
    const record=await readEventOwnerRecord(env,source,context.event);
    const base={source,source_owner_id:record.owner_id||null,search_end:searchEnd,template_initialization_available:false};
    if(record.attribution_status!=='confirmed')return {...base,target:null,reason:'owner_unassigned',lesson_plan:''};
    const events=await deps.events(context.token,calendarId,source.start,searchEnd);
    // One binding read avoids per-event D1 reads for a whole year of unrelated lessons.
    const {results:bindings}=await env.DB.prepare('SELECT l.event_id,r.owner_id FROM lesson_event_links l LEFT JOIN lesson_history_records r ON r.id=l.record_id WHERE l.calendar_id=?').bind(calendarId).all();
    const owners=new Map(bindings.map(link=>[link.event_id,link.owner_id]));
    const candidates=events.map(event=>({event,ref:lessonEventRef(event,calendarId)}))
      .filter(({ref})=>ref.id!==source.id&&isScheduledLesson(ref,context.settings.excluded_titles||[])&&Date.parse(ref.start)>=Date.parse(source.end))
      .filter(({ref})=>owners.get(ref.id)?owners.get(ref.id)===record.owner_id:lessonTitleKey(ref.title)===lessonTitleKey(source.title))
      .sort((a,b)=>Date.parse(a.ref.start)-Date.parse(b.ref.start));
    if(!candidates.length||candidates[1]&&Date.parse(candidates[1].ref.start)===Date.parse(candidates[0].ref.start))return {...base,target:null,reason:candidates.length?'ambiguous':'none',lesson_plan:''};
    const chosen=candidates[0],next=await readEventOwnerRecord(env,chosen.ref,chosen.event);
    if(next.attribution_status==='confirmed'&&next.owner_id===record.owner_id)return {...base,target:chosen.ref,...next};
    // Schedule discovery is not an ownership decision. Never expose/copy a candidate's record.
    return {...base,target:chosen.ref,reason:'owner_confirmation_required',owner_confirmation_required:true,owner_id:null,attribution_status:next.attribution_status,lesson_plan:next.pending_allowed?next.lesson_plan||'':'',record_revision:next.record_revision,pending_context:next.pending_context,pending_allowed:next.pending_allowed,pending_storage_available:next.pending_storage_available};
  }
  const events=await deps.events(context.token,calendarId,source.start,searchEnd);
  const result = findNextLesson(source, events, context.settings.excluded_titles || []);
  if (!result.target) return { source, ...result, search_end: searchEnd, lesson_plan: "" };
  await uniqueRecordId(deps, context, result.target);
  const targetEvent=calendarRecordsEnabled(env)?await deps.event(context.token,calendarId,result.target.id):null;
  if(calendarRecordsEnabled(env)&&!targetEvent)throw failure(409,'次回予定が削除されました','LESSON_TARGET_CHANGED');
  if(targetEvent&&!sameLessonEvent(lessonEventRef(targetEvent,calendarId),result.target))throw failure(409,'次回予定が取得中に変更されました','LESSON_TARGET_CHANGED');
  const record = await planRecord(env, result.target,targetEvent);
  const templateAvailable=!!targetEvent&&calendarRecordEligible(env,{...targetEvent,calendar_id:calendarId})&&!(targetEvent.description||'').trim()
    &&['new','confirmed'].includes(record.attribution_status)&&!record.record_pending_operation&&!Object.values(calendarRecordValues(record)).some(value=>value.trim());
  return { source, ...result, search_end: searchEnd, lesson_plan: record.lesson_plan || "", attribution_status: record.attribution_status, attribution_notice:record.attribution_notice || null, record_revision: record.record_revision,record_pending_operation:record.record_pending_operation,record_storage:record.record_storage,template_initialization_available:templateAvailable };
}
export async function writeLessonPlan(env, body, deps) {
  if(env.LESSON_HISTORY_MODE==='reconcile')throw failure(409,'D1移行の照合中です。授業内容の編集を一時停止しています');
  if (!body || typeof body.lesson_plan !== "string" || body.lesson_plan.length > 5000
    || typeof body.expected_lesson_plan !== "string" || body.expected_lesson_plan.length > 100000
    || !body.target || typeof body.target !== "object") throw failure(400, "授業予定と取得時の内容が必要です");
  const { calendar_id: calendarId, id: eventId } = body.target;
  identifiers(calendarId, eventId);
  let current;
  if (body.source) {
    identifiers(body.source.calendar_id, body.source.id);
    if (body.source.calendar_id !== calendarId) throw failure(400, "異なるカレンダーには連動できません");
    current = await readNextLessonPlan(env, calendarId, body.source.id, deps);
    if (!sameLessonEvent(current.source, body.source) || !sameLessonEvent(current.target, body.target)) {
      throw failure(409, "次回の授業が変更されました。入力を残して保存を停止しました", "LESSON_TARGET_CHANGED", current);
    }
    if(Object.hasOwn(body,'expected_source_owner_id')&&body.expected_source_owner_id!==current.source_owner_id)throw failure(409,'元の授業の所有者が変更されました。入力を保持してください','LESSON_TARGET_CHANGED');
    // Verify the selected event directly after listing; a stale list cannot redirect this write.
    const verified = await lookup(deps, calendarId, eventId);
    if (!sameLessonEvent(verified.ref, current.target)) {
      throw failure(409, "連動先が変更されました。予定を再確認してください", "LESSON_TARGET_CHANGED");
    }
    const verifiedSource = await lookup(deps, calendarId, body.source.id);
    if (!sameLessonEvent(verifiedSource.ref, current.source)) {
      throw failure(409, "元の授業が変更されました。予定を再確認してください", "LESSON_TARGET_CHANGED");
    }
  } else {
    current = await readLessonPlan(env, calendarId, eventId, deps);
    if (!sameLessonEvent(current.target, body.target)) {
      throw failure(409, "授業日時や予定名が変更されました。再読み込みしてください", "LESSON_TARGET_CHANGED", current);
    }
  }
  if(ownerHistoryActive(env)&&body.pending_context)return writePendingLessonPlan(env,body,deps);
  if(ownerHistoryActive(env))return writeEventOwnerRecord(env,{target:body.target,patch:{lesson_plan:body.lesson_plan},record_revision:body.record_revision,expectedLessonPlan:body.expected_lesson_plan,request_id:body.request_id},deps);
  if(calendarRecordsEnabled(env))return writeCalendarLessonRecord(env,{target:body.target,patch:{lesson_plan:body.lesson_plan},recordRevision:body.record_revision,expectedLessonPlan:body.expected_lesson_plan},deps);
  const row = await rawRecord(env, eventId);
  requireCurrent(row, body.target);
  if (!Number.isSafeInteger(body.record_revision) || body.record_revision !== row.record_revision || (row.lesson_plan || "") !== body.expected_lesson_plan) {
    throw failure(409, "授業予定が他の画面で変更されています。入力を残して保存を停止しました", "LESSON_PLAN_CONFLICT", current);
  }
  let prepared;
  try {
    prepared=await prepareRecordWrite(env,body.target,{lesson_plan:body.lesson_plan},row.record_revision);
    await commitRecords(env,prepared.statements);
  } catch(error) {
    if (error.code === 'LESSON_RECORD_CONFLICT') throw failure(409, error.message, 'LESSON_PLAN_CONFLICT');
    throw error;
  }
  return readCommittedRecord(env,body.target,prepared);
}
