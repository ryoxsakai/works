import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Miniflare } from "miniflare";

async function loadSsProjectFunctions() {
  const sourceUrl = new URL("../src/index.js", import.meta.url);
  const source = await readFile(sourceUrl, "utf8");
  const exposedSource = `${source}\nexport { createSessionToken, createMcpAccessToken, handleMcp, ensureSsProjectSchema, readSsProjects, createSsProject, updateSsProject, ssProjectRemainingDays };`;
  return import(`data:text/javascript;base64,${Buffer.from(exposedSource).toString("base64")}`);
}

test("SS projects support browser listing and email-sourced MCP updates", async (context) => {
  const functions = await loadSsProjectFunctions();
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } };",
    compatibilityDate: "2026-08-01",
    d1Databases: { DB: "ss-projects-test" },
  });
  context.after(async () => {
    await miniflare.dispose();
  });
  const db = await miniflare.getD1Database("DB");
  const env = {
    DB: db,
    ALLOWED_EMAIL: "owner@example.com",
    SESSION_SECRET: "ss-project-test-secret",
  };

  // 既存環境のメモ列なしテーブルからも自動移行できることを確認する。
  await db.prepare(
    "CREATE TABLE ss_projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL, deadline TEXT NOT NULL, last_source_email_id TEXT, last_source_email_subject TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))"
  ).run();

  const toolsResponse = await functions.handleMcp(
    new Request("https://works.lrnr.jp/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }),
    env,
    new URL("https://works.lrnr.jp/mcp")
  );
  const toolNames = (await toolsResponse.json()).result.tools.map((tool) => tool.name);
  assert.ok(toolNames.includes("list_ss_projects"));
  assert.ok(toolNames.includes("create_ss_project"));
  assert.ok(toolNames.includes("update_ss_project"));

  const created = await functions.createSsProject(env, {
    name: "cheetah",
    status: "素材案作成中",
    deadline: "2026-09-16",
    memo: "高校入試英語1大問。オリジナル作成。",
    source_email_id: "message-001",
    source_email_subject: "cheetah問題作成のお願い",
  });
  assert.equal(created.created, true);
  assert.equal(created.project.name, "cheetah");
  assert.equal(created.project.memo, "高校入試英語1大問。オリジナル作成。");
  assert.equal(created.project.last_source_email_id, "message-001");

  const duplicate = await functions.createSsProject(env, {
    name: " cheetah ",
    status: "素材案作成中",
    deadline: "2026-09-16",
  });
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.project.id, created.project.id);
  await assert.rejects(
    functions.createSsProject(env, {
      name: "cheetah",
      status: "問題作成中",
      deadline: "2026-09-16",
    }),
    /use update_ss_project/
  );

  const mcpToken = await functions.createMcpAccessToken(env, "schedule:read");
  const updateResponse = await functions.handleMcp(
    new Request("https://works.lrnr.jp/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${mcpToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "update_ss_project",
          arguments: {
            project_id: created.project.id,
            status: "素材案確認待ち",
            memo: "作成用ファイル受領済み。",
            source_email_id: "message-002",
            source_email_subject: "Re: cheetah問題作成のお願い",
          },
        },
      }),
    }),
    env,
    new URL("https://works.lrnr.jp/mcp")
  );
  const updatePayload = await updateResponse.json();
  assert.equal(updatePayload.result.structuredContent.updated, true);
  assert.equal(updatePayload.result.structuredContent.project.status, "素材案確認待ち");
  assert.equal(updatePayload.result.structuredContent.project.memo, "作成用ファイル受領済み。");
  assert.deepEqual(updatePayload.result.structuredContent.changed_fields, ["status", "memo"]);

  const projects = await functions.readSsProjects(env);
  assert.equal(projects.length, 1);
  assert.equal(projects[0].last_source_email_id, "message-002");
  assert.equal(functions.ssProjectRemainingDays("2026-09-16", "2026-09-03"), 13);
  assert.equal(functions.ssProjectRemainingDays("2026-09-01", "2026-09-03"), -2);

  const { count: changeCount } = await db.prepare(
    "SELECT COUNT(*) AS count FROM mcp_ss_project_changes WHERE project_id = ?"
  ).bind(created.project.id).first();
  assert.equal(Number(changeCount), 2);

  const sessionToken = await functions.createSessionToken(env, env.ALLOWED_EMAIL);
  const apiResponse = await functions.default.fetch(
    new Request("https://works.lrnr.jp/api/ss-projects", {
      headers: { Authorization: `Bearer ${sessionToken}` },
    }),
    env
  );
  assert.equal(apiResponse.status, 200);
  assert.equal((await apiResponse.json())[0].status, "素材案確認待ち");

  await assert.rejects(
    functions.updateSsProject(env, {
      project_id: created.project.id,
      status: "確認中",
    }),
    /status must be one of/
  );
  await assert.rejects(
    functions.updateSsProject(env, {
      project_id: created.project.id,
      deadline: "2026-02-30",
    }),
    /not a valid date/
  );
});
