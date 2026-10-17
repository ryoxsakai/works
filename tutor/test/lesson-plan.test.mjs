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
