import { NEXT_LESSON_DAYS, lessonEventRef, sameLessonEvent, findNextLesson } from "../../shared/lesson-plan.js";

const failure = (status, message, code, current) => Object.assign(new Error(message), { status, code, current });
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
async function planValue(env, id) {
  const row = await env.DB.prepare("SELECT lesson_plan FROM curriculum_entries WHERE calendar_event_id = ?").bind(id).first();
  return row?.lesson_plan || "";
}
export async function readLessonPlan(env, calendarId, eventId, deps) {
  const context = await lookup(deps, calendarId, eventId);
  await uniqueRecordId(deps, context, context.ref);
  return { target: context.ref, lesson_plan: await planValue(env, eventId) };
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
  return { source, ...result, search_end: searchEnd, lesson_plan: await planValue(env, result.target.id) };
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
  // One conditional statement updates only lesson_plan; other curriculum fields are untouched.
  const saved = await env.DB.prepare(`INSERT INTO curriculum_entries (calendar_event_id, lesson_plan, updated_at)
    SELECT ?, ?, datetime('now') WHERE ? = '' OR EXISTS (SELECT 1 FROM curriculum_entries WHERE calendar_event_id = ?)
    ON CONFLICT(calendar_event_id) DO UPDATE SET lesson_plan = excluded.lesson_plan, updated_at = excluded.updated_at
    WHERE COALESCE(curriculum_entries.lesson_plan, '') = ? RETURNING *`)
    .bind(eventId, body.lesson_plan || null, body.expected_lesson_plan, eventId, body.expected_lesson_plan).first();
  if (!saved) {
    current.lesson_plan = await planValue(env, eventId);
    throw failure(409, "授業予定が他の画面で変更されています。入力を残して保存を停止しました", "LESSON_PLAN_CONFLICT", current);
  }
  return saved;
}
