// School-specific display settings. Existing lesson/calendar records are never rewritten.
const KEY = 'lesson_period_profiles';
const SCHOOLS = ['tomas', 'daikanyama', 'shukutoku_yono'];
const MODES = ['label', 'time', 'both'];
const fail = (status, message) => Object.assign(new Error(message), {status});
function objectWithKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function text(value, max) {
  return typeof value === 'string' && value.length > 0 && value.length <= max &&
    value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
}
export function validatePeriodProfiles(input) {
  if (!objectWithKeys(input, ['revision', 'common_mode', 'schools']) ||
      !Number.isSafeInteger(input.revision) || input.revision < 0 || input.revision >= Number.MAX_SAFE_INTEGER ||
      !['legacy', ...MODES].includes(input.common_mode) || !objectWithKeys(input.schools, SCHOOLS)) {
    throw fail(400, '時限設定の形式を確認してください。');
  }
  const calendarIds = new Set();
  const schools = {};
  for (const name of SCHOOLS) {
    const school = input.schools[name];
    if (!objectWithKeys(school, ['mode', 'calendar_ids', 'periods']) || !MODES.includes(school.mode) ||
        !Array.isArray(school.calendar_ids) || school.calendar_ids.length > 100 ||
        !Array.isArray(school.periods) || school.periods.length > 48) {
      throw fail(400, '学校別の時限設定を確認してください。');
    }
    for (const id of school.calendar_ids) {
      if (!text(id, 512) || calendarIds.has(id)) throw fail(400, 'カレンダーは重複せず一つの学校に割り当ててください。');
      calendarIds.add(id);
    }
    const starts = new Set();
    for (const period of school.periods) {
      if (!objectWithKeys(period, ['label', 'start_time']) || !text(period.label, 40) ||
          typeof period.start_time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(period.start_time) ||
          starts.has(period.start_time)) throw fail(400, '時限名と重複のない開始時刻（HH:mm）を確認してください。');
      starts.add(period.start_time);
    }
    schools[name] = {mode: school.mode, calendar_ids: [...school.calendar_ids],
      periods: school.periods.map(({label, start_time}) => ({label, start_time}))};
  }
  return {revision: input.revision, common_mode: input.common_mode, schools};
}
export async function writePeriodProfiles(env, input) {
  const config = validatePeriodProfiles(input);
  const previous = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(KEY).first();
  let revision = 0;
  if (previous) {
    try {
      const saved = validatePeriodProfiles(JSON.parse(previous.value));
      if (saved.revision < 1) throw new Error('invalid stored revision');
      revision = saved.revision;
    } catch {
      throw fail(409, '保存済みの時限設定を確認できません。再読み込みしてください。');
    }
  }
  if (config.revision !== revision) throw fail(409, '時限設定が更新されています。再読み込みしてください。');
  config.revision++;
  const value = JSON.stringify(config);
  // The exact previous bytes fence a racing write, including legacy writers.
  // RETURNING acknowledges this write without a racy post-write read.
  const saved = previous
    ? await env.DB.prepare('UPDATE settings SET value = ? WHERE key = ? AND value = ? RETURNING value')
      .bind(value, KEY, previous.value).first()
    : await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING RETURNING value')
      .bind(KEY, value).first();
  if (!saved) throw fail(409, '時限設定が更新されています。再読み込みしてください。');
  return {lesson_period_profiles: config};
}
export async function handlePeriodProfiles(request, env, browserSession) {
  if (!browserSession || ['aud', 'scope', 'fid'].some(key => Object.hasOwn(browserSession, key))) {
    throw fail(401, 'browser session required');
  }
  if (request.method !== 'PUT') throw fail(405, 'method not allowed');
  if (!env.ALLOWED_ORIGIN || request.headers.get('Origin') !== env.ALLOWED_ORIGIN ||
      request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw fail(403, 'same-origin JSON required');
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > 131072) throw fail(413, 'input too large');
  let input;
  try { input = JSON.parse(raw); } catch { throw fail(400, 'invalid JSON'); }
  return writePeriodProfiles(env, input);
}
