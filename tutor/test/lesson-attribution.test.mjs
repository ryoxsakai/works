import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {lessonEventRef,lessonEventKey} from '../../shared/lesson-plan.js';
import {attributedLessonRecord,lessonRecordNeedsReview} from '../../shared/lesson-attribution.js';
import {sameLessonOwner,previousOwnerRecord,lessonRecordRows} from '../../shared/lesson-record-view.mjs';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
test('D1 owner records never bypass a stale observed event label or date',()=>{
 const observed=lessonEventRef({id:'same',calendar_id:'cal',summary:'A',etag:'old',start:{dateTime:'2026-11-01T10:00:00+09:00'},end:{dateTime:'2026-11-01T11:00:00+09:00'}}),current={...observed,title:'B',etag:'new'};
 const row={calendar_event_id:'same',record_storage:'d1_owner',record_read_target:current,owner_id:'owner-b',attribution_status:'confirmed',record_exists:true,lesson_plan:'B private plan',homework:'B private homework'};
 const held=attributedLessonRecord(row,observed);assert.equal(held.attribution_status,'target_unavailable');assert.ok(!held.lesson_plan);assert.ok(!held.homework);assert.ok(!held.owner_id);
 assert.equal(attributedLessonRecord(row,current).lesson_plan,'B private plan');
 assert.ok(!attributedLessonRecord(row,{...current,start:'2026-11-02T10:00:00+09:00'}).lesson_plan);
 assert.ok(!attributedLessonRecord(row,{...current,calendar_id:'other'}).lesson_plan);
 assert.equal(attributedLessonRecord({...row,record_read_target:undefined},observed).attribution_status,'target_unavailable');
});
test('previous lesson follows fixed owner through name swaps and rename, never a same-name other owner or deleted slot',()=>{
 const event=(id,title,date)=>({id,calendar_id:'cal',summary:title,start:{dateTime:date},end:{dateTime:date},etag:id});
 const oldB=event('b-old','B','2026-10-20T10:00:00+09:00'),oldA=event('a-old','A','2026-10-21T10:00:00+09:00'),today=event('a-now','B','2026-11-01T10:00:00+09:00');
 const record=(e,owner)=>({calendar_event_id:e.id,record_storage:'d1_owner',record_read_target:lessonEventRef(e),owner_id:owner,attribution_status:'confirmed',lesson_plan:owner+' plan'});
 const current=record(today,'owner-a'),map=new Map([[oldB.id,record(oldB,'owner-b')],[oldA.id,record(oldA,'owner-a')]]),read=e=>attributedLessonRecord(map.get(e.id),lessonEventRef(e));
 assert.equal(sameLessonOwner(current,map.get(oldB.id)),false);assert.equal(previousOwnerRecord(current,today,[oldB,oldA],read).record.owner_id,'owner-a');
 assert.equal(previousOwnerRecord(current,today,[oldB],read),null);
 const renamed={...today,summary:'新しい名前'};assert.equal(previousOwnerRecord({...current,record_read_target:lessonEventRef(renamed)},renamed,[oldA],read).record.lesson_plan,'owner-a plan');
});
test('actual daily table row builder selects the same owner across renamed labels and hides a deleted predecessor',()=>{
 const event=(id,title,date)=>({id,_calendarId:'cal',summary:title,start:{dateTime:date},end:{dateTime:date},etag:id}),a=event('a-old','A','2026-10-20T10:00:00+09:00'),b=event('b-old','B','2026-10-21T10:00:00+09:00'),now=event('a-now','B','2026-11-01T10:00:00+09:00');
 const record=(event,owner)=>({calendar_event_id:event.id,record_storage:'d1_owner',record_read_target:lessonEventRef(event),owner_id:owner,attribution_status:'confirmed',lesson_plan:owner+' plan'});
 const entryMap=new Map([[a.id,record(a,'a')],[b.id,record(b,'b')],[now.id,record(now,'a')]]),start=source.indexOf('const rows = dayEvents.map((ev)'),end=source.indexOf('renderRecordTable(rows);',start);
 function build(rangeEvents){const state=vm.createContext({dayEvents:[now],rangeEvents,entryMap,lessonEventRef,attributedLessonRecord,previousOwnerRecord,calendarColors:new Map(),isExcludedScheduleEvent:()=>false,coveringTerm:null,planReadVersion:0});vm.runInContext(source.slice(start,end)+'\nglobalThis.result=rows;',state);return state.result[0];}
 assert.equal(build([a,b,now]).prevRecord.owner_id,'a');assert.equal(build([b,now]).prevLessonPlan,'');
});
test('shared card renderer independently refuses stale D1 content and another owners previous plan',()=>{
 const ref=lessonEventRef({id:'today',calendar_id:'cal',summary:'A',start:{dateTime:'2026-11-01T10:00:00+09:00'},end:{dateTime:'2026-11-01T11:00:00+09:00'}});
 const current={record_storage:'d1_owner',record_read_target:ref,owner_id:'a',attribution_status:'confirmed',record_revision:1};
 const deps={escapeHtml:String,formatTimeOrPeriod:String,lessonRecordNeedsReview,lessonReviewRow:()=>'<review-required>',lightenHexColor:String,calendarName:()=>'',lessonAttributionNotice:()=>'',lessonPlanEditor:()=>'',lessonPlanFeedback:()=>'',recordStudentPrefName:()=>'',lessonEventKey:()=>''};
 const row={ref,record:current,label:'A',eventId:'today',start:ref.start,prevRecord:{...current,owner_id:'b'},prevLessonPlan:'B private previous plan'};
 assert.ok(!lessonRecordRows([row],deps).includes('B private previous plan'));
 assert.equal(lessonRecordRows([{...row,record:{...current,record_read_target:{...ref,title:'B'}},homework:'B private homework'}],deps),'<review-required>');
});
test('collision evidence survives a later unrelated 250-target chunk',async()=>{
 const targets=Array.from({length:251},(_,i)=>({id:`event-${i}`,calendar_id:'a',title:'Synthetic',start:'2026-10-27T01:00:00Z'}));
 const legacy={calendar_event_id:'event-0',record_exists:1,record_revision:0,record_title:null,lesson_plan:'ambiguous old plan'};
 let calls=0;
 const state=vm.createContext({lessonEventRef,lessonEventKey,apiFetch:async()=>{calls++;return calls===1?[{...legacy,record_collision:true}]:[legacy];}});
 const start=source.indexOf('async function readRecordEntries(');
 vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),state);
 const rows=await state.readRecordEntries(targets);assert.equal(calls,2);assert.equal(rows[0].record_collision,true);
 assert.equal(attributedLessonRecord(rows[0],targets[0]).attribution_status,'id_collision');assert.equal(attributedLessonRecord(rows[0],targets[0]).lesson_plan,null);
});
test('list cards apply the same safe comparison as lesson tables',()=>{
 const start=source.indexOf('const detail = attributedLessonRecord(eventDetails.get(ev.id),lessonEventRef(ev))');
 assert.ok(start>0); // Guard the separate list-card read surface as well as the shared comparison itself.
 const row={calendar_event_id:'event',record_exists:1,record_title:null,record_observed_calendar_id:'a',record_observed_title:'Original',lesson_plan:'old'};
 assert.equal(attributedLessonRecord(row,{id:'event',calendar_id:'a',title:'Replacement'}).lesson_plan,null);
});

test('ordinary legacy labels are hidden while review warnings and attribution state are retained',()=>{
 const start=source.indexOf('function lessonAttributionNotice(');
 const state=vm.createContext({lessonRecordNeedsReview:row=>['title_changed','known_change','id_collision','target_unavailable'].includes(row?.attribution_status)});
 vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),state);
 for(const status of ['legacy_unverified','legacy_historical','confirmed','new'])assert.equal(state.lessonAttributionNotice({attribution_status:status}),'');
 for(const status of ['title_changed','known_change','id_collision','target_unavailable'])assert.match(state.lessonAttributionNotice({attribution_status:status}),/予定名の対応確認が必要です/);
 const row={calendar_event_id:'event',record_exists:1,record_title:null,record_observed_calendar_id:'a',record_observed_title:'Original',lesson_plan:'retained'};
 const same=attributedLessonRecord(row,{id:'event',calendar_id:'a',title:'Original'});assert.equal(same.attribution_status,'legacy_unverified');assert.equal(same.lesson_plan,'retained');
 const changed=attributedLessonRecord(row,{id:'event',calendar_id:'a',title:'Replacement'});assert.equal(changed.attribution_status,'title_changed');assert.equal(changed.lesson_plan,null);
 assert.ok(!source.includes('旧記録・所属未確認'));
});
