// Works ToDo ⇔ Google ToDo リスト(Google Tasks API)の双方向同期。
//
// - 既存の1分ごとの定期実行(scheduled)に相乗りする。Works 側の変更は毎分、差分があるタスクだけを送る。
//   Google 側の変更は PULL_INTERVAL_MS ごとに、前回以降に更新されたものだけを取りに行く。
// - Google 側は「Works」という1つのリストを使う。プロジェクトはタイトルの先頭に「[プロジェクト] 」として付ける。
// - 期限には作業日(予定日)、なければ締切を入れる(Google 側は日付1つだけ)。
// - 同時に両方で変更された場合は Works 側の内容を優先して送る(Works の変更は1分以内に送るため、実際の衝突はまれ)。
// - Google 側で削除されたタスクは Works では完了にする(元に戻せるように削除はしない)。
// - 役割・チェックリスト・生徒の紐づけ・通知などは Works だけで保持し、Google 側には送らない。
import { statusOf, projectPath } from "../../todo/model.mjs";

const API = "https://tasks.googleapis.com/tasks/v1";
export const GTASKS_LIST_TITLE = "Works";
export const PULL_INTERVAL_MS = 5 * 60000;
const PUSH_LIMIT = 20;
const DONE_WINDOW_MS = 30 * 86400000;
const LEASE_MS = 115000;
// Google 側で削除されたタスクの印(todo_gtasks.gtask に入れる。Google のIDと重ならない)。
const TOMBSTONE = "deleted:";

const schemas = [
  "CREATE TABLE IF NOT EXISTS todo_gtasks (task TEXT PRIMARY KEY, gtask TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL DEFAULT '', remote TEXT NOT NULL DEFAULT '')",
  "CREATE TABLE IF NOT EXISTS todo_gtasks_config (id TEXT PRIMARY KEY, value TEXT NOT NULL)",
];
async function ensure(db) {
  await db.batch(schemas.map((sql) => db.prepare(sql)));
}
const cfg = (db, id) => db.prepare("SELECT value FROM todo_gtasks_config WHERE id=?").bind(id).first("value");
const put = (db, id, value) => db.prepare("INSERT OR REPLACE INTO todo_gtasks_config VALUES (?,?)").bind(id, String(value)).run();
const del = (db, id) => db.prepare("DELETE FROM todo_gtasks_config WHERE id=?").bind(id).run();

export class GoogleTasksError extends Error {}

function permissionMessage(status, text) {
  if (/SERVICE_DISABLED|accessNotConfigured|has not been used|is disabled/i.test(text))
    return "Google Cloud で「Google Tasks API」が有効になっていません。プロジェクトで有効にしてから再試行してください。";
  if (status === 401 || /insufficient|SCOPE/i.test(text))
    return "Google ToDo リストへのアクセス権限がありません。いったんログアウトしてログインし直し、ToDo リストへのアクセスを許可してください。";
  return `Google ToDo リストとの同期に失敗しました (${status})。再試行します。`;
}

async function call(getToken, path, { method = "GET", body, signal } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: "Bearer " + (await getToken()),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  if (res.status === 204) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const error = new GoogleTasksError(permissionMessage(res.status, text));
    error.status = res.status;
    error.permission = res.status === 401 || (res.status === 403 && !/rateLimit|quota/i.test(text));
    throw error;
  }
  return res.json();
}

// --- Works のタスク ⇔ Google のタスク ---

function projectLabel(state, task) {
  const id = task.plan?.project;
  if (!id) return "";
  return projectPath(state.planner?.projects || [], id);
}

export function inScope(task, now) {
  if (statusOf(task) !== "done") return true;
  const completed = Date.parse(task.completedAt || "");
  return Number.isFinite(completed) && completed > now - DONE_WINDOW_MS;
}

export function remoteBody(state, task) {
  const label = projectLabel(state, task);
  const day = task.plannedDay || task.deadline || null;
  return {
    title: (label ? `[${label}] ` : "") + task.name,
    notes: task.memo || "",
    due: day ? `${day}T00:00:00.000Z` : null,
    status: statusOf(task) === "done" ? "completed" : "needsAction",
  };
}
export const fingerprint = (body) => JSON.stringify([body.title, body.notes, body.due, body.status]);

// Google 側の変更を Works のタスクに当てはめる。変更があれば true。
export function applyRemote(state, task, item, now) {
  const before = JSON.stringify(task);
  const label = projectLabel(state, task);
  let title = String(item.title || "").trim();
  if (label && title.startsWith(`[${label}] `)) title = title.slice(label.length + 3).trim();
  if (title) task.name = title.slice(0, 500);
  task.memo = String(item.notes || "").slice(0, 10000);
  const day = typeof item.due === "string" && /^\d{4}-\d\d-\d\d/.test(item.due) ? item.due.slice(0, 10) : null;
  // 期限は、もともと予定日を使っていたなら予定日へ、締切だけのタスクなら締切へ戻す。
  // 時刻や繰り返しは予定日が必須なので、Google 側で期限を外しても予定日は残す(次回の送信で期限が戻る)。
  const needsDay = !!(task.plan?.time || task.plan?.repeat);
  if (task.plannedDay || !task.deadline) {
    if (day || !needsDay) task.plannedDay = day;
  } else task.deadline = day;
  const done = statusOf(task) === "done";
  if (item.status === "completed" && !done) {
    task.status = "done";
    task.progress = 100;
    task.completedAt = item.completed || new Date(now).toISOString();
  } else if (item.status === "needsAction" && done) {
    task.status = "pending";
    task.progress = 0;
    task.completedAt = null;
  }
  return JSON.stringify(task) !== before;
}

function newTaskFromRemote(state, item, now) {
  const created = new Date(now + 9 * 3600000).toISOString().slice(0, 10);
  const task = {
    id: crypto.randomUUID(),
    name: String(item.title || "").trim().slice(0, 500) || "(無題)",
    category: state.categories?.[0] || "その他",
    priority: null,
    deadline: null,
    progress: 0,
    memo: "",
    createdAt: created,
    plannedDay: null,
    status: "pending",
  };
  applyRemote(state, task, item, now);
  return task;
}

// --- 同期本体 ---

async function ensureList(db, getToken, signal) {
  const saved = await cfg(db, "list");
  if (saved) return saved;
  let page = "";
  do {
    const data = await call(getToken, "/users/@me/lists?maxResults=100" + (page ? "&pageToken=" + encodeURIComponent(page) : ""), { signal });
    const found = (data.items || []).find((list) => list.title === GTASKS_LIST_TITLE);
    if (found) {
      await put(db, "list", found.id);
      return found.id;
    }
    page = data.nextPageToken || "";
  } while (page);
  const created = await call(getToken, "/users/@me/lists", { method: "POST", body: { title: GTASKS_LIST_TITLE }, signal });
  await put(db, "list", created.id);
  return created.id;
}

async function listChanges(getToken, list, since, signal) {
  const items = [];
  let page = "";
  do {
    const query = new URLSearchParams({ maxResults: "100", showCompleted: "true", showHidden: "true", showDeleted: "true" });
    if (since) query.set("updatedMin", since);
    if (page) query.set("pageToken", page);
    const data = await call(getToken, `/lists/${encodeURIComponent(list)}/tasks?${query}`, { signal });
    items.push(...(data.items || []));
    page = data.nextPageToken || "";
  } while (page && items.length < 2000);
  return items;
}

async function pull(env, ctx, list, now) {
  const db = env.DB;
  const lastPull = Number((await cfg(db, "lastPull")) || 0);
  if (lastPull && now - lastPull < PULL_INTERVAL_MS) return;
  const since = lastPull ? new Date(lastPull - 120000).toISOString() : null;
  const items = await listChanges(ctx.getToken, list, since, ctx.signal);
  const state = await ctx.read();
  const { results: rows } = await db.prepare("SELECT * FROM todo_gtasks").all();
  const byRemote = new Map(rows.map((row) => [row.gtask, row]));
  const tasks = new Map(state.tasks.map((task) => [task.id, task]));
  const rowUpdates = [], rowTombstones = [], rowInserts = [];
  let changed = false;
  for (const item of items) {
    const row = byRemote.get(item.id);
    if (row) {
      if (item.updated && item.updated === row.remote) continue; // 自分で送った変更
      const task = tasks.get(row.task);
      if (!task) continue; // Works 側で削除済み。送信側で Google からも削除する
      const localChanged = fingerprint(remoteBody(state, task)) !== row.fingerprint;
      if (item.deleted) {
        if (statusOf(task) !== "done") {
          task.status = "done";
          task.progress = 100;
          task.completedAt = new Date(now).toISOString();
          changed = true;
        }
        // Google 側で削除されたことを記録し、Works で未完了に戻すまでは作り直さない。
        rowTombstones.push(row.task);
        continue;
      }
      if (localChanged) continue; // 両方で変更: Works を優先して送信側で上書きする
      if (applyRemote(state, task, item, now)) changed = true;
      rowUpdates.push([fingerprint(remoteBody(state, task)), item.updated || "", row.task]);
    } else {
      // Google 側で新しく追加された未完了タスク(サブタスクは取り込まない)
      if (item.deleted || item.parent || item.status !== "needsAction" || !String(item.title || "").trim()) continue;
      const task = newTaskFromRemote(state, item, now);
      state.tasks.push(task);
      changed = true;
      rowInserts.push([task.id, item.id, fingerprint(remoteBody(state, task)), item.updated || ""]);
    }
  }
  if (changed) await ctx.write(state); // 競合(409)なら例外になり、次回の実行でやり直す
  const statements = [
    ...rowInserts.map((args) => db.prepare("INSERT OR REPLACE INTO todo_gtasks(task,gtask,fingerprint,remote) VALUES (?,?,?,?)").bind(...args)),
    ...rowUpdates.map((args) => db.prepare("UPDATE todo_gtasks SET fingerprint=?, remote=? WHERE task=?").bind(...args)),
    ...rowTombstones.map((task) => db.prepare("UPDATE todo_gtasks SET gtask=?, fingerprint='', remote='' WHERE task=?").bind(TOMBSTONE + task, task)),
    db.prepare("INSERT OR REPLACE INTO todo_gtasks_config VALUES ('lastPull',?)").bind(String(now)),
  ];
  await db.batch(statements);
}

async function push(env, ctx, list, now) {
  const db = env.DB;
  const state = await ctx.read();
  const { results: rows } = await db.prepare("SELECT * FROM todo_gtasks").all();
  const byTask = new Map(rows.map((row) => [row.task, row]));
  const present = new Map(state.tasks.map((task) => [task.id, task]));
  const jobs = [];
  for (const task of state.tasks) {
    if (!inScope(task, now)) continue;
    const body = remoteBody(state, task), row = byTask.get(task.id);
    if (row?.gtask.startsWith(TOMBSTONE)) {
      // Google で削除済み: 完了のままなら送らない。Works で未完了に戻したら新しく作る。
      if (statusOf(task) !== "done") jobs.push({ kind: "create", task, body, row: null });
      continue;
    }
    if (!row || row.fingerprint !== fingerprint(body)) jobs.push({ kind: row ? "patch" : "create", task, body, row });
  }
  for (const row of rows) {
    const task = present.get(row.task);
    if (row.gtask.startsWith(TOMBSTONE)) {
      if (!task || !inScope(task, now)) jobs.push({ kind: "unlink", row });
      continue;
    }
    if (!task) jobs.push({ kind: "delete", row });
    else if (!inScope(task, now)) jobs.push({ kind: "unlink", row }); // 古い完了タスクは Google 側に残し、同期だけ止める
  }
  let count = 0;
  const base = `/lists/${encodeURIComponent(list)}/tasks`;
  for (const job of jobs) {
    if (ctx.signal.aborted || count >= PUSH_LIMIT) break;
    if (job.kind === "unlink") {
      await db.prepare("DELETE FROM todo_gtasks WHERE task=?").bind(job.row.task).run();
      continue;
    }
    count++;
    if (job.kind === "delete") {
      try {
        await call(ctx.getToken, `${base}/${encodeURIComponent(job.row.gtask)}`, { method: "DELETE", signal: ctx.signal });
      } catch (error) {
        if (error.status !== 404 && error.status !== 410) throw error;
      }
      await db.prepare("DELETE FROM todo_gtasks WHERE task=?").bind(job.row.task).run();
      continue;
    }
    let saved = null;
    if (job.kind === "patch") {
      try {
        saved = await call(ctx.getToken, `${base}/${encodeURIComponent(job.row.gtask)}`, { method: "PATCH", body: job.body, signal: ctx.signal });
      } catch (error) {
        if (error.status !== 404 && error.status !== 410) throw error;
        await db.prepare("DELETE FROM todo_gtasks WHERE task=?").bind(job.task.id).run(); // Google 側で消えていれば作り直す
      }
    }
    if (!saved) {
      const { due, ...rest } = job.body;
      saved = await call(ctx.getToken, base, { method: "POST", body: due ? job.body : rest, signal: ctx.signal });
    }
    await db
      .prepare("INSERT OR REPLACE INTO todo_gtasks(task,gtask,fingerprint,remote) VALUES (?,?,?,?)")
      .bind(job.task.id, saved.id, fingerprint(job.body), saved.updated || "")
      .run();
  }
}

export async function syncGoogleTasks(env, { read, write, mint, now = Date.now() }) {
  const db = env.DB;
  await ensure(db);
  if ((await cfg(db, "enabled")) !== "true") return;
  const lease = String(now) + ":" + crypto.randomUUID();
  const locked = await db
    .prepare("INSERT INTO todo_gtasks_config VALUES ('lease',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value WHERE CAST(value AS INTEGER) < ?")
    .bind(lease, now - LEASE_MS)
    .run();
  if (!locked.meta.changes) return;
  let access;
  const ctx = {
    read,
    write,
    signal: AbortSignal.timeout(45000),
    getToken: async () => (access ||= (await mint()).access_token),
  };
  try {
    let list;
    try {
      list = await ensureList(db, ctx.getToken, ctx.signal);
      await pull(env, ctx, list, now);
      await push(env, ctx, list, now);
    } catch (error) {
      if (error.status === 404 && list) {
        // 「Works」リストが Google 側で消えていれば、対応表と取得位置も捨てて次回すべて送り直す。
        await db.batch([
          db.prepare("DELETE FROM todo_gtasks"),
          db.prepare("DELETE FROM todo_gtasks_config WHERE id IN ('list','lastPull')"),
        ]);
      }
      throw error;
    }
    if (await cfg(db, "error")) await put(db, "error", "");
    await put(db, "lastRun", new Date(now).toISOString());
  } catch (error) {
    const message = error instanceof GoogleTasksError
      ? error.message
      : error?.status === 409
        ? "ToDo の保存と重なったため、次回の同期でやり直します。"
        : "Google ToDo リストとの同期を再試行します。";
    await put(db, "error", message);
  } finally {
    await db.prepare("DELETE FROM todo_gtasks_config WHERE id='lease' AND value=?").bind(lease).run();
  }
}

// /api/todo/integrations/gtasks: 同期のオン・オフと状態確認。
export async function googleTasksRequest(request, env) {
  const db = env.DB;
  await ensure(db);
  if (request.method === "PUT") {
    const body = await request.json();
    if (typeof body?.enabled !== "boolean")
      throw Object.assign(new Error("enabled を指定してください"), { status: 400 });
    await put(db, "enabled", body.enabled ? "true" : "false");
    if (body.enabled) await del(db, "lastPull"); // 有効にした直後は Google 側を全件確認する
  } else if (request.method !== "GET") {
    throw Object.assign(new Error("method not allowed"), { status: 405 });
  }
  const linked = await db.prepare("SELECT count(*) AS n FROM todo_gtasks").first("n");
  return {
    enabled: (await cfg(db, "enabled")) === "true",
    lastRun: (await cfg(db, "lastRun")) || null,
    error: (await cfg(db, "error")) || "",
    linked,
    listTitle: GTASKS_LIST_TITLE,
  };
}
