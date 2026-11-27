import { createRemoteJWKSet, jwtVerify } from 'jose';
import { entryCsp, entryPage } from './entry-page.js';

const canonicalOrigin = 'https://works.lrnr.jp';
const authPrefix = '/auth/';
const defaultNext = '/tutor/';
const sessionName = '__Host-works-entry';
const stateName = '__Host-works-entry-state';
const stateTTL = 600;
const sessionTTL = 8 * 3600;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const encoder = new TextEncoder();
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const methods = {'/auth/start':'GET','/auth/callback':'GET','/auth/logout':'POST','/api/web-session':'GET'};
const prepared = new WeakMap();
const now = () => Math.floor(Date.now() / 1000);
const b64 = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const token = () => b64(crypto.getRandomValues(new Uint8Array(32)));
const cookie = (name, value, maxAge) => `${name}=${value}; Path=/; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Lax`;

const schema = [
  'CREATE TABLE IF NOT EXISTS works_entry_attempts (key TEXT PRIMARY KEY, nonce TEXT NOT NULL, verifier TEXT NOT NULL, target TEXT NOT NULL, expiry INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS works_entry_attempts_expiry ON works_entry_attempts(expiry)',
  'CREATE TABLE IF NOT EXISTS works_entry_sessions (key TEXT PRIMARY KEY, email TEXT NOT NULL, expiry INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS works_entry_sessions_expiry ON works_entry_sessions(expiry)'
];

export function existingWorksService(path) {
  return path === '/mcp' || path === '/api' || path.startsWith('/api/') ||
    path === '/oauth' || path.startsWith('/oauth/') ||
    path === '/.well-known' || path.startsWith('/.well-known/');
}

export function safeWorksNext(value) {
  if (typeof value !== 'string' || value.length > 1500 || !value.startsWith('/') || value.startsWith('//') ||
      /[\\#\u0000-\u0020\u007f]/u.test(value)) return defaultNext;
  const pathname = value.split('?')[0];
  // Don't delegate path parsing to layers which may decode or normalize again.
  if (/%(?![0-9a-f]{2})|%(?:25|2f|5c|2e|00|0a|0d)/i.test(pathname)) return defaultNext;
  try {
    const parsed = new URL(value, canonicalOrigin);
    if (parsed.origin !== canonicalOrigin || parsed.pathname.startsWith('//') ||
        existingWorksService(parsed.pathname) || parsed.pathname === "/auth" || parsed.pathname.startsWith(authPrefix)) return defaultNext;
    return parsed.pathname + parsed.search;
  } catch { return defaultNext; }
}

function allowedEmail(env) {
  return typeof env.ALLOWED_EMAIL === 'string' ? env.ALLOWED_EMAIL.trim().toLowerCase() : '';
}

function configured(env) {
  return env.ALLOWED_ORIGIN === canonicalOrigin && !!allowedEmail(env) && !!env.DB &&
    typeof env.SESSION_SECRET === 'string' && !!env.SESSION_SECRET &&
    typeof env.WORKS_ENTRY_GOOGLE_CLIENT_ID === 'string' && !!env.WORKS_ENTRY_GOOGLE_CLIENT_ID &&
    typeof env.WORKS_ENTRY_GOOGLE_CLIENT_SECRET === 'string' && !!env.WORKS_ENTRY_GOOGLE_CLIENT_SECRET &&
    typeof env.WORKS_ENTRY_SESSION_SECRET === 'string' && encoder.encode(env.WORKS_ENTRY_SESSION_SECRET).length >= 32;
}

async function ensureStore(db) {
  if (!prepared.has(db)) {
    const pending = db.batch(schema.map(sql => db.prepare(sql))).catch(error => {
      prepared.delete(db);
      throw error;
    });
    prepared.set(db, pending);
  }
  await prepared.get(db);
}

async function storageKey(env, purpose, raw) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.WORKS_ENTRY_SESSION_SECRET),
    {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  return b64(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${purpose}|${raw}`))));
}

function readCookie(request, name) {
  const values = (request.headers.get('Cookie') || '').split(';').map(x => x.trim())
    .filter(x => x.startsWith(name + '=')).map(x => x.slice(name.length + 1));
  return values.length === 1 && tokenPattern.test(values[0]) ? values[0] : null;
}

function requestIsSameSite(request, requireOrigin = false) {
  const origin = request.headers.get('Origin');
  const site = request.headers.get('Sec-Fetch-Site');
  return (origin === canonicalOrigin || (origin === null && !requireOrigin)) &&
    (site === null || site === 'same-origin' || site === 'none');
}

export async function readWorksEntrySession(request, env) {
  if (!configured(env) || new URL(request.url).origin !== canonicalOrigin) return null;
  const raw = readCookie(request, sessionName);
  if (!raw) return null;
  await ensureStore(env.DB);
  const key = await storageKey(env, 'session', raw);
  const row = await env.DB.prepare('SELECT email, expiry FROM works_entry_sessions WHERE key = ? AND expiry > ?')
    .bind(key, now()).first();
  return row?.email === allowedEmail(env) ? {email:row.email, expiresAt:row.expiry} : null;
}

export async function verifyWorksGoogleIdentity(idToken, clientId, nonce, keys = googleKeys) {
  if (typeof idToken !== 'string' || idToken.length > 8192) throw Error('invalid identity');
  const {payload} = await jwtVerify(idToken, keys, {
    issuer:['https://accounts.google.com', 'accounts.google.com'],
    audience:clientId, algorithms:['RS256'], maxTokenAge:'10m', clockTolerance:10,
    requiredClaims:['iat','exp','sub','nonce']
  });
  if (payload.aud !== clientId || (payload.azp !== undefined && payload.azp !== clientId) ||
      payload.nonce !== nonce || payload.email_verified !== true || typeof payload.email !== 'string' ||
      typeof payload.sub !== 'string' || !payload.sub) throw Error('invalid identity');
  return {email:payload.email.toLowerCase(), sub:payload.sub};
}

function reply(status, body = null, {type = 'text/html; charset=utf-8', location, cookies = []} = {}) {
  const headers = new Headers({
    'Cache-Control':'no-store', 'Content-Type':type, 'Referrer-Policy':'no-referrer',
    'X-Content-Type-Options':'nosniff', 'Cross-Origin-Resource-Policy':'same-origin',
    'X-Robots-Tag':'noindex, nofollow',
    'Content-Security-Policy':entryCsp
  });
  if (location) headers.set('Location', location);
  for (const v of cookies) headers.append('Set-Cookie', v);
  return new Response(body, {status, headers});
}

function loginPage(status, next, message = '許可されたGoogleアカウントでログインしてください。', cookies = []) {
  const target = '/auth/start?' + new URLSearchParams({next:safeWorksNext(next)});
  return reply(status, entryPage(target, message), {cookies});
}

const redirect = (location, cookies = []) => reply(303, null, {location, cookies});
const one = (q,k) => q.getAll(k).length === 1 ? q.get(k) : null;
const sessionReply = (status, data) => reply(status, JSON.stringify(data), {type:'application/json; charset=utf-8'});

export async function handleWorksWebEntry(request, env, {
  upstream = fetch, verify = verifyWorksGoogleIdentity
} = {}) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path !== '/api/web-session' && existingWorksService(path)) return null;
  if (url.origin !== canonicalOrigin || env.ALLOWED_ORIGIN !== canonicalOrigin) return reply(404);
  const route = Object.hasOwn(methods, path);
  if (!route && (path === '/auth' || path.startsWith(authPrefix))) return reply(404);
  if (route && request.method !== methods[path]) return reply(405);
  if (!route && !['GET','HEAD'].includes(request.method)) return reply(405);
  if (!configured(env)) return loginPage(503, '/', 'ログインは準備中です。');
  const expiredState = [cookie(stateName, '', 0)];
  const callback = canonicalOrigin + '/auth/callback';
  try {
    if (path === '/auth/start') {
      if (!requestIsSameSite(request) || url.search.length > 4000) return reply(403);
      const next = safeWorksNext(one(url.searchParams, 'next'));
      const state = token(), nonce = token(), verifier = token();
      const key = await storageKey(env, 'state', state);
      await ensureStore(env.DB);
      await env.DB.batch([
        env.DB.prepare('DELETE FROM works_entry_attempts WHERE expiry <= ?').bind(now()),
        env.DB.prepare('INSERT INTO works_entry_attempts (key, nonce, verifier, target, expiry) VALUES (?,?,?,?,?)')
          .bind(key, nonce, verifier, next, now() + stateTTL)
      ]);
      const challenge = b64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier))));
      const authorize = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authorize.search = new URLSearchParams({
        client_id:env.WORKS_ENTRY_GOOGLE_CLIENT_ID, redirect_uri:callback, response_type:'code',
        scope:'openid email', state, nonce, code_challenge:challenge, code_challenge_method:'S256', prompt:'select_account'
      });
      return redirect(authorize.href, [cookie(stateName, state, stateTTL)]);
    }
    if (path === '/auth/callback') {
      if (url.search.length > 4096) return loginPage(400, '/', 'ログインを確認できませんでした。');
      const state = one(url.searchParams, 'state');
      if (!state || state !== readCookie(request, stateName)) return loginPage(400, '/', 'ログインを確認できませんでした。');
      await ensureStore(env.DB);
      const attempt = await env.DB.prepare('DELETE FROM works_entry_attempts WHERE key = ? RETURNING nonce, verifier, target, expiry')
        .bind(await storageKey(env, 'state', state)).first();
      if (!attempt || attempt.expiry <= now()) return loginPage(400, '/', 'ログインの有効期限が切れました。', expiredState);
      const next = safeWorksNext(attempt.target);
      const code = one(url.searchParams, 'code');
      if (url.searchParams.has('error') || !code || code.length > 2048) return loginPage(400, next, 'ログインを完了できませんでした。', expiredState);
      let identity;
      try {
        const result = await upstream('https://oauth2.googleapis.com/token', {
          method:'POST', redirect:'manual', signal:AbortSignal.timeout(8000),
          body:new URLSearchParams({
            code, client_id:env.WORKS_ENTRY_GOOGLE_CLIENT_ID, client_secret:env.WORKS_ENTRY_GOOGLE_CLIENT_SECRET,
            redirect_uri:callback, code_verifier:attempt.verifier, grant_type:'authorization_code'
          })
        });
        if (!result.ok) throw Error('token exchange rejected');
        const {id_token} = await result.json();
        identity = await verify(id_token, env.WORKS_ENTRY_GOOGLE_CLIENT_ID, attempt.nonce);
      } catch { return loginPage(502, next, 'Googleログインを完了できませんでした。', expiredState); }
      if (identity?.email !== allowedEmail(env)) return loginPage(403, next, 'このGoogleアカウントにはアクセス権がありません。', expiredState);
      const fresh = token(), rawOld = readCookie(request, sessionName);
      const oldKey = rawOld ? await storageKey(env, 'session', rawOld) : '';
      await env.DB.batch([
        env.DB.prepare('DELETE FROM works_entry_sessions WHERE key = ? OR expiry <= ?').bind(oldKey, now()),
        env.DB.prepare('INSERT INTO works_entry_sessions (key, email, expiry) VALUES (?,?,?)')
          .bind(await storageKey(env, 'session', fresh), identity.email, now() + sessionTTL)
      ]);
      return redirect(next, [...expiredState, cookie(sessionName, fresh, sessionTTL)]);
    }
    if (path === '/auth/logout') {
      if (!requestIsSameSite(request, true)) return reply(403);
      const raw = readCookie(request, sessionName), pending = readCookie(request, stateName);
      if (raw || pending) {
        await ensureStore(env.DB);
        const removes = [];
        if (raw) removes.push(env.DB.prepare('DELETE FROM works_entry_sessions WHERE key = ?').bind(await storageKey(env, 'session', raw)));
        if (pending) removes.push(env.DB.prepare('DELETE FROM works_entry_attempts WHERE key = ?').bind(await storageKey(env, 'state', pending)));
        await env.DB.batch(removes);
      }
      return reply(200, JSON.stringify({ok:true}), {type:'application/json; charset=utf-8', cookies:[cookie(sessionName, '', 0), ...expiredState]});
    }
    if (path === '/api/web-session') {
      if (!requestIsSameSite(request) || url.search) return sessionReply(403, {error:'forbidden'});
      const session = await readWorksEntrySession(request, env);
      if (!session) return sessionReply(401, {error:'unauthorized'});
      return sessionReply(200, {
        session_token:'cookie-session', user:{name:'Works',email:session.email}
      });
    }
    const site = request.headers.get('Sec-Fetch-Site');
    if ((site === 'cross-site' || site === 'same-site') && request.headers.get('Sec-Fetch-Mode') !== 'navigate') return reply(401);
    if (await readWorksEntrySession(request, env)) return null;
    const htmlRequest = request.headers.get('Sec-Fetch-Mode') === 'navigate' ||
      (request.headers.get('Accept') || '').toLowerCase().includes('text/html');
    if (!htmlRequest || request.method === 'HEAD') return reply(401);
    return loginPage(200, safeWorksNext(path + url.search));
  } catch { return reply(503); }
}
