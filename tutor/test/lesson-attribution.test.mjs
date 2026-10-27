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
