import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {tokyoDateKey,shiftRecordDate,recordDateRange} from '../record-date.js';
import {attributedLessonRecord} from '../../shared/lesson-attribution.js';
import {lessonEventRef} from '../../shared/lesson-plan.js';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
function fn(name){const start=source.indexOf(`async function ${name}(`);return source.slice(start,source.indexOf('\n}',start)+2);}
test('Tokyo date, civil day navigation and exclusive fetch boundaries',()=>{
  assert.equal(tokyoDateKey(new Date('2026-10-16T15:00:00Z')),'2026-10-17');
  assert.equal(tokyoDateKey(new Date('2026-10-16T14:59:59Z')),'2026-10-16');
  for(const [day,delta,expected] of [['2026-10-31',1,'2026-11-01'],['2026-01-01',-1,'2025-12-31'],['2026-12-31',1,'2027-01-01'],['2028-03-01',-1,'2028-02-29']])assert.equal(shiftRecordDate(day,delta),expected);
  assert.deepEqual(recordDateRange('2026-12-31'),['2026-12-30T15:00:00.000Z','2026-12-31T15:00:00.000Z']);
  assert.deepEqual(recordDateRange('2026-09-03','2026-12-05'),['2026-09-02T15:00:00.000Z','2026-12-05T15:00:00.000Z']);
});
test('two date buttons accumulate days from the displayed date',async()=>{
  const handlers={};let loaded=[];
  const buttons=['prev','next'].map(day=>({dataset:{day},addEventListener(_event,handler){handlers[day]=handler;}}));
  const state=vm.createContext({selectedRecordDate:'2027-01-01',shiftRecordDate,els:{recordDayBtns:buttons,actionError:{textContent:''}},loadRecordTable:async()=>loaded.push(state.selectedRecordDate),showActionError:assert.fail});
  const start=source.indexOf('els.recordDayBtns.forEach(');
  vm.runInContext(source.slice(start,source.indexOf('\n});',start)+4),state);
  await handlers.prev();await handlers.prev();await handlers.next();
  assert.deepEqual(loaded,['2026-12-31','2026-12-30','2026-12-31']);
});
function setup(overrides={}){
  const state=vm.createContext({lessonPlans:{version:0},lessonEventRef,attributedLessonRecord,recordTableRequest:0,selectedRecordDate:'2026-10-17',selectedCalendarIds:new Set(['qa']),selectedTermIds:new Set(),terms:[],calendarColors:new Map(),
    els:{recordTbody:{innerHTML:''}},getSessionToken:()=>true,renderRecordDateLabel(){},recordDateRange,shiftRecordDate,isExcludedScheduleEvent:()=>false,
    readPreviousEntries:async()=>[],readRecordEntries:async()=>state.apiFetch(),fetchCalendarEvents:async()=>[],apiFetch:async()=>[],renderRecordTable:rows=>{state.rendered=rows;},...overrides});
  vm.runInContext(fn('loadRecordTable'),state);return state;
}
const ev=(day)=>({id:day,summary:'サンプル',start:{dateTime:day+'T10:00:00+09:00'},_calendarId:'qa'});
for(const stage of ['day','range','entries']){
  test(`out-of-order ${stage} response cannot restore the older selected day`,async()=>{
    let release;let calls=0;let entries=0;
    const state=setup({fetchCalendarEvents:async()=>{
      const n=++calls;
      if((stage==='day'&&n===1)||(stage==='range'&&n===2))return await new Promise(resolve=>{release=resolve;});
      return [ev(state.selectedRecordDate)];
    },apiFetch:async()=>{
      if(stage==='entries'&&++entries===1)return await new Promise(resolve=>{release=resolve;});
      return [];
    }});
    const old=state.loadRecordTable();
    while(!release)await Promise.resolve();
    state.selectedRecordDate='2026-10-16';await state.loadRecordTable();
    release(stage==='entries'?[]:[ev('2026-10-17')]);await old;
    assert.equal(state.rendered[0].eventId,'2026-10-16');
  });
}
test('old errors are suppressed while current errors replace the loading row',async()=>{
  let rejectOld;
  const state=setup({fetchCalendarEvents:()=>new Promise((_resolve,reject)=>{rejectOld=reject;})});
  const old=state.loadRecordTable();state.selectedRecordDate='2026-10-16';state.fetchCalendarEvents=async()=>[];
  await state.loadRecordTable();const current=state.els.recordTbody.innerHTML;
  rejectOld(new Error('old request'));await old;assert.equal(state.els.recordTbody.innerHTML,current);
  state.fetchCalendarEvents=async()=>{throw new Error('current request');};
  await assert.rejects(state.loadRecordTable(),/current request/);
  assert.match(state.els.recordTbody.innerHTML,/取得できません/);
});
test('fetch uses Tokyo day boundaries and preserves record payloads',async()=>{
  const ranges=[];const state=setup({fetchCalendarEvents:async(min,max)=>{ranges.push([min,max]);return [ev('2026-10-17')];},apiFetch:async()=>[{calendar_event_id:'2026-10-17',record_exists:true,record_calendar_id:'qa',record_title:'サンプル',record_revision:1,lesson_plan:'既存の日本語\n二行目',homework:'宿題'}]});
  await state.loadRecordTable();
  assert.deepEqual(ranges[0],recordDateRange('2026-10-17'));
  assert.equal(state.rendered[0].lessonPlan,'既存の日本語\n二行目');assert.equal(state.rendered[0].homework,'宿題');
});
