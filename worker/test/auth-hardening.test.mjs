import assert from "node:assert/strict";
import test from "node:test";
import { Miniflare } from "miniflare";
import worker from "../src/index.js";
const origin = "https://works.example.test";
const secret = "synthetic-hardening-secret";
async function token(claims) {
  const payload = Buffer.from(JSON.stringify({ email: "owner@example.test", exp: Date.now() + 3600000, ...claims })).toString("base64url");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return payload + "." + Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))).toString("base64url");
}
test("ordinary APIs reject all MCP claims, while existing browser sessions and MCP tools work", async t => {
  const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok'); } };", compatibilityDate: "2026-08-01", d1Databases: { DB: "hardening" } });
  t.after(() => mf.dispose());
  const DB = await mf.getD1Database("DB");
  await DB.prepare("CREATE TABLE todo_state (id INTEGER PRIMARY KEY, data TEXT NOT NULL, revision INTEGER NOT NULL)").run();
  const env = { DB, SESSION_SECRET: secret, ALLOWED_EMAIL: "owner@example.test", ALLOWED_ORIGIN: origin, WORKS_API_KEY: "synthetic-key" };
  const api = async (path, bearer, method = "GET", body) => worker.fetch(new Request(origin + path, { method, headers: { Authorization: "Bearer " + bearer, "Content-Type": "application/json" }, body: body && JSON.stringify(body) }), env);
  const browser = await token({});
  const initial = await (await api("/api/todo", browser)).json();
  assert.equal((await api("/api/todo", browser, "PUT", { ...initial, categories: [] })).status, 200);
  for (const claims of [{ aud: "works-mcp", scope: "schedule:read" }, { aud: "wrong" }, { aud: "" }, { scope: "" }, { fid: "" }, { fid: null }, { aud: "works-mcp", scope: "schedule:read", fid: "revoked-family" }]) {
    const bearer = await token(claims);
    for (const [path, method, body] of [["/api/todo", "GET"], ["/api/todo", "PUT", initial], ["/api/google-token", "GET"], ["/api/auth/logout", "POST"], ["/api/kdp/books", "GET"]]) assert.equal((await api(path, bearer, method, body)).status, 401);
  }
  const mcp = async (bearer, name, args = {}) => api("/mcp", bearer, "POST", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  const legacyMcp = await token({ aud: "works-mcp", scope: "schedule:read" });
  const created = await (await mcp(legacyMcp, "create_todo", { name: "synthetic task" })).json();
  assert.ok(!created.result.isError);
  const listed = await (await mcp(legacyMcp, "list_todos")).json();
  assert.ok(!listed.result.isError);
  assert.match(JSON.stringify(listed), /synthetic task/);
  for (const claims of [{ aud: "wrong", scope: "schedule:read" }, { aud: "works-mcp", scope: "schedule:read extra" }, { aud: "works-mcp", scope: "schedule:read", fid: "" }, { aud: "works-mcp", scope: "schedule:read", fid: null }]) assert.equal((await mcp(await token(claims), "list_todos")).status, 401);
});
test("authentication requests enforce streaming and query limits before database access", async () => {
  const env = { ALLOWED_ORIGIN: origin };
  const call = (path, body, headers = {}) => worker.fetch(new Request(origin + path, { method: body ? "POST" : "GET", body, headers }), env);
  assert.equal((await call("/oauth/authorize?state=" + "x".repeat(8192))).status, 413);
  for (const path of ["/oauth/register", "/oauth/token", "/oauth/revoke", "/api/auth/callback"]) {
    const oversized = await call(path, "x".repeat(16385));
    assert.equal(oversized.status, 413);
    if (path === "/api/auth/callback") assert.equal(oversized.headers.get("Access-Control-Allow-Origin"), origin);
    assert.equal((await call(path, "small", { "Content-Length": "16385" })).status, 413);
  }
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(10000)); controller.enqueue(new Uint8Array(7000)); controller.close(); } });
  assert.equal((await worker.fetch(new Request(origin + "/oauth/token", { method: "POST", body: stream, duplex: "half" }), env)).status, 413);
});
test("per-IP endpoint budgets allow normal bursts, isolate callers, and redact failures", async () => {
  const env = { SESSION_SECRET: secret, WORKS_API_KEY: "synthetic-key", ALLOWED_EMAIL: "owner@example.test", DB: { batch() { throw new Error("synthetic-secret-in-storage-error"); } } };
  const call = (path, ip) => worker.fetch(new Request(origin + path, { method: "POST", headers: { "CF-Connecting-IP": ip }, body: "{}" }), env);
  for (let i = 0; i < 30; i++) {
    const response = await call("/oauth/register", "192.0.2.1");
    assert.equal(response.status, 400);
    assert.doesNotMatch(await response.text(), /synthetic-secret/);
  }
  const limited = await call("/oauth/register", "192.0.2.1");
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("Retry-After"), "2");
  assert.equal((await call("/oauth/register", "192.0.2.2")).status, 400);
  assert.equal((await call("/oauth/token", "192.0.2.1")).status, 400);
  for (let i = 0; i < 120; i++) assert.equal((await call("/api/auth/callback", "192.0.2.3")).status, 400);
  const callbackLimited = await worker.fetch(new Request(origin + "/api/auth/callback", { method: "POST", headers: { "CF-Connecting-IP": "192.0.2.3", Origin: origin }, body: "{}" }), { ...env, ALLOWED_ORIGIN: origin });
  assert.equal(callbackLimited.status, 429);
  assert.equal(callbackLimited.headers.get("Access-Control-Allow-Origin"), origin);
});
test("Google failures are redacted and revocation carries its token only in POST body", async t => {
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  const env = { SESSION_SECRET: secret, ALLOWED_EMAIL: "owner@example.test", ALLOWED_ORIGIN: origin, DB: { prepare(sql) { return { first: async () => ({ refresh_token: "synthetic-refresh-private" }), run: async () => ({}) }; } } };
  globalThis.fetch = async (url, options) => {
    assert.equal(options.redirect, "error");
    return new Response("synthetic-upstream-private", { status: 400 });
  };
  const response = await worker.fetch(new Request(origin + "/api/google-token", { headers: { Authorization: "Bearer " + await token({}) } }), env);
  assert.equal(response.status, 502);
  assert.doesNotMatch(await response.text(), /synthetic-upstream-private/);
  const callback = await worker.fetch(new Request(origin + "/api/auth/callback", { method: "POST", body: JSON.stringify({ code: "synthetic-code", redirect_uri: origin }) }), env);
  assert.equal(callback.status, 502);
  assert.equal(callback.headers.get("Access-Control-Allow-Origin"), origin);
  assert.doesNotMatch(await callback.text(), /synthetic-upstream-private/);
  globalThis.fetch = async () => { throw new Error("synthetic-network-private"); };
  const network = await worker.fetch(new Request(origin + "/api/google-token", { headers: { Authorization: "Bearer " + await token({}) } }), env);
  assert.equal(network.status, 502);
  assert.doesNotMatch(await network.text(), /synthetic-network-private/);
  globalThis.fetch = async () => new Response("synthetic-parser-private", { status: 200 });
  const malformed = await worker.fetch(new Request(origin + "/api/google-token", { headers: { Authorization: "Bearer " + await token({}) } }), env);
  assert.equal(malformed.status, 502);
  assert.doesNotMatch(await malformed.text(), /synthetic-parser-private/);
  let revoked = false;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://oauth2.googleapis.com/revoke");
    assert.equal(options.method, "POST");
    assert.equal(options.redirect, "error");
    assert.equal(options.body.get("token"), "synthetic-refresh-private");
    revoked = true;
    return new Response("");
  };
  assert.equal((await worker.fetch(new Request(origin + "/api/auth/logout", { method: "POST", headers: { Authorization: "Bearer " + await token({}) } }), env)).status, 200);
  assert.ok(revoked);
});
test("token bursts retain retry headroom and budgets recover without crossing endpoints", async t => {
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  t.after(() => { Date.now = realNow; });
  const call = path => worker.fetch(new Request(origin + path, { method: "POST", headers: { "CF-Connecting-IP": "198.51.100.90" }, body: "{}" }), {});
  for (let i = 0; i < 240; i++) assert.equal((await call("/oauth/token")).status, 503);
  assert.equal((await call("/oauth/token")).status, 429);
  assert.equal((await call("/api/auth/callback")).status, 400);
  now += 1000;
  for (let i = 0; i < 4; i++) assert.equal((await call("/oauth/token")).status, 503);
  assert.equal((await call("/oauth/token")).status, 429);
  now += 60000;
  assert.equal((await call("/oauth/token")).status, 503);
});
