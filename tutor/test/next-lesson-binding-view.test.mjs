import test from 'node:test';
import assert from 'node:assert/strict';
import {renderPlanEditors} from '../../shared/lesson-record-view.mjs';

function render({offer=true,allowNextBinding=true,changes={},linkStatus='pending_owner'}={}){
 const target={calendar_id:'synthetic-calendar',id:'target',title:'合成',start:'2026-11-23T10:20:00+09:00'};
 const state={value:'保存した下書き',pendingContext:'v1',status:'saved',...changes};
 const link={source:{id:'source'},target,targetKey:'target',status:linkStatus,current:offer?{target,next_binding:{has_draft:true}}:{}};
 const nodes={textarea:{value:''},'.lesson-plan-status':{dataset:{}},'.lesson-plan-action':{dataset:{}},'.lesson-plan-target':{dataset:{}}};
 let review;
 const editor={dataset:{sourceKey:'source'},ownerDocument:{createElement(){return {setAttribute(key,value){this[key]=value;}};}},
  querySelector:key=>nodes[key],closest:()=>null,append(node){review=node;}};
 const root={querySelectorAll:()=>[editor],querySelector:()=>null};
 renderPlanEditors(root,{getLink:()=>link,get:()=>state},{lessonPlanDate:x=>x.start,resizeRecordInput(){},allowNextBinding});
 return {review,input:nodes.textarea,status:nodes['.lesson-plan-status'],action:nodes['.lesson-plan-action']};
}
test('saved exact draft links to the specific source for focused review; other surfaces retain manual link',()=>{
 const {review,input}=render(),url=new URL(review.href,'https://works.invalid');
 assert.equal(review.textContent,'次回の紐づけと下書きを確認');
 assert.deepEqual(Object.fromEntries(url.searchParams),{calendar_id:'synthetic-calendar',event_id:'target',next_source_id:'source'});
 assert.equal(input.value,'保存した下書き');assert.equal(review.inert,false);
 for (const props of [{offer:false},{allowNextBinding:false}]){
  const manual=render(props).review;
  assert.equal(manual.textContent,'次回候補の紐づけを確認');
  assert.doesNotMatch(manual.href,/next_source_id/);assert.equal(manual.inert,false);
 }
});
test('dirty, in-flight, or unknown-result drafts never allow either review navigation',()=>{
 for (const changes of [{dirty:true,recoveryUnavailable:true},{pending:1},{pendingUnknown:true}]){
  const {review,input}=render({changes});
  assert.equal(review.inert,true);assert.equal(review['aria-disabled'],'true');
  assert.doesNotMatch(review.href,/next_source_id/);assert.equal(input.value,'保存した下書き');
  if(!changes.pendingUnknown)assert.match(review.textContent,/下書きを保存してから/);
 }
});
test('automatic matching shows a neutral message while holding even a previously pending editor',()=>{
 for(const [linkStatus,message]of [['loading','次回の授業を確認しています…'],['auto_binding','次回の授業と紐づけています…']]){
  const {review,input,status,action}=render({linkStatus});
  assert.equal(status.textContent,message);assert.doesNotMatch(status.textContent,/D1|未紐づけ/);
  assert.equal(review,undefined);assert.equal(action.hidden,true);assert.equal(input.readOnly,true);
 }
});
