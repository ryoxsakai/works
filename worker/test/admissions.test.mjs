import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Miniflare } from "miniflare";

async function loadAdmissionFunctions() {
  const sourceUrl = new URL("../src/index.js", import.meta.url);
  const source = await readFile(sourceUrl, "utf8");
  const exposedSource = `${source}\nexport { createMcpAccessToken, handleMcp, ensureAdmissionSchema, listMcpAdmissionEvents };`;
  return import(`data:text/javascript;base64,${Buffer.from(exposedSource).toString("base64")}`);
}

test("admission schedules are available through a read-only MCP tool", async (context) => {
  const functions = await loadAdmissionFunctions();
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } };",
    compatibilityDate: "2026-08-01",
    d1Databases: { DB: "admissions-test" },
  });
  context.after(async () => {
    await miniflare.dispose();
  });

  const db = await miniflare.getD1Database("DB");
  const env = {
    DB: db,
    ALLOWED_EMAIL: "owner@example.com",
    SESSION_SECRET: "admission-test-secret",
  };

  await db.prepare("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)").run();
  await functions.ensureAdmissionSchema(env);
  await db.prepare("INSERT INTO settings (key, value) VALUES ('admission_seed_2027', '{}')").run();
  await db.batch([
    db.prepare("INSERT INTO admission_events (id, university, selection_type, stage, schedule_date) VALUES (?, ?, ?, ?, ?)")
      .bind("a-primary", "A大学医学部", "general", "primary", "2027-02-01"),
    db.prepare("INSERT INTO admission_events (id, university, selection_type, stage, schedule_date) VALUES (?, ?, ?, ?, ?)")
      .bind("a-result", "A大学医学部", "general", "final_result", "2027-02-10"),
    db.prepare("INSERT INTO admission_events (id, university, selection_type, stage, schedule_date) VALUES (?, ?, ?, ?, ?)")
      .bind("b-primary", "B大学医学部", "recommendation", "primary", "2026-11-01"),
  ]);

  const toolsResponse = await functions.handleMcp(
    new Request("https://works.lrnr.jp/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }),
    env,
    new URL("https://works.lrnr.jp/mcp")
  );
  const tool = (await toolsResponse.json()).result.tools.find((item) => item.name === "list_admission_events");
  assert.ok(tool);
  assert.equal(tool.annotations.readOnlyHint, true);

  const listed = await functions.listMcpAdmissionEvents(env, {
    year: 2027,
    selection_type: "general",
  });
  assert.equal(listed.total, 2);
  assert.equal(listed.university_count, 1);
  assert.deepEqual(listed.universities, ["A大学医学部"]);
  assert.deepEqual(listed.events.map((event) => event.id), ["a-primary", "a-result"]);

  const mcpToken = await functions.createMcpAccessToken(env, "schedule:read");
  const callResponse = await functions.handleMcp(
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
          name: "list_admission_events",
          arguments: { year: 2027, stage: "primary", limit: 10 },
        },
      }),
    }),
    env,
    new URL("https://works.lrnr.jp/mcp")
  );
  const payload = await callResponse.json();
  assert.equal(payload.result.structuredContent.total, 1);
  assert.equal(payload.result.structuredContent.events[0].university, "A大学医学部");

  await assert.rejects(
    functions.listMcpAdmissionEvents(env, { date_from: "2027/02/01" }),
    /date_from must be a valid date/
  );
  await assert.rejects(
    functions.listMcpAdmissionEvents(env, { date_to: "2027-02-30" }),
    /date_to must be a valid date/
  );
});
