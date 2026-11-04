import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {sameNameLessonCount} from '../../shared/lesson-counts.mjs';
import {lessonEventRef} from '../../shared/lesson-plan.js';
import {recordDateRange} from '../record-date.js';

const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const extract=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end));
const event=(id,day,calendar,title='Ａ 英語')=>({id,_calendarId:calendar,summary:title,etag:'v1',start:{dateTime:day+'T10:00:00+09:00'},end:{dateTime:day+'T11:00:00+09:00'}});

test('curriculum keeps displayed records but counts each calendar and exact normalized title like daily cards',async()=>{
 const a=event('a','2026-10-01','one'),b=event('b','2026-10-08','one','A　英語'),c=event('c','2026-10-15','one');
 const x=event('x','2026-10-03','two'),y=event('y','2026-10-12','two');
 const skipped=event('skip','2026-10-09','one','Ａ 英語 休講'),different=event('different','2026-10-11','one','Ａ 英語 別講座');
 const all=[a,b,c,x,y,skipped,different],displayed=[b,y,skipped];
 const elements={curriculumTbody:{innerHTML:''}},seeded=[];
 const state=vm.createContext({els:elements,excludedTitles:new Set(),sameNameLessonCount,lessonEventRef,
  assertStudentContext(){},readRecordEntries:async rows=>rows.map(row=>({calendar_event_id:row.id,record_revision:3,attribution_status:row.id==='y'?'owner_unassigned':'confirmed'})),
  attributedLessonRecord:value=>value,lessonRecordNeedsReview:value=>value.attribution_status==='owner_unassigned',
  lessonReviewRow:(_ref,_record,label)=>`<tr><td><strong>${label}</strong><p>確認が必要</p></td></tr>`,
  formatCurriculumDate:value=>value,lessonPlans:{version:0,seed:(...args)=>seeded.push(args)},
  escapeHtml:String,lessonAttributionNotice:()=>'',lessonPlanEditor:()=>'<textarea></textarea>',
  restoreRecordDraftRows(){},showRetainedRecordDrafts(){},renderLessonPlans(){},captureStudentContext:()=>({})});
 vm.runInContext(extract('async function renderCurriculumTable(', '\nels.curriculumTbody.addEventListener("input"'),state);
 await state.renderCurriculumTable(displayed,{},all);
 assert.match(elements.curriculumTbody.innerHTML,/<td>2\/3回<\/td>/);
 assert.match(elements.curriculumTbody.innerHTML,/2\/2回（同名予定・所属未確定）/);
 assert.match(elements.curriculumTbody.innerHTML,/<td>—\/—回<\/td>/);
 assert.equal(seeded.length,2,'held records remain unseeded and existing rows stay present');
 assert.deepEqual(sameNameLessonCount(b,all),{n:2,m:3});assert.deepEqual(sameNameLessonCount(y,all),{n:2,m:2});
});

test('student list reads the entire selected term using JST bounds and supplies unfiltered candidates to counts',async()=>{
 const term={id:7,start_date:'2026-10-01',end_date:'2026-10-31'},a=event('a','2026-10-01','one'),b=event('b','2026-10-31','one'),other=event('other','2026-10-31','two');
 let range,rendered;
 const state=vm.createContext({recordDateRange,terms:[term],selectedCalendarIds:new Set(['one','two']),studentGroup:'G',studentChoices:[{name:'A',group:'G',calendarIds:['one']}],
  els:{curriculumName:{value:'A'},curriculumTermSelect:{value:'7'},curriculumTbody:{innerHTML:''}},
  captureStudentContext:()=>({}),assertStudentContext(){},getSessionToken:()=> 'synthetic',
  eventMatchesCurriculumName:()=>true,fetchCalendarEvents:async(min,max,options)=>{range={min,max,options};return [other,b,a];},
  renderCurriculumTable:async(matched,_context,all)=>{rendered={matched,all};}});
 vm.runInContext(extract('async function loadCurriculumEvents(', '\nasync function renderCurriculumTable('),state);
 await state.loadCurriculumEvents({});
 assert.equal(range.min,'2026-09-30T15:00:00.000Z');assert.equal(range.max,'2026-10-31T15:00:00.000Z');
 assert.deepEqual(Array.from(rendered.matched,row=>row.id),['a','b']);assert.equal(rendered.all.length,3);
});
