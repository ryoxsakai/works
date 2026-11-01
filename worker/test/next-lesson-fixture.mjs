import {loadCalendarStorageState,overlayCalendarLessonRecord,writeCalendarLessonRecord,reconcileCalendarLessonRecord} from "../src/calendar-lesson-records.js";
import {replaceCalendarRecord} from "../../shared/calendar-lesson-record.mjs";
import {readLinkedProfile,writeLinkedProfile} from "../src/teaching-linked.js";
import {allRecords,rawRecord,observeRecord,currentRecord,resolveAttribution,prepareRecordWrite,readCommittedRecord,commitRecords,ensureAttribution} from '../src/lesson-attribution.js';
import {lessonRecordHasContent,lessonDate} from '../../shared/lesson-attribution.js';
import {sameLessonEvent} from '../../shared/lesson-plan.js';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Miniflare} from 'miniflare';
import {readLessonPlan,readNextLessonPlan,writeLessonPlan} from '../src/lesson-plan.js';
const root=path.resolve(fileURLToPath(new URL('../../',import.meta.url))); 
export async function createFixture(port=0,{calendarRecords=false}={}){
const mf=new Miniflare({modules:true,script:"export default {fetch(){return new Response('ok')}}",compatibilityDate:'2026-08-01',d1Databases:{DB:'next-lesson-fixture'}});
const DB=await mf.getD1Database('DB');
const env={DB,...(calendarRecords?{CALENDAR_LESSON_RECORDS:'true',CALENDAR_LESSON_MIGRATION_JOURNAL:'true',ALLOWED_EMAIL:'owner@example.invalid'}:{})};
await DB.prepare('CREATE TABLE student_prefs(name TEXT PRIMARY KEY,print_name TEXT,memo TEXT,updated_at TEXT)').run();
await DB.prepare('CREATE TABLE curriculum_entries(calendar_event_id TEXT PRIMARY KEY,completed INTEGER DEFAULT 0,lesson_plan TEXT,confirmation_test TEXT,homework TEXT,lesson_memo TEXT,updated_at TEXT)').run();
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const shift=n=>new Date(Date.parse(today+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const event=(id,hour,day=today,calendar_id='qa',summary='サンプル生徒')=>({id,calendar_id,summary,etag:`"${id}-1"`,start:{dateTime:`${day}T${hour}:00:00+09:00`},end:{dateTime:`${day}T${hour+1}:00:00+09:00`}});
const events=[event('a',10),event('b',11),event('c',10,shift(7)),event('none',13,today,'qa','次回なし'),event('other',10,today,'qa-tomas'),event('other-next',11,shift(1),'qa-tomas')];
for(const [id,value]of Object.entries({b:'既存の次回予定',c:'次週の既存予定','other-next':'別教室の予定'}))await DB.prepare('INSERT INTO curriculum_entries(calendar_event_id,lesson_plan,homework,lesson_memo)VALUES(?,?,?,?)').bind(id,value,'既存宿題','既存授業メモ').run();
await ensureAttribution(env);
if(calendarRecords){const sql=await readFile(new URL('../calendar-lesson-migration.sql',import.meta.url),'utf8');await DB.batch(sql.replace(/^--.*$/gm,'').split(';').filter(v=>v.trim()).map(v=>DB.prepare(v)));}
for (const id of ['b','c','other-next']) {
 const ev=events.find(e=>e.id===id);
 await DB.prepare('INSERT INTO lesson_record_identity(event_id,calendar_id,title,revision)VALUES(?,?,?,0)').bind(id,ev.calendar_id,ev.summary).run();
}
if(calendarRecords){for(const ev of events)ev.organizer={self:true};for(const ev of events){const row=await rawRecord(env,ev.id);if(row.record_title)ev.description=replaceCalendarRecord('',row,{calendar_id:ev.calendar_id,event_id:ev.id,title:ev.summary,generation:row.record_generation});}
 events.push({...event('template-source',14,today,'qa','空欄次回'),organizer:{self:true}},{...event('template-target',14,shift(7),'qa','空欄次回'),organizer:{self:true}});
}
const settings={selected_calendars:['qa','qa-tomas'],selected_term_ids:[2],excluded_titles:['空き']};
const deps={settings:async()=>settings,token:async()=>({access_token:'synthetic'}),event:async(_t,cal,id)=>structuredClone(events.find(e=>e.calendar_id===cal&&e.id===id)||null),events:async(_t,cal,min,max)=>structuredClone(events.filter(e=>e.calendar_id===cal&&Date.parse(e.end.dateTime)>Date.parse(min)&&Date.parse(e.start.dateTime)<Date.parse(max)))};
const control={initializations:0,calendarWrites:[],calendarLost:false,failSave:false,holdSave:null,writes:[],profileWrites:[],profileFail:false,profileHold:null};
if(calendarRecords)deps.calendar={
 read:async(cal,id)=>structuredClone(events.find(ev=>ev.calendar_id===cal&&ev.id===id)||null),
 privacy:async cal=>({basis:'owner_attested',approved:true,calendar_id:cal,accessRole:'owner',ownerEmail:env.ALLOWED_EMAIL}),
 patch:async(cal,id,body,options)=>{const ev=events.find(ev=>ev.calendar_id===cal&&ev.id===id);if(ev.etag!==options.ifMatch)throw Object.assign(Error('changed'),{status:412});control.calendarWrites.push({cal,id,body,options});ev.description=body.description;ev.etag='"'+id+'-'+(control.calendarWrites.length+1)+'"';if(control.calendarLost)throw Error('lost after calendar commit');return structuredClone(ev);},
};
const prefs=new Map([['サンプル生徒',{name:'サンプル生徒',memo:'既存の生徒メモ',print_name:'印刷サンプル'}],['サンプル別生徒',{name:'サンプル別生徒',memo:'別生徒のメモ'}]]);
for(const profile of prefs.values())await DB.prepare('INSERT INTO student_prefs(name,print_name,memo) VALUES (?,?,?)').bind(profile.name,profile.print_name||null,profile.memo||null).run();
const calendars=[{id:'qa',summary:'代官山メディカル',backgroundColor:'#8e24aa'},{id:'qa-tomas',summary:'TOMAS',backgroundColor:'#039be5'}];
const listKeys=['students','goal-templates','periods','materials','material-categories','schools','goals'];
const server=http.createServer(async(req,res)=>{
 try {
  const url=new URL(req.url,'http://localhost');
  const send=(type,body,status=200)=>{res.writeHead(status,{'Content-Type':type+(type.startsWith('text/')?'; charset=utf-8':''),'Cache-Control':'no-store'});res.end(body);};
  const json=body=>send('application/json',JSON.stringify(body));
  const readBody=async()=>{let text='';for await(const chunk of req)text+=chunk;return JSON.parse(text);};
  if(url.pathname==='/qa-control'){const {action}=await readBody();if(action==='fail')control.failSave=true;if(action==='move')events.find(e=>e.id==='b').status='cancelled';return json({ok:true});}
  if(url.pathname==='/qa')return send('text/html',`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Works UI QA — synthetic only</title><style>body{margin:0;font-family:system-ui;background:#ddd}header{padding:10px;display:flex;gap:8px;position:relative;background:white}iframe{display:block;border:0;background:white;margin:0}button,select{font-size:16px}</style><header><strong>次回授業予定・実データなし</strong><button data-control="fail">次の保存を失敗</button><button data-control="move">次回を変更</button><button data-width="320">320px</button><button data-width="390">390px</button><button data-width="1280">1280px</button><select aria-label="サービス"><option value="/tutor/">授業管理</option><option value="/">ホーム</option><option value="/wiki/">Wiki</option><option value="/kdp/">KDP</option><option value="/ss/">SS</option><option value="/material/">教材管理</option><option value="/admission/">入試管理</option><option value="/memo/">メモ</option><option value="/todo/">ToDo</option><option value="/material-print/">教材印刷</option></select></header><iframe id="qa-frame" title="Works sample" src="/tutor/" width="390" height="820"></iframe><script>document.querySelectorAll('[data-control]').forEach(b=>b.onclick=()=>fetch('/qa-control',{method:'POST',body:JSON.stringify({action:b.dataset.control})}));document.querySelectorAll('[data-width]').forEach(b=>b.onclick=()=>document.querySelector('iframe').width=b.dataset.width);document.querySelector('select').onchange=e=>document.querySelector('iframe').src=e.target.value;</script>`);
  if(url.pathname==='/shared/auth.js')return send('text/javascript',`export const getSessionToken=()=> 'qa';export const getGoogleAccessToken=async()=> 'qa';export const signIn=()=>{};export const signOutUser=async()=>{};export const watchAuth=({onSignedIn})=>onSignedIn({email:'qa@example.invalid',picture:''});`);
  if(url.pathname.startsWith('/api/')){
    const key=url.pathname.slice(5);
    if(key==='lesson-baseline/initialize') {
      const body=await readBody(),rows=await allRecords(env),policy=await DB.prepare('SELECT * FROM lesson_record_policy WHERE id=1').first();
      if(!policy?.enabled)throw Object.assign(new Error('初期設定が必要です'),{status:409});
      const candidates=rows.filter(row=>row.calendar_event_id>(body.cursor||'')&&row.record_title==null&&row.record_observed_title==null&&!row.record_hold_active&&lessonRecordHasContent(row)).sort((a,b)=>a.calendar_event_id.localeCompare(b.calendar_event_id));
      const page=candidates.slice(0,body.limit||25),counts={observed:0,historical:0,unavailable:0,collisions:0};
      for(const row of page){const found=events.filter(ev=>ev.id===row.calendar_event_id);if(found.length!==1){counts[found.length?'collisions':'unavailable']++;continue;}const ref={...found[0],title:found[0].summary,start:found[0].start.dateTime};if(lessonDate(ref)<policy.effective_date){counts.historical++;continue;}await observeRecord(env,ref);counts.observed++;}
      return json({effective_date:policy.effective_date,inspected:page.length,...counts,held:rows.filter(row=>row.record_hold_active).length,done:page.length<(body.limit||25),next_cursor:page.at(-1)?.calendar_event_id || body.cursor || '',ownership_verified:false});
    }
    if(key==='lesson-records'){
      const body=await readBody(),rows=await allRecords(env),records=new Map(rows.map(row=>[row.calendar_event_id,row])),unavailable=new Set();
      for(const target of body.targets){const row=records.get(target.id);if(row?.record_policy_enabled&&row.record_title==null&&row.record_observed_title==null&&!row.record_hold_active&&lessonRecordHasContent(row)){
        try{await readLessonPlan(env,target.calendar_id,target.id,deps);}catch(error){if(error.status===404||error.code==='LESSON_TARGET_CHANGED')unavailable.add(target.id);else throw error;}
      }}
      const all=await allRecords(env);if(calendarRecords)for(const target of body.targets){const ev=events.find(e=>e.id===target.id&&e.calendar_id===target.calendar_id);if(!ev)continue;const before=all.find(r=>r.calendar_event_id===target.id)||await rawRecord(env,target.id),overlay=overlayCalendarLessonRecord(env,await loadCalendarStorageState(env,currentRecord(before,target),target),ev);if(await DB.prepare("SELECT id FROM calendar_lesson_migration WHERE event_id=? AND status IN ('reserved','dispatching','unknown') LIMIT 1").bind(target.id).first())Object.assign(overlay,{record_pending_operation:true,record_target_unavailable:true});const index=all.findIndex(r=>r.calendar_event_id===target.id);if(index<0)all.push(overlay);else all[index]=overlay;}
      return json(all.map(row=>({...row,...(unavailable.has(row.calendar_event_id)?{record_target_unavailable:true}:{}),calendar_source_enabled:calendarRecords})));
    }
    if(key==='calendar-lesson-record/reconcile'){const body=await readBody();return json(await reconcileCalendarLessonRecord(env,body.target,deps));}
    if(key==='next-lesson-plan/initialize'){const body=await readBody();const next=await readNextLessonPlan(env,body.source.calendar_id,body.source.id,deps);if(!sameLessonEvent(body.target,next.target)||!sameLessonEvent(body.source,next.source))throw Object.assign(Error('target changed'),{status:409});control.initializations++;return json(await writeCalendarLessonRecord(env,{target:next.target,patch:{},recordRevision:next.record_revision,initializeOnly:true},deps));}
    if(key==='next-lesson-plan')return json(await readNextLessonPlan(env,url.searchParams.get('calendar_id'),url.searchParams.get('event_id'),deps));
    if(key==='lesson-plan'){
      if(req.method==='GET')return json(await readLessonPlan(env,url.searchParams.get('calendar_id'),url.searchParams.get('event_id'),deps));
      const value=await readBody();control.writes.push(value);if(control.holdSave)await control.holdSave;
      if(control.failSave){control.failSave=false;return send('application/json',JSON.stringify({error:'サンプル保存失敗'}),500);}
      return json(await writeLessonPlan(env,value,deps));
    }
    if(key==='lesson-record') {
      const body=req.method==='PUT'?await readBody():null;
      const target=body?.target || (await readLessonPlan(env,url.searchParams.get('calendar_id'),url.searchParams.get('event_id'),deps)).target;
      const live=(await readLessonPlan(env,target.calendar_id,target.id,deps)).target;
      if(!sameLessonEvent(target,live)) throw Object.assign(new Error('予定が変更されました'),{status:409});
      if(body)return json(await resolveAttribution(env,live,body.record_revision,body.decision));
      const row=await rawRecord(env,target.id);
      return json({target:live,record:currentRecord(row,live),previous_record:row,history:(await DB.prepare('SELECT * FROM lesson_record_archive WHERE event_id=?').bind(target.id).all()).results,legacy_source:await DB.prepare('SELECT snapshot_json,captured_at FROM lesson_record_legacy_source WHERE event_id=?').bind(target.id).first()});
    }
    if(req.method==='PUT' && key.startsWith('curriculum/')){
      const value=await readBody();
      if(calendarRecords)return json(await writeCalendarLessonRecord(env,{target:value.target,patch:Object.fromEntries(['completed','confirmation_test','homework','lesson_memo'].filter(f=>Object.hasOwn(value,f)).map(f=>[f,value[f]])),recordRevision:value.record_revision},deps));
      const prepared=await prepareRecordWrite(env,value.target,Object.fromEntries(['completed','confirmation_test','homework','lesson_memo'].filter(f=>Object.hasOwn(value,f)).map(f=>[f,value[f]])),value.record_revision);
      await commitRecords(env,prepared.statements);
      return json(await readCommittedRecord(env,value.target,prepared));
    }
    if(key==='student-prefs/guarded'){
      const linkedDeps={target:async ref=>(await readLessonPlan(env,ref.calendar_id,ref.id,deps)).target,excluded:async()=>settings.excluded_titles};
      if(req.method==='PUT'){
        const body=await readBody();control.profileWrites.push(body);if(control.profileHold)await control.profileHold;
        if(control.profileFail){control.profileFail=false;return send('application/json',JSON.stringify({error:'synthetic profile failure'}),500);}
        const result=await writeLinkedProfile(env,body,linkedDeps);prefs.set(result.name,{name:result.name,...result.profile});return json(result);
      }
      return json(await readLinkedProfile(env,{calendar_id:url.searchParams.get('calendar_id'),id:url.searchParams.get('event_id'),profile_context:url.searchParams.get('profile_context'),name:url.searchParams.get('name')},linkedDeps));
    }
    if(key==='student-prefs'){
      if(req.method==='PUT'){
        let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);
        prefs.set(body.name,{...prefs.get(body.name),...body});const p=prefs.get(body.name);await DB.prepare("INSERT INTO student_prefs(name,memo,print_name,updated_at) VALUES(?,?,?,datetime('now')) ON CONFLICT(name) DO UPDATE SET memo=excluded.memo,print_name=excluded.print_name,updated_at=excluded.updated_at").bind(body.name,p.memo||null,p.print_name||null).run();return json(prefs.get(body.name));
      }
      const name=url.searchParams.get('name');
      return json(await DB.prepare('SELECT * FROM student_prefs WHERE name=?').bind(name).first()||{name,memo:null,print_name:null});
    }
    if(req.method!=='GET')return send('text/plain','Only sample record saves are allowed',403);
    if(key==='settings')return json(settings);
    if(key==='years')return json([{id:1,label:'2026年度'}]);
    if(key==='terms')return json([{id:2,year_id:1,label:'後期',start_date:shift(-30),end_date:shift(60)}]);
    if(key==='curriculum')return json(await allRecords(env));
    if(key.startsWith('student-prefs'))return json({});
    if(listKeys.includes(key))return json([]);
    return json([]);
  }
  if(url.pathname==='/qa-calendars')return json({items:calendars});
  if(url.pathname==='/qa-events'){
    return json({items:await deps.events('',url.searchParams.get('calendar'),url.searchParams.get('timeMin'),url.searchParams.get('timeMax'))});
  }
  if(req.method!=='GET')return send('text/plain','Preview writes blocked',403);
  try {
    let relative=decodeURIComponent(url.pathname);if(relative.endsWith('/'))relative+='index.html';
    const file=path.resolve(root,'.'+relative);if(!file.startsWith(root+path.sep))return send('text/plain','Forbidden',403);
    let data=await readFile(file);
    if(relative==='/tutor/app.js')data=`const nativeFetch=window.fetch.bind(window);window.fetch=(input,init)=>{let u=String(input);if(u.startsWith('https://www.googleapis.com/calendar/')){const p=new URL(u);u=p.pathname.endsWith('calendarList')?'/qa-calendars':'/qa-events?'+p.searchParams.toString()+'&calendar='+encodeURIComponent(decodeURIComponent(p.pathname.split('/')[4]));}return nativeFetch(u,init);};\n`+data;
    return send(({'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream',data);
  } catch {return send('text/plain','Not found',404);}
 }catch(error){res.writeHead(error.status||500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message,code:error.code,current:error.current}));}
});
await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
return {base:`http://127.0.0.1:${server.address().port}`,events,DB,control,today,async close(){await new Promise(resolve=>server.close(resolve));await mf.dispose();}};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const fixture=await createFixture(8768);console.log(fixture.base+'/qa');}
