import test from 'node:test';
import assert from 'node:assert/strict';
import {createLessonPlanController} from '../lesson-plan.js';
import {lessonEventKey} from '../../shared/lesson-plan.js';

const ref=(id,cal='a')=>({id,calendar_id:cal,title:'山田',start:`2026-10-17T${id==='one'?'10':'11'}:00:00+09:00`,end:`2026-10-17T${id==='one'?'11':'12'}:00:00+09:00`,etag:'1',timed:true,status:'confirmed'});
const gate=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function setup(extra={}) {
  const source=ref('one'),target=ref('two');const writes=[];
  const store=createLessonPlanController({readNext:async()=>({source,target,lesson_plan:'既存予定'}),write:async body=>{writes.push(body);return {lesson_plan:body.lesson_plan};},...extra});
  return {store,source,target,writes,sourceKey:lessonEventKey(source),targetKey:lessonEventKey(target)};
}
test('next and current lesson editors share a single plan, with no copy or initial write',async()=>{
  const {store,source,target,writes,targetKey,sourceKey}=setup();
  await store.loadNext(source);assert.equal(store.get(targetKey).value,'既存予定');assert.equal(writes.length,0);
  store.edit(targetKey,'次回欄で変更');await store.save(targetKey,sourceKey);
  assert.equal(writes[0].target.id,target.id);assert.equal(writes[0].source.id,source.id);assert.equal(writes[0].expected_lesson_plan,'既存予定');
  store.seed(target,'古い表示',0);assert.equal(store.get(targetKey).value,'次回欄で変更');
  store.edit(targetKey,'当日の欄で変更');await store.save(targetKey);
  assert.equal(writes[1].source,undefined);assert.equal(writes[1].expected_lesson_plan,'次回欄で変更');
  assert.equal(store.get(store.getLink(sourceKey).targetKey).value,'当日の欄で変更');
});
test('same names in different calendars have independent drafts and writes',async()=>{
  const {store,target,targetKey,writes}=setup();const other=ref('two','b'),otherKey=lessonEventKey(other);
  store.seed(target,'教室A');store.seed(other,'教室B');store.edit(targetKey,'Aだけ変更');await store.save(targetKey);
  assert.equal(store.get(otherKey).value,'教室B');assert.equal(writes[0].target.calendar_id,'a');
});
test('late link reads cannot replace a later refresh of the same source',async()=>{
  const old=gate();let reads=0;const source=ref('one'),target=ref('two'),newTarget={...ref('three'),etag:'2'};
  const {store,sourceKey}=setup({readNext:async()=>++reads===1?old.promise:{source,target:newTarget,lesson_plan:'最新'} });
  const pending=store.loadNext(source);await store.loadNext(source);old.resolve({source,target,lesson_plan:'古い'});await pending;
  assert.equal(store.getLink(sourceKey).target.id,'three');assert.equal(store.get(lessonEventKey(newTarget)).value,'最新');
});
test('a changed destination retains the draft and refuses to silently save it into the new event',async()=>{
  let changed=false;const source=ref('one'),target=ref('two'),next={...ref('three'),etag:'2'};
  const {store,writes,targetKey,sourceKey}=setup({readNext:async()=>({source,target:changed?next:target,lesson_plan:changed?'別予定':'既存'})});
  await store.loadNext(source);store.edit(targetKey,'保持する入力');changed=true;await store.loadNext(source);
  assert.equal(store.getLink(sourceKey).status,'conflict');assert.equal(store.get(targetKey).value,'保持する入力');
  await store.save(targetKey,sourceKey);assert.equal(writes.length,0);
  store.discard(targetKey);await store.loadNext(source);assert.equal(store.getLink(sourceKey).target.id,'three');
  assert.equal(store.get(lessonEventKey(next)).value,'別予定');
});
test('a conflict response keeps the input and blocks an already queued later write',async()=>{
  const response=gate();let writes=0;const {store,source,sourceKey,targetKey}=setup({write:async()=>{writes++;await response.promise;throw Object.assign(Error('conflict'),{status:409});}});
  await store.loadNext(source);store.edit(targetKey,'一');const first=store.save(targetKey,sourceKey);
  store.edit(targetKey,'二');const second=store.save(targetKey,sourceKey);response.resolve();
  await Promise.allSettled([first,second]);assert.equal(writes,1);assert.equal(store.get(targetKey).value,'二');assert.equal(store.get(targetKey).status,'conflict');
});
test('queued edits use the acknowledged previous baseline and do not let an old response undo new typing',async()=>{
  const first=gate(),writes=[];const {store,source,sourceKey,targetKey}=setup({write:async body=>{writes.push(body);if(writes.length===1)await first.promise;return {lesson_plan:body.lesson_plan};}});
  await store.loadNext(source);store.edit(targetKey,'一');const one=store.save(targetKey,sourceKey);
  store.edit(targetKey,'二');const two=store.save(targetKey,sourceKey);first.resolve();await Promise.all([one,two]);
  assert.deepEqual(writes.map(b=>b.expected_lesson_plan),['既存予定','一']);assert.equal(store.get(targetKey).value,'二');
});
test('save failure preserves input and permits a retry without changing another lesson',async()=>{
  let fail=true;const {store,source,sourceKey,targetKey}=setup({write:async body=>{if(fail)throw Error('failed');return {lesson_plan:body.lesson_plan};}});
  const other=ref('other','b');store.seed(other,'他の生徒');await store.loadNext(source);store.edit(targetKey,'失敗しても残す');
  await assert.rejects(store.save(targetKey,sourceKey));assert.equal(store.get(targetKey).value,'失敗しても残す');
  assert.equal(store.get(lessonEventKey(other)).value,'他の生徒');fail=false;await store.save(targetKey,sourceKey);assert.equal(store.get(targetKey).status,'saved');
});
test('no next lesson never creates a plan or submits a write',async()=>{
  const source=ref('one');const {store,sourceKey,writes}=setup({readNext:async()=>({source,target:null,reason:'none',lesson_plan:''})});
  await store.loadNext(source);assert.equal(store.getLink(sourceKey).status,'none');assert.equal(store.getLink(sourceKey).targetKey,'');
  await store.save('',sourceKey);assert.equal(writes.length,0);
});

test('a D1 next read retains the owner shared with the direct second lesson editor',async()=>{
 const source=ref('one'),target=ref('two');const store=createLessonPlanController({readNext:async()=>({source,target,owner_id:'owner-A',lesson_plan:'second plan',record_revision:3,attribution_status:'confirmed'}),write:async()=>{throw Error('no automatic write')}});
 store.seed(source,'first plan',0,1,'confirmed','owner-A');store.seed(target,'second plan',0,3,'confirmed','owner-A');await store.loadNext(source);const state=store.get(lessonEventKey(target));assert.equal(state.ownerId,'owner-A');assert.equal(store.getLink(lessonEventKey(source)).targetKey,state.key);store.edit(state.key,'shared unsaved');assert.equal(store.get(store.getLink(lessonEventKey(source)).targetKey).value,'shared unsaved');
});

test('unassigned next candidate retains target but never seeds an editable plan or auto-writes',async()=>{
 const source=ref('source'),target=ref('next');let writes=0;const store=createLessonPlanController({readNext:async()=>({source,target,source_owner_id:'owner-A',owner_id:null,owner_confirmation_required:true,lesson_plan:'',reason:'owner_confirmation_required'}),write:async()=>{writes++;}});store.seed(source,'source plan',0,1,'confirmed','owner-A');await store.loadNext(source);assert.equal(store.getLink(lessonEventKey(source)).status,'owner_confirmation_required');assert.deepEqual(store.getLink(lessonEventKey(source)).target,target);assert.equal(store.getLink(lessonEventKey(source)).targetKey,'');assert.equal(store.get(lessonEventKey(target)),undefined);assert.equal(writes,0);
});
test('source owner rebind with unchanged title cannot return another owner next plan under a stale card',async()=>{
 const source=ref('source'),target=ref('next');const store=createLessonPlanController({readNext:async()=>({source,target,source_owner_id:'owner-B',owner_id:'owner-B',lesson_plan:'B private'}),write:async()=>{throw Error('no writes')}});store.seed(source,'A plan',0,1,'confirmed','owner-A');await store.loadNext(source);assert.equal(store.getLink(lessonEventKey(source)).status,'conflict');assert.equal(store.get(lessonEventKey(target)),undefined);
});
test('a next editor draft is retained and held if ownership becomes unassigned',async()=>{
 const source=ref('source'),target=ref('next');let held=false;const store=createLessonPlanController({readNext:async()=>held?({source,target,source_owner_id:'A',owner_id:null,owner_confirmation_required:true,lesson_plan:''}):({source,target,source_owner_id:'A',owner_id:'A',attribution_status:'confirmed',lesson_plan:'old'}),write:async()=>{throw Error('no automatic save')}});store.seed(source,'source',0,1,'confirmed','A');await store.loadNext(source);store.edit(lessonEventKey(target),'unsaved');held=true;await store.loadNext(source);assert.equal(store.getLink(lessonEventKey(source)).status,'conflict');assert.equal(store.get(lessonEventKey(target)).value,'unsaved');assert.equal(store.get(lessonEventKey(target)).dirty,true);
});

test('unassigned next allows only pending-context D1 draft writes with a stable operation reference',async()=>{
 const source=ref('pending-source'),target=ref('pending-target');let sent;const store=createLessonPlanController({readNext:async()=>({source,target,source_owner_id:'A',owner_id:null,pending_allowed:true,pending_context:'context-a',owner_confirmation_required:true,record_revision:0,lesson_plan:''}),write:async body=>{sent=body;return {target,lesson_plan:body.lesson_plan,record_revision:1};}});store.seed(source,'source',0,1,'confirmed','A');await store.loadNext(source);const key=lessonEventKey(target);assert.equal(store.getLink(lessonEventKey(source)).status,'pending_owner');store.edit(key,'unassigned plan');await store.save(key,lessonEventKey(source));assert.equal(sent.pending_context,'context-a');assert.match(sent.request_id,/^[a-f0-9-]{36}$/);assert.equal(sent.expected_source_owner_id,'A');assert.equal(store.get(key).status,'saved');assert.equal(store.get(key).recordRevision,1);
});
test('pending draft recovery survives reload and unknown outcome is reconciled read-only, without resend',async()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),data=new Map();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)}});
 try{const target=ref('recover-target'),key=lessonEventKey(target);let writes=0,request;const store=createLessonPlanController({readNext:async()=>{},write:async body=>{writes++;request=body;throw Object.assign(Error('lost response'),{unknown:true});}});store.seed(target,'',0,0,'owner_unassigned',null,'recover-context');store.edit(key,'recover exact\n draft');await assert.rejects(store.save(key));assert.equal(store.get(key).pendingUnknown,true);assert.equal(store.discard(key),false);
  const reloaded=createLessonPlanController({readNext:async()=>{},write:async()=>{writes++;},readOperation:async id=>[{id,action:'write_pending_plan',after_json:JSON.stringify({pending_context:'recover-context',lesson_plan:request.lesson_plan,record_revision:1})}],readCurrent:async()=>({target,pending_context:'recover-context',lesson_plan:request.lesson_plan,record_revision:1})});reloaded.seed(target,request.lesson_plan,0,1,'owner_unassigned',null,'recover-context');assert.equal(reloaded.get(key).value,'recover exact\n draft');assert.equal(reloaded.get(key).status,'conflict');assert.equal(await reloaded.verifyPending(key),true);assert.equal(reloaded.get(key).status,'saved');assert.equal(writes,1);assert.equal(data.size,0);
 }finally{if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete globalThis.localStorage;}
});
