import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {lessonEventRef,lessonEventKey,sameLessonEvent} from '../../shared/lesson-plan.js';
import {unassignedLessonDisplay} from '../../shared/unassigned-lesson.mjs';

const event={id:'synthetic',_calendarId:'calendar',summary:'合成授業',etag:'v1',start:{dateTime:'2026-11-04T10:00:00+09:00'},end:{dateTime:'2026-11-04T11:00:00+09:00'}};
const target=lessonEventRef(event);
const row=(changes={})=>({calendar_event_id:target.id,record_storage:'d1_owner',record_read_target:target,record_exists:false,record_revision:0,attribution_status:'owner_unassigned',pending_allowed:true,pending_storage_available:true,pending_context:'synthetic-context',pending_exists:false,completed:0,lesson_plan:'',confirmation_test:'',homework:'',lesson_memo:'',...changes});

test('only a verified, readable unassigned occurrence can be rendered read-only',()=>{
 assert.deepEqual(unassignedLessonDisplay(row(),target),{lessonPlan:'',pendingContext:'synthetic-context'});
 assert.deepEqual(unassignedLessonDisplay(row({pending_exists:true,record_revision:2,lesson_plan:'予定の下書き'}),target),{lessonPlan:'予定の下書き',pendingContext:'synthetic-context'});
 for(const changed of [{record_read_target:{...target,calendar_id:'other'}},{calendar_event_id:'other'},{attribution_status:'target_unavailable'},{record_exists:true},{owner_id:'other-owner'},{record_hold_active:true},{record_collision:true},{record_pending_operation:'unknown'},{record_requires_reload:true},{pending_storage_available:false},{pending_allowed:false},{pending_exists:undefined},{lesson_plan:'unexpected'},{homework:'unexpected'}]) assert.equal(unassignedLessonDisplay(row(changed),target),null);
});

test('student progress keeps seven normal cells and does not create a save target',async()=>{
 const source=readFileSync(new URL('../app.js',import.meta.url),'utf8'),start=source.indexOf('async function renderCurriculumTable('),end=source.indexOf('\nels.curriculumTbody.addEventListener("input"',start);
 const els={curriculumTbody:{innerHTML:''}},plans=new Map(),drafts=new Map(),copies=[];let saved=row();
 const state=vm.createContext({els,excludedTitles:new Set(),sameNameLessonCount:()=>({n:1,m:1}),lessonEventRef,lessonEventKey,unassignedLessonDisplay,recordDrafts:drafts,pendingRecoveryCopies:()=>copies,assertStudentContext(){},readRecordEntries:async()=>[saved],attributedLessonRecord:value=>value,lessonRecordNeedsReview:()=>true,lessonReviewRow:()=>'<tr><td>保持・確認</td></tr>',formatCurriculumDate:()=> '11/04',lessonPlans:{version:0,get:key=>plans.get(key),seed(){throw Error('unassigned must not be seeded');}},escapeHtml:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),restoreRecordDraftRows(){},showRetainedRecordDrafts(){},renderLessonPlans(){},captureStudentContext:()=>({})});
 vm.runInContext(source.slice(start,end),state);
 await state.renderCurriculumTable([event],{},[event]);
 assert.match(els.curriculumTbody.innerHTML,/data-unassigned-progress/);assert.equal((els.curriculumTbody.innerHTML.match(/<td/g)||[]).length,7);assert.equal((els.curriculumTbody.innerHTML.match(/disabled/g)||[]).length,5);assert.doesNotMatch(els.curriculumTbody.innerHTML,/data-record-ref|data-event-id|保持・確認/);
 saved=row({pending_exists:true,lesson_plan:'<下書き>'});await state.renderCurriculumTable([event],{},[event]);assert.match(els.curriculumTbody.innerHTML,/&lt;下書き&gt;/);
 plans.set(lessonEventKey(target),{dirty:true});await state.renderCurriculumTable([event],{},[event]);assert.match(els.curriculumTbody.innerHTML,/保持・確認/);
 plans.clear();copies.push({target,value:'保持入力'});await state.renderCurriculumTable([event],{},[event]);assert.match(els.curriculumTbody.innerHTML,/保持・確認/);copies.length=0;drafts.set(lessonEventKey(target),{});await state.renderCurriculumTable([event],{},[event]);assert.match(els.curriculumTbody.innerHTML,/保持・確認/);drafts.clear();saved=row({pending_storage_available:false});await state.renderCurriculumTable([event],{},[event]);assert.match(els.curriculumTbody.innerHTML,/保持・確認/);
});

test('read-only pending display follows only a confirmed save for the same occurrence',()=>{
 const source=readFileSync(new URL('../app.js',import.meta.url),'utf8'),start=source.indexOf('function renderLessonPlans() {'),end=source.indexOf('\ndocument.addEventListener("click"',start);
 const input={value:'以前の保存値'},node={dataset:{pendingKey:lessonEventKey(target),pendingTarget:JSON.stringify(target),pendingContext:'synthetic-context'},querySelector:()=>input};let plan={target,pendingContext:'synthetic-context',ownerId:null,base:'保存後',dirty:false,pending:0,status:'saved'};
 const state=vm.createContext({document:{querySelectorAll:()=>[node]},lessonPlans:{get:()=>plan},renderPlanEditors(){},lessonPlanDate(){},resizeRecordInput(){},sameLessonEvent});vm.runInContext(source.slice(start,end),state);
 state.renderLessonPlans();assert.equal(input.value,'保存後');plan={...plan,base:'未保存値',dirty:true};state.renderLessonPlans();assert.equal(input.value,'保存後');
 plan={...plan,dirty:false,status:'conflict'};state.renderLessonPlans();assert.equal(input.value,'');input.value='以前の保存値';plan={...plan,status:'ready',pendingContext:'different'};state.renderLessonPlans();assert.equal(input.value,'');
});
