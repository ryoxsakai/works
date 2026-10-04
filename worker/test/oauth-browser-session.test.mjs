import assert from "node:assert/strict";
import test from "node:test";
import { Miniflare } from "miniflare";
import worker from "../src/index.js";

const ORIGIN = "https://works.example.test";
const SESSION_COOKIE = "__Host-works_mcp_session";
const CSRF_COOKIE = "__Host-works_mcp_csrf";
const KEY = "fixture-only-api-key";
const SECRET = "fixture-only-session-secret";
const CALLBACK = "https://client.example.test/callback";
const VERIFIER = "test-pkce-verifier-with-more-than-forty-three-characters";

function hidden(html, name) {
  const match = html.match(new RegExp(`<input type="hidden" name="${name}" value="([^"]*)">`));
  assert.ok(match, `${name} field present`);
  return match[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
function jarFrom(response, jar = {}) {
  for (const value of response.headers.getSetCookie()) {
    const [pair] = value.split(";");
    const index = pair.indexOf("=");
    if (value.includes("Max-Age=0")) delete jar[pair.slice(0, index)];
    else jar[pair.slice(0, index)] = pair.slice(index + 1);
  }
  return jar;
}
function request(path, { jar = {}, body, origin = ORIGIN, fetchSite = "same-origin", ...options } = {}) {
  const headers = { Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; "), ...(options.headers || {}) };
  if (body) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    if (origin !== null) headers.Origin = origin;
    if (fetchSite !== null) headers["Sec-Fetch-Site"] = fetchSite;
  }
  return new Request(ORIGIN + path, { ...options, method: body ? "POST" : "GET", headers, body: body?.toString() });
}

test("MCP remembered login preserves explicit consent and revocable browser-only sessions", async (t) => {
  const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok'); } };", compatibilityDate: "2026-08-01", d1Databases: { DB: "oauth-browser-test" } });
  t.after(() => mf.dispose());
  const DB = await mf.getD1Database("DB");
  const env = { DB, WORKS_API_KEY: KEY, SESSION_SECRET: SECRET, ALLOWED_EMAIL: "owner@example.test", ALLOWED_ORIGIN: ORIGIN };
  const call = (req, overrides = {}) => worker.fetch(req, { ...env, ...overrides });
  const registration = await call(new Request(ORIGIN + "/oauth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ redirect_uris: [CALLBACK] }) }));
  assert.equal(registration.status, 201);
  const { client_id: clientId } = await registration.json();
  const codeChallenge = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(VERIFIER))).toString("base64url");
  const base = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: CALLBACK, code_challenge: codeChallenge, code_challenge_method: "S256", scope: "schedule:read", state: "opaque+state<&" });
  const count = async (table) => (await DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first()).count;
  async function form(jar = {}, overrides = {}, params = base) {
    const response = await call(request("/oauth/authorize?" + params, { jar }), overrides);
    const html = await response.text();
    const body = new URLSearchParams(params);
    if (response.status === 200) body.set("csrf_token", hidden(html, "csrf_token"));
    jarFrom(response, jar);
    return { response, html, body, jar };
  }
  async function remember(jar = {}) {
    const page = await form(jar);
    page.body.set("api_key", KEY);
    page.body.set("remember_login", "1");
    const response = await call(request("/oauth/authorize", { jar, body: page.body }));
    assert.equal(response.status, 302);
    jarFrom(response, jar);
    return { response, jar, body: page.body };
  }

  await t.test("initial checkbox is off, no GET grant, hardened response and cookie", async () => {
    const { response, html, jar } = await form();
    assert.equal(response.status, 200);
    assert.match(html, /name="remember_login" value="1">/);
    assert.match(html, /type="password"/);
    assert.equal(jar[SESSION_COOKIE], undefined);
    assert.ok(jar[CSRF_COOKIE]);
    assert.match(response.headers.get("Set-Cookie"), /Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=600/);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("Referrer-Policy"), "same-origin");
    assert.match(response.headers.get("Content-Security-Policy"), /frame-ancestors 'none'/);
    assert.match(response.headers.get("Content-Security-Policy"), /form-action 'self' https:\/\/client.example.test/);
    assert.equal(await count("mcp_oauth_codes"), 0);
    assert.equal(await count("mcp_browser_sessions"), 0);
    assert.doesNotMatch(html, /localStorage|sessionStorage|<script/);
  });

  await t.test("unchecked successful login issues no remembered credential", async () => {
    const page = await form();
    page.body.set("api_key", KEY);
    const response = await call(request("/oauth/authorize", { jar: page.jar, body: page.body }));
    assert.equal(response.status, 302);
    assert.match(response.headers.get("Set-Cookie"), /__Host-works_mcp_session=;.*Max-Age=0/);
    assert.equal(await count("mcp_browser_sessions"), 0);
    assert.equal(new URL(response.headers.get("Location")).searchParams.get("state"), base.get("state"));
  });

  await t.test("checked login stores only a hash, with fixed 30 day lifetime", async () => {
    const { response, jar } = await remember();
    const cookie = response.headers.get("Set-Cookie");
    assert.match(cookie, /Secure; HttpOnly; SameSite=Lax; Max-Age=2592000/);
    assert.doesNotMatch(cookie, /Domain=/);
    assert.match(jar[SESSION_COOKIE], /^[\w-]{43}$/);
    const rows = (await DB.prepare("SELECT * FROM mcp_browser_sessions").all()).results;
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0].token_hash, jar[SESSION_COOKIE]);
    assert.doesNotMatch(JSON.stringify(rows), new RegExp(`${KEY}|${SECRET}|${jar[SESSION_COOKIE]}`));
    assert.ok(rows[0].expires_at > Date.now() + 29.99 * 86400_000);
    const expiresAt = rows[0].expires_at;
    const before = await count("mcp_oauth_codes");
    const page = await form(jar);
    assert.doesNotMatch(page.html, /type="password"/);
    assert.match(page.html, /name="remember_login" value="1" checked/);
    assert.match(page.html, /接続を許可/);
    assert.equal(await count("mcp_oauth_codes"), before);
    page.body.set("remember_login", "1");
    const approved = await call(request("/oauth/authorize", { jar, body: page.body }));
    assert.equal(approved.status, 302);
    assert.equal(approved.headers.getSetCookie().length, 0);
    assert.equal((await DB.prepare("SELECT expires_at FROM mcp_browser_sessions").first()).expires_at, expiresAt);
    const replay = await call(request("/oauth/authorize", { jar, body: page.body }));
    assert.equal(replay.status, 403);
    assert.equal(await count("mcp_oauth_codes"), before + 1);
  });

  await t.test("unchecked repeat consent revokes persistence; old cookie stops working", async () => {
    const { jar } = await remember();
    const oldJar = { ...jar };
    const page = await form(jar);
    const response = await call(request("/oauth/authorize", { jar, body: page.body }));
    assert.equal(response.status, 302);
    jarFrom(response, jar);
    assert.equal(jar[SESSION_COOKIE], undefined);
    const next = await form(oldJar);
    assert.match(next.html, /type="password"/);
  });

  await t.test("wrong key is not echoed or remembered and can be corrected", async () => {
    const page = await form();
    page.body.set("api_key", "wrong-sensitive-input");
    page.body.set("remember_login", "1");
    const before = await count("mcp_browser_sessions");
    const response = await call(request("/oauth/authorize", { jar: page.jar, body: page.body }));
    assert.equal(response.status, 401);
    const html = await response.text();
    assert.doesNotMatch(html, /wrong-sensitive-input/);
    assert.equal(await count("mcp_browser_sessions"), before);
    page.body.set("csrf_token", hidden(html, "csrf_token"));
    page.body.set("api_key", KEY);
    jarFrom(response, page.jar);
    const corrected = await call(request("/oauth/authorize", { jar: page.jar, body: page.body }));
    assert.equal(corrected.status, 302);
  });

  await t.test("cross-origin, same-site sibling, missing origin and missing CSRF fail closed", async () => {
    const { jar } = await remember();
    const page = await form(jar);
    const before = await count("mcp_oauth_codes");
    for (const options of [{ origin: "https://evil.example.test" }, { origin: null }, { fetchSite: "same-site" }, { fetchSite: "cross-site" }]) {
      const response = await call(request("/oauth/authorize", { jar, body: page.body, ...options }));
      assert.equal(response.status, 403);
    }
    const missingCsrf = new URLSearchParams(page.body); missingCsrf.delete("csrf_token");
    assert.equal((await call(request("/oauth/authorize", { jar, body: missingCsrf }))).status, 403);
    assert.equal(await count("mcp_oauth_codes"), before);
  });

  await t.test("CSRF binds state, PKCE, browser and exact client request", async () => {
    const page = await form();
    page.body.set("api_key", KEY);
    for (const [field, value] of [["state", "different"], ["code_challenge", "changed"], ["scope", "schedule:read changed"]]) {
      const changed = new URLSearchParams(page.body); changed.set(field, value);
      assert.equal((await call(request("/oauth/authorize", { jar: page.jar, body: changed }))).status, field === "scope" ? 400 : 403);
    }
    const wrongBrowser = { ...page.jar, [CSRF_COOKIE]: "z".repeat(43) };
    assert.equal((await call(request("/oauth/authorize", { jar: wrongBrowser, body: page.body }))).status, 403);
    const evilRedirect = new URLSearchParams(page.body); evilRedirect.set("redirect_uri", "https://evil.example.test/callback");
    assert.equal((await call(request("/oauth/authorize", { jar: page.jar, body: evilRedirect }))).status, 400);
    assert.equal((await call(request("/oauth/authorize", { jar: page.jar, body: page.body }))).status, 302);
  });

  await t.test("parallel forms reuse nonce; repeated form POST is one-use", async () => {
    const jar = {};
    const first = await form(jar);
    const nonce = jar[CSRF_COOKIE];
    const second = await form(jar);
    assert.equal(jar[CSRF_COOKIE], nonce);
    for (const page of [first, second]) {
      page.body.set("api_key", KEY);
      assert.equal((await call(request("/oauth/authorize", { jar, body: page.body }))).status, 302);
    }
    assert.equal((await call(request("/oauth/authorize", { jar, body: first.body }))).status, 403);
  });

  await t.test("expired session, expired form and secret/key rotations require authentication", async () => {
    const { jar } = await remember();
    const page = await form(jar);
    const hash = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(jar[SESSION_COOKIE]))).toString("base64url");
    await DB.prepare("UPDATE mcp_browser_sessions SET expires_at = ? WHERE token_hash = ?").bind(Date.now(), hash).run();
    assert.equal((await call(request("/oauth/authorize", { jar, body: page.body }))).status, 403);
    assert.match((await form(jar)).html, /type="password"/);
    const plain = await form();
    await DB.prepare("UPDATE mcp_browser_forms SET expires_at = ?").bind(Date.now()).run();
    plain.body.set("api_key", KEY);
    assert.equal((await call(request("/oauth/authorize", { jar: plain.jar, body: plain.body }))).status, 403);
    for (const overrides of [{ WORKS_API_KEY: "rotated-api-key" }, { SESSION_SECRET: "rotated-signing-secret" }]) {
      const saved = await remember();
      assert.match((await form(saved.jar, overrides)).html, /type="password"/);
    }
  });

  await t.test("logout needs explicit same-origin POST and revokes stale forms", async () => {
    const { jar } = await remember();
    const oldJar = { ...jar };
    const pending = await form(jar);
    const logout = await call(request("/oauth/logout", { jar }));
    assert.equal(logout.status, 200);
    const body = new URLSearchParams({ csrf_token: hidden(await logout.text(), "csrf_token") });
    jarFrom(logout, jar);
    assert.ok((await form(jar)).html.includes("このブラウザのログイン状態を確認"));
    assert.equal((await call(request("/oauth/logout", { jar, body, origin: "https://evil.example.test" }))).status, 403);
    const done = await call(request("/oauth/logout", { jar, body }));
    assert.equal(done.status, 200);
    jarFrom(done, jar);
    assert.equal(jar[SESSION_COOKIE], undefined);
    assert.equal(jar[CSRF_COOKIE], undefined);
    assert.equal((await call(request("/oauth/authorize", { jar: oldJar, body: pending.body }))).status, 403);
    assert.match((await form(oldJar)).html, /type="password"/);
  });

  await t.test("OAuth code, PKCE and one-hour access token lifetime remain unchanged", async () => {
    const { response } = await remember();
    const code = new URL(response.headers.get("Location")).searchParams.get("code");
    const tokenParams = new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, redirect_uri: CALLBACK, code, code_verifier: "wrong-verifier" });
    assert.equal((await call(request("/oauth/token", { body: tokenParams }))).status, 400);
    tokenParams.set("code_verifier", VERIFIER);
    const tokenResponse = await call(request("/oauth/token", { body: tokenParams }));
    assert.equal(tokenResponse.status, 200);
    const token = await tokenResponse.json();
    assert.equal(token.expires_in, 3600);
    assert.equal(token.scope, "schedule:read");
    assert.ok(token.access_token);
    assert.equal((await call(request("/oauth/token", { body: tokenParams }))).status, 400);
  });

  await t.test("simultaneous double-click grants once and session storage failure grants nothing", async () => {
    const page = await form();
    page.body.set("api_key", KEY);
    const before = await count("mcp_oauth_codes");
    const responses = await Promise.all([1, 2].map(() => call(request("/oauth/authorize", { jar: page.jar, body: page.body }))));
    assert.deepEqual(responses.map((r) => r.status).sort(), [302, 403]);
    assert.equal(await count("mcp_oauth_codes"), before + 1);
    const retry = await form();
    retry.body.set("api_key", KEY);
    retry.body.set("remember_login", "1");
    const failingDB = {
      batch: (...args) => DB.batch(...args),
      prepare(sql) {
        if (sql.startsWith("INSERT INTO mcp_browser_sessions")) return { bind() { return { run() { throw new Error("simulated session storage failure"); } }; } };
        return DB.prepare(sql);
      },
    };
    const failed = await call(request("/oauth/authorize", { jar: retry.jar, body: retry.body }), { DB: failingDB });
    assert.equal(failed.status, 400);
    assert.equal(failed.headers.getSetCookie().length, 0);
    assert.equal(failed.headers.get("Location"), null);
    assert.equal(await count("mcp_oauth_codes"), before + 1);
  });

  await t.test("remembered sessions are bound to their authorization origin", async () => {
    const { jar } = await remember();
    const req = new Request("https://other.example.test/oauth/authorize?" + base, { headers: { Cookie: Object.entries(jar).map(([k,v]) => `${k}=${v}`).join("; ") } });
    const page = await call(req);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /type="password"/);
  });

  await t.test("no remember cookie authorizes an API or MCP request", async () => {
    const { jar } = await remember();
    assert.equal((await call(request("/api/students", { jar }))).status, 401);
    const response = await call(new Request(ORIGIN + "/mcp", { method: "POST", headers: { "Content-Type": "application/json", Cookie: Object.entries(jar).map(([k,v]) => `${k}=${v}`).join("; ") }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_schedule", arguments: { date: "2026-10-02" } } }) }));
    assert.equal(response.status, 401);
  });
});
