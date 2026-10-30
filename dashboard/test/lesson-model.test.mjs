import {test} from 'node:test';import assert from 'node:assert/strict';import {homeLessonModel,lessonApi} from '../lesson-model.mjs';
const day='2026-10-30',event=(id,hour,cal='one',date=day)=>({id,summary:'同名',_calendarId:cal,etag:'"'+id+'"',start:{dateTime:`${date}T${String(hour).padStart(2,"0")}:00:00+09:00`},end:{dateTime:`${date}T${String(hour+1).padStart(2,"0")}:00:00+09:00`}});
test('root lesson model keeps original term/count/calendar semantics and observes only visible/previous targets',async()=>{
 const events=[event('previous',9),event('a',10),event('b',11),event('other',10,'two'),event('later',11,'two')],calls=[],google=[];
 const data={events:[events[1],events[3]],settings:{selected_calendars:['one','two'],selected_term_ids:[2],excluded_titles:['空き']}};
 const api=async(path,options)=>{calls.push({path,options});if(path==='/terms')return [{id:1,start_date:'2026-09-01',end_date:'2026-12-01'},{id:2,start_date:'2026-10-01',end_date:'2026-11-01'}];if(path==='/periods')return [{label:'1限',start_time:'10:00'}];return [{calendar_event_id:'a',record_exists:1,record_hold_active:1,lesson_plan:'must not expose',record_revision:3}];};
 const fetcher=async url=>{google.push(url);const u=new URL(url);if(u.pathname.endsWith('calendarList'))return Response.json({items:[{id:'one',summary:'教室1'},{id:'two',summary:'教室2'}]});const id=decodeURIComponent(u.pathname.split('/')[4]);return Response.json({items:[...events.filter(e=>e._calendarId===id),{...event('empty',12,id),summary:' 空き '}]});};
 const model=await homeLessonModel(data,day,{api,googleToken:async()=>'user-oauth',signal:new AbortController().signal,fetcher});
 assert.deepEqual(model.rows.map(r=>[r.n,r.m,r.calendarId]),[[2,3,'one'],[1,2,'two']]);assert.equal(model.rows[0].record.attribution_status,'known_change');assert.equal(model.rows[0].lessonPlan,'');assert.equal(model.rows[0].record.lesson_plan,null);
 const targets=calls.filter(c=>c.path==='/lesson-records').flatMap(c=>JSON.parse(c.options.body).targets);assert.deepEqual(targets.map(r=>r.id).sort(),['a','other','previous']);assert.ok(calls.filter(c=>c.options).every(c=>JSON.parse(c.options.body).targets.length<=1));
 assert.ok(google.filter(u=>u.includes('/events?')).every(u=>new URL(u).searchParams.get('timeMin')==='2026-10-01T00:00:00+09:00'&&new URL(u).searchParams.get('timeMax')==='2026-11-02T00:00:00+09:00'));
});
test('empty/unconfigured lessons do not fetch record/profile data; malformed calendar metadata never guesses context',async()=>{
 let called=0;const deps={api:async()=>{called++;return [];},googleToken:async()=>'',signal:new AbortController().signal};assert.deepEqual((await homeLessonModel({events:[],unconfigured:true},day,deps)).rows,[]);assert.equal(called,0);
 await assert.rejects(homeLessonModel({events:[event('a',10)],settings:{selected_calendars:['one']}},day,{...deps,googleToken:async()=>'oauth',fetcher:async()=>Response.json({items:[]})}),/カレンダー名/);
});
test('browser API captures the session, rejects stale/aborted reads and marks unknown writes without replay',async()=>{
 let current=true,calls=0;const signal=new AbortController();const api=lessonApi({session:'captured',isCurrent:()=>current,signal:signal.signal,fetcher:async(_u,options)=>{calls++;assert.equal(options.headers.Authorization,'Bearer captured');throw new TypeError('lost response');}});
 await assert.rejects(api('/lesson-plan',{method:'PUT',body:'{}'}),e=>e.unknown===true);assert.equal(calls,1);current=false;await assert.rejects(api('/student-prefs/guarded'),/stale/);assert.equal(calls,1);
 const aborted=new AbortController();aborted.abort();await assert.rejects(lessonApi({session:'x',isCurrent:()=>true,signal:aborted.signal,fetcher:async()=>{throw Error('must not fetch');}})('/terms'),e=>e.name==='AbortError');
 let expired=0;await assert.rejects(lessonApi({session:'x',isCurrent:()=>true,onUnauthorized:()=>expired++,fetcher:async()=>Response.json({error:'expired'},{status:401})})('/terms'),e=>e.status===401);assert.equal(expired,1);
});
test('20 selected calendars keep read batches bounded and globally quarantine IDs colliding across batches',async()=>{
 const ids=Array.from({length:20},(_,i)=>'cal'+i),events=ids.map((id,i)=>event('event'+i,10,id)),observed=[];
 // Duplicates across distant calendars must be detected before chunking observations.
 events.at(-1).id=events[0].id;
 const api=async(path,options)=>{if(path==='/terms'||path==='/periods')return [];observed.push(JSON.parse(options.body).targets);return [];};
 const fetcher=async url=>{const u=new URL(url);if(u.pathname.endsWith('calendarList'))return Response.json({items:ids.map(id=>({id,summary:id}))});const id=decodeURIComponent(u.pathname.split('/')[4]);return Response.json({items:events.filter(e=>e._calendarId===id)});};
 const m=await homeLessonModel({events,settings:{selected_calendars:ids}},day,{api,googleToken:async()=>'oauth',signal:new AbortController().signal,fetcher});
 assert.equal(m.rows.length,20);assert.equal(observed.length,20);assert.ok(observed.every(batch=>batch.length<=1));assert.equal(m.rows[0].record.attribution_status,'id_collision');assert.equal(m.rows.at(-1).record.attribution_status,'id_collision');
});
test('changed duplicate snapshots or mismatched day/range reads fail closed instead of exposing stale records',async()=>{
 const a=event('a',10),api=async path=>[],settings={selected_calendars:['one']};
 const fetcher=async url=>Response.json({items:new URL(url).pathname.endsWith('calendarList')?[{id:'one',summary:'one'}]:[{...a,etag:'changed'}]});
 await assert.rejects(homeLessonModel({events:[a],settings},day,{api,googleToken:async()=>'oauth',signal:new AbortController().signal,fetcher}),/一致/);
});
