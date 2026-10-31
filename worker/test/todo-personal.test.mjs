import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Miniflare } from "miniflare";
import worker from "../src/index.js";
let source = await readFile(
  new URL("../src/index.js", import.meta.url),
  "utf8",
);
for (const file of [
  "workflow",
  "wiki",
  "kdp-services",
  "oauth-refresh",
  "mcp-scopes",
  "calendar-lesson-records",
  "calendar-lesson-google",
  "calendar-lesson-journal",
  "calendar-lesson-migration",
])
  source = source.replace(
    `./${file}.js`,
    new URL(`../src/${file}.js`, import.meta.url).href,
  );
const f = await import(
  `data:text/javascript;base64,${Buffer.from(source + "\nexport {readTodo,writeTodo,cloneTodo,callTodoTool,todoToday,todoOffset};").toString("base64")}`
);
async function fixture(t) {
  const mf = new Miniflare({
    modules: true,
    script: "export default {fetch(){return new Response('ok')}}",
    compatibilityDate: "2026-08-01",
    d1Databases: { DB: "todo" },
  });
  t.after(() => mf.dispose());
  const DB = await mf.getD1Database("DB");
  await DB.prepare(
    "CREATE TABLE todo_state (id INTEGER PRIMARY KEY, data TEXT NOT NULL, revision INTEGER NOT NULL)",
  ).run();
  return {
    DB,
    ALLOWED_EMAIL: "owner@example.test",
    SESSION_SECRET: "synthetic-secret",
    ALLOWED_ORIGIN: "http://localhost",
  };
}
const task = (id, extra = {}) => ({
  id,
  name: "合成タスク",
  category: "スクールサポート",
  priority: 3,
  deadline: "2026-01-01",
  progress: 100,
  memo: "Private old completion notes",
  createdAt: "2025-01-01",
  ...extra,
});
const args = (id, key = "synthetic_request_0001") => ({
  id,
  request_id: key,
  base_day: "2026-10-27",
  offset_days: 7,
});
test("JST boundaries and calendar offsets are independent of host timezone", () => {
  assert.equal(f.todoToday(new Date("2026-10-26T14:59:59Z")), "2026-10-26");
  assert.equal(f.todoToday(new Date("2026-10-26T15:00:00Z")), "2026-10-27");
  assert.equal(f.todoOffset("2028-02-28", 1), "2028-02-29");
  assert.equal(f.todoOffset("2026-12-31", 14), "2027-01-14");
  assert.throws(() => f.todoOffset("2026-02-30", 1));
  assert.throws(() => f.todoOffset("2026-10-27", 0));
});
test("additive legacy compatibility, role archival, categories and revision conflicts", async (t) => {
  const env = await fixture(t);
  await f.writeTodo(env, {
    revision: 0,
    categories: ["スクールサポート", "仕事", "個人", "その他"],
    tasks: [task("legacy")],
  });
  let s = await f.readTodo(env);
  assert.deepEqual(s.roles, []);
  await assert.rejects(f.writeTodo(env, { ...s, roles: [null] }), {
    status: 400,
  });
  await assert.rejects(
    f.writeTodo(env, { ...s, tasks: [{ ...s.tasks[0], checklist: [null] }] }),
    { status: 400 },
  );
  s.roles = [
    {
      id: "teacher",
      name: "授業管理",
      icon: "📚",
      color: "blue",
      archived: false,
    },
  ];
  s.tasks[0].roleId = "teacher";
  s = await f.writeTodo(env, s);
  await assert.rejects(f.writeTodo(env, { ...s, roles: [] }), { status: 400 });
  const legacy = {
    tasks: s.tasks,
    categories: s.categories,
    revision: s.revision,
  };
  s = await f.writeTodo(env, legacy);
  assert.equal(s.roles.length, 1);
  await assert.rejects(f.writeTodo(env, legacy), { status: 409 });
  s.roles[0].archived = true;
  s = await f.writeTodo(env, s);
  assert.equal(s.tasks[0].roleId, "teacher");
  assert.deepEqual(s.categories, [
    "スクールサポート",
    "仕事",
    "個人",
    "その他",
  ]);
  await assert.rejects(
    f.callTodoTool(env, "update_todo", { id: "legacy", name: "unsafe" }),
    { status: 409 },
  );
  const updated = await f.callTodoTool(env, "update_todo", {
    id: "legacy",
    plannedDay: "2026-11-01",
    expected_revision: s.revision,
  });
  assert.equal(updated.deadline, "2026-01-01");
});
test("completed and pending sources remain identical; allowlist resets history and checklist", async (t) => {
  const env = await fixture(t);
  const originals = [
    task("done", {
      status: "done",
      completedAt: "2026-01-01T00:00:00Z",
      executionHistory: ["private"],
      completionNotes: "private",
      reusableDescription: "Reusable brief",
      checklist: [{ id: "s1", text: "下書き", checked: true }],
      attachments: [
        {
          id: "same-owner-file",
          privateHistory: "do not copy",
          data: "inline attachment must not be copied",
        },
        "data:image/png;base64,private-payload",
        { url: "data:image/png;base64,object-private-payload" },
        { id: "data:private", object_key: "blob:private" },
        { url: "https://example.test/file", privateHistory: "excluded" },
      ],
    }),
    task("pending", { progress: 0, status: "pending" }),
  ];
  await f.writeTodo(env, {
    revision: 0,
    categories: ["スクールサポート"],
    tasks: originals,
  });
  for (const src of originals) {
    const result = await f.cloneTodo(
      env,
      args(src.id, "synthetic_" + src.id + "_request"),
    );
    assert.equal(result.task.status, "pending");
    assert.equal(result.task.progress, 0);
    assert.equal(result.task.deadline, null);
    assert.equal(result.task.plannedDay, "2026-11-03");
    assert.equal(result.task.cloneSourceId, src.id);
    assert.equal(result.task.executionHistory, undefined);
    assert.equal(result.task.completionNotes, undefined);
    assert.equal(result.task.completedAt, undefined);
    if (src.id === "done") {
      assert.equal(result.task.memo, "Reusable brief");
      assert.equal(result.task.checklist[0].checked, false);
      assert.notEqual(result.task.checklist[0].id, "s1");
      assert.deepEqual(result.task.attachments, [
        { id: "same-owner-file" },
        { url: "https://example.test/file" },
      ]);
    } else assert.equal(result.task.memo, "");
  }
  const s = await f.readTodo(env);
  assert.deepEqual(s.tasks.slice(0, 2), originals);
});
test("concurrent identical requests, response-loss lookup and retries, intentional distinct clones", async (t) => {
  const env = await fixture(t);
  await f.writeTodo(env, {
    revision: 0,
    categories: ["スクールサポート"],
    tasks: [task("source")],
  });
  const a = args("source");
  const results = await Promise.all([
    f.cloneTodo(env, a),
    f.cloneTodo(env, a),
    f.cloneTodo(env, a),
  ]);
  assert.equal(new Set(results.map((r) => r.task.id)).size, 1);
  let s = await f.readTodo(env);
  assert.equal(s.tasks.length, 2);
  assert.deepEqual(
    await f.callTodoTool(env, "get_todo_clone_result", {
      request_id: a.request_id,
    }),
    results[0],
  );
  assert.deepEqual(await f.cloneTodo(env, a), results[0]);
  await assert.rejects(f.cloneTodo(env, { ...a, offset_days: 3 }), {
    status: 409,
  });
  const next = await f.cloneTodo(env, {
    ...a,
    request_id: "intentional_distinct_0002",
    deadline: "2026-11-05",
  });
  assert.equal(next.task.deadline, "2026-11-05");
  assert.notEqual(next.task.id, results[0].task.id);
  s = await f.readTodo(env);
  await f.writeTodo(env, {
    tasks: s.tasks,
    categories: s.categories,
    revision: s.revision,
  });
  assert.deepEqual(await f.cloneTodo(env, a), results[0]);
  assert.equal((await f.readTodo(env)).tasks.length, 3);
});
async function signed(email, claims = {}) {
  const payload = Buffer.from(
    JSON.stringify({ email, exp: Date.now() + 3600000, ...claims }),
  ).toString("base64url");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("synthetic-secret"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return (
    payload +
    "." +
    Buffer.from(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)),
    ).toString("base64url")
  );
}
test("owner isolation covers clone POST/result GET and existing state; MCP token cannot use browser routes", async (t) => {
  const env = await fixture(t);
  await f.writeTodo(env, {
    revision: 0,
    categories: ["スクールサポート"],
    tasks: [task("source")],
  });
  for (const token of [
    await signed("other@example.test"),
    await signed("owner@example.test", {
      aud: "works-mcp",
      scope: "schedule:read",
    }),
    "invalid",
  ])
    for (const [path, method] of [
      ["/api/todo", "GET"],
      ["/api/todo/clone", "POST"],
      ["/api/todo/clone?request_id=synthetic_request_0001", "GET"],
    ]) {
      const response = await worker.fetch(
        new Request("http://localhost" + path, {
          method,
          headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/json",
          },
          body: method === "POST" ? JSON.stringify(args("source")) : undefined,
        }),
        env,
      );
      assert.ok([401, 403].includes(response.status));
    }
  assert.equal((await f.readTodo(env)).tasks.length, 1);
  const token = await signed("owner@example.test");
  const response = await worker.fetch(
    new Request("http://localhost/api/todo/clone", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args("source")),
    }),
    env,
  );
  assert.equal(response.status, 200);
});

test("legacy progress and explicit states preserve completion transitions", async (t) => {
  const env = await fixture(t);
  const originalTime = "2026-01-02T03:04:05.000Z";
  let s = await f.writeTodo(env, {
    revision: 0,
    categories: ["スクールサポート"],
    tasks: [task("transition", { status: "done", completedAt: originalTime })],
  });
  let updated = await f.callTodoTool(env, "update_todo", {
    id: "transition",
    status: "done",
    expected_revision: s.revision,
  });
  assert.equal(
    updated.completedAt,
    originalTime,
    "redundant explicit completion preserves history",
  );
  updated = await f.callTodoTool(env, "update_todo", {
    id: "transition",
    progress: 0,
    expected_revision: updated.revision,
  });
  assert.equal(updated.status, "pending");
  assert.equal(updated.completedAt, null);
  updated = await f.callTodoTool(env, "update_todo", {
    id: "transition",
    progress: 100,
    expected_revision: updated.revision,
  });
  assert.equal(updated.status, "done");
  assert.ok(updated.completedAt);
  assert.notEqual(updated.completedAt, originalTime);
  const completed = updated.completedAt;
  updated = await f.callTodoTool(env, "update_todo", {
    id: "transition",
    status: "done",
    expected_revision: updated.revision,
  });
  assert.equal(updated.completedAt, completed);
});
