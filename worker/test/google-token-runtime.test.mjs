import assert from "node:assert/strict";
import test from "node:test";
import { Miniflare, createFetchMock } from "miniflare";
import { fetch as fixtureFetch } from "undici";
import { hash, issueRefreshGrant } from "../src/oauth-refresh.js";
import worker from "../src/index.js";

const origin = "https://works.example.test";
const bindings = { SESSION_SECRET: "runtime-synthetic-secret", WORKS_API_KEY: "runtime-synthetic-key", ALLOWED_EMAIL: "owner@example.test", ALLOWED_ORIGIN: origin, GOOGLE_CLIENT_ID: "synthetic-client", GOOGLE_CLIENT_SECRET: "synthetic-google-secret" };
async function browserToken() {
  const payload = Buffer.from(JSON.stringify({ email: bindings.ALLOWED_EMAIL, exp: Date.now() + 86400000 })).toString("base64url");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(bindings.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `${payload}.${Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))).toString("base64url")}`;
}
async function setup(t) {
  const fetchMock = createFetchMock();
  const externalRequests = [];
  fetchMock.disableNetConnect(); // Every external request must match a synthetic fixture.
  const mf = new Miniflare({ modules: true, modulesRules: [{ type: "ESModule", include: ["**/*.js"] }], scriptPath: new URL("../src/index.js", import.meta.url).pathname, compatibilityDate: "2026-08-01", d1Databases: { DB: "runtime-test" }, bindings, outboundService: async request => {
    const body = await request.text();
    externalRequests.push(new URL(request.url).origin);
    return fixtureFetch(request.url, { method: request.method, headers: Object.fromEntries(request.headers), ...(body ? { body } : {}), dispatcher: fetchMock, redirect: "manual" });
  } });
  t.after(() => mf.dispose());
  const DB = await mf.getD1Database("DB");
  await DB.batch([
    DB.prepare("CREATE TABLE google_auth (id INTEGER PRIMARY KEY, refresh_token TEXT, updated_at TEXT)"),
    DB.prepare("INSERT INTO google_auth VALUES (1, 'synthetic-existing-google-refresh', '2026-10-09')"),
    DB.prepare("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)"),
    DB.prepare("INSERT INTO settings VALUES ('selected_calendars', '[\"synthetic-calendar\"]')"),
    DB.prepare("CREATE TABLE curriculum_entries (calendar_event_id TEXT PRIMARY KEY, completed INTEGER, lesson_plan TEXT, confirmation_test TEXT, homework TEXT, lesson_memo TEXT, updated_at TEXT)"),
  ]);
  const call = (path, options = {}) => mf.dispatchFetch(origin + path, options);
  return { mf, DB, fetchMock, call, externalRequests };
}
test("actual Worker runtime renews pre-existing grant and reads schedule with stored Google refresh", async t => {
  const { DB, fetchMock, call } = await setup(t);
  const env = { ...bindings, DB };
  const client = await (await worker.fetch(new Request(origin + "/oauth/register", { method: "POST", body: JSON.stringify({ redirect_uris: ["https://synthetic-client.test/callback"] }) }), env)).json();
  const verifier = "synthetic-existing-verifier-longer-than-forty-three-characters";
  const code = { code: crypto.randomUUID(), redirect_uri: "https://synthetic-client.test/callback", code_challenge: await hash(verifier) };
  await DB.prepare("INSERT INTO mcp_oauth_codes (code, client_id, redirect_uri, code_challenge, scope, expires_at) VALUES (?, ?, ?, ?, ?, ?)").bind(code.code, client.client_id, code.redirect_uri, code.code_challenge, "schedule:read", Date.now() + 300000).run();
  // Existing grant format/issuance is unchanged since before PR98. Create it in
  // local D1 before dispatching the deployed Worker; never recreate it on refresh.
  const existing = await issueRefreshGrant(env, origin, client.client_id, "schedule:read", code);
  const refresh = () => call("/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "CF-Connecting-IP": "192.0.2.110" }, body: new URLSearchParams({ grant_type: "refresh_token", client_id: client.client_id, refresh_token: existing.token }).toString() });
  const responses = await Promise.all([refresh(), refresh()]);
  assert.deepEqual(responses.map(r => r.status), [200, 200]);
  const [a, b] = await Promise.all(responses.map(r => r.json()));
  assert.equal(a.refresh_token, b.refresh_token);
  assert.equal((await (await refresh()).json()).refresh_token, a.refresh_token);
  const family = await DB.prepare("SELECT * FROM mcp_refresh_families WHERE id = ?").bind(existing.family.id).first();
  assert.equal(family.expires_at, existing.family.expires_at);
  assert.equal(family.generation, 1);
  assert.ok(a.expires_in <= 3600 && a.expires_in > 3590);
  fetchMock.get("https://oauth2.googleapis.com").intercept({ path: "/token", method: "POST", body: body => new URLSearchParams(body).get("refresh_token") === "synthetic-existing-google-refresh" }).reply(200, { access_token: "synthetic-google-access", expires_in: 3600 });
  fetchMock.get("https://www.googleapis.com").intercept({ path: /\/calendar\/v3\/calendars\/synthetic-calendar\/events\?/, method: "GET" }).reply(200, { items: [] });
  const response = await call("/mcp", { method: "POST", headers: { Authorization: "Bearer " + a.access_token, "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_schedule", arguments: { date: "2026-10-09" } } }) });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.ok(!result.result.isError, JSON.stringify(result));
  fetchMock.assertNoPendingInterceptors();
  assert.equal((await DB.prepare("SELECT refresh_token FROM google_auth WHERE id=1").first()).refresh_token, "synthetic-existing-google-refresh");
});
test("actual Worker refuses Google token redirects and never sends credentials to Location", async t => {
  const { fetchMock, call, externalRequests } = await setup(t);
  for (const status of [302, 307]) {
    fetchMock.get("https://oauth2.googleapis.com").intercept({ path: "/token", method: "POST" }).reply(status, "synthetic-private-error", { headers: { Location: "https://never-request.test/token" } });
    const response = await call("/api/google-token", { headers: { Authorization: "Bearer " + await browserToken() } });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, "アクセストークンの更新に失敗しました");
    fetchMock.assertNoPendingInterceptors();
    assert.ok(externalRequests.every(url => url === "https://oauth2.googleapis.com"));
    assert.equal(externalRequests.length, status === 302 ? 1 : 2);
  }
});
test("actual Worker revokes via form body without following redirect", async t => {
  const { DB, fetchMock, call, externalRequests } = await setup(t);
  for (const status of [200, 302, 307]) {
    await DB.prepare("INSERT OR REPLACE INTO google_auth VALUES (1, 'synthetic-existing-google-refresh', '2026-10-09')").run();
    fetchMock.get("https://oauth2.googleapis.com").intercept({ path: "/revoke", method: "POST", body: body => new URLSearchParams(body).get("token") === "synthetic-existing-google-refresh" }).reply(status, "", { headers: { Location: "https://never-request.test/revoke" } });
    const response = await call("/api/auth/logout", { method: "POST", headers: { Authorization: "Bearer " + await browserToken() } });
    assert.equal(response.status, 200);
    fetchMock.assertNoPendingInterceptors();
    assert.equal(await DB.prepare("SELECT * FROM google_auth").first(), null);
    assert.ok(externalRequests.every(url => url === "https://oauth2.googleapis.com"));
  }
  assert.equal(externalRequests.length, 3);
});
