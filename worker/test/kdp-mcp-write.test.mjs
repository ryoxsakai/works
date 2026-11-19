import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import worker from "../src/index.js";
import { hash } from "../src/oauth-refresh.js";
import { KDP_MCP_SCHEMA } from "../src/kdp-mutations.js";

const origin = "https://kdp-write.example.test";
const callback = "https://client.example.test/callback";
const writeScope = "schedule:read kdp:write";
async function fixture(t) {
  const mf = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('fixture')}}", compatibilityDate: "2026-08-01", d1Databases: { DB: "kdp-write" } });
  t.after(() => mf.dispose());
  const env = { DB: await mf.getD1Database("DB"), WORKS_API_KEY: "synthetic-write-key", SESSION_SECRET: "synthetic-write-secret", ALLOWED_EMAIL: "owner@example.test", ALLOWED_ORIGIN: origin, KDP_MCP_WRITE_ENABLED: "true" };
  const DB = env.DB;
  const sign = payload => {
    const encoded = Buffer.from(JSON.stringify({ email: env.ALLOWED_EMAIL, exp: Date.now() + 3600000, ...payload })).toString("base64url");
    return encoded + "." + createHmac("sha256", env.SESSION_SECRET).update(encoded).digest("base64url");
  };
  const request = (path, options = {}, override = {}) => worker.fetch(new Request(origin + path, options), { ...env, ...override });
  const { client_id } = await (await request("/oauth/register", { method: "POST", body: JSON.stringify({ redirect_uris: [callback] }) })).json();
  const verifier = "synthetic-verifier-at-least-forty-three-characters-long";
  const base = { response_type: "code", client_id, redirect_uri: callback, code_challenge: await hash(verifier), code_challenge_method: "S256", state: "write-fixture" };
  const getForm = async (scope = writeScope, cookie = "", override = {}) => {
    const params = new URLSearchParams({ ...base, scope });
    const response = await request("/oauth/authorize?" + params, { headers: { Cookie: cookie } }, override);
    const html = await response.text();
    if (response.status === 200) {
      params.set("csrf_token", html.match(/name="csrf_token" value="([^"]+)"/)[1]);
      const csrf = response.headers.getSetCookie().find(c => c.startsWith("__Host-works_mcp_csrf="));
      cookie = [cookie.split("; ").filter(c => !c.startsWith("__Host-works_mcp_csrf=")).join("; "), csrf.split(";")[0]].filter(Boolean).join("; ");
    }
    return { params, html, cookie, status: response.status };
  };
  const postForm = (form, extra = {}, override = {}) => request("/oauth/authorize", { method: "POST", headers: { Origin: origin, Cookie: form.cookie, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...Object.fromEntries(form.params), ...extra }).toString() }, override);
  const exchange = code => request("/oauth/token", { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code, client_id, redirect_uri: callback, code_verifier: verifier }).toString() });
  const authorize = async (scope = writeScope) => {
    const form = await getForm(scope);
    const response = await postForm(form, { api_key: env.WORKS_API_KEY, ...(scope === writeScope ? { allow_kdp_write: "1" } : {}) });
    assert.equal(response.status, 302);
    const exchanged = await exchange(new URL(response.headers.get("Location")).searchParams.get("code"));
    assert.equal(exchanged.status, 200);
    const tokens = await exchanged.json();
    const payload = JSON.parse(Buffer.from(tokens.access_token.split(".")[0], "base64url"));
    return { ...tokens, payload };
  };
  const refresh = (tokens, extra = {}) => request("/oauth/token", { method: "POST", body: new URLSearchParams({ grant_type: "refresh_token", client_id, refresh_token: tokens.refresh_token, ...extra }).toString() });
  const rpc = async (method, params, token, override = {}) => request("/mcp", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }, override);
  const call = async (name, args, token, override = {}) => {
    const response = await rpc("tools/call", { name, arguments: args }, token, override);
    return { status: response.status, ...(await response.json()) };
  };
  const api = async (path, data, method = data ? "POST" : "GET", token = sign({})) => request("/api/kdp/" + path, { method, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, ...(data ? { body: JSON.stringify(data) } : {}) });
  const count = async table => (await DB.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n;
  const good = response => { assert.equal(response.status, 200); assert.equal(response.result?.isError, false, JSON.stringify(response)); return response.result.structuredContent; };
  const bad = (response, pattern) => { assert.equal(response.result?.isError, true, JSON.stringify(response)); if (pattern) assert.match(response.result.content[0].text, pattern); };
  return { env, DB, sign, request, getForm, postForm, exchange, authorize, refresh, rpc, call, api, count, good, bad, client_id };
}

test("KDP write consent is separate, opt-in, CSRF-bound and preserves old/30-day grants", async t => {
  const f = await fixture(t);
  const { request, getForm, postForm, authorize, call, rpc, refresh, DB, sign, good, bad } = f;
  const disabled = { KDP_MCP_WRITE_ENABLED: undefined };
  for (const path of ["/.well-known/oauth-authorization-server", "/.well-known/oauth-protected-resource"]) {
    assert.deepEqual((await (await request(path, {}, disabled)).json()).scopes_supported, ["schedule:read"]);
    assert.deepEqual((await (await request(path)).json()).scopes_supported, ["schedule:read", "kdp:write"]);
  }
  const names = async override => (await (await rpc("tools/list", {}, undefined, override)).json()).result.tools.map(x => x.name);
  assert.ok(!(await names(disabled)).includes("create_kdp_book"));
  assert.ok((await names({})).includes("accept_kdp_proposal"));
  assert.equal((await getForm(writeScope, "", disabled)).status, 400);
  for (const scope of ["kdp:write", "schedule:read unknown", "schedule:read kdp:write kdp:write"])
    assert.equal((await getForm(scope)).status, 400);
  const form = await getForm();
  const reverse = await getForm("kdp:write schedule:read");
  assert.equal(reverse.status, 200);
  assert.match(reverse.html, /name="scope" value="schedule:read kdp:write"/);
  assert.match(form.html, /name="allow_kdp_write" value="1" required/);
  assert.ok(!/name="allow_kdp_write"[^>]*checked/.test(form.html));
  assert.match(form.html, /採用すると保存済みの本文が変更/);
  assert.equal((await postForm(form, { api_key: f.env.WORKS_API_KEY })).status, 403);
  assert.equal(await f.count("mcp_oauth_codes"), 0);
  const oldForm = await getForm("schedule:read");
  assert.equal((await postForm(oldForm, { api_key: f.env.WORKS_API_KEY, scope: writeScope, allow_kdp_write: "1" })).status, 403);
  const old = await authorize("schedule:read");
  const before = await DB.prepare("SELECT * FROM mcp_refresh_families WHERE id=?").bind(old.payload.fid).first();
  const args = { request_id: "permission-test", title: "Permission fixture" };
  bad(await call("create_kdp_book", args, old.access_token), /explicit kdp:write consent/);
  assert.equal((await refresh(old, { scope: writeScope })).status, 400);
  const oldRotated = await (await refresh(old)).json();
  assert.equal(oldRotated.scope, "schedule:read");
  assert.equal((await DB.prepare("SELECT expires_at FROM mcp_refresh_families WHERE id=?").bind(old.payload.fid).first()).expires_at, before.expires_at);
  const write = await authorize();
  assert.equal(write.scope, writeScope);
  const family = await DB.prepare("SELECT * FROM mcp_refresh_families WHERE id=?").bind(write.payload.fid).first();
  assert.ok(family.expires_at - Date.now() > 29.99 * 86400000);
  good(await call("create_kdp_book", args, write.access_token));
  bad(await call("create_kdp_book", { ...args, request_id: "disabled-request" }, write.access_token, disabled), /not enabled/);
  bad(await call("create_kdp_book", args, sign({ aud: "works-mcp", scope: writeScope })), /explicit kdp:write consent/);
  assert.equal((await call("create_kdp_book", args, sign({ aud: "works-mcp", scope: writeScope, fid: old.payload.fid }))).status, 401);
  assert.equal((await f.api("books", undefined, "GET", write.access_token)).status, 401);
  assert.equal((await call("create_kdp_book", args, "")).status, 401);
  assert.equal((await call("create_kdp_book", args, sign({}))).status, 401);
  const rotated = await (await refresh(write, { scope: "kdp:write schedule:read" })).json();
  assert.equal(rotated.scope, writeScope);
  assert.equal((await DB.prepare("SELECT expires_at FROM mcp_refresh_families WHERE id=?").bind(write.payload.fid).first()).expires_at, family.expires_at);
  // Revocation/expiry is checked before even replaying a successful receipt.
  await request("/oauth/revoke", { method: "POST", body: new URLSearchParams({ client_id: f.client_id, token: rotated.refresh_token }).toString() });
  assert.equal((await call("create_kdp_book", args, rotated.access_token)).status, 401);
  const expired = await authorize();
  await DB.prepare("UPDATE mcp_refresh_families SET expires_at=? WHERE id=?").bind(Date.now() - 1, expired.payload.fid).run();
  assert.equal((await call("create_kdp_book", args, expired.access_token)).status, 401);
});

test("MCP structure writes and proposal decisions are atomic, retryable and preserve immutable history", async t => {
  const f = await fixture(t);
  const { DB, call, good, bad, api, count } = f;
  const auth = (await f.authorize()).access_token;
  const write = (name, args) => call(name, args, auth);
  const bookArgs = { request_id: "new-book-request", title: "日本語 / English", author: "Fixture", language: "en", description: "" };
  const simultaneous = await Promise.all([write("create_kdp_book", bookArgs), write("works.create_kdp_book", bookArgs)]);
  const { book } = good(simultaneous[0]);
  assert.deepEqual(good(simultaneous[1]), { book });
  assert.equal(await count("kdp_books"), 1);
  bad(await write("create_kdp_book", { ...bookArgs, title: "different" }), /already used/);
  bad(await write("create_kdp_book", { request_id: "bad-title-request", title: "a".repeat(301) }), /title/);
  bad(await write("create_kdp_book", { ...bookArgs, request_id: "extra-request-id", archived: true }), /Unknown/);
  bad(await write("create_kdp_book", { title: "Missing retry key" }), /request_id/);
  const chapterArgs = { request_id: "new-chapter-request", book_id: book.id, book_revision: 1, title: "Chapter 1", sort_order: 1024 };
  const { chapter } = good(await write("create_kdp_chapter", chapterArgs));
  assert.deepEqual(good(await write("create_kdp_chapter", chapterArgs)), { chapter });
  const sectionArgs = { request_id: "new-section-request", chapter_id: chapter.id, chapter_revision: 1, title: "Section 1", body: "Original", sort_order: 1024 };
  bad(await write("create_kdp_section", { ...sectionArgs, request_id: "oversize-section-id", body: "日".repeat(200000) }), /512 KB/);
  const { section } = good(await write("create_kdp_section", sectionArgs));
  assert.deepEqual(good(await write("create_kdp_section", sectionArgs)), { section });
  const { proposal } = good(await write("create_kdp_proposal", { section_id: section.id, base_revision: 1, body: "Adopted", title: "Review" }));
  const acceptArgs = { request_id: "accept-request-id", proposal_id: proposal.id, revision: 1, base_revision: 1 };
  const accepts = await Promise.all([write("accept_kdp_proposal", acceptArgs), write("accept_kdp_proposal", acceptArgs)]);
  const adopted = good(accepts[0]);
  assert.deepEqual(good(accepts[1]), adopted);
  assert.equal(adopted.section.body, "Adopted");
  assert.equal(adopted.section.revision, 2);
  assert.equal(adopted.proposal.status, "accepted");
  bad(await write("reject_kdp_proposal", { request_id: "reject-accepted-id", proposal_id: proposal.id, revision: 1 }), /already changed/);
  assert.equal((await api(`sections/${section.id}`, { revision: 2, body: "Later browser edit" }, "PATCH")).status, 200);
  assert.deepEqual(good(await write("accept_kdp_proposal", acceptArgs)), adopted, "lost response replays original revision, never overwrites later edits");
  assert.equal(good(await write("get_kdp_section", { section_id: section.id })).section.body, "Later browser edit");
  const rejectedProposal = good(await write("create_kdp_proposal", { section_id: section.id, base_revision: 3, body: "Reject this" })).proposal;
  const rejectArgs = { request_id: "reject-request-id", proposal_id: rejectedProposal.id, revision: 1 };
  const rejects = await Promise.all([write("reject_kdp_proposal", rejectArgs), write("reject_kdp_proposal", rejectArgs)]);
  assert.equal(good(rejects[0]).proposal.status, "rejected");
  assert.deepEqual(good(rejects[0]), good(rejects[1]));
  const stale = good(await write("create_kdp_proposal", { section_id: section.id, base_revision: 3, body: "Stale proposal" })).proposal;
  assert.equal((await api(`sections/${section.id}`, { revision: 3, body: "Newer edit" }, "PATCH")).status, 200);
  const failedArgs = { request_id: "stale-accept-id", proposal_id: stale.id, revision: 1, base_revision: 3 };
  bad(await write("accept_kdp_proposal", { ...failedArgs, base_revision: 4 }), /mismatch/);
  bad(await write("accept_kdp_proposal", failedArgs), /Base revision changed/);
  assert.equal((await DB.prepare("SELECT status FROM kdp_proposals WHERE id=?").bind(stale.id).first()).status, "pending");
  assert.equal((await DB.prepare("SELECT count(*) n FROM kdp_mcp_requests WHERE request_id=?").bind(failedArgs.request_id).first()).n, 0);
  const tree = good(await write("get_kdp_book", { book_id: book.id }));
  assert.equal(tree.chapters[0].sections[0].revision, 4);
  assert.equal((await DB.prepare("SELECT count(*) n FROM kdp_history WHERE entity_id=?").bind(section.id).first()).n, 4);
  for (const table of ["kdp_history", "kdp_mcp_requests"]) {
    await assert.rejects(DB.prepare(`DELETE FROM ${table}`).run(), /immutable/);
    await assert.rejects(DB.prepare(`UPDATE ${table} SET created_at='changed'`).run(), /immutable/);
  }
  // A request ID belongs to one grant, so another explicitly consented connection
  // cannot inspect or reuse that grant's committed operation as its own.
  const other = await f.authorize();
  const otherBook = good(await call("create_kdp_book", bookArgs, other.access_token)).book;
  assert.notEqual(otherBook.id, book.id);
});

test("MCP respects archived ancestors and parent revisions, including archive races", async t => {
  const f = await fixture(t);
  const { DB, good, bad, api, count } = f;
  const auth = (await f.authorize()).access_token;
  const write = (name, args, override = {}) => f.call(name, args, auth, override);
  const { book } = good(await write("create_kdp_book", { request_id: "archive-book-id", title: "Archive fixture" }));
  const chArgs = { request_id: "archive-chapter-id", book_id: book.id, book_revision: 1, title: "Chapter" };
  const { chapter } = good(await write("create_kdp_chapter", chArgs));
  const sArgs = { request_id: "archive-section-id", chapter_id: chapter.id, chapter_revision: 1, title: "Section" };
  const { section } = good(await write("create_kdp_section", sArgs));
  const { proposal } = good(await write("create_kdp_proposal", { section_id: section.id, base_revision: 1, body: "Proposed" }));
  assert.equal((await api(`books/${book.id}`, { revision: 1, archived: true }, "PATCH")).status, 200);
  bad(await write("create_kdp_chapter", { ...chArgs, request_id: "blocked-chapter-id" }), /archived/);
  bad(await write("create_kdp_section", { ...sArgs, request_id: "blocked-section-id" }), /archived/);
  bad(await write("accept_kdp_proposal", { request_id: "blocked-accept-id", proposal_id: proposal.id, revision: 1, base_revision: 1 }), /archived/);
  // Existing browser behavior permits rejection while archived (no adopted edit).
  good(await write("reject_kdp_proposal", { request_id: "archived-reject-id", proposal_id: proposal.id, revision: 1 }));
  assert.deepEqual(good(await write("create_kdp_chapter", chArgs)), { chapter });
  assert.equal((await api(`books/${book.id}`, { revision: 2, archived: false }, "PATCH")).status, 200);
  bad(await write("create_kdp_chapter", { ...chArgs, request_id: "stale-parent-id" }), /Parent revision conflict/);
  assert.equal((await api(`chapters/${chapter.id}`, { revision: 1, archived: true }, "PATCH")).status, 200);
  bad(await write("create_kdp_section", { ...sArgs, request_id: "archived-child-id" }), /archived/);
  assert.equal((await api(`chapters/${chapter.id}`, { revision: 2, archived: false }, "PATCH")).status, 200);
  bad(await write("create_kdp_section", { ...sArgs, request_id: "stale-chapter-id" }), /Parent revision conflict/);
  let archived = false;
  // Force an ancestor archive after preflight, before the actual transactional INSERT.
  const wrapped = {
    prepare(sql) { const stmt = DB.prepare(sql); return { sql, stmt, bind(...args) { return { sql, stmt: stmt.bind(...args), first: () => stmt.bind(...args).first(), all: () => stmt.bind(...args).all() }; }, first: () => stmt.first() }; },
    async batch(stmts) {
      if (!archived && stmts.some(x => x.sql.startsWith("INSERT INTO kdp_sections"))) {
        archived = true;
        await DB.prepare("UPDATE kdp_books SET archived=1,revision=revision+1 WHERE id=?").bind(book.id).run();
      }
      return DB.batch(stmts.map(x => x.stmt));
    },
  };
  bad(await write("create_kdp_section", { ...sArgs, chapter_revision: 3, request_id: "archive-race-id" }, { DB: wrapped }), /archive state/);
  assert.equal(await count("kdp_sections"), 1);
  assert.equal((await DB.prepare("SELECT count(*) n FROM kdp_mcp_requests WHERE request_id='archive-race-id'").first()).n, 0);
});

test("KDP MCP receipt migration matches runtime schema", async () => {
  assert.equal(await readFile(new URL("../migrations/003-kdp-mcp.sql", import.meta.url), "utf8"), KDP_MCP_SCHEMA.join("\n") + "\n");
});

test("Competing decisions, ancestor races and receipt failures never partially adopt", async t => {
  const f = await fixture(t);
  const { DB, good, bad } = f;
  const auth = (await f.authorize()).access_token;
  const write = (name, args, override = {}) => f.call(name, args, auth, override);
  const { book } = good(await write("create_kdp_book", { request_id: "decision-book-id", title: "Decision fixture" }));
  const { chapter } = good(await write("create_kdp_chapter", { request_id: "decision-chapter-id", book_id: book.id, book_revision: 1, title: "Chapter" }));
  const { section } = good(await write("create_kdp_section", { request_id: "decision-section-id", chapter_id: chapter.id, chapter_revision: 1, title: "Section", body: "Original" }));
  const propose = async (revision, body) => good(await write("create_kdp_proposal", { section_id: section.id, base_revision: revision, body })).proposal;
  const a = await propose(1, "Winner A"), b = await propose(1, "Winner B");
  const competitors = await Promise.all([a, b].map(p => write("accept_kdp_proposal", { request_id: "compete-" + p.id, proposal_id: p.id, revision: 1, base_revision: 1 })));
  assert.equal(competitors.filter(r => !r.result.isError).length, 1);
  assert.equal((await DB.prepare("SELECT count(*) n FROM kdp_proposals WHERE status='accepted'").first()).n, 1);
  assert.equal((await DB.prepare("SELECT count(*) n FROM kdp_proposals WHERE status='pending'").first()).n, 1);
  assert.equal((await DB.prepare("SELECT revision FROM kdp_sections WHERE id=?").bind(section.id).first()).revision, 2);
  const c = await propose(2, "Race adoption");
  const decisions = await Promise.all([
    write("accept_kdp_proposal", { request_id: "accept-reject-race", proposal_id: c.id, revision: 1, base_revision: 2 }),
    write("reject_kdp_proposal", { request_id: "reject-accept-race", proposal_id: c.id, revision: 1 }),
  ]);
  assert.equal(decisions.filter(r => !r.result.isError).length, 1);
  const current = (await f.api(`sections/${section.id}`).then(r => r.json())).section;
  const decided = await DB.prepare("SELECT * FROM kdp_proposals WHERE id=?").bind(c.id).first();
  assert.equal(current.revision, decided.status === "accepted" ? 3 : 2);
  assert.equal(current.body === c.body, decided.status === "accepted");
  const p = await propose(current.revision, "Must roll back");
  const accept = { request_id: "rollback-accept-id", proposal_id: p.id, revision: 1, base_revision: current.revision };
  const failingDB = {
    prepare(sql) { return DB.prepare(sql.startsWith("INSERT INTO kdp_mcp_requests") ? "INSERT INTO nonexistent_fixture_table VALUES (?,?,?,?)" : sql); },
    batch(stmts) { return DB.batch(stmts); },
  };
  bad(await write("accept_kdp_proposal", accept, { DB: failingDB }), /nonexistent_fixture_table/);
  assert.deepEqual((await f.api(`sections/${section.id}`).then(r => r.json())).section, current);
  assert.equal((await DB.prepare("SELECT revision,status FROM kdp_proposals WHERE id=?").bind(p.id).first()).status, "pending");
  assert.equal((await DB.prepare("SELECT count(*) n FROM kdp_mcp_requests WHERE request_id=?").bind(accept.request_id).first()).n, 0);
  // A failed operation did not reserve the ID, so the same exact request can succeed.
  const success = good(await write("accept_kdp_proposal", accept));
  assert.equal(success.section.revision, current.revision + 1);
  const archivedProposal = await propose(success.section.revision, "Must not adopt after archive");
  let raced = false;
  const raceDB = {
    prepare(sql) { const stmt = DB.prepare(sql); return { sql, stmt, bind(...args) { return { sql, stmt: stmt.bind(...args), first: () => stmt.bind(...args).first(), all: () => stmt.bind(...args).all() }; } }; },
    async batch(stmts) {
      if (!raced && stmts.some(x => x.sql.startsWith("UPDATE kdp_sections SET body="))) {
        raced = true;
        await DB.prepare("UPDATE kdp_chapters SET archived=1,revision=revision+1 WHERE id=?").bind(chapter.id).run();
      }
      return DB.batch(stmts.map(x => x.stmt));
    },
  };
  bad(await write("accept_kdp_proposal", { request_id: "accept-archive-race", proposal_id: archivedProposal.id, revision: 1, base_revision: success.section.revision }, { DB: raceDB }), /Base revision changed/);
  assert.equal((await DB.prepare("SELECT status FROM kdp_proposals WHERE id=?").bind(archivedProposal.id).first()).status, "pending");
  assert.equal((await DB.prepare("SELECT body FROM kdp_sections WHERE id=?").bind(section.id).first()).body, p.body);
});
