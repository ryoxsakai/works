import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sameNameLessonCount} from '../../shared/lesson-counts.mjs';
const event=(id,start,title='合成生徒',calendar='TOMAS')=>({id,summary:title,_calendarId:calendar,start:{dateTime:start},end:{dateTime:new Date(Date.parse(start)+3600000).toISOString()}});
test('same-name sessions across repeated and single events count chronologically in their own calendar',()=>{
 const events=Array.from({length:9},(_,i)=>event('old'+i,`2026-09-${String(i+5).padStart(2,'0')}T17:20:00+09:00`));
 const first=event('first','2026-11-03T08:50:00+09:00','合成生徒'),second=event('second','2026-11-03T10:20:00+09:00',' 合成生徒 ');
 const future=Array.from({length:4},(_,i)=>event('future'+i,`2026-11-${14+i}T17:20:00+09:00`));
 const all=[...events,first,second,...future,event('other','2026-10-01T10:00:00+09:00','合成生徒','別教室'),event('skip','2026-10-01T12:00:00+09:00','合成生徒 休講'),{...events[0],id:'series-parent',recurrence:['RRULE:FREQ=WEEKLY']}];
 assert.deepEqual(sameNameLessonCount(first,all),{n:10,m:15});assert.deepEqual(sameNameLessonCount(second,all),{n:11,m:15});
});
test('normalizes names and rejects missing, changed and simultaneous ambiguous events',()=>{
 const a=event('a','2026-11-03T08:50:00+09:00','Ａ　英語'),b=event('b','2026-11-03T10:50:00+09:00','A 英語');
 assert.deepEqual(sameNameLessonCount(b,[a,b]),{n:2,m:2});
 assert.deepEqual(sameNameLessonCount(a,[b]),{n:'—',m:'—'});
 assert.deepEqual(sameNameLessonCount(a,[a,{...a,etag:'changed'}]),{n:'—',m:'—'});
 assert.deepEqual(sameNameLessonCount(a,[a,event('x',a.start.dateTime,'A 英語')]),{n:'—',m:'—'});
});
