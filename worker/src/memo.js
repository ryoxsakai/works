const failure = (status, message) => Object.assign(new Error(message), { status });
export async function readMemo(env) {
  const row = await env.DB.prepare('SELECT data, revision FROM memo_state WHERE id = 1').first();
  return row ? { ...JSON.parse(row.data), revision: row.revision } : { memos: [], categories: ['日常', '仕事', 'アイデア'], revision: 0 };
}
export function validateMemo(state) {
  const text = (v, max) => typeof v === 'string' && v.length <= max;
  const strings = (v, count, max) => Array.isArray(v) && v.length <= count && v.every(s => text(s, max));
  const date = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (!state || !Array.isArray(state.memos) || state.memos.length > 10000 ||
      !strings(state.categories, 200, 100) || state.categories.some(c => !c.trim() || c === 'すべて') ||
      new Set(state.categories).size !== state.categories.length ||
      new Set(state.memos.map(m => m?.id)).size !== state.memos.length ||
      !Number.isSafeInteger(state.revision) || state.revision < 0 ||
      state.memos.some(m => !m || !text(m.id, 100) || !m.id || !text(m.title, 500) || !m.title.trim() ||
        !text(m.category, 100) || (m.category !== '' && !state.categories.includes(m.category)) ||
        !strings(m.bodies, 100, 100000) || m.bodies.length === 0 || !strings(m.notes, 100, 10000) ||
        !strings(m.tags, 100, 100) || !date(m.createdAt) || !date(m.updatedAt))) throw failure(400, 'メモの入力形式が不正です');
  if (new TextEncoder().encode(JSON.stringify(state)).length > 2000000) throw failure(413, 'メモの保存容量上限を超えています');
}
export async function writeMemo(env, state) {
  validateMemo(state);
  const data = JSON.stringify({ memos: state.memos, categories: state.categories });
  const result = state.revision === 0
    ? await env.DB.prepare('INSERT OR IGNORE INTO memo_state (id, data, revision) VALUES (1, ?, 1)').bind(data).run()
    : await env.DB.prepare('UPDATE memo_state SET data = ?, revision = revision + 1 WHERE id = 1 AND revision = ?').bind(data, state.revision).run();
  if (!result.meta.changes) throw failure(409, '別の画面で変更されています。再読み込みが必要です');
  return { memos: state.memos, categories: state.categories, revision: state.revision + 1 };
}
export async function handleMemo(request, env, headers) {
  let data;
  if (request.method === 'GET') data = await readMemo(env);
  else if (request.method === 'PUT') {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 2000000) throw failure(413, 'メモの保存容量上限を超えています');
    data = await writeMemo(env, JSON.parse(raw));
  } else return new Response(null, { status: 405, headers: { ...headers, Allow: 'GET, PUT' } });
  return new Response(JSON.stringify(data), { headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
