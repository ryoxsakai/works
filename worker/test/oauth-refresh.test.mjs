import assert from "node:assert/strict";
import test from "node:test";
import { Miniflare } from "miniflare";
import worker from "../src/index.js";
import { hash } from "../src/oauth-refresh.js";

test("OAuth refresh grants rotate safely for a fixed thirty days", async t => {
  const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok'); } };", compatibilityDate: "2026-08-01", d1Databases: { DB: "refresh-test" } });
  t.after(() => mf.dispose());
  const DB = await mf.getD1Database("DB");
  const origin = "https://works.example.test";
  const callback = "https://client.example.test/callback";
  const env = { DB, WORKS_API_KEY: "synthetic-only-key", SESSION_SECRET: "synthetic-only-secret", ALLOWED_EMAIL: "owner@example.test", ALLOWED_ORIGIN: origin };
  const call = (path, body, overrides = {}) => worker.fetch(new Request(origin + path, { method: body ? "POST" : "GET", headers: body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}, body: body?.toString() }), { ...env, ...overrides });
  const registered = await worker.fetch(new Request(origin + "/oauth/register", { method: "POST", body: JSON.stringify({ redirect_uris: [callback] }) }), env);
  const { client_id: clientId, grant_types: types } = await registered.json();
  assert.ok(types.includes("refresh_token"));
  const verifier = "synthetic-verifier-at-least-forty-three-characters-long";
  const challenge = await hash(verifier);
  const exchangeParams = code => new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: callback, code_verifier: verifier });
  async function seedCode() {
    const code = crypto.randomUUID();
    await DB.prepare("INSERT INTO mcp_oauth_codes (code, client_id, redirect_uri, code_challenge, scope, expires_at) VALUES (?, ?, ?, ?, ?, ?)").bind(code, clientId, callback, challenge, "schedule:read", Date.now() + 300000).run();
    return code;
  }
  async function issue() {
    const response = await call("/oauth/token", exchangeParams(await seedCode()));
    assert.equal(response.status, 200);
    return response.json();
  }
  const refresh = (token, extra = {}, overrides = {}) => call("/oauth/token", new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, refresh_token: token, ...extra }), overrides);
  const access = (token, overrides = {}, requestOrigin = origin) => worker.fetch(new Request(requestOrigin + "/mcp", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "unknown" } }) }), { ...env, ...overrides });
  const family = async token => DB.prepare("SELECT f.* FROM mcp_refresh_families f JOIN mcp_refresh_tokens t ON t.family_id = f.id WHERE t.token_hash = ?").bind(await hash(token)).first();

  await t.test("metadata, code single-use and hash-only storage", async () => {
    const metadata = await (await call("/.well-known/oauth-authorization-server")).json();
    assert.ok(metadata.grant_types_supported.includes("refresh_token"));
    assert.equal(metadata.revocation_endpoint, origin + "/oauth/revoke");
    const code = await seedCode();
    const responses = await Promise.all([call("/oauth/token", exchangeParams(code)), call("/oauth/token", exchangeParams(code))]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 400]);
    const tokens = await responses.find(r => r.status === 200).json();
    assert.ok(tokens.expires_in <= 3600 && tokens.expires_in >= 3598);
    assert.match(tokens.refresh_token, /^[\w-]{43}$/);
    const dump = JSON.stringify((await DB.prepare("SELECT * FROM mcp_refresh_tokens").all()).results);
    assert.ok(!dump.includes(tokens.refresh_token));
    assert.ok(!dump.includes(env.WORKS_API_KEY));
    const grant = await family(tokens.refresh_token);
    assert.ok(grant.expires_at > Date.now() + 29.99 * 86400000);
    assert.notEqual((await access(tokens.access_token)).status, 401);
  });
  await t.test("simultaneous refresh and retry have one successor and fixed expiry", async () => {
    const tokens = await issue();
    const original = await family(tokens.refresh_token);
    const responses = await Promise.all([refresh(tokens.refresh_token), refresh(tokens.refresh_token)]);
    assert.deepEqual(responses.map(r => r.status), [200, 200]);
    const [a, b] = await Promise.all(responses.map(r => r.json()));
    assert.equal(a.refresh_token, b.refresh_token);
    assert.notEqual(a.refresh_token, tokens.refresh_token);
    assert.equal((await family(a.refresh_token)).expires_at, original.expires_at);
    assert.equal((await family(a.refresh_token)).generation, 1);
    assert.equal((await (await refresh(tokens.refresh_token)).json()).refresh_token, a.refresh_token);
    const advanced = await (await refresh(a.refresh_token)).json();
    assert.ok(advanced.refresh_token);
    assert.equal((await refresh(tokens.refresh_token)).status, 400);
    assert.equal((await refresh(advanced.refresh_token)).status, 400);
    assert.equal((await access(advanced.access_token)).status, 401);
    assert.equal((await access(tokens.access_token)).status, 401);
  });
  await t.test("reuse outside retry window revokes family and all its access", async () => {
    const tokens = await issue();
    const rotated = await (await refresh(tokens.refresh_token)).json();
    await DB.prepare("UPDATE mcp_refresh_tokens SET used_at = ? WHERE token_hash = ?").bind(Date.now() - 5001, await hash(tokens.refresh_token)).run();
    assert.equal((await refresh(tokens.refresh_token)).status, 400);
    assert.equal((await access(rotated.access_token)).status, 401);
  });
  await t.test("wrong client, scope, resource, unknown and duplicate params do not revoke grant", async () => {
    const tokens = await issue();
    for (const extra of [{ client_id: "other-client" }, { scope: "schedule:read admin" }, { resource: "https://other.example.test/mcp" }]) assert.equal((await refresh(tokens.refresh_token, extra)).status, 400);
    assert.equal((await refresh("x".repeat(43))).status, 400);
    const duplicate = new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, refresh_token: tokens.refresh_token });
    duplicate.append("refresh_token", tokens.refresh_token);
    assert.equal((await call("/oauth/token", duplicate)).status, 400);
    assert.equal((await refresh(tokens.refresh_token)).status, 200);
    assert.equal((await call("/oauth/token", new URLSearchParams({ grant_type: "password" }))).status, 400);
  });
  await t.test("credential rotation and issuer mismatch invalidate refresh and access", async () => {
    const tokens = await issue();
    for (const overrides of [{ WORKS_API_KEY: "rotated" }, { SESSION_SECRET: "rotated" }, { ALLOWED_EMAIL: "other@example.test" }]) {
      assert.equal((await refresh(tokens.refresh_token, {}, overrides)).status, 400);
      assert.equal((await access(tokens.access_token, overrides)).status, 401);
    }
    assert.equal((await access(tokens.access_token, {}, "https://other.example.test")).status, 401);
    const foreign = new Request("https://other.example.test/oauth/token", { method: "POST", body: new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, refresh_token: tokens.refresh_token }) });
    assert.equal((await worker.fetch(foreign, env)).status, 400);
    assert.equal((await refresh(tokens.refresh_token)).status, 200);
  });
  await t.test("expiry caps new access, stops refresh, and never extends", async () => {
    const tokens = await issue();
    const original = await family(tokens.refresh_token);
    const near = Date.now() + 15000;
    await DB.prepare("UPDATE mcp_refresh_families SET expires_at = ? WHERE id = ?").bind(near, original.id).run();
    const rotated = await (await refresh(tokens.refresh_token)).json();
    assert.ok(rotated.expires_in <= 15);
    const payload = JSON.parse(Buffer.from(rotated.access_token.split(".")[0], "base64url").toString());
    assert.equal(payload.exp, near);
    await DB.prepare("UPDATE mcp_refresh_families SET expires_at = ? WHERE id = ?").bind(Date.now() - 1, original.id).run();
    assert.equal((await refresh(rotated.refresh_token)).status, 400);
    assert.equal((await access(rotated.access_token)).status, 401);
  });
  await t.test("revocation is client-bound, idempotent and rejects issued access", async () => {
    const tokens = await issue();
    const revoke = client => call("/oauth/revoke", new URLSearchParams({ token: tokens.refresh_token, client_id: client }));
    assert.equal((await revoke("other")).status, 200);
    assert.notEqual((await access(tokens.access_token)).status, 401);
    assert.equal((await revoke(clientId)).status, 200);
    assert.equal((await revoke(clientId)).status, 200);
    assert.equal((await refresh(tokens.refresh_token)).status, 400);
    assert.equal((await access(tokens.access_token)).status, 401);
    assert.equal((await call("/oauth/revoke", new URLSearchParams({ token: "unknown", client_id: clientId }))).status, 200);
  });
  await t.test("transaction failure rolls back code consumption and token creation", async () => {
    const code = await seedCode();
    const failing = { prepare: (...args) => DB.prepare(...args), batch: async statements => { if (statements.length === 3) return DB.batch([...statements, DB.prepare("INSERT INTO missing_synthetic_table VALUES (1)")]); return DB.batch(statements); } };
    await assert.rejects(call("/oauth/token", exchangeParams(code), { DB: failing }));
    assert.ok(await DB.prepare("SELECT code FROM mcp_oauth_codes WHERE code = ?").bind(code).first());
    assert.equal((await call("/oauth/token", exchangeParams(code))).status, 200);
  });
});
