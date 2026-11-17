import { buildPushPayload } from "@block65/webcrypto-web-push";
import { addDays, statusOf } from "../../todo/model.mjs";

const schemas = [
  "CREATE TABLE IF NOT EXISTS todo_delivery_config (id TEXT PRIMARY KEY, value TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS todo_devices (endpoint TEXT PRIMARY KEY, subscription TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS todo_sent (endpoint TEXT NOT NULL, task TEXT NOT NULL, stamp TEXT NOT NULL, sent INTEGER, PRIMARY KEY(endpoint,task,stamp))",
  "CREATE TABLE IF NOT EXISTS todo_events (task TEXT PRIMARY KEY, event TEXT NOT NULL, fingerprint TEXT NOT NULL DEFAULT '')",
];
async function ensure(db) {
  await db.batch(schemas.map((sql) => db.prepare(sql)));
}
const cfg = (db, id) =>
  db
    .prepare("SELECT value FROM todo_delivery_config WHERE id=?")
    .bind(id)
    .first("value");
const put = (db, id, value) =>
  db
    .prepare("INSERT OR REPLACE INTO todo_delivery_config VALUES (?,?)")
    .bind(id, value)
    .run();
const b64 = (a) => btoa(String.fromCharCode(...new Uint8Array(a)));
async function vapid(env) {
  const db = env.DB;
  let value = await cfg(db, "vapid");
  if (!value) {
    const pair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    );
    const raw = await crypto.subtle.exportKey("raw", pair.publicKey);
    const { d } = await crypto.subtle.exportKey("jwk", pair.privateKey);
    await db
      .prepare("INSERT OR IGNORE INTO todo_delivery_config VALUES ('vapid',?)")
      .bind(JSON.stringify({ publicKey: b64(raw), privateKey: d }))
      .run();
    value = await cfg(db, "vapid");
  }
  return { ...JSON.parse(value), subject: "mailto:" + env.ALLOWED_EMAIL };
}
function checkedEndpoint(value) {
  let url;
  try {
    url = new URL(value);
  } catch {}
  const hosts = [
    "web.push.apple.com",
    "fcm.googleapis.com",
    "push.services.mozilla.com",
    "notify.windows.com",
  ];
  if (
    !url ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    !hosts.some(
      (host) => url.hostname === host || url.hostname.endsWith("." + host),
    ) ||
    url.href.length > 2048
  ) {
    throw Object.assign(
      new Error("対応するプッシュ通知の宛先を登録してください"),
      { status: 400 },
    );
  }
  return url.href;
}
export async function integrationRequest(request, env, action) {
  const db = env.DB;
  await ensure(db);
  if (action === "status" && request.method === "GET")
    return { lastRun: await cfg(db, "lastRun"), error: await cfg(db, "error") };
  if (action === "key" && request.method === "GET")
    return { publicKey: (await vapid(env)).publicKey };
  if (action === "device" && ["POST", "DELETE"].includes(request.method)) {
    const input = await request.json(),
      endpoint = checkedEndpoint(input.endpoint);
    if (request.method === "DELETE")
      await db.batch([
        db.prepare("DELETE FROM todo_devices WHERE endpoint=?").bind(endpoint),
        db.prepare("DELETE FROM todo_sent WHERE endpoint=?").bind(endpoint),
      ]);
    else {
      if (
        !/^[\w-]{87}=?$/.test(input.keys?.p256dh || "") ||
        !/^[\w-]{22}={0,2}$/.test(input.keys?.auth || "")
      )
        throw Object.assign(new Error("通知キーが不正です"), { status: 400 });
      await db
        .prepare("INSERT OR REPLACE INTO todo_devices VALUES (?,?)")
        .bind(endpoint, JSON.stringify({ endpoint, keys: input.keys }))
        .run();
    }
    return { ok: true };
  }
  throw Object.assign(new Error("unknown integration"), { status: 404 });
}
export function eventBody(t) {
  const a = t.plan || {},
    day = t.plannedDay;
  const body = {
    summary: t.name,
    extendedProperties: { private: { worksTodo: t.id } },
  };
  if (!a.time)
    return { ...body, start: { date: day }, end: { date: addDays(day, 1) } };
  const start = Date.parse(day + "T" + a.time + ":00+09:00");
  return {
    ...body,
    start: { dateTime: new Date(start).toISOString(), timeZone: "Asia/Tokyo" },
    end: {
      dateTime: new Date(start + (a.duration || 30) * 60000).toISOString(),
      timeZone: "Asia/Tokyo",
    },
  };
}
async function syncEvent(db, id, row, body, getToken, signal) {
  if (!row) {
    await db
      .prepare("INSERT OR IGNORE INTO todo_events(task,event) VALUES (?,?)")
      .bind(id, crypto.randomUUID().replaceAll("-", ""))
      .run();
    row = await db
      .prepare("SELECT * FROM todo_events WHERE task=?")
      .bind(id)
      .first();
  }
  const root =
    "https://www.googleapis.com/calendar/v3/calendars/primary/events";
  const item = root + "/" + row.event;
  const headers = {
    Authorization: "Bearer " + (await getToken()),
    "Content-Type": "application/json",
  };
  const call = (url, method, value, more = {}) =>
    fetch(url, {
      method,
      headers: { ...headers, ...more },
      body: value ? JSON.stringify(value) : undefined,
      signal,
      redirect: "error",
    });
  let result = await call(item, "GET");
  if (result.status !== 404 && result.status !== 410 && !result.ok)
    throw Error(
      "Googleカレンダーを取得できません。Worksのログインとアクセス権をご確認ください。",
    );
  const live = result.ok ? await result.json() : null;
  if (
    live &&
    live.status !== "cancelled" &&
    live.extendedProperties?.private?.worksTodo !== id
  )
    throw Error("連携予定の識別情報が一致しません");
  if (!body) {
    if (live && live.status !== "cancelled") {
      result = await call(item, "DELETE", null, { "If-Match": live.etag });
      if (!result.ok && result.status !== 410 && result.status !== 404)
        throw Error("カレンダーの予定削除を再試行します");
    }
    await db
      .prepare("DELETE FROM todo_events WHERE task=? AND event=?")
      .bind(id, row.event)
      .run();
    return;
  }
  if (live?.status === "cancelled" || result.status === 410) {
    await db
      .prepare(
        "UPDATE todo_events SET event=?,fingerprint='' WHERE task=? AND event=?",
      )
      .bind(crypto.randomUUID().replaceAll("-", ""), id, row.event)
      .run();
    return;
  }
  result = live
    ? await call(item, "PATCH", body, { "If-Match": live.etag })
    : await call(root, "POST", { ...body, id: row.event });
  if (!result.ok) throw Error("Googleカレンダーへの保存を再試行します");
  await db
    .prepare("UPDATE todo_events SET fingerprint=? WHERE task=? AND event=?")
    .bind(JSON.stringify(body), id, row.event)
    .run();
}
async function sendDue(env, tasks, now, signal) {
  const db = env.DB;
  const due = tasks.filter((t) => {
    if (statusOf(t) === "done" || !t.plan?.reminder) return false;
    const age = now - Date.parse(t.plan.reminder + ":00+09:00");
    return age >= 0 && age < 86400000;
  });
  if (!due.length) return;
  const { results: devices } = await db
    .prepare("SELECT * FROM todo_devices")
    .all();
  if (!devices.length) return;
  const keys = await vapid(env);
  let count = 0,
    failed = false;
  for (const device of devices) {
    const sent = await db
      .prepare("SELECT task,stamp FROM todo_sent WHERE endpoint=? AND sent>?")
      .bind(device.endpoint, now - 2 * 86400000)
      .all();
    const done = new Set(sent.results.map((r) => r.task + "|" + r.stamp));
    for (const t of due) {
      const stamp = t.plan.reminder;
      if (done.has(t.id + "|" + stamp) || count >= 8) continue;
      count++;
      try {
        const collapse = b64(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(t.id + "|" + stamp),
          ),
        )
          .replaceAll("+", "-")
          .replaceAll("/", "_")
          .slice(0, 32);
        const payload = await buildPushPayload(
          {
            data: { id: t.id, title: t.name, tag: collapse },
            options: { ttl: 3600, urgency: "high", topic: collapse },
          },
          JSON.parse(device.subscription),
          keys,
        );
        const result = await fetch(checkedEndpoint(device.endpoint), {
          ...payload,
          signal,
          redirect: "error",
        });
        if ([404, 410].includes(result.status)) {
          await db
            .prepare("DELETE FROM todo_devices WHERE endpoint=?")
            .bind(device.endpoint)
            .run();
          break;
        }
        if (!result.ok) throw Error("push");
        await db
          .prepare("INSERT OR REPLACE INTO todo_sent VALUES (?,?,?,?)")
          .bind(device.endpoint, t.id, stamp, now)
          .run();
      } catch {
        failed = true;
      }
    }
  }
  if (failed)
    throw Error("一部の端末へ通知を配信できませんでした。再試行します");
}
export async function deliverTodoWork(env, read, mint, now = Date.now()) {
  const state = await read();
  if (!state.planner) return;
  const db = env.DB;
  await ensure(db);
  const token = String(now) + ":" + crypto.randomUUID();
  const lock = await db
    .prepare(
      "INSERT INTO todo_delivery_config VALUES ('lease',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value WHERE CAST(value AS INTEGER) < ?",
    )
    .bind(token, now - 115000)
    .run();
  if (!lock.meta.changes) return;
  const signal = AbortSignal.timeout(48000),
    errors = [];
  try {
    try {
      await sendDue(env, state.tasks, now, signal);
    } catch (e) {
      errors.push("通知の配信を再試行します");
    }
    const { results: rows } = await db
      .prepare("SELECT * FROM todo_events")
      .all();
    const byId = new Map(rows.map((r) => [r.task, r]));
    const wanted = new Map(
      state.planner.calendar
        ? state.tasks
            .filter((t) => t.plannedDay && statusOf(t) !== "done")
            .map((t) => [t.id, eventBody(t)])
        : [],
    );
    let access,
      count = 0;
    const getToken = async () => (access ||= (await mint()).access_token);
    const jobs = [...new Set([...wanted.keys(), ...byId.keys()])].filter(
      (id) =>
        !wanted.has(id) ||
        JSON.stringify(wanted.get(id)) !== byId.get(id)?.fingerprint,
    );
    const last = await cfg(db, "cursor"),
      index = jobs.indexOf(last);
    for (const id of [...jobs.slice(index + 1), ...jobs.slice(0, index + 1)]) {
      if (++count > 8 || signal.aborted) break;
      try {
        await syncEvent(db, id, byId.get(id), wanted.get(id), getToken, signal);
      } catch (e) {
        errors.push(
          "Googleカレンダーの同期を再試行します。ログインと書き込み権限をご確認ください。",
        );
      }
      await put(db, "cursor", id);
    }
    await put(db, "error", [...new Set(errors)].join(" "));
    await put(db, "lastRun", new Date(now).toISOString());
    if (new Date(now).getUTCMinutes() === 0)
      await db
        .prepare("DELETE FROM todo_sent WHERE sent<?")
        .bind(now - 2 * 86400000)
        .run();
  } finally {
    await db
      .prepare("DELETE FROM todo_delivery_config WHERE id='lease' AND value=?")
      .bind(token)
      .run();
  }
}
