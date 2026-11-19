import { canonicalMcpScope } from "./mcp-scopes.js";
// Refresh credentials are never stored: only SHA-256 hashes and grant metadata.
export const REFRESH_MAX_AGE_MS = 30 * 86400_000;
export const REFRESH_RETRY_MS = 5000;
const enc = new TextEncoder();
function base64url(bytes) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
export async function hash(value) { return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value)))); }
async function sign(secret, value) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(value))));
}
export async function credentialVersion(env, origin) {
  return sign(env.SESSION_SECRET, JSON.stringify(["works-refresh-credentials:v1", origin, env.ALLOWED_EMAIL.toLowerCase(), env.WORKS_API_KEY]));
}
export async function ensureRefreshSchema(db) {
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS mcp_refresh_families (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, scope TEXT NOT NULL, origin TEXT NOT NULL, credential_version TEXT NOT NULL, expires_at INTEGER NOT NULL, current_hash TEXT NOT NULL, generation INTEGER NOT NULL, revoked_at INTEGER)"),
    db.prepare("CREATE TABLE IF NOT EXISTS mcp_refresh_tokens (token_hash TEXT PRIMARY KEY, family_id TEXT NOT NULL, generation INTEGER NOT NULL, used_at INTEGER)"),
    db.prepare("CREATE INDEX IF NOT EXISTS mcp_refresh_tokens_family ON mcp_refresh_tokens (family_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS mcp_refresh_families_expiry ON mcp_refresh_families (expires_at)"),
  ]);
}
export async function issueRefreshGrant(env, origin, clientId, scope, code) {
  // Bound maintenance to a small number of expired grants per new connection.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM mcp_refresh_tokens WHERE family_id IN (SELECT id FROM mcp_refresh_families WHERE expires_at <= ? LIMIT 100)").bind(Date.now()),
    env.DB.prepare("DELETE FROM mcp_refresh_families WHERE id IN (SELECT id FROM mcp_refresh_families WHERE expires_at <= ? AND NOT EXISTS (SELECT 1 FROM mcp_refresh_tokens WHERE family_id = mcp_refresh_families.id) LIMIT 100)").bind(Date.now()),
  ]);
  const token = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await hash(token);
  const family = { id: crypto.randomUUID(), client_id: clientId, scope, origin, credential_version: await credentialVersion(env, origin), expires_at: Date.now() + REFRESH_MAX_AGE_MS, current_hash: tokenHash, generation: 0, revoked_at: null };
  const results = await env.DB.batch([
    env.DB.prepare("DELETE FROM mcp_oauth_codes WHERE code = ? AND client_id = ? AND redirect_uri = ? AND code_challenge = ? AND expires_at > ? RETURNING code").bind(code.code, clientId, code.redirect_uri, code.code_challenge, Date.now()),
    env.DB.prepare("INSERT INTO mcp_refresh_families (id, client_id, scope, origin, credential_version, expires_at, current_hash, generation) SELECT ?, ?, ?, ?, ?, ?, ?, 0 WHERE changes() = 1").bind(family.id, clientId, scope, origin, family.credential_version, family.expires_at, tokenHash),
    env.DB.prepare("INSERT INTO mcp_refresh_tokens (token_hash, family_id, generation) SELECT ?, ?, 0 WHERE changes() = 1").bind(tokenHash, family.id),
  ]);
  if (!results[0].results.length) return null;
  return { token, family };
}
export async function readRefreshFamily(env, origin, id) {
  const family = await env.DB.prepare("SELECT * FROM mcp_refresh_families WHERE id = ?").bind(id).first();
  if (!family || family.revoked_at !== null || family.expires_at <= Date.now() || family.origin !== origin || family.credential_version !== await credentialVersion(env, origin)) return null;
  return family;
}
export async function rotateRefreshGrant(env, origin, params) {
  const token = params.get("refresh_token") || "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return { error: "invalid_grant" };
  const tokenHash = await hash(token);
  const old = await env.DB.prepare("SELECT * FROM mcp_refresh_tokens WHERE token_hash = ?").bind(tokenHash).first();
  if (!old) return { error: "invalid_grant" };
  let family = await readRefreshFamily(env, origin, old.family_id);
  if (!family || family.client_id !== params.get("client_id")) return { error: "invalid_grant" };
  // Preserve the exact consented scope set; refresh cannot expand a grant.
  if (params.has("scope") && canonicalMcpScope(params.get("scope")) !== family.scope) return { error: "invalid_scope" };
  const nextToken = await sign(env.SESSION_SECRET, JSON.stringify(["works-refresh-rotation:v1", token, family.id, old.generation + 1]));
  const nextHash = await hash(nextToken);
  const now = Date.now();
  // The first update wins. changes() keeps the remaining writes tied to that CAS
  // within D1's transaction, so a competing request cannot mint another branch.
  const results = await env.DB.batch([
    env.DB.prepare("UPDATE mcp_refresh_families SET current_hash = ?, generation = generation + 1 WHERE id = ? AND current_hash = ? AND generation = ? AND revoked_at IS NULL AND expires_at > ? AND credential_version = ? RETURNING id").bind(nextHash, family.id, tokenHash, old.generation, now, family.credential_version),
    env.DB.prepare("UPDATE mcp_refresh_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND changes() = 1").bind(now, tokenHash),
    env.DB.prepare("INSERT INTO mcp_refresh_tokens (token_hash, family_id, generation) SELECT ?, ?, ? WHERE changes() = 1").bind(nextHash, family.id, old.generation + 1),
  ]);
  family = await readRefreshFamily(env, origin, old.family_id);
  if (!family) return { error: "invalid_grant" };
  if (results[0].results.length) {
    if (family.current_hash !== nextHash || family.generation !== old.generation + 1) return { error: "invalid_grant" };
    return { token: nextToken, family };
  }
  // A lost response / simultaneous request may recover the *same* successor for
  // five seconds, only while it is still current. The window never slides.
  const used = await env.DB.prepare("SELECT used_at FROM mcp_refresh_tokens WHERE token_hash = ?").bind(tokenHash).first();
  const retryAge = Date.now() - used?.used_at;
  if (used?.used_at !== null && used?.used_at !== undefined && retryAge >= 0 && retryAge <= REFRESH_RETRY_MS && family.current_hash === nextHash && family.generation === old.generation + 1) return { token: nextToken, family };
  await env.DB.prepare("UPDATE mcp_refresh_families SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(Date.now(), family.id).run();
  return { error: "invalid_grant" };
}
export async function revokeRefreshGrant(env, origin, params) {
  const token = params.get("token") || "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !params.get("client_id")) return;
  const tokenHash = await hash(token);
  await env.DB.prepare("UPDATE mcp_refresh_families SET revoked_at = ? WHERE client_id = ? AND origin = ? AND id IN (SELECT family_id FROM mcp_refresh_tokens WHERE token_hash = ?)").bind(Date.now(), params.get("client_id"), origin, tokenHash).run();
}
