// Comparison values never establish the owner of legacy content.
import {sameLessonEvent} from './lesson-plan.js';
export const LESSON_BASELINE_DATE = '2026-10-27';
export const lessonTitleKey = value => String(value || '').normalize('NFKC').replace(/\s+/g,' ').trim();
export function lessonRecordHasContent(row) {
  return Boolean(row?.completed) || ['lesson_plan','confirmation_test','homework','lesson_memo']
    .some(field => String(row?.[field] ?? '').trim().length > 0);
}
export function lessonDate(ref) {
  const start = ref.start?.dateTime ?? ref.start?.date ?? ref.start;
  if (/^\d{4}-\d{2}-\d{2}$/.test(start || '')) return start;
  const time = Date.parse(start);
  return Number.isFinite(time) ? new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(time) : null;
}
export function attributedLessonRecord(row, ref) {
  if(row?.record_storage==='d1_owner'||row?.attribution_status==='owner_unassigned'){
    if(!row.record_read_target||!sameLessonEvent(row.record_read_target,ref))return {calendar_event_id:ref.id,record_storage:'d1_owner',record_read_target:ref,record_revision:0,attribution_status:'target_unavailable',record_target_unavailable:true,record_requires_reload:true,completed:0,lesson_plan:null,confirmation_test:null,homework:null,lesson_memo:null};
    return row;
  }
  if (!row?.record_hold_active && !row?.record_collision && !row?.record_target_unavailable && (!row?.record_exists || !lessonRecordHasContent(row))) return {...row,record_revision:row?.record_revision || 0,attribution_status:'new'};
  const sameId = row.calendar_event_id === ref.id;
  const matches = (calendar,title) => sameId && calendar === ref.calendar_id && title != null && lessonTitleKey(title) === lessonTitleKey(ref.title);
  let reason;
  if (row.record_target_unavailable) reason='target_unavailable';
  else if (row.record_collision) reason='id_collision';
  else if (row.record_hold_active) reason='known_change';
  else if (row.record_title != null) {
    if (matches(row.record_calendar_id,row.record_title)) return {...row,attribution_status:'confirmed'};
    reason='title_changed';
  } else if (row.record_observed_title != null) {
    if (matches(row.record_observed_calendar_id,row.record_observed_title)) return {...row,attribution_status:'legacy_unverified',attribution_notice:'旧記録・所属未確認。比較用の予定名は生徒の所属を証明しません。'};
    reason='title_changed';
  } else if (sameId) {
    const historical = lessonDate(ref) && lessonDate(ref) < (row.record_effective_date || LESSON_BASELINE_DATE);
    return {...row,attribution_status:historical?'legacy_historical':'legacy_unverified',attribution_notice:'旧記録・所属未確認。過去の保存時の生徒名は不明です。'};
  } else reason='title_changed';
  return {calendar_event_id:row.calendar_event_id,record_exists:Boolean(row.record_exists),record_calendar_id:row.record_calendar_id,
    record_title:row.record_title,record_observed_calendar_id:row.record_observed_calendar_id,record_observed_title:row.record_observed_title,
    record_observed_at:row.record_observed_at,record_hold_active:row.record_hold_active,record_revision:row.record_revision || 0,record_pending_operation:row.record_pending_operation,
    attribution_status:reason,attribution_notice:'予定名の対応確認が必要なため、旧記録を現在の内容として表示していません。',completed:0,
    lesson_plan:null,confirmation_test:null,homework:null,lesson_memo:null};
}
export const lessonRecordNeedsReview = row => ['excluded','event_recreated','owner_unassigned','legacy_unknown','known_change','title_changed','id_collision','target_unavailable'].includes(row?.attribution_status);
