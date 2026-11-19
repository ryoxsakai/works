import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const browser=await chromium.launch(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{});
const artifacts='test-artifacts/admission';fs.mkdirSync(artifacts,{recursive:true});
const rows=[{id:'a',university:'北里大学医学部',selection_type:'general',stage:'primary',schedule_date:'2027-01-31',end_date:null,notes:'Synthetic\nsecond line',source_url:'https://example.test/source'},{id:'b',university:'北里大学医学部',selection_type:'general',stage:'final_result',schedule_date:'2027-02-10',notes:'result'},{id:'c',university:'愛知医科大学',selection_type:'ct',stage:'primary',schedule_date:'2027-02-01',notes:'other'}];
try {
 for(const width of [320,390,768,1440])for(const theme of ['light','dark']) {
  const context=await browser.newContext({viewport:{width,height:900},colorScheme:theme==='dark'?'light':'dark',hasTouch:width<500,reducedMotion:'reduce'});
  await context.addInitScript(t=>localStorage.setItem('works_theme',t),theme);
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));let gets=0,failed=false,empty=false;
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.origin!=='https://admission.test')return route.abort();
   if(u.pathname==='/shared/auth.js')return route.fulfill({contentType:'text/javascript',body:`export const getSessionToken=()=> 'synthetic'; export const signOutUser=async()=>{};export const watchAuth=({onSignedIn})=>onSignedIn({email:'synthetic@example.test'});`});
   if(u.pathname==='/api/admissions'){assert.equal(route.request().method(),'GET');gets++;return route.fulfill(failed?{status:503,json:{error:'synthetic unavailable'}}:{json:empty?[]:rows});}
   const file=path.join(root,u.pathname+(u.pathname.endsWith('/')?'index.html':''));
   if(!fs.existsSync(file))return route.fulfill({status:404,body:''});
   return route.fulfill({contentType:({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(file)],body:fs.readFileSync(file)});
  });
  await page.goto('https://admission.test/admission/');await expect(page.locator('#admission-list')).toContainText('北里');
  assert.equal(await page.locator('#user-avatar-fallback').isVisible(),true);
  assert.equal(await page.locator('#admission-filter-modal').isVisible(),false);
  for(const tab of await page.locator('[data-admission-view-tab]').all())assert(await tab.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'tab label must fit');
  assert(await page.locator('.admission-view-tabs').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'all four tabs fit');
  const before=gets;
  await page.evaluate(async()=>{const c=(await import('/shared/ui/admission-presentation.mjs')).startAdmissionPresentation();c.stop();c.start();c.start();});assert.equal(gets,before);
  for(const view of ['list','calendar','gantt','table']) {
   await page.locator(`[data-admission-view-tab="${view}"]`).click();
   await expect(page.locator(`[data-admission-view="${view}"]`)).toBeVisible();
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'page overflow '+view+width);
   await page.screenshot({path:`${artifacts}/${width}-${theme}-${view}.png`,fullPage:true});
  }
  await page.reload();await expect(page.locator('[data-admission-view-tab="table"]')).toHaveAttribute('aria-selected','true');
  await page.locator('#admission-filter-open').click();const dialog=page.locator('#admission-filter-modal');await expect(dialog).toBeVisible();assert(await dialog.evaluate(el=>el.matches(':modal')));
  await page.locator('#admission-filter-university-search').fill('北里');
  await page.locator('input[name="filter_university"]').filter({visible:true}).first().check();
  await page.locator('[data-admission-filter-tab="types"]').click();await page.locator('input[name="filter_type"][value="general"]').check();
  await page.locator('[data-admission-filter-tab="months"]').click();await page.locator('input[name="filter_month"][value="1"]').check();
  await page.screenshot({path:`${artifacts}/${width}-${theme}-filter.png`});
  await dialog.locator('button[type="submit"]').click();await expect(dialog).not.toBeVisible();await expect(page.locator('#admission-filter-summary')).toContainText('大学 1件');
  await page.locator('#admission-filter-reset').click();await page.locator('#admission-filter-open').click();await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();
  await expect(page.locator('#admission-filter-open')).toBeFocused();
  await page.locator('[data-admission-view-tab="calendar"]').click();await page.locator('[data-admission-calendar-mode="continuous"]').click();await expect(page.locator('[data-admission-calendar-mode="continuous"]')).toHaveAttribute('aria-pressed','true');
  await page.locator('[data-admission-calendar-mode="month"]').click();const title=await page.locator('#admission-calendar-label').textContent();await page.locator('#admission-calendar-next').click();assert.notEqual(await page.locator('#admission-calendar-label').textContent(),title);await page.locator('#admission-calendar-prev').click();assert.equal(await page.locator('#admission-calendar-label').textContent(),title);
  if(width===390){await page.evaluate(()=>window.print=()=>{window.printCalls=(window.printCalls||0)+1});for(const view of ['list','calendar','gantt','table']){await page.locator(`[data-admission-view-tab="${view}"]`).click();await page.locator('#admission-print').click();await page.emulateMedia({media:'print'});await page.pdf({path:`${artifacts}/print-${theme}-${view}.pdf`});await page.emulateMedia({media:'screen'});await page.evaluate(()=>dispatchEvent(new Event('afterprint')));}assert.equal(await page.evaluate(()=>window.printCalls),4);}
  failed=true;await page.reload();await expect(page.locator('#admission-error')).toContainText('synthetic unavailable');failed=false;empty=true;await page.reload();await page.locator('[data-admission-view-tab="list"]').click();await expect(page.locator('#admission-list')).toContainText('まだ登録されていません');
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log('Admission original UI: 8 viewport/theme cases, 4 views, native filters, date navigation, persistence, lifecycle, print, empty/error and GET-only PASS');
}finally{await browser.close();}
