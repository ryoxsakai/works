import assert from 'node:assert/strict';
import test from 'node:test';
import {Miniflare} from 'miniflare';
import {handleTermLessonPlans} from '../src/term-lesson-plans.js';

const fixture=async t=>{
  const mf=new Miniflare({modules:true,script:"export default {fetch(){return new Response('ok')}}",compatibilityDate:'2026-08-01',d1Databases:{DB:'numbered-plans'}});
  t.after(()=>mf.dispose());
  const db=await mf.getD1Database('DB');
  const config={calendars:['A','B'],terms:[{id:2},{id:3}]};
  return (method,body)=>handleTermLessonPlans(new Request('https://example.invalid/api/term-lesson-plans',{method,body:JSON.stringify(body)}),db,config);
};
const slot={term_id:2,calendar_id:'A',title:'合成生徒甲',ordinal:3};

test('isolated D1 saves by term / calendar / name / ordinal with a guarded revision',async t=>{
  const call=await fixture(t);
  assert.deepEqual(await call('POST',{slots:[slot]}),{plans:[]});
  const first=await call('PUT',{slot,revision:0,value:'第3回の教材'});
  assert.deepEqual(first,{...slot,revision:1,value:'第3回の教材'});
  await assert.rejects(call('PUT',{slot,revision:0,value:'競合'}),{status:409});
  const contenders=await Promise.allSettled([call('PUT',{slot,revision:1,value:'更新1'}),call('PUT',{slot,revision:1,value:'更新2'})]);
  assert.equal(contenders.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(contenders.find(x=>x.status==='rejected').reason.status,409);
  const distinct=[{...slot,term_id:3},{...slot,calendar_id:'B'},{...slot,title:'合成生徒乙'},{...slot,ordinal:4}];
  const shown=await call('POST',{slots:[slot,slot,...distinct]});
  assert.deepEqual(shown.plans,[contenders.find(x=>x.status==='fulfilled').value]);
  assert.equal((await call('PUT',{slot,revision:2,value:''})).revision,3);
  assert.equal((await call('POST',{slots:[slot]})).plans[0].value,'','a cleared plan persists as a revision');
});

test('read chunks respect the binding limit; invalid scopes or edits make no writes',async t=>{
  const call=await fixture(t);
  const slots=Array.from({length:42},(_,i)=>({...slot,ordinal:i+1}));
  for(const s of [slots[0],slots[21],slots[41]]) await call('PUT',{slot:s,revision:0,value:'計画'});
  assert.deepEqual((await call('POST',{slots})).plans.map(x=>x.ordinal).sort((a,b)=>a-b),[1,22,42]);
  for(const invalid of [{...slot,term_id:9},{...slot,calendar_id:'outside'},{...slot,title:'　合成生徒甲'},{...slot,ordinal:0}]){
    await assert.rejects(call('POST',{slots:[invalid]}),{status:400});
    await assert.rejects(call('PUT',{slot:invalid,revision:0,value:'拒否'}),{status:400});
  }
  await assert.rejects(call('PUT',{slot,revision:0,value:'x'.repeat(5001)}),{status:400});
});
