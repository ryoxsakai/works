import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const browser=await chromium.launch({...(process.env.BROWSER_EXECUTABLE ? {executablePath:process.env.BROWSER_EXECUTABLE} : {})});
try {
 const context=await browser.newContext(); const page=await context.newPage(); const errors=[];
 page.on('pageerror',e=>errors.push(e.message)); page.on('dialog',d=>d.accept());
 let state={memos:[],categories:['仕事'],revision:0}, conflict=false;
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/shared/auth.js') return route.fulfill({contentType:'text/javascript',body:`export const getSessionToken=()=> 'qa'; export const signIn=()=>{}; export const signOutUser=async()=>{}; export const watchAuth=({onSignedIn})=>onSignedIn({});`});
  if(url.pathname==='/api/memo') {
   if(route.request().method()==='PUT') {
    if(conflict) return route.fulfill({status:409,json:{error:'競合しました'}});
    state={...route.request().postDataJSON(),revision:state.revision+1};
   }
   return route.fulfill({json:state});
  }
  // Cached Tailwind CDN styling is the app's existing runtime dependency.
  if(url.origin!=='https://memo.test') return route.abort();
  const file=path.join(root,url.pathname+(url.pathname.endsWith('/')?'index.html':''));
  if(!fs.existsSync(file)) return route.fulfill({status:404,body:''});
  return route.fulfill({contentType:({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(file)],body:fs.readFileSync(file)});
 });
 await page.goto('https://memo.test/memo/'); await page.waitForFunction(()=> typeof window.openMemoModal==='function');
 assert.equal(await page.locator('#login-screen').isVisible(),false);
 assert.equal(await page.locator('#memo-modal').isVisible(),false);
 assert.equal(await page.locator('#view-modal').isVisible(),false);
 assert.match(await page.locator('body').evaluate(el=>getComputedStyle(el).fontFamily),/Segoe UI/);
 const revisionBefore=state.revision;
 await page.evaluate(async()=>{const {startMemoPresentation}=await import('/shared/ui/memo-presentation.mjs');startMemoPresentation().stop();startMemoPresentation();startMemoPresentation();});
 assert.equal(state.revision,revisionBefore,'presentation lifecycle never saves');
 await page.evaluate(()=>openMemoModal(null));
 // The original modal focuses its title after 50ms. Wait for that transition
 // before typing so its delayed focus cannot redirect a fast fill into the title.
 await page.waitForFunction(()=>document.activeElement?.id==='modal-title');
 await page.locator('#modal-title').fill('複数本文');
 await page.locator('#modal-body-0').fill('first https://example.test');
 await page.evaluate(()=>addModalBody()); await page.locator('#modal-body-1').fill('second');
 await page.evaluate(()=>moveModalBody(1,-1));
 await page.evaluate(()=>addModalNote()); await page.locator('#modal-note-0').fill('補足');
 await page.locator('#modal-tag-input').fill('変換中');
 const beforeIme=await page.locator('#modal-tags-list').textContent();
 await page.locator('#modal-tag-input').evaluate(el=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true})));
 assert.equal(await page.locator('#modal-tag-input').inputValue(),'変換中','IME Enter must retain tag text');
 assert.equal(await page.locator('#modal-tags-list').textContent(),beforeIme,'IME Enter must not create a tag');
 await page.locator('#modal-tag-input').fill("tag'quoted"); await page.locator('#modal-tag-input').press('Enter');
 assert.equal(await page.locator('#modal-note-0').inputValue(),'補足');
 await page.evaluate(()=>saveMemo()); await page.waitForFunction(()=>document.querySelector('#save-status').textContent==='保存済み');
 assert.deepEqual(state.memos[0].bodies,['second','first https://example.test']); assert.deepEqual(state.memos[0].notes,['補足']);
 await page.reload(); await page.waitForFunction(()=>document.querySelectorAll('.memo-card').length===1);
 await page.evaluate(()=>setTagFilter("tag'quoted")); assert.equal(await page.locator('.memo-card').count(),1);
 await page.evaluate(()=>openMemoView(document.querySelector('.memo-card').getAttribute('onclick').match(/openMemoView\("([^"]+)/)[1]));
 assert.equal(await page.locator('#view-body-container a').getAttribute('href'),'https://example.test');
 await page.evaluate(()=>viewEditMemo()); await page.waitForFunction(()=>document.activeElement?.id==='modal-title'); await page.evaluate(()=>removeModalTag(0)); await page.evaluate(()=>saveMemo());
 await page.waitForFunction(()=>document.querySelector('#save-status').textContent==='保存済み'); assert.equal(await page.locator('.memo-card').count(),1);
 await page.evaluate(()=>openCategoryModal()); await page.locator('#new-category-input').fill('すべて'); await page.evaluate(()=>addCategory()); assert(!state.categories.includes('すべて')); await page.evaluate(()=>closeCategoryModal());
 fs.mkdirSync('test-artifacts/memo',{recursive:true});
 for(const width of [320,375,390,768,1440]) {
  await page.setViewportSize({width,height:900});
  for(const theme of ['light','dark','system']) {
   await page.locator('.works-header .works-settings-toggle').click();
   await page.locator(`.works-settings-dialog input[value="${theme}"]`).check();
   await page.locator('.works-settings-dialog button[aria-label="閉じる"]').click();
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   await page.screenshot({path:`test-artifacts/memo/${width}-${theme}.png`,fullPage:true});
   await page.evaluate(()=>openMemoModal(null));
   await page.waitForFunction(()=>document.activeElement?.id==='modal-title');
   await page.locator('#modal-title').fill('未保存の入力');
   await page.locator('#modal-body-0').fill('日本語変換中\n本文');
   const beforePresentation=state.revision;
   await page.evaluate(async()=>{const c=(await import('/shared/ui/memo-presentation.mjs')).startMemoPresentation();c.stop();c.start();});
   assert.equal(await page.locator('#modal-title').inputValue(),'未保存の入力');
   assert.equal(state.revision,beforePresentation);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   await page.screenshot({path:`test-artifacts/memo/${width}-${theme}-edit.png`,fullPage:true});
   await page.evaluate(()=>closeMemoModal());
   assert.equal(await page.locator('#memo-modal').isVisible(),false);
   if(width===390&&theme==='dark') {await page.emulateMedia({media:'print',reducedMotion:'reduce'});await page.pdf({path:'test-artifacts/memo/print.pdf'});await page.emulateMedia({media:'screen'});}
  }
 }
 conflict=true; await page.evaluate(()=>openMemoModal(null)); await page.waitForFunction(()=>document.activeElement?.id==='modal-title'); await page.locator('#modal-title').fill('未保存'); await page.evaluate(()=>saveMemo());
 await page.locator('#export-draft').waitFor({state:'visible'}); assert.equal(state.memos.length,1); assert.equal(await page.locator('.memo-card').count(),2);
 assert.deepEqual(errors,[]); console.log('Memo browser: CRUD persistence, bodies, notes, quoted tags, tag cleanup, reserved category, 15 theme/width scenarios, conflict recovery PASS');
} finally { await browser.close(); }
