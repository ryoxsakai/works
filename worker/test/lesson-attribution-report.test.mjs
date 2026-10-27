import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
function extract(name){
  const start=source.indexOf(`async function ${name}(`)>=0?source.indexOf(`async function ${name}(`):source.indexOf(`function ${name}(`);
  assert.ok(start>=0,name);return source.slice(start,source.indexOf('\n}',start)+2);
}
const pending=new Function(`return ${extract('scheduleAttributionPending')}`)();
const percent=new Function(`return ${extract('percent')}`)();
const fields=['lesson_plan','confirmation_test','homework','lesson_memo'];
const events=[
  {id:'done',title:'山田',attribution_status:'confirmed',completed:true,start:'2020-01-01',end:'2020-01-02',...Object.fromEntries(fields.map(f=>[f,'verified']))},
  {id:'missing',title:'山田',attribution_status:'new',completed:false,start:'2020-01-03',end:'2020-01-04'},
  {id:'unknown',title:'山田',attribution_status:'legacy_unknown',completed:false,start:'2020-01-05',end:'2020-01-06'},
];
const common={scheduleLegacyUnverified:new Function(`return ${extract('scheduleLegacyUnverified')}`)(),SCHEDULE_TIME_ZONE:'Asia/Tokyo',scheduleAttributionPending:pending,percent,SCHEDULE_TEXT_FIELDS:fields,readScheduleEvents:async()=>events,
  requiredStudentName:args=>args.name,readBoundedInteger:(value,fallback)=>value??fallback,
  todayInScheduleTimeZone:()=> '2026-10-27',shiftScheduleDate:date=>date,
  resolveStudentIdentity:async()=>({schedule_title:'山田'}),readStudentMaterials:async()=>[],summarizeMaterialProgress:()=>({}),
  scheduleMonthRange:()=>({month:'2020-01',startDate:'2020-01-01',endDate:'2020-01-31'}),scheduleDateRange:()=>({})};
function load(name,deps=common){return new Function(...Object.keys(deps),`return ${extract(name)}`)(...Object.values(deps));}
test('monthly and progress aggregates separate unknown attribution from definite incompletion',async()=>{
  const monthly=await load('readMonthlyReport')({},{});
  assert.equal(monthly.totals.lessons,3);assert.equal(monthly.totals.completed,1);assert.equal(monthly.totals.unrecorded,1);
  assert.equal(monthly.totals.attribution_pending,1);assert.equal(monthly.totals.completion_rate,null);assert.equal(monthly.data_complete,false);
  assert.equal(monthly.missing_fields.lesson_plan,1);assert.equal(monthly.by_title[0].completion_rate,null);
  assert.deepEqual(monthly.unrecorded_lessons.map(e=>e.id),['missing']);
  const progress=(await load('readCurriculumProgress')({},{name:'山田'})).lesson_progress;
  assert.equal(progress.completed,1);assert.equal(progress.past_due,1);assert.equal(progress.attribution_pending_count,1);
  assert.equal(progress.elapsed_total,2);assert.equal(progress.elapsed_completion_rate,null);
});
test('unrecorded notifications receive pending records separately and missing fields stay unknown',async()=>{
  const missing=load('scheduleMissingFields');
  assert.equal(missing(events[2]),null);
  const output=await load('readUnrecordedLessons',{...common,scheduleMissingFields:missing})({},{});
  assert.equal(output.count,1);assert.deepEqual(output.lessons.map(e=>e.id),['missing']);
  assert.equal(output.attribution_pending_count,1);assert.equal(output.attribution_pending_lessons[0].id,'unknown');
});
