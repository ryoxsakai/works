import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import worker from '../src/index.js';
import {validatePeriodProfiles, writePeriodProfiles} from '../src/tutor-period-profiles.js';
const origin = 'https://works.example.test';
const secret = 'synthetic-period-profile-test-secret';
const input = (revision = 0) => ({revision, common_mode:'legacy', schools:Object.fromEntries(
  ['tomas','daikanyama','shukutoku_yono'].map(name=>[name,{mode:'both',calendar_ids:[name+'@example.test'],periods:[{label:'B限',start_time:'11:50'},{label:'B限',start_time:'12:50'}]}]))});
async function setup(t) {
  const mf = new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-08-01',d1Databases:{DB:'period-profiles'}});
  t.after(()=>mf.dispose()); const DB = await mf.getD1Database('DB');
  await DB.prepare('CREATE TABLE settings (key TEXT PRIMARY KEY,value TEXT)').run();
  await DB.prepare("INSERT INTO settings VALUES ('unrelated','\"keep\"')").run();
  return {DB,ALLOWED_ORIGIN:origin,SESSION_SECRET:secret,ALLOWED_EMAIL:'owner@example.test'};
}
async function token(claims = {}) {
  const payload = Buffer.from(JSON.stringify({email:'owner@example.test',exp:Date.now()+3600000,...claims})).toString('base64url');
  const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return payload+'.'+Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(payload))).toString('base64url');
}
test('strict validation accepts repeated labels at distinct starts and all modes',()=>{
  for(const common_mode of ['legacy','label','time','both']) assert.equal(validatePeriodProfiles({...input(),common_mode}).common_mode,common_mode);
  const empty=input(); for(const s of Object.values(empty.schools)){s.periods=[];s.calendar_ids=[];} assert.deepEqual(validatePeriodProfiles(empty),empty);
  const mutations=[x=>x.extra=true,x=>delete x.schools.tomas,x=>x.schools.extra={},x=>x.revision=-1,x=>x.revision='0',x=>x.revision=Number.MAX_SAFE_INTEGER,x=>x.common_mode='bad',x=>x.schools.tomas.mode='legacy',x=>x.schools.tomas.extra=1,x=>x.schools.tomas.calendar_ids.push(x.schools.daikanyama.calendar_ids[0]),x=>x.schools.tomas.calendar_ids.push(x.schools.tomas.calendar_ids[0]),x=>x.schools.tomas.calendar_ids=[''],x=>x.schools.tomas.calendar_ids=[' x '],x=>x.schools.tomas.periods[0].label='',x=>x.schools.tomas.periods[0].label='x'.repeat(41),x=>x.schools.tomas.periods[0].start_time='24:00',x=>x.schools.tomas.periods[0].start_time='9:00',x=>x.schools.tomas.periods[0].start_time='12:50',x=>x.schools.tomas.periods[0].end_time='12:00',x=>x.schools.tomas.periods=Array(49).fill({label:'x',start_time:'09:00'})];
  for(const mutate of mutations){const value=input();mutate(value);assert.throws(()=>validatePeriodProfiles(value),e=>e.status===400);}
});
test('initial save and subsequent revision preserve other keys; stale revisions never write',async t=>{
  const env=await setup(t);const first=await writePeriodProfiles(env,input());assert.equal(first.lesson_period_profiles.revision,1);
  const next=input(1);next.common_mode='time';assert.equal((await writePeriodProfiles(env,next)).lesson_period_profiles.revision,2);
  await assert.rejects(writePeriodProfiles(env,input(1)),e=>e.status===409);
  assert.equal(await env.DB.prepare("SELECT value FROM settings WHERE key='unrelated'").first('value'),'"keep"');
  assert.deepEqual(JSON.parse(await env.DB.prepare("SELECT value FROM settings WHERE key='lesson_period_profiles'").first('value')),{...next,revision:2});
});
test('concurrent creates and updates each have exactly one winner',async t=>{
  const env=await setup(t);
  for(const revision of [0,1]) {
    const settled=await Promise.allSettled(['label','time'].map(common_mode=>writePeriodProfiles(env,{...input(revision),common_mode})));
    assert.equal(settled.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(settled.filter(r=>r.status==='rejected'&&r.reason.status===409).length,1);
  }
});
test('invalid saved state is not overwritten',async t=>{
  const env=await setup(t);await env.DB.prepare("INSERT INTO settings VALUES('lesson_period_profiles','broken')").run();
  await assert.rejects(writePeriodProfiles(env,input()),e=>e.status===409);
  assert.equal(await env.DB.prepare("SELECT value FROM settings WHERE key='lesson_period_profiles'").first('value'),'broken');
});
test('endpoint uses browser session, same-origin JSON, strict method/body, and settings GET',async t=>{
  const env=await setup(t);const bearer=await token();
  const call=(method='PUT',body=JSON.stringify(input()),headers={},path='/api/tutor-period-profiles')=>worker.fetch(new Request(origin+path,{method,headers:{Authorization:'Bearer '+bearer,Origin:origin,'Content-Type':'application/json',...headers},...(method==='GET'?{}:{body})}),env);
  assert.equal((await call('PUT',JSON.stringify(input()),{Authorization:''})).status,401);
  assert.equal((await call('PUT',JSON.stringify(input()),{Origin:'https://other.example.test'})).status,403);
  assert.equal((await call('PUT',JSON.stringify(input()),{'Content-Type':'text/plain'})).status,403);
  assert.equal((await call('GET')).status,405);
  assert.equal((await call('PUT','{')).status,400);
  assert.equal((await call('PUT','x'.repeat(131073))).status,413);
  for(const claims of [{aud:'works-mcp',scope:'schedule:read'},{aud:''},{scope:''},{fid:null}]) assert.equal((await call('PUT',JSON.stringify(input()),{Authorization:'Bearer '+await token(claims)})).status,401);
  const response=await call();assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal((await response.json()).lesson_period_profiles.revision,1);
  assert.equal((await call()).status,409);
  const read=await call('GET',null,{},'/api/settings');assert.equal(read.status,200);assert.equal((await read.json()).lesson_period_profiles.revision,1);
});
