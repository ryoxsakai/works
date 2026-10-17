import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudentMemoStore} from '../student-memo.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
};
function setup(extra = {}) {
  const profiles = new Map([['山田', {name:'山田', memo:'既存メモ', print_name:'印刷氏名'}], ['佐藤', {name:'佐藤', memo:'別生徒のメモ'}]]);
  const writes = [];
  const store = createStudentMemoStore({
    readProfile: async name => structuredClone(profiles.get(name) || {name,memo:null}),
    writeMemo: async (name,memo) => { writes.push({name,memo}); profiles.set(name,{...profiles.get(name),name,memo}); },
    ...extra,
  });
  return {store,profiles,writes};
}
test('existing notes load without writes or initialization; different names stay separate', async () => {
  const {store,writes,profiles}=setup();
  await Promise.all([store.load('山田'),store.load('佐藤'),store.load('未登録')]);
  assert.equal(store.get('山田').value,'既存メモ');assert.equal(store.get('佐藤').value,'別生徒のメモ');
  assert.equal(store.get('未登録').value,'');assert.deepEqual(writes,[]);assert.equal(profiles.has('未登録'),false);
  store.edit('山田','改行\n共有メモ');await store.save('山田');
  assert.equal(profiles.get('山田').memo,'改行\n共有メモ');assert.equal(profiles.get('山田').print_name,'印刷氏名');
  assert.equal(store.get('佐藤').value,'別生徒のメモ');
});
test('same name is one shared draft across views, dates and classrooms; reload reads the server', async () => {
  const {store,profiles}=setup();await store.load('山田');
  store.edit('山田','授業記録からの変更');await store.save('山田');
  await store.load('山田');assert.equal(store.get('山田').value,'授業記録からの変更');
  store.edit('山田','生徒情報からの変更');await store.save('山田');
  const reloaded=createStudentMemoStore({readProfile:async name=>profiles.get(name),writeMemo:async()=>assert.fail('unexpected write')});
  await reloaded.load('山田');assert.equal(reloaded.get('山田').value,'生徒情報からの変更');
});
test('failed initial read cannot accept edits or save an empty memo; retry keeps existing data', async () => {
  let fail=true;const {store,writes}=setup({readProfile:async()=>{if(fail)throw Error('read failed');return {memo:'消してはいけないメモ'};}});
  await assert.rejects(store.load('山田'),/read failed/);assert.equal(store.get('山田').status,'load-error');
  assert.equal(store.edit('山田',''),false);await assert.rejects(store.save('山田'),/取得して/);assert.deepEqual(writes,[]);
  fail=false;await store.load('山田');assert.equal(store.get('山田').value,'消してはいけないメモ');
});
test('save failure retains the draft through refresh, then retries without touching another name', async () => {
  let fail=true;const writes=[];const {store}=setup({writeMemo:async(name,memo)=>{writes.push({name,memo});if(fail)throw Error('save failed');}});
  await store.load('山田');store.edit('山田','保持する入力');await assert.rejects(store.save('山田'),/save failed/);
  assert.equal(store.get('山田').status,'save-error');await store.load('山田',{refresh:true});
  assert.equal(store.get('山田').value,'保持する入力');assert.equal(store.get('山田').status,'save-error');
  await store.load('佐藤');fail=false;await store.save('山田');
  assert.equal(store.get('山田').status,'saved');assert.equal(store.get('佐藤').value,'別生徒のメモ');
  assert.deepEqual(writes,[{name:'山田',memo:'保持する入力'},{name:'山田',memo:'保持する入力'}]);
});
test('late refresh cannot replace a newer edit or its successful save', async () => {
  const gate=deferred();let reads=0;
  const {store}=setup({readProfile:async()=>++reads===1?{memo:'元の値'}:gate.promise});
  await store.load('山田');const refresh=store.load('山田',{refresh:true});
  store.edit('山田','新しい値');await store.save('山田');gate.resolve({memo:'古い応答'});await refresh;
  assert.equal(store.get('山田').value,'新しい値');assert.equal(store.get('山田').status,'saved');
});
test('late save success or failure stays with its name and cannot replace subsequent typing', async () => {
  for(const fail of [false,true]) {
    const gate=deferred();const {store}=setup({writeMemo:()=>gate.promise});
    await Promise.all([store.load('山田'),store.load('佐藤')]);store.edit('山田','保存中の値');
    const save=store.save('山田');store.edit('山田','さらに入力');
    if(fail)gate.reject(Error('old save failed'));else gate.resolve();await Promise.allSettled([save]);
    assert.equal(store.get('山田').value,'さらに入力');assert.equal(store.get('山田').status,'unsaved');
    assert.equal(store.get('佐藤').value,'別生徒のメモ');assert.equal(store.get('佐藤').status,'ready');
  }
});
test('earlier save completion cannot report success or error over a later save', async () => {
  const first=deferred(),second=deferred();let count=0;
  const {store}=setup({writeMemo:()=>++count===1?first.promise:second.promise});await store.load('山田');
  store.edit('山田','一');const one=store.save('山田');store.edit('山田','二');const two=store.save('山田');
  first.reject(Error('first failed'));await Promise.allSettled([one]);assert.equal(store.get('山田').status,'saving');
  second.resolve();await two;assert.equal(store.get('山田').value,'二');assert.equal(store.get('山田').status,'saved');
});
test('intentional clear saves only memo=null after a successful read', async () => {
  const {store,writes,profiles}=setup();await store.load('山田');store.edit('山田','  ');await store.save('山田');
  assert.deepEqual(writes,[{name:'山田',memo:null}]);assert.equal(profiles.get('山田').print_name,'印刷氏名');
});
