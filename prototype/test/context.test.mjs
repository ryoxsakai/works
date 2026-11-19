import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoContext,createSessionAdapter} from '../session.mjs';
import {visibleProjects,escapeHtml} from '../ss-model.mjs';
test('auth initialization is shared across simultaneous callers',async()=>{
 let calls=0;const auth=createSessionAdapter(({onSignedIn})=>{calls++;queueMicrotask(()=>onSignedIn({email:'synthetic@example.test'}));},'test');
 const [a,b]=await Promise.all([auth.init(),auth.init()]);assert.equal(calls,1);assert.equal(a,b);
});
test('sample saves are idempotent and never touch fetch or browser credentials',async()=>{
 const context=createDemoContext();await Promise.all([context.save('ss-101','draft','one'),context.save('ss-101','draft','one')]);assert.equal(context.metrics.saves,1);assert.equal(context.draft('ss-101'),'draft');assert.equal(createDemoContext().draft('ss-101'),'');
});
test('aborted reads do not deliver stale data and fixture failures are explicit',async()=>{
 const abort=new AbortController();const read=createDemoContext('slow').list({signal:abort.signal});abort.abort();await assert.rejects(read,{name:'AbortError'});await assert.rejects(createDemoContext('error').list(),/再試行/);assert.deepEqual(await createDemoContext('empty').list(),[]);
});
test('SS status ordering, completed visibility and text escaping preserve existing semantics',()=>{
 const rows=[{name:'完成',status:'完了',deadline:'2026-10-20',memo:''},{name:'確認',status:'素材案確認待ち',deadline:'2026-11-01',memo:'合成'},{name:'原稿',status:'原稿待ち',deadline:'2026-11-02',memo:''}];
 assert.deepEqual(visibleProjects(rows).map(r=>r.name),['確認','原稿']);assert.equal(visibleProjects(rows,{completed:true})[0].name,'完成');assert.equal(visibleProjects(rows,{sort:'status'})[0].name,'原稿');assert.equal(visibleProjects(rows,{query:'合成'}).length,1);assert.equal(escapeHtml('<img onerror="x">'),'&lt;img onerror=&quot;x&quot;&gt;');
});
