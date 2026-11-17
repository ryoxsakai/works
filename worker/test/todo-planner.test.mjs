import test from "node:test";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import {
  parseQuick,
  reviewItems,
  sortTasks,
  defaults,
} from "../../todo/model.mjs";
import { preparePlanner } from "../src/todo-planner.js";
import { deliverTodoWork, integrationRequest } from "../src/todo-delivery.js";
const day = "2026-11-18",
  now = Date.parse(day + "T12:15:00+09:00");
const task = {
  id: "example",
  name: "教材を確認",
  status: "pending",
  plannedDay: day,
  plan: {
    reminder: day + "T12:15",
    repeat: { mode: "fixed", days: 7 },
    time: "12:15",
  },
};
test("Japanese quick capture, saved order, review and independent recurrence", () => {
  const q = parseQuick(
    "毎週水曜 12:15 WTを準備 #代官山/冬期 @準備 @印刷 p1",
    day,
  );
  assert.deepEqual(q, {
    name: "WTを準備",
    day,
    time: "12:15",
    repeat: { mode: "fixed", days: 7 },
    labels: ["準備", "印刷"],
    project: "代官山/冬期",
    priority: 1,
  });
  assert.equal(parseQuick("明日の教材を準備", day).name, "明日の教材を準備");
  assert.equal(parseQuick("16:00 教材確認", day, "2026-12-01").day, "2026-12-01");
  assert.equal(parseQuick("明日 16:00 教材確認", day, "2026-12-01").day, "2026-11-19");
  const old = { tasks: [structuredClone(task)], planner: defaults() };
  const next = structuredClone(old);
  next.tasks[0].status = "done";
  preparePlanner(next, old, now);
  assert.equal(next.tasks.length, 2);
  assert.equal(next.tasks[1].plannedDay, "2026-11-25");
  assert.equal(next.tasks[1].plan.reminder, "2026-11-25T12:15");
  assert.equal(next.tasks[0].plan.repeatIssued, true);
  const cyclic = structuredClone(next);
  cyclic.tasks[0].plan.parent = "example";
  assert.throws(() => preparePlanner(cyclic, next, now), /循環/);
  assert.deepEqual(
    reviewItems([{ id: "a", status: "waiting" }], [], 1, day).map((t) => t.id),
    ["a"],
  );
  assert.equal(
    reviewItems([], [{ id: "p", createdDay: "2026-11-10" }], 2, day).length,
    1,
  );
  assert.deepEqual(
    sortTasks(
      [
        { name: "z", priority: null },
        { name: "a", priority: 3 },
      ],
      "priority",
    ).map((t) => t.name),
    ["a", "z"],
  );
  const after = structuredClone(old);
  after.tasks[0].status = "done";
  after.tasks[0].plan.repeat = { mode: "after", days: 7 };
  preparePlanner(after, old, now + 2 * 86400000);
  assert.equal(after.tasks[1].plannedDay, "2026-11-27");
});
test("per-device encrypted reminders and Google create, retry, update, cleanup use durable receipts", async (t) => {
  const mf = new Miniflare({
    modules: true,
    script: "export default {fetch(){return new Response()}}",
    compatibilityDate: "2026-08-01",
    d1Databases: { DB: "todo-delivery" },
  });
  t.after(() => mf.dispose());
  const DB = await mf.getD1Database("DB"),
    env = { DB, ALLOWED_EMAIL: "owner@example.test" };
  const subKeys = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const endpoint = "https://web.push.apple.com/test";
  const post = (body) =>
    new Request("https://works.test/api/todo/integrations/device", {
      method: "POST",
      body: JSON.stringify(body),
    });
  await assert.rejects(
    integrationRequest(
      post({ endpoint: "https://example.test/test" }),
      env,
      "device",
    ),
    { status: 400 },
  );
  await integrationRequest(
    post({
      endpoint,
      keys: {
        p256dh: Buffer.from(
          await crypto.subtle.exportKey("raw", subKeys.publicKey),
        ).toString("base64url"),
        auth: Buffer.alloc(16, 1).toString("base64url"),
      },
    }),
    env,
    "device",
  );
  const state = {
      tasks: [structuredClone(task)],
      planner: { ...defaults(), calendar: true },
    },
    events = new Map();
  let pushes = 0,
    inserts = 0,
    patches = 0,
    deletes = 0,
    attempts = 0;
  const real = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = real;
  });
  globalThis.fetch = async (url, opts) => {
    if (url === endpoint) {
      assert.equal(opts.headers["content-encoding"], "aes128gcm");
      assert.match(
        opts.headers.authorization,
        /^vapid t=[\w.-]+, k=[\w-]{87}$/,
      );
      assert.equal(opts.body.byteLength, 4096);
      pushes++;
      return new Response(null, { status: 201 });
    }
    assert.ok(
      url.startsWith(
        "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      ),
    );
    const id = url.split("/").at(-1),
      body = opts.body && JSON.parse(opts.body);
    if (opts.method === "GET")
      return events.has(id)
        ? Response.json({ ...events.get(id), etag: "mock" })
        : new Response(null, { status: 404 });
    if (opts.method === "POST") {
      attempts++;
      if (attempts === 1) return new Response(null, { status: 503 });
      events.set(body.id, body);
      inserts++;
    }
    if (opts.method === "PATCH") {
      events.set(id, body);
      patches++;
    }
    if (opts.method === "DELETE") {
      events.delete(id);
      deletes++;
    }
    return Response.json({});
  };
  const tick = (minutes) =>
    deliverTodoWork(
      env,
      async () => state,
      async () => ({ access_token: "synthetic" }),
      now + minutes * 60000,
    );
  await tick(0);
  await tick(1);
  await tick(2);
  assert.deepEqual([pushes, inserts, patches, deletes], [1, 1, 0, 0]);
  assert.equal(
    [...events.values()][0].start.dateTime,
    "2026-11-18T03:15:00.000Z",
  );
  state.tasks[0].name = "改訂教材";
  state.tasks[0].plan.time = null;
  await tick(3);
  assert.equal(patches, 1);
  assert.equal([...events.values()][0].end.date, "2026-11-19");
  state.tasks.length = 0;
  await tick(4);
  await tick(5);
  assert.equal(deletes, 1);
  assert.equal(events.size, 0);
});
