import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { handleWorksWebEntry, readWorksEntrySession, safeWorksNext, verifyWorksGoogleIdentity } from '../src/web-entry.js';

const origin = 'https://works.lrnr.jp';
const authScope = 'openid email';
const sessionName = '__Host-works-entry';
const stateName = '__Host-works-entry-state';
const secure = (r,name) => r.headers.getSetCookie().find(c=>c.startsWith(name + '='));
const cookie = (r,name) => secure(r,name)?.split(';')[0];
const now = () => Math.floor(Date.now()/1000);
const pair = await generateKeyPair('RS256');
const rogue = await generateKeyPair('RS256');
const keys = createLocalJWKSet({keys:[{...await exportJWK(pair.publicKey),alg:'RS256',kid:'test'}]});

function fixture({ claims = {}, key = pair.privateKey, response, sqlite = new DatabaseSync(':memory:') } = {}) {
  const prepare = (sql, args = []) => {
    const statement = () => sqlite.prepare(sql);
    return {
      bind: (...values) => prepare(sql, values),
      first: async () => statement().get(...args),
      run: () => statement().run(...args)
    };
  };
  const DB = { prepare, batch: async statements => {
    sqlite.exec('BEGIN');
    try {
      const results = statements.map(stmt=>stmt.run());
      sqlite.exec('COMMIT');
      return results;
    } catch (e) { sqlite.exec('ROLLBACK'); throw e; }
  }};
  const env = {
    DB, ALLOWED_ORIGIN:origin, ALLOWED_EMAIL:'owner@gmail.com',
    SESSION_SECRET:'legacy-work-auth-secret',
    WORKS_ENTRY_SESSION_SECRET:'mock-32-byte-entry-session-key-is-long-enough',
    WORKS_ENTRY_GOOGLE_CLIENT_ID:'separate-login-client',
    WORKS_ENTRY_GOOGLE_CLIENT_SECRET:'separate-login-secret',
    GOOGLE_CLIENT_ID:'old-calendar-client',
    GOOGLE_CLIENT_SECRET:'old-calendar-secret'
  };
  const exchanges = [];
  const oauth = new Map();
  let id = 0;
  const app = request => handleWorksWebEntry(request, env, {
    verify:(jwt,aud,nonce) => verifyWorksGoogleIdentity(jwt,aud,nonce,keys),
    upstream:async (url, init) => {
      exchanges.push({url,init});
      assert.equal(url,'https://oauth2.googleapis.com/token');
      assert.equal(init.method,'POST');
      assert.equal(init.redirect,'manual');
      assert.equal(init.body.get('client_id'),'separate-login-client');
      assert.equal(init.body.get('client_secret'),'separate-login-secret');
      assert.equal(init.body.get('redirect_uri'),origin+'/auth/callback');
      const attempted = oauth.get(init.body.get('code'));
      assert.ok(attempted);
      assert.equal(createHash('sha256').update(init.body.get('code_verifier')).digest('base64url'),attempted.get('code_challenge'));
      if (response) return response;
      const jwt = await new SignJWT({
        iss:'https://accounts.google.com', aud:env.WORKS_ENTRY_GOOGLE_CLIENT_ID,
        iat:now(), exp:now()+300, sub:'synthetic-sub', nonce:attempted.get('nonce'),
        email:'owner@gmail.com', email_verified:true, ...claims
      }).setProtectedHeader({alg:'RS256',kid:'test'}).sign(key);
      return Response.json({id_token:jwt, access_token:'not-returned',refresh_token:'must-not-save'});
    }
  });
  const call = (path,init) => app(new Request(origin+path,init));
  async function start(next = '/todo/?view=upcoming') {
    const r = await call('/auth/start?' + new URLSearchParams({next}));
    assert.equal(r.status,303);
    assert.match(secure(r,stateName),/; Path=\/; Max-Age=600; Secure; HttpOnly; SameSite=Lax$/);
    const u = new URL(r.headers.get('Location'));
    assert.equal(u.origin,'https://accounts.google.com');
    assert.equal(u.searchParams.get('scope'),authScope);
    assert.equal(u.searchParams.get('access_type'),null);
    assert.equal(u.searchParams.get('code_challenge_method'),'S256');
    const code = 'code'+(++id);
    oauth.set(code,u.searchParams);
    return {
      path:'/auth/callback?'+new URLSearchParams({code,state:u.searchParams.get('state')}),
      headers:{Cookie:cookie(r,stateName),'Sec-Fetch-Site':'cross-site'}
    };
  }
  return {env, app, call, start, sqlite, exchanges};
}

test('signed code login gates documents and assets, preserves safe next, and issues only a cookie sentinel', async () => {
  const f = fixture();
  assert.equal((await f.call('/todo/todo.js')).status,401);
  const page = await f.call('/todo/?view=upcoming',{headers:{Accept:'text/html'}});
  assert.equal(page.status,200);
  assert.equal(page.headers.get('Cache-Control'),'no-store');
  assert.match(await page.text(), /Googleでログイン/);
  assert.equal((await f.call('/api/web-session')).status,401);
  const logout = await f.call('/auth/logout',{method:'POST',headers:{Origin:origin}});
  assert.equal(logout.status,200);
  const attempt = await f.start();
  const response = await f.call(attempt.path,{headers:attempt.headers});
  assert.equal(response.status,303);
  assert.equal(response.headers.get('Location'),'/todo/?view=upcoming');
  assert.match(secure(response,sessionName), /; Path=\/; Max-Age=28800; Secure; HttpOnly; SameSite=Lax$/);
  assert.equal(await response.text(),'');
  const headers = {Cookie:cookie(response,sessionName)};
  assert.equal(await f.call('/todo/?view=upcoming',{headers}),null);
  assert.equal(await f.call('/todo/todo.js',{headers}),null);
  const stored = f.sqlite.prepare('SELECT * FROM works_entry_sessions').get();
  assert.notEqual(stored.key, headers.Cookie.split('=')[1]);
  const s = new Request(origin+'/api/memo',{headers});
  assert.equal((await readWorksEntrySession(s,f.env)).email,'owner@gmail.com');
  assert.equal(await f.call('/api/memo',{headers}),null);
  const session = await f.call('/api/web-session',{headers});
  assert.deepEqual(await session.json(),{session_token:'cookie-session',user:{name:'Works',email:'owner@gmail.com'}});
  for (const extra of [{Origin:'https://another.lrnr.jp'},{'Sec-Fetch-Site':'same-site'}]) {
    assert.equal((await f.call('/api/web-session',{headers:{...headers,...extra}})).status,403);
  }
  assert.equal((await f.call('/todo/todo.js',{headers:{...headers,'Sec-Fetch-Site':'same-site'}})).status,401);
  assert.equal((await f.call('/api/web-session',{headers:{Cookie:headers.Cookie+'; '+headers.Cookie}})).status,401);
  assert.equal((await f.call('/auth/logout',{method:'POST',headers})).status,403);
  assert.equal((await f.call('/auth/logout',{method:'POST',headers:{...headers,Origin:origin}})).status,200);
  assert.equal((await f.call('/api/web-session',{headers})).status,401);
  assert.equal((await f.call(attempt.path,{headers:attempt.headers})).status,400);
  assert.equal(f.exchanges.length,1);
});

test('one-use Google attempt, expired state, current owner changes, and independent session keys', async () => {
  const f = fixture();
  const expired = await f.start();
  f.sqlite.exec('UPDATE works_entry_attempts SET expiry = 0');
  assert.equal((await f.call(expired.path,{headers:expired.headers})).status,400);
  const a = await f.start();
  assert.equal((await f.call(a.path)).status,400);
  assert.equal((await f.call(a.path+'&state=duplicate',{headers:a.headers})).status,400);
  const responses = await Promise.all([f.call(a.path,{headers:a.headers}), f.call(a.path,{headers:a.headers})]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[303,400]);
  const headers = {Cookie:cookie(responses.find(r=>r.status===303),sessionName)};
  f.env.ALLOWED_EMAIL='other@gmail.com';
  assert.equal((await f.call('/api/web-session',{headers})).status,401);
  f.env.ALLOWED_EMAIL='owner@gmail.com';
  f.env.WORKS_ENTRY_SESSION_SECRET='another-independent-session-secret-at-least-32-byte';
  assert.equal((await f.call('/api/web-session',{headers})).status,401);
  f.env.WORKS_ENTRY_SESSION_SECRET='mock-32-byte-entry-session-key-is-long-enough';
  f.sqlite.exec('UPDATE works_entry_sessions SET expiry = 0');
  assert.equal((await f.call('/api/web-session',{headers})).status,401);
  assert.equal(f.exchanges.length,1);
});

test('reject unverified Google claim, wrong JWT key/issuer/audience/nonce, and token exchange redirect', async () => {
  for (const options of [
    {claims:{email:'outsider@gmail.com'},status:403},
    {claims:{email_verified:false},status:502},
    {claims:{nonce:'mismatch'},status:502},
    {claims:{aud:'old-calendar-client'},status:502},
    {claims:{azp:'old-calendar-client'},status:502},
    {claims:{iss:'https://bad.example'},status:502},
    {claims:{iat:now()-700,exp:now()-100},status:502},
    {key:rogue.privateKey,status:502},
    {response:Response.redirect('https://bad.example/token'),status:502}
  ]) {
    const f = fixture(options), a = await f.start();
    const r = await f.call(a.path,{headers:a.headers});
    assert.equal(r.status,options.status);
    assert.equal(cookie(r,sessionName),undefined);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM works_entry_sessions').get().count,0);
  }
});

test('safe forward target and all legacy contracts excluded regardless of missing entry config', async () => {
  for (const bad of ['https://elsewhere.test/','//elsewhere.test/','/\\elsewhere.test/','/x/%252Fother.test','/%2Felsewhere.test/','/%2e%2e//elsewhere.test/','/foo/../auth/callback','/api/google-token','/mcp','/oauth/token','/.well-known/token','/a#hash','/a\n','/auth']) assert.equal(safeWorksNext(bad),'/tutor/');
  assert.equal(safeWorksNext('/'),'/tutor/');
  assert.equal(safeWorksNext('/memo/?x=%E3%83%A1&y=10'),'/memo/?x=%E3%83%A1&y=10');
  const f = fixture();
  assert.equal((await f.app(new Request('https://other.example/todo/',{headers:{Accept:'text/html'}}))).status,404);
  delete f.env.WORKS_ENTRY_GOOGLE_CLIENT_SECRET;
  for (const legacy of ['/api','/api/schedule','/api/auth/callback','/api/workflow/execution','/mcp','/oauth/token','/.well-known/oauth-protected-resource']) {
    assert.equal(await f.call(legacy),null);
  }
  assert.equal((await f.call('/todo/',{headers:{Accept:'text/html'}})).status,503);
});
