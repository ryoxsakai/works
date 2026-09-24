import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Miniflare } from "miniflare";

test("ToDo revisions survive a database read and reject stale saves", async (context) => {
  const source = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
  const functions = await import(`data:text/javascript;base64,${Buffer.from(`${source}\nexport { readTodo, writeTodo, callTodoTool };`).toString("base64")}`);
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } };",
    compatibilityDate: "2026-08-01",
    d1Databases: { DB: "todo-test" },
  });
  context.after(() => miniflare.dispose());
  const db = await miniflare.getD1Database("DB");
  await db.prepare("CREATE TABLE todo_state (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1)").run();
  const env = { DB: db };

  const empty = await functions.readTodo(env);
  assert.equal(empty.revision, 0);
  const first = await functions.writeTodo(env, empty);
  assert.equal(first.revision, 1);
  const reloaded = await functions.readTodo(env);
  assert.equal(reloaded.revision, 1);

  const second = await functions.writeTodo(env, { ...reloaded, categories: [...reloaded.categories, "新規"] });
  assert.equal(second.revision, 2);
  await assert.rejects(functions.writeTodo(env, reloaded), { status: 409 });
  const afterConflict = await functions.readTodo(env);
  assert.equal(afterConflict.revision, 2);
  assert.ok(afterConflict.categories.includes("新規"));
});
