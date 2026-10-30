import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=process.env.UI_ROOT || fileURLToPath(new URL('../../',import.meta.url));
const artifacts=process.env.UI_ARTIFACTS || 'test-artifacts/category-ui', baseline=process.env.UI_BASELINE==='1';
const css=process.env.TODO_FIXTURE_CSS;
if(!css) throw new Error('Set TODO_FIXTURE_CSS to CSS compiled from todo/index.html (docs/category-wiki-ui-qa.md).');
fs.mkdirSync(artifacts,{recursive:true});
const browser=await chromium.launch({...(process.env.BROWSER_EXECUTABLE ? {executablePath:process.env.BROWSER_EXECUTABLE} : {})}),report=[];
try {
 for(const service of ['memo','todo']) for(const width of [320,390,1440]) for(const theme of ['light','dark','system-light','system-dark']) {
  const context=await browser.newContext({viewport:{width,height:900},colorScheme:theme.endsWith('dark')?'dark':'light'});
  await context.addInitScript(t=>{if(!t.startsWith('system'))localStorage.setItem('works_theme',t);},theme);
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  let state={roles:[],cloneRequests:{},categories:['仕事','個人','長いカテゴリ名'.repeat(10)],memos:[{id:'m1',title:'テストメモ',category:'仕事',bodies:['本文'],notes:[],tags:[],createdAt:'2026-10-13',updatedAt:'2026-10-13'}],tasks:[{id:'t1',name:'テストタスク',category:'仕事',deadline:null,priority:null,progress:0,memo:''}],revision:0};
  await context.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.hostname==='cdn.tailwindcss.com')return route.fulfill({contentType:'text/javascript',body:`const s=document.createElement('style');s.textContent=${JSON.stringify(fs.readFileSync(css,'utf8'))};document.head.append(s);`});
   if(u.origin!=='https://category.test')return route.abort();
   if(u.pathname==='/shared/auth.js')return route.fulfill({contentType:'text/javascript',body:`export const getSessionToken=()=> 'qa';export const signIn=()=>{};export const signOutUser=async()=>{};export const watchAuth=({onSignedIn})=>onSignedIn({});`});
   if(u.pathname===`/api/${service}`){if(route.request().method()!=='GET')state={...state,...route.request().postDataJSON(),revision:state.revision+1};return route.fulfill({json:state});}
   const f=path.join(root,u.pathname+(u.pathname.endsWith('/')?'index.html':''));if(!fs.existsSync(f))return route.fulfill({status:404,body:''});
   return route.fulfill({contentType:({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(f)],body:fs.readFileSync(f)});
  });
  await page.goto(`https://category.test/${service}/`);await expect(page.locator('#login-screen')).toBeHidden();
  await page.screenshot({path:`${artifacts}/${service}-${width}-${theme}-list.png`,fullPage:true});
  if(service==='todo' && !baseline) {
   await expect(page.locator('#app')).toBeVisible();
   const trigger=page.locator('#categories-open'),modal=page.locator('#categories-dialog');
   const settle=()=>page.waitForFunction(()=>!history.state?.todoDialog);
   await trigger.click();await expect(modal).toBeVisible();assert(await modal.evaluate(e=>e.matches(':modal')));
   assert(await modal.evaluate(e=>e.scrollWidth<=e.clientWidth+1));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   await page.screenshot({path:`${artifacts}/${service}-${width}-${theme}-modal.png`});
   for(const b of await modal.locator('button:visible').all()){const box=await b.boundingBox();assert(box.width>=43&&box.height>=43,`44px ToDo category target ${await b.textContent()} ${box.width}x${box.height}`);}
   await modal.locator('[data-close]').focus();await page.keyboard.press('Shift+Tab');assert(await modal.evaluate(e=>e.contains(document.activeElement)));await page.keyboard.press('Tab');assert(await modal.evaluate(e=>e.contains(document.activeElement)));
   await modal.locator('.category-row input').first().fill('破棄する名前');await page.keyboard.press('Escape');await settle();await expect(trigger).toBeFocused();assert.equal(state.categories[0],'仕事');
   await trigger.click();await expect(modal.locator('.category-row input').first()).toHaveValue('仕事');
   await modal.locator('#categories-form input').fill('追加カテゴリ');await modal.locator('#categories-form input').press('Enter');await expect.poll(()=>state.categories.includes('追加カテゴリ')).toBe(true);
   await modal.locator('.category-row input').first().fill('改名済み');await modal.locator('[data-category-action="rename"]').first().click();await expect.poll(()=>state.categories[0]).toBe('改名済み');assert.equal(state.tasks[0].category,'改名済み');
   await modal.locator('[data-category-action="down"]').first().click();await expect.poll(()=>state.categories[1]).toBe('改名済み');
   await modal.locator('[data-category-index="1"] select').selectOption(state.categories[0]);await modal.locator('[data-category-index="1"] [data-category-action="remove"]').click();await expect.poll(()=>state.categories.includes('改名済み')).toBe(false);assert.equal(state.tasks[0].category,state.categories[0]);
   await page.keyboard.press('Escape');await settle();await expect(trigger).toBeFocused();await trigger.click();await expect(modal.locator('#categories-form input')).toHaveValue('');
   await modal.locator('[data-close]').click();await settle();await expect(trigger).toBeFocused();await trigger.click();await page.goBack();await expect(modal).toBeHidden();await expect(trigger).toBeFocused();
   await trigger.click();await page.mouse.click(2,2);await expect(modal).toBeHidden();await settle();
   // Empty-registry behavior is exercised without orphaning an existing task.
   state={...state,tasks:[],revision:state.revision+1};await page.reload();await expect(page.locator('#app')).toBeVisible();await trigger.click();
   while(state.categories.length){const count=state.categories.length;await modal.locator('[data-category-action="remove"]').first().click();await expect.poll(()=>state.categories.length).toBe(count-1);}
   await expect(modal).toContainText('カテゴリはまだありません');await expect(modal.locator('#categories-form input')).toBeFocused();await modal.locator('#categories-form input').fill('再開');await modal.locator('#categories-form input').press('Enter');await expect.poll(()=>state.categories).toEqual(['再開']);
   assert.deepEqual(errors,[]);report.push({service,width,theme,result:'pass',layout:'personal-todo'});await context.close();continue;
  }
  const padding=await page.locator('#tab-list .tab-btn').first().evaluate(e=>getComputedStyle(e).paddingLeft);if(!baseline)assert.equal(padding,'16px');
  const trigger=page.locator('[onclick="openCategoryModal()"]').first();await trigger.click();const modal=page.locator('#category-modal');await expect(modal).toBeVisible();
  await page.screenshot({path:`${artifacts}/${service}-${width}-${theme}-modal.png`});
  if(baseline){report.push({service,width,theme,padding,baseline:true});await context.close();continue;}
  await expect(page.locator('#new-category-input')).toBeFocused();assert(await modal.evaluate(e=>e.matches(':modal')));
  assert(await modal.evaluate(e=>e.scrollWidth<=e.clientWidth+1));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  for(const b of await modal.locator('button:visible').all()){const box=await b.boundingBox();assert(box.width>=43 && box.height>=43,`44px target ${await b.getAttribute('aria-label')}`);}
  await modal.locator('.category-header button').focus();await page.keyboard.press('Shift+Tab');assert(await modal.evaluate(e=>e.contains(document.activeElement)));await page.keyboard.press('Tab');assert(await modal.evaluate(e=>e.contains(document.activeElement)));
  const edit=()=>modal.getByRole('button',{name:'名前を変更',exact:true});
  await edit().first().click();await page.locator('#edit-cat-input').fill('破棄する名前');await page.keyboard.press('Escape');await expect(modal).toBeVisible();await expect(edit().first()).toBeFocused();assert.equal(state.categories[0],'仕事');
  await page.locator('#new-category-input').fill('追加カテゴリ');await page.locator('#new-category-input').press('Enter');await expect.poll(()=>state.categories.includes('追加カテゴリ')).toBe(true);
  await edit().first().click();await page.locator('#edit-cat-input').fill('改名済み');await modal.getByRole('button',{name:'変更を保存',exact:true}).click();await expect.poll(()=>state.categories[0]).toBe('改名済み');assert.equal(state[service==='memo'?'memos':'tasks'][0].category,'改名済み');
  await modal.getByRole('button',{name:'下へ移動',exact:true}).first().click();await expect.poll(()=>state.categories[1]).toBe('改名済み');
  await modal.getByRole('button',{name:'削除',exact:true}).nth(1).click();await expect.poll(()=>state.categories.includes('改名済み')).toBe(false);assert.equal(state[service==='memo'?'memos':'tasks'][0].category,state.categories[0]);
  await page.keyboard.press('Escape');await expect(modal).toBeHidden();await expect(trigger).toBeFocused();await trigger.click();await expect(page.locator('#new-category-input')).toHaveValue('');
  await modal.getByRole('button',{name:'カテゴリ管理を閉じる',exact:true}).click();await expect(trigger).toBeFocused();await trigger.click();await modal.getByRole('button',{name:'完了',exact:true}).click();await expect(modal).toBeHidden();await trigger.click();await page.mouse.click(2,2);await expect(modal).toBeHidden();
  await trigger.click();while(await modal.getByRole('button',{name:'削除',exact:true}).count()){const n=state.categories.length;await modal.getByRole('button',{name:'削除',exact:true}).first().click();await expect.poll(()=>state.categories.length).toBe(n-1);}
  await expect(modal).toContainText('下の入力欄から追加');await expect(page.locator('#new-category-input')).toBeFocused();await page.locator('#new-category-input').fill('再開');await page.locator('#new-category-input').press('Enter');await expect.poll(()=>state.categories).toEqual(['再開']);
  assert.deepEqual(errors,[]);report.push({service,width,theme,padding,result:'pass'});await context.close();
 }
 fs.writeFileSync(`${artifacts}/report.json`,JSON.stringify(report,null,2));console.log(`Category UI: ${report.length} service/width/theme scenarios PASS`);
}finally{await browser.close();}
