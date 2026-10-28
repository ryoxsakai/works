import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {lessonEventRef,lessonEventKey} from '../../shared/lesson-plan.js';
import {attributedLessonRecord} from '../../shared/lesson-attribution.js';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
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
