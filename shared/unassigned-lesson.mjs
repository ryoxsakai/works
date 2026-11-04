import {sameLessonEvent} from './lesson-plan.js';

// A read-only event draft is not a student record or evidence of ownership.
export function unassignedLessonDisplay(row, target) {
  if (!row || row.attribution_status !== 'owner_unassigned' || row.record_storage !== 'd1_owner' ||
      row.record_exists !== false || row.calendar_event_id !== target?.id || row.owner_id || !row.record_read_target ||
      !sameLessonEvent(row.record_read_target, target) || row.record_hold_active ||
      row.record_collision || row.record_target_unavailable || row.record_requires_reload ||
      row.record_pending_operation || row.pending_allowed !== true ||
      row.pending_storage_available !== true || typeof row.pending_exists !== 'boolean' ||
      typeof row.pending_context !== 'string' || !row.pending_context ||
      !Number.isSafeInteger(row.record_revision) || (row.pending_exists ? row.record_revision < 1 : row.record_revision !== 0) ||
      row.completed || row.confirmation_test || row.homework || row.lesson_memo ||
      typeof row.lesson_plan !== 'string' || (!row.pending_exists && row.lesson_plan !== '')) return null;
  return {lessonPlan: row.lesson_plan, pendingContext: row.pending_context};
}
