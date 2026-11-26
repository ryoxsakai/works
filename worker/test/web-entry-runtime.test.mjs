import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { Miniflare } from 'miniflare';
import { bundledWorker } from './bundled-worker.mjs';

const origin = 'https://works.lrnr.jp';
const member = 'test@generic.example';
const bindings = {
  ALLOWED_ORIGIN: origin, ALLOWED_EMAIL: member, SESSION_SECRET:'legacy test secret',
  WORKS_ENTRY_ENABLED:'true', WORKS_ENTRY_GOOGLE_CLIENT_ID:'new-synthetic-client',
  WORKS_ENTRY_GOOGLE_CLIENT_SECRET:'entry test secret', WORKS_ENTRY_SESSION_SECRET:'separate entry synthetic secret over thirty-two bytes',
};
const signedLegacy = async () => {
  const payload = Buffer.from(JSON.stringify({email:member,exp:Date.now()+3600000})).toString('base64url');
  const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(bindings.SESSION_SECRET),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  const mac = await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(payload));
  return 'Bearer ' + payload + '.' + Buffer.from(mac).toString('base64url');
};
const cookie = (r, name) => r.headers.getSetCookie().find(c => c.startsWith(name+'=')).split(';')[0];

test('Worker gates private Assets and browser APIs using a live entry session without changing legacy/MCP auth', async t => {
  const keys = await generateKeyPair('RS256');
  const jwk = {...await exportJWK(keys.publicKey),kid:'synthetic',alg:'RS256',use:'sig'};
  let nonce, calls=0;
  const mf = new Miniflare({
    modules:true, script:await bundledWorker(), compatibilityDate:'2026-08-01', bindings,
    d1Databases:{DB:'works-entry-int'}, serviceBindings:{WORKS_WEB_ASSETS: request => {
      calls++;
      assert.equal(request.headers.get('Cookie'),null);
      assert.equal(request.headers.get('Authorization'),null);
      const url = new URL(request.url);
      if (url.pathname === '/todo') return Response.redirect(origin+'/todo/',308);
      if (url.pathname === '/bad-redirect') return Response.redirect('https://outside.example/',308);
      if (url.pathname === '/bad-double-slash') return Response.redirect(origin+'//outside.example/',308);
      if (url.pathname === '/todo/') return new Response('<h1>Private Works</h1>',{headers:{'Content-Type':'text/html'}});
      if (url.pathname === '/shared/asset.js') return new Response('ok',{headers:{'Content-Type':'text/javascript'}});
      return new Response(null,{status:404});
    }},
    outboundService:async request => {
      if (request.url === 'https://www.googleapis.com/oauth2/v3/certs') return Response.json({keys:[jwk]});
      assert.equal(request.url,'https://oauth2.googleapis.com/token');
      const form = new URLSearchParams(await request.text());
      assert.equal(form.get('client_id'), bindings.WORKS_ENTRY_GOOGLE_CLIENT_ID);
      assert.equal(form.get('redirect_uri'),origin+'/auth/callback');
      assert.ok(form.get('code_verifier'));
      return Response.json({id_token:await new SignJWT({nonce, email:member, email_verified:true})
        .setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer('https://accounts.google.com')
        .setAudience(bindings.WORKS_ENTRY_GOOGLE_CLIENT_ID).setSubject('test-subject')
        .setIssuedAt().setExpirationTime('5m').sign(keys.privateKey)});
    }
  });
  t.after(()=>mf.dispose());
  const db=await mf.getD1Database('DB');
  await db.batch([
    db.prepare('CREATE TABLE todo_state (id INTEGER PRIMARY KEY, data TEXT, revision INTEGER)'),
    db.prepare('CREATE TABLE google_auth (id INTEGER PRIMARY KEY, refresh_token TEXT, updated_at TEXT)'),
    db.prepare("INSERT INTO google_auth VALUES (1, 'synthetic-calendar-refresh', '2026-11-26')")
  ]);
  const req=(path,headers={},method='GET')=>mf.dispatchFetch(origin+path,{method,headers,redirect:'manual'});
  const anon=await req('/todo?mode=planner',{Accept:'text/html'});
  assert.equal(anon.status,200);
  assert.match(await anon.text(),/Googleでログイン/);
  assert.equal((await req('/shared/asset.js')).status,401);
  assert.equal((await req('/api/web-session')).status,401);
  assert.equal((await req('/.well-known/oauth-protected-resource')).status,200);
  assert.equal(calls,0);
  const start=await req('/auth/start?next=%2Ftodo%3Fmode%3Dplanner');
  const q=new URL(start.headers.get('Location')).searchParams;
  nonce=q.get('nonce');
  const callback=await req('/auth/callback?code=synthetic&state='+q.get('state'),
    {Cookie:cookie(start,'__Host-works-entry-state')});
  assert.equal(callback.status,303,await callback.clone().text());
  assert.equal(callback.headers.get('Location'),'/todo?mode=planner');
  const Cookie=cookie(callback,'__Host-works-entry');
  const canonical = await req('/todo?mode=planner',{Cookie}); assert.equal(canonical.status,308,await canonical.clone().text()); assert.equal(canonical.headers.get('Location'),'/todo/?mode=planner');
  const html=await req('/todo/',{Cookie});
  assert.equal(html.headers.get('Cache-Control'),'private, no-store');
  assert.match(await html.text(),/Private Works/);
  assert.equal((await req('/bad-redirect',{Cookie})).status,404);
  assert.equal((await req('/bad-double-slash',{Cookie})).status,404);
  assert.equal((await req('/shared/asset.js',{Cookie,'Sec-Fetch-Site':'same-site'})).status,401);
  const state=await (await req('/api/web-session',{Cookie})).json();
  assert.equal(state.session_token,'cookie-session');
  assert.equal(state.user.email,member);
  const Authorization='Bearer '+state.session_token;
  assert.equal((await req('/api/todo',{Cookie,Authorization})).status,200);
  assert.equal((await req('/api/todo',{Authorization})).status,401);
  assert.equal((await req('/api/todo',{Cookie,Authorization,Origin:'https://outside.example'})).status,401);
  assert.equal((await req('/api/todo',{Cookie,Authorization},'PUT')).status,401);
  assert.equal((await req('/api/auth/logout',{Cookie,Authorization,Origin:origin},'POST')).status,401);
  assert.equal((await req('/auth/logout',{Cookie,Origin:origin},'POST')).status,200);
  assert.equal((await req('/api/todo',{Cookie,Authorization})).status,401);
  assert.equal((await req('/api/todo',{Authorization:await signedLegacy()})).status,200);
  assert.equal((await db.prepare('SELECT refresh_token FROM google_auth WHERE id=1').first()).refresh_token,'synthetic-calendar-refresh');
});
