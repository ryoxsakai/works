import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve('..');
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
  return route.fulfill({contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(file)],body:fs.readFileSync(file)});
 });
 await page.goto('https://memo.test/memo/'); await page.waitForFunction(()=> typeof window.openMemoModal==='function');
 assert.equal(await page.locator('#login-screen').isVisible(),false);
 await page.evaluate(()=>openMemoModal(null));
 // The original modal focuses its title after 50ms. Wait for that transition
 // before typing so its delayed focus cannot redirect a fast fill into the title.
 await page.waitForFunction(()=>document.activeElement?.id==='modal-title');
 await page.locator('#modal-title').fill('複数本文');
 await page.locator('#modal-body-0').fill('first https://example.test');
 await page.evaluate(()=>addModalBody()); await page.locator('#modal-body-1').fill('second');
 await page.evaluate(()=>moveModalBody(1,-1));
 await page.evaluate(()=>addModalNote()); await page.locator('#modal-note-0').fill('補足');
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
 for(const width of [320,375,768,1440]) {
  await page.setViewportSize({width,height:900});
  for(const theme of ['light','dark','system']) {
   await page.locator('.works-header .works-settings-toggle').click();
   await page.locator(`.works-settings-dialog input[value="${theme}"]`).check();
   await page.locator('.works-settings-dialog button[aria-label="閉じる"]').click();
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   await page.screenshot({path:`test-artifacts/memo/${width}-${theme}.png`,fullPage:true});
  }
 }
 conflict=true; await page.evaluate(()=>openMemoModal(null)); await page.waitForFunction(()=>document.activeElement?.id==='modal-title'); await page.locator('#modal-title').fill('未保存'); await page.evaluate(()=>saveMemo());
 await page.locator('#export-draft').waitFor({state:'visible'}); assert.equal(state.memos.length,1); assert.equal(await page.locator('.memo-card').count(),2);
 assert.deepEqual(errors,[]); console.log('Memo browser: CRUD persistence, bodies, notes, quoted tags, tag cleanup, reserved category, 12 theme/width scenarios, conflict recovery PASS');
} finally { await browser.close(); }
