import test from "node:test";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import { readFile } from "node:fs/promises";
import { createHmac } from "node:crypto";
import worker from "../src/index.js";
import { validateContent, callWikiTool } from "../src/wiki.js";
import { renderMarkdown } from "../../wiki/markdown.js";
const origin = "https://wiki.example.test";
const content = {
  title: "合成Wiki",
  body: "# Knowledge\n\n[citation](https://example.test/source)",
  sources: [
    {
      type: "web",
      url: "https://example.test/source",
      location: "§1",
      checked_at: "2026-10-12",
    },
  ],
  tags: ["test"],
  aliases: ["別名"],
  links: [],
  status: "draft",
};
async function fixture() {
  const mf = new Miniflare({
    modules: true,
    script: 'export default {fetch(){return new Response("ok")}}',
    compatibilityDate: "2026-08-01",
    d1Databases: { DB: "wiki-auth", WIKI_DB: "wiki-data" },
  });
  const env = {
    DB: await mf.getD1Database("DB"),
    WIKI_DB: await mf.getD1Database("WIKI_DB"),
    SESSION_SECRET: "synthetic-only",
    WORKS_API_KEY: "synthetic-only-key",
    ALLOWED_EMAIL: "owner@example.test",
    ALLOWED_ORIGIN: origin,
  };
  const sql = await readFile(
    new URL("../wiki-migrations/0001-wiki.sql", import.meta.url),
    "utf8",
  );
  await env.WIKI_DB.batch(
    sql
      .split(/(?=^CREATE )/m)
      .filter((s) => s.trim())
      .map((s) => env.WIKI_DB.prepare(s)),
  );
  const token = (payload) => {
    const b = Buffer.from(
      JSON.stringify({
        email: env.ALLOWED_EMAIL,
        exp: Date.now() + 3600000,
        ...payload,
      }),
    ).toString("base64url");
    return (
      b +
      "." +
      createHmac("sha256", env.SESSION_SECRET).update(b).digest("base64url")
    );
  };
  const browser = token({}),
    mcp = token({ aud: "works-mcp", scope: "schedule:read" });
  const api = (
    path,
    body,
    auth = browser,
    method = body ? "POST" : "GET",
    customEnv = env,
  ) =>
    worker.fetch(
      new Request(origin + "/api/wiki/" + path, {
        method,
        headers: {
          Authorization: "Bearer " + auth,
          "Content-Type": "application/json",
          Origin: origin,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      customEnv,
    );
  const call = (name, args, auth = mcp) =>
    worker.fetch(
      new Request(origin + "/mcp", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + auth,
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
  return { mf, env, browser, mcp, api, call };
}
test("Wiki API/MCP ownership, isolation, proposals, CAS, history, restore, archive, export", async (t) => {
  const f = await fixture();
  t.after(() => f.mf.dispose());
  const { api, call, env, mcp } = f;
  assert.equal((await api("pages", null, "")).status, 401);
  assert.equal((await api("pages", null, mcp)).status, 401);
  assert.equal(
    (await api("pages", null, f.browser, "GET", { ...env, WIKI_DB: undefined }))
      .status,
    503,
  );
  let r = await api("pages", content);
  assert.equal(r.status, 200, await r.clone().text());
  let d = await r.json(),
    id = d.page.id;
  assert.equal(d.page.revision, 1);
  assert.equal(d.history.length, 1);
  const tables = (
    await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'",
    ).all()
  ).results;
  assert.equal(
    tables.some((t) => t.name.startsWith("wiki_")),
    false,
  );
  assert.equal((await api("pages/" + id + "/save", { content })).status, 400);
  r = await api("pages/" + id + "/proposals", {
    base_revision: 1,
    content: { ...content, body: "AI draft" },
  });
  const proposal = await r.json();
  assert.ok(proposal.id, JSON.stringify(proposal));
  d = await (await api("pages/" + id)).json();
  assert.equal(d.page.body, content.body);
  const updates = await Promise.all([
    api("pages/" + id + "/save", {
      revision: 1,
      content: { ...content, body: "human A" },
    }),
    api("pages/" + id + "/save", {
      revision: 1,
      content: { ...content, body: "human B" },
    }),
  ]);
  assert.deepEqual(updates.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    (
      await api("pages/" + id + "/accept", {
        revision: 2,
        proposal_id: proposal.id,
      })
    ).status,
    409,
  );
  d = await (await api("pages/" + id)).json();
  assert.equal(d.history.length, 2);
  assert.equal(d.proposals[0].status, "pending");
  r = await api("pages/" + id + "/proposals", {
    base_revision: 2,
    content: { ...content, body: "accepted proposal" },
  });
  const fresh = await r.json();
  const adopted = await Promise.all([
    api("pages/" + id + "/accept", { revision: 2, proposal_id: fresh.id }),
    api("pages/" + id + "/accept", { revision: 2, proposal_id: fresh.id }),
  ]);
  assert.deepEqual(adopted.map((r) => r.status).sort(), [200, 409]);
  d = await (await api("pages/" + id)).json();
  assert.equal(d.page.revision, 3);
  assert.equal(d.page.body, "accepted proposal");
  assert.equal(d.proposals.find((p) => p.id === fresh.id).status, "accepted");
  await assert.rejects(() =>
    env.WIKI_DB.prepare("UPDATE wiki_history SET snapshot='{}'").run(),
  );
  await assert.rejects(() =>
    env.WIKI_DB.prepare("DELETE FROM wiki_history").run(),
  );
  await assert.rejects(() =>
    env.WIKI_DB.prepare("DELETE FROM wiki_pages").run(),
  );
  d = await (
    await api("pages/" + id + "/restore", { revision: 3, target_revision: 1 })
  ).json();
  assert.equal(d.page.revision, 4);
  assert.equal(d.page.body, content.body);
  d = await (await api("pages/" + id + "/archive", { revision: 4 })).json();
  assert.equal(d.page.revision, 5);
  assert.equal(d.page.archived, 1);
  assert.equal((await (await api("pages")).json()).pages.length, 0);
  assert.equal(
    (await (await api("pages?archived=true&q=別名")).json()).pages.length,
    1,
  );
  assert.equal(
    (await api("pages/" + id + "/proposals", { base_revision: 5, content }))
      .status,
    409,
  );
  d = await (
    await api("pages/" + id + "/restore", { revision: 5, target_revision: 1 })
  ).json();
  assert.equal(d.page.revision, 6);
  assert.equal(d.page.archived, 0);
  r = await api("pages/" + id + "/export?format=json");
  d = await r.json();
  assert.equal(d.history.length, 6);
  assert.equal(d.page.sources[0].location, "§1");
  assert.match(
    await (await api("pages/" + id + "/export?format=markdown")).text(),
    /確認日 2026-10-12/,
  );
  assert.equal((await call("get_wiki_page", { page_id: id }, "")).status, 401);
  const read = await (await call("get_wiki_page", { page_id: id })).json();
  assert.ok(!read.result.isError, JSON.stringify(read));
  const denial = await (
    await call("accept_wiki_proposal", { page_id: id, revision: 6 })
  ).json();
  assert.ok(denial.result?.isError || denial.error);
  const created = await (
    await call("create_wiki_page", {
      content: { ...content, status: "confirmed" },
    })
  ).json();
  assert.ok(!created.result.isError, JSON.stringify(created));
  const createdData = JSON.parse(created.result.content[0].text);
  assert.equal(createdData.page.status, "draft");
  assert.equal(
    (await api("pages", { ...content, status: "confirmed", sources: [] }))
      .status,
    400,
  );
  const noSource = await (
    await call("create_wiki_page", { content: { ...content, sources: [] } })
  ).json();
  assert.equal(noSource.result.isError, true);
  await assert.rejects(
    () => callWikiTool(env, "search_wiki_pages", { query: 42 }),
    { status: 400 },
  );
  assert.equal(
    (await api("pages", null, f.browser, "GET", { ...env, WIKI_DB: env.DB }))
      .status,
    503,
  );
  const streaming = await api("pages/" + id + "/export?format=json");
  await api("pages/" + id + "/proposals", {
    base_revision: 6,
    content: { ...content, body: "created during export" },
  });
  const frozen = await streaming.json();
  assert.ok(
    !frozen.proposals.some((p) => p.content.body === "created during export"),
  );
  // Export includes old versions beyond the UI's first page.
  for (let i = 0; i < 101; i++)
    await env.WIKI_DB.prepare(
      "UPDATE wiki_pages SET revision=revision+1 WHERE id=?",
    )
      .bind(id)
      .run();
  d = await (await api("pages/" + id)).json();
  assert.equal(d.history.length, 100);
  assert.equal(d.history_has_more, true);
  const old = await (await api("pages/" + id + "/history?offset=100")).json();
  assert.equal(old.history.length, 7);
  d = await (await api("pages/" + id + "/export?format=json")).json();
  assert.equal(d.history.length, 107);
});
test("Untrusted Markdown and source URLs reject active content; renderer escapes legacy payloads", () => {
  for (const body of [
    "<script>alert(1)</script>",
    "[a](javascript:alert(1))",
    "[a](data:text/html,x)",
    "[a](//evil.test)",
    "[a](https://user:pass@example.test)",
    "[a](java&#115;cript:x)",
    "[ref]: javascript:x",
  ])
    assert.throws(
      () => validateContent({ ...content, body }),
      { status: 400 },
      body,
    );
  for (const url of ["javascript:x", "data:text/html,x", "file:///etc/passwd"])
    assert.throws(
      () =>
        validateContent({
          ...content,
          sources: [{ ...content.sources[0], url }],
        }),
      { status: 400 },
    );
  for (const date of ["not-a-date", "2026-02-30", "2026-13-01"])
    assert.throws(
      () =>
        validateContent({
          ...content,
          sources: [{ ...content.sources[0], checked_at: date }],
        }),
      { status: 400 },
    );
  const html = renderMarkdown(
    '<img src=x onerror=alert(1)>\n[x](javascript:alert(1))\n[x](https://example.test/"onclick="boom)',
  );
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(!html.includes('"onclick="'));
  assert.match(renderMarkdown(content.body), /<h1>Knowledge<\/h1>/);
});
