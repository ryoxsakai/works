import test from "node:test";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import { defaults } from "../../todo/model.mjs";
import { syncGoogleTasks, googleTasksRequest, remoteBody, PULL_INTERVAL_MS } from "../src/todo-gtasks.js";

const day = "2026-11-28";
const start = Date.parse(day + "T10:00:00+09:00");
const task = (id, extra = {}) => ({ id, name: id, category: "授業", priority: null, deadline: null, progress: 0, memo: "", plannedDay: null, status: "pending", ...extra });

// Google Tasks API の合成サーバー(1つのリストと、そのタスクだけを保持する)
function fakeGoogle() {
  const lists = new Map(), tasks = new Map();
  let clock = 0, serial = 0, scopeError = false;
  const calls = [];
  const time = { now: 0 };
  // 更新時刻は「その時点の時刻+連番ミリ秒」(updatedMin による絞り込みが本物と同じように働く)
  const stamp = () => new Date(time.now + ++clock).toISOString();
  const handler = async (url, options = {}) => {
    const u = new URL(url), method = options.method || "GET";
    calls.push(method + " " + u.pathname);
    assert.equal(u.origin, "https://tasks.googleapis.com");
    assert.equal(options.headers.Authorization, "Bearer synthetic");
    if (scopeError) return new Response(JSON.stringify({ error: { status: "PERMISSION_DENIED", details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }] } }), { status: 403 });
    const body = options.body ? JSON.parse(options.body) : null;
    if (u.pathname === "/tasks/v1/users/@me/lists") {
      if (method === "POST") { const id = "list-" + ++serial; lists.set(id, { id, title: body.title }); return Response.json(lists.get(id)); }
      return Response.json({ items: [...lists.values()] });
    }
    const match = u.pathname.match(/^\/tasks\/v1\/lists\/([^/]+)\/tasks(?:\/([^/]+))?$/);
    assert.ok(match, u.pathname);
    if (!lists.has(decodeURIComponent(match[1]))) return new Response("{}", { status: 404 });
    const id = match[2] && decodeURIComponent(match[2]);
    if (!id && method === "GET") {
      const since = u.searchParams.get("updatedMin");
      assert.equal(u.searchParams.get("showDeleted"), "true");
      return Response.json({ items: [...tasks.values()].filter((t) => !since || t.updated >= since) });
    }
    if (!id && method === "POST") {
      const created = { id: "g" + ++serial, ...body, updated: stamp() };
      tasks.set(created.id, created);
      return Response.json(created);
    }
    if (!tasks.has(id) || tasks.get(id).deleted) return new Response("{}", { status: 404 });
    if (method === "PATCH") { tasks.set(id, { ...tasks.get(id), ...body, updated: stamp() }); return Response.json(tasks.get(id)); }
    if (method === "DELETE") { tasks.delete(id); return new Response(null, { status: 204 }); }
    throw new Error("unexpected " + method);
  };
  return {
    handler, lists, tasks, calls, time,
    editRemote(id, change) { tasks.set(id, { ...tasks.get(id), ...change, updated: stamp() }); },
    addRemote(item) { const id = "remote-" + ++serial; tasks.set(id, { id, status: "needsAction", ...item, updated: stamp() }); return id; },
    setScopeError(value) { scopeError = value; },
  };
}

test("Google ToDo リスト: 有効化・送信・取り込み・削除・権限エラー", async (t) => {
  const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response()}}", compatibilityDate: "2026-08-01", d1Databases: { DB: "todo-gtasks" } });
  t.after(() => mf.dispose());
  const env = { DB: await mf.getD1Database("DB") };
  const google = fakeGoogle();
  const real = globalThis.fetch;
  t.after(() => { globalThis.fetch = real; });
  globalThis.fetch = google.handler;

  const planner = { ...defaults(), projects: [{ id: "p1", name: "代官山" }] };
  let state = {
    revision: 3, categories: ["授業"], roles: [], planner,
    tasks: [
      task("教材準備", { plannedDay: day, memo: "第3章", plan: { project: "p1" } }),
      task("締切だけ", { deadline: "2026-12-01" }),
      task("最近完了", { status: "done", progress: 100, completedAt: new Date(start - 86400000).toISOString() }),
      task("昔の完了", { status: "done", progress: 100, completedAt: new Date(start - 40 * 86400000).toISOString() }),
    ],
  };
  let failNextWrite = false;
  const io = {
    read: async () => structuredClone(state),
    write: async (next) => {
      if (failNextWrite) { failNextWrite = false; throw Object.assign(new Error("conflict"), { status: 409 }); }
      assert.equal(next.revision, state.revision);
      state = { ...structuredClone(next), revision: state.revision + 1 };
      return state;
    },
    mint: async () => ({ access_token: "synthetic" }),
  };
  const run = (minutes) => { google.time.now = start + minutes * 60000; return syncGoogleTasks(env, { ...io, now: start + minutes * 60000 }); };
  const request = (method, body) => googleTasksRequest(new Request("https://works.test/api/todo/integrations/gtasks", { method, body: body && JSON.stringify(body) }), env);

  // オフのあいだは Google に一切問い合わせない
  await run(0);
  assert.equal(google.calls.length, 0);
  assert.equal((await request("GET")).enabled, false);
  await assert.rejects(request("PUT", { enabled: "yes" }), { status: 400 });
  assert.equal((await request("PUT", { enabled: true })).enabled, true);

  // 初回: 「Works」リストを作り、対象タスク(未完了と30日以内の完了)だけを送る
  await run(1);
  assert.deepEqual([...google.lists.values()].map((l) => l.title), ["Works"]);
  const remote = () => [...google.tasks.values()];
  const byTitle = (title) => remote().find((item) => item.title === title);
  assert.deepEqual(remote().map((item) => item.title).sort(), ["[代官山] 教材準備", "最近完了", "締切だけ"].sort());
  assert.equal(byTitle("[代官山] 教材準備").due, day + "T00:00:00.000Z");
  assert.equal(byTitle("[代官山] 教材準備").notes, "第3章");
  assert.equal(byTitle("締切だけ").due, "2026-12-01T00:00:00.000Z");
  assert.equal(byTitle("最近完了").status, "completed");
  let status = await request("GET");
  assert.equal(status.linked, 3);
  assert.equal(status.error, "");

  // 変更がなければ、次の実行では Google に何も送らない(確認も5分ごと)
  const before = google.calls.length;
  await run(2);
  assert.equal(google.calls.length, before, "変更がなければ Google には問い合わせない");

  // Google 側の変更(完了・タイトル・期限)は5分ごとの確認で Works に取り込み、送り返さない
  google.time.now = start + 2.5 * 60000;
  google.editRemote(byTitle("[代官山] 教材準備").id, { title: "[代官山] 教材準備(改)", status: "completed", completed: "2026-11-28T03:00:00.000Z", due: "2026-11-29T00:00:00.000Z" });
  const shortlyAfter = state.revision;
  await run(3);
  assert.equal(state.revision, shortlyAfter, "5分未満では取り込まない");
  await run(1 + PULL_INTERVAL_MS / 60000);
  const edited = state.tasks.find((item) => item.id === "教材準備");
  assert.equal(edited.name, "教材準備(改)");
  assert.equal(edited.status, "done");
  assert.equal(edited.progress, 100);
  assert.equal(edited.plannedDay, "2026-11-29");
  const patchesBefore = google.calls.filter((call) => call.startsWith("PATCH")).length;
  await run(7);
  assert.equal(google.calls.filter((call) => call.startsWith("PATCH")).length, patchesBefore, "取り込んだ変更を送り返さない");

  // Google 側で追加されたタスクを取り込む。サブタスク・完了済みは取り込まない
  google.time.now = start + 8 * 60000;
  google.addRemote({ title: "Googleで追加", due: "2026-12-03T00:00:00.000Z", notes: "メモ" });
  google.addRemote({ title: "サブタスク", parent: "x" });
  google.addRemote({ title: "完了済み", status: "completed" });
  await run(13);
  const imported = state.tasks.find((item) => item.name === "Googleで追加");
  assert.ok(imported);
  assert.equal(imported.plannedDay, "2026-12-03");
  assert.equal(imported.memo, "メモ");
  assert.equal(imported.category, "授業");
  assert.equal(state.tasks.some((item) => ["サブタスク", "完了済み"].includes(item.name)), false);

  // Works 側の変更・削除は次の実行で送る
  state.tasks.find((item) => item.id === "締切だけ").name = "締切だけ(改)";
  state.tasks = state.tasks.filter((item) => item.id !== "最近完了");
  await run(14);
  assert.ok(byTitle("締切だけ(改)"));
  assert.equal(byTitle("最近完了"), undefined);

  // Google 側で削除されたタスクは Works では完了にする(削除はしない)
  google.tasks.set(byTitle("締切だけ(改)").id, { ...byTitle("締切だけ(改)"), deleted: true, updated: new Date(start + 15 * 60000).toISOString() });
  await run(20);
  const removed = state.tasks.find((item) => item.id === "締切だけ");
  assert.equal(removed.status, "done");
  await run(21);
  assert.equal(remote().some((item) => item.title.startsWith("締切だけ") && !item.deleted), false, "Google で削除したタスクを作り直さない");
  // Works で未完了に戻したら、新しく作り直す
  const reopened = state.tasks.find((item) => item.id === "締切だけ");
  Object.assign(reopened, { status: "pending", progress: 0, completedAt: null });
  await run(22);
  assert.equal(remote().filter((item) => item.title === "締切だけ(改)" && !item.deleted).length, 1);

  // ToDo の保存と重なったら取り込みを中断し、次回やり直す
  google.time.now = start + 21 * 60000;
  google.addRemote({ title: "競合後に取り込む" });
  failNextWrite = true;
  await run(26);
  assert.match((await request("GET")).error, /次回の同期でやり直します/);
  await run(27);
  assert.ok(state.tasks.some((item) => item.name === "競合後に取り込む"));
  assert.equal((await request("GET")).error, "");

  // 権限が足りなければ、ログインし直す案内を表示する
  google.setScopeError(true);
  state.tasks.push(task("権限確認"));
  await run(28);
  status = await request("GET");
  assert.match(status.error, /ログインし直し/);
  google.setScopeError(false);

  // 時刻・繰り返しのあるタスクは、Google 側で期限を外しても予定日を残す(保存の検証で同期が止まらないように)
  state.tasks.push(task("時刻つき", { plannedDay: day, plan: { time: "10:00" } }));
  await run(29);
  const timed = remote().find((item) => item.title === "時刻つき");
  google.time.now = start + 30 * 60000;
  google.editRemote(timed.id, { due: null, notes: "期限を外した" });
  await run(34);
  const timedLocal = state.tasks.find((item) => item.id === "時刻つき");
  assert.equal(timedLocal.memo, "期限を外した");
  assert.equal(timedLocal.plannedDay, day);

  // 「Works」リストが Google 側で消えたら、新しいリストにすべて送り直す
  const linkedBefore = (await request("GET")).linked;
  google.lists.clear();
  google.tasks.clear();
  await run(40);
  assert.match((await request("GET")).error, /再試行/);
  await run(41);
  await run(42);
  assert.equal(google.lists.size, 1);
  assert.ok(remote().length >= 3, "新しいリストへ送り直す");
  assert.ok((await request("GET")).linked > 0 && linkedBefore > 0);

  // オフにすると同期は止まる
  await request("PUT", { enabled: false });
  const callsWhenOff = google.calls.length;
  state.tasks.push(task("オフ中"));
  await run(50);
  assert.equal(google.calls.length, callsWhenOff);
});

test("Google ToDo リストに送る内容: プロジェクト名・期限・完了状態", () => {
  const state = { planner: { ...defaults(), projects: [{ id: "a", name: "親" }, { id: "b", name: "子", parent: "a" }] } };
  assert.deepEqual(remoteBody(state, task("x", { plan: { project: "b" }, plannedDay: day, deadline: "2026-12-01" })), {
    title: "[親 / 子] x", notes: "", due: day + "T00:00:00.000Z", status: "needsAction",
  });
  assert.equal(remoteBody(state, task("y")).due, null);
  assert.equal(remoteBody(state, task("z", { status: "done", progress: 100 })).status, "completed");
});
