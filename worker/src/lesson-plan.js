import { rawRecord, currentRecord, requireCurrent, prepareRecordWrite, commitRecords, readCommittedRecord, observeRecord } from './lesson-attribution.js';
import { NEXT_LESSON_DAYS, lessonEventRef, sameLessonEvent, findNextLesson } from "../../shared/lesson-plan.js";
import {calendarRecordEligible,overlayCalendarLessonRecord,writeCalendarLessonRecord,calendarRecordsEnabled,loadCalendarStorageState} from './calendar-lesson-records.js';

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
  const row=await loadCalendarStorageState(env,currentRecord(await observeRecord(env,ref),ref),ref);
  return event?overlayCalendarLessonRecord(env,row,{...event,calendar_id:ref.calendar_id}):row;
}
export async function readLessonPlan(env, calendarId, eventId, deps) {
  const context = await lookup(deps, calendarId, eventId);
  await uniqueRecordId(deps, context, context.ref);
  const record = await planRecord(env, context.ref,context.event);
  return { target: context.ref, lesson_plan: record.lesson_plan || "", attribution_status: record.attribution_status, attribution_notice:record.attribution_notice || null, record_revision: record.record_revision,record_pending_operation:record.record_pending_operation,record_storage:record.record_storage };
}
export async function readNextLessonPlan(env, calendarId, eventId, deps) {
  const context = await lookup(deps, calendarId, eventId);
  const source = context.ref;
  const validTime = Number.isFinite(Date.parse(source.end));
  const searchEnd = validTime ? new Date(Date.parse(source.end) + NEXT_LESSON_DAYS * 86400000).toISOString() : null;
  // Do not turn an all-day/administrative/cancelled slot into a lesson series.
  const eligibility = findNextLesson(source, [], context.settings.excluded_titles || []);
  if (eligibility.reason === "ineligible") return { source, ...eligibility, search_end: searchEnd, lesson_plan: "" };
  const events = await deps.events(context.token, calendarId, source.start, searchEnd);
  const result = findNextLesson(source, events, context.settings.excluded_titles || []);
  if (!result.target) return { source, ...result, search_end: searchEnd, lesson_plan: "" };
  await uniqueRecordId(deps, context, result.target);
  const targetEvent=calendarRecordsEnabled(env)?await deps.event(context.token,calendarId,result.target.id):null;
  if(calendarRecordsEnabled(env)&&!targetEvent)throw failure(409,'次回予定が削除されました','LESSON_TARGET_CHANGED');
  if(targetEvent&&!sameLessonEvent(lessonEventRef(targetEvent,calendarId),result.target))throw failure(409,'次回予定が取得中に変更されました','LESSON_TARGET_CHANGED');
  const record = await planRecord(env, result.target,targetEvent);
  return { source, ...result, search_end: searchEnd, lesson_plan: record.lesson_plan || "", attribution_status: record.attribution_status, attribution_notice:record.attribution_notice || null, record_revision: record.record_revision,record_pending_operation:record.record_pending_operation,record_storage:record.record_storage,template_initialization_available:targetEvent&&calendarRecordEligible(env,{...targetEvent,calendar_id:calendarId})&&!(targetEvent.description||'').trim() };
}
export async function writeLessonPlan(env, body, deps) {
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
