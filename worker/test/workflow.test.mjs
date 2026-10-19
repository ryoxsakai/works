import test from "node:test";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import { readFile } from "node:fs/promises";
import { createHmac } from "node:crypto";
import worker from "../src/index.js";
import {
  workflowRead,
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
