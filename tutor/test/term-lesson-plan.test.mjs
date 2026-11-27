import assert from 'node:assert/strict';
import test from 'node:test';
import {termLessonPositions,termPosition,termPlanKey,termUsesNumberedPlans} from '../../shared/term-lesson-plan.mjs';

const winter={id:2,label:'冬期',start_date:'2026-12-01',end_date:'2027-01-15'};
const event=(id,time,title='合成生徒甲',cal='calendar',extra={})=>({id,_calendarId:cal,summary:title,etag:'1',start:{dateTime:time},end:{dateTime:new Date(Date.parse(time)+3600000).toISOString()},...extra});
const a=event('old-a','2026-12-01T00:00:00+09:00'),b=event('old-b','2026-12-10T14:20:00+09:00'),c=event('old-c','2027-01-15T20:00:00+09:00');
test('winter is enabled by default and other terms support explicit opt-in',()=>{
  assert.equal(termUsesNumberedPlans(winter),true);
  assert.equal(termUsesNumberedPlans({...winter,label:'冬季講習'}),true);
  assert.equal(termUsesNumberedPlans(winter,{2:false}),false);
  assert.equal(termUsesNumberedPlans({id:1,label:'後期'}),false);
  assert.equal(termUsesNumberedPlans({id:1,label:'後期'},{1:true}),true);
});

test('positions count only eligible same-name events in the same JST term and calendar',()=>{
  const previous=event('previous','2026-11-30T23:59:00+09:00'),next=event('next','2027-01-16T00:00:00+09:00');
  const other=event('other','2026-12-02T10:00:00+09:00','合成生徒甲','other');
  const absent=event('cancelled','2026-12-03T12:00:00+09:00','合成生徒甲','calendar',{status:'cancelled'});
  const task=event('task','2026-12-04T12:00:00+09:00','合成生徒甲','calendar',{extendedProperties:{private:{worksTodo:'123'}}});
  const allDay={...event('day','2026-12-04T12:00:00+09:00'),start:{date:'2026-12-04'}};
  const similarlyNamed=event('similar','2026-12-04T13:00:00+09:00','合成生徒乙');
  const list=termLessonPositions(winter,[c,previous,next,a,other,absent,task,allDay,b,similarlyNamed]);
  assert.equal(termPosition(list,a).current.ordinal,1);
  assert.equal(termPosition(list,b).current.ordinal,2);
  assert.equal(termPosition(list,c).total,3);
  assert.equal(termPosition(list,c).next.ordinal,4);
  assert.equal(termPosition(list,c).nextRef,null);
  assert.equal(termPosition(list,other).total,1);
  assert.equal(termPosition(list,similarlyNamed).total,1);
  for(const skipped of [previous,next,absent,task,allDay])assert.equal(termPosition(list,skipped),null);
});

test('moving, inserting, deleting, and replacing IDs never shift what is saved by ordinal',()=>{
  assert.equal(termLessonPositions(winter,[]).size,0);
  let list=termLessonPositions(winter,[a,b,c]);
  const key=termPlanKey(termPosition(list,b).current);
  const moved=event('new-id','2026-12-14T14:20:00+09:00');
  list=termLessonPositions(winter,[a,moved,c]);
  assert.equal(termPlanKey(termPosition(list,moved).current),key);
  const inserted=event('inserted','2026-12-05T14:20:00+09:00','　合成生徒甲　');
  list=termLessonPositions(winter,[c,inserted,a,moved]);
  assert.equal(termPlanKey(termPosition(list,inserted).current),key);
  assert.equal(termPosition(list,moved).current.ordinal,3);
  list=termLessonPositions(winter,[inserted,moved,c]);
  assert.equal(termPlanKey(termPosition(list,moved).current),key);
});

test('a contradictory fetch or same-name overlapping slots are held, not guessed',()=>{
  assert.equal(termPosition(termLessonPositions(winter,[a,b]),{...b,etag:'new'}),null);
  assert.equal(termPosition(termLessonPositions(winter,[a,b,{...b,etag:'new'}]),a),null);
  assert.equal(termPosition(termLessonPositions(winter,[a,b,{...b,id:'parallel'}]),a),null);
  assert.equal(termPosition(termLessonPositions(winter,[a,b,{...b}]),b).total,2);
});
