// A deliberately exact series identity; classroom and title must both agree.
export const NEXT_LESSON_DAYS = 366;
export const lessonEventKey = (event) => JSON.stringify([event.calendar_id, event.id]);
export function lessonEventRef(event, calendarId = event.calendar_id || event._calendarId) {
  return {
    calendar_id: calendarId, id: event.id, title: event.summary ?? event.title ?? "",
    start: event.start?.dateTime ?? event.start?.date ?? event.start,
    end: event.end?.dateTime ?? event.end?.date ?? event.end,
    etag: event.etag || "", status: event.status || "confirmed",
    timed: event.timed ?? !!event.start?.dateTime,
    event_type: event.eventType || event.event_type || "default",
    transparency: event.transparency || "opaque",
    declined: event.declined ?? !!event.attendees?.some((item) => item.self && item.responseStatus === "declined"),
  };
}
export const sameLessonEvent = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const titleKey = (title) => String(title || "").normalize("NFKC").replace(/\s+/g, " ").trim();
export function isScheduledLesson(event, excluded = []) {
  const ref = lessonEventRef(event);
  const title = titleKey(ref.title);
  return !!ref.id && !!ref.calendar_id && ref.timed && ref.status === "confirmed"
    && ref.event_type === "default" && ref.transparency !== "transparent" && !ref.declined
    && Number.isFinite(Date.parse(ref.start)) && Date.parse(ref.end) > Date.parse(ref.start)
    && !!title && !excluded.some((value) => titleKey(value) === title)
    && !/休講|欠席|キャンセル|中止|休み|会議|教科会|打ち?合[わ]?せ|ミーティング|WT\s*作成|空き|○/i.test(title);
}
export function findNextLesson(source, events, excluded = []) {
  const ref = lessonEventRef(source);
  if (!isScheduledLesson(ref, excluded)) return { target: null, reason: "ineligible" };
  const candidates = events.map((event) => lessonEventRef(event))
    .filter((event) => event.calendar_id === ref.calendar_id && event.id !== ref.id
      && titleKey(event.title) === titleKey(ref.title) && isScheduledLesson(event, excluded)
      && Date.parse(event.start) >= Date.parse(ref.end))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  if (!candidates.length) return { target: null, reason: "none" };
  if (candidates[1] && Date.parse(candidates[0].start) === Date.parse(candidates[1].start)) {
    return { target: null, reason: "ambiguous" };
  }
  return { target: candidates[0], reason: null };
}
