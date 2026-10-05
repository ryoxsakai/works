import test from "node:test";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import worker from "../src/index.js";
import { buildEpub, markdownXhtml } from "../src/kdp-export.js";
import { writeFile } from "node:fs/promises";
const origin = "https://kdp.example.test";
async function token(env, payload) {
  const b = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return (
    b +
    "." +
    Buffer.from(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(b)),
    ).toString("base64url")
  );
}
test("Authenticated API/MCP: no AI adoption, atomic saves, restore, private image and export", async (t) => {
  const mf = new Miniflare({
    modules: true,
    script: 'export default {fetch(){return new Response("ok")}}',
    compatibilityDate: "2026-08-01",
    d1Databases: { DB: "kdp-integration" },
    r2Buckets: { MATERIALS_BUCKET: "kdp-assets" },
  });
  t.after(() => mf.dispose());
  const env = {
    DB: await mf.getD1Database("DB"),
    MATERIALS_BUCKET: await mf.getR2Bucket("MATERIALS_BUCKET"),
    SESSION_SECRET: "fixture-signing-only",
    WORKS_API_KEY: "fixture-key-only",
    ALLOWED_EMAIL: "owner@example.test",
    ALLOWED_ORIGIN: origin,
  };
  const browser = await token(env, {
    email: env.ALLOWED_EMAIL,
    exp: Date.now() + 3600000,
  });
  const mcp = await token(env, {
    email: env.ALLOWED_EMAIL,
    exp: Date.now() + 3600000,
    aud: "works-mcp",
    scope: "schedule:read",
  });
  const api = (path, method = "GET", body, auth = browser, extra = {}) =>
    worker.fetch(
      new Request(origin + "/api/kdp/" + path, {
        method,
        headers: {
          Authorization: "Bearer " + auth,
          "Content-Type": "application/json",
          ...extra,
        },
        ...(body === undefined
          ? {}
          : {
              body:
                typeof body === "string" || body instanceof Uint8Array
                  ? body
                  : JSON.stringify(body),
            }),
      }),
      env,
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
  assert.equal((await api("books", "GET", undefined, "")).status, 401);
  assert.equal((await api("books", "GET", undefined, mcp)).status, 401);
  assert.equal((await call("list_kdp_books", {}, "")).status, 401);
  const { book } = await (
    await api("books", "POST", {
      title: "テスト & <English>",
      language: "en",
      author: "Test",
    })
  ).json();
  const { chapter } = await (
    await api(`books/${book.id}/chapters`, "POST", { title: "章 <1>" })
  ).json();
  const { section } = await (
    await api(`chapters/${chapter.id}/sections`, "POST", {
      title: "節",
      body: "日本語 and English & <script>alert(1)</script>",
    })
  ).json();
  const updates = await Promise.all([
    api(`sections/${section.id}`, "PATCH", { body: "Winner A", revision: 1 }),
    api(`sections/${section.id}`, "PATCH", { body: "Winner B", revision: 1 }),
  ]);
  assert.deepEqual(updates.map((r) => r.status).sort(), [200, 409]);
  const current = (await (await api(`sections/${section.id}`)).json()).section;
  const proposed = await (
    await call("create_kdp_proposal", {
      section_id: section.id,
      base_revision: current.revision,
      body: "改稿案 & <b>literal</b>",
    })
  ).json();
  const proposal = proposed.result.structuredContent.proposal;
  assert.equal(
    (await api(`proposals/${proposal.id}/accept`, "POST", { revision: 1 }, mcp))
      .status,
    401,
  );
  const unknown = await (
    await call("accept_kdp_proposal", { proposal_id: proposal.id })
  ).json();
  assert.ok(unknown.error || unknown.result.isError);
  const accepted = await api(`proposals/${proposal.id}/accept`, "POST", {
    revision: 1,
  });
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).section.body, "改稿案 & <b>literal</b>");
  assert.equal(
    (await api(`proposals/${proposal.id}/accept`, "POST", { revision: 1 }))
      .status,
    409,
  );
  const hist = await (await api(`sections/${section.id}/history`)).json();
  assert.equal(hist.history.length, 3);
  const restored = await (
    await api(`sections/${section.id}/restore`, "POST", {
      revision: 3,
      target_revision: 1,
    })
  ).json();
  assert.equal(restored.section.revision, 4);
  assert.equal(restored.section.body, section.body);
  const png = Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4WQAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const imageResponse = await api(
    `books/${book.id}/images`,
    "POST",
    png,
    browser,
    { "Content-Type": "image/png" },
  );
  assert.equal(imageResponse.status, 201);
  const { image } = await imageResponse.json();
  assert.equal(
    (await api("images/" + image.id, "GET", undefined, "")).status,
    401,
  );
  assert.equal((await api("images/" + image.id)).status, 200);
  await api(`sections/${section.id}`, "PATCH", {
    revision: 4,
    body: section.body + "\n\n" + image.markdown,
  });
  const backup = await (
    await api(`books/${book.id}/export?format=json`)
  ).json();
  assert.equal(
    backup.assets[0].data_base64,
    Buffer.from(png).toString("base64"),
  );
  assert.ok(backup.history.length >= 7);
  for (const format of ["epub", "markdown"]) {
    const r = await api(`books/${book.id}/export?format=${format}`);
    assert.equal(r.status, 200);
    const bytes = Buffer.from(await r.arrayBuffer());
    assert.equal(bytes.readUInt32LE(0), 0x04034b50);
    if (format === "epub") await writeFile("/tmp/works-kdp-test.epub", bytes);
  }
  assert.equal(
    (await api(`books/${book.id}`, "PATCH", { revision: 1, archived: true }))
      .status,
    200,
  );
  const blocked = await (
    await call("create_kdp_proposal", {
      section_id: section.id,
      base_revision: 5,
      body: "blocked",
    })
  ).json();
  assert.ok(blocked.result.isError);
  assert.equal(
    (await api(`books/${book.id}`, "PATCH", { revision: 2, archived: false }))
      .status,
    200,
  );
});
test("EPUB escapes HTML and preserves mixed language, images and links", () => {
  const html = markdownXhtml(
    "<script>evil</script> & **bold**\n\n[source](https://example.com) ![photo](kdp-image:abc)",
    [{ id: "abc", extension: "png" }],
  );
  assert.match(html, /&lt;script&gt;/);
  assert.ok(!html.includes("<script>"));
  assert.match(html, /<img src="images\/abc.png"/);
  assert.match(html, /<a href="https:\/\/example.com"/);
  assert.throws(
    () => markdownXhtml("![x](https://external.test/x.png)"),
    /アップロード/,
  );
  const result = buildEpub({
    book: { id: "fixture", title: "日 & <Book>", language: "en", author: "A" },
    chapters: [
      {
        id: "c",
        title: "One",
        sections: [{ id: "s", title: "節", body: "日 English" }],
      },
    ],
  });
  assert.ok(result.length > 1000);
});
