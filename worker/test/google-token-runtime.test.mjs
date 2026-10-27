import assert from "node:assert/strict";
import test from "node:test";
import { Miniflare, createFetchMock } from "miniflare";
import { fetch as fixtureFetch } from "undici";
import { hash, issueRefreshGrant } from "../src/oauth-refresh.js";
import worker from "../src/index.js";

const origin = "https://works.example.test";
const bindings = { SESSION_SECRET: "runtime-synthetic-secret", WORKS_API_KEY: "runtime-synthetic-key", ALLOWED_EMAIL: "owner@example.test", ALLOWED_ORIGIN: origin, GOOGLE_CLIENT_ID: "synthetic-client", GOOGLE_CLIENT_SECRET: "synthetic-google-secret" };
async function browserToken(claims = {}) {
  const payload = Buffer.from(JSON.stringify({ email: bindings.ALLOWED_EMAIL, exp: Date.now() + 86400000, ...claims })).toString("base64url");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(bindings.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `${payload}.${Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))).toString("base64url")}`;
}
async function setup(t) {
  const fetchMock = createFetchMock();
  const externalRequests = [];
  fetchMock.disableNetConnect(); // Every external request must match a synthetic fixture.
  const mf = new Miniflare({ modules: true, modulesRoot: new URL("../../", import.meta.url).pathname, modulesRules: [{ type: "ESModule", include: ["**/*.js"] }], scriptPath: new URL("../src/index.js", import.meta.url).pathname, compatibilityDate: "2026-08-01", d1Databases: { DB: "runtime-test" }, bindings, outboundService: async request => {
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
test('actual Worker routes read and conditionally save the next lesson without copying other fields', async t => {
  const {DB,fetchMock,call}=await setup(t);
  const source={id:'a',summary:'サンプル生徒',etag:'"a-1"',start:{dateTime:'2026-10-17T10:00:00+09:00'},end:{dateTime:'2026-10-17T11:00:00+09:00'}};
  const target={...source,id:'b',etag:'"b-1"',start:{dateTime:'2026-10-17T11:00:00+09:00'},end:{dateTime:'2026-10-17T12:00:00+09:00'}};
  await DB.prepare("INSERT INTO curriculum_entries(calendar_event_id,lesson_plan,homework)VALUES('b','既存予定','既存宿題')").run();
  const {ensureAttribution}=await import('../src/lesson-attribution.js');await ensureAttribution({DB});
  await DB.prepare("INSERT INTO lesson_record_hold(event_id,calendar_id,reason)VALUES('b','synthetic-calendar','known_title_change')").run();
  fetchMock.get('https://oauth2.googleapis.com').intercept({path:'/token',method:'POST'}).reply(200,{access_token:'synthetic-google-access',expires_in:3600}).persist();
  const google=fetchMock.get('https://www.googleapis.com');
  google.intercept({path:'/calendar/v3/calendars/synthetic-calendar/events/a',method:'GET'}).reply(200,source).persist();
  google.intercept({path:'/calendar/v3/calendars/synthetic-calendar/events/b',method:'GET'}).reply(200,target).persist();
  google.intercept({path:/\/calendar\/v3\/calendars\/synthetic-calendar\/events\?/,method:'GET'}).reply(200,{items:[source,target]}).persist();
  const apiPath='/api/next-lesson-plan?calendar_id=synthetic-calendar&event_id=a';
  assert.equal((await call(apiPath)).status,401);
  const headers={Authorization:'Bearer '+await browserToken(),'Content-Type':'application/json'};
  const bearer=await browserToken({aud:'works-mcp',scope:'schedule:read'});
  const mcp=async(name,args)=>(await call('/mcp',{method:'POST',headers:{Authorization:'Bearer '+bearer,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})})).json();
  const schedule=await mcp('get_schedule',{date:'2026-10-17'});
  assert.ok(!schedule.result.isError,JSON.stringify(schedule));
  const held=schedule.result.structuredContent.events.find(e=>e.id==='b');
  assert.equal(held.attribution_status,'known_change');assert.equal(held.lesson_plan,null);assert.equal(held.homework,null);
  const monthly=await mcp('get_monthly_report',{month:'2026-10'});
  assert.ok(!monthly.result.isError,JSON.stringify(monthly));
  assert.equal(monthly.result.structuredContent.totals.attribution_pending,1);
  assert.equal(monthly.result.structuredContent.totals.unrecorded,1);
  assert.equal(monthly.result.structuredContent.totals.completion_rate,null);
  const unrecorded=await mcp('get_unrecorded_lessons',{end_date:'2026-10-17',lookback_days:1});
  assert.ok(!unrecorded.result.isError,JSON.stringify(unrecorded));
  assert.equal(unrecorded.result.structuredContent.attribution_pending_count,1);
  assert.equal(unrecorded.result.structuredContent.lessons.some(event=>event.id==='b'),false);

  const blocked=await mcp('update_schedule',{calendar_id:'synthetic-calendar',event_id:'b',homework:'must not write'});
  assert.equal(blocked.result.isError,true);
  const response=await call(apiPath,{headers});assert.equal(response.status,200);const linked=await response.json();
  assert.equal(linked.target.id,'b');assert.equal(linked.lesson_plan,'');assert.equal(linked.attribution_status,'known_change');
  const withheld=await call('/api/lesson-plan',{method:'PUT',headers,body:JSON.stringify({target:linked.target,expected_lesson_plan:'',lesson_plan:'must not save'})});
  assert.equal(withheld.status,409);
  assert.equal((await call('/api/curriculum',{headers}).then(r=>r.json()))[0].lesson_plan,undefined);
  const review=await call('/api/lesson-record?calendar_id=synthetic-calendar&event_id=b',{headers}).then(r=>r.json());
  assert.equal(review.record.lesson_plan,null);assert.equal(review.previous_record.lesson_plan,'既存予定');
  const resolution=await call('/api/lesson-record',{method:'PUT',headers,body:JSON.stringify({target:review.target,record_revision:review.previous_record.record_revision,decision:'inherit'})});
  assert.equal(resolution.status,200);assert.equal((await resolution.json()).lesson_plan,'既存予定');
  const stale=await call('/api/curriculum/b',{method:'PUT',headers,body:JSON.stringify({homework:'obsolete client'})});assert.equal(stale.status,409);
  const refreshed=await call(apiPath,{headers}).then(r=>r.json());Object.assign(linked,refreshed);
  assert.equal(linked.lesson_plan,'既存予定');
  const value={source:linked.source,target:linked.target,record_revision:linked.record_revision,expected_lesson_plan:linked.lesson_plan,lesson_plan:'次回の準備'};
  const saved=await call('/api/lesson-plan',{method:'PUT',headers,body:JSON.stringify(value)});assert.equal(saved.status,200);
  assert.equal((await saved.json()).lesson_plan,'次回の準備');
  assert.equal((await DB.prepare("SELECT homework FROM curriculum_entries WHERE calendar_event_id='b'").first()).homework,'既存宿題');
  assert.equal(await DB.prepare("SELECT * FROM curriculum_entries WHERE calendar_event_id='a'").first(),null);
  const conflict=await call('/api/lesson-plan',{method:'PUT',headers,body:JSON.stringify({...value,lesson_plan:'古い予定'})});assert.equal(conflict.status,409);assert.equal((await conflict.json()).code,'LESSON_PLAN_CONFLICT');
  const updated=await mcp('update_schedule',{calendar_id:'synthetic-calendar',event_id:'b',homework:'MCP宿題'});
  assert.ok(!updated.result.isError,JSON.stringify(updated));assert.equal(updated.result.structuredContent.entry.lesson_plan,'次回の準備');
  // Even equal-title/content re-attribution invalidates prior ownership history.
  const again=await call('/api/lesson-record?calendar_id=synthetic-calendar&event_id=b',{headers}).then(r=>r.json());
  assert.equal((await call('/api/lesson-record',{method:'PUT',headers,body:JSON.stringify({target:again.target,record_revision:again.previous_record.record_revision,decision:'inherit'})})).status,200);
  const undone=await mcp('undo_schedule_update',{change_id:updated.result.structuredContent.change_id});
  assert.equal(undone.result.isError,true);
  assert.equal((await DB.prepare("SELECT homework FROM curriculum_entries WHERE calendar_event_id='b'").first()).homework,'MCP宿題');
  const created=await mcp('update_schedule',{calendar_id:'synthetic-calendar',event_id:'a',homework:'new event'});
  assert.ok(!created.result.isError,JSON.stringify(created));
  const undoCreated=await mcp('undo_schedule_update',{change_id:created.result.structuredContent.change_id});
  assert.ok(!undoCreated.result.isError,JSON.stringify(undoCreated));
  assert.equal(await DB.prepare("SELECT * FROM curriculum_entries WHERE calendar_event_id='a'").first(),null);
  const tombstone=(await call('/api/curriculum?attribution=1',{headers}).then(r=>r.json())).find(row=>row.calendar_event_id==='a');
  assert.equal(tombstone.record_exists,0);assert.ok(tombstone.record_revision>0);
  await DB.prepare("UPDATE settings SET value='[\"synthetic-calendar\",\"second-calendar\"]' WHERE key='selected_calendars'").run();
  google.intercept({path:'/calendar/v3/calendars/second-calendar/events/a',method:'GET'}).reply(200,source).persist();
  const collision=await mcp('update_schedule',{calendar_id:'synthetic-calendar',event_id:'a',homework:'collision write'});
  assert.equal(collision.result.isError,true);
  assert.equal(await DB.prepare("SELECT * FROM curriculum_entries WHERE calendar_event_id='a'").first(),null);

});

test('prospective baseline preserves unverified plans, observes on first MCP write, and supports controlled initial sweep',async t=>{
 const {DB,fetchMock,call}=await setup(t);
 const {ensureAttribution}=await import('../src/lesson-attribution.js');const {activationSql}=await import('../scripts/prepare-lesson-attribution-config.mjs');
 await ensureAttribution({DB});
 const config=activationSql({effective_date:'2026-10-27',holds:[{event_id:'held-existing-change',calendar_id:'synthetic-calendar',reason:'known_title_change'}]});
 await DB.batch(config.split('\n').filter(line=>line&&!line.startsWith('--')).map(line=>DB.prepare(line)));
 for(const id of ['legacy','sweep','history'])await DB.prepare("INSERT INTO curriculum_entries(calendar_event_id,completed,lesson_plan,homework)VALUES(?,1,'original legacy plan','original homework')").bind(id).run();
 const event={id:'legacy',summary:'Synthetic Baseline Student',etag:'one',start:{dateTime:'2026-10-27T12:50:00+09:00'},end:{dateTime:'2026-10-27T13:50:00+09:00'}};
 fetchMock.get('https://oauth2.googleapis.com').intercept({path:'/token',method:'POST'}).reply(200,{access_token:'synthetic',expires_in:3600}).persist();
 const google=fetchMock.get('https://www.googleapis.com');
 google.intercept({path:'/calendar/v3/calendars/synthetic-calendar/events/legacy',method:'GET'}).reply(()=>({statusCode:200,data:JSON.stringify(event)})).persist();
 google.intercept({path:'/calendar/v3/calendars/synthetic-calendar/events/sweep',method:'GET'}).reply(200,{...event,id:'sweep'}).persist();
 google.intercept({path:'/calendar/v3/calendars/synthetic-calendar/events/history',method:'GET'}).reply(200,{...event,id:'history',start:{dateTime:'2026-10-26T12:50:00+09:00'},end:{dateTime:'2026-10-26T13:50:00+09:00'}}).persist();
 const bearer=await browserToken({aud:'works-mcp',scope:'schedule:read'});
 const mcp=async(name,args)=>(await call('/mcp',{method:'POST',headers:{Authorization:'Bearer '+bearer,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})})).json();
 const updated=await mcp('update_schedule',{calendar_id:'synthetic-calendar',event_id:'legacy',homework:'edited'});
 assert.ok(!updated.result.isError,JSON.stringify(updated));const saved=updated.result.structuredContent.entry;
 assert.equal(saved.attribution_status,'legacy_unverified');assert.equal(saved.record_title,null);assert.equal(saved.lesson_plan,'original legacy plan');
 assert.equal((await DB.prepare("SELECT title FROM lesson_record_baseline WHERE event_id='legacy'").first()).title,event.summary);
 const undone=await mcp('undo_schedule_update',{change_id:updated.result.structuredContent.change_id});
 assert.ok(!undone.result.isError,JSON.stringify(undone));
 assert.equal(undone.result.structuredContent.restored.attribution_status,'legacy_unverified');
 assert.equal((await DB.prepare("SELECT title FROM lesson_record_identity WHERE event_id='legacy'").first()).title,null);
 assert.equal((await DB.prepare("SELECT homework FROM curriculum_entries WHERE calendar_event_id='legacy'").first()).homework,'original homework');

 const original=await DB.prepare("SELECT snapshot_json FROM lesson_record_legacy_source WHERE event_id='legacy'").first();assert.equal(JSON.parse(original.snapshot_json).homework,'original homework');
 const headers={Authorization:'Bearer '+await browserToken(),'Content-Type':'application/json'};
 const sweep=await call('/api/lesson-baseline/initialize',{method:'POST',headers,body:JSON.stringify({limit:25})});assert.equal(sweep.status,200);
 const result=await sweep.json();assert.equal(result.observed,1);assert.equal(result.historical,1);assert.equal(result.held,1);assert.equal(result.ownership_verified,false);
 assert.equal(await DB.prepare("SELECT * FROM lesson_record_baseline WHERE event_id='history'").first(),null);
 event.summary='Replacement Synthetic Student';event.etag='two';
 const changed=await call('/api/lesson-plan?calendar_id=synthetic-calendar&event_id=legacy',{headers}).then(r=>r.json());
 assert.equal(changed.attribution_status,'title_changed');assert.equal(changed.lesson_plan,'');
 assert.equal((await DB.prepare("SELECT title FROM lesson_record_baseline WHERE event_id='legacy'").first()).title,'Synthetic Baseline Student');
});

test('initialization budgets cold D1 statements and all selected-calendar fetches, caps old callers, and resumes partial failure',async t=>{
 const {DB}=await setup(t);
 const {ensureAttribution}=await import('../src/lesson-attribution.js');
 const {activationSql}=await import('../scripts/prepare-lesson-attribution-config.mjs');
 await ensureAttribution({DB});
 await DB.batch(activationSql({effective_date:'2026-10-27',holds:[{event_id:'hold',calendar_id:'cal-0',reason:'known_title_change'}]}).split('\n').filter(line=>line&&!line.startsWith('--')).map(line=>DB.prepare(line)));
 for(let i=0;i<5;i++)await DB.prepare("INSERT INTO curriculum_entries(calendar_event_id,completed,lesson_plan)VALUES(?,1,'preserve original')").bind('budget-'+i).run();
 let budget=0,calendarFetches=0,failedId=null,renamed=false,conflict=false;
 const wrap=statement=>new Proxy(statement,{get(target,key){
   if(key==='bind')return (...args)=>wrap(target.bind(...args));
   if(['all','first','run','raw'].includes(key))return (...args)=>{budget++;return target[key](...args);};
   const value=target[key];return typeof value==='function'?value.bind(target):value;
 }});
 const countedDB={prepare:sql=>wrap(DB.prepare(sql)),batch:statements=>{budget+=statements.length;
   if(conflict && statements.length===5){conflict=false;throw new Error('CHECK constraint failed');}
   return DB.batch(statements);}};
 t.mock.method(globalThis,'fetch',async url=>{
   budget++;
   if(String(url).includes('oauth2.googleapis.com'))return Response.json({access_token:'synthetic',expires_in:3600});
   calendarFetches++;const parsed=new URL(url),id=decodeURIComponent(parsed.pathname.split('/').at(-1));
   if(id===failedId)return new Response('temporary failure',{status:503});
   if(!parsed.pathname.includes('/cal-0/'))return new Response('',{status:404});
   return Response.json({id,summary:renamed?'Later title':'Observed title',start:{dateTime:'2026-10-27T12:50:00+09:00'},end:{dateTime:'2026-10-27T13:50:00+09:00'}});
 });
 const headers={Authorization:'Bearer '+await browserToken(),'Content-Type':'application/json'};
 const invoke=async(body={limit:25})=>{
   budget=0;calendarFetches=0;
   const response=await worker.fetch(new Request(origin+'/api/lesson-baseline/initialize',{method:'POST',headers,body:JSON.stringify(body)}),{...bindings,DB:{...countedDB}});
   assert.ok(budget<=45,`cold/warm invocation used ${budget} subrequests`);
   return {status:response.status,...await response.json(),calendarFetches,budget};
 };
 for(const n of [1,3,10,17]) {
   await DB.prepare("UPDATE settings SET value=? WHERE key='selected_calendars'").bind(JSON.stringify(Array.from({length:n},(_,i)=>'cal-'+i))).run();
   // Reset only synthetic observation fixtures to exercise every cold/warm budget.
   await DB.prepare('DELETE FROM lesson_record_baseline').run();await DB.prepare('DELETE FROM lesson_record_legacy_source').run();
   const result=await invoke();assert.equal(result.status,200);assert.ok(result.inspected<=2);assert.equal(result.calendarFetches,result.inspected*n);assert.equal(result.ownership_verified,false);
 }
 await DB.prepare("UPDATE settings SET value='[\"cal-0\",\"cal-1\",\"cal-2\"]' WHERE key='selected_calendars'").run();
 await DB.prepare('DELETE FROM lesson_record_baseline').run();await DB.prepare('DELETE FROM lesson_record_legacy_source').run();
 failedId='budget-1';const partial=await invoke();assert.equal(partial.observed,1);assert.equal(partial.retry_required,true);assert.equal(partial.next_cursor,'budget-0');assert.equal(partial.done,false);
 const original=await DB.prepare("SELECT * FROM lesson_record_baseline WHERE event_id='budget-0'").first();
 const source=await DB.prepare("SELECT * FROM lesson_record_legacy_source WHERE event_id='budget-0'").first();
 failedId=null;renamed=true;
 // No response/cursor is required: restart from the first page after partial writes.
 const resumed=await invoke();assert.equal(resumed.observed,2);assert.equal(resumed.next_cursor,'budget-2');
 assert.deepEqual(await DB.prepare("SELECT * FROM lesson_record_baseline WHERE event_id='budget-0'").first(),original);
 assert.deepEqual(await DB.prepare("SELECT * FROM lesson_record_legacy_source WHERE event_id='budget-0'").first(),source);
 conflict=true;const raced=await invoke({cursor:resumed.next_cursor});assert.equal(raced.retry_required,true);assert.equal(raced.collisions,0);assert.equal(raced.inspected,0);assert.equal(raced.next_cursor,resumed.next_cursor);
 failedId='budget-3';const stopped=await invoke({cursor:resumed.next_cursor});assert.equal(stopped.inspected,0);assert.equal(stopped.next_cursor,resumed.next_cursor);assert.equal(stopped.retry_required,true);
 failedId=null;const finished=await invoke({cursor:stopped.next_cursor});assert.equal(finished.done,true);assert.equal(finished.observed,2);
 assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM curriculum_entries WHERE completed=1 AND lesson_plan='preserve original'").first()).n,5);
 assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM lesson_record_identity WHERE title IS NOT NULL').first()).n,0);
 assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM lesson_record_hold WHERE resolved_at IS NULL').first()).n,1);
 await DB.prepare("UPDATE settings SET value=? WHERE key='selected_calendars'").bind(JSON.stringify(Array.from({length:30},(_,i)=>'cal-'+i))).run();
 await DB.prepare('DELETE FROM lesson_record_baseline').run();const over=await invoke();assert.equal(over.status,409);assert.equal(over.calendarFetches,0);
});
