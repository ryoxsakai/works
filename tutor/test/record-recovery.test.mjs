import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const accept=app.slice(app.indexOf('function acceptRecordSnapshot('),app.indexOf('function showRowRecordRecovery('));
const ref={id:'synthetic'},key='synthetic';
const copy=(view,revision,memo)=>({view,revision,values:{test:'',homework:'',memo},completed:false});
function reconcile(alternatives,held){
 const draft={ref,ownerId:'synthetic-owner',unknown:true,operationId:'synthetic-operation',alternatives};
 let persisted;
 const recordDrafts=new Map([[key,draft]]);
 const context={matchingRecordRows:()=>[],synchronizeRecordRows:()=>held,recordDrafts,lessonEventKey:()=>key,persistRecordDraft:d=>{persisted=JSON.parse(JSON.stringify(d));return true;},clearRecordDraft:()=>{},showActionError:()=>{}};
 vm.runInNewContext(accept+';acceptRecordSnapshot(draft,saved);',{...context,draft,saved:{revision:2}});
 return {draft,recovery:JSON.parse(JSON.stringify(recordDrafts.get(key))),persisted};
}
test('audit reconciliation preserves original sibling revision and text over restored DOM metadata',()=>{
 const original=copy('record',1,'unsaved original');
 const {draft,recovery,persisted}=reconcile([original],[copy('record',2,'unsaved original')]);
 assert.equal(draft.unknown,false);
 assert.equal(recovery.revision,1);assert.deepEqual(recovery.values,original.values);assert.equal(recovery.conflict,true);
 assert.equal(persisted.revision,1);assert.deepEqual(persisted.values,original.values);
 const again=reconcile([JSON.parse(JSON.stringify(persisted))],[copy('record',2,'unsaved original')]);
 assert.equal(again.persisted.revision,1);assert.equal(again.persisted.conflict,true);
});
test('unmounted copies survive and newly discovered views are added',()=>{
 const original=copy('record',1,'daily original'),added=copy('curriculum',2,'curriculum independent');
 const {recovery}=reconcile([original],[added]);
 assert.deepEqual(recovery.values,original.values);assert.equal(recovery.revision,1);
 assert.deepEqual(recovery.alternatives,[added]);
});
test('both existing views keep their independent baselines',()=>{
 const originals=[copy('record',1,'daily'),copy('curriculum',1,'curriculum')];
 const {recovery}=reconcile(originals,originals.map(c=>({...c,revision:2})));
 assert.equal(recovery.revision,1);assert.deepEqual(recovery.alternatives,originals.slice(1));
});
