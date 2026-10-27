import test from "node:test";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import { readFile } from "node:fs/promises";
import { createHmac } from "node:crypto";
import worker from "../src/index.js";
import {
  validateWorkflow,
  workflowTools,
  workflowRead,
  workflowPlanning,
  workflowWrite as write,
  workflowExecute as exec,
} from "../src/workflow.js";
const content = {
  title: "合成ワークフロー",
  kind: "workflow",
  purpose: "合成データだけで検証",
  completion: "成果物URLを確認",
  permissions: "example.test のみ。送信には別途承認",
  priority: 2,
  start: "2026-01-01T01:00:00Z",
  repeat: "once",
  tasks: [
    { title: "調査", completion: "資料URL確認", assignee: "dot", gate: true },
    {
      title: "本人確認",
      completion: "最終成果確認",
      assignee: "self",
      gate: false,
    },
  ],
};
async function fixture(t) {
  const mf = new Miniflare({
    modules: true,
    script: 'export default {fetch(){return new Response("ok")}}',
    compatibilityDate: "2026-08-01",
    d1Databases: { DB: "workflow-test" },
  });
  t.after(() => mf.dispose());
  const env = {
    DB: await mf.getD1Database("DB"),
    ALLOWED_EMAIL: "owner@example.test",
    ALLOWED_ORIGIN: "https://works.example.test",
    SESSION_SECRET: "synthetic",
    WORKS_API_KEY: "synthetic",
  };
  const sql = await readFile(
    new URL("../workflow-migrations/0001-workflow.sql", import.meta.url),
    "utf8",
  );
  await env.DB.batch(
    sql
      .replace(/^--.*$/gm, "")
      .split(/(?=^CREATE )/m)
      .filter((x) => x.trim())
      .map((x) => env.DB.prepare(x)),
  );
  const token = (payload = {}) => {
    const p = Buffer.from(
      JSON.stringify({
        email: env.ALLOWED_EMAIL,
        exp: Date.now() + 3600000,
        ...payload,
      }),
    ).toString("base64url");
    return (
      p +
      "." +
      createHmac("sha256", env.SESSION_SECRET).update(p).digest("base64url")
    );
  };
  const api = (
    a,
    {
      auth = token(),
      origin = env.ALLOWED_ORIGIN,
      method = a ? "POST" : "GET",
    } = {},
  ) =>
    worker.fetch(
      new Request(env.ALLOWED_ORIGIN + "/api/workflow", {
        method,
        headers: {
          Authorization: "Bearer " + auth,
          Origin: origin,
          "Content-Type": "application/json",
        },
        ...(a ? { body: JSON.stringify(a) } : {}),
      }),
      env,
    );
  const call = (name, args) =>
    worker.fetch(
      new Request(env.ALLOWED_ORIGIN + "/mcp", {
        method: "POST",
        headers: {
          Authorization:
            "Bearer " + token({ aud: "works-mcp", scope: "schedule:read" }),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: args },
        }),
      }),
      env,
    );
  const create = async (c = content) => {
    let d = await write(env, { action: "create", content: c });
    return write(
      env,
      {
        action: "publish",
        definition_id: d.id,
        revision: d.revision,
        authorized: true,
      },
      true,
    );
  };
  return { env, api, call, create, token };
}
const evidence = ["https://example.test/artifact"];
const completion = {
  criteria_verified: true,
  workflow_criteria_verified: true,
  result: "確認済み合成成果",
  evidence,
};
test("workflow CRUD, browser ownership, CSRF, MCP exposure, immutable versions", async (t) => {
  const f = await fixture(t),
    { env, api, call } = f;
  assert.equal((await api(null, { auth: "" })).status, 401);
  assert.equal(
    (await api(null, { auth: f.token({ email: "stranger@example.test" }) }))
      .status,
    401,
  );
  assert.equal(
    (
      await api(null, {
        auth: f.token({ aud: "works-mcp", scope: "schedule:read" }),
      })
    ).status,
    401,
  );
  assert.equal(
    (await api({ action: "create", content }, { origin: "https://evil.test" }))
      .status,
    403,
  );
  let r = await api({ action: "create", content });
  assert.equal(r.status, 200, await r.clone().text());
  let d = await r.json();
  await assert.rejects(
    () =>
      write(env, {
        action: "publish",
        definition_id: d.id,
        revision: d.revision,
        authorized: true,
      }),
    { status: 403 },
  );
  let pair = await Promise.allSettled([
    write(env, {
      action: "edit",
      definition_id: d.id,
      revision: d.revision,
      content: { ...content, title: "A" },
    }),
    write(env, {
      action: "edit",
      definition_id: d.id,
      revision: d.revision,
      content: { ...content, title: "B" },
    }),
  ]);
  assert.equal(pair.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(pair.find((x) => x.status === "rejected").reason.status, 409);
  d = (await workflowRead(env, { definition_id: d.id })).definition;
  assert.equal(
    (await workflowRead({ ...env, ALLOWED_EMAIL: "other@example.test" }))
      .definitions.length,
    0,
  );
  await assert.rejects(() =>
    env.DB.prepare("UPDATE wf_versions SET data=?").bind("{}").run(),
  );
  assert.equal(
    (
      await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE name IN ('todo_state','wiki_pages')",
      ).all()
    ).results.length,
    0,
  );
  const archived = await write(
    env,
    { action: "archive", definition_id: d.id, revision: d.revision },
    true,
  );
  assert.equal(archived.archived, 1);
  assert.equal((await workflowRead(env)).definitions.length, 0);
  assert.ok(
    (await workflowRead(env, { definition_id: d.id })).versions.length >= 3,
  );
  r = await call("works.read_workflows", {});
  assert.equal(r.status, 200);
  assert.ok((await r.json()).result);
  r = await call("execute_workflow", {
    action: "publish",
    definition_id: d.id,
    revision: d.revision,
  });
  assert.ok((await r.json()).result.isError);
});
test("unique scheduled slots, atomic claim, serial gates, artifacts, cancellation and schedule stop", async (t) => {
  const { env, create } = await fixture(t);
  let d = await create();
  await Promise.all([
    exec(env, { action: "patrol" }),
    exec(env, { action: "patrol" }),
  ]);
  let state = await workflowRead(env);
  assert.equal(state.runs.length, 1);
  let r = state.runs[0];
  assert.equal(r.status, "queued");
  const claims = await Promise.allSettled([
    exec(env, { action: "claim", run_id: r.id, revision: r.revision }),
    exec(env, { action: "claim", run_id: r.id, revision: r.revision }),
  ]);
  assert.equal(claims.filter((x) => x.status === "fulfilled").length, 1);
  let lease = claims.find((x) => x.status === "fulfilled").value;
  const a = {
    run_id: r.id,
    revision: lease.revision,
    generation: lease.generation,
    token: lease.token,
  };
  await assert.rejects(
    () => exec(env, { action: "complete", ...a, result: "done" }),
    { status: 400 },
  );
  r = await exec(env, { action: "complete", ...a, ...completion });
  assert.equal(r.status, "review");
  assert.equal(r.data.current, 0);
  await assert.rejects(
    () =>
      write(env, {
        action: "approve",
        run_id: r.id,
        revision: r.revision,
        ...completion,
      }),
    { status: 403 },
  );
  r = await write(
    env,
    { action: "approve", run_id: r.id, revision: r.revision, ...completion },
    true,
  );
  assert.equal(r.status, "queued");
  assert.equal(r.data.current, 1);
  await assert.rejects(
    () => exec(env, { action: "claim", run_id: r.id, revision: r.revision }),
    { status: 409 },
  );
  r = await write(
    env,
    {
      action: "self_complete",
      run_id: r.id,
      revision: r.revision,
      ...completion,
    },
    true,
  );
  assert.equal(r.status, "completed");
  state = await workflowRead(env);
  d = state.definitions[0];
  const key = "stable-request";
  let manual = await write(
    env,
    {
      action: "start",
      definition_id: d.id,
      revision: d.revision,
      request_id: key,
    },
    true,
  );
  assert.equal(
    (
      await write(
        env,
        {
          action: "start",
          definition_id: d.id,
          revision: d.revision,
          request_id: key,
        },
        true,
      )
    ).id,
    manual.id,
  );
  d = await write(env, {
    action: "schedule_stop",
    definition_id: d.id,
    revision: d.revision,
  });
  assert.equal(d.enabled, 0);
  assert.equal(
    (await workflowRead(env, { run_id: manual.id })).run.status,
    "queued",
  );
  manual = await write(
    env,
    { action: "cancel", run_id: manual.id, revision: manual.revision },
    true,
  );
  assert.equal(manual.status, "cancelled");
  await assert.rejects(
    () =>
      write(
        env,
        { action: "resume", run_id: manual.id, revision: manual.revision },
        true,
      ),
    { status: 409 },
  );
});
test("external reference, expiry fencing, unknown result wait and no automatic retry", async (t) => {
  const { env, create } = await fixture(t);
  await create({ ...content, tasks: [{ ...content.tasks[0], gate: false }] });
  await exec(env, { action: "patrol" });
  let r = (await workflowRead(env)).runs[0],
    lease = await exec(env, {
      action: "claim",
      run_id: r.id,
      revision: r.revision,
    });
  const fence = {
    run_id: r.id,
    generation: lease.generation,
    token: lease.token,
  };
  r = await exec(env, {
    action: "external_begin",
    ...fence,
    revision: lease.revision,
    external_ref: "job-synthetic-1",
    result: "既存ジョブ照会",
  });
  await assert.rejects(
    () =>
      exec(env, {
        action: "external_begin",
        ...fence,
        revision: r.revision,
        external_ref: "job-2",
        result: "retry",
      }),
    { status: 409 },
  );
  await env.DB.prepare(
    "UPDATE wf_runs SET lease_until=?,revision=revision+1 WHERE id=?",
  )
    .bind(Date.now() - 1, r.id)
    .run();
  await exec(env, { action: "patrol" });
  r = (await workflowRead(env, { run_id: r.id })).run;
  assert.equal(r.status, "waiting");
  await assert.rejects(
    () => exec(env, { action: "claim", run_id: r.id, revision: r.revision }),
    { status: 409 },
  );
  await assert.rejects(
    () =>
      exec(env, {
        action: "complete",
        ...fence,
        revision: r.revision,
        ...completion,
      }),
    { status: 409 },
  );
  await assert.rejects(
    () =>
      write(
        env,
        { action: "resume", run_id: r.id, revision: r.revision },
        true,
      ),
    { status: 409 },
  );
  r = await exec(env, {
    action: "reconcile",
    run_id: r.id,
    revision: r.revision,
    external_ref: "job-synthetic-1",
    outcome: "unknown",
    result: "Mac オフライン",
  });
  assert.equal(r.status, "waiting");
  r = await exec(env, {
    action: "reconcile",
    run_id: r.id,
    revision: r.revision,
    external_ref: "job-synthetic-1",
    outcome: "completed",
    result: "同じジョブの結果確認",
    evidence,
  });
  assert.equal(r.status, "paused");
  r = await write(
    env,
    { action: "resume", run_id: r.id, revision: r.revision },
    true,
  );
  lease = await exec(env, {
    action: "claim",
    run_id: r.id,
    revision: r.revision,
  });
  await assert.rejects(
    () =>
      exec(env, {
        action: "external_begin",
        run_id: r.id,
        revision: lease.revision,
        generation: lease.generation,
        token: lease.token,
        external_ref: "again",
        result: "再送",
      }),
    { status: 409 },
  );
  r = await exec(env, {
    action: "complete",
    run_id: r.id,
    revision: lease.revision,
    generation: lease.generation,
    token: lease.token,
    ...completion,
  });
  assert.equal(r.status, "completed");
});
test("global stop fences claims; heartbeat and desired intervals remain separate", async (t) => {
  const { env, create } = await fixture(t);
  await create();
  await exec(env, {
    action: "patrol",
    actual_interval: 60,
    automation_ref: "synthetic-automation",
  });
  let cfg = (await workflowRead(env)).settings;
  cfg = await write(
    env,
    { action: "settings", revision: cfg.revision, desired_interval: 30 },
    true,
  );
  assert.equal(cfg.actual_interval, 60);
  assert.equal(cfg.desired_interval, 30);
  assert.ok(cfg.last_patrol);
  let r = (await workflowRead(env)).runs[0],
    lease = await exec(env, {
      action: "claim",
      run_id: r.id,
      revision: r.revision,
    });
  cfg = await write(env, { action: "stop_all", revision: cfg.revision }, true);
  assert.equal(cfg.stopped, 1);
  r = (await workflowRead(env, { run_id: r.id })).run;
  assert.equal(r.status, "paused");
  await assert.rejects(
    () =>
      exec(env, {
        action: "checkpoint",
        run_id: r.id,
        revision: r.revision,
        generation: lease.generation,
        token: lease.token,
      }),
    { status: 409 },
  );
  cfg = await write(
    env,
    { action: "resume_all", revision: cfg.revision },
    true,
  );
  assert.equal(cfg.stopped, 0);
  assert.equal(
    (await workflowRead(env, { run_id: r.id })).run.status,
    "paused",
  );
});

test("execution HTTP API requires MCP auth; safe retry only after proved non-dispatch", async (t) => {
  const f = await fixture(t),
    { env, create } = f;
  await create({ ...content, tasks: [{ ...content.tasks[0], gate: false }] });
  const http = async (args, auth) =>
    worker.fetch(
      new Request(env.ALLOWED_ORIGIN + "/api/workflow/execution", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + auth,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args),
      }),
      env,
    );
  assert.equal((await http({ action: "patrol" }, f.token())).status, 401);
  const auth = f.token({ aud: "works-mcp", scope: "schedule:read" });
  let response = await http({ action: "patrol" }, auth);
  assert.equal(response.status, 200, await response.clone().text());
  let r = (await response.json()).runs[0];
  response = await http(
    { action: "claim", run_id: r.id, revision: r.revision },
    auth,
  );
  assert.equal(response.status, 200);
  let lease = await response.json();
  const fence = {
    run_id: r.id,
    generation: lease.generation,
    token: lease.token,
  };
  r = await exec(env, {
    action: "external_begin",
    ...fence,
    revision: lease.revision,
    external_ref: "idempotent-ref",
    result: "サンプル送信予約",
  });
  r = await write(
    env,
    { action: "cancel", run_id: r.id, revision: r.revision },
    true,
  );
  assert.equal(r.status, "waiting");
  r = await exec(env, {
    action: "reconcile",
    run_id: r.id,
    revision: r.revision,
    external_ref: "idempotent-ref",
    outcome: "not_started",
    result: "外部サービスの照会により未送信を確認",
    evidence,
  });
  assert.equal(r.status, "cancelled");
  assert.equal(
    (
      await env.DB.prepare("SELECT count(*) n FROM wf_tasks WHERE run_id=?")
        .bind(r.id)
        .first()
    ).n,
    1,
  );
  const history = (await workflowRead(env, { run_id: r.id })).history;
  assert.ok(history.every((h) => !h.snapshot.includes(lease.token)));
  assert.ok(
    history.some(
      (h) => JSON.parse(h.snapshot).external?.ref === "idempotent-ref",
    ),
  );
  // New sample run: owner resumes after a proven non-dispatch, using exactly the same reference.
  const d = (await workflowRead(env)).definitions[0];
  r = await write(
    env,
    {
      action: "start",
      definition_id: d.id,
      revision: d.revision,
      request_id: "retry-sample",
    },
    true,
  );
  lease = await exec(env, {
    action: "claim",
    run_id: r.id,
    revision: r.revision,
  });
  r = await exec(env, {
    action: "external_begin",
    run_id: r.id,
    revision: lease.revision,
    generation: lease.generation,
    token: lease.token,
    external_ref: "same-ref",
    result: "dispatch planned",
  });
  r = await write(
    env,
    { action: "pause", run_id: r.id, revision: r.revision },
    true,
  );
  r = await exec(env, {
    action: "reconcile",
    run_id: r.id,
    revision: r.revision,
    external_ref: "same-ref",
    outcome: "not_started",
    result: "confirmed never dispatched",
    evidence,
  });
  r = await write(
    env,
    { action: "resume", run_id: r.id, revision: r.revision },
    true,
  );
  lease = await exec(env, {
    action: "claim",
    run_id: r.id,
    revision: r.revision,
  });
  r = await exec(env, {
    action: "external_begin",
    run_id: r.id,
    revision: lease.revision,
    generation: lease.generation,
    token: lease.token,
    external_ref: "same-ref",
    result: "safe retry with original idempotency reference",
  });
  assert.equal(r.data.external.ref, "same-ref");
  r = await exec(env, {
    action: "external_result",
    run_id: r.id,
    revision: r.revision,
    generation: lease.generation,
    token: lease.token,
    external_ref: "same-ref",
    outcome: "completed",
    result: "同じ参照の成果物を取得",
    evidence,
  });
  r = await exec(env, {
    action: "renew",
    run_id: r.id,
    revision: r.revision,
    generation: lease.generation,
    token: lease.token,
  });
  r = await exec(env, {
    action: "checkpoint",
    run_id: r.id,
    revision: r.revision,
    generation: lease.generation,
    token: lease.token,
    next_work: "最終条件を確認",
  });
  assert.equal(r.data.next_work, "最終条件を確認");
  r = await exec(env, {
    action: "complete",
    run_id: r.id,
    revision: r.revision,
    generation: lease.generation,
    token: lease.token,
    ...completion,
  });
  assert.equal(r.status, "completed");
});

test("completed external operations cannot regress or be dispatched again", async (t) => {
  const { env, create } = await fixture(t);
  await create({ ...content, tasks: [{ ...content.tasks[0], gate: false }] });
  await exec(env, { action: "patrol" });
  let r = (await workflowRead(env)).runs[0];
  let lease = await exec(env, {
    action: "claim",
    run_id: r.id,
    revision: r.revision,
  });
  const fenced = () => ({
    run_id: r.id,
    revision: r.revision,
    generation: lease.generation,
    token: lease.token,
  });
  r = lease;
  r = await exec(env, {
    action: "external_begin",
    ...fenced(),
    external_ref: "completed-job",
    result: "synthetic dispatch",
  });
  r = await exec(env, {
    action: "external_result",
    ...fenced(),
    external_ref: "completed-job",
    outcome: "completed",
    result: "verified external completion",
    evidence,
  });
  const completed = structuredClone(r);
  for (const outcome of ["unknown", "not_started"]) {
    await assert.rejects(
      () =>
        exec(env, {
          action: "external_result",
          ...fenced(),
          external_ref: "completed-job",
          outcome,
          result: "late conflicting observation",
          evidence,
        }),
      { status: 409 },
    );
    assert.deepEqual(
      (await workflowRead(env, { run_id: r.id })).run,
      completed,
    );
  }
  r = await exec(env, {
    action: "wait",
    ...fenced(),
    reason: "await owner review after external completion",
  });
  const waiting = structuredClone(r);
  for (const outcome of ["unknown", "not_started"]) {
    await assert.rejects(
      () =>
        exec(env, {
          action: "reconcile",
          run_id: r.id,
          revision: r.revision,
          external_ref: "completed-job",
          outcome,
          result: "late conflicting observation",
          evidence,
        }),
      { status: 409 },
    );
    assert.deepEqual((await workflowRead(env, { run_id: r.id })).run, waiting);
  }
  r = await exec(env, {
    action: "reconcile",
    run_id: r.id,
    revision: r.revision,
    external_ref: "completed-job",
    outcome: "completed",
    result: "same completed job verified again",
    evidence,
  });
  r = await write(
    env,
    { action: "resume", run_id: r.id, revision: r.revision },
    true,
  );
  lease = await exec(env, {
    action: "claim",
    run_id: r.id,
    revision: r.revision,
  });
  r = lease;
  await assert.rejects(
    () =>
      exec(env, {
        action: "external_begin",
        ...fenced(),
        external_ref: "completed-job",
        result: "must never resend completed operation",
      }),
    { status: 409 },
  );
  assert.equal(
    (await workflowRead(env, { run_id: r.id })).run.data.external.state,
    "completed",
  );
});

for (const outcome of ["completed", "not_started"]) {
  test(`global stop preserves pending cancellation until external ${outcome} is reconciled`, async (t) => {
    const { env, create } = await fixture(t);
    await create({ ...content, tasks: [{ ...content.tasks[0], gate: false }] });
    await exec(env, { action: "patrol" });
    let r = (await workflowRead(env)).runs[0];
    const lease = await exec(env, {
      action: "claim",
      run_id: r.id,
      revision: r.revision,
    });
    r = await exec(env, {
      action: "external_begin",
      run_id: r.id,
      revision: lease.revision,
      generation: lease.generation,
      token: lease.token,
      external_ref: "cancelled-job",
      result: "synthetic operation",
    });
    r = await write(
      env,
      { action: "cancel", run_id: r.id, revision: r.revision },
      true,
    );
    assert.equal(r.status, "waiting");
    assert.equal(r.data.requested_stop, "cancelled");
    const cfg = (await workflowRead(env)).settings;
    await write(env, { action: "stop_all", revision: cfg.revision }, true);
    r = (await workflowRead(env, { run_id: r.id })).run;
    assert.equal(r.status, "waiting");
    assert.equal(r.data.requested_stop, "cancelled");
    r = await exec(env, {
      action: "reconcile",
      run_id: r.id,
      revision: r.revision,
      external_ref: "cancelled-job",
      outcome,
      result: "verified same external operation",
      evidence,
    });
    assert.equal(r.status, "cancelled");
    assert.equal(r.data.external.state, outcome);
    await assert.rejects(
      () =>
        write(
          env,
          { action: "resume", run_id: r.id, revision: r.revision },
          true,
        ),
      { status: 409 },
    );
  });
}

test("hour intervals validate integer bounds without changing legacy definitions", () => {
  const schema = workflowTools.find((t) => t.name === "draft_workflow")
    .inputSchema.properties.content.properties;
  assert.deepEqual(schema.repeat.enum, ["once", "hourly", "daily", "weekly"]);
  assert.equal(schema.interval_hours.minimum, 1);
  assert.equal(schema.interval_hours.maximum, 8760);
  for (const interval_hours of [
    undefined,
    null,
    "3",
    0,
    -1,
    1.5,
    8761,
    Infinity,
    NaN,
  ])
    assert.throws(
      () => validateWorkflow({ ...content, repeat: "hourly", interval_hours }),
      /interval_hours/,
    );
  for (const interval_hours of [1, 3, 24, 8760])
    assert.equal(
      validateWorkflow({ ...content, repeat: "hourly", interval_hours })
        .interval_hours,
      interval_hours,
    );
  for (const repeat of ["once", "daily", "weekly"])
    assert.equal(
      Object.hasOwn(validateWorkflow({ ...content, repeat }), "interval_hours"),
      false,
    );
});

test("hourly schedules keep JST anchor, snapshots, unique slots and coalesce overdue work", async (t) => {
  const { env, create } = await fixture(t);
  for (const hours of [1, 3, 24]) {
    const start = "2020-01-01T09:15:00+09:00";
    const d = await create({
      ...content,
      start,
      repeat: "hourly",
      interval_hours: hours,
    });
    const before = Date.now();
    await Promise.all([
      exec(env, { action: "patrol" }),
      exec(env, { action: "patrol" }),
    ]);
    await exec(env, { action: "patrol" });
    const state = await workflowRead(env),
      runs = state.runs.filter((r) => r.definition_id === d.id);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].scheduled_for, "2020-01-01T00:15:00.000Z");
    assert.equal(runs[0].data.definition.interval_hours, hours);
    const detail = await workflowRead(env, { definition_id: d.id });
    assert.ok(detail.versions.every((v) => v.data.interval_hours === hours));
    const next = Date.parse(detail.definition.next_due),
      period = hours * 3600000;
    assert.ok(next > before && next <= Date.now() + period);
    assert.equal((next - Date.parse(start)) % period, 0);
    // Even after terminal completion, missed slots do not become a backlog.
    await env.DB.prepare(
      "UPDATE wf_runs SET status='completed',revision=revision+1 WHERE id=?",
    )
      .bind(runs[0].id)
      .run();
    await exec(env, { action: "patrol" });
    assert.equal(
      (await workflowRead(env)).runs.filter((r) => r.definition_id === d.id)
        .length,
      1,
    );
  }
  for (const repeat of ["daily", "weekly"]) {
    const d = await create({ ...content, repeat });
    await exec(env, { action: "patrol" });
    const got = (await workflowRead(env, { definition_id: d.id })).definition;
    assert.equal(
      Date.parse(got.next_due) - Date.parse(content.start),
      repeat === "daily" ? 86400000 : 604800000,
    );
  }
});

test("scheduled repeats never overlap unfinished runs, respect global/definition stops and future start", async (t) => {
  const { env, create } = await fixture(t);
  const future = await create({
    ...content,
    repeat: "hourly",
    interval_hours: 3,
    start: new Date(Date.now() + 3600000).toISOString(),
  });
  await exec(env, { action: "patrol" });
  assert.equal((await workflowRead(env)).runs.length, 0);
  for (const status of ["queued", "running", "review", "waiting", "paused"]) {
    const d = await create({ ...content, repeat: "hourly", interval_hours: 3 });
    const r = await write(
      env,
      {
        action: "start",
        definition_id: d.id,
        revision: d.revision,
        request_id: status,
      },
      true,
    );
    await env.DB.prepare(
      "UPDATE wf_runs SET status=?,data=json_set(data,'$.external',json(?)),lease_until=?,revision=revision+1 WHERE id=?",
    )
      .bind(
        status,
        JSON.stringify({ ref: "synthetic-job", state: "unknown" }),
        Date.now() + 3600000,
        r.id,
      )
      .run();
    await Promise.all([
      exec(env, { action: "patrol" }),
      exec(env, { action: "patrol" }),
    ]);
    const runs = (await workflowRead(env)).runs.filter(
      (r) => r.definition_id === d.id,
    );
    assert.equal(runs.length, 1, status);
    assert.equal(runs[0].status, status);
    assert.equal(runs[0].data.external.state, "unknown");
    assert.equal(
      (await workflowRead(env, { definition_id: d.id })).definition.next_due,
      d.next_due,
    );
    await write(env, {
      action: "schedule_stop",
      definition_id: d.id,
      revision: d.revision,
    });
  }
  const d = await create({ ...content, repeat: "hourly", interval_hours: 1 });
  await write(
    env,
    {
      action: "stop_all",
      revision: (await workflowRead(env)).settings.revision,
    },
    true,
  );
  await exec(env, { action: "patrol" });
  assert.equal(
    (await workflowRead(env)).runs.filter(
      (r) => r.definition_id === d.id || r.definition_id === future.id,
    ).length,
    0,
  );
});

async function installRoles(env) {
  const sql = await readFile(
    new URL("../workflow-migrations/0002-roles.sql", import.meta.url),
    "utf8",
  );
  await env.DB.batch(
    sql
      .replace(/^--.*$/gm, "")
      .split(/(?=^CREATE )/m)
      .filter((x) => x.trim())
      .map((x) => env.DB.prepare(x)),
  );
}
const roleContent = {
  name: "調査",
  responsibilities: "原典を確認",
  operations: "指定資料の読み取りのみ",
  completion: "根拠URLを確認",
  icon: "◆",
  color: "sky",
};
const planContent = {
  role_id: null,
  instruction: "資料を確認する",
  rationale: "期限と優先順位を確認、前工程の完了後",
  planned_for: null,
};
test("role migration is additive, owner isolated, CAS protected and historical labels survive archival", async (t) => {
  const { env, create } = await fixture(t);
  await create();
  const before = await workflowRead(env);
  assert.equal(before.roles, null);
  await installRoles(env);
  assert.deepEqual((await workflowRead(env)).runs, before.runs);
  assert.deepEqual((await workflowRead(env)).definitions, before.definitions);
  await assert.rejects(
    () => write(env, { action: "role_create", content: roleContent }),
    { status: 403 },
  );
  const role = await write(
    env,
    { action: "role_create", content: roleContent },
    true,
  );
  await assert.rejects(
    () =>
      write(
        { ...env, ALLOWED_EMAIL: "other@example.test" },
        {
          action: "role_edit",
          role_id: role.id,
          revision: 1,
          content: roleContent,
        },
        true,
      ),
    { status: 404 },
  );
  const edits = await Promise.allSettled(
    [1, 2].map((i) =>
      write(
        env,
        {
          action: "role_edit",
          role_id: role.id,
          revision: 1,
          content: { ...roleContent, name: "調査" + i },
        },
        true,
      ),
    ),
  );
  assert.equal(edits.filter((x) => x.status === "fulfilled").length, 1);
  const d = await create({
    ...content,
    tasks: [{ ...content.tasks[0], role_id: role.id }],
  });
  let r = await write(
    env,
    {
      action: "start",
      definition_id: d.id,
      revision: d.revision,
      request_id: "role-history",
    },
    true,
  );
  assert.equal(r.data.tasks[0].role_snapshot.id, role.id);
  await assert.rejects(
    () =>
      write(
        env,
        { action: "role_archive", role_id: role.id, revision: 2 },
        true,
      ),
    { status: 409 },
  );
  r = await write(env, {
    action: "plan_suggest",
    run_id: r.id,
    revision: r.revision,
    plan: planContent,
  });
  r = await write(
    env,
    {
      action: "plan_apply",
      run_id: r.id,
      revision: r.revision,
      authorized: true,
    },
    true,
  );
  assert.equal(r.data.tasks[0].role_id, null);
  await write(
    env,
    { action: "archive", definition_id: d.id, revision: d.revision },
    true,
  );
  await write(
    env,
    { action: "role_archive", role_id: role.id, revision: 2 },
    true,
  );
  assert.equal((await workflowRead(env)).roles[0].archived, 1);
  const history = (await workflowRead(env, { run_id: r.id })).history;
  assert(
    history.some(
      (h) => JSON.parse(h.snapshot).tasks[0].role_snapshot?.id === role.id,
    ),
  );
  await assert.rejects(
    () =>
      create({
        ...content,
        tasks: [{ ...content.tasks[0], role_id: role.id }],
      }),
    { status: 409 },
  );
  // SQLite guards reject a stale concurrent assignment after archival too.
  await assert.rejects(
    () =>
      env.DB.prepare("INSERT INTO wf_definitions(id,owner,data) VALUES(?,?,?)")
        .bind(
          "stale",
          env.ALLOWED_EMAIL,
          JSON.stringify({
            ...content,
            tasks: [{ ...content.tasks[0], role_id: role.id }],
          }),
        )
        .run(),
    /role unavailable/,
  );
});
test("planning proposals preserve execution authorization, fixed assignments, running instructions and concurrency fences", async (t) => {
  const { env, create } = await fixture(t);
  await installRoles(env);
  let d = await create(),
    r = await write(
      env,
      {
        action: "start",
        definition_id: d.id,
        revision: d.revision,
        request_id: "plan",
      },
      true,
    );
  const original = structuredClone(r.data);
  const suggestions = await Promise.allSettled(
    [1, 2].map(() =>
      write(env, {
        action: "plan_suggest",
        run_id: r.id,
        revision: r.revision,
        plan: planContent,
      }),
    ),
  );
  assert.equal(suggestions.filter((x) => x.status === "fulfilled").length, 1);
  r = (await workflowRead(env, { run_id: r.id })).run;
  assert.deepEqual(
    r.data.tasks.map(({ plan_suggestion, ...task }) => task),
    original.tasks,
  );
  await assert.rejects(
    () =>
      write(env, {
        action: "plan_apply",
        run_id: r.id,
        revision: r.revision,
        authorized: true,
      }),
    { status: 403 },
  );
  r = await write(
    env,
    {
      action: "plan_apply",
      run_id: r.id,
      revision: r.revision,
      authorized: true,
    },
    true,
  );
  assert.equal(r.data.tasks[0].assignee, original.tasks[0].assignee);
  assert.equal(r.data.tasks[0].gate, true);
  assert.equal(r.data.definition.permissions, original.definition.permissions);
  r = await exec(env, { action: "claim", run_id: r.id, revision: r.revision });
  const claimed = r;
  r = await write(env, {
    action: "plan_suggest",
    run_id: r.id,
    revision: r.revision,
    plan: { ...planContent, instruction: "実行中への新しい案" },
  });
  assert.equal(r.data.tasks[0].instruction, planContent.instruction);
  assert.equal(r.generation, claimed.generation);
  await assert.rejects(
    () =>
      write(
        env,
        {
          action: "plan_apply",
          run_id: r.id,
          revision: r.revision,
          authorized: true,
        },
        true,
      ),
    { status: 409 },
  );
  // Existing executor must reread after proposal revision; external effects still use original instructions.
  await assert.rejects(
    () =>
      exec(env, {
        action: "external_begin",
        run_id: r.id,
        revision: claimed.revision,
        generation: claimed.generation,
        token: claimed.token,
        external_ref: "synthetic-key",
        result: "read",
      }),
    { status: 409 },
  );
  d = await create({
    ...content,
    tasks: [{ ...content.tasks[0], fixed: true }],
  });
  const fixed = await write(
    env,
    {
      action: "start",
      definition_id: d.id,
      revision: d.revision,
      request_id: "fixed",
    },
    true,
  );
  await assert.rejects(
    () =>
      write(env, {
        action: "plan_suggest",
        run_id: fixed.id,
        revision: fixed.revision,
        plan: planContent,
      }),
    { status: 409 },
  );
});
test("approved future plans cannot be claimed early; terminal work and external settings stay untouched", async (t) => {
  const { env, create } = await fixture(t);
  await installRoles(env);
  const d = await create();
  let r = await write(
    env,
    {
      action: "start",
      definition_id: d.id,
      revision: d.revision,
      request_id: "future-plan",
    },
    true,
  );
  const cfg = (await workflowRead(env)).settings;
  r = await write(env, {
    action: "plan_suggest",
    run_id: r.id,
    revision: r.revision,
    plan: { ...planContent, planned_for: "2099-01-01T09:00:00+09:00" },
  });
  r = await write(
    env,
    {
      action: "plan_apply",
      run_id: r.id,
      revision: r.revision,
      authorized: true,
    },
    true,
  );
  await assert.rejects(
    () => exec(env, { action: "claim", run_id: r.id, revision: r.revision }),
    { status: 409 },
  );
  r = await write(
    env,
    { action: "cancel", run_id: r.id, revision: r.revision },
    true,
  );
  await assert.rejects(
    () =>
      write(env, {
        action: "plan_suggest",
        run_id: r.id,
        revision: r.revision,
        plan: planContent,
      }),
    { status: 409 },
  );
  assert.deepEqual((await workflowRead(env)).settings, cfg);
});

test("bounded planning covers future pending tasks, keeps active instructions/leases and routes role workers explicitly", async (t) => {
  const { env, create } = await fixture(t);
  await installRoles(env);
  const a = await write(
    env,
    { action: "role_create", content: roleContent },
    true,
  );
  const b = await write(
    env,
    { action: "role_create", content: { ...roleContent, name: "校正" } },
    true,
  );
  const policy = {
    enabled: true,
    revise_instructions: true,
    role_ids: [a.id, b.id],
  };
  const d = await create({
    ...content,
    start: new Date().toISOString(),
    planning_policy: policy,
    tasks: [0, 1, 2].map((i) => ({
      ...content.tasks[0],
      title: "工程" + i,
      role_id: a.id,
    })),
  });
  let r = await write(
    env,
    {
      action: "start",
      definition_id: d.id,
      revision: d.revision,
      request_id: "bounded",
    },
    true,
  );
  const initialTask = structuredClone(r.data.tasks[0]);
  const later = {
    ...planContent,
    task_index: 2,
    role_id: b.id,
    planned_for: new Date(Date.now() + 3 * 3600000).toISOString(),
    instruction: "同じ完了条件に沿って照合",
  };
  r = await write(env, {
    action: "plan_update",
    run_id: r.id,
    revision: r.revision,
    plan: later,
  });
  assert.deepEqual(r.data.tasks[0], initialTask);
  await assert.rejects(
    () =>
      exec(env, {
        action: "claim",
        run_id: r.id,
        revision: r.revision,
        role_id: b.id,
        worker_id: "proofreader",
      }),
    { status: 409 },
  );
  const claim = await exec(env, {
    action: "claim",
    run_id: r.id,
    revision: r.revision,
    role_id: a.id,
    worker_id: "researcher",
  });
  assert.equal(claim.dispatch.route, "role:" + a.id);
  assert.equal(claim.data.worker.id, "researcher");
  const second = await write(
    env,
    {
      action: "start",
      definition_id: d.id,
      revision: d.revision,
      request_id: "second-role-lane",
    },
    true,
  );
  await assert.rejects(
    () =>
      exec(env, {
        action: "claim",
        run_id: second.id,
        revision: second.revision,
        role_id: a.id,
        worker_id: "another-researcher",
      }),
    { status: 409 },
  );
  const leaseBefore = await env.DB.prepare(
    "SELECT lease_token,lease_until,generation FROM wf_runs WHERE id=?",
  )
    .bind(r.id)
    .first();
  r = await write(env, {
    action: "plan_update",
    run_id: r.id,
    revision: claim.revision,
    plan: {
      ...later,
      task_index: 1,
      planned_for: new Date(Date.now() + 2 * 3600000).toISOString(),
    },
  });
  assert.deepEqual(
    await env.DB.prepare(
      "SELECT lease_token,lease_until,generation FROM wf_runs WHERE id=?",
    )
      .bind(r.id)
      .first(),
    leaseBefore,
  );
  assert.equal(r.data.tasks[0].instruction, undefined);
  assert.equal(r.data.tasks[1].instruction, later.instruction);
  assert.equal(r.data.definition.permissions, content.permissions);
  await assert.rejects(
    () =>
      write(env, {
        action: "plan_update",
        run_id: r.id,
        revision: r.revision,
        plan: { ...later, task_index: 0 },
      }),
    { status: 409 },
  );
  await assert.rejects(
    () =>
      exec(env, {
        action: "renew",
        run_id: r.id,
        revision: r.revision,
        generation: claim.generation,
        token: claim.token,
        worker_id: "proofreader",
      }),
    { status: 409 },
  );
  await exec(env, {
    action: "renew",
    run_id: r.id,
    revision: r.revision,
    generation: claim.generation,
    token: claim.token,
    worker_id: "researcher",
  });
});
test("rolling planner previews without writes, applies per-Run atomically within prior owner bounds, respects stops and stale revisions", async (t) => {
  const { env, create } = await fixture(t);
  await installRoles(env);
  const role = await write(
    env,
    { action: "role_create", content: roleContent },
    true,
  );
  const d = await create({
    ...content,
    start: new Date().toISOString(),
    planning_policy: {
      enabled: true,
      revise_instructions: false,
      role_ids: [role.id],
    },
    tasks: [
      { ...content.tasks[0], role_id: role.id },
      { ...content.tasks[0], role_id: role.id },
    ],
  });
  let r = await write(
    env,
    {
      action: "start",
      definition_id: d.id,
      revision: d.revision,
      request_id: "rolling",
    },
    true,
  );
  const targets = [{ run_id: r.id, revision: r.revision }];
  const preview = await workflowPlanning(env, { action: "preview", targets });
  assert.equal(preview.plans.length, 2);
  assert.equal(
    (await workflowRead(env, { run_id: r.id })).run.revision,
    r.revision,
  );
  await assert.rejects(
    () =>
      write(env, {
        action: "plan_update",
        run_id: r.id,
        revision: r.revision,
        plan: { ...preview.plans[0].plan, instruction: "別の指示" },
      }),
    { status: 403 },
  );
  await assert.rejects(
    () =>
      write(env, {
        action: "plan_update",
        run_id: r.id,
        revision: r.revision,
        plan: { ...preview.plans[0].plan, role_id: "outside" },
      }),
    { status: 403 },
  );
  await assert.rejects(
    () =>
      write(env, {
        action: "plan_update",
        run_id: r.id,
        revision: r.revision,
        plan: { ...preview.plans[0].plan, planned_for: "2099-01-01T00:00:00Z" },
      }),
    { status: 400 },
  );
  const applied = await workflowPlanning(env, { action: "apply", targets });
  assert.equal(applied.conflicts.length, 0);
  assert.equal(applied.updated.length, 1);
  r = (await workflowRead(env, { run_id: r.id })).run;
  assert.equal(r.revision, targets[0].revision + 1);
  assert.equal(r.data.tasks[1].planned_for, preview.plans[1].plan.planned_for);
  await assert.rejects(
    () => workflowPlanning(env, { action: "apply", targets }),
    { status: 409 },
  );
  const cfg = (await workflowRead(env)).settings;
  await write(env, { action: "stop_all", revision: cfg.revision }, true);
  r = (await workflowRead(env, { run_id: r.id })).run;
  await assert.rejects(
    () =>
      write(env, {
        action: "plan_update",
        run_id: r.id,
        revision: r.revision,
        plan: preview.plans[0].plan,
      }),
    { status: 409 },
  );
  const legacy = await create();
  const old = await write(
    env,
    {
      action: "start",
      definition_id: legacy.id,
      revision: legacy.revision,
      request_id: "legacy-stopped",
    },
    true,
  ).catch((e) => null);
  assert.equal(old, null); // Planning never overrides global stop or creates jobs.
});

async function installStaging(env) {
  const sql = await readFile(
    new URL("../workflow-migrations/0003-staged-plans.sql", import.meta.url),
    "utf8",
  );
  await env.DB.batch(
    sql
      .replace(/^--.*$/gm, "")
      .split(/(?=^CREATE )/m)
      .filter((x) => x.trim())
      .map((x) => env.DB.prepare(x)),
  );
}
test("future slot plans are inert, versioned and isolated; due Runs consume only the unchanged approved definition snapshot", async (t) => {
  const { env, create } = await fixture(t);
  await installRoles(env);
  await installStaging(env);
  const start = new Date(Date.now() + 3600000).toISOString();
  const d = await create({
    ...content,
    start,
    planning_policy: { enabled: true, revise_instructions: true, role_ids: [] },
  });
  const args = {
    action: "stage_plan",
    definition_id: d.id,
    definition_revision: d.revision,
    scheduled_for: start,
    stage_revision: 0,
    mode: "apply",
    plan: {
      ...planContent,
      task_index: 0,
      planned_for: start,
      instruction: "指定資料を照合して出典を記録",
    },
  };
  const before = await workflowRead(env);
  const staged = await write(env, args);
  assert.equal(staged.revision, 1);
  assert.equal((await workflowRead(env)).runs.length, 0);
  assert.deepEqual((await workflowRead(env)).definitions, before.definitions);
  assert.deepEqual((await workflowRead(env)).settings, before.settings);
  assert.equal((await workflowRead(env)).staged_plans.plans[0].current, 1);
  await assert.rejects(() => write(env, args), { status: 409 });
  await assert.rejects(
    () =>
      write(
        { ...env, ALLOWED_EMAIL: "other@example.test" },
        { ...args, stage_revision: 1 },
      ),
    { status: 404 },
  );
  await assert.rejects(
    () =>
      write(env, {
        ...args,
        scheduled_for: new Date(Date.parse(start) + 60000).toISOString(),
        stage_revision: 1,
      }),
    { status: 409 },
  );
  const realNow = Date.now;
  try {
    Date.now = () => Date.parse(start) + 1000;
    await exec(env, { action: "patrol" });
  } finally {
    Date.now = realNow;
  }
  const r = (await workflowRead(env)).runs[0];
  assert.equal(r.data.tasks[0].instruction, args.plan.instruction);
  assert.equal(r.data.staged_source.revision, 1);
  assert.equal(r.data.definition.permissions, content.permissions);
  await assert.rejects(() => write(env, { ...args, stage_revision: 1 }), {
    status: 409,
  });
  assert.equal((await workflowRead(env)).runs.length, 1);
  assert.equal((await workflowRead(env)).staged_plans.plans[0].current, 0);
});
test("rolling future planning creates no Runs, requires prior bounds and ignores plans after content reapproval changes", async (t) => {
  const { env, create } = await fixture(t);
  await installRoles(env);
  await installStaging(env);
  const start = new Date(Date.now() + 3600000).toISOString();
  let d = await create({
    ...content,
    start,
    planning_policy: { enabled: true, revise_instructions: true, role_ids: [] },
  });
  const targets = [
    {
      definition_id: d.id,
      revision: d.revision,
      scheduled_for: start,
      stage_revision: 0,
    },
  ];
  const preview = await workflowPlanning(env, { action: "preview", targets });
  assert.equal(preview.plans.length, 2);
  assert(
    preview.plans.every(
      (p) => Date.parse(p.plan.planned_for) >= Date.parse(start),
    ),
  );
  const result = await workflowPlanning(env, { action: "apply", targets });
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.updated[0].stage_revision, 1);
  assert.equal((await workflowRead(env)).runs.length, 0);
  d = await write(env, {
    action: "schedule_stop",
    definition_id: d.id,
    revision: d.revision,
  });
  d = await write(env, {
    action: "edit",
    definition_id: d.id,
    revision: d.revision,
    content: { ...d.data, purpose: "本人が目的を改稿" },
  });
  d = await write(
    env,
    {
      action: "publish",
      definition_id: d.id,
      revision: d.revision,
      authorized: true,
    },
    true,
  );
  assert.equal((await workflowRead(env)).staged_plans.plans[0].current, 0);
  const realNow = Date.now;
  try {
    Date.now = () => Date.parse(start) + 1000;
    await exec(env, { action: "patrol" });
  } finally {
    Date.now = realNow;
  }
  const r = (await workflowRead(env)).runs[0];
  assert.equal(r.data.tasks[0].instruction, undefined);
  assert.equal(r.data.staged_source.revision, 1); // Audits the ignored staged version as well.
});

test("staging/instantiation race never starts a stale plan, and unadopted future suggestions never become instructions", async (t) => {
  const { env, create } = await fixture(t);
  await installRoles(env);
  await installStaging(env);
  const start = new Date(Date.now() + 3600000).toISOString();
  const d = await create({
    ...content,
    start,
    planning_policy: { enabled: true, revise_instructions: true, role_ids: [] },
  });
  const args = {
    action: "stage_plan",
    definition_id: d.id,
    definition_revision: d.revision,
    scheduled_for: start,
    stage_revision: 0,
    mode: "apply",
    plan: { ...planContent, planned_for: start, instruction: "初版の指示" },
  };
  await write(env, args);
  let injected = false;
  const wrap = (statement, sql) =>
    new Proxy(statement, {
      get(target, key) {
        if (key === "bind")
          return (...values) => wrap(target.bind(...values), sql);
        if (key === "run" && sql.startsWith("INSERT OR IGNORE INTO wf_runs"))
          return async () => {
            if (!injected) {
              injected = true;
              await write(env, {
                ...args,
                stage_revision: 1,
                plan: { ...args.plan, instruction: "競合後の指示" },
              });
            }
            return target.run();
          };
        const v = target[key];
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
  const raced = {
    ...env,
    DB: { prepare: (sql) => wrap(env.DB.prepare(sql), sql) },
  };
  const realNow = Date.now;
  try {
    Date.now = () => Date.parse(start);
    await exec(raced, { action: "patrol" });
    assert.equal((await workflowRead(env)).runs.length, 0);
    assert.equal((await workflowRead(env)).definitions[0].next_due, start);
    await exec(env, { action: "patrol" });
  } finally {
    Date.now = realNow;
  }
  const run = (await workflowRead(env)).runs[0];
  assert.equal(run.data.tasks[0].instruction, "競合後の指示");
  assert.equal(run.data.staged_source.revision, 2);
  const legacy = await create({ ...content, start });
  const suggestion = {
    ...args,
    definition_id: legacy.id,
    definition_revision: legacy.revision,
    mode: "suggest",
    plan: { ...args.plan, instruction: "未承認の案" },
  };
  await write(env, suggestion);
  await assert.rejects(
    () => write(env, { ...suggestion, mode: "apply", stage_revision: 1 }),
    { status: 403 },
  );
  try {
    Date.now = () => Date.parse(start);
    await exec(env, { action: "patrol" });
  } finally {
    Date.now = realNow;
  }
  const legacyRun = (await workflowRead(env)).runs.find(
    (r) => r.definition_id === legacy.id,
  );
  assert.equal(legacyRun.data.tasks[0].instruction, undefined);
  assert.equal(legacyRun.data.staged_source.applied, false);
});

test("future manual role assignment blocks archival until reassigned and preserves staged history", async (t) => {
  const { env, create } = await fixture(t);
  await installRoles(env);
  await installStaging(env);
  const role = await write(
    env,
    { action: "role_create", content: roleContent },
    true,
  );
  const start = new Date(Date.now() + 3600000).toISOString(),
    d = await create({ ...content, start });
  const args = {
    action: "stage_plan",
    definition_id: d.id,
    definition_revision: d.revision,
    scheduled_for: start,
    stage_revision: 0,
    mode: "apply",
    authorized: true,
    plan: { ...planContent, role_id: role.id, planned_for: start },
  };
  const staged = await write(env, args, true);
  await assert.rejects(
    () =>
      write(
        env,
        { action: "role_archive", role_id: role.id, revision: 1 },
        true,
      ),
    { status: 409 },
  );
  await write(
    env,
    { ...args, stage_revision: 1, plan: { ...args.plan, role_id: null } },
    true,
  );
  await write(
    env,
    { action: "role_archive", role_id: role.id, revision: 1 },
    true,
  );
  const detail = await workflowRead(env, { stage_id: staged.id });
  assert.equal(detail.history.length, 2);
  assert(
    detail.history.some(
      (h) => JSON.parse(h.snapshot).data.plans[0].role_snapshot?.id === role.id,
    ),
  );
  assert.equal((await workflowRead(env)).runs.length, 0);
});
