import test from 'node:test';
import assert from 'node:assert/strict';
import {CALENDAR_RECORD_START,CALENDAR_RECORD_END,parseCalendarRecord,parsePlainCalendarRecord,replaceCalendarRecord,calendarRecordValues} from '../../shared/calendar-lesson-record.mjs';
import {planCalendarRecordMigration,planCalendarTemplateInitialization,calendarRecordPrivacy,applyCalendarRecordMigration,reconcileCalendarRecordMigration} from '../src/calendar-lesson-migration.js';
const binding={calendar_id:'synthetic',event_id:'instance_20261020T010000Z',title:'合成生徒',generation:0};
const row={calendar_event_id:binding.event_id,record_exists:1,record_calendar_id:binding.calendar_id,record_title:binding.title,record_revision:4,record_generation:0,lesson_plan:'予定',confirmation_test:'テスト',homework:'宿題',lesson_memo:'メモ'};
const event={id:binding.event_id,calendar_id:'synthetic',summary:binding.title,etag:'"before"',organizer:{self:true},start:{dateTime:'2026-10-20T10:00:00+09:00'},end:{dateTime:'2026-10-20T11:00:00+09:00'},recurringEventId:'series',originalStartTime:{dateTime:'2026-10-20T10:00:00+09:00'},description:'<b>既存案内</b>\nURL https://example.invalid'};
const ownerEmail='owner@example.invalid',privacy={complete:true,calendar_id:'synthetic',accessRole:'owner',rules:[{role:'owner',scope:{type:'user',value:ownerEmail}}]};
const plan=(patch={})=>planCalendarRecordMigration({row,event,privacy,ownerEmail,...patch});
test('four human-readable fields roundtrip, outside HTML bytes and trailing newlines are retained',()=>{
 const values={lesson_plan:'<script>alert(1)</script> & <b>語</b>\n宿題：\n\\slash\n'+CALENDAR_RECORD_START+'\n'+CALENDAR_RECORD_END+'\n',confirmation_test:'',homework:'a\n\nb\n',lesson_memo:'&lt;literal&gt;\n日本語'};
 const description=replaceCalendarRecord(event.description,values,binding),parsed=parseCalendarRecord(description);
 assert.deepEqual(parsed.values,values);assert.equal(description.slice(0,parsed.start),event.description+'\n');assert.equal(description.includes('<script>'),false);
 const extended=description+'\n<i>後置の原文</i>',updated=replaceCalendarRecord(extended,{...values,lesson_plan:'更新'},binding);
 assert.equal(updated.slice(updated.indexOf(CALENDAR_RECORD_END)+CALENDAR_RECORD_END.length),'\n<i>後置の原文</i>');assert.equal(parseCalendarRecord(updated).values.lesson_plan,'更新');
 assert.equal(replaceCalendarRecord(updated,{...values,lesson_plan:'更新'},binding),updated);
});
test('ambiguous, duplicate, malformed, HTML-transformed and foreign blocks never silently overwrite',()=>{
 const valid=replaceCalendarRecord('',row,binding);
 for(const description of [valid+'\n'+valid,valid.replace('宿題：','授業予定：'),valid.replace(CALENDAR_RECORD_END,''),valid.replace('授業予定：予定','授業予定：<b>予定</b>'),'<br>'+valid,valid.replace('<!--Works授業記録 v1-->','<!--Works授業記録 v2-->')])assert.throws(()=>replaceCalendarRecord(description,row,binding),/管理欄|既存/);
 assert.throws(()=>replaceCalendarRecord('授業予定：以前からの記述',row,binding));
 assert.throws(()=>replaceCalendarRecord('授業予定:以前からの記述',row,binding));
 assert.throws(()=>replaceCalendarRecord(valid,row,{...binding,title:'別名'}));
 assert.throws(()=>replaceCalendarRecord(valid,row,{...binding,generation:1}));
 assert.equal(parseCalendarRecord('通常の説明だけ'),null);
});
test('verified native plaintext/HTML fallback preserves four-field content and rejects ambiguous headings',()=>{
 const parsed=parsePlainCalendarRecord('<div>外側の案内</div><div><b> 授業予定&#65306;</b>native &amp; text</div><div>二行目</div><div>確認テスト：</div><div>宿題：work</div><div>授業メモ：</div>',binding);
 assert.equal(parsed.values.lesson_plan,'native & text\n二行目');assert.equal(parsed.values.homework,'work');assert.equal(parsed.values.lesson_memo,'');assert.equal(parsed.start,'<div>外側の案内</div>'.length);
 assert.throws(()=>parsePlainCalendarRecord('授業予定：one\n授業予定：two\n確認テスト：\n宿題：\n授業メモ：',binding));
 assert.throws(()=>parsePlainCalendarRecord('授業予定：one\n宿題：two',binding));
 assert.equal(parsePlainCalendarRecord('新しい説明だけ',binding),null);
 assert.equal(parsePlainCalendarRecord('授業予定:英字コロン\n確認テスト:\n宿題:\n授業メモ:',binding).values.lesson_plan,'英字コロン');
 assert.equal(parsePlainCalendarRecord('授業予定：<a href="https://example.invalid/book">教材</a>\n確認テスト：\n宿題：\n授業メモ：',binding).values.lesson_plan,'教材 (https://example.invalid/book)');
 assert.throws(()=>parsePlainCalendarRecord('授業予定：<a href="javascript:alert(1)">危険</a>\n確認テスト：\n宿題：\n授業メモ：',binding));
});
test('cutoff includes JST Oct20 midnight, excludes earlier and rejects a series master',()=>{
 assert.equal(plan().status,'ready');
 assert.equal(plan({event:{...event,start:{dateTime:'2026-10-19T23:59:59+09:00'}}}).status,'historical');
 assert.equal(plan({event:{...event,start:{dateTime:'2026-10-19T15:00:00Z'}}}).status,'ready');
 assert.equal(plan({event:{...event,recurrence:['RRULE:FREQ=WEEKLY']}}).reason,'not_individual_lesson');
 assert.equal(plan({event:{...event,id:'series'}}).reason,'not_individual_lesson');
});
for(const [name,change] of Object.entries({missing:{privacy:null},partial:{privacy:{...privacy,complete:false}},guest:{event:{...event,attendees:[{email:'student@example.invalid'}]}},omitted:{event:{...event,attendeesOmitted:true}},organizer:{event:{...event,organizer:{self:false}}},reader:{privacy:{...privacy,accessRole:'reader'}},public:{privacy:{...privacy,rules:[...privacy.rules,{role:'reader',scope:{type:'default'}}]}},domain:{privacy:{...privacy,rules:[...privacy.rules,{role:'writer',scope:{type:'domain',value:'example.invalid'}}]}},sharedUser:{privacy:{...privacy,rules:[...privacy.rules,{role:'reader',scope:{type:'user',value:'other@example.invalid'}}]}}}))test('privacy hold: '+name,()=>assert.equal(plan(change).status,'held'));
test('free-busy-only sharing does not disclose details; unknown ownership never inferred',()=>{
 assert.equal(calendarRecordPrivacy(event,{...privacy,rules:[...privacy.rules,{role:'freeBusyReader',scope:{type:'default'}}]},ownerEmail).status,'safe');
 for(const r of [{...row,record_title:null},{...row,record_hold_active:1},{...row,record_title:'別名'}])assert.equal(plan({row:r}).status,'held');
 assert.equal(plan({collision:true}).reason,'event_id_collision');
 assert.equal(plan({row:{...row,lesson_plan:'',confirmation_test:'',homework:'',lesson_memo:''}}).status,'empty');
});
test('idempotent same data is no-op; calendar data conflicts are held even for empty DB',()=>{
 const description=replaceCalendarRecord(event.description,row,binding);
 assert.equal(plan({event:{...event,description}}).status,'already_present');
 assert.equal(plan({event:{...event,description:replaceCalendarRecord('',{...row,homework:'カレンダー編集'},binding)}}).reason,'calendar_db_content_conflict');
 assert.equal(plan({event:{...event,description},row:{...row,lesson_plan:''}}).reason,'calendar_db_content_conflict');
});
function adapters({failPatch,failReadAfter,alterRead,failReserve}={}){
 let current=structuredClone(event),sent=0,reserved=0;const journal=[];
 return {journal,get sent(){return sent},get reserved(){return reserved},deps:{ownerEmail,privacy:async()=>privacy,readRecord:async()=>row,
  read:async()=>{if(sent&&failReadAfter)throw Error('offline');return alterRead?alterRead(current,sent):structuredClone(current);},
  reserve:async snapshot=>{if(failReserve)throw Error('stale version');reserved++;journal.push({snapshot});return {id:'operation'};},
  mark:async(id,state,proof)=>journal.push({id,state,proof}),
  patch:async(cal,id,body,options)=>{sent++;assert.equal(cal,'synthetic');assert.equal(id,event.id);assert.notEqual(id,event.recurringEventId);assert.deepEqual(Object.keys(body),['description']);assert.deepEqual(options,{ifMatch:'"before"',sendUpdates:'none'});if(failPatch)throw failPatch;current={...current,...body,etag:'"after"'};},
 }};
}
test('one conditional instance-only PATCH, durable full preimage before dispatch, re-fetch before verified',async()=>{
 const a=adapters(),result=await applyCalendarRecordMigration(plan(),a.deps);assert.equal(result.status,'verified');assert.equal(a.sent,1);assert.equal(a.reserved,1);
 assert.deepEqual(a.journal[0].snapshot.before,event);assert.deepEqual(a.journal.slice(1).map(e=>e.state),['dispatching','verified']);
 assert.deepEqual(parseCalendarRecord(a.journal.at(-1).proof.description).values,calendarRecordValues(row));
});
for(const code of [412,403,500,undefined])test('PATCH failure does not auto retry: '+code,async()=>{
 const a=adapters({failPatch:Object.assign(Error('failed'),{status:code})});
 await assert.rejects(applyCalendarRecordMigration(plan(),a.deps),e=>e.code===(code===412?'CALENDAR_ETAG_CONFLICT':code===403?'CALENDAR_WRITE_REJECTED':'CALENDAR_WRITE_UNKNOWN'));
 assert.equal(a.sent,1);assert.equal(a.journal.at(-1).state,[412,403].includes(code)?'precondition_failed':'unknown');
});
test('missing verification, changed metadata or lost response remains unknown',async()=>{
 for(const opts of [{failReadAfter:true},{alterRead:(e,sent)=>sent?{...e,summary:'別の生徒'}:e}]){
  const a=adapters(opts);await assert.rejects(applyCalendarRecordMigration(plan(),a.deps),e=>e.code==='CALENDAR_WRITE_UNKNOWN');assert.equal(a.journal.at(-1).state,'unknown');
 }
});
test('stale preflight or failed durable reservation sends no Calendar write',async()=>{
 const a=adapters({alterRead:e=>({...e,etag:'"changed"'})});await assert.rejects(applyCalendarRecordMigration(plan(),a.deps));assert.equal(a.sent,0);assert.equal(a.reserved,0);
 const b=adapters({failReserve:true});await assert.rejects(applyCalendarRecordMigration(plan(),b.deps));assert.equal(b.sent,0);
 const c=adapters();c.deps.privacy=async()=>null;await assert.rejects(applyCalendarRecordMigration(plan(),c.deps));assert.equal(c.sent,0);
});
test('unknown reconciliation is read-only; old snapshot does not prove a timed-out request has ended',async()=>{
 const operation={id:'op',status:'unknown',ref:plan().ref,before:event,after_description:plan().after_description},marked=[];
 const deps={read:async()=>event,mark:async(...args)=>marked.push(args)};
 assert.equal((await reconcileCalendarRecordMigration(operation,deps)).reason,'outcome_still_unknown');assert.equal(marked.length,0);
 deps.read=async()=>({...event,description:operation.after_description,etag:'"new"'});
 assert.equal((await reconcileCalendarRecordMigration(operation,deps)).status,'verified');assert.equal(marked[0][1],'verified');
 deps.read=async()=>({...event,summary:'別名',description:operation.after_description});
 assert.equal((await reconcileCalendarRecordMigration(operation,deps)).reason,'identity_changed_during_dispatch');assert.equal(marked.length,1);
});
test('explicit next-instance initialization has four inline empty headings, never overwrites DB data or existing description',async()=>{
 const emptyRow={...row,...calendarRecordValues({})},input={row:emptyRow,event:{...event,description:''},privacy,ownerEmail};
 for(const description of [null,'',' \n\t']){
  const p=planCalendarTemplateInitialization({...input,event:{...event,description}});assert.equal(p.status,'ready');
  const visible=p.after_description.replace(/<!--[\s\S]*?-->\n?/g,'').trim();
  assert.equal(visible,'授業予定：\n確認テスト：\n宿題：\n授業メモ：');
  assert.deepEqual(parseCalendarRecord(p.after_description).values,calendarRecordValues({}));
  assert.equal(planCalendarTemplateInitialization({...input,event:{...event,description:p.after_description}}).status,'not_empty');
 }
 assert.equal(planCalendarTemplateInitialization({...input,row}).reason,'db_content_requires_migration');
 for(const description of ['元の案内','授業予定：本人が入力'])assert.equal(planCalendarTemplateInitialization({...input,event:{...event,description}}).status,'not_empty');
 const p=planCalendarTemplateInitialization(input),a=adapters();a.deps.read=async()=>({...event,description:'本人が同時に入力'});a.deps.readRecord=async()=>emptyRow;
 await assert.rejects(applyCalendarRecordMigration(p,a.deps));assert.equal(a.sent,0);
});
