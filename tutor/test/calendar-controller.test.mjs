import test from 'node:test';import assert from 'node:assert/strict';
import {createLessonPlanController} from '../lesson-plan.js';import {lessonEventKey} from '../../shared/lesson-plan.js';
import {readNextLessonWithTemplate} from '../../shared/next-lesson-read.mjs';
const target={id:'synthetic',calendar_id:'calendar',title:'合成',start:'2026-10-31T01:00:00Z',end:'2026-10-31T02:00:00Z',etag:'"1"'};
test('queued edits use only ETags proved by own responses, preserving frozen target and source',async()=>{
 let release;const gate=new Promise(r=>release=r),calls=[];
 const controller=createLessonPlanController({readNext:async()=>{},write:async body=>{calls.push(body);if(calls.length===1)await gate;return {target:{...target,etag:'"'+(calls.length+1)+'"'},lesson_plan:body.lesson_plan,record_revision:calls.length};}});
 const key=lessonEventKey(target);controller.seed(target,'',0,0);controller.edit(key,'first');const one=controller.save(key);await new Promise(r=>setTimeout(r,0));controller.edit(key,'second');const two=controller.save(key);release();await Promise.all([one,two]);
 assert.deepEqual(calls.map(c=>c.target.etag),['"1"','"2"']);assert.deepEqual(calls.map(c=>c.expected_lesson_plan),['','first']);assert.equal(controller.get(key).value,'second');
});
test('unknown first response blocks an already queued second save, without replay',async()=>{
 let release;const gate=new Promise(r=>release=r);let calls=0;
 const controller=createLessonPlanController({readNext:async()=>{},write:async()=>{calls++;await gate;throw Object.assign(Error('unknown'),{unknown:true});}}),key=lessonEventKey(target);
 controller.seed(target,'',0,0);controller.edit(key,'first');const one=controller.save(key).catch(()=>{});await new Promise(r=>setTimeout(r,0));controller.edit(key,'second');const two=controller.save(key);release();await Promise.all([one,two]);assert.equal(calls,1);assert.equal(controller.get(key).value,'second');assert.equal(controller.get(key).status,'conflict');
});
test('browser-only template initialization is explicit and deduplicated; normal reads have no POST',async()=>{
 let posts=0,release;const gate=new Promise(r=>release=r);const source={...target,id:'previous'};
 const request=async(path)=>{if(path==='/next-lesson-plan/initialize'){posts++;await gate;return {target:{...target,etag:'"2"'},record_revision:1};}return {source,target,lesson_plan:'',template_initialization_available:true};};
 const one=readNextLessonWithTemplate(source,request),two=readNextLessonWithTemplate(source,request);await new Promise(r=>setTimeout(r,0));assert.equal(posts,1);release();const results=await Promise.all([one,two]);assert.ok(results.every(r=>r.lesson_plan===''&&r.target.etag==='"2"'));
 let calls=0;await readNextLessonWithTemplate(source,async()=>{calls++;return {source,target,lesson_plan:'',template_initialization_available:false};});assert.equal(calls,1);
});
