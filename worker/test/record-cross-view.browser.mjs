import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createFixture} from './next-lesson-fixture.mjs';
import {createLessonOwner,changeLessonBinding,handleOwnerHistory,readEventOwnerRecord,writeEventOwnerRecord} from '../src/lesson-owner-history.js';
import {readLessonPlan,writeLessonPlan,readNextLessonPlan} from '../src/lesson-plan.js';
import {lessonEventRef} from '../../shared/lesson-plan.js';

const f=await createFixture();
f.env.LESSON_HISTORY_MODE='active';
await f.DB.batch((await readFile(new URL('../migrations/lesson-owner-history.sql',import.meta.url),'utf8')).replace(/^--.*$/gm,'').split(';').filter(s=>s.trim()).map(s=>f.DB.prepare(s)));
await f.DB.prepare("INSERT INTO lesson_history_policy VALUES(1,1,1,'{}')").run();
await f.DB.prepare('CREATE TABLE terms(id INTEGER PRIMARY KEY,label TEXT,start_date TEXT,end_date TEXT)').run();
await f.DB.prepare("INSERT INTO terms VALUES(2,'後期','2026-09-03','2026-12-05')").run();
const title='合成同期クラス';
f.events.splice(0,f.events.length,...['2026-11-03','2026-11-10'].map((d,i)=>({calendar_id:'qa',id:'sync-'+i,summary:title,status:'confirmed',created:'2026-01-01T00:00:00Z',iCalUID:'synthetic-'+i,etag:'v1',start:{dateTime:d+'T14:30:00+09:00'},end:{dateTime:d+'T15:50:00+09:00'}})));
const owner=(await createLessonOwner(f.env,{request_id:crypto.randomUUID(),name:title,kind:'class'})).owner;
for(const e of f.events)await changeLessonBinding(f.env,{request_id:crypto.randomUUID(),target:lessonEventRef(e,'qa'),link_revision:0,decision:'new',owner_id:owner.id,owner_revision:owner.revision},f.deps);
let writes=0,lost=false,hold=null;
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||undefined}),errors=[];
let context=await browser.newContext({viewport:{width:1280,height:900}});
const routeApi=async route=>{
 const req=route.request(),u=new URL(req.url()),body=req.method()==='GET'?null:req.postDataJSON();
 try{let result;
  if(u.pathname.startsWith('/api/lesson-history/'))result=await handleOwnerHistory(f.env,new Request(req.url(),{method:req.method(),headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),u,f.deps);
  else if(u.pathname==='/api/terms')result=(await f.DB.prepare('SELECT * FROM terms').all()).results;
  else if(u.pathname==='/api/lesson-records')result=await Promise.all(body.targets.map(t=>readEventOwnerRecord(f.env,t,f.events.find(e=>e.id===t.id),f.deps)));
  else if(u.pathname==='/api/next-lesson-plan')result=await readNextLessonPlan(f.env,u.searchParams.get('calendar_id'),u.searchParams.get('event_id'),f.deps);
  else if(u.pathname==='/api/lesson-plan')result=req.method()==='PUT'?await writeLessonPlan(f.env,body,f.deps):await readLessonPlan(f.env,u.searchParams.get('calendar_id'),u.searchParams.get('event_id'),f.deps);
  else if(u.pathname==='/api/curriculum/sync-0'&&req.method()==='PUT'){
   writes++;if(hold)await hold.promise;
   result=await writeEventOwnerRecord(f.env,{target:body.target,patch:body,record_revision:body.record_revision,expected_owner_id:body.expected_owner_id,request_id:body.request_id},f.deps);
   if(lost){lost=false;return route.abort();}
  }else return route.continue();
  return route.fulfill({json:result});
 }catch(e){return route.fulfill({status:e.status||500,json:{error:e.message,code:e.code}});}
};
await context.route('**/api/**',routeApi);
const stored=()=>f.DB.prepare("SELECT r.* FROM lesson_event_links l JOIN lesson_history_records r ON r.id=l.record_id WHERE l.event_id='sync-0'").first();
const daily=p=>p.locator('#record-tbody tr[data-event-id="sync-0"]'),curr=p=>p.locator('#curriculum-tbody tr[data-event-id="sync-0"]');
async function openBoth(p){p.on('pageerror',e=>errors.push(e.message));await p.clock.install({time:new Date('2026-11-03T00:00:00+09:00')});await p.goto(f.base+'/tutor/?record_date=2026-11-03');await expect(daily(p).locator('.record-plan')).toBeEditable();await p.locator('[data-page-tab=curriculum]').click();await p.locator('#student-selector button').filter({hasText:title}).click();await expect(curr(p).locator('.curriculum-homework')).toBeEditable();}
async function edit(p,view,field,value){
 const row=view==='record'?daily(p):curr(p);await row.locator('.'+view+'-'+field).evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},value);
 await expect.poll(async()=>(await stored())[{test:'confirmation_test',homework:'homework',memo:'lesson_memo'}[field]]).toBe(value);
 await expect(row.locator('.'+view+'-'+field)).toBeEnabled();
}
async function tab(p,view){await p.getByRole('button',{name:view==='record'?'授業記録':'生徒情報',exact:true}).click();}
async function freshPage(){await context.close();context=await browser.newContext({viewport:{width:1280,height:900}});await context.route('**/api/**',routeApi);const p=await context.newPage();await openBoth(p);return p;}
async function input(row,view,field,value,change=false){await row.locator('.'+view+'-'+field).evaluate((el,{value,change})=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));if(change)el.dispatchEvent(new Event('change',{bubbles:true}));},{value,change});}
try{
 let page=await context.newPage();await openBoth(page);
 await daily(page).evaluate(el=>{const table=document.createElement('table');table.id='identity-fixtures';table.hidden=true;for(const mode of ['foreign-owner','different-observation']){const copy=el.cloneNode(true);copy.dataset.recordRevision='77';if(mode==='foreign-owner')copy.dataset.recordOwner='different-owner';else{const ref=JSON.parse(copy.dataset.recordRef);ref.etag='different-observation';copy.dataset.recordRef=JSON.stringify(ref);}table.append(copy);}document.body.append(table);});
 await edit(page,'curriculum','homework','カリキュラムの宿題');
 await tab(page,'record');await edit(page,'record','test','日別の確認テスト');
 // The original code accepts Daily's stale homework under the advanced revision.
 assert.equal((await stored()).homework,'カリキュラムの宿題','switching views must not overwrite the previous homework save');
 await expect(daily(page).locator('.record-homework')).toHaveValue('カリキュラムの宿題');
 await expect(curr(page).locator('.curriculum-test')).toHaveValue('日別の確認テスト');
 await tab(page,'curriculum');await edit(page,'curriculum','memo','共有する授業メモ');
 await expect(daily(page).locator('.record-memo')).toHaveValue('共有する授業メモ');
 await curr(page).locator('.curriculum-completed').check();await expect.poll(async()=>(await stored()).completed).toBe(1);await expect(daily(page)).toHaveAttribute('data-completed','1');
 await tab(page,'record');await edit(page,'record','homework','日別で追記した宿題');assert.equal((await stored()).completed,1);await expect(curr(page).locator('.curriculum-completed')).toBeChecked();
 await daily(page).locator('.record-plan').fill('同期する授業予定');await daily(page).locator('.record-plan').press('Tab');await expect(curr(page).locator('.curriculum-plan')).toHaveValue('同期する授業予定');
 await tab(page,'curriculum');await curr(page).locator('.curriculum-completed').uncheck();await expect.poll(async()=>(await stored()).completed).toBe(0);await expect(daily(page)).toHaveAttribute('data-completed','0');
 const saved=await stored();assert.equal(saved.confirmation_test,'日別の確認テスト');assert.equal(saved.homework,'日別で追記した宿題');assert.equal(saved.lesson_memo,'共有する授業メモ');assert.equal(saved.lesson_plan,'同期する授業予定');
 assert.deepEqual(await page.locator('#identity-fixtures tr').evaluateAll(rows=>rows.map(r=>r.dataset.recordRevision)),['77','77']);

 // A pending request locks both views, including the completion checkbox.
 let release;hold={promise:new Promise(r=>release=r)};
 await input(curr(page),'curriculum','homework','応答待ちの宿題',true);
 await expect(curr(page).locator('.curriculum-homework')).toBeDisabled();await expect(daily(page).locator('.record-test')).toBeDisabled();await expect(curr(page).locator('.curriculum-completed')).toBeDisabled();
 release();hold=null;await expect.poll(async()=>(await stored()).homework).toBe('応答待ちの宿題');await expect(daily(page).locator('.record-homework')).toHaveValue('応答待ちの宿題');await expect(curr(page).locator('.curriculum-homework')).toBeEnabled();

 // An independently dirty sibling keeps all its values and original revision.
 for(const key of ['test','homework','memo'])await input(daily(page),'record',key,'日別の保持入力-'+key);
 const beforeDraftRevision=await daily(page).getAttribute('data-record-revision');
 await input(curr(page),'curriculum','homework','他の表示で確定した宿題',true);
 await expect.poll(async()=>(await stored()).homework).toBe('他の表示で確定した宿題');
 await expect(page.locator('#retained-record-drafts')).toContainText('日別の保持入力-memo');
 for(const key of ['test','homework','memo'])await expect(daily(page).locator('.record-'+key)).toHaveValue('日別の保持入力-'+key);
 await expect(daily(page)).toHaveAttribute('data-record-revision',beforeDraftRevision);await expect(daily(page).locator('.record-homework')).toBeDisabled();await expect(curr(page).locator('.curriculum-homework')).toBeDisabled();
 const beforeReloadWrites=writes;await page.reload();await page.getByRole('button',{name:'授業記録',exact:true}).click();await expect(page.locator('#retained-record-drafts')).toContainText('日別の保持入力-test');await expect(daily(page).locator('.record-memo')).toHaveValue('日別の保持入力-memo');assert.equal(writes,beforeReloadWrites);

 // Completion is an independent draft too, and survives a reload without being sent.
 page=await freshPage();await curr(page).locator('.curriculum-completed').evaluate(el=>{el.checked=true;el.dispatchEvent(new Event('input',{bubbles:true}));});
 await input(daily(page),'record','memo','日別で確定したメモ',true);
 await expect.poll(async()=>(await stored()).lesson_memo).toBe('日別で確定したメモ');assert.equal((await stored()).completed,0);
 await expect(curr(page).locator('.curriculum-completed')).toBeChecked();await expect(curr(page).locator('.curriculum-completed')).toBeDisabled();await expect(page.locator('#retained-record-drafts')).toContainText('完了：完了');
 await page.reload();await page.getByRole('button',{name:'授業記録',exact:true}).click();await page.locator('[data-page-tab=curriculum]').click();await page.locator('#student-selector button').filter({hasText:title}).click();await expect(curr(page).locator('.curriculum-completed')).toBeChecked();await expect(curr(page).locator('.curriculum-completed')).toBeDisabled();

 // Unknown outcome verification acknowledges the committed snapshot, but does not
 // discard another view's pending input or resend the write after reload.
 page=await freshPage();await input(daily(page),'record','memo','応答不明でも残す独立入力');const originalRevision=Number(await daily(page).getAttribute('data-record-revision'));lost=true;await input(curr(page),'curriculum','test','応答不明だが保存済みのテスト',true);
 await expect.poll(()=>lost).toBe(false);await expect(page.locator('#retained-record-drafts')).toContainText('応答不明でも残す独立入力');const beforeVerify=writes;
 await page.reload();await page.getByRole('button',{name:'授業記録',exact:true}).click();await page.locator('#retained-record-drafts summary').click();await page.getByRole('button',{name:'この記録の保存結果だけを照合',exact:true}).click();
 await expect(page.locator('#retained-record-drafts')).toContainText('応答不明でも残す独立入力');await expect(page.getByRole('button',{name:'この記録の保存結果だけを照合',exact:true})).toHaveCount(0);await expect(daily(page).locator('.record-memo')).toHaveValue('応答不明でも残す独立入力');await expect(daily(page).locator('.record-memo')).toBeDisabled();assert.equal(writes,beforeVerify);
 await expect(page.locator('#retained-record-drafts')).toContainText('元の版 '+originalRevision);
 const recoveryCopy=()=>page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('works_pending_plan_draft_v1:')))));
 const verifiedCopy=await recoveryCopy();assert.equal(verifiedCopy.recordRevision,originalRevision);assert.equal(JSON.parse(verifiedCopy.value).values.memo,'応答不明でも残す独立入力');assert.equal(JSON.parse(verifiedCopy.value).conflict,true);
 await page.reload();await page.getByRole('button',{name:'授業記録',exact:true}).click();await expect(daily(page).locator('.record-memo')).toHaveValue('応答不明でも残す独立入力');await expect(daily(page).locator('.record-memo')).toBeDisabled();assert.equal((await recoveryCopy()).recordRevision,originalRevision);
 await input(daily(page),'record','test','保存を試しても停止',true);await expect(daily(page).locator('.record-test')).toBeDisabled();assert.equal((await stored()).confirmation_test,'応答不明だが保存済みのテスト');assert.equal(writes,beforeVerify);

 // If rewriting the recovery copy fails after a successful save, keep the
 // pre-dispatch copy (including the sibling) so audit verification can recover it.
 page=await freshPage();await input(daily(page),'record','memo','容量不足でも保持');let finish;hold={promise:new Promise(r=>finish=r)};
 await input(curr(page),'curriculum','test','容量不足前に保存したテスト',true);await expect(curr(page).locator('.curriculum-test')).toBeDisabled();
 await page.evaluate(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(String(key).startsWith('works_pending_plan_draft_v1:'))throw new DOMException('synthetic quota','QuotaExceededError');return set.call(this,key,value);};});
 finish();hold=null;await expect.poll(async()=>(await stored()).confirmation_test).toBe('容量不足前に保存したテスト');await expect(page.locator('#action-error')).toContainText('復旧コピーを更新できない');
 const beforeQuotaRecovery=writes;await page.reload();await page.getByRole('button',{name:'授業記録',exact:true}).click();await page.locator('#retained-record-drafts summary').click();await page.getByRole('button',{name:'この記録の保存結果だけを照合',exact:true}).click();await expect(page.locator('#retained-record-drafts')).toContainText('容量不足でも保持');assert.equal(writes,beforeQuotaRecovery);

 // A genuine external revision conflict preserves the server's entire snapshot.
 page=await freshPage();const old=await stored();await f.DB.prepare('UPDATE lesson_history_records SET confirmation_test=?,homework=?,lesson_memo=?,completed=1,revision=revision+1 WHERE id=?').bind('外部テスト','外部宿題','外部メモ',old.id).run();
 await input(curr(page),'curriculum','memo','競合した保持入力',true);await expect(page.locator('#retained-record-drafts')).toContainText('競合した保持入力');await expect(curr(page).locator('.curriculum-memo')).toBeDisabled();
 const external=await stored();assert.equal(external.confirmation_test,'外部テスト');assert.equal(external.homework,'外部宿題');assert.equal(external.lesson_memo,'外部メモ');assert.equal(external.completed,1);
 assert.deepEqual(errors,[]);assert.equal(f.control.calendarWrites.length,0);
 console.log('PASS cross-view: alternating Daily/Curriculum, 3 fields + plan + completed true/false; exact owner/observation fence; shared pending lock; independent text/completion drafts and reload; unknown audit recovery and quota failure without resend; external full-snapshot conflict; Calendar writes0');
}finally{await context.close();await browser.close();await f.close();}
