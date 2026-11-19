import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {Miniflare} from 'miniflare';
import {ensureAttribution,rawRecord} from '../src/lesson-attribution.js';import {writeLessonPlan} from '../src/lesson-plan.js';import {lessonEventRef} from '../../shared/lesson-plan.js';import {replaceCalendarRecord} from '../../shared/calendar-lesson-record.mjs';
test('cold/warm linked Calendar saves measure D1 RPC/statements and Google calls for the three approved-calendar shape',async t=>{
 const mf=new Miniflare({modules:true,script:"export default {fetch(){return new Response('ok')}}",compatibilityDate:'2026-08-01',d1Databases:{DB:'calendar-budget'}});t.after(()=>mf.dispose());const DB=await mf.getD1Database('DB');
 await DB.prepare('CREATE TABLE curriculum_entries(calendar_event_id TEXT PRIMARY KEY,completed INTEGER,lesson_plan TEXT,confirmation_test TEXT,homework TEXT,lesson_memo TEXT,updated_at TEXT)').run();await ensureAttribution({DB});
 const sql=await readFile(new URL('../calendar-lesson-migration.sql',import.meta.url),'utf8');await DB.batch(sql.replace(/^--.*$/gm,'').split(';').filter(v=>v.trim()).map(v=>DB.prepare(v)));
 await DB.prepare("INSERT INTO curriculum_entries VALUES('b',0,'plan',NULL,NULL,NULL,'old')").run();await DB.prepare("UPDATE lesson_record_identity SET calendar_id='one',title='Synthetic' WHERE event_id='b'").run();
 const row=await rawRecord({DB},'b'),metric={d1:0,statements:0,google:0};
 const wrap=statement=>({_real:statement,bind:(...args)=>wrap(statement.bind(...args)),...Object.fromEntries(['first','all','run','raw'].map(method=>[method,async(...args)=>{metric.d1++;metric.statements++;return statement[method](...args);}]))});
 const counted={prepare:sql=>wrap(DB.prepare(sql)),batch:async statements=>{metric.d1++;metric.statements+=statements.length;return DB.batch(statements.map(s=>s._real||s));}};
 const env={DB:counted,CALENDAR_LESSON_RECORDS:'true',CALENDAR_LESSON_MIGRATION_JOURNAL:'true',ALLOWED_EMAIL:'owner@example.invalid'};
 const event=(id,h)=>({id,calendar_id:'one',summary:'Synthetic',etag:'"'+id+'-1"',organizer:{self:true},start:{dateTime:`2026-10-31T${h}:00:00+09:00`},end:{dateTime:`2026-10-31T${h+1}:00:00+09:00`}}),source=event('a',10),target=event('b',11);target.description=replaceCalendarRecord('',row,{calendar_id:'one',event_id:'b',title:'Synthetic',generation:0});
 const read=async(cal,id)=>{metric.google++;return structuredClone(cal==='one'?[source,target].find(e=>e.id===id)||null:null);};
 const deps={settings:async()=>({selected_calendars:['one','two','three']}),token:async()=>{metric.google++;return {access_token:'synthetic'};},event:async(_token,cal,id)=>read(cal,id),events:async()=>{metric.google++;return [structuredClone(target)];},calendar:{read,privacy:async cal=>{metric.google++;return {basis:'owner_attested',approved:true,calendar_id:cal,accessRole:'owner',ownerEmail:env.ALLOWED_EMAIL};},patch:async(_cal,_id,body,options)=>{metric.google++;assert.equal(options.ifMatch,target.etag);Object.assign(target,body,{etag:'"b-'+(metric.google+1)+'"'});}}};
 let revision=row.record_revision,base='plan';const measured=[];
 for(const value of ['cold','warm']){
  metric.d1=0;metric.google=0;metric.statements=0;
  const response=await writeLessonPlan(env,{source:lessonEventRef(source),target:lessonEventRef(target),record_revision:revision,expected_lesson_plan:base,lesson_plan:value},deps);revision=response.record_revision;base=value;
  const result={path:value,...metric,totalRpc:metric.d1+metric.google};measured.push(result);assert.ok(result.totalRpc<=50,JSON.stringify(result));
 }
 console.log('Calendar synthetic invocation budgets '+JSON.stringify(measured));
});
