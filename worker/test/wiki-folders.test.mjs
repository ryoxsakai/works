import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fixture } from "./wiki-fixture.mjs";
import { renderMarkdown } from "../../wiki/markdown.js";
const content = {
  title: "legacy knowledge",
  body: "原本 **body**",
  sources: [
    { type: "works", id: "fixture", location: "§1", checked_at: "2026-10-12" },
  ],
  tags: ["keep"],
  aliases: ["alias"],
  links: ["related"],
  status: "confirmed",
};
async function ok(response) {
  const r = await response;
  assert.ok(r.ok, await r.clone().text());
  return r.json();
}
test("Migration preserves legacy body/metadata/revision and byte-identical immutable history", async (t) => {
  const f = await fixture({ legacy: true });
  t.after(() => f.mf.dispose());
  const db = f.env.WIKI_DB;
  await db
    .prepare(
      "INSERT INTO wiki_pages(id,title,body,sources,tags,aliases,links,status) VALUES(?,?,?,?,?,?,?,?)",
    )
    .bind(
      "legacy",
      content.title,
      content.body,
      JSON.stringify(content.sources),
      JSON.stringify(content.tags),
      JSON.stringify(content.aliases),
      JSON.stringify(content.links),
      content.status,
    )
    .run();
  const snapshot = (
    await db.prepare("SELECT snapshot FROM wiki_history").first()
  ).snapshot;
  assert.equal((await f.api("pages")).status, 503);
  const sql = await readFile(
    new URL("../wiki-migrations/0002-wiki-folders.sql", import.meta.url),
    "utf8",
  );
  await db.batch(
    sql
      .split(/(?=^(?:CREATE|ALTER|DROP) )/m)
      .filter((s) => s.trim())
      .map((s) => db.prepare(s)),
  );
  const d = await ok(f.api("pages/legacy"));
  assert.equal(d.page.revision, 1);
  assert.equal(d.page.folder_id, null);
  for (const field of ["body", "sources", "tags", "aliases", "links", "status"])
    assert.deepEqual(d.page[field], content[field]);
  assert.equal(
    (await db.prepare("SELECT snapshot FROM wiki_history").first()).snapshot,
    snapshot,
  );
  const { folder } = await ok(f.api("folders", { name: "Medical" }));
  const moved = await ok(
    f.api("pages/legacy/move", {
      revision: 1,
      folder_id: folder.id,
      folder_revision: 1,
    }),
  );
  assert.equal(moved.page.revision, 2);
  assert.equal(moved.history[0].snapshot.folder_id, folder.id);
  const restored = await ok(
    f.api("pages/legacy/restore", { revision: 2, target_revision: 1 }),
  );
  assert.equal(restored.page.revision, 3);
  assert.equal(restored.page.folder_id, null);
  assert.equal(restored.page.body, content.body);
  await assert.rejects(() =>
    db
      .prepare(
        "UPDATE wiki_pages SET folder_id='missing',revision=revision+1 WHERE id='legacy'",
      )
      .run(),
  );
  assert.equal(
    (
      await db
        .prepare("SELECT revision FROM wiki_pages WHERE id='legacy'")
        .first()
    ).revision,
    3,
  );
  await assert.rejects(() =>
    db.prepare("UPDATE wiki_history SET snapshot='{}'").run(),
  );
  assert.equal(
    (
      await f.env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE name LIKE 'wiki_%'",
      ).all()
    ).results.length,
    0,
  );
});
test("Atomic folder/page CAS rejects cycles, duplicate names, invalid targets and stale revisions; MCP remains compatible", async (t) => {
  const f = await fixture();
  t.after(() => f.mf.dispose());
  const { api, call, mcp, env } = f;
  assert.equal((await api("folders", null, "")).status, 401);
  assert.equal((await api("folders", null, mcp)).status, 401);
  const a = (await ok(api("folders", { name: "A" }))).folder;
  const b = (
    await ok(api("folders", { name: "B", parent_id: a.id, parent_revision: 1 }))
  ).folder;
  assert.equal(
    (
      await api("folders/" + a.id, {
        name: "A",
        parent_id: b.id,
        parent_revision: 1,
        revision: 1,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await api("folders/" + a.id, {
        name: "A",
        parent_id: a.id,
        parent_revision: 1,
        revision: 1,
      })
    ).status,
    409,
  );
  assert.equal((await api("folders", { name: "A" })).status, 409);
  assert.equal(
    (
      await api("folders", {
        name: "Missing",
        parent_id: "missing",
        parent_revision: 1,
      })
    ).status,
    400,
  );
  const c = (await ok(api("folders", { name: "C" }))).folder,
    d = (await ok(api("folders", { name: "D" }))).folder;
  const race = await Promise.all([
    api("folders/" + c.id, {
      name: "C",
      parent_id: d.id,
      parent_revision: 1,
      revision: 1,
    }),
    api("folders/" + d.id, {
      name: "D",
      parent_id: c.id,
      parent_revision: 1,
      revision: 1,
    }),
  ]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  const rename = await Promise.all([
    api("folders/" + b.id, {
      name: "B1",
      parent_id: a.id,
      parent_revision: 1,
      revision: 1,
    }),
    api("folders/" + b.id, {
      name: "B2",
      parent_id: a.id,
      parent_revision: 1,
      revision: 1,
    }),
  ]);
  assert.deepEqual(rename.map((r) => r.status).sort(), [200, 409]);
  const page = (
    await ok(api("pages", { ...content, folder_id: a.id, folder_revision: 1 }))
  ).page;
  assert.equal(
    (await api("pages/" + page.id + "/move", { folder_id: null })).status,
    400,
  );
  assert.equal(
    (
      await api("pages/" + page.id + "/move", {
        revision: 1,
        folder_id: "missing",
        folder_revision: 1,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await api("pages/" + page.id + "/move", {
        revision: 1,
        folder_id: b.id,
        folder_revision: 1,
      })
    ).status,
    409,
  );
  const proposal = await ok(
    api("pages/" + page.id + "/proposals", {
      base_revision: 1,
      content: { ...content, body: "draft" },
    }),
  );
  const pm = await Promise.all([
    api("pages/" + page.id + "/move", { revision: 1, folder_id: null }),
    api("pages/" + page.id + "/save", {
      revision: 1,
      content: { ...content, body: "parallel" },
    }),
  ]);
  assert.deepEqual(pm.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    (
      await api("pages/" + page.id + "/accept", {
        revision: 2,
        proposal_id: proposal.id,
      })
    ).status,
    409,
  );
  const originalMcp = await (await call("search_wiki_pages", {})).json();
  assert.ok(!originalMcp.result.isError);
  assert.ok(
    JSON.parse(originalMcp.result.content[0].text).pages.some(
      (p) => p.id === page.id,
    ),
  );
  assert.ok(
    !(await (await call("get_wiki_page", { page_id: page.id })).json()).result
      .isError,
  );
  const folders = await ok(api("folders"));
  assert.equal(folders.folders.length, 4);
  assert.ok(folders.pages.some((p) => p.id === page.id));
  const unclassified = await ok(api("pages?folder_id="));
  assert.ok(unclassified.pages.every((p) => p.folder_id === null));
  const inA = await ok(api("pages?folder_id=" + a.id));
  assert.ok(inA.pages.every((p) => p.folder_id === a.id));
  await assert.rejects(() =>
    env.WIKI_DB.prepare("UPDATE wiki_folders SET parent_id=? WHERE id=?")
      .bind(b.id, a.id)
      .run(),
  );
});
test("Folder depth 16 cap applies to insertion and whole-subtree movement", async (t) => {
  const f = await fixture();
  t.after(() => f.mf.dispose());
  let parent = null,
    root;
  for (let n = 1; n <= 16; n++) {
    const { folder } = await ok(
      f.api("folders", {
        name: "level " + n,
        parent_id: parent,
        parent_revision: parent ? 1 : undefined,
      }),
    );
    if (n === 1) root = folder;
    parent = folder.id;
  }
  assert.equal(
    (
      await f.api("folders", {
        name: "too deep",
        parent_id: parent,
        parent_revision: 1,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await f.api("folders/" + root.id, {
        name: root.name,
        parent_id: parent,
        parent_revision: 1,
        revision: 1,
      })
    ).status,
    409,
  );
  const leaf = (await ok(f.api("folders", { name: "subtree" }))).folder;
  await ok(
    f.api("folders", { name: "child", parent_id: leaf.id, parent_revision: 1 }),
  );
  assert.equal(
    (
      await f.api("folders/" + leaf.id, {
        name: leaf.name,
        parent_id: parent,
        parent_revision: 1,
        revision: 1,
      })
    ).status,
    409,
  );
});
test("Safe GFM renders paragraphs, nesting, tables and whole code blocks, never active HTML/images/unsafe URLs", () => {
  const html = renderMarkdown(
    "# Heading\n\nA paragraph with *emphasis* and **bold**.\n\n1. first\n2. second\n\n- parent\n  - child\n\n> quote\n\n| A | B |\n|---|---|\n| x | y |\n\n```js\nconst x = 1;\nconst y = 2;\n```\n\n~~removed~~",
  );
  for (const tag of [
    "h1",
    "em",
    "strong",
    "ol",
    "ul",
    "blockquote",
    "table",
    "thead",
    "tbody",
    "pre",
    "code",
    "del",
  ])
    assert.ok(html.includes("<" + tag), tag);
  assert.equal((html.match(/<pre>/g) || []).length, 1);
  assert.match(html, /const x = 1;\nconst y = 2;/);
  for (const payload of [
    "<script>alert(1)</script>",
    "<svg onload=alert(1)>",
    "<img src=x onerror=alert(1)>",
    "[x](javascript:alert(1))",
    "[x](java&#x73;cript:alert(1))",
    "[x](data:text/html,x)",
    "![x](https://example.test/x.png)",
    "[x](https://u:p@example.test)",
  ]) {
    const rendered = renderMarkdown(payload);
    assert.ok(
      !/<(?:script|svg|img|iframe)\b|href="(?:javascript|data):/i.test(
        rendered,
      ),
      rendered,
    );
  }
  assert.match(
    renderMarkdown("[safe](https://example.test/)"),
    /rel="noopener noreferrer"/,
  );
});
