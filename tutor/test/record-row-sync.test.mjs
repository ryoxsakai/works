import test from 'node:test';
import assert from 'node:assert/strict';
import {recordRowSnapshot,independentRecordRows,synchronizeRecordRows} from '../record-row-sync.mjs';

const values={test:'old test',homework:'old homework',memo:'old memo'};
function row(view='record',initial=values,completed=false){
 const inputs=Object.fromEntries(Object.entries(initial).map(([key,value])=>[key,{value,defaultValue:value}]));
 const checkbox=view==='curriculum'?{checked:completed,defaultChecked:completed}:null;
 return {dataset:{recordRevision:'1',completed:completed?'1':'0'},inputs,checkbox,querySelector(selector){if(selector==='.curriculum-completed')return checkbox;if(selector.startsWith('.'+view+'-'))return inputs[selector.slice(view.length+2)]||null;return null;}};
}
const next={revision:2,values:{test:'saved test',homework:'saved homework',memo:'saved memo'},completed:true};

test('clean views acknowledge one complete snapshot and update future edit baselines',()=>{
 const daily=row(),curriculum=row('curriculum');
 assert.deepEqual(synchronizeRecordRows([daily,curriculum],next,curriculum),[]);
 for(const r of [daily,curriculum]){assert.equal(r.dataset.recordRevision,2);assert.equal(r.dataset.completed,'1');for(const key of Object.keys(values)){assert.equal(r.inputs[key].value,next.values[key]);assert.equal(r.inputs[key].defaultValue,next.values[key]);}}
 assert.equal(curriculum.checkbox.checked,true);assert.equal(curriculum.checkbox.defaultChecked,true);
 const second={revision:3,values:{...next.values,homework:'next edit'},completed:false};
 assert.deepEqual(synchronizeRecordRows([daily,curriculum],second,daily),[]);assert.equal(curriculum.checkbox.checked,false);assert.equal(curriculum.checkbox.defaultChecked,false);
});
test('each independently edited text field keeps its original input and revision',()=>{
 for(const field of Object.keys(values)){
  const daily=row(),curriculum=row('curriculum');daily.inputs[field].value='pending '+field;
  const held=synchronizeRecordRows([daily,curriculum],next,curriculum);
  assert.equal(held.length,1);assert.equal(held[0].view,'record');assert.equal(held[0].revision,1);assert.equal(held[0].values[field],'pending '+field);
  assert.equal(daily.dataset.recordRevision,'1');assert.equal(daily.inputs[field].value,'pending '+field);assert.equal(curriculum.dataset.recordRevision,2);
 }
});
test('an independently changed completion checkbox is retained without promoting its revision',()=>{
 const daily=row(),curriculum=row('curriculum');curriculum.checkbox.checked=true;
 const held=synchronizeRecordRows([daily,curriculum],{...next,completed:false},daily);
 assert.equal(held.length,1);assert.equal(held[0].completed,true);assert.equal(curriculum.checkbox.checked,true);assert.equal(curriculum.checkbox.defaultChecked,false);assert.equal(curriculum.dataset.recordRevision,'1');assert.equal(daily.dataset.completed,'0');
});
test('input already equal to the acknowledged snapshot needs no conflict',()=>{
 const daily=row(),curriculum=row('curriculum');daily.inputs.homework.value=next.values.homework;
 assert.deepEqual(synchronizeRecordRows([daily,curriculum],next,curriculum),[]);assert.equal(daily.dataset.recordRevision,2);assert.equal(daily.inputs.homework.defaultValue,next.values.homework);
});
test('dirty detection holds only the dirty row, even when another row uses the same view',()=>{
 const dirty=row(),clean=row(),source=row('curriculum');dirty.inputs.memo.value='independent';
 assert.equal(synchronizeRecordRows([dirty,clean,source],next,source).length,1);assert.equal(dirty.dataset.recordRevision,'1');assert.equal(clean.dataset.recordRevision,2);assert.equal(clean.inputs.memo.value,next.values.memo);
});
test('capturing a sibling recovery copy leaves both views and completion untouched',()=>{
 const daily=row(),curriculum=row('curriculum');curriculum.inputs.memo.value='retained';curriculum.checkbox.checked=true;
 const before=recordRowSnapshot(curriculum),copies=independentRecordRows([daily,curriculum],{...next,completed:false},daily);
 assert.deepEqual(copies,[before]);assert.deepEqual(recordRowSnapshot(curriculum),before);assert.equal(daily.dataset.recordRevision,'1');
});
