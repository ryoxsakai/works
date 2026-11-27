import {lessonTitleKey} from './lesson-attribution.js';
import {isScheduledLesson, lessonEventKey, lessonEventRef, sameLessonEvent} from './lesson-plan.js';
import {recordDateRange} from '../tutor/record-date.js';

export function termUsesNumberedPlans(term, modes = {}) {
  const configured=modes?.[term?.id];
  return typeof configured==='boolean' ? configured : /冬[期季]/.test(term?.label || '');
}

export const termPlanKey = slot => JSON.stringify([slot.term_id, slot.calendar_id, slot.title, slot.ordinal]);

// Membership comes from start time in the configured JST term, not event creation
// order or Google Calendar's overlap filter. Event IDs locate today's row only.
export function termLessonPositions(term, events, excluded = []) {
  const positions = new Map(), groups = new Map();
  if (!term?.id) return positions;
  const [lower, upper] = recordDateRange(term.start_date, term.end_date).map(Date.parse);
  for (const event of events) {
    const ref = lessonEventRef(event), start = Date.parse(ref.start);
    if (!isScheduledLesson(ref, excluded) || event.recurrence || start < lower || start >= upper) continue;
    const title = lessonTitleKey(ref.title), group = JSON.stringify([ref.calendar_id, title]);
    if (!groups.has(group)) groups.set(group, {title, items:new Map(), conflict:false});
    const series = groups.get(group), key = lessonEventKey(ref), previous = series.items.get(key);
    if (previous && !sameLessonEvent(previous, ref)) series.conflict = true;
    series.items.set(key, ref);
  }
  for (const {title, items, conflict} of groups.values()) {
    const list = [...items.values()].sort((a,b) => Date.parse(a.start) - Date.parse(b.start));
    if (conflict || list.some((ref,i) => i > 0 && Date.parse(ref.start) < Date.parse(list[i-1].end))) continue;
    for (const [index, ref] of list.entries()) {
      const current = {term_id:Number(term.id), calendar_id:ref.calendar_id, title, ordinal:index+1};
      positions.set(lessonEventKey(ref), {ref,current,next:{...current,ordinal:index+2},nextRef:list[index+1]||null,total:list.length});
    }
  }
  return positions;
}

export function termPosition(positions, event) {
  const ref=lessonEventRef(event), pos=positions.get(lessonEventKey(ref));
  // A move between reading the daily list and reading the term must not show or
  // edit an ordinal against the inconsistent observation.
  return pos && sameLessonEvent(ref,pos.ref) ? pos : null;
}
