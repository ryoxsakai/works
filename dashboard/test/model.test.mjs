import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaults,
  validateLayout,
  readLayout,
  dayJst,
  todoSummary,
  esc,
} from "../model.mjs";
import { createReader } from "../data.mjs";

test("layout accepts empty and defaults; rejects unknowns, duplicate IDs, paths and future versions", () => {
  assert.deepEqual(validateLayout(defaults()), defaults());
  assert.deepEqual(validateLayout({ version: 1, widgets: [], shortcuts: [] }), {
    version: 1,
    widgets: [],
    shortcuts: [],
  });
  for (const v of [
    null,
    { ...defaults(), version: 2 },
    { ...defaults(), widgets: ["__proto__"] },
    { ...defaults(), widgets: ["todo", "todo"] },
    { ...defaults(), shortcuts: ["javascript:alert(1)"] },
    { ...defaults(), shortcuts: ["/app/"] },
  ])
    assert.throws(() => validateLayout(v));
});
test("malformed and inaccessible storage falls back; contains presentation settings only", () => {
  assert.ok(readLayout({ getItem: () => "{oops" }, "a").error);
  assert.ok(
    readLayout(
      {
        getItem() {
          throw Error();
        },
      },
      "a",
    ).error,
  );
  const result = validateLayout({
    ...defaults(),
    access_token: "secret",
    memos: ["private"],
  });
  assert.ok(!JSON.stringify(result).includes("secret"));
  assert.ok(!("memos" in result));
});
test("JST day boundary and independent planned-day/deadline semantics match legacy", () => {
  assert.equal(dayJst(Date.parse("2026-10-29T14:59:59Z")), "2026-10-29");
  assert.equal(dayJst(Date.parse("2026-10-29T15:00:00Z")), "2026-10-30");
  const s = todoSummary(
    [
      { name: "carry", plannedDay: "2026-10-28" },
      { name: "deadline only", deadline: "2026-10-28" },
      { name: "future", plannedDay: "2026-11-01", deadline: "2026-10-29" },
      { name: "legacy done", progress: 100, plannedDay: "2026-10-29" },
      {
        name: "explicit waiting",
        status: "waiting",
        progress: 100,
        plannedDay: "2026-10-29",
      },
    ],
    "2026-10-29",
  );
  assert.deepEqual(
    s.planned.map((t) => t.name),
    ["carry", "explicit waiting"],
  );
  assert.deepEqual(
    s.due.map((t) => t.name),
    ["deadline only", "future"],
  );
  assert.equal(esc('<img onerror="x">'), "&lt;img onerror=&quot;x&quot;&gt;");
});
test("readers use only existing GETs and discard memo bodies/material object keys", async () => {
  const calls = [];
  const reader = createReader({
    session: "session",
    fetcher: async (url, opts) => {
      calls.push([url, opts]);
      return Response.json(
        url.includes("/memo")
          ? {
              memos: [
                {
                  title: "title",
                  body: "private",
                  notes: "private",
                  updatedAt: "2026-10-29",
                },
              ],
            }
          : url.includes("files")
            ? [{ name: "file", object_key: "secret", created_at: "2026-10-29" }]
            : url.includes("ss-projects")
              ? [
                  { name: "done", status: "完了" },
                  {
                    name: "active",
                    status: "問題作成中",
                    deadline: "2026-10-30",
                  },
                ]
              : { tasks: [] },
      );
    },
  });
  const sig = new AbortController().signal;
  assert.deepEqual(await reader("memo", "2026-10-29", sig), [
    { title: "title", updatedAt: "2026-10-29" },
  ]);
  assert.deepEqual(await reader("materials", "2026-10-29", sig), [
    { name: "file", created_at: "2026-10-29" },
  ]);
  assert.equal((await reader("ss", "2026-10-29", sig)).length, 1);
  await reader("todo", "2026-10-29", sig);
  assert.ok(
    calls.every(
      ([url, o]) =>
        !o.method &&
        o.headers.Authorization === "Bearer session" &&
        !url.includes("lesson"),
    ),
  );
});
test("Calendar read paginates per calendar, retains duplicate names, excludes exact titles, cancels and bounds concurrency", async () => {
  let active = 0,
    max = 0;
  const requests = [];
  const reader = createReader({
    session: "session",
    googleToken: async () => "google",
    fetcher: async (url, opts) => {
      requests.push(url);
      if (url === "/api/settings")
        return Response.json({
          selected_calendars: ["a", "b", "c", "d"],
          excluded_titles: ["除外"],
        });
      assert.equal(opts.headers.Authorization, "Bearer google");
      active++;
      max = Math.max(max, active);
      await new Promise((r) => setTimeout(r, 2));
      active--;
      const u = new URL(url);
      assert.equal(u.searchParams.get("timeMin"), "2026-10-29T00:00:00+09:00");
      assert.equal(u.searchParams.get("timeMax"), "2026-10-30T00:00:00+09:00");
      return Response.json(
        u.searchParams.has("pageToken")
          ? {
              items: [
                { summary: "same", start: { date: "2026-10-29" } },
                { summary: "除外" },
                { summary: "cancel", status: "cancelled" },
              ],
            }
          : {
              items: [
                {
                  summary: "same",
                  start: { dateTime: "2026-10-29T10:00:00+09:00" },
                },
              ],
              nextPageToken: "next",
            },
      );
    },
  });
  const result = await reader(
    "lessons",
    "2026-10-29",
    new AbortController().signal,
  );
  assert.equal(result.events.length, 8);
  assert.equal(max, 3);
  assert.equal(requests.length, 9);
  assert.ok(
    requests.every(
      (u) => !u.includes("lesson-record") && !u.includes("/api/schedule"),
    ),
  );
});
test("Calendar empty config skips token and network; malformed config and partial failure never claim empty", async () => {
  const sig = new AbortController().signal;
  const reader = createReader({
    session: "s",
    googleToken() {
      throw Error("unexpected token");
    },
    fetcher: async () => Response.json({ selected_calendars: [] }),
  });
  assert.equal((await reader("lessons", "2026-10-29", sig)).unconfigured, true);
  const malformed = createReader({
    session: "s",
    fetcher: async () => Response.json({ selected_calendars: [null] }),
  });
  await assert.rejects(malformed("lessons", "2026-10-29", sig));
  const partial = createReader({
    session: "s",
    googleToken: async () => "g",
    fetcher: async (url) =>
      url === "/api/settings"
        ? Response.json({ selected_calendars: ["a", "b"] })
        : new Response("", { status: 403 }),
  });
  await assert.rejects(partial("lessons", "2026-10-29", sig), /403/);
});
test("abort during token wait prevents calendar traffic; repeated page tokens fail closed", async () => {
  const ac = new AbortController();
  let calls = 0;
  const reader = createReader({
    session: "s",
    fetcher: async () => {
      calls++;
      return Response.json({ selected_calendars: ["a"] });
    },
    googleToken: async () => {
      ac.abort();
      return "g";
    },
  });
  await assert.rejects(reader("lessons", "2026-10-29", ac.signal));
  assert.equal(calls, 1);
  const repeated = createReader({
    session: "s",
    googleToken: async () => "g",
    fetcher: async (url) =>
      Response.json(
        url === "/api/settings"
          ? { selected_calendars: ["a"] }
          : { items: [], nextPageToken: "same" },
      ),
  });
  await assert.rejects(
    repeated("lessons", "2026-10-29", new AbortController().signal),
    /続き/,
  );
});

test("first failed calendar aborts sibling and prevents additional queued calendar requests", async () => {
  const calls = [];
  let aborts = 0;
  const reader = createReader({
    session: "s",
    googleToken: async () => "g",
    fetcher: async (url, { signal }) => {
      if (url === "/api/settings")
        return Response.json({ selected_calendars: ["a", "b", "c", "d", "e"] });
      calls.push(url);
      if (url.includes("/a/")) {
        await new Promise((r) => setTimeout(r, 5));
        return new Response("", { status: 403 });
      }
      return new Promise((resolve, reject) =>
        signal.addEventListener(
          "abort",
          () => {
            aborts++;
            reject(new DOMException("aborted", "AbortError"));
          },
          { once: true },
        ),
      );
    },
  });
  await assert.rejects(
    reader("lessons", "2026-10-29", new AbortController().signal),
    /403/,
  );
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls.length, 3);
  assert.equal(aborts, 2);
});
